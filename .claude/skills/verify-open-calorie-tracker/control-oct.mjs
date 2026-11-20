#!/usr/bin/env -S node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
import { execFile, spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const repo = dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)))
const apiDir = join(repo, 'apps/api')
const webDir = join(repo, 'apps/web')
const DEFAULT_BASE_PORT = 3300
const READY_TIMEOUT_MS = 60_000

const COMMANDS = {
  up: {
    usage: 'control-oct.mjs up [--base-port N]',
    summary:
      'Builds the app, starts a seeded API, the web app and a headless Chromium on N, N+1 and N+2, and waits until they are usable. Reports and exits 0 when already up and healthy.',
  },
  doctor: {
    usage: 'control-oct.mjs doctor [--base-port N]',
    summary:
      'Read-only. Checks the processes, port ownership, API, web app, seed user login and CDP endpoint of the instance on N.',
  },
  down: {
    usage: 'control-oct.mjs down [--base-port N] [--dry-run]',
    summary:
      'Stops every process in the sessions that up started on N and removes its data dir. Keeps the evidence dir. --dry-run lists what it would do.',
  },
}

const paths = (basePort) => {
  const dataDir = join(tmpdir(), `oct-verify-${basePort}`)
  return {
    dataDir,
    stateFile: join(dataDir, 'state.json'),
    evidenceDir: join(tmpdir(), `oct-verify-${basePort}-evidence`),
  }
}

class Failure extends Error {
  constructor(message, next) {
    super(message)
    this.next = next
  }
}

const print = (value) => console.log(JSON.stringify(value, null, 2))

const parseBasePort = (value) => {
  if (value === undefined) return DEFAULT_BASE_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65_533) {
    throw new Failure(
      `--base-port must be an integer from 1024 to 65533, got "${value}"`,
      'Pass --base-port 3300, or omit it',
    )
  }
  return port
}

const readState = async (basePort) => {
  try {
    return JSON.parse(await readFile(paths(basePort).stateFile, 'utf8'))
  } catch {
    return undefined
  }
}

const writeState = async (state) => {
  const { stateFile } = paths(state.basePort)
  await writeFile(`${stateFile}.tmp`, JSON.stringify(state, null, 2))
  await rename(`${stateFile}.tmp`, stateFile)
}

// /proc/<pid>/stat fields after the command name: state, ppid, pgrp, session, ... starttime.
const procStat = (pid) => {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')
    return { sid: Number(fields[3]), startTime: fields[19] }
  } catch {
    return undefined
  }
}

// Each process up starts leads its own session, and pnpm moves scripts into process groups of
// their own, so the session, not the group, holds everything one start owns. A session id is not
// reused while any member lives; a live leader with another start time means the id was reused.
const members = ({ sid, startTime }) => {
  const leader = procStat(sid)
  if (leader !== undefined && leader.startTime !== startTime) return []
  return readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .filter((pid) => procStat(pid)?.sid === sid)
}

const signal = (pids, name) => {
  for (const pid of pids) {
    try {
      process.kill(pid, name)
    } catch {}
  }
}

const listeners = async (port) => {
  const { stdout } = await promisify(execFile)('ss', ['-ltnpH', `sport = :${port}`])
  return [...stdout.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]))
}

const portsInUse = async (basePort) => {
  const used = []
  for (const port of [basePort, basePort + 1, basePort + 2]) {
    const output = await promisify(execFile)('ss', ['-ltnH', `sport = :${port}`])
    if (output.stdout.trim() !== '') used.push({ port, pids: await listeners(port) })
  }
  return used
}

const fetchWithin = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(5_000) })

const check = async (name, next, probe) => {
  try {
    const detail = await probe()
    return { name, ok: true, ...(detail === undefined ? {} : { detail }) }
  } catch (error) {
    return { name, ok: false, detail: error.message, next }
  }
}

