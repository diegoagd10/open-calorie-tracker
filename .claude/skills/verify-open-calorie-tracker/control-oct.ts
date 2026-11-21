#!/usr/bin/env -S node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
import { execFile, spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { TIME_ZONE } from '../../../apps/web/test/browser.ts'
import { api, click, goto, login, playwright, press, screenshot, snapshot, type } from './drive.ts'
import {
  COMMANDS,
  Failure,
  field,
  isCommandName,
  newState,
  parseRequest,
  parseState,
  readState,
  writeState,
} from './model.ts'
import type {
  Check,
  Instance,
  ProcessIdentity,
  ProcessName,
  ProcessRecord,
  Request,
  State,
} from './model.ts'

const repo = dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)))
const apiDir = join(repo, 'apps/api')
const webDir = join(repo, 'apps/web')
const READY_TIMEOUT_MS = 60_000

type Argv = [string, ...string[]]
type Session = { name: string; sid: number; pids: number[] }

const print = (value: unknown): void => console.log(JSON.stringify(value, null, 2))

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// oxlint-disable-next-line local/no-comments
// /proc/<pid>/stat fields after the command name: state, ppid, pgrp, session, ... starttime.
const procStat = (pid: number): ProcessIdentity | undefined => {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ')
    if (fields === undefined) return undefined
    return { sid: Number(fields[3]), startTime: fields[19] }
  } catch {
    return undefined
  }
}

// oxlint-disable-next-line local/no-comments
// Each process up starts leads its own session, and pnpm moves scripts into process groups of
// their own, so the session, not the group, holds everything one start owns. A session id is not
// reused while any member lives; a live leader with another start time means the id was reused.
const members = ({ sid, startTime }: ProcessIdentity): number[] => {
  const leader = procStat(sid)
  if (leader !== undefined && leader.startTime !== startTime) return []
  return readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .filter((pid) => procStat(pid)?.sid === sid)
}

const signal = (pids: number[], name: NodeJS.Signals): void => {
  for (const pid of pids) {
    try {
      process.kill(pid, name)
    } catch {}
  }
}

const listeners = async (port: number): Promise<number[]> => {
  const { stdout } = await promisify(execFile)('ss', ['-ltnpH', `sport = :${port}`])
  return [...stdout.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]))
}

const portsInUse = async (instance: Instance): Promise<{ port: number; pids: number[] }[]> => {
  const used: { port: number; pids: number[] }[] = []
  for (const port of Object.values(instance.ports)) {
    const output = await promisify(execFile)('ss', ['-ltnH', `sport = :${port}`])
    if (output.stdout.trim() !== '') used.push({ port, pids: await listeners(port) })
  }
  return used
}

const fetchWithin = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, { ...init, signal: AbortSignal.timeout(5_000) })

