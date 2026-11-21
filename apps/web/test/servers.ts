import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { TIME_ZONE } from './browser'
import { startFaultProxy } from './fault-proxy'
import {
  API_KEY_SECRET,
  EMPTY,
  type Environment,
  JWT,
  SEED_USER,
  SEEDED,
  TEST_DATA_DIR,
} from './fixtures'

const MIDNIGHT_GUARD = { before: 10, after: 5 }

const waitOutMidnight = async () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date())
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const seconds = part('hour') * 3600 + part('minute') * 60 + part('second')
  const untilAfter = MIDNIGHT_GUARD.after * 60 - seconds
  const untilDayEnd = 24 * 3600 - seconds
  const wait =
    untilAfter > 0
      ? untilAfter
      : untilDayEnd <= MIDNIGHT_GUARD.before * 60
        ? untilDayEnd + MIDNIGHT_GUARD.after * 60
        : 0
  if (wait === 0) return
  console.log(`Waiting ${Math.ceil(wait / 60)} min for midnight in ${TIME_ZONE} to pass`)
  await new Promise((resolve) => setTimeout(resolve, wait * 1000))
}

const apiDir = fileURLToPath(new URL('../../api', import.meta.url))
const webDir = fileURLToPath(new URL('..', import.meta.url))

const run = (command: string[], cwd: string, env: Record<string, string> = {}) => {
  const [bin = '', ...args] = command
  return promisify(execFile)(bin, args, { cwd, env: { ...process.env, ...env } })
}

const start = (command: string[], cwd: string, env: Record<string, string>) => {
  const [bin = '', ...args] = command
  return spawn(bin, args, {
    cwd,
    detached: true,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
}

const stop = (server: ChildProcess) => {
  if (server.pid !== undefined && server.exitCode === null) process.kill(-server.pid, 'SIGTERM')
}

const waitFor = async (url: string, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`${url} did not respond within ${timeoutMs}ms`)
}

const port = (url: string) => new URL(url).port

const jwtEnv = {
  JWT_SECRET: JWT.secret,
  JWT_ISSUER: JWT.issuer,
  JWT_AUDIENCE: JWT.audience,
}

const startEnvironment = async (environment: Environment) => {
  const databaseUrl = `file:${environment.databasePath}`
  const servers = [
    start(['pnpm', 'start:prod'], apiDir, {
      PORT: port(environment.apiUrl),
      DATABASE_URL: databaseUrl,
      TRUST_PROXY: 'loopback',
      API_KEY_SECRET,
      OPEN_FOOD_FACTS_USER_AGENT: 'OpenCalorieTracker/web-test (https://example.test)',
      ...jwtEnv,
    }),
    start(['pnpm', 'exec', 'next', 'start', '--port', port(environment.webUrl)], webDir, {
      API_URL: environment.proxyUrl,
      ...jwtEnv,
    }),
  ]
  const proxy = await startFaultProxy(Number(port(environment.proxyUrl)), environment.apiUrl)
  return { servers, proxy }
}

// oxlint-disable-next-line local/no-comments
// Next.js locks its build directory while `next dev` runs, so both web servers serve a single
// production build instead.
export default async function setup() {
  await waitOutMidnight()

  await rm(TEST_DATA_DIR, { recursive: true, force: true })
  await mkdir(TEST_DATA_DIR, { recursive: true })

  await Promise.all([
    run(['pnpm', 'db:seed'], apiDir, {
      DATABASE_URL: `file:${SEEDED.databasePath}`,
      SEED_USER_USERNAME: SEED_USER.username,
      SEED_USER_PASSWORD: SEED_USER.password,
    }),
    run(['pnpm', 'exec', 'next', 'build'], webDir),
  ])

  const servers: ChildProcess[] = []
  const proxies: Server[] = []
  const stopAll = async () => {
    servers.forEach(stop)
    proxies.forEach((proxy) => proxy.close())
    await rm(TEST_DATA_DIR, { recursive: true, force: true })
  }

  try {
    for (const environment of [SEEDED, EMPTY]) {
      const started = await startEnvironment(environment)
      servers.push(...started.servers)
      proxies.push(started.proxy)
    }
    await Promise.all(
      [SEEDED, EMPTY].flatMap((environment) => [
        waitFor(`${environment.apiUrl}/v1/setup`, 60_000),
        waitFor(`${environment.webUrl}/login`, 60_000),
      ]),
    )
  } catch (error) {
    await stopAll()
    throw error
  }

  return stopAll
}