const expect = (condition, message) => {
  if (!condition) throw new Error(message)
}

const diagnose = async (state) => {
  const { basePort } = state
  const restart = `Run up --base-port ${basePort}, which replaces a broken instance`
  const checks = []
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
      const body = await response.json()
      expect(body.needsSetup === false, 'the API has no users, so the seed did not run')
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
      const body = await response.json()
      expect(typeof body.accessToken === 'string', 'the login response has no accessToken')
    }),
    await check('browser', `Read ${state.processes.browser.log}, then: ${restart}`, async () => {
      const response = await fetchWithin(`${state.cdpUrl}/json/version`)
      expect(response.ok, `GET /json/version answered ${response.status}`)
      return (await response.json()).Browser
    }),
  )
  return checks
}

const stop = async (state, dryRun) => {
  const sessions = Object.entries(state.processes).map(([name, proc]) => ({
    name,
    sid: proc.sid,
    pids: members(proc),
  }))
  if (!dryRun) {
    const remaining = () => sessions.flatMap(({ name }) => members(state.processes[name]))
    signal(remaining(), 'SIGTERM')
    const deadline = Date.now() + 10_000
    while (remaining().length > 0 && Date.now() < deadline) await sleep(200)
    signal(remaining(), 'SIGKILL')
  }
  return sessions.filter((session) => session.pids.length > 0)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const run = async (command, cwd, env, log) => {
  const [bin, ...args] = command
  const out = openSync(log, 'a')
  const child = spawn(bin, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', out, out],
  })
  const code = await new Promise((resolve) => child.on('exit', resolve))
  if (code !== 0) {
    const tail = readFileSync(log, 'utf8').trim().split('\n').slice(-15).join('\n')
    throw new Failure(
      `${command.join(' ')} exited with ${code} in ${cwd}:\n${tail}`,
      `Read ${log}. If next build failed on a lock, stop \`pnpm dev:web\` and the web tests in this checkout, then rerun up`,
    )
  }
}

const start = (name, command, cwd, env, port, logsDir) => {
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
  return { sid: child.pid, startTime: procStat(child.pid)?.startTime, port, log }
}

