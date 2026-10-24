import { describe, expect, it } from 'vite-plus/test'
import { hashPassword, verifyPassword } from './password.js'

const PASSWORD = 'correct-horse-battery-staple'

// A valid hash split into its parts, to build malformed variants of it.
const [, , version, parameters, salt, key] = (await hashPassword(PASSWORD)).split('$')
const phc = (...parts: (string | undefined)[]) => ['', ...parts].join('$')

describe('password', () => {
  it('hashes with Argon2id in PHC format, storing its parameters', async () => {
    const hash = await hashPassword(PASSWORD)

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/)
  })

  it('uses a random salt, so the same password never gives the same hash', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD))
  })

  it('verifies the password the hash was created from', async () => {
    expect(await verifyPassword(PASSWORD, await hashPassword(PASSWORD))).toBe(true)
  })

  it('rejects a different password', async () => {
    expect(await verifyPassword('wrong-password', await hashPassword(PASSWORD))).toBe(false)
  })

  describe('rejects a malformed or unsupported hash', () => {
    it.each([
      ['an empty string', ''],
      ['a scrypt hash', `scrypt$${salt}$${key}`],
      ['an argon2i hash', phc('argon2i', version, parameters, salt, key)],
      ['another Argon2 version', phc('argon2id', 'v=16', parameters, salt, key)],
      ['no leading "$"', phc('argon2id', version, parameters, salt, key).slice(1)],
      ['missing the key', phc('argon2id', version, parameters, salt)],
      ['malformed parameters', phc('argon2id', version, 'm=19456,t=2', salt, key)],
      ['non-numeric parameters', phc('argon2id', version, 'm=a,t=2,p=1', salt, key)],
    ])('%s', async (_case, hash) => {
      expect(await verifyPassword(PASSWORD, hash)).toBe(false)
    })
  })
})
