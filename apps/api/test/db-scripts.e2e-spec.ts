import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../src/db/database.js'

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

describe('db:reset (e2e)', () => {
  let dataDir: string
  let databaseUrl: string

  // Builds once, the way `nest build` does for the db:seed and db:reset scripts.
  beforeAll(async () => {
    await exec(['pnpm', 'exec', 'tsc', '-p', 'tsconfig.build.json', '--outDir', BUILD_DIR])
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

  // Runs what the db:seed and db:reset scripts run after building.
  const run = (script: 'seed' | 'reset', env: Record<string, string> = {}) =>
    exec(['node', `${BUILD_DIR}/${script}`], { DATABASE_URL: databaseUrl, ...env })

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

    expect(String((failure as { stderr?: unknown } | undefined)?.stderr)).toContain(
      'Refusing to reset a production database',
    )
    expect(await storedUsernames()).toEqual(['ana'])
  })
})
