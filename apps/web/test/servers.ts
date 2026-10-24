import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { startFaultProxy } from './fault-proxy'
import { API_PORT, API_URL, PROXY_PORT, PROXY_URL, SEED_USER, WEB_PORT, WEB_URL } from './fixtures'

const apiDir = fileURLToPath(new URL('../../api', import.meta.url))
const webDir = fileURLToPath(new URL('..', import.meta.url))

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

// Starts the real API (temporary database with the seeded test user), the fault proxy and the
// Next.js app.
export default async function setup() {
  // A file database, because the API runs in its own process and is seeded before it starts.
  const dataDir = await mkdtemp(join(tmpdir(), 'open-calorie-tracker-web-test-'))
  const databaseUrl = `file:${join(dataDir, 'sqlite.db')}`
  await promisify(execFile)('pnpm', ['db:seed'], {
    cwd: apiDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      SEED_USER_USERNAME: SEED_USER.username,
      SEED_USER_PASSWORD: SEED_USER.password,
    },
  })

  const servers = [
    start(['pnpm', 'start'], apiDir, {
      PORT: String(API_PORT),
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'web-test-secret-that-is-long-enough',
      JWT_ISSUER: 'open-calorie-tracker-api',
      JWT_AUDIENCE: 'open-calorie-tracker-web',
      TRUST_PROXY: 'loopback',
    }),
    start(['pnpm', 'exec', 'next', 'dev', '--port', String(WEB_PORT)], webDir, {
      API_URL: PROXY_URL,
    }),
  ]
  const proxy = await startFaultProxy(PROXY_PORT, API_URL)
  const stopAll = async () => {
    servers.forEach(stop)
    proxy.close()
    await rm(dataDir, { recursive: true, force: true })
  }

  try {
    await Promise.all([waitFor(`${API_URL}/v1/login`, 60_000), waitFor(`${WEB_URL}/login`, 60_000)])
  } catch (error) {
    await stopAll()
    throw error
  }

  return stopAll
}
