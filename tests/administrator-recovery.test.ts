import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";

import { AdministratorRecoveryService } from "../app/auth/administrator-recovery.server";
import { AuthenticationService } from "../app/auth/authentication.server";
import { verifyPassword } from "../app/auth/password.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { issueSessionForVerifiedCredential } from "../app/database/credential-sessions.server";
import { runAdministratorRecoveryCommand } from "../server/recover-administrator";
import {
  passwordCredentials,
  sessions,
  users,
} from "../app/database/schema.server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-admin-recovery-"));
  temporaryDirectories.push(directory);
  const applicationDatabase = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  const database = applicationDatabase.getClient();
  const authentication = new AuthenticationService(database);
  const registration = await authentication.register(
    "sole.admin",
    "forgotten private password",
    "203.0.113.86",
  );
  if (!registration.ok) throw new Error("administrator registration failed");

  return { applicationDatabase, authentication, database, registration };
}

test("login-first recovery replaces the sole administrator credential and revokes every session atomically", async () => {
  const fixture = await createFixture();
  const temporaryPassword = "one-time recovery password 86";
  const secondLogin = await fixture.authentication.login(
    "sole.admin",
    "forgotten private password",
    "203.0.113.87",
  );
  expect(secondLogin.ok).toBe(true);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const recovery = new AdministratorRecoveryService(
    fixture.database,
    () => new Date("2026-09-02T12:00:00.000Z"),
    () => temporaryPassword,
  );

  await expect(recovery.recover()).resolves.toEqual({
    ok: true,
    temporaryPassword,
  });

  expect(fixture.database.select().from(sessions).all()).toEqual([]);
  const recovered = fixture.database
    .select({
      passwordChangeRequired: users.passwordChangeRequired,
      passwordHash: passwordCredentials.passwordHash,
    })
    .from(users)
    .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
    .where(eq(users.role, "admin"))
    .get();
  expect(recovered?.passwordChangeRequired).toBe(true);
  expect(recovered?.passwordHash).toMatch(/^argon2id\$v=1\$/);
  expect(recovered?.passwordHash).not.toContain(temporaryPassword);
  await expect(
    verifyPassword(temporaryPassword, recovered?.passwordHash ?? ""),
  ).resolves.toMatchObject({ matches: true });
  await expect(
    fixture.authentication.login(
      "sole.admin",
      "forgotten private password",
      "203.0.113.88",
    ),
  ).resolves.toEqual({ error: "invalid-credentials", ok: false });
  const temporaryLogin = await fixture.authentication.login(
    "sole.admin",
    temporaryPassword,
    "203.0.113.89",
  );
  expect(temporaryLogin).toMatchObject({
    ok: true,
    session: { user: { passwordChangeRequired: true } },
  });
  if (!temporaryLogin.ok) throw new Error("recovered login failed");
  const replacementPassword = "new private administrator password";
  const changed = await fixture.authentication.changePassword(
    temporaryLogin.session,
    temporaryPassword,
    replacementPassword,
  );
  expect(changed).toMatchObject({
    ok: true,
    session: {
      user: { passwordChangeRequired: false, role: "admin" },
    },
  });
  if (!changed.ok) throw new Error("private password replacement failed");
  await expect(
    fixture.authentication.authenticate(temporaryLogin.session.token),
  ).resolves.toBeUndefined();
  await expect(
    fixture.authentication.authenticate(changed.session.token),
  ).resolves.toMatchObject({
    user: { passwordChangeRequired: false, role: "admin" },
  });
  await expect(
    fixture.authentication.login(
      "sole.admin",
      temporaryPassword,
      "203.0.113.90",
    ),
  ).resolves.toEqual({ error: "invalid-credentials", ok: false });
  const recoveryLog = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<
    string,
    unknown
  >;
  expect(recoveryLog).toMatchObject({
    event: "administrator_recovery",
    outcome: "succeeded",
  });
  const serializedLog = JSON.stringify(recoveryLog);
  expect(serializedLog).not.toContain(temporaryPassword);
  expect(serializedLog).not.toContain(recovered?.passwordHash ?? "argon2id");
  expect(serializedLog).not.toContain(fixture.registration.session.token);

  fixture.applicationDatabase.close();
});

test("recovery leaves an unclaimed database unchanged and reports no password", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-admin-recovery-empty-"));
  temporaryDirectories.push(directory);
  const applicationDatabase = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  const database = applicationDatabase.getClient();
  const generatedPassword = "must remain private on failure";
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(
    new AdministratorRecoveryService(
      database,
      undefined,
      () => generatedPassword,
    ).recover(),
  ).resolves.toEqual({ error: "administrator-not-found", ok: false });

  expect(database.select().from(users).all()).toEqual([]);
  expect(database.select().from(passwordCredentials).all()).toEqual([]);
  expect(database.select().from(sessions).all()).toEqual([]);
  expect(JSON.stringify(log.mock.calls)).not.toContain(generatedPassword);
  applicationDatabase.close();
});

