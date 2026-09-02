import { mkdtemp, rm } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";

import { AuthenticationService } from "../app/auth/authentication.server";
import { hashPassword } from "../app/auth/password.server";
import { PreAuthenticationCsrfService } from "../app/auth/pre-authentication-csrf.server";
import { openApplicationDatabase } from "../app/database/database.server";
import {
  passwordCredentials,
  preAuthenticationCsrfSessions,
  rateLimitCounters,
  sessions,
  users,
} from "../app/database/schema.server";
import {
  seedAccount,
  seedAuthenticatedAccount,
} from "./support/authentication";

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

test("an administrator-provisioned member is active and restricted without retaining the initial password", async () => {
  const fixture = await createFixture();
  const initialPassword = "temporary member passphrase";
  const output = vi.spyOn(console, "log").mockImplementation(() => {});

  const provisioned = await fixture.service.provisionMember(
    "new.member",
    initialPassword,
  );

  expect(provisioned).toEqual({
    member: {
      accessState: "active",
      createdAt: "2026-08-29T12:00:00.000Z",
      passwordChangeRequired: true,
      username: "new.member",
    },
    ok: true,
  });
  expect(fixture.service.listManageableMembers()).toEqual([
    provisioned.ok ? provisioned.member : undefined,
  ]);
  const persisted = fixture.database
    .select({
      passwordChangeRequired: users.passwordChangeRequired,
      passwordHash: passwordCredentials.passwordHash,
    })
    .from(users)
    .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
    .get();
  expect(persisted?.passwordChangeRequired).toBe(true);
  expect(persisted?.passwordHash).toMatch(/^argon2id\$v=1\$/);
  expect(persisted?.passwordHash).not.toContain(initialPassword);

  const login = await fixture.service.login(
    "new.member",
    initialPassword,
    "203.0.113.201",
  );
  expect(login).toMatchObject({
    ok: true,
    session: { user: { passwordChangeRequired: true } },
  });
  const logRecord = JSON.parse(String(output.mock.calls.at(-1)?.[0])) as Record<
    string,
    unknown
  >;
  expect(logRecord).toMatchObject({
    event: "member_provisioning",
    outcome: "succeeded",
    username: "new.member",
  });
  expect(JSON.stringify(logRecord)).not.toContain(initialPassword);

  output.mockRestore();
  fixture.applicationDatabase.close();
});

test("mandatory password replacement clears the restriction and rotates every session", async () => {
  const fixture = await createFixture();
  const initialPassword = "temporary member passphrase";
  const nextPassword = "private replacement passphrase";
  expect(await fixture.service.provisionMember("onboarding.member", initialPassword))
    .toMatchObject({ ok: true });
  const current = await fixture.service.login(
    "onboarding.member",
    initialPassword,
    "203.0.113.202",
  );
  const other = await fixture.service.login(
    "onboarding.member",
    initialPassword,
    "203.0.113.203",
  );
  if (!current.ok || !other.ok) throw new Error("member login failed");

  const changed = await fixture.service.changePassword(
    current.session,
    initialPassword,
    nextPassword,
  );

  expect(changed).toMatchObject({
    ok: true,
    session: { user: { passwordChangeRequired: false } },
  });
  if (!changed.ok) throw new Error("mandatory password replacement failed");
  await expect(fixture.service.authenticate(current.session.token))
    .resolves.toBeUndefined();
  await expect(fixture.service.authenticate(other.session.token))
    .resolves.toBeUndefined();
  await expect(fixture.service.authenticate(changed.session.token))
    .resolves.toMatchObject({ user: { passwordChangeRequired: false } });
  expect(
    fixture.database
      .select({ required: users.passwordChangeRequired })
      .from(users)
      .where(eq(users.usernameNormalized, "onboarding.member"))
      .get(),
  ).toEqual({ required: false });
  await expect(
    fixture.service.login(
      "onboarding.member",
      initialPassword,
      "203.0.113.204",
    ),
  ).resolves.toEqual({ error: "invalid-credentials", ok: false });
  await expect(
    fixture.service.login(
      "onboarding.member",
      nextPassword,
      "203.0.113.205",
    ),
  ).resolves.toMatchObject({
    ok: true,
    session: { user: { passwordChangeRequired: false } },
  });

  fixture.applicationDatabase.close();
});

