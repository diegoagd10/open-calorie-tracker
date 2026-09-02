import { argon2, createHash, type Argon2Parameters } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { count } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";

import {
  getClientIp,
  loadPreAuthenticationCsrf,
  parseCookies,
  requireValidOrigin,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "../app/auth/http.server";
import {
  createDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from "../app/auth/password.server";
import { PreAuthenticationCsrfService } from "../app/auth/pre-authentication-csrf.server";
import { PersistentRateLimiter } from "../app/auth/rate-limiter.server";
import {
  deriveCsrfToken,
  hashOpaqueToken,
  safelyEqual,
} from "../app/auth/token.server";
import { openApplicationDatabase } from "../app/database/database.server";
import {
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../app/database/runtime.server";
import {
  preAuthenticationCsrfSessions,
  rateLimitCounters,
} from "../app/database/schema.server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function setupDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-auth-boundary-"));
  temporaryDirectories.push(directory);
  return openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
}

function deriveForTest(
  password: string,
  salt: Buffer,
  parameters: Omit<Argon2Parameters, "message" | "nonce">,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      { ...parameters, message: Buffer.from(password), nonce: salt },
      (error, result) => error ? reject(error) : resolve(result),
    );
  });
}

test("password verification rejects every malformed encoded field", async () => {
  const valid = await hashPassword("boundary password");
  const [algorithm, version, parameters, salt, hash] = valid.split("$") as [
    string,
    string,
    string,
    string,
    string,
  ];
  await expect(verifyPassword("boundary password", valid)).resolves.toEqual({
    matches: true,
    needsRehash: false,
  });
  await expect(verifyPassword("wrong password", valid)).resolves.toEqual({
    matches: false,
    needsRehash: false,
  });

  const malformed = [
    "argon2id",
    ["wrong", version, parameters, salt, hash].join("$"),
    [algorithm, version, parameters, salt, hash, "extra"].join("$"),
    [algorithm, "1", parameters, salt, hash].join("$"),
    [algorithm, version, "", salt, hash].join("$"),
    [algorithm, version, parameters, "", hash].join("$"),
    [algorithm, version, parameters, salt, ""].join("$"),
    [algorithm, "v=1.5", parameters, salt, hash].join("$"),
    [algorithm, version, "m=0,t=1,p=1,l=32", salt, hash].join("$"),
    [algorithm, version, "m=64,t=-1,p=1,l=32", salt, hash].join("$"),
    [algorithm, version, "m=64,t=1.5,p=1,l=32", salt, hash].join("$"),
    [algorithm, version, "m=64,t=1,p=0,l=32", salt, hash].join("$"),
    [algorithm, version, "m=64,t=1,p=1,l=0", salt, hash].join("$"),
    [algorithm, version, parameters, Buffer.alloc(7).toString("base64url"), hash]
      .join("$"),
    [algorithm, version, parameters, salt, Buffer.alloc(31).toString("base64url")]
      .join("$"),
  ];
  for (const encoded of malformed) {
    await expect(verifyPassword("boundary password", encoded)).resolves.toEqual({
      matches: false,
      needsRehash: false,
    });
  }

  const newerVersion = [algorithm, "v=2", parameters, salt, hash].join("$");
  await expect(
    verifyPassword("boundary password", newerVersion),
  ).resolves.toEqual({ matches: true, needsRehash: true });

  const parsedParameters = Object.fromEntries(
    parameters.split(",").map((entry) => {
      const [key, value] = entry.split("=");
      return [
        { l: "tagLength", m: "memory", p: "parallelism", t: "passes" }[key]!,
        Number(value),
      ];
    }),
  ) as unknown as Omit<Argon2Parameters, "message" | "nonce">;
  const eightByteSalt = Buffer.alloc(8, 0xa5);
  const eightByteHash = await deriveForTest(
    "boundary password",
    eightByteSalt,
    parsedParameters,
  );
  await expect(
    verifyPassword(
      "boundary password",
      [
        algorithm,
        version,
        parameters,
        eightByteSalt.toString("base64url"),
        eightByteHash.toString("base64url"),
      ].join("$"),
    ),
  ).resolves.toEqual({ matches: true, needsRehash: false });
  await expect(
    verifyPassword(
      "boundary password",
      [algorithm, version, "m=1,t=1,p=1,l=32", salt, hash].join("$"),
    ),
  ).rejects.toThrow();
  expect(createDummyPasswordHash().split("$")).toHaveLength(5);
});

test("token primitives have exact domain separation and constant-safe behavior", () => {
  expect(hashOpaqueToken("token value")).toBe(
    createHash("sha256").update("token value", "utf8").digest("hex"),
  );
  expect(deriveCsrfToken("session", "login")).toBe(
    "iBmYvjFe6hQ_NNiXLlEVuKjtyn5IpwYwYiFEpRB_Uqk",
  );
  expect(deriveCsrfToken("session", "login")).not.toBe(
    deriveCsrfToken("session", "setup"),
  );
  expect(safelyEqual("same", "same")).toBe(true);
  expect(safelyEqual("same", "different")).toBe(false);
  expect(safelyEqual("same", "samf")).toBe(false);
  expect(safelyEqual("same", "")).toBe(false);
  expect(safelyEqual("same", undefined)).toBe(false);
});

