import { argon2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const OWASP_ARGON2ID_MINIMUM = { memory: 19_456, passes: 2, parallelism: 1 }
const SALT_LENGTH = 16
const TAG_LENGTH = 32
const VERSION = 19

type Parameters = typeof OWASP_ARGON2ID_MINIMUM

const argon2Async = promisify(argon2)

const deriveKey = (password: string, salt: Buffer, parameters: Parameters, tagLength: number) =>
  argon2Async('argon2id', { message: password, nonce: salt, tagLength, ...parameters })

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_LENGTH)
  const key = await deriveKey(password, salt, OWASP_ARGON2ID_MINIMUM, TAG_LENGTH)
  const { memory, passes, parallelism } = OWASP_ARGON2ID_MINIMUM
  const parameters = `m=${memory},t=${passes},p=${parallelism}`
  return `$argon2id$v=${VERSION}$${parameters}$${encode(salt)}$${encode(key)}`
}

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  const [empty, algorithm, version, parameters, salt, key] = hash.split('$')
  if (empty !== '' || algorithm !== 'argon2id' || version !== `v=${VERSION}`) return false
  if (parameters === undefined || salt === undefined || key === undefined) return false

  const parsed = parseParameters(parameters)
  if (parsed === undefined) return false

  const expected = Buffer.from(key, 'base64')
  try {
    const actual = await deriveKey(password, Buffer.from(salt, 'base64'), parsed, expected.length)
    return timingSafeEqual(actual, expected)
  } catch {
    // oxlint-disable-next-line local/no-comments
    // Parameters Argon2 rejects (e.g. too little memory) mean the hash is not one of ours.
    return false
  }
}

// oxlint-disable-next-line local/no-comments
// PHC strings use base64 without padding.
const encode = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '')

const parseParameters = (value: string): Parameters | undefined => {
  const match = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(value)
  if (match === null) return undefined
  const [, memory, passes, parallelism] = match.map(Number)
  if (memory === undefined || passes === undefined || parallelism === undefined) return undefined
  return { memory, passes, parallelism }
}
