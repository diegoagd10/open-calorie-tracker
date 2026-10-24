import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../src/db/database.js'

const apiDir = fileURLToPath(new URL('..', import.meta.url))

const PASSWORD = 'correct-horse-battery-staple'

// Each script rebuilds the API before running.
const SCRIPT_TIMEOUT_MS = 60_000

describe('db:reset (e2e)', () => {
  let dataDir: string
  let databaseUrl: string

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'open-calorie-tracker-db-scripts-test-'))
    databaseUrl = `file:${join(dataDir, 'sqlite.db')}`
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  const run = (script: string, env: Record<string, string> = {}) =>
    promisify(execFile)('pnpm', [script], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl, ...env },
    })

  const seed = (username: string) =>
    run('db:seed', { SEED_USER_USERNAME: username, SEED_USER_PASSWORD: PASSWORD })

  const storedUsernames = async () => {
    const database = await Database.connect(databaseUrl)
    try {
      return (await database.db.query.users.findMany()).map((user) => user.username)
    } finally {
      database.close()
    }
  }

  it(
    'deletes every user',
    async () => {
      await seed('ana')

      await run('db:reset')

      expect(await storedUsernames()).toEqual([])
    },
    SCRIPT_TIMEOUT_MS * 2,
  )

  it(
    'refuses to run against a production database',
    async () => {
      await seed('ana')

      const failure: unknown = await run('db:reset', { NODE_ENV: 'production' }).catch(
        (error: unknown) => error,
      )

      expect(String((failure as { stderr?: unknown } | undefined)?.stderr)).toContain(
        'Refusing to reset a production database',
      )
      expect(await storedUsernames()).toEqual(['ana'])
    },
    SCRIPT_TIMEOUT_MS * 2,
  )
})