const check = async (
  name: string,
  next: string,
  probe: () => Promise<string | void> | string | void,
): Promise<Check> => {
  try {
    const detail = await probe()
    return { name, ok: true, ...(detail === undefined ? {} : { detail }) }
  } catch (error) {
    return { name, ok: false, detail: messageOf(error), next }
  }
}

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const diagnose = async (state: State): Promise<Check[]> => {
  const { basePort } = state
  const restart = `Run up --base-port ${basePort}, which replaces a broken instance`
  const checks: Check[] = []
  for (const [name, proc] of Object.entries(state.processes)) {
    checks.push(
      await check(`process:${name}`, `Read ${proc.log}, then: ${restart}`, () =>
        expect(members(proc).length > 0, `session ${proc.sid} has no processes left`),
      ),
      await check(
        `port:${name}`,
        `${restart}; if a foreign pid holds ${proc.port}, pass another --base-port`,
        async () => {
          const pids = await listeners(proc.port)
          expect(pids.length > 0, `nothing listens on ${proc.port}`)
          const foreign = pids.filter((pid) => procStat(pid)?.sid !== proc.sid)
          expect(foreign.length === 0, `port ${proc.port} is held by pid ${foreign.join(', ')}`)
          return `pid ${pids.join(', ')}`
        },
      ),
    )
  }
  checks.push(
    await check('api', `Read ${state.processes.api.log}, then: ${restart}`, async () => {
      const response = await fetchWithin(`${state.apiUrl}/v1/setup`)
      expect(response.ok, `GET /v1/setup answered ${response.status}`)
      const needsSetup = field(await response.json(), 'needsSetup')
      expect(needsSetup === false, 'the API has no users, so the seed did not run')
    }),
    await check('web', `Read ${state.processes.web.log}, then: ${restart}`, async () => {
      const response = await fetchWithin(`${state.webUrl}/login`)
      expect(response.ok, `GET /login answered ${response.status}`)
    }),
    await check('login', `${restart}; it reseeds the user`, async () => {
      const response = await fetchWithin(`${state.apiUrl}/v1/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state.seedUser),
      })
      expect(response.ok, `POST /v1/login answered ${response.status}`)
      const accessToken = field(await response.json(), 'accessToken')
      expect(typeof accessToken === 'string', 'the login response has no accessToken')
    }),
    await check('browser', `Read ${state.processes.browser.log}, then: ${restart}`, async () => {
      const response = await fetchWithin(`${state.cdpUrl}/json/version`)
      expect(response.ok, `GET /json/version answered ${response.status}`)
      const browser = field(await response.json(), 'Browser')
      return typeof browser === 'string' ? browser : undefined
    }),
  )
  return checks
}

const stop = async (state: State, dryRun: boolean): Promise<Session[]> => {
  const sessions = Object.entries(state.processes).map(([name, proc]) => ({
    name,
    sid: proc.sid,
    pids: members(proc),
  }))
  if (!dryRun) {
    const remaining = () => Object.values(state.processes).flatMap((proc) => members(proc))
    signal(remaining(), 'SIGTERM')
    const deadline = Date.now() + 10_000
    while (remaining().length > 0 && Date.now() < deadline) await sleep(200)
    signal(remaining(), 'SIGKILL')
  }
  return sessions.filter((session) => session.pids.length > 0)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const run = async (
  command: Argv,
  cwd: string,
  env: Record<string, string>,
  log: string,
): Promise<void> => {
  const [bin, ...args] = command
  const out = openSync(log, 'a')
  const child = spawn(bin, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', out, out],
  })
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve))
  if (code !== 0) {
    const tail = readFileSync(log, 'utf8').trim().split('\n').slice(-15).join('\n')
    throw new Failure(
      `${command.join(' ')} exited with ${code} in ${cwd}:\n${tail}`,
      `Read ${log}. If next build failed on a lock, stop \`pnpm dev:web\` and the web tests in this checkout, then rerun up`,
    )
  }
}

const start = (
  name: ProcessName,
  command: Argv,
  cwd: string,
  env: Record<string, string>,
  port: number,
  logsDir: string,
): ProcessRecord => {
  const [bin, ...args] = command
  const log = join(logsDir, `${name}.log`)
  const out = openSync(log, 'a')
  const child = spawn(bin, args, {
    cwd,
    detached: true,
    env: { ...process.env, ...env },
    stdio: ['ignore', out, out],
  })
  child.unref()
  if (child.pid === undefined) {
    throw new Failure(`${command.join(' ')} did not start`, `Read ${log}, then rerun up`)
  }
  return { sid: child.pid, startTime: procStat(child.pid)?.startTime, port, log }
}

const waitUntil = async (url: string, proc: ProcessRecord): Promise<void> => {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    expect(members(proc).length > 0, `the process for ${url} exited; see ${proc.log}`)
    try {
      if ((await fetchWithin(url)).ok) return
    } catch {}
    await sleep(250)
  }
  throw new Error(`${url} did not answer within ${READY_TIMEOUT_MS}ms; see ${proc.log}`)
}

const otherInstances = (instance: Instance): State[] =>
  readdirSync(tmpdir())
    .filter((name) => /^oct-verify-\d+$/.test(name))
    .map((name) => join(tmpdir(), name, 'state.json'))
    .filter((file) => file !== instance.stateFile)
    .filter((file) => existsSync(file))
    .flatMap((file) => parseState(readFileSync(file, 'utf8')) ?? [])
    .filter((state) => state.repo === repo)

const up = async (instance: Instance) => {
  const { basePort, ports, urls, dataDir, evidenceDir } = instance
  let replaced: { stale: true; failed: string[] } | undefined
  const previous = await readState(instance)
  if (previous !== undefined && previous.repo !== repo) {
    throw new Failure(
      `base port ${basePort} belongs to an instance of ${previous.repo}`,
      `Pass another --base-port, or run down from that checkout`,
    )
  }
  if (previous !== undefined) {
    const checks = await diagnose(previous)
    if (checks.every((c) => c.ok)) return { ok: true, status: 'already-up', ...previous }
    replaced = { stale: true, failed: checks.filter((c) => !c.ok).map((c) => c.name) }
    await stop(previous, false)
  }

  const sibling = otherInstances(instance)[0]
  if (sibling !== undefined) {
    throw new Failure(
      `this checkout already runs an instance on base port ${sibling.basePort}, and both would share apps/web/.next and apps/api/dist`,
      `Use that instance, or run down --base-port ${sibling.basePort} first, or run up from another worktree`,
    )
  }
  if (!existsSync(join(webDir, 'node_modules/next'))) {
    throw new Failure('dependencies are not installed', `Run pnpm install in ${repo}`)
  }
  const { chromium } = playwright(repo)
  if (!existsSync(chromium.executablePath())) {
    throw new Failure(
      `Chromium is missing at ${chromium.executablePath()}`,
      'Run pnpm --filter web exec playwright install chromium',
    )
  }
  const busy = await portsInUse(instance)
  if (busy.length > 0) {
    const held = busy.map((b) => `${b.port} (pid ${b.pids.join(', ') || 'unknown'})`).join(', ')
    throw new Failure(
      `ports ${held} are in use by processes this tool did not start`,
      `Pass another --base-port, e.g. --base-port ${basePort + 10}`,
    )
  }

  const { SEED_USER, JWT, API_KEY_SECRET } = await import('../../../apps/web/test/fixtures.ts')
  const logsDir = join(dataDir, 'logs')
  await rm(dataDir, { recursive: true, force: true })
  await mkdir(logsDir, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })
  const databaseUrl = `file:${join(dataDir, 'db.sqlite')}`
  const jwtEnv = { JWT_SECRET: JWT.secret, JWT_ISSUER: JWT.issuer, JWT_AUDIENCE: JWT.audience }
  const buildLog = join(logsDir, 'build.log')

  await run(['pnpm', '--filter', '@open-calorie-tracker/shared', 'build'], repo, {}, buildLog)
  await Promise.all([
    run(
      ['pnpm', 'db:seed'],
      apiDir,
      {
        DATABASE_URL: databaseUrl,
        SEED_USER_USERNAME: SEED_USER.username,
        SEED_USER_PASSWORD: SEED_USER.password,
      },
      join(logsDir, 'seed.log'),
    ),
    run(['pnpm', 'exec', 'next', 'build'], webDir, {}, buildLog),
  ])

  const state = newState(instance, {
    repo,
    seedUser: SEED_USER,
    processes: {
      api: start(
        'api',
        ['pnpm', 'start:prod'],
        apiDir,
        {
          PORT: String(ports.api),
          DATABASE_URL: databaseUrl,
          TRUST_PROXY: 'loopback',
          API_KEY_SECRET,
          OPEN_FOOD_FACTS_USER_AGENT: 'OpenCalorieTracker/verify (https://example.test)',
          ...jwtEnv,
        },
        ports.api,
        logsDir,
      ),
      web: start(
        'web',
        ['pnpm', 'exec', 'next', 'start', '--port', String(ports.web)],
        webDir,
        {
          API_URL: urls.api,
          ...jwtEnv,
        },
        ports.web,
        logsDir,
      ),
      browser: start(
        'browser',
        [
          chromium.executablePath(),
          '--headless=new',
          `--remote-debugging-port=${ports.cdp}`,
          '--remote-debugging-address=127.0.0.1',
          `--user-data-dir=${join(dataDir, 'chromium-profile')}`,
          '--lang=en-US',
          '--hide-scrollbars',
          '--no-first-run',
          '--no-default-browser-check',
          'about:blank',
        ],
        repo,
        { TZ: TIME_ZONE },
        ports.cdp,
        logsDir,
      ),
    },
  })
  await writeState(state)

  try {
    await Promise.all([
      waitUntil(`${state.apiUrl}/v1/setup`, state.processes.api),
      waitUntil(`${state.webUrl}/login`, state.processes.web),
      waitUntil(`${state.cdpUrl}/json/version`, state.processes.browser),
    ])
    const failed = (await diagnose(state)).filter((c) => !c.ok)
    expect(failed.length === 0, `doctor failed after start: ${JSON.stringify(failed)}`)
  } catch (error) {
    await stop(state, false)
    await rm(instance.stateFile, { force: true })
    throw new Failure(
      `up failed, so it stopped what it started: ${messageOf(error)}`,
      `Read the logs in ${logsDir}, fix the cause, then rerun up`,
    )
  }
  return { ok: true, status: 'started', ...(replaced ? { replaced } : {}), ...state }
}

