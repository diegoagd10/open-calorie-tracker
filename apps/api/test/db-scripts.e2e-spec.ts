import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../src/db/database.js'
import { waterEntries } from '../src/db/schema.js'
import { seedWaterEntry } from '../src/db/seed.js'
import { LegacyDatabase } from './legacy/legacy-database.js'

const apiDir = fileURLToPath(new URL('..', import.meta.url))

// Not dist: `nest build` empties dist, which would pull it from under the API that the web tests
// start from there. A direct child of apps/api, so the build still finds drizzle/ and node_modules.
const BUILD_DIR = 'dist-test'

const PASSWORD = 'correct-horse-battery-staple'

const BUILD_TIMEOUT_MS = 60_000

const exec = (command: string[], env: Record<string, string> = {}) => {
  const [bin = '', ...args] = command
  return promisify(execFile)(bin, args, { cwd: apiDir, env: { ...process.env, ...env } })
}

describe('database scripts (e2e)', () => {
  let dataDir: string
  let databaseUrl: string

  // Builds once, the way `nest build` does for the db:seed and db:reset scripts. Not incremental:
  // the build info file is shared with `nest build` and would skip emitting into a fresh folder.
  beforeAll(async () => {
    await exec([
      'pnpm',
      'exec',
      'tsc',
      '-p',
      'tsconfig.build.json',
      '--outDir',
      BUILD_DIR,
      '--incremental',
      'false',
    ])
  }, BUILD_TIMEOUT_MS)

  afterAll(async () => {
    await rm(join(apiDir, BUILD_DIR), { recursive: true, force: true })
  })

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'open-calorie-tracker-db-scripts-test-'))
    databaseUrl = `file:${join(dataDir, 'sqlite.db')}`
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  // Runs what the db:seed, db:reset and db:import-legacy scripts run after building.
  const run = (
    script: 'seed' | 'reset' | 'import-legacy',
    env: Record<string, string> = {},
    args: string[] = [],
  ) => exec(['node', `${BUILD_DIR}/${script}`, ...args], { DATABASE_URL: databaseUrl, ...env })

  const stderrOf = (failure: unknown) =>
    String((failure as { stderr?: unknown } | undefined)?.stderr)

  const seed = (username: string) =>
    run('seed', { SEED_USER_USERNAME: username, SEED_USER_PASSWORD: PASSWORD })

  const storedUsernames = async () => {
    const database = await Database.connect(databaseUrl)
    try {
      return (await database.db.query.users.findMany()).map((user) => user.username)
    } finally {
      database.close()
    }
  }

  describe('db:reset', () => {
    it('deletes every user', async () => {
      await seed('ana')

      await run('reset')

      expect(await storedUsernames()).toEqual([])
    })

    it('refuses to run against a production database', async () => {
      await seed('ana')

      const failure: unknown = await run('reset', { NODE_ENV: 'production' }).catch(
        (error: unknown) => error,
      )

      expect(stderrOf(failure)).toContain('Refusing to reset a production database')
      expect(await storedUsernames()).toEqual(['ana'])
    })
  })

  describe('db:import-legacy', () => {
    let legacy: LegacyDatabase

    // An account in the new app, and a user of the old one who drank 12.5 fl oz.
    beforeEach(async () => {
      await seed('ana')
      legacy = await LegacyDatabase.create()
      const userId = await legacy.addUser('ana')
      await legacy.addWater(userId, { logDate: '2026-10-26T13:00:00.000Z', ounces: '12.5' })
    })

    afterEach(async () => {
      await legacy.remove()
    })

    const importLegacy = (...options: string[]) =>
      run('import-legacy', {}, [legacy.path, ...options])

    const withDatabase = async <T>(use: (database: Database) => Promise<T>) => {
      const database = await Database.connect(databaseUrl)
      try {
        return await use(database)
      } finally {
        database.close()
      }
    }

    const storedWaterAmounts = () =>
      withDatabase(async (database) =>
        (await database.db.select().from(waterEntries)).map((entry) => entry.amount),
      )

    const logWater = (amount: number) =>
      withDatabase((database) =>
        seedWaterEntry(database, { username: 'ana', loggedAt: new Date(), amount }),
      )

    it('imports into the account and reports what it imported', async () => {
      const { stdout } = await importLegacy()

      expect(stdout).toContain('Imported food entries: 0, water entries: 1, daily goals: 0')
      expect(await storedWaterAmounts()).toEqual([12.5])
    })

    it('refuses an account that already has entries', async () => {
      await logWater(8)

      const failure: unknown = await importLegacy().catch((error: unknown) => error)

      expect(stderrOf(failure)).toContain(
        'The account already has entries; pass --replace to replace them',
      )
      expect(await storedWaterAmounts()).toEqual([8])
    })

    it("replaces the account's entries with --replace", async () => {
      await logWater(8)

      await importLegacy('--replace')

      expect(await storedWaterAmounts()).toEqual([12.5])
    })

    it('refuses to run without the old database', async () => {
      const failure: unknown = await run('import-legacy').catch((error: unknown) => error)

      expect(stderrOf(failure)).toContain('Usage: db:import-legacy <old database file> [--replace]')
    })
  })
})
