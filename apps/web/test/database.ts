import { createClient } from '@libsql/client'
import type { Environment } from './fixtures'

// Writes straight to the environment's SQLite file, so a test can return to the "no account yet"
// state without the API offering a way to delete users.
export const deleteAllUsers = async ({ databasePath }: Environment) => {
  const client = createClient({ url: `file:${databasePath}` })
  try {
    await client.execute('DELETE FROM users')
  } finally {
    client.close()
  }
}