test("recovery rejects multiple administrators without changing either account", async () => {
  const fixture = await createFixture();
  fixture.database.$client.exec("DROP INDEX users_single_admin_unique");
  const existingCredential = fixture.database
    .select({ passwordHash: passwordCredentials.passwordHash })
    .from(passwordCredentials)
    .get();
  if (!existingCredential) throw new Error("administrator credential missing");
  const secondAdministrator = fixture.database
    .insert(users)
    .values({
      createdAt: "2026-09-02T10:00:00.000Z",
      role: "admin",
      usernameNormalized: "other.admin",
    })
    .returning({ id: users.id })
    .get();
  fixture.database.insert(passwordCredentials).values({
    passwordHash: existingCredential.passwordHash,
    updatedAt: "2026-09-02T10:00:00.000Z",
    userId: secondAdministrator.id,
  }).run();
  const usersBefore = fixture.database.select().from(users).all();
  const credentialsBefore = fixture.database.select().from(passwordCredentials).all();
  const sessionsBefore = fixture.database.select().from(sessions).all();
  const generatedPassword = "must not escape invariant failure";
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(
    new AdministratorRecoveryService(
      fixture.database,
      undefined,
      () => generatedPassword,
    ).recover(),
  ).resolves.toEqual({
    error: "administrator-invariant-violated",
    ok: false,
  });

  expect(fixture.database.select().from(users).all()).toEqual(usersBefore);
  expect(fixture.database.select().from(passwordCredentials).all()).toEqual(
    credentialsBefore,
  );
  expect(fixture.database.select().from(sessions).all()).toEqual(sessionsBefore);
  expect(JSON.stringify(log.mock.calls)).not.toContain(generatedPassword);
  fixture.applicationDatabase.close();
});

test("a failed session revocation rolls the entire recovery back", async () => {
  const fixture = await createFixture();
  const userBefore = fixture.database.select().from(users).get();
  const credentialBefore = fixture.database.select().from(passwordCredentials).get();
  const sessionsBefore = fixture.database.select().from(sessions).all();
  fixture.database.$client.exec(`
    CREATE TRIGGER fail_administrator_session_revocation
    BEFORE DELETE ON sessions
    BEGIN
      SELECT RAISE(ABORT, 'forced recovery rollback');
    END;
  `);
  vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(
    new AdministratorRecoveryService(
      fixture.database,
      undefined,
      () => "rollback recovery password",
    ).recover(),
  ).rejects.toThrow("forced recovery rollback");

  expect(fixture.database.select().from(users).get()).toEqual(userBefore);
  expect(fixture.database.select().from(passwordCredentials).get()).toEqual(
    credentialBefore,
  );
  expect(fixture.database.select().from(sessions).all()).toEqual(sessionsBefore);
  fixture.applicationDatabase.close();
});

test("the recovery command writes the temporary password exactly once and exits successfully", async () => {
  const fixture = await createFixture();
  const output: string[] = [];
  vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(
    runAdministratorRecoveryCommand({
      applicationDatabase: fixture.applicationDatabase,
      temporaryPasswordGenerator: () => "single-use command output",
      writeStandardOutput(value) {
        output.push(value);
      },
    }),
  ).resolves.toBe(0);

  expect(output).toEqual(["single-use command output\n"]);
  expect(JSON.stringify(output)).not.toContain("argon2id");
});

test("the recovery command returns failure and writes nothing when no administrator exists", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-admin-command-empty-"));
  temporaryDirectories.push(directory);
  const applicationDatabase = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  const output: string[] = [];
  vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(
    runAdministratorRecoveryCommand({
      applicationDatabase,
      temporaryPasswordGenerator: () => "never displayed",
      writeStandardOutput(value) {
        output.push(value);
      },
    }),
  ).resolves.toBe(1);

  expect(output).toEqual([]);
});

test("session issuance rejects a login whose verified credential was recovered first", async () => {
  const fixture = await createFixture();
  const verification = await fixture.authentication.verifyCredentials(
    "sole.admin",
    "forgotten private password",
  );
  if (!verification.matches || !verification.user) {
    throw new Error("credential verification failed");
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
  const recovery = new AdministratorRecoveryService(
    fixture.database,
    undefined,
    () => "credential changed during login",
  );
  await recovery.recover();

  expect(
    issueSessionForVerifiedCredential(fixture.database, {
      expectedPasswordHash: verification.user.passwordHash,
      expectedAuthenticationVersion: verification.user.authenticationVersion,
      session: {
        absoluteExpiresAt: "2026-12-01T00:00:00.000Z",
        createdAt: "2026-09-02T00:00:00.000Z",
        idleExpiresAt: "2026-09-07T00:00:00.000Z",
        lastSeenAt: "2026-09-02T00:00:00.000Z",
        tokenHash: "stale-login-token-hash",
        userId: verification.user.id,
      },
    }),
  ).toBe(false);
  expect(fixture.database.select().from(sessions).all()).toEqual([]);

  fixture.applicationDatabase.close();
});

test("a login paused after verification fails generically when recovery commits first", async () => {
  const fixture = await createFixture();
  let releaseVerification!: () => void;
  let reportVerification!: () => void;
  const verificationReleased = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
  const verificationReported = new Promise<void>((resolve) => {
    reportVerification = resolve;
  });
  const concurrentAuthentication = new AuthenticationService(
    fixture.database,
    undefined,
    async (candidate, encoded) => {
      const result = await verifyPassword(candidate, encoded);
      reportVerification();
      await verificationReleased;
      return result;
    },
  );
  const staleLogin = concurrentAuthentication.login(
    "sole.admin",
    "forgotten private password",
    "203.0.113.91",
  );
  await verificationReported;
  vi.spyOn(console, "error").mockImplementation(() => {});

  await new AdministratorRecoveryService(
    fixture.database,
    undefined,
    () => "recovery wins concurrent login",
  ).recover();
  releaseVerification();

  await expect(staleLogin).resolves.toEqual({
    error: "invalid-credentials",
    ok: false,
  });
  expect(fixture.database.select().from(sessions).all()).toEqual([]);
  fixture.applicationDatabase.close();
});
