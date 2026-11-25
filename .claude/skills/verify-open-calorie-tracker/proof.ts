import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Failure, field, parseEntry } from './model.ts'
import type { Entry, RecordedCommand, Source, State } from './model.ts'

const TRANSCRIPT = 'transcript.jsonl'
const BLOCK_START = '<!-- oct-verify:start -->'
const BLOCK_END = '<!-- oct-verify:end -->'
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]*/g
const API_KEY = /oct_live_[A-Za-z0-9]{8,}/g
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

type Capture = { file: string; sha256: string }
type PullRequest = { commit: string; body: string; url: string; slug: string; state: string }
type Evidence = {
  slug: string
  commit: string
  evidenceCommit: string
  entries: Entry[]
  files: string[]
}

const directoryOf = (commit: string): string => commit.slice(0, 12)

const redact = (text: string, repo: string): string =>
  text
    .replace(JWT, '<jwt>')
    .replace(API_KEY, '<api-key>')
    .replaceAll(repo, '<checkout>')
    .replaceAll(homedir(), '~')

const toLine = (entry: Entry, repo: string): string =>
  `${JSON.stringify(entry, (_, value: unknown) =>
    typeof value === 'string' ? redact(value, repo) : value,
  )}\n`

const captureOf = ({ command, result }: Entry): Capture | undefined => {
  const file = field(result, 'file')
  const sha256 = field(result, 'sha256')
  return command === 'screenshot' && typeof file === 'string' && typeof sha256 === 'string'
    ? { file, sha256 }
    : undefined
}

const isApiRead = ({ command, result }: Entry): boolean => {
  const request = field(result, 'request')
  const status = field(result, 'status')
  return (
    command === 'api' &&
    typeof request === 'string' &&
    request.startsWith('GET ') &&
    typeof status === 'number' &&
    status >= 200 &&
    status < 300
  )
}

const latestCaptures = (entries: Entry[]): Capture[] => [
  ...new Map(
    entries.flatMap((entry) => captureOf(entry) ?? []).map((capture) => [capture.file, capture]),
  ).values(),
]

const provingEntries = (entries: Entry[], commit: string): Entry[] => {
  const next =
    'Commit every change, run up, then run the feature file of each feature you touched, with a screenshot and an api GET'
  const atCommit = entries.filter((entry) => entry.source.commit === commit)
  const kept = atCommit.filter((entry) => entry.source.clean)
  if (atCommit.length === 0) {
    throw new Failure(`the transcript has no commands for this commit, ${commit}`, next)
  }
  if (kept.length === 0) {
    throw new Failure(
      `all ${atCommit.length} commands on ${commit} ran from uncommitted changes`,
      next,
    )
  }
  const missing = [
    ...(kept.some((entry) => captureOf(entry) !== undefined)
      ? []
      : ['screenshot in the evidence dir']),
    ...(kept.some(isApiRead) ? [] : ['api GET with a 2xx status']),
  ]
  if (missing.length > 0) {
    throw new Failure(
      `the ${kept.length} commands on ${commit} from a clean checkout have no ${missing.join(' and no ')}`,
      next,
    )
  }
  return kept
}

const slugOfRemote = (url: string): string | undefined =>
  /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@(?:ssh\.)?github\.com(?::\d+)?\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(
    url,
  )?.[1]

const parsePullRequest = (text: string): PullRequest => {
  const value: unknown = JSON.parse(text)
  const commit = field(value, 'headRefOid')
  const body = field(value, 'body')
  const url = field(value, 'url')
  const state = field(value, 'state')
  const slug =
    typeof url === 'string' ? /^https:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\//.exec(url)?.[1] : undefined
  if (
    typeof commit !== 'string' ||
    typeof body !== 'string' ||
    typeof url !== 'string' ||
    typeof state !== 'string' ||
    slug === undefined
  ) {
    throw new Failure('gh pr view printed an unknown shape', 'Update gh, then rerun publish')
  }
  return { commit, body, url, slug, state }
}

