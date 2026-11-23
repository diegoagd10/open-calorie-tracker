import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'

const TLC_URL = 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar'
const TLC_SHA256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88'
const JAVA_TOOL = 'java@temurin-25'

const REPO = join(import.meta.dirname, '../..')

export type Verification = {
  name: string
  skill: string
  module: string
  replayed: string
  rules: string[]
  brokenDesigns: { design: string; breaks: string }[]
  replayBounds?: Record<string, number>
}

class Failure extends Error {}

const findTlc = async (): Promise<string> => {
  const jar = join(homedir(), '.cache/open-calorie-tracker/tla2tools-1.7.4.jar')
  if (!existsSync(jar)) {
    const response = await fetch(TLC_URL)
    if (!response.ok) throw new Failure(`Downloading ${TLC_URL} answered ${response.status}`)
    mkdirSync(join(jar, '..'), { recursive: true })
    const partial = `${jar}.${process.pid}`
    writeFileSync(partial, Buffer.from(await response.arrayBuffer()))
    renameSync(partial, jar)
  }
  const sha256 = createHash('sha256').update(readFileSync(jar)).digest('hex')
  if (sha256 !== TLC_SHA256) throw new Failure(`${jar} has the wrong checksum. Delete it.`)
  return jar
}

const findJava = (): string[] => {
  if (spawnSync('java', ['-version']).status === 0) return ['java']
  if (spawnSync('mise', ['--version']).status === 0) {
    return ['mise', 'exec', JAVA_TOOL, '--', 'java']
  }
  throw new Failure('Needs Java 11 or later, or mise to install it')
}

const run = (command: string[], env: NodeJS.ProcessEnv = {}) => {
  const [program = '', ...args] = command
  const { status, stdout, stderr, error } = spawnSync(program, args, {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 1 << 28,
  })
  if (error !== undefined) throw new Failure(`${program} did not run: ${error.message}`)
  return { status, output: `${stdout}${stderr}` }
}

type Run = { design?: string; rule?: string; dump?: string; bounds?: Record<string, number> }

const tlc = (
  command: string[],
  work: string,
  module: string,
  { design, rule, dump, bounds = {} }: Run,
) => {
  const config = join(work, 'run.cfg')
  let text = readFileSync(join(work, `${module}.cfg`), 'utf8').replace(
    /^INVARIANTS .*$/m,
    rule === undefined ? '' : `INVARIANTS ${rule}`,
  )
  if (design !== undefined) text = text.replace(/Design = "\w+"/, `Design = "${design}"`)
  for (const [bound, value] of Object.entries(bounds)) {
    text = text.replace(new RegExp(`${bound} = \\d+`), `${bound} = ${value}`)
  }
  writeFileSync(config, text)
  const { status, output } = run([
    ...command,
    '-workers',
    '1',
    '-metadir',
    join(work, 'states'),
    '-config',
    config,
    ...(dump === undefined ? [] : ['-dump', 'dot,actionlabels', dump]),
    join(work, `${module}.tla`),
  ])
  const violated = /Invariant (\w+) is violated/.exec(output)?.[1]
  if (status !== 0 && violated === undefined) throw new Failure(`TLC failed:\n${output}`)
  return {
    violated,
    steps: [...output.matchAll(/^State \d+: <(\w+)/gm)].map(([, action = '']) => action).slice(1),
    states: /(\d+) distinct states found/.exec(output)?.[1] ?? '?',
  }
}

const blobsOf = (files: string[]) =>
  Object.fromEntries(files.map((file) => [file, run(['git', 'hash-object', file]).output.trim()]))

const check = async (
  { name, skill, module, replayed, rules, brokenDesigns, replayBounds = {} }: Verification,
  confirm: boolean,
): Promise<boolean> => {
  const jar = await findTlc()
  const command = [...findJava(), '-XX:+UseParallelGC', '-cp', jar, 'tlc2.TLC']
  const coverage = join(skill, 'coverage.json')
  const work = mkdtempSync(join(tmpdir(), 'formal-verification-'))
  let ok = true
  const report = (passed: boolean, line: string) => {
    ok &&= passed
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${line}`)
  }
  try {
    for (const extension of ['tla', 'cfg']) {
      copyFileSync(join(skill, `${module}.${extension}`), join(work, `${module}.${extension}`))
    }
    const config = readFileSync(join(work, `${module}.cfg`), 'utf8')

    console.log(`\nModel of the code, ${/Design = "(\w+)"/.exec(config)?.[1]}`)
    for (const rule of rules) {
      const { violated, steps, states } = tlc(command, work, module, { rule })
      report(
        violated === undefined,
        violated === undefined
          ? `${rule} holds in all ${states} states`
          : `${rule} breaks: ${steps.join(', ')}`,
      )
    }

    console.log('\nReplay on the real code')
    const dump = join(work, 'graph.dot')
    tlc(command, work, module, { dump, bounds: replayBounds })
    const replay = run(
      ['pnpm', 'exec', 'vp', 'test', 'run', '--config', join(skill, 'vite.config.ts')],
      { STATE_GRAPH: dump },
    )
    const summary = [...replay.output.matchAll(/^Replayed \d+ steps.*$/gm)].map(([line]) => line)
    const conforms = replay.status === 0 && summary.length > 0
    report(conforms, conforms ? summary.join('. ') : `The replay on ${replayed} failed`)
    if (!conforms) console.log(replay.output)

    console.log('\nBroken designs that the check must catch')
    for (const { design, breaks } of brokenDesigns) {
      const { violated } = tlc(command, work, module, { design, rule: breaks })
      report(violated === breaks, `${design} ${violated ? 'breaks' : 'does not break'} ${breaks}`)
    }

    console.log('\nCovered code')
    const recorded = JSON.parse(readFileSync(coverage, 'utf8')) as Record<string, string>
    const current = blobsOf(Object.keys(recorded))
    if (confirm && ok) {
      writeFileSync(coverage, `${JSON.stringify(current, undefined, 2)}\n`)
      console.log(`Confirmed ${relative(REPO, coverage)}`)
    } else {
      for (const [file, blob] of Object.entries(recorded)) {
        const same = current[file] === blob
        report(same, `${file} ${same ? 'is as confirmed' : 'changed since it was confirmed'}`)
      }
    }
  } finally {
    rmSync(work, { recursive: true })
  }
  console.log(ok ? `\n${name} is verified.` : `\n${name} is NOT verified.`)
  return ok
}

export const verify = async (verification: Verification): Promise<void> => {
  const { values } = parseArgs({ options: { confirm: { type: 'boolean', default: false } } })
  try {
    process.exitCode = (await check(verification, values.confirm)) ? 0 : 1
  } catch (error) {
    if (!(error instanceof Failure)) throw error
    console.error(error.message)
    process.exitCode = 2
  }
}
