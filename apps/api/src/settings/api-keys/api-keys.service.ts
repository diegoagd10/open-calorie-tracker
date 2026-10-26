import { ConflictException, NotFoundException } from '@nestjs/common'
import {
  API_KEY_NAME_TAKEN_ERROR,
  type ApiKey,
  type ApiKeyCreateInput,
  apiKeyExpiresAt,
} from '@open-calorie-tracker/shared'
import { and, desc, eq } from 'drizzle-orm'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto'
import type { Database } from '../../db/database.js'
import { apiKeys } from '../../db/schema.js'

const KEY_PREFIX = 'oct_live_'
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const KEY_RANDOM_LENGTH = 32

// "oct_live_" + 32 random letters and digits.
const generateKey = () =>
  KEY_PREFIX +
  Array.from(
    { length: KEY_RANDOM_LENGTH },
    () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)],
  ).join('')

// Enough to tell keys apart without revealing them.
const previewOf = (key: string) => {
  const random = key.slice(KEY_PREFIX.length)
  return `${KEY_PREFIX}${random.slice(0, 4)}…${random.slice(-4)}`
}

// Finds a key by its value without decrypting every stored key.
const hashOf = (key: string) => createHash('sha256').update(key).digest('hex')

// Keys are stored with AES-256-GCM: base64 of the IV, the authentication tag and the ciphertext.
const CIPHER = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

type StoredApiKey = typeof apiKeys.$inferSelect

// Built by ApiKeysModule with the API_KEY_SECRET, and by the seed with the same secret.
export class ApiKeysService {
  // Derived from API_KEY_SECRET.
  private readonly encryptionKey: Buffer

  constructor(
    private readonly database: Database,
    apiKeySecret: string,
  ) {
    this.encryptionKey = createHash('sha256').update(apiKeySecret).digest()
  }

  private encrypt(key: string): string {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(CIPHER, this.encryptionKey, iv)
    const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
  }

  // Throws when the key was encrypted with another secret.
  private decrypt(stored: string): string {
    const data = Buffer.from(stored, 'base64')
    const decipher = createDecipheriv(CIPHER, this.encryptionKey, data.subarray(0, IV_BYTES))
    decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([
      decipher.update(data.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8')
  }

  private toApiKey(stored: StoredApiKey): ApiKey {
    return {
      id: stored.id,
      name: stored.name,
      key: this.decrypt(stored.encryptedKey),
      preview: stored.preview,
      createdAt: stored.createdAt.toISOString(),
      lastUsedAt: stored.lastUsedAt?.toISOString() ?? null,
      expiresAt: stored.expiresAt?.toISOString() ?? null,
    }
  }

  // Newest first.
  async list(userId: number): Promise<ApiKey[]> {
    const stored = await this.database.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
    return stored.map((key) => this.toApiKey(key))
  }

  // The name is already trimmed by apiKeyCreateSchema. Throws ConflictException when the user
  // already has a key with that name, regardless of case. `createdAt` is for the seed.
  async create(
    userId: number,
    { name, expiresIn }: ApiKeyCreateInput,
    createdAt = new Date(),
  ): Promise<ApiKey> {
    const key = generateKey()
    const created = await this.database.db
      .insert(apiKeys)
      .values({
        userId,
        name,
        encryptedKey: this.encrypt(key),
        keyHash: hashOf(key),
        preview: previewOf(key),
        createdAt,
        expiresAt: apiKeyExpiresAt(expiresIn, createdAt),
      })
      .onConflictDoNothing()
      .returning()
      .get()
    // The random part makes a clash of hashes practically impossible, so the name clashed.
    if (created === undefined) throw new ConflictException(API_KEY_NAME_TAKEN_ERROR)
    return this.toApiKey(created)
  }

  // Another user's key answers like a missing one.
  async remove(userId: number, id: number): Promise<void> {
    const removed = await this.database.db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning({ id: apiKeys.id })
    if (removed.length === 0) throw new NotFoundException()
  }
}
