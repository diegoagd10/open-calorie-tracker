import { constants } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const MASTER_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;
const bundleNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
const envelopeSchema = z.object({
  algorithm: z.literal("AES-256-GCM"),
  ciphertext: z.string(),
  nonce: z.string(),
  tag: z.string(),
  version: z.literal(ENVELOPE_VERSION),
}).strict();

export type CredentialBundleMetadata = {
  configuredAt: string;
  updatedAt: string;
};

export type StoredCredentialBundle = CredentialBundleMetadata & {
  name: string;
  envelope: string;
};

export interface CredentialBundlePersistence {
  read(name: string): StoredCredentialBundle | undefined;
  replace(bundle: StoredCredentialBundle): void;
  remove(name: string): boolean;
}

export type CredentialBundleStatus =
  | { state: "unconfigured" }
  | ({ state: "configured" } & CredentialBundleMetadata)
  | ({ state: "unreadable" } & CredentialBundleMetadata);

export class CredentialBundleUnreadableError extends Error {
  constructor() {
    super("Credential bundle is unreadable.");
    this.name = "CredentialBundleUnreadableError";
  }
}

export type OpenEncryptedCredentialBundlesOptions = {
  masterKeyPath: string;
  persistence: CredentialBundlePersistence;
  now?: () => Date;
};

function authenticatedMetadata(name: string): Buffer {
  return Buffer.from(JSON.stringify({ purpose: name, version: ENVELOPE_VERSION }), "utf8");
}

function encodeBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function decodeCanonicalBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) throw new CredentialBundleUnreadableError();
  const result = Buffer.from(value, "base64url");
  if (encodeBase64Url(result) !== value || (expectedBytes !== undefined && result.length !== expectedBytes)) {
    throw new CredentialBundleUnreadableError();
  }
  return result;
}

async function loadOrCreateMasterKey(masterKeyPath: string): Promise<Buffer> {
  const secretsDirectory = path.dirname(masterKeyPath);
  await mkdir(secretsDirectory, { recursive: true, mode: 0o700 });
  const directoryMetadata = await stat(secretsDirectory);
  if ((directoryMetadata.mode & 0o077) !== 0) {
    throw new Error("Application secrets directory permissions must exclude group and other users.");
  }
  try {
    const file = await open(masterKeyPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      const key = randomBytes(MASTER_KEY_BYTES);
      await file.writeFile(key);
      await file.sync();
      return key;
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const file = await open(masterKeyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error("Application master key must be a regular file.");
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error("Application master key permissions must exclude group and other users.");
    }
    const key = await file.readFile();
    if (key.length !== MASTER_KEY_BYTES) {
      throw new Error("Application master key must contain exactly 32 bytes.");
    }
    return key;
  } finally {
    await file.close();
  }
}

export class EncryptedCredentialBundles {
  constructor(
    private readonly persistence: CredentialBundlePersistence,
    private readonly masterKey: Buffer,
    private readonly now: () => Date,
  ) {}

  async read(name: string): Promise<Buffer | undefined> {
    const purpose = bundleNameSchema.parse(name);
    const stored = this.persistence.read(purpose);
    if (!stored) return undefined;
    try {
      const envelope = envelopeSchema.parse(JSON.parse(stored.envelope) as unknown);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.masterKey,
        decodeCanonicalBase64Url(envelope.nonce, NONCE_BYTES),
        { authTagLength: AUTHENTICATION_TAG_BYTES },
      );
      decipher.setAAD(authenticatedMetadata(purpose));
      decipher.setAuthTag(decodeCanonicalBase64Url(envelope.tag, AUTHENTICATION_TAG_BYTES));
      return Buffer.concat([
        decipher.update(decodeCanonicalBase64Url(envelope.ciphertext)),
        decipher.final(),
      ]);
    } catch {
      throw new CredentialBundleUnreadableError();
    }
  }

  async replace(
    name: string,
    plaintext: Uint8Array,
  ): Promise<Extract<CredentialBundleStatus, { state: "configured" }>> {
    const purpose = bundleNameSchema.parse(name);
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, nonce, {
      authTagLength: AUTHENTICATION_TAG_BYTES,
    });
    cipher.setAAD(authenticatedMetadata(purpose));
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext)),
      cipher.final(),
    ]);
    const envelope = JSON.stringify({
      algorithm: "AES-256-GCM",
      ciphertext: encodeBase64Url(ciphertext),
      nonce: encodeBase64Url(nonce),
      tag: encodeBase64Url(cipher.getAuthTag()),
      version: ENVELOPE_VERSION,
    });
    const previous = this.persistence.read(purpose);
    const updatedAt = this.now().toISOString();
    const configuredAt = previous?.configuredAt ?? updatedAt;
    this.persistence.replace({ name: purpose, envelope, configuredAt, updatedAt });
    return { state: "configured", configuredAt, updatedAt };
  }

  async remove(name: string): Promise<boolean> {
    return this.persistence.remove(bundleNameSchema.parse(name));
  }

  async status(name: string): Promise<CredentialBundleStatus> {
    const purpose = bundleNameSchema.parse(name);
    const stored = this.persistence.read(purpose);
    if (!stored) return { state: "unconfigured" };
    try {
      await this.read(purpose);
      return { state: "configured", configuredAt: stored.configuredAt, updatedAt: stored.updatedAt };
    } catch {
      return { state: "unreadable", configuredAt: stored.configuredAt, updatedAt: stored.updatedAt };
    }
  }
}

export async function openEncryptedCredentialBundles({
  masterKeyPath,
  persistence,
  now = () => new Date(),
}: OpenEncryptedCredentialBundlesOptions): Promise<EncryptedCredentialBundles> {
  return new EncryptedCredentialBundles(persistence, await loadOrCreateMasterKey(masterKeyPath), now);
}
