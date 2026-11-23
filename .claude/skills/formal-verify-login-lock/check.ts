#!/usr/bin/env -S node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
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

const SKILL = import.meta.dirname
const REPO = join(SKILL, '../../..')
const COVERAGE = join(SKILL, 'coverage.json')

const INVARIANTS = ['GuessLimit', 'LockHolds', 'NotShutOut'] as const
type Invariant = (typeof INVARIANTS)[number]

const BROKEN_DESIGNS: { design: string; breaks: Invariant }[] = [
  { design: 'CountAfterCheck', breaks: 'GuessLimit' },
  { design: 'CountAfterCheck', breaks: 'LockHolds' },
  { design: 'LeakOnError', breaks: 'NotShutOut' },
]

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

const CONFIG = readFileSync(join(SKILL, 'LoginLock.cfg'), 'utf8')

const tlc = (
  command: string[],
  work: string,
  { design, invariant, dump }: { design?: string; invariant?: Invariant; dump?: string },
) => {
  const config = join(work, 'run.cfg')
  let text = CONFIG.replace(/^INVARIANTS .*$/m, invariant ? `INVARIANTS ${invariant}` : '')
  if (design !== undefined) text = text.replace(/Design = "\w+"/, `Design = "${design}"`)
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
    join(work, 'LoginLock.tla'),
  ])
  const violated = /Invariant (\w+) is violated/.exec(output)?.[1]
  if (status !== 0 && violated === undefined) throw new Failure(`TLC failed:\n${output}`)
  return {
    violated,
    steps: [...output.matchAll(/^State \d+: <(\w+) line/gm)].map(([, action = '']) => action),
    states: /(\d+) distinct states found/.exec(output)?.[1] ?? '?',
  }
}

const blobsOf = (files: string[]) =>
  Object.fromEntries(files.map((file) => [file, run(['git', 'hash-object', file]).output.trim()]))

const { values } = parseArgs({ options: { confirm: { type: 'boolean', default: false } } })

const main = async (): Promise<boolean> => {
  const jar = await findTlc()
  const command = [...findJava(), '-XX:+UseParallelGC', '-cp', jar, 'tlc2.TLC']
  const work = mkdtempSync(join(tmpdir(), 'login-lock-'))
  let ok = true
  const report = (passed: boolean, line: string) => {
    ok &&= passed
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${line}`)
  }
  try {
    copyFileSync(join(SKILL, 'LoginLock.tla'), join(work, 'LoginLock.tla'))

    console.log(`\nModel of the code, ${/Design = "(\w+)"/.exec(CONFIG)?.[1]}`)
    for (const invariant of INVARIANTS) {
      const { violated, steps, states } = tlc(command, work, { invariant })
      report(
        violated === undefined,
        violated === undefined
          ? `${invariant} holds in all ${states} states`
          : `${invariant} breaks: ${steps.join(', ')}`,
      )
    }

    console.log('\nReplay on the real code')
    const dump = join(work, 'graph.dot')
    tlc(command, work, { dump })
    const replay = run(
      ['pnpm', 'exec', 'vp', 'test', 'run', '--config', join(SKILL, 'vite.config.ts')],
      { LOGIN_LOCK_GRAPH: dump },
    )
    const replayed = /Replayed \d+ steps.*/.exec(replay.output)?.[0]
    const conforms = replay.status === 0 && replayed !== undefined
    report(conforms, conforms ? replayed : 'The replay on AuthService.login failed')
    if (!conforms) console.log(replay.output)

    console.log('\nBroken designs that the check must catch')
    for (const { design, breaks } of BROKEN_DESIGNS) {
      const { violated } = tlc(command, work, { design, invariant: breaks })
      report(violated === breaks, `${design} ${violated ? 'breaks' : 'does not break'} ${breaks}`)
    }

    console.log('\nCovered code')
    const recorded = JSON.parse(readFileSync(COVERAGE, 'utf8')) as Record<string, string>
    const current = blobsOf(Object.keys(recorded))
    if (values.confirm && ok) {
      writeFileSync(COVERAGE, `${JSON.stringify(current, undefined, 2)}\n`)
      console.log(`Confirmed ${relative(REPO, COVERAGE)}`)
    } else {
      for (const [file, blob] of Object.entries(recorded)) {
        const same = current[file] === blob
        report(same, `${file} ${same ? 'is as confirmed' : 'changed since it was confirmed'}`)
      }
    }
  } finally {
    rmSync(work, { recursive: true })
  }
  console.log(ok ? '\nThe login lock is verified.' : '\nThe login lock is NOT verified.')
  return ok
}

try {
  process.exitCode = (await main()) ? 0 : 1
} catch (error) {
  if (!(error instanceof Failure)) throw error
  console.error(error.message)
  process.exitCode = 2
}
