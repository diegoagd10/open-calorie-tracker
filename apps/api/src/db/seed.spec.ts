import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from './database.js'
import { seedUser } from './seed.js'

const PASSWORD = 'correct-horse-battery-staple'

describe('seedUser', () => {
  let database: Database

  beforeEach(async () => {
    database = await Database.connect(':memory:')
  })

  afterEach(() => {
    database.close()
  })

  const storedUsernames = async () =>
    (await database.db.query.users.findMany()).map((user) => user.username)

  it('stores the username in lowercase', async () => {
    await seedUser(database, { username: 'Ana', password: PASSWORD })

    expect(await storedUsernames()).toEqual(['ana'])
  })

  // The seed follows the same rules as registration, so it never creates an account that
  // could not have been registered.
  it.each([
    ['an underscore', 'ana_1'],
    ['a space', 'ana 1'],
    ['an accent', 'josé'],
    ['an ñ', 'peña'],
  ])('rejects a username with %s and creates no user', async (_case, username) => {
    await expect(seedUser(database, { username, password: PASSWORD })).rejects.toThrow(
      'Username can only contain letters and numbers',
    )
    expect(await storedUsernames()).toEqual([])
  })

  it('rejects a password shorter than 8 characters and creates no user', async () => {
    await expect(seedUser(database, { username: 'ana', password: 'a'.repeat(7) })).rejects.toThrow(
      'Password must be at least 8 characters',
    )
    expect(await storedUsernames()).toEqual([])
  })
})
