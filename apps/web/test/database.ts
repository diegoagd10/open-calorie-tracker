import { type InValue, createClient } from '@libsql/client'
import type { Environment } from './fixtures'

const execute = async ({ databasePath }: Environment, sql: string, args: InValue[] = []) => {
  // oxlint-disable-next-line local/no-comments
  // Waits for the API's locks instead of failing with SQLITE_BUSY, like the API's own client.
  const client = createClient({ url: `file:${databasePath}`, timeout: 5_000 })
  try {
    await client.execute({ sql, args })
  } finally {
    client.close()
  }
}

export const deleteAllUsers = (environment: Environment) =>
  execute(environment, 'DELETE FROM users')

export const deleteWaterEntry = (environment: Environment, id: number) =>
  execute(environment, 'DELETE FROM water_entries WHERE id = ?', [id])

export const deleteFoodEntry = (environment: Environment, id: number) =>
  execute(environment, 'DELETE FROM food_entries WHERE id = ?', [id])

export const deleteApiKey = (environment: Environment, id: number) =>
  execute(environment, 'DELETE FROM api_keys WHERE id = ?', [id])
