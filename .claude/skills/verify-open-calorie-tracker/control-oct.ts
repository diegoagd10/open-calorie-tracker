#!/usr/bin/env -S node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, openSync, readFileSync, readdirSync } from 'node:fs'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { TIME_ZONE } from '../../../apps/web/test/browser.ts'
import { API_KEY_SECRET, JWT, SEED_USER } from '../../../apps/web/test/fixtures.ts'
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
  App,
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
const DOCKER_WAIT_S = 300
const OPEN_FOOD_FACTS_USER_AGENT = 'OpenCalorieTracker/verify (https://example.test)'

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

const restartOf = (state: Pick<State, 'app' | 'webUrl'>): string =>
  `Run up${state.app === 'docker' ? ' --docker' : ''} --url ${state.webUrl}, which replaces a broken instance`

const logOf = (state: State, name: ProcessName, instance: Instance): string =>
  state.processes[name]?.log ??
  `docker compose -p ${instance.project} logs ${name} (or ${join(state.dataDir, 'logs')})`

const diagnose = async (state: State, instance: Instance): Promise<Check[]> => {
  const restart = restartOf(state)
  const checks: Check[] = []
  if (state.app === 'docker') {
    checks.push(
      await check(
        'containers',
        `Run docker compose -p ${instance.project} ps -a, then: ${restart}`,
        async () => {
          const containers = await composeContainers(instance)
          const unhealthy = ['api', 'web'].filter(
            (name) =>
              !containers.some(
                (c) => c.Service === name && c.State === 'running' && c.Health === 'healthy',
              ),
          )
          expect(unhealthy.length === 0, `not running and healthy: ${unhealthy.join(', ')}`)
          return containers.map((c) => `${c.Service} ${c.Health}`).join(', ')
        },
      ),
    )
  }
  for (const [name, proc] of Object.entries(state.processes)) {
    checks.push(
      await check(`process:${name}`, `Read ${proc.log}, then: ${restart}`, () =>
        expect(members(proc).length > 0, `session ${proc.sid} has no processes left`),
      ),
      await check(
        `port:${name}`,
        `${restart}; if a foreign pid holds ${proc.port}, pass another --url`,
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
    await check('api', `Read ${logOf(state, 'api', instance)}, then: ${restart}`, async () => {
      const response = await fetchWithin(`${state.apiUrl}/v1/setup`)
      expect(response.ok, `GET /v1/setup answered ${response.status}`)
      const needsSetup = field(await response.json(), 'needsSetup')
      expect(needsSetup === false, 'the API has no users, so the seed did not run')
    }),
    await check('web', `Read ${logOf(state, 'web', instance)}, then: ${restart}`, async () => {
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
    await check(
      'browser',
      `Read ${logOf(state, 'browser', instance)}, then: ${restart}`,
      async () => {
        const response = await fetchWithin(`${state.cdpUrl}/json/version`)
        expect(response.ok, `GET /json/version answered ${response.status}`)
        const browser = field(await response.json(), 'Browser')
        return typeof browser === 'string' ? browser : undefined
      },
    ),
  )
  return checks
}

const stop = async (state: State, dryRun: boolean): Promise<Session[]> => {
  const records = Object.values(state.processes)
  const sessions = Object.entries(state.processes).map(([name, proc]) => ({
    name,
    sid: proc.sid,
    pids: members(proc),
  }))
  if (!dryRun) {
    const remaining = () => records.flatMap((proc) => members(proc))
    signal(remaining(), 'SIGTERM')
    const deadline = Date.now() + 10_000
    while (remaining().length > 0 && Date.now() < deadline) await sleep(200)
    signal(remaining(), 'SIGKILL')
  }
  return sessions.filter((session) => session.pids.length > 0)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const BUILD_NEXT =
  'If next build failed on a lock, stop `pnpm dev:web` and the web tests in this checkout, then rerun up'

const run = async (
  command: Argv,
  cwd: string,
  env: Record<string, string>,
  log: string,
  next = BUILD_NEXT,
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
      `Read ${log}. ${next}`,
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

const localSiblings = (instance: Instance): State[] =>
  readdirSync(tmpdir())
    .filter((name) => /^oct-verify-\d+$/.test(name))
    .map((name) => join(tmpdir(), name, 'state.json'))
    .filter((file) => file !== instance.stateFile)
    .filter((file) => existsSync(file))
    .flatMap((file) => parseState(readFileSync(file, 'utf8')) ?? [])
    .filter((state) => state.repo === repo && state.app === 'local')

type Container = { Service: string; State: string; Health: string }

const composeEnv = (instance: Instance): Record<string, string> => ({
  COMPOSE_PROJECT_NAME: instance.project,
  DATA_PATH: join(instance.dataDir, 'db'),
  WEB_HOST_PORT: String(instance.ports.web),
  API_HOST_PORT: String(instance.ports.api),
  WEB_BIND: '127.0.0.1',
  API_BIND: '127.0.0.1',
  JWT_SECRET: process.env['JWT_SECRET'] ?? randomBytes(32).toString('hex'),
  API_KEY_SECRET: process.env['API_KEY_SECRET'] ?? randomBytes(32).toString('hex'),
  OPEN_FOOD_FACTS_USER_AGENT:
    process.env['OPEN_FOOD_FACTS_USER_AGENT'] ?? OPEN_FOOD_FACTS_USER_AGENT,
  SEED_USER_USERNAME: SEED_USER.username,
  SEED_USER_PASSWORD: SEED_USER.password,
})

const compose = (...args: string[]): Argv => [
  'docker',
  'compose',
  '-f',
  join(repo, 'docker-compose.yml'),
  '-f',
  join(repo, 'docker-compose.verify.yml'),
  ...args,
]

const composeContainers = async (instance: Instance): Promise<Container[]> => {
  const [bin, ...args] = compose('ps', '-a', '--format', 'json')
  const { stdout } = await promisify(execFile)(bin, args, {
    cwd: repo,
    env: { ...process.env, ...composeEnv(instance) },
  })
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const value: unknown = JSON.parse(line)
      return {
        Service: String(field(value, 'Service')),
        State: String(field(value, 'State')),
        Health: String(field(value, 'Health')),
      }
    })
}

const DOCKER_NEXT =
  'Start the Docker daemon (systemctl start docker) and check that `docker compose version` and `docker ps` work for your user'

const requireDocker = async (): Promise<void> => {
  try {
    await promisify(execFile)('docker', ['compose', 'version'])
    await promisify(execFile)('docker', ['info', '--format', '{{.ServerVersion}}'])
  } catch (error) {
    throw new Failure(`Docker is not usable: ${messageOf(error).split('\n')[0]}`, DOCKER_NEXT)
  }
}

const dockerProjectExists = async (instance: Instance): Promise<boolean> => {
  try {
    return (await composeContainers(instance)).length > 0
  } catch {
    return false
  }
}

const composeDown = (instance: Instance, log: string): Promise<void> =>
  run(compose('down', '-v', '--remove-orphans'), repo, composeEnv(instance), log, DOCKER_NEXT)

const dockerAppUp = async (instance: Instance, logsDir: string): Promise<void> => {
  const env = composeEnv(instance)
  const dbDir = env['DATA_PATH'] ?? join(instance.dataDir, 'db')
  await mkdir(dbDir, { recursive: true })
  await chmod(dbDir, 0o777)
  const log = join(logsDir, 'docker.log')
  await composeDown(instance, log)
  await run(
    compose('up', '-d', '--build', '--wait', '--wait-timeout', String(DOCKER_WAIT_S)),
    repo,
    env,
    log,
    `The build or a healthcheck failed. Run docker compose -p ${instance.project} logs api web, fix the cause, then rerun up --docker --url ${instance.urls.web}`,
  )
  await run(
    compose('run', '--rm', '-T', 'seed'),
    repo,
    env,
    join(logsDir, 'seed.log'),
    `The seed failed inside the api image. Fix it, then rerun up --docker --url ${instance.urls.web}`,
  )
}

const startBrowser = (
  instance: Instance,
  chromium: { executablePath: () => string },
  logsDir: string,
): ProcessRecord =>
  start(
    'browser',
    [
      chromium.executablePath(),
      '--headless=new',
      `--remote-debugging-port=${instance.ports.cdp}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${join(instance.dataDir, 'chromium-profile')}`,
      '--lang=en-US',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    repo,
    { TZ: TIME_ZONE },
    instance.ports.cdp,
    logsDir,
  )

const stopInstance = async (state: State, instance: Instance, log: string): Promise<void> => {
  await stop(state, false)
  if (state.app === 'docker') await composeDown(instance, log)
}

const up = async (instance: Instance, app: App) => {
  const { urls, dataDir, evidenceDir } = instance
  const docker = app === 'docker'
  let replaced: { stale: true; failed: string[] } | undefined
  const previous = await readState(instance)
  if (previous !== undefined && previous.repo !== repo) {
    throw new Failure(
      `${urls.web} belongs to an instance of ${previous.repo}`,
      `Pass another --url, or run down from that checkout`,
    )
  }
  if (docker) await requireDocker()
  if (previous !== undefined) {
    const checks = await diagnose(previous, instance)
    if (previous.app === app && checks.every((c) => c.ok)) {
      return { ok: true, status: 'already-up', ...previous }
    }
    replaced = {
      stale: true,
      failed: previous.app === app ? checks.filter((c) => !c.ok).map((c) => c.name) : ['app'],
    }
    await stopInstance(previous, instance, join(tmpdir(), `${instance.project}-down.log`))
  }

  const sibling = docker ? undefined : localSiblings(instance)[0]
  if (sibling !== undefined) {
    throw new Failure(
      `this checkout already runs a local instance on ${sibling.webUrl}, and both would share apps/web/.next and apps/api/dist`,
      `Use that instance, or run down --url ${sibling.webUrl} first, run up --docker, or run up from another worktree`,
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
  if (docker && (await dockerProjectExists(instance))) {
    await composeDown(instance, join(tmpdir(), `${instance.project}-down.log`))
  }
  const busy = await portsInUse(instance)
  if (busy.length > 0) {
    const held = busy.map((b) => `${b.port} (pid ${b.pids.join(', ') || 'unknown'})`).join(', ')
    throw new Failure(
      `ports ${held} are in use by processes this tool did not start`,
      `Stop what holds them (pnpm dev:web and dev:api use 3000 and 3001), or pass another --url, e.g. --url http://localhost:${instance.webPort + 10}`,
    )
  }

  const logsDir = join(dataDir, 'logs')
  await rm(dataDir, { recursive: true, force: true })
  await mkdir(logsDir, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })

  let processes: State['processes']
  try {
    if (docker) {
      await dockerAppUp(instance, logsDir)
      processes = { browser: startBrowser(instance, chromium, logsDir) }
    } else {
      processes = await localAppUp(instance, logsDir, chromium)
    }
  } catch (error) {
    if (docker) await composeDown(instance, join(logsDir, 'docker.log')).catch(() => {})
    throw error
  }
  const state = newState(instance, { app, repo, seedUser: SEED_USER, processes })
  await writeState(state)

  try {
    const { api, web, browser } = processes
    await Promise.all([
      api ? waitUntil(`${state.apiUrl}/v1/setup`, api) : undefined,
      web ? waitUntil(`${state.webUrl}/login`, web) : undefined,
      browser ? waitUntil(`${state.cdpUrl}/json/version`, browser) : undefined,
    ])
    const failed = (await diagnose(state, instance)).filter((c) => !c.ok)
    expect(failed.length === 0, `doctor failed after start: ${JSON.stringify(failed)}`)
  } catch (error) {
    await stopInstance(state, instance, join(logsDir, 'docker.log'))
    await rm(instance.stateFile, { force: true })
    throw new Failure(
      `up failed, so it stopped what it started: ${messageOf(error)}`,
      `Read the logs in ${logsDir}, fix the cause, then rerun up`,
    )
  }
  return { ok: true, status: 'started', ...(replaced ? { replaced } : {}), ...state }
}

const localAppUp = async (
  instance: Instance,
  logsDir: string,
  chromium: { executablePath: () => string },
): Promise<State['processes']> => {
  const { ports, urls, dataDir } = instance
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

  return {
    api: start(
      'api',
      ['pnpm', 'start:prod'],
      apiDir,
      {
        PORT: String(ports.api),
        DATABASE_URL: databaseUrl,
        TRUST_PROXY: 'loopback',
        API_KEY_SECRET,
        OPEN_FOOD_FACTS_USER_AGENT,
        ...jwtEnv,
      },
      ports.api,
      logsDir,
    ),
    web: start(
      'web',
      ['pnpm', 'exec', 'next', 'start', '--port', String(ports.web)],
      webDir,
      { API_URL: urls.api, ...jwtEnv },
      ports.web,
      logsDir,
    ),
    browser: startBrowser(instance, chromium, logsDir),
  }
}

const doctor = async (instance: Instance) => {
  const { stateFile, urls } = instance
  const state = await readState(instance)
  if (state === undefined) {
    return {
      ok: false,
      webUrl: urls.web,
      checks: [{ name: 'state', ok: false, detail: `no ${stateFile}` }],
      next: `Run up --url ${urls.web}, or up --docker --url ${urls.web}`,
    }
  }
  const checks = await diagnose(state, instance)
  const failed = checks.find((c) => !c.ok)
  return {
    ok: failed === undefined,
    app: state.app,
    webUrl: state.webUrl,
    apiUrl: state.apiUrl,
    evidenceDir: state.evidenceDir,
    checks,
    ...(failed ? { next: failed.next } : {}),
  }
}

const down = async (instance: Instance, dryRun: boolean) => {
  const { dataDir, evidenceDir, urls, project } = instance
  const state = await readState(instance)
  const sessions = state === undefined ? [] : await stop(state, dryRun)
  const containers =
    state?.app === 'docker' || (await dockerProjectExists(instance))
      ? (await composeContainers(instance).catch(() => [])).map((c) => c.Service)
      : []
  if (!dryRun && containers.length > 0) {
    await composeDown(instance, join(tmpdir(), `${project}-down.log`))
  }
  const removed = existsSync(dataDir) ? [dataDir] : []
  if (!dryRun) await rm(dataDir, { recursive: true, force: true })
  return {
    ok: true,
    dryRun,
    webUrl: urls.web,
    [dryRun ? 'wouldStop' : 'stopped']: sessions,
    ...(containers.length > 0
      ? { [dryRun ? 'wouldRemoveContainers' : 'removedContainers']: { project, containers } }
      : {}),
    [dryRun ? 'wouldRemove' : 'removed']: removed,
    kept: evidenceDir,
  }
}

const reset = async (instance: Instance) => {
  const state = await readState(instance)
  if (state === undefined) {
    throw new Failure(
      `no instance runs for ${instance.urls.web}`,
      `Run up --url ${instance.urls.web}`,
    )
  }
  const log = join(state.dataDir, 'logs', 'reset.log')
  const next = `Run doctor --url ${state.webUrl}`
  if (state.app === 'docker') {
    await run(
      compose('run', '--rm', '-T', 'seed', 'node', 'dist/reset'),
      repo,
      composeEnv(instance),
      log,
      next,
    )
  } else {
    const env = { DATABASE_URL: `file:${join(state.dataDir, 'db.sqlite')}` }
    await run(['node', 'dist/reset.js'], apiDir, env, log, next)
  }
  return { ok: true, app: state.app, reset: readFileSync(log, 'utf8').trim().split('\n').at(-1) }
}

const handle = (request: Request) => {
  const { instance } = request
  switch (request.command) {
    case 'up':
      return up(instance, request.docker ? 'docker' : 'local')
    case 'doctor':
      return doctor(instance)
    case 'down':
      return down(instance, request.dryRun)
    case 'reset':
      return reset(instance)
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
