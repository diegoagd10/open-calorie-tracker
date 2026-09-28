import { createHash, randomBytes } from "node:crypto";
import { operationalLog } from "../../server/operational-logging.js";
import {
  deleteApiKey,
  findOwnedApiKey,
  findOwnedApiKeySecret,
  insertApiKey,
  listApiKeysForOwner,
  updateApiKey,
} from "../database/api-keys.server";
import { getApplicationDatabase } from "../database/runtime.server";
import { readUserTimeZone } from "../database/user-preferences.server";
import { API_KEY_SCOPES, EXPIRATION_PRESETS, MAX_API_KEYS_PER_ACCOUNT, type ApiKeyScope } from "./presets";

const API_KEY_PREFIX = "oct_";
const CIPHER_PURPOSE = "api-key";
const DAY_MS = 86_400_000;
export type ApiKeySummary = {
  id: number;
  name: string;
  maskedKey: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  expired: boolean;
};

/** An expiration preset an existing key can move to, with the instant it would expire. */
export type ExpirationChoice = { value: string; label: string; expiresAt: string | null };

export type EditableApiKey = { key: ApiKeySummary; expiration: string; expirations: ExpirationChoice[] };

export type ApiKeyErrors = { name?: string; scopes?: string; expiration?: string; form?: string };

export type ApiKeyOutcome = { ok: true } | { ok: false; missing?: true; errors: ApiKeyErrors };

export type ApiKeyInput = {name: string; scopes: string[]; expiration: string };

/** The master-key cipher that lets an owner copy a key after creation. */
export interface ApiKeyCipher {
  seal(purpose: string, plaintext: Uint8Array): string;
  unseal(purpose: string, sealed: string): Buffer;
}

export const MISSING_API_KEY: ApiKeyOutcome = { ok: false, missing: true, errors: { form: "This key no longer exists or has expired." } };
const DUPLICATE_NAME: ApiKeyOutcome = { ok: false, errors: { name: "You already have a key with this name." } };

/** A key id from a form or query value, or undefined when it cannot name one. */
export function parseApiKeyId(value: unknown): number | undefined {
  const keyId = Number(value);
  return Number.isSafeInteger(keyId) && keyId > 0 ? keyId : undefined;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "ascii").digest("hex");
}

function isScope(value: string): value is ApiKeyScope {
  return API_KEY_SCOPES.some((entry) => entry.scope === value);
}

function isPrintableName(name: string): boolean {
  return name.length > 0 && name.length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(name);
}

function isScopeList(scopes: string[]): scopes is ApiKeyScope[] {
  return scopes.length > 0 && scopes.every(isScope);
}

function isExpired(expiresAt: string | null, now: Date): boolean {
  return expiresAt !== null && expiresAt <= now.toISOString();
}

/** Every preset counted from `createdAt` whose instant is still ahead of `now`; No expiration always is. */
function expirationChoices(createdAt: string, now: Date): ExpirationChoice[] {
  return EXPIRATION_PRESETS
    .map((preset) => ({
      value: preset.value,
      label: preset.label,
      expiresAt: preset.days === null ? null : new Date(Date.parse(createdAt) + preset.days * DAY_MS).toISOString(),
    }))
    .filter((choice) => !isExpired(choice.expiresAt, now));
}

function validate(input: ApiKeyInput, createdAt: string, now: Date):
  | { ok: true; name: string; scopes: ApiKeyScope[]; expiresAt: string | null }
  | { ok: false; errors: ApiKeyErrors } {
  const name = input.name.trim();
  const scopes = [...new Set(input.scopes)];
  const choice = expirationChoices(createdAt, now).find((entry) => entry.value === input.expiration);
  const nameValid = isPrintableName(name);
  const scopesValid = isScopeList(scopes);
  if (nameValid && scopesValid && choice) return { ok: true, name, scopes, expiresAt: choice.expiresAt };
  return {
    ok: false,
    errors: {
      ...(nameValid ? {} : { name: "Enter a name of 1 to 80 printable characters." }),
      ...(scopesValid ? {} : { scopes: "Choose at least one permission." }),
      ...(choice ? {} : { expiration: "Choose an expiration." }),
    },
  };
}