test("cookie serialization and parsing preserve the exact host-only contract", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-29T12:00:00.000Z"));
  expect(
    serializeSessionCookie({
      absoluteExpiresAt: new Date("2026-08-29T12:01:00.000Z"),
      csrfToken: "csrf",
      token: "token with spaces",
      user: {
        id: 1,
        passwordChangeRequired: false,
        role: "member",
        username: "cookie.user",
      },
    }),
  ).toBe(
    "__Host-calorie_session=token%20with%20spaces; Path=/; Max-Age=60; Expires=Sat, 29 Aug 2026 12:01:00 GMT; HttpOnly; Secure; SameSite=Lax",
  );
  expect(serializeClearedSessionCookie()).toBe(
    "__Host-calorie_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
  );
  expect(parseCookies("=empty; first=one=two; spaced = value ")).toEqual(
    new Map([
      ["first", "one=two"],
      ["spaced", "value"],
    ]),
  );
});

test("pre-authentication issuance uses the exact host cookie name", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-auth-http-"));
  temporaryDirectories.push(directory);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_PATH", path.join(directory, "runtime.sqlite"));
  vi.stubEnv("MIGRATIONS_PATH", path.resolve("drizzle"));
  initializeApplicationDatabase();
  const loaded = loadPreAuthenticationCsrf(new Request("http://localhost/login"));
  const cookie = loaded.headers?.get("Set-Cookie");
  expect(cookie).toMatch(
    /^__Host-calorie_auth_csrf=/,
  );
  const resolved = loadPreAuthenticationCsrf(
    new Request("http://localhost/login", {
      headers: { Cookie: cookie!.split(";", 1)[0] },
    }),
  );
  expect(resolved).toEqual({ csrfToken: loaded.csrfToken });
  shutdownApplicationDatabase();
});

test("client IP and origin boundaries return exact public responses", async () => {
  vi.stubEnv("APPLICATION_URL", "https://calories.example.test");
  expect(getClientIp(new Request("https://calories.example.test"))).toBe(
    "unknown",
  );
  expect(
    getClientIp(
      new Request("https://calories.example.test", {
        headers: { "X-Open-Calory-Client-IP": "203.0.113.9" },
      }),
    ),
  ).toBe("203.0.113.9");
  expect(() =>
    requireValidOrigin(
      new Request("https://calories.example.test", {
        headers: { Origin: "https://calories.example.test" },
      }),
    ),
  ).not.toThrow();
  const rejection = (() => {
    try {
      requireValidOrigin(
        new Request("https://calories.example.test", {
          headers: { Origin: "https://attacker.example" },
        }),
      );
    } catch (error) {
      return error;
    }
    return undefined;
  })();
  expect(rejection).toBeInstanceOf(Response);
  expect((rejection as Response).status).toBe(403);
  await expect((rejection as Response).text()).resolves.toBe(
    "Request origin rejected.",
  );
});

test("pre-authentication CSRF lifecycle covers cleanup, expiry, and revoke", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  let now = new Date("2026-08-29T12:00:00.000Z");
  const service = new PreAuthenticationCsrfService(client, () => now);
  const issued = service.issue();
  expect(issued.expiresAt.toISOString()).toBe("2026-08-29T12:30:00.000Z");
  expect(service.resolve(undefined)).toBeUndefined();
  expect(service.resolve("missing-token")).toBeUndefined();
  expect(service.resolve(issued.token)).toEqual(issued);
  expect(service.verify(undefined, issued.csrfToken)).toBe(false);
  expect(service.verify(issued.token, undefined)).toBe(false);

  now = new Date("2026-08-29T12:30:00.000Z");
  expect(service.resolve(issued.token)).toBeUndefined();
  expect(client.select({ value: count() }).from(preAuthenticationCsrfSessions).get()?.value)
    .toBe(0);

  const expired = service.issue();
  now = new Date("2026-08-29T13:01:00.000Z");
  const current = service.issue();
  expect(client.select({ value: count() }).from(preAuthenticationCsrfSessions).get()?.value)
    .toBe(1);
  expect(service.resolve(expired.token)).toBeUndefined();
  expect(service.resolve(current.token)).toEqual(current);
  service.revoke(undefined);
  service.revoke(current.token);
  expect(service.resolve(current.token)).toBeUndefined();
  database.close();
});

test("persistent rate limits isolate scope and subject, clear, and expire", async () => {
  const database = await setupDatabase();
  const client = database.getClient();
  let now = new Date("2026-08-29T12:00:00.000Z");
  const limiter = new PersistentRateLimiter(client, () => now);

  expect(limiter.consume("login", "subject", 2, 60_000)).toBe(true);
  expect(limiter.consume("login", "subject", 2, 60_000)).toBe(true);
  expect(limiter.consume("login", "subject", 2, 60_000)).toBe(false);
  expect(limiter.consume("other", "subject", 2, 60_000)).toBe(true);
  expect(limiter.consume("login", "other", 2, 60_000)).toBe(true);
  const stored = client.select().from(rateLimitCounters).all();
  expect(stored).toHaveLength(3);
  expect(stored.find((row) => row.scope === "login")?.subjectHash).toBe(
    createHash("sha256").update("login\0subject", "utf8").digest("hex"),
  );

  limiter.clear("login", "subject");
  expect(limiter.consume("login", "subject", 2, 60_000)).toBe(true);
  now = new Date("2026-08-29T12:01:00.000Z");
  expect(limiter.consume("login", "subject", 2, 60_000)).toBe(true);
  database.close();
});
