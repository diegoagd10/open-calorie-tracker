import { createHash, randomBytes } from "node:crypto";
import { operationalLog } from "../../server/operational-logging.js";
import { findOwnedApiKeySecret, insertApiKey, listApiKeysForOwner } from "../database/api-keys.server";
import { getApplicationDatabase } from "../database/runtime.server";
import { readUserTimeZone } from "../database/user-preferences.server";
import { API_KEY_SCOPES, EXPIRATION_PRESETS, MAX_API_KEYS_PER_ACCOUNT, type ApiKeyScope } from "./presets";

const KEY_PREFIX = "oct_";
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
};

export type ApiKeyErrors = { name?: string; scopes?: string; expiration?: string; form?: string };

/** The master-key cipher that lets an owner copy a key after creation. */
export interface ApiKeyCipher {
  seal(purpose: string, plaintext: Uint8Array): string;
  unseal(purpose: string, sealed: string): Buffer;
}

function hashKey(key: string): string {
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

function validate(input: { name: string; scopes: string[]; expiration: string }):
  | { ok: true; name: string; scopes: ApiKeyScope[]; days: number | null }
  | { ok: false; errors: ApiKeyErrors } {
  const name = input.name.trim();
  const scopes = [...new Set(input.scopes)];
  const preset = EXPIRATION_PRESETS.find((entry) => entry.value === input.expiration);
  const nameValid = isPrintableName(name);
  const scopesValid = isScopeList(scopes);
  if (nameValid && scopesValid && preset) return { ok: true, name, scopes, days: preset.days };
  return {
    ok: false,
    errors: {
      ...(nameValid ? {} : { name: "Enter a name of 1 to 80 printable characters." }),
      ...(scopesValid ? {} : { scopes: "Choose at least one permission." }),
      ...(preset ? {} : { expiration: "Choose an expiration." }),
    },
  };
}

function toSummary(row: ReturnType<typeof listApiKeysForOwner>[number]): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    maskedKey: `${row.keyPrefix}••••${row.keyLastFour}`,
    scopes: (JSON.parse(row.scopes) as string[]).filter(isScope),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export class ApiKeys {
  constructor(
    private readonly cipher: ApiKeyCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(ownerId: number, input: { name: string; scopes: string[]; expiration: string }):
    | { ok: true }
    | { ok: false; errors: ApiKeyErrors } {
    const validated = validate(input);
    if (!validated.ok) return validated;
    const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const created = this.now();
    const outcome = insertApiKey(ownerId, {
      name: validated.name,
      keyHash: hashKey(key),
      keyCiphertext: this.cipher.seal(CIPHER_PURPOSE, Buffer.from(key, "ascii")),
      keyPrefix: key.slice(0, KEY_PREFIX.length + 4),
      keyLastFour: key.slice(-4),
      scopes: validated.scopes,
      createdAt: created.toISOString(),
      expiresAt: validated.days === null ? null : new Date(created.getTime() + validated.days * DAY_MS).toISOString(),
    }, MAX_API_KEYS_PER_ACCOUNT);
    if (outcome === "limit") return { ok: false, errors: { form: `An account can have at most ${MAX_API_KEYS_PER_ACCOUNT} API keys. Delete one to create another.` } };
    if (outcome === "duplicate-name") return { ok: false, errors: { name: "You already have a key with this name." } };
    return { ok: true };
  }

  /** The zone the owner's key dates are displayed in. */
  displayTimeZone(ownerId: number): string {
    return readUserTimeZone(getApplicationDatabase().getClient(), ownerId) ?? "UTC";
  }

  list(ownerId: number): ApiKeySummary[] {
    return listApiKeysForOwner(ownerId).map(toSummary);
  }

  /** Returns the owner's full key for copying, or undefined when it is not theirs. */
  reveal(ownerId: number, keyId: number): string | undefined {
    const stored = findOwnedApiKeySecret(ownerId, keyId);
    if (!stored) return undefined;
    const key = this.cipher.unseal(CIPHER_PURPOSE, stored.keyCiphertext).toString("ascii");
    if (hashKey(key) !== stored.keyHash) return undefined;
    operationalLog("info", "api_key_copy", { userId: ownerId, keyPrefix: stored.keyPrefix });
    return key;
  }
}