function toSummary(row: ReturnType<typeof listApiKeysForOwner>[number], now: Date): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    maskedKey: `${row.keyPrefix}••••${row.keyLastFour}`,
    scopes: (JSON.parse(row.scopes) as string[]).filter(isScope),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    expired: isExpired(row.expiresAt, now),
  };
}

export class ApiKeys {
  constructor(
    private readonly cipher: ApiKeyCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(ownerId: number, input: ApiKeyInput): ApiKeyOutcome {
    const created = this.now();
    const validated = validate(input, created.toISOString(), created);
    if (!validated.ok) return validated;
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const outcome = insertApiKey(ownerId, {
      name: validated.name,
      keyHash: hashApiKey(key),
      keyCiphertext: this.cipher.seal(CIPHER_PURPOSE, Buffer.from(key, "ascii")),
      keyPrefix: key.slice(0, API_KEY_PREFIX.length + 4),
      keyLastFour: key.slice(-4),
      scopes: validated.scopes,
      createdAt: created.toISOString(),
      expiresAt: validated.expiresAt,
    }, MAX_API_KEYS_PER_ACCOUNT);
    if (outcome === "limit") return { ok: false, errors: { form: `An account can have at most ${MAX_API_KEYS_PER_ACCOUNT} API keys. Delete one to create another.` } };
    if (outcome === "duplicate-name") return DUPLICATE_NAME;
    return { ok: true };
  }

  /** Changes an unexpired key's name, permissions, or expiration; the key value never changes. */
  update(ownerId: number, keyId: number, input: ApiKeyInput): ApiKeyOutcome {
    const now = this.now();
    const stored = findOwnedApiKey(ownerId, keyId);
    if (!stored || isExpired(stored.expiresAt, now)) return MISSING_API_KEY;
    const validated = validate(input, stored.createdAt, now);
    if (!validated.ok) return validated;
    const outcome = updateApiKey(ownerId, keyId, {
      name: validated.name,
      scopes: validated.scopes,
      expiresAt: validated.expiresAt,
    }, now.toISOString());
    if (outcome === "missing") return MISSING_API_KEY;
    if (outcome === "duplicate-name") return DUPLICATE_NAME;
    return { ok: true };
  }

  /** Hard-deletes the owner's key, expired or not, so it stops authenticating at once. */
  delete(ownerId: number, keyId: number): ApiKeyOutcome {
    return deleteApiKey(ownerId, keyId) ? { ok: true } : MISSING_API_KEY;
  }

  /** The zone the owner's key dates are displayed in. */
  displayTimeZone(ownerId: number): string {
    return readUserTimeZone(getApplicationDatabase().getClient(), ownerId) ?? "UTC";
  }

  list(ownerId: number): ApiKeySummary[] {
    const now = this.now();
    return listApiKeysForOwner(ownerId).map((row) => toSummary(row, now));
  }

  find(ownerId: number, keyId: number): ApiKeySummary | undefined {
    const stored = findOwnedApiKey(ownerId, keyId);
    return stored ? toSummary(stored, this.now()) : undefined;
  }

  /** The owner's unexpired key with its current preset and the presets it can still move to. */
  findEditable(ownerId: number, keyId: number): EditableApiKey | undefined {
    const key = this.find(ownerId, keyId);
    if (!key || key.expired) return undefined;
    const expirations = expirationChoices(key.createdAt, this.now());
    const current = expirations.find((choice) => choice.expiresAt === key.expiresAt) ?? expirations[0];
    return { key, expiration: current.value, expirations };
  }

  /** Returns the owner's full key for copying, or undefined when it is not theirs or has expired. */
  reveal(ownerId: number, keyId: number): string | undefined {
    const stored = findOwnedApiKeySecret(ownerId, keyId);
    if (!stored || isExpired(stored.expiresAt, this.now())) return undefined;
    const key = this.cipher.unseal(CIPHER_PURPOSE, stored.keyCiphertext).toString("ascii");
    if (hashApiKey(key) !== stored.keyHash) return undefined;
    operationalLog("info", "api_key_copy", { userId: ownerId, keyPrefix: stored.keyPrefix });
    return key;
  }
}