const doctor = async (instance: Instance) => {
  const { basePort, stateFile } = instance
  const state = await readState(instance)
  if (state === undefined) {
    return {
      ok: false,
      basePort,
      checks: [{ name: 'state', ok: false, detail: `no ${stateFile}` }],
      next: `Run up --base-port ${basePort}`,
    }
  }
  const checks = await diagnose(state)
  const failed = checks.find((c) => !c.ok)
  return { ok: failed === undefined, basePort, checks, ...(failed ? { next: failed.next } : {}) }
}

const down = async (instance: Instance, dryRun: boolean) => {
  const { basePort, dataDir, evidenceDir } = instance
  const state = await readState(instance)
  const sessions = state === undefined ? [] : await stop(state, dryRun)
  const removed = existsSync(dataDir) ? [dataDir] : []
  if (!dryRun) await rm(dataDir, { recursive: true, force: true })
  return {
    ok: true,
    dryRun,
    basePort,
    [dryRun ? 'wouldStop' : 'stopped']: sessions,
    [dryRun ? 'wouldRemove' : 'removed']: removed,
    kept: evidenceDir,
  }
}

const handle = (request: Request) => {
  const { instance } = request
  switch (request.command) {
    case 'up':
      return up(instance)
    case 'doctor':
      return doctor(instance)
    case 'down':
      return down(instance, request.dryRun)
    case 'login':
      return login(instance, repo, request)
    case 'goto':
      return goto(instance, repo, request.path)
    case 'snapshot':
      return snapshot(instance, repo)
    case 'click':
      return click(instance, repo, request.target)
    case 'type':
      return type(instance, repo, request.target, request.text)
    case 'press':
      return press(instance, repo, request.key)
    case 'screenshot':
      return screenshot(instance, repo, request.path, request.mobile)
    case 'api':
      return api(instance, repo, request.method, request.path, request.body)
  }
}

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2)
  if (command === undefined || command === '--help') {
    return print({ ok: true, usage: 'control-oct.ts <command> [--help]', commands: COMMANDS })
  }
  if (!isCommandName(command)) {
    throw new Failure(
      `unknown command "${command}"`,
      `Use one of: ${Object.keys(COMMANDS).join(', ')}`,
    )
  }
  const request = parseRequest(command, rest)
  if (request === undefined) return print({ ok: true, ...COMMANDS[command] })
  const result = await handle(request)
  print(result)
  if (!result.ok) process.exitCode = 1
}

main().catch((error: unknown) => {
  print({
    ok: false,
    error: messageOf(error),
    next: error instanceof Failure ? error.next : 'Rerun with --help for usage',
    ...(error instanceof Failure ? error.details : {}),
  })
  process.exitCode = 1
})
