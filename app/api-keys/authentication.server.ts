import { operationalLog } from "../../server/operational-logging.js";
import { PersistentRateLimiter } from "../auth/rate-limiter.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { findApiKeyByHash, recordApiKeyUse } from "../database/api-keys.server";
import { hashApiKey } from "./api-keys.server";
import type { ApiKeyScope } from "./presets";

type RateLimit = { scope: string; attempts: number; windowMs: number };

const FAILURE_LIMIT = { scope: "api-key-failure", attempts: 10, windowMs: 15 * 60_000 } satisfies RateLimit;
const REQUEST_LIMIT = { scope: "api-key-request", attempts: 120, windowMs: 60_000 } satisfies RateLimit;
const BEARER_KEY = /^Bearer +(oct_[A-Za-z0-9_-]{43})$/iu;

export type ApiKeyAuthentication =
  | { ok: true; userId: number; keyId: number; scopes: string[] }
  | { ok: false; error: "invalid_token" | "insufficient_scope" }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number };

/** Whether an Authorization header presents an API key rather than another bearer credential. */
export function presentsApiKey(authorization: string | null): boolean {
  return /^Bearer +oct_/iu.test(authorization ?? "");
}

function minuteOf(instant: Date): string {
  const minute = new Date(instant);
  minute.setUTCSeconds(0, 0);
  return minute.toISOString();
}

/** Authenticates `Authorization: Bearer oct_…` headers as the key's owning account. */
export class ApiKeyAuthenticator {
  readonly #limits: PersistentRateLimiter;
  readonly #now: () => Date;

  constructor(database: ApplicationDatabaseClient, now: () => Date = () => new Date()) {
    this.#limits = new PersistentRateLimiter(database, now);
    this.#now = now;
  }

  /** With `requiredScope` null, any valid key passes and the caller checks its `scopes`. */
  authenticate(authorization: string | null, clientIp: string, requiredScope: ApiKeyScope | null): ApiKeyAuthentication {
    const failureLimited = this.#consume(FAILURE_LIMIT, clientIp);
    if (failureLimited) return failureLimited;
    const now = this.#now();
    const stored = this.#findUsable(authorization, now);
    if (!stored) return { ok: false, error: "invalid_token" };
    this.#limits.clear(FAILURE_LIMIT.scope, clientIp);
    const requestLimited = this.#consume(REQUEST_LIMIT, String(stored.id), stored.keyPrefix);
    if (requestLimited) return requestLimited;
    recordApiKeyUse(stored.id, minuteOf(now));
    const scopes = JSON.parse(stored.scopes) as string[];
    if (requiredScope && !scopes.includes(requiredScope)) return { ok: false, error: "insufficient_scope" };
    return { ok: true, userId: stored.ownerId, keyId: stored.id, scopes };
  }

  /** The presented key when it exists, has not expired, and its account is active. */
  #findUsable(authorization: string | null, now: Date) {
    const key = BEARER_KEY.exec(authorization ?? "")?.[1];
    const stored = key ? findApiKeyByHash(hashApiKey(key)) : undefined;
    if (!stored || stored.accessState !== "active") return undefined;
    return stored.expiresAt === null || stored.expiresAt > now.toISOString() ? stored : undefined;
  }

  /** Counts one attempt against `limit`, returning the refusal once it is exhausted. */
  #consume(limit: RateLimit, subject: string, keyPrefix?: string): ApiKeyAuthentication | undefined {
    if (this.#limits.consume(limit.scope, subject, limit.attempts, limit.windowMs)) return undefined;
    operationalLog("warn", "api_key_rate_limited", { limit: limit.scope, ...(keyPrefix ? { keyPrefix } : {}) });
    return { ok: false, error: "rate_limited", retryAfterSeconds: limit.windowMs / 1_000 };
  }
}
