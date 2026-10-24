import { existsSync } from 'node:fs'
import { z } from 'zod'
import { Database } from './db/database.js'
import { seedUser } from './db/seed.js'

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  SEED_USER_USERNAME: z.string().min(1),
  SEED_USER_PASSWORD: z.string().min(1),
})

// Variables already set in the environment take precedence over the file.
if (existsSync('.env')) process.loadEnvFile('.env')

const env = envSchema.parse(process.env)
if (env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database')

const database = await Database.connect(env.DATABASE_URL)
await seedUser(database, { username: env.SEED_USER_USERNAME, password: env.SEED_USER_PASSWORD })
database.close()
console.log(`Seeded user "${env.SEED_USER_USERNAME}"`)