const count = (total: number, noun: string): string => `${total} ${noun}${total === 1 ? '' : 's'}`

const blobUrl = ({ slug, commit, evidenceCommit }: Evidence, file: string): string => {
  const path = [directoryOf(commit), ...file.split('/')].map((part) =>
    encodeURIComponent(part).replaceAll('(', '%28').replaceAll(')', '%29'),
  )
  return `https://github.com/${slug}/blob/${evidenceCommit}/${path.join('/')}`
}

const runRows = (entries: Entry[]): string[] =>
  [...Map.groupBy(entries, (entry) => `${entry.startedAt} | ${entry.app}`)].map(
    ([run, commands]) =>
      `| ${run} | ${commands.length} | ${commands.filter((entry) => !entry.ok).length} |`,
  )

const proofBlock = (evidence: Evidence): string[] => [
  BLOCK_START,
  '',
  `Verified commit: ${evidence.commit}`,
  '',
  `Apps: ${[...new Set(evidence.entries.map((entry) => entry.app))].sort().join(', ')}. [Transcript](${blobUrl(evidence, TRANSCRIPT)}) of ${count(evidence.entries.length, 'command')}. A failed command can be an expected check.`,
  '',
  '| Run started | App | Commands | Failed commands |',
  '| --- | --- | --- | --- |',
  ...runRows(evidence.entries),
  '',
  '<details>',
  `<summary>${count(evidence.files.length, 'screenshot')}</summary>`,
  '',
  ...evidence.files.flatMap((file) => {
    const alt = file.replace(/[[\]\\]/g, String.raw`\$&`)
    return [`![${alt}](${blobUrl(evidence, file)}?raw=true)`, '']
  }),
  '</details>',
  '',
  BLOCK_END,
]

const openLines = (lines: string[]): { text: string; index: number }[] => {
  let fence: string | undefined
  return lines.flatMap((raw, index) => {
    const text = raw.replace(/\r?\n$/, '')
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text)
    const [, run = '', info = ''] = marker ?? []
    if (fence !== undefined) {
      if (run.startsWith(fence) && info.trim() === '') fence = undefined
      return []
    }
    if (run !== '' && !(run.startsWith('`') && info.includes('`'))) {
      fence = run
      return []
    }
    return [{ text, index }]
  })
}