const waitUntil = async (url, proc) => {
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

const otherInstances = (basePort) =>
  readdirSync(tmpdir())
    .filter((name) => /^oct-verify-\d+$/.test(name) && name !== `oct-verify-${basePort}`)
    .map((name) => join(tmpdir(), name, 'state.json'))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')))
    .filter((state) => state.repo === repo)

const up = async (basePort) => {
  const { dataDir, evidenceDir } = paths(basePort)
  let replaced
  const previous = await readState(basePort)
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

  const sibling = otherInstances(basePort)[0]
  if (sibling !== undefined) {
    throw new Failure(
      `this checkout already runs an instance on base port ${sibling.basePort}, and both would share apps/web/.next and apps/api/dist`,
      `Use that instance, or run down --base-port ${sibling.basePort} first, or run up from another worktree`,
    )
  }
  if (!existsSync(join(webDir, 'node_modules/next'))) {
    throw new Failure('dependencies are not installed', `Run pnpm install in ${repo}`)
  }
  const { chromium } = createRequire(join(webDir, 'package.json'))('playwright')
  if (!existsSync(chromium.executablePath())) {
    throw new Failure(
      `Chromium is missing at ${chromium.executablePath()}`,
      'Run pnpm --filter web exec playwright install chromium',
    )
  }
  const busy = await portsInUse(basePort)
  if (busy.length > 0) {
    const held = busy.map((b) => `${b.port} (pid ${b.pids.join(', ') || 'unknown'})`).join(', ')
    throw new Failure(
      `ports ${held} are in use by processes this tool did not start`,
      `Pass another --base-port, e.g. --base-port ${basePort + 10}`,
    )
  }

  const { SEED_USER, JWT, API_KEY_SECRET } = await import(join(webDir, 'test/fixtures.ts'))
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

  const state = {
    basePort,
    repo,
    dataDir,
    evidenceDir,
    webUrl: `http://localhost:${basePort}`,
    apiUrl: `http://localhost:${basePort + 1}`,
    cdpUrl: `http://127.0.0.1:${basePort + 2}`,
    seedUser: SEED_USER,
    startedAt: new Date().toISOString(),
    processes: {
      api: start(
        'api',
        ['pnpm', 'start:prod'],
        apiDir,
        {
          PORT: String(basePort + 1),
          DATABASE_URL: databaseUrl,
          TRUST_PROXY: 'loopback',
          API_KEY_SECRET,
          OPEN_FOOD_FACTS_USER_AGENT: 'OpenCalorieTracker/verify (https://example.test)',
          ...jwtEnv,
        },
        basePort + 1,
        logsDir,
      ),
      web: start(
        'web',
        ['pnpm', 'exec', 'next', 'start', '--port', String(basePort)],
        webDir,
        {
          API_URL: `http://localhost:${basePort + 1}`,
          ...jwtEnv,
        },
        basePort,
        logsDir,
      ),
      browser: start(
        'browser',
        [
          chromium.executablePath(),
          '--headless=new',
          `--remote-debugging-port=${basePort + 2}`,
          '--remote-debugging-address=127.0.0.1',
          `--user-data-dir=${join(dataDir, 'chromium-profile')}`,
          '--no-first-run',
          '--no-default-browser-check',
          'about:blank',
        ],
        repo,
        {},
        basePort + 2,
        logsDir,
      ),
    },
  }
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
    await rm(paths(basePort).stateFile, { force: true })
    throw new Failure(
      `up failed, so it stopped what it started: ${error.message}`,
      `Read the logs in ${logsDir}, fix the cause, then rerun up`,
    )
  }
  return { ok: true, status: 'started', ...(replaced ? { replaced } : {}), ...state }
}

const doctor = async (basePort) => {
  const state = await readState(basePort)
  if (state === undefined) {
    return {
      ok: false,
      basePort,
      checks: [{ name: 'state', ok: false, detail: `no ${paths(basePort).stateFile}` }],
      next: `Run up --base-port ${basePort}`,
    }
  }
  const checks = await diagnose(state)
  const failed = checks.find((c) => !c.ok)
  return { ok: failed === undefined, basePort, checks, ...(failed ? { next: failed.next } : {}) }
}

const down = async (basePort, dryRun) => {
  const { dataDir, evidenceDir } = paths(basePort)
  const state = await readState(basePort)
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

const main = async () => {
  const [command, ...rest] = process.argv.slice(2)
  if (command === undefined || command === '--help') {
    return print({ ok: true, usage: 'control-oct.mjs <command> [--help]', commands: COMMANDS })
  }
  if (!(command in COMMANDS)) {
    throw new Failure(
      `unknown command "${command}"`,
      `Use one of: ${Object.keys(COMMANDS).join(', ')}`,
    )
  }
  let values
  try {
    ;({ values } = parseArgs({
      args: rest,
      options: {
        'base-port': { type: 'string' },
        help: { type: 'boolean' },
        ...(command === 'down' ? { 'dry-run': { type: 'boolean' } } : {}),
      },
    }))
  } catch (error) {
    throw new Failure(error.message, `See ${COMMANDS[command].usage}`)
  }
  if (values.help) return print({ ok: true, ...COMMANDS[command] })
  const basePort = parseBasePort(values['base-port'])
  const result =
    command === 'up'
      ? await up(basePort)
      : command === 'doctor'
        ? await doctor(basePort)
        : await down(basePort, values['dry-run'] === true)
  print(result)
  if (!result.ok) process.exitCode = 1
}

main().catch((error) => {
  print({ ok: false, error: error.message, next: error.next ?? 'Rerun with --help for usage' })
  process.exitCode = 1
})