test("member access suspension revokes every target session and reactivation preserves onboarding", async () => {
  const fixture = await createFixture();
  const administrator = await fixture.service.register(
    "access.admin",
    password,
    "203.0.113.206",
  );
  if (!administrator.ok) throw new Error("administrator registration failed");
  const initialPassword = "temporary access passphrase";
  const provisioned = await fixture.service.provisionMember(
    "access.member",
    initialPassword,
  );
  if (!provisioned.ok) throw new Error("member provisioning failed");
  const firstDevice = await fixture.service.login(
    "access.member",
    initialPassword,
    "203.0.113.207",
  );
  const secondDevice = await fixture.service.login(
    "access.member",
    initialPassword,
    "203.0.113.208",
  );
  const unrelated = await seedAuthenticatedAccount(
    fixture.service,
    fixture.database,
    "unrelated.member",
    password,
    "203.0.113.209",
  );
  if (!firstDevice.ok || !secondDevice.ok) {
    throw new Error("member login failed");
  }
  const credentialBefore = fixture.database
    .select({ passwordHash: passwordCredentials.passwordHash })
    .from(passwordCredentials)
    .innerJoin(users, eq(users.id, passwordCredentials.userId))
    .where(eq(users.usernameNormalized, "access.member"))
    .get();

  await expect(
    fixture.service.disableMemberAccess(
      administrator.session.user,
      "access.member",
      "access.member",
    ),
  ).resolves.toEqual({ ok: true });
  expect(fixture.service.listManageableMembers()).toContainEqual({
    accessState: "disabled",
    createdAt: "2026-08-29T12:00:00.000Z",
    passwordChangeRequired: true,
    username: "access.member",
  });
  await expect(fixture.service.authenticate(firstDevice.session.token))
    .resolves.toBeUndefined();
  await expect(fixture.service.authenticate(secondDevice.session.token))
    .resolves.toBeUndefined();
  await expect(fixture.service.authenticate(unrelated.token))
    .resolves.toMatchObject({ user: { username: "unrelated.member" } });
  await expect(
    fixture.service.login(
      "access.member",
      initialPassword,
      "203.0.113.210",
    ),
  ).resolves.toEqual({ error: "invalid-credentials", ok: false });
  await expect(
    fixture.service.login(
      "access.member",
      "wrong password",
      "203.0.113.211",
    ),
  ).resolves.toEqual({ error: "invalid-credentials", ok: false });
  await expect(
    fixture.service.login(
      "missing.member",
      initialPassword,
      "203.0.113.212",
    ),
  ).resolves.toEqual({ error: "invalid-credentials", ok: false });

  await expect(
    fixture.service.reactivateMemberAccess(
      administrator.session.user,
      "access.member",
    ),
  ).resolves.toEqual({ ok: true });
  const restoredLogin = await fixture.service.login(
    "access.member",
    initialPassword,
    "203.0.113.213",
  );
  expect(restoredLogin).toMatchObject({
    ok: true,
    session: { user: { passwordChangeRequired: true } },
  });
  expect(
    fixture.database
      .select({
        passwordChangeRequired: users.passwordChangeRequired,
        passwordHash: passwordCredentials.passwordHash,
      })
      .from(users)
      .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
      .where(eq(users.usernameNormalized, "access.member"))
      .get(),
  ).toEqual({
    passwordChangeRequired: true,
    passwordHash: credentialBefore?.passwordHash,
  });

  fixture.applicationDatabase.close();
});