const withBlock = (body: string, block: string[]): string => {
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const text = block.join(eol)
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const open = openLines(lines)
  const indexOf = (marker: string, from = 0) =>
    open.find((line) => line.index >= from && line.text.trim() === marker)?.index
  const firstStart = indexOf(BLOCK_START)
  const end = firstStart === undefined ? undefined : indexOf(BLOCK_END, firstStart)
  const start = open.findLast(
    (line) => end !== undefined && line.index < end && line.text.trim() === BLOCK_START,
  )?.index
  if (start !== undefined && end !== undefined) {
    const ending = /\r?\n$/.exec(lines[end] ?? '')?.[0] ?? ''
    return [...lines.slice(0, start), text, ending, ...lines.slice(end + 1)].join('')
  }
  const heading = open.find((line) => /^ {0,3}## +Verification *#* *$/i.test(line.text))?.index
  const before = heading === undefined ? body : lines.slice(0, heading + 1).join('')
  const after = heading === undefined ? '' : lines.slice(heading + 1).join('')
  const gap = (part: string) => (part === '' || part.endsWith('\n') ? '' : eol)
  if (heading === undefined) {
    const separator = body === '' ? '' : `${gap(body)}${eol}`
    return `${before}${separator}## Verification${eol}${eol}${text}${eol}`
  }
  const blank = after === '' || /^\r?\n/.test(after) ? '' : eol
  return `${before}${gap(before)}${eol}${text}${eol}${blank}${after}`
}

type ExecOptions = { input?: string | Buffer; env?: Record<string, string> }

type Exec = (command: [string, ...string[]], next: string, options?: ExecOptions) => Promise<string>

const execIn =
  (repo: string): Exec =>
  async ([bin, ...args], next, { input, env }: ExecOptions = {}) => {
    const pending = promisify(execFile)(bin, args, {
      cwd: repo,
      env: { ...process.env, ...env },
      maxBuffer: MAX_OUTPUT_BYTES,
    })
    if (input !== undefined) pending.child.stdin?.end(input)
    try {
      return (await pending).stdout
    } catch (error) {
      const stderr = field(error, 'stderr')
      const reason = typeof stderr === 'string' && stderr.trim() !== '' ? stderr : String(error)
      throw new Failure(`${bin} ${args.slice(0, 2).join(' ')} failed: ${reason.trim()}`, next)
    }
  }

const GIT_NEXT = 'Check that this checkout is a git repository, then rerun'
const GH_NEXT = 'Check `gh auth status` and the PR number, then rerun publish'
const ORIGIN_NEXT = 'Check that you can push to origin, then rerun publish. It is safe to rerun'

const headOf = async (exec: Exec): Promise<string> =>
  (await exec(['git', 'rev-parse', 'HEAD'], GIT_NEXT)).trim()

export const readSource = async (repo: string): Promise<Source> => {
  const exec = execIn(repo)
  const status = await exec(['git', 'status', '--porcelain', '--untracked-files=normal'], GIT_NEXT)
  return { commit: await headOf(exec), clean: status === '' }
}

export const record = async (
  state: State,
  command: RecordedCommand,
  argv: string[],
  result: { ok: boolean },
): Promise<void> => {
  const { source, app, startedAt, evidenceDir, repo } = state
  const at = new Date().toISOString()
  const entry: Entry = { at, source, app, startedAt, command, argv, ok: result.ok, result }
  await mkdir(evidenceDir, { recursive: true })
  await appendFile(join(evidenceDir, TRANSCRIPT), toLine(entry, repo))
}

const readPullRequest = async (exec: Exec, pr: number, head: string): Promise<PullRequest> => {
  const pullRequest = parsePullRequest(
    await exec(['gh', 'pr', 'view', String(pr), '--json', 'headRefOid,body,url,state'], GH_NEXT),
  )
  const { commit, slug, state, url } = pullRequest
  if (state !== 'OPEN') {
    throw new Failure(`${url} is ${state}, not OPEN`, 'Pass the number of an open PR')
  }
  const origin = (await exec(['git', 'remote', 'get-url', '--push', 'origin'], GIT_NEXT)).trim()
  if (slugOfRemote(origin)?.toLowerCase() !== slug.toLowerCase()) {
    throw new Failure(
      `origin does not push to ${slug}, the repository of ${url}`,
      `Point origin at https://github.com/${slug}, or run publish from a checkout of it`,
    )
  }
  if (commit !== head) {
    throw new Failure(
      `the head of ${url} is ${commit}, but HEAD here is ${head}`,
      'Push HEAD to the PR branch, or check out the head of the PR and verify that commit',
    )
  }
  return pullRequest
}

const readEntries = async (evidenceDir: string): Promise<Entry[]> => {
  const text = await readFile(join(evidenceDir, TRANSCRIPT), 'utf8').catch(() => '')
  return text.split('\n').flatMap((line) => parseEntry(line) ?? [])
}

const readCapture = async (evidenceDir: string, { file, sha256 }: Capture): Promise<Buffer> => {
  const path = join(evidenceDir, file)
  const png = await readFile(path).catch(() => undefined)
  if (png === undefined || createHash('sha256').update(png).digest('hex') !== sha256) {
    throw new Failure(
      `${path} is ${png === undefined ? 'missing' : 'not the file the screenshot command wrote'}`,
      `Take it again on this commit: screenshot ${file}`,
    )
  }
  return png
}

const evidenceTree = async (exec: Exec, files: Map<string, string | Buffer>): Promise<string> => {
  const scratch = await mkdtemp(join(tmpdir(), 'oct-verify-index-'))
  try {
    const env = { GIT_INDEX_FILE: join(scratch, 'index') }
    const rows: string[] = []
    for (const [file, input] of files) {
      const blob = await exec(['git', 'hash-object', '-w', '--stdin'], GIT_NEXT, { input })
      rows.push(`100644 ${blob.trim()}\t${file}\0`)
    }
    const input = rows.join('')
    await exec(['git', 'update-index', '-z', '--index-info'], GIT_NEXT, { input, env })
    return (await exec(['git', 'write-tree'], GIT_NEXT, { env })).trim()
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

const pushEvidence = async (
  exec: Exec,
  branch: string,
  commit: string,
  files: Map<string, string | Buffer>,
): Promise<string> => {
  const ref = `refs/heads/${branch}`
  const listed = await exec(['git', 'ls-remote', 'origin', ref], ORIGIN_NEXT)
  const tip = listed.split('\t')[0]?.trim() ?? ''
  let kept: string[] = []
  if (tip !== '') {
    await exec(
      ['git', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--refmap=', 'origin', ref],
      ORIGIN_NEXT,
    )
    const directory = directoryOf(commit)
    kept = (await exec(['git', 'ls-tree', '-z', tip], GIT_NEXT))
      .split('\0')
      .filter((row) => row !== '' && row.split('\t')[1] !== directory)
  }
  const subtree = `040000 tree ${await evidenceTree(exec, files)}\t${directoryOf(commit)}`
  const input = [...kept, subtree].map((row) => `${row}\0`).join('')
  const tree = (await exec(['git', 'mktree', '-z'], GIT_NEXT, { input })).trim()
  if (tip !== '') {
    const tipTree = await exec(['git', 'rev-parse', `${tip}^{tree}`], GIT_NEXT)
    if (tipTree.trim() === tree) return tip
  }
  const parents = tip === '' ? [] : ['-p', tip]
  const message = `Verification evidence for ${commit}`
  const evidenceCommit = (
    await exec(['git', 'commit-tree', tree, ...parents, '-m', message], GIT_NEXT)
  ).trim()
  await exec(
    ['git', 'push', '--quiet', '--no-follow-tags', 'origin', `${evidenceCommit}:${ref}`],
    ORIGIN_NEXT,
  )
  return evidenceCommit
}

const editBody = async (
  exec: Exec,
  pr: number,
  { body, slug }: PullRequest,
  block: string[],
): Promise<boolean> => {
  const updated = withBlock(body, block)
  if (updated === body) return false
  const scratch = await mkdtemp(join(tmpdir(), 'oct-verify-body-'))
  try {
    const file = join(scratch, 'body.md')
    await writeFile(file, updated)
    await exec(['gh', 'pr', 'edit', String(pr), '-R', slug, '--body-file', file], GH_NEXT)
    return true
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

export const publish = async (repo: string, evidenceDir: string, pr: number) => {
  const exec = execIn(repo)
  const commit = await headOf(exec)
  const pullRequest = await readPullRequest(exec, pr, commit)
  const recorded = await readEntries(evidenceDir)
  const entries = provingEntries(recorded, commit)
  const files = new Map<string, string | Buffer>()
  for (const capture of latestCaptures(entries)) {
    files.set(capture.file, await readCapture(evidenceDir, capture))
  }
  const screenshots = [...files.keys()]
  files.set(TRANSCRIPT, entries.map((entry) => toLine(entry, repo)).join(''))

  const evidenceBranch = `evidence/pr-${pr}`
  const evidenceCommit = await pushEvidence(exec, evidenceBranch, commit, files)
  const { slug, url } = pullRequest
  const evidence: Evidence = { slug, commit, evidenceCommit, entries, files: screenshots }
  const bodyUpdated = await editBody(exec, pr, pullRequest, proofBlock(evidence))
  return {
    ok: true,
    commit,
    evidenceBranch,
    evidenceCommit,
    screenshots,
    transcript: {
      published: entries.length,
      failed: entries.filter((entry) => !entry.ok).length,
      ignored: recorded.length - entries.length,
    },
    bodyUpdated,
    prUrl: url,
  }
}
