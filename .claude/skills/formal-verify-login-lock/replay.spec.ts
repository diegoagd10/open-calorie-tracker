import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { AuthService } from '../../../apps/api/src/auth/auth.service.js'
import type { AppConfig } from '../../../apps/api/src/config/config.js'
import type { UsersService } from '../../../apps/api/src/users/users.service.js'
import {
  ACCOUNT_LOCK_DURATION_SECONDS,
  MAX_FAILED_ATTEMPTS,
} from '../../../packages/shared/src/auth.ts'
import { type Action, pathsThroughEveryStep } from './graph.ts'

type Check = {
  password: string
  resolve: (matches: boolean) => void
  reject: (error: Error) => void
}

const checks = vi.hoisted((): Check[] => [])

vi.mock('../../../apps/api/src/auth/password.js', () => ({
  hashPassword: () => Promise.resolve('hash'),
  verifyPassword: (password: string) =>
    new Promise<boolean>((resolve, reject) => checks.push({ password, resolve, reject })),
}))

const IP = '203.0.113.1'
const RIGHT = 'right'
const WRONG = 'wrong'

const users = {
  findByUsername: () => Promise.resolve({ id: 1, username: 'ana', passwordHash: 'hash' }),
} as unknown as UsersService

const config = {
  jwt: {
    secret: new TextEncoder().encode('test-secret-that-is-long-enough-for-hs256'),
    issuer: 'api',
    audience: 'web',
  },
} as AppConfig

const everyMicrotask = () => new Promise((resolve) => setImmediate(resolve))

const DATABASE_ERROR = new Error('The database is gone')

const statusOf = (login: Promise<unknown>): Promise<number> =>
  login.then(
    () => 200,
    (error: unknown) => {
      if (error === DATABASE_ERROR) return 500
      if (error instanceof Error && 'getStatus' in error) {
        return (error as Error & { getStatus: () => number }).getStatus()
      }
      throw error
    },
  )

const start = () => {
  const auth = new AuthService(users, config)
  const responses = new Map<Check, Promise<number>>()

  const arrive = async (password: string): Promise<string> => {
    const before = checks.length
    const response = statusOf(auth.login({ username: 'ana', password }, IP))
    await everyMicrotask()
    const check = checks.at(-1)
    if (checks.length === before || check === undefined) return `refused ${await response}`
    responses.set(check, response)
    return 'checking'
  }

  const end = async (password: string, settle: (check: Check) => void): Promise<string> => {
    const check = [...responses.keys()].find((candidate) => candidate.password === password)
    if (check === undefined) return `no ${password} check runs`
    const response = responses.get(check)
    responses.delete(check)
    settle(check)
    return String(await response)
  }

  const steps: Record<Action, () => Promise<string>> = {
    ArriveWrong: () => arrive(WRONG),
    ArriveRight: () => arrive(RIGHT),
    RefuseLocked: () => arrive(RIGHT),
    RefuseFull: () => arrive(RIGHT),
    WrongCounted: () => end(WRONG, ({ resolve }) => resolve(false)),
    WrongLocks: () => end(WRONG, ({ resolve }) => resolve(false)),
    RightConfirmed: () => end(RIGHT, ({ resolve }) => resolve(true)),
    CheckThrows: () => end(WRONG, ({ reject }) => reject(DATABASE_ERROR)),
    LockRunsOut: () => {
      vi.setSystemTime(Date.now() + ACCOUNT_LOCK_DURATION_SECONDS * 1000)
      return Promise.resolve('')
    },
    Done: () => Promise.resolve(''),
  }
  return (action: Action) => steps[action]()
}

const EXPECTED: Record<Action, string> = {
  ArriveWrong: 'checking',
  ArriveRight: 'checking',
  RefuseLocked: 'refused 423',
  RefuseFull: 'refused 429',
  WrongCounted: '401',
  WrongLocks: '423',
  RightConfirmed: '200',
  CheckThrows: '500',
  LockRunsOut: '',
  Done: '',
}

const graph = process.env['LOGIN_LOCK_GRAPH']
if (graph === undefined) throw new Error('Run check.ts, which makes the state graph')
const paths = pathsThroughEveryStep(readFileSync(graph, 'utf8'))

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }))
afterEach(() => vi.useRealTimers())

it('AuthService.login answers every step of the model as the model says', async () => {
  expect(paths.length).toBeGreaterThan(0)
  for (const path of paths) {
    checks.length = 0
    const take = start()
    const answers: string[] = []
    for (const action of path) answers.push(`${action}: ${await take(action)}`)
    expect(answers).toEqual(path.map((action) => `${action}: ${EXPECTED[action]}`))
  }
  console.log(`Replayed ${paths.length} steps of the model on AuthService.login`)
})

const MAX_MICROTASKS = 20

const microtasks = async (count: number) => {
  for (let tick = 0; tick < count; tick++) await Promise.resolve()
}

const loginOn = (auth: AuthService, password: string) =>
  statusOf(auth.login({ username: 'ana', password }, IP))

it('starts no more checks than the limit when logins arrive in the same tick', async () => {
  checks.length = 0
  const auth = new AuthService(users, config)
  for (let sent = 0; sent < MAX_FAILED_ATTEMPTS * 2; sent++) void loginOn(auth, WRONG)
  await everyMicrotask()
  expect(checks).toHaveLength(MAX_FAILED_ATTEMPTS)
})

it('starts no check at any microtask after the last wrong password', async () => {
  for (let ticks = 0; ticks <= MAX_MICROTASKS; ticks++) {
    checks.length = 0
    const auth = new AuthService(users, config)
    for (let sent = 0; sent < MAX_FAILED_ATTEMPTS; sent++) void loginOn(auth, WRONG)
    await everyMicrotask()
    for (const { resolve } of [...checks].slice(1)) resolve(false)
    await everyMicrotask()
    checks[0]?.resolve(false)
    await microtasks(ticks)
    const late = loginOn(auth, RIGHT)
    await everyMicrotask()
    expect({ ticks, checks: checks.length }).toEqual({ ticks, checks: MAX_FAILED_ATTEMPTS })
    expect([423, 429]).toContain(await late)
  }
})
