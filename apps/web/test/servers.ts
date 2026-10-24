import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { startFaultProxy } from './fault-proxy'
import {
  API_PORT,
  API_URL,
  DATABASE_PATH,
  DATABASE_URL,
  JWT,
  PROXY_PORT,
  PROXY_URL,
  SEED_USER,
  WEB_PORT,
  WEB_URL,
} from './fixtures'

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
  // A file database, because the API runs in its own process and the tests seed it too.
  const removeDatabase = () => rm(DATABASE_PATH, { force: true })
  await removeDatabase()
  const databaseUrl = DATABASE_URL
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
      JWT_SECRET: JWT.secret,
      JWT_ISSUER: JWT.issuer,
      JWT_AUDIENCE: JWT.audience,
      TRUST_PROXY: 'loopback',
    }),
    start(['pnpm', 'exec', 'next', 'dev', '--port', String(WEB_PORT)], webDir, {
      API_URL: PROXY_URL,
      JWT_SECRET: JWT.secret,
      JWT_ISSUER: JWT.issuer,
      JWT_AUDIENCE: JWT.audience,
    }),
  ]
  const proxy = await startFaultProxy(PROXY_PORT, API_URL)
  const stopAll = async () => {
    servers.forEach(stop)
    proxy.close()
    await removeDatabase()
  }

  try {
    await Promise.all([waitFor(`${API_URL}/v1/login`, 60_000), waitFor(`${WEB_URL}/login`, 60_000)])
  } catch (error) {
    await stopAll()
    throw error
  }

  return stopAll
}
