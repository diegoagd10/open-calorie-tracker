import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import { AuthenticationService } from "../app/auth/authentication.server";
import { hashPassword } from "../app/auth/password.server";
import { PreAuthenticationCsrfService } from "../app/auth/pre-authentication-csrf.server";
import { openApplicationDatabase } from "../app/database/database.server";
import {
  passwordCredentials,
  preAuthenticationCsrfSessions,
  sessions,
} from "../app/database/schema.server";

const temporaryDirectories: string[] = [];
const password = "correct horse 🔐 battery";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-auth-"));
  temporaryDirectories.push(directory);
  const applicationDatabase = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  let now = new Date("2026-08-29T12:00:00.000Z");
  const service = new AuthenticationService(
    applicationDatabase.getClient(),
    () => now,
  );

  return {
    applicationDatabase,
    database: applicationDatabase.getClient(),
    service,
    setNow(next: string) {
      now = new Date(next);
    },
  };
}

test("sessions persist only a token hash and enforce idle and absolute expiry", async () => {
  const fixture = await createFixture();
  const registration = await fixture.service.register(
    "clock.user",
    password,
    "203.0.113.30",
  );
  expect(registration.ok).toBe(true);
  if (!registration.ok) throw new Error("registration failed");
  expect(Buffer.from(registration.session.token, "base64url")).toHaveLength(32);

  const storedSession = fixture.database
    .select({ tokenHash: sessions.tokenHash })
    .from(sessions)
    .get();
  expect(storedSession?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(storedSession?.tokenHash).not.toContain(registration.session.token);
  const storedCredential = fixture.database
    .select({ passwordHash: passwordCredentials.passwordHash })
    .from(passwordCredentials)
    .where(
      eq(passwordCredentials.userId, registration.session.user.id),
    )
    .get();
  expect(storedCredential?.passwordHash).toMatch(/^argon2id\$v=1\$/);
  expect(storedCredential?.passwordHash).not.toContain(password);
  expect(
    (
      fixture.database.$client.pragma("table_info(sessions)") as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  ).not.toContain("token");

  fixture.setNow("2026-09-03T12:00:00.000Z");
  expect(
    await fixture.service.authenticate(registration.session.token),
  ).toBeUndefined();

  fixture.setNow("2026-08-29T12:00:00.000Z");
  const activeRegistration = await fixture.service.register(
    "active.user",
    password,
    "203.0.113.31",
  );
  expect(activeRegistration.ok).toBe(true);
  if (!activeRegistration.ok) throw new Error("registration failed");

  for (let day = 4; day <= 88; day += 4) {
    fixture.setNow(
      new Date(Date.UTC(2026, 7, 29 + day, 12)).toISOString(),
    );
    expect(
      await fixture.service.authenticate(activeRegistration.session.token),
    ).toBeDefined();
  }

  fixture.setNow("2026-11-27T12:00:00.000Z");
  expect(
    await fixture.service.authenticate(activeRegistration.session.token),
  ).toBeUndefined();

  fixture.applicationDatabase.close();
});

test("successful login rehashes a credential whose format version is obsolete", async () => {
  const fixture = await createFixture();
  const registration = await fixture.service.register(
    "rehash.user",
    password,
    "203.0.113.32",
  );
  expect(registration.ok).toBe(true);

  const current = fixture.database
    .select({ passwordHash: passwordCredentials.passwordHash })
    .from(passwordCredentials)
    .get();
  if (!current) throw new Error("missing credential");
  const obsolete = current.passwordHash.replace("$v=1$", "$v=0$");
  fixture.database
    .update(passwordCredentials)
    .set({ passwordHash: obsolete })
    .run();

  const login = await fixture.service.login(
    "rehash.user",
    password,
    "203.0.113.32",
  );
  expect(login.ok).toBe(true);

  const updated = fixture.database
    .select({ passwordHash: passwordCredentials.passwordHash })
    .from(passwordCredentials)
    .get();
  expect(updated?.passwordHash).not.toBe(obsolete);
  expect(updated?.passwordHash).toContain("$v=1$");

  fixture.applicationDatabase.close();
});

test("password change replaces the credential and every previously issued session", async () => {
  const fixture = await createFixture();
  const registration = await fixture.service.register(
    "password.user",
    password,
    "203.0.113.33",
  );
  expect(registration.ok).toBe(true);
  if (!registration.ok) throw new Error("registration failed");

  const otherPhone = await fixture.service.login(
    "password.user",
    password,
    "203.0.113.34",
  );
  expect(otherPhone.ok).toBe(true);
  if (!otherPhone.ok) throw new Error("login failed");
  expect(
    await fixture.service.authenticate(registration.session.token),
  ).toBeDefined();
  expect(
    await fixture.service.authenticate(otherPhone.session.token),
  ).toBeDefined();

  const nextPassword = "replacement passphrase 🔐";
  const changed = await fixture.service.changePassword(
    registration.session,
    password,
    nextPassword,
  );
  expect(changed.ok).toBe(true);
  if (!changed.ok) throw new Error("password change failed");
  expect(changed.session.token).not.toBe(registration.session.token);

  expect(
    await fixture.service.authenticate(registration.session.token),
  ).toBeUndefined();
  expect(
    await fixture.service.authenticate(otherPhone.session.token),
  ).toBeUndefined();
  expect(
    await fixture.service.authenticate(changed.session.token),
  ).toMatchObject({ user: { username: "password.user" } });

  expect(
    await fixture.service.login(
      "password.user",
      password,
      "203.0.113.35",
    ),
  ).toMatchObject({ error: "invalid-credentials", ok: false });
  expect(
    await fixture.service.login(
      "password.user",
      nextPassword,
      "203.0.113.35",
    ),
  ).toMatchObject({ ok: true });

  fixture.applicationDatabase.close();
});

test("password-change failures are persisted and limited to five per 15 minutes", async () => {
  const fixture = await createFixture();
  const registration = await fixture.service.register(
    "limited.password",
    password,
    "203.0.113.36",
  );
  expect(registration.ok).toBe(true);
  if (!registration.ok) throw new Error("registration failed");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    expect(
      await fixture.service.changePassword(
        registration.session,
        "incorrect current password",
        "unused replacement password",
      ),
    ).toEqual({ error: "invalid-current-password", ok: false });
  }

  const restartedService = new AuthenticationService(
    fixture.database,
    () => new Date("2026-08-29T12:10:00.000Z"),
  );
  expect(
    await restartedService.changePassword(
      registration.session,
      password,
      "replacement after limit",
    ),
  ).toEqual({ error: "rate-limited", ok: false });

  const afterWindowService = new AuthenticationService(
    fixture.database,
    () => new Date("2026-08-29T12:16:00.000Z"),
  );
  expect(
    await afterWindowService.changePassword(
      registration.session,
      password,
      "replacement after limit",
    ),
  ).toMatchObject({ ok: true });

  fixture.applicationDatabase.close();
});

test("password rotation preserves the original absolute session expiry", async () => {
  const fixture = await createFixture();
  const registration = await fixture.service.register(
    "absolute.rotation",
    password,
    "203.0.113.37",
  );
  expect(registration.ok).toBe(true);
  if (!registration.ok) throw new Error("registration failed");

  let currentSession = registration.session;
  for (let day = 4; day <= 88; day += 4) {
    fixture.setNow(
      new Date(Date.UTC(2026, 7, 29 + day, 12)).toISOString(),
    );
    const active = await fixture.service.authenticate(currentSession.token);
    expect(active).toBeDefined();
    if (!active) throw new Error("session expired before absolute deadline");
    currentSession = active;
  }

  const changed = await fixture.service.changePassword(
    currentSession,
    password,
    "late replacement password",
  );
  expect(changed.ok).toBe(true);
  if (!changed.ok) throw new Error("password change failed");
  expect(changed.session.absoluteExpiresAt).toEqual(
    registration.session.absoluteExpiresAt,
  );

  fixture.setNow("2026-11-27T12:00:00.000Z");
  expect(
    await fixture.service.authenticate(changed.session.token),
  ).toBeUndefined();

  fixture.applicationDatabase.close();
});

test("pre-authentication CSRF values are session-bound and expire", async () => {
  const fixture = await createFixture();
  const csrf = new PreAuthenticationCsrfService(
    fixture.database,
    () => new Date("2026-08-29T12:00:00.000Z"),
  );
  const issued = csrf.issue();
  const stored = fixture.database
    .select({ tokenHash: preAuthenticationCsrfSessions.tokenHash })
    .from(preAuthenticationCsrfSessions)
    .get();

  expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(stored?.tokenHash).not.toContain(issued.token);
  expect(csrf.verify(issued.token, issued.csrfToken)).toBe(true);
  expect(csrf.verify(issued.token, "wrong-value")).toBe(false);

  const expiredCsrf = new PreAuthenticationCsrfService(
    fixture.database,
    () => new Date("2026-08-29T12:31:00.000Z"),
  );
  expect(expiredCsrf.verify(issued.token, issued.csrfToken)).toBe(false);

  fixture.applicationDatabase.close();
});

test("production password hashes encode the reviewed profile and random salt", async () => {
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalMemory = process.env.AUTH_ARGON2_MEMORY_KIB;
  const originalPasses = process.env.AUTH_ARGON2_PASSES;
  process.env.NODE_ENV = "production";
  delete process.env.AUTH_ARGON2_MEMORY_KIB;
  delete process.env.AUTH_ARGON2_PASSES;

  try {
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    const [algorithm, version, parameters, firstSalt] = first.split("$");
    const secondSalt = second.split("$")[3];

    expect(algorithm).toBe("argon2id");
    expect(version).toBe("v=1");
    expect(parameters).toBe("m=19456,t=2,p=1,l=32");
    expect(Buffer.from(firstSalt ?? "", "base64url")).toHaveLength(16);
    expect(firstSalt).not.toBe(secondSalt);
  } finally {
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
    if (originalMemory === undefined) delete process.env.AUTH_ARGON2_MEMORY_KIB;
    else process.env.AUTH_ARGON2_MEMORY_KIB = originalMemory;
    if (originalPasses === undefined) delete process.env.AUTH_ARGON2_PASSES;
    else process.env.AUTH_ARGON2_PASSES = originalPasses;
  }
});
