import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { hashApiKey } from "../app/api-keys/api-keys.server";
import { ApiKeyAuthenticator } from "../app/api-keys/authentication.server";
import type { ApiKeyScope } from "../app/api-keys/presets";
import { insertApiKey } from "../app/database/api-keys.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../app/database/runtime.server";
import { seedAccount } from "./support/authentication";

const futureRead = "future:read" as ApiKeyScope;
const futureWrite = "future:write" as ApiKeyScope;
let directory: string;
let ownerId: number;
let keyCounter = 0;

/** Stores a key holding `scopes` and returns its Authorization header. */
function keyWith(scopes: string[]): string {
  keyCounter += 1;
  const key = `oct_${String(keyCounter).padStart(43, "k")}`;
  const outcome = insertApiKey(ownerId, {
    name: `Key ${keyCounter}`,
    keyHash: hashApiKey(key),
    keyCiphertext: "unused",
    keyPrefix: key.slice(0, 8),
    keyLastFour: key.slice(-4),
    scopes,
    createdAt: "2026-08-31T16:00:00.000Z",
    expiresAt: null,
  }, 25);
  if (outcome !== "created") throw new Error(`Could not store key: ${outcome}`);
  return `Bearer ${key}`;
}

/** Each key authenticates from its own client IP so rate limits do not leak between tests. */
function authenticate(authorization: string, accepted: readonly ApiKeyScope[] | null) {
  return new ApiKeyAuthenticator(getApplicationDatabase().getClient()).authenticate(authorization, `198.51.100.${keyCounter}`, accepted);
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "api-key-authentication-"));
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  initializeApplicationDatabase();
  ownerId = await seedAccount(getApplicationDatabase().getClient(), "keys.owner", "correct horse battery staple");
});
afterAll(async () => {
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test.each([[["future:read"]], [["future:write"]], [["daily-log:read", "future:write"]]])("an endpoint accepting two scopes lets in a key holding %j", (scopes) => {
  expect(authenticate(keyWith(scopes), [futureRead, futureWrite])).toMatchObject({ ok: true, userId: ownerId, scopes });
});

test("a key holding neither accepted scope gets insufficient_scope", () => {
  expect(authenticate(keyWith(["daily-log:read"]), [futureRead, futureWrite])).toEqual({ ok: false, error: "insufficient_scope" });
});

test("without accepted scopes any valid key passes and the caller checks its scopes", () => {
  expect(authenticate(keyWith(["other:read"]), null)).toMatchObject({ ok: true, scopes: ["other:read"] });
});
