import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { Database } from './db/database.js'
import { importLegacyData } from './db/legacy-import.js'
import { foodEntries, waterEntries } from './db/schema.js'

const USAGE = 'Usage: db:import-legacy <old database file> [--replace]'

const envSchema = z.object({ DATABASE_URL: z.string().min(1) })

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

// Whether the account already logged anything, which an import would replace.
const accountHasEntries = async (database: Database) => {
  const [food] = await database.db.select({ id: foodEntries.id }).from(foodEntries).limit(1)
  const [water] = await database.db.select({ id: waterEntries.id }).from(waterEntries).limit(1)
  return food !== undefined || water !== undefined
}

// Variables already set in the environment take precedence over the file.
if (existsSync('.env')) process.loadEnvFile('.env')

const [legacyPath, ...options] = process.argv.slice(2)
if (legacyPath === undefined || options.some((option) => option !== '--replace')) fail(USAGE)
if (!existsSync(legacyPath)) fail(`${USAGE}\nNo such file: ${legacyPath}`)
const replace = options.includes('--replace')

const env = envSchema.parse(process.env)
const database = await Database.connect(env.DATABASE_URL)
try {
  // Running it again after the cutover would replace what was logged since, so that takes intent.
  if (!replace && (await accountHasEntries(database))) {
    fail('The account already has entries; pass --replace to replace them')
  }
  const imported = await importLegacyData(database, `file:${resolve(legacyPath)}`)
  console.log(
    `Imported food entries: ${imported.foodEntries}, water entries: ${imported.waterEntries}, daily goals: ${imported.dailyGoals}`,
  )
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  database.close()
}