test("member access transitions reject stale targets and roll back failed session revocation", async () => {
  const fixture = await createFixture();
  const administrator = await fixture.service.register(
    "transition.admin",
    password,
    "203.0.113.214",
  );
  if (!administrator.ok) throw new Error("administrator registration failed");
  const target = await seedAuthenticatedAccount(
    fixture.service,
    fixture.database,
    "transition.member",
    password,
    "203.0.113.215",
  );
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});
  fixture.database.$client.exec(`
    CREATE TRIGGER reject_target_session_delete
    BEFORE DELETE ON sessions
    WHEN OLD.user_id = ${target.user.id}
    BEGIN
      SELECT RAISE(ABORT, 'simulated session revocation failure');
    END;
  `);

  await expect(
    fixture.service.disableMemberAccess(
      administrator.session.user,
      "transition.member",
      "transition.member",
    ),
  ).rejects.toThrow("simulated session revocation failure");
  expect(fixture.service.listManageableMembers()).toContainEqual({
    accessState: "active",
    createdAt: "2026-08-29T11:00:00.000Z",
    passwordChangeRequired: false,
    username: "transition.member",
  });
  await expect(fixture.service.authenticate(target.token)).resolves.toBeDefined();
  expect(JSON.parse(String(errorOutput.mock.calls.at(-1)?.[0])))
    .toMatchObject({
      action: "disable",
      actorId: administrator.session.user.id,
      actorUsername: "transition.admin",
      event: "member_access",
      outcome: "failed",
      targetUsername: "transition.member",
    });

  fixture.database.$client.exec("DROP TRIGGER reject_target_session_delete");
  await expect(
    fixture.service.disableMemberAccess(
      administrator.session.user,
      "transition.member",
      "transition.member",
    ),
  ).resolves.toEqual({ ok: true });
  await expect(
    fixture.service.disableMemberAccess(
      administrator.session.user,
      "transition.member",
      "transition.member",
    ),
  ).resolves.toEqual({ error: "already-disabled", ok: false });
  await expect(
    fixture.service.reactivateMemberAccess(
      administrator.session.user,
      "transition.member",
    ),
  ).resolves.toEqual({ ok: true });
  await expect(
    fixture.service.reactivateMemberAccess(
      administrator.session.user,
      "transition.member",
    ),
  ).resolves.toEqual({ error: "already-active", ok: false });
  await expect(
    fixture.service.disableMemberAccess(
      administrator.session.user,
      "missing.member",
      "missing.member",
    ),
  ).resolves.toEqual({ error: "not-found", ok: false });

  const records = output.mock.calls.map(([record]) =>
    JSON.parse(String(record)) as Record<string, unknown>
  );
  expect(records.map(({ outcome }) => outcome)).toEqual([
    "succeeded",
    "already-disabled",
    "succeeded",
    "already-active",
    "not-found",
  ]);
  expect(JSON.stringify(records)).not.toContain(password);
  output.mockRestore();
  errorOutput.mockRestore();
  fixture.applicationDatabase.close();
});

test("bootstrap distinguishes a claimed instance from unexpected database failures", async () => {
  const duplicateFixture = await createFixture();
  const first = await duplicateFixture.service.register(
    "duplicate.user",
    password,
    "203.0.113.90",
  );
  expect(first.ok).toBe(true);
  await expect(duplicateFixture.service.register(
    "duplicate.user",
    password,
    "203.0.113.91",
  )).resolves.toEqual({ error: "claimed-instance", ok: false });

  const brokenFixture = await createFixture();
  brokenFixture.database.$client.exec("DROP TABLE password_credentials");
  await expect(brokenFixture.service.register(
    "database.failure",
    password,
    "203.0.113.92",
  )).rejects.toThrow(/password_credentials|no such table/i);
});

test("sessions persist only a token hash and enforce idle and absolute expiry", async () => {
  const fixture = await createFixture();
  const registration = await fixture.service.register(
    "clock.user",
    password,
    "203.0.113.30",
  );
  expect(registration.ok).toBe(true);
  expect(
    fixture.database
      .select({ scope: rateLimitCounters.scope })
      .from(rateLimitCounters)
      .where(eq(rateLimitCounters.scope, "registration"))
      .get(),
  ).toEqual({ scope: "registration" });
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

  const activeFixture = await createFixture();
  const activeRegistration = await activeFixture.service.register(
    "active.user",
    password,
    "203.0.113.31",
  );
  expect(activeRegistration.ok).toBe(true);
  if (!activeRegistration.ok) throw new Error("registration failed");

  for (let day = 4; day <= 88; day += 4) {
    activeFixture.setNow(
      new Date(Date.UTC(2026, 7, 29 + day, 12)).toISOString(),
    );
    expect(
      await activeFixture.service.authenticate(activeRegistration.session.token),
    ).toBeDefined();
  }

  activeFixture.setNow("2026-11-27T12:00:00.000Z");
  expect(
    await activeFixture.service.authenticate(activeRegistration.session.token),
  ).toBeUndefined();

  activeFixture.applicationDatabase.close();
  fixture.applicationDatabase.close();
});

