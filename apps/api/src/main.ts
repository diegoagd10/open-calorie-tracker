import { existsSync } from 'node:fs'
import { createApp } from './app.js'

if (existsSync('.env')) process.loadEnvFile('.env')

const app = await createApp()
await app.listen(process.env['PORT'] ?? 3001)
