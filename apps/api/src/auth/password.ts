import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 64
const SALT_LENGTH = 16

const deriveKey = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)))
  })

// Stored as "scrypt$<salt>$<key>", both base64url-encoded.
export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_LENGTH)
  const key = await deriveKey(password, salt)
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  const [algorithm, salt, key] = hash.split('$')
  if (algorithm !== 'scrypt' || salt === undefined || key === undefined) return false

  const expected = Buffer.from(key, 'base64url')
  const actual = await deriveKey(password, Buffer.from(salt, 'base64url'))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
