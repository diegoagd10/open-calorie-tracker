import { existsSync } from 'node:fs'
import { z } from 'zod'
import { Database } from './db/database.js'
import { users } from './db/schema.js'

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  DATABASE_URL: z.string().min(1),
})

// Variables already set in the environment take precedence over the file.
if (existsSync('.env')) process.loadEnvFile('.env')

const env = envSchema.parse(process.env)
if (env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database')

// Deleting the only account brings the app back to its first-run registration.
const database = await Database.connect(env.DATABASE_URL)
await database.db.delete(users)
database.close()
console.log('Deleted every user')