test("successful login rehashes obsolete Argon2 parameters", async () => {
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
  expect(current.passwordHash).toContain("$m=64,t=1,p=1,l=32$");

  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalMemory = process.env.AUTH_ARGON2_MEMORY_KIB;
  const originalPasses = process.env.AUTH_ARGON2_PASSES;
  process.env.NODE_ENV = "development";
  delete process.env.AUTH_ARGON2_MEMORY_KIB;
  delete process.env.AUTH_ARGON2_PASSES;

  try {
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
    expect(updated?.passwordHash).not.toBe(current.passwordHash);
    expect(updated?.passwordHash).toContain("$m=19456,t=2,p=1,l=32$");
  } finally {
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
    if (originalMemory === undefined) delete process.env.AUTH_ARGON2_MEMORY_KIB;
    else process.env.AUTH_ARGON2_MEMORY_KIB = originalMemory;
    if (originalPasses === undefined) delete process.env.AUTH_ARGON2_PASSES;
    else process.env.AUTH_ARGON2_PASSES = originalPasses;
    fixture.applicationDatabase.close();
  }
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
  expect(
    fixture.database
      .select({ scope: rateLimitCounters.scope })
      .from(rateLimitCounters)
      .where(eq(rateLimitCounters.scope, "password-change-failure"))
      .get(),
  ).toEqual({ scope: "password-change-failure" });

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
  expect(
    fixture.database
      .select()
      .from(rateLimitCounters)
      .where(eq(rateLimitCounters.scope, "password-change-failure"))
      .get(),
  ).toBeUndefined();

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

test("registration and login windows enforce their exact boundaries", async () => {
  const fixture = await createFixture();
  const registrationOutcomes: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const result = await fixture.service.register(
      `registration.window.${index}`,
      password,
      "203.0.113.100",
    );
    registrationOutcomes.push(result.ok ? "succeeded" : result.error);
  }
  expect(registrationOutcomes).toEqual([
    "succeeded",
    "claimed-instance",
    "claimed-instance",
    "claimed-instance",
    "claimed-instance",
  ]);
  expect(
    await fixture.service.register(
      "registration.window.blocked",
      password,
      "203.0.113.100",
    ),
  ).toEqual({ error: "rate-limited", ok: false });
  fixture.setNow("2026-08-29T12:30:00.000Z");
  expect(
    await fixture.service.register(
      "registration.window.still-blocked",
      password,
      "203.0.113.100",
    ),
  ).toEqual({ error: "rate-limited", ok: false });
  fixture.setNow("2026-08-29T13:00:00.000Z");
  expect(
    await fixture.service.register(
      "registration.window.after",
      password,
      "203.0.113.100",
    ),
  ).toEqual({ error: "claimed-instance", ok: false });

  fixture.setNow("2026-08-29T14:00:00.000Z");
  await seedAccount(
    fixture.database,
    "login.window",
    password,
  );
  for (let index = 0; index < 10; index += 1) {
    expect(
      await fixture.service.login(
        "login.window",
        "wrong password",
        "203.0.113.102",
      ),
    ).toEqual({ error: "invalid-credentials", ok: false });
  }
  fixture.setNow("2026-08-29T14:14:59.999Z");
  expect(
    await fixture.service.login(
      "login.window",
      password,
      "203.0.113.102",
    ),
  ).toEqual({ error: "rate-limited", ok: false });
  fixture.setNow("2026-08-29T14:15:00.000Z");
  expect(
    await fixture.service.login(
      "login.window",
      password,
      "203.0.113.102",
    ),
  ).toMatchObject({ ok: true });
  fixture.applicationDatabase.close();
});

test("authentication clears exact rate subjects and leaves current hashes unchanged", async () => {
  const fixture = await createFixture();
  const registration = await fixture.service.register(
    "clear.login",
    password,
    "203.0.113.110",
  );
  expect(registration.ok).toBe(true);
  const before = fixture.database.select().from(passwordCredentials).get()!;
  await fixture.service.login(
    "clear.login",
    "wrong password",
    "203.0.113.111",
  );
  const counter = fixture.database
    .select()
    .from(rateLimitCounters)
    .where(eq(rateLimitCounters.scope, "login-failure"))
    .get();
  expect(counter).toMatchObject({
    scope: "login-failure",
    subjectHash: createHash("sha256")
      .update(
        ["login-failure", "203.0.113.111", "clear.login"].join("\0"),
        "utf8",
      )
      .digest("hex"),
  });

  const login = await fixture.service.login(
    "clear.login",
    password,
    "203.0.113.111",
  );
  expect(login.ok).toBe(true);
  if (!login.ok) throw new Error("login failed");
  expect(
    fixture.database
      .select()
      .from(rateLimitCounters)
      .where(eq(rateLimitCounters.scope, "login-failure"))
      .get(),
  ).toBeUndefined();
  expect(fixture.database.select().from(passwordCredentials).get()?.passwordHash)
    .toBe(before.passwordHash);
  expect(login.session.csrfToken).toBe(authenticationCsrf(login.session.token));
  expect(fixture.service.verifyCsrfToken(login.session.token, undefined)).toBe(
    false,
  );
  expect(fixture.service.verifyCsrfToken(login.session.token, "")).toBe(false);
  fixture.applicationDatabase.close();
});

function authenticationCsrf(token: string): string {
  return createHmac("sha256", token)
    .update("open-calory-tracker:csrf:authenticated-session:v1", "utf8")
    .digest("base64url");
}

test("expired sessions are deleted and idle extension is capped absolutely", async () => {
  const fixture = await createFixture();
  const registration = await fixture.service.register(
    "session.boundary",
    password,
    "203.0.113.120",
  );
  expect(registration.ok).toBe(true);
  if (!registration.ok) throw new Error("registration failed");
  fixture.database.update(sessions).set({
    idleExpiresAt: registration.session.absoluteExpiresAt.toISOString(),
  }).run();
  fixture.setNow("2026-11-26T12:00:00.000Z");
  expect(await fixture.service.authenticate(registration.session.token))
    .toBeDefined();
  expect(fixture.database.select().from(sessions).get()?.idleExpiresAt).toBe(
    "2026-11-27T12:00:00.000Z",
  );
  fixture.setNow("2026-11-27T12:00:00.000Z");
  expect(await fixture.service.authenticate(registration.session.token))
    .toBeUndefined();
  expect(fixture.database.select().from(sessions).get()).toBeUndefined();
  fixture.applicationDatabase.close();
});

test("password changes reject a vanished or mismatched current session", async () => {
  const fixture = await createFixture();
  const first = await fixture.service.register(
    "change.first",
    password,
    "203.0.113.130",
  );
  const second = await seedAuthenticatedAccount(
    fixture.service,
    fixture.database,
    "change.second",
    password,
    "203.0.113.131",
  );
  if (!first.ok) throw new Error("registration failed");

  expect(
    await fixture.service.changePassword(
      {
        ...first.session,
        user: { ...first.session.user, id: second.user.id },
      },
      password,
      "unused replacement",
    ),
  ).toEqual({ error: "invalid-current-password", ok: false });

  expect(
    await fixture.service.changePassword(
      { ...first.session, user: second.user },
      password,
      "unused replacement",
    ),
  ).toEqual({ error: "invalid-session", ok: false });
  fixture.service.revokeSession(first.session.token);
  expect(
    await fixture.service.changePassword(
      first.session,
      password,
      "unused replacement",
    ),
  ).toEqual({ error: "invalid-session", ok: false });
  await expect(
    fixture.service.verifyCredentials("missing.user", password),
  ).resolves.toEqual({ matches: false, needsRehash: false, user: undefined });
  fixture.applicationDatabase.close();
});
