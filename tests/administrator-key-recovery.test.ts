import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { AuthenticationService } from "../app/auth/authentication.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { shutdownApplicationDatabase } from "../app/database/runtime.server";
import { GoalSetupService } from "../app/setup/goal-setup.server";
import { runAdministratorRecoveryCommand } from "../server/recover-administrator";
import { runAdministratorKeyRecoveryCommand } from "../server/recover-administrator-keys";
import { seedAccount, seedAuthenticatedAccount } from "./support/authentication";
import { authenticator } from "./support/webauthn";

const password = "unchanged administrator password";
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  shutdownApplicationDatabase();
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "administrator-key-recovery-"));
  vi.stubEnv("APPLICATION_URL", "https://tracker.example");
  vi.stubEnv("WEBAUTHN_ENROLLMENT_PREVIEW", "1");
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("MIGRATIONS_PATH", path.resolve("drizzle"));
  const database = openApplicationDatabase({
    databasePath: process.env.DATABASE_PATH!,
    migrationsFolder: process.env.MIGRATIONS_PATH!,
  });
  cleanup.push(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  const service = new AuthenticationService(database.getClient());
  const session = await seedAuthenticatedAccount(service, database.getClient(), "owner", password, "192.0.2.1", "admin");
  new GoalSetupService(database.getClient()).completeInitial(session.user.id, {
    displayUnits: "us", timeZone: "UTC", calorieTargetMilliKcal: 2_000_000,
    carbohydrateTargetMilligrams: 200_000, fatTargetMilligrams: 60_000,
    fiberTargetMilligrams: 30_000, proteinTargetMilligrams: 100_000,
    sodiumMaximumMilligrams: 2_000, sugarMaximumMilligrams: 40_000,
    waterTargetMicroliters: 2_000_000,
  });
  const key = authenticator();
  const registration = await service.keys.beginEnrollment(session.token, "enroll", "Saved YubiKey");
  const verification = await service.keys.finishRegistration(session.token, "enroll", key.registration(registration));
  const enabled = await service.keys.finishEnrollment(session.token, "enroll", key.assertion(verification));
  return { database, directory, service, session: enabled, key };
}

test("configured terminal recovery restores the unchanged password, preserves saved keys, and revokes sessions and pending proofs", async () => {
  const f = await fixture();
  const member = await seedAuthenticatedAccount(f.service, f.database.getClient(), "unaffected.member", password, "192.0.2.30");
  const pending = await f.service.keys.beginLogin("owner", "public-login", "192.0.2.2");
  const second = await f.service.keys.finishLogin("public-login", f.key.assertion(pending, 2));
  const loginProof = await f.service.keys.beginLogin("owner", "pending-login", "192.0.2.3");
  const actionProof = await f.service.keys.beginModeChange(second.token, "pending-disable", false);
  const output: string[] = [];
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  expect(runAdministratorKeyRecoveryCommand({ writeStandardOutput: (value) => output.push(value) })).toBe(0);
  expect(output).toEqual(["Administrator key login disabled; sessions and pending proofs revoked.\n"]);
  expect(await f.service.authenticate(f.session.token)).toBeUndefined();
  expect(await f.service.authenticate(second.token)).toBeUndefined();
  await expect(f.service.keys.finishLogin("pending-login", f.key.assertion(loginProof, 3))).rejects.toThrow();
  await expect(f.service.keys.finishModeChange(second.token, "pending-disable", false, f.key.assertion(actionProof, 3))).rejects.toThrow();
  const login = await f.service.login("owner", password, "192.0.2.4");
  if (!login.ok) throw new Error("unchanged password did not sign in");
  expect(login.session.user).toEqual(f.session.user);
  expect(new GoalSetupService(f.database.getClient()).isComplete(login.session.user.id)).toBe(true);
  expect(await f.service.authenticate(member.token)).toBeDefined();
  expect(f.service.keys.status(login.session.token)).toMatchObject({ enabled: false, credentials: [{ id: f.key.id, name: "Saved YubiKey" }] });
  await expect(f.service.keys.beginLogin("owner", "disabled-login", "192.0.2.5")).rejects.toThrow();
  const serialized = output.join("") + JSON.stringify(log.mock.calls);
  expect(serialized).toContain("administrator_key_recovery");
  for (const secret of [password, f.session.token, second.token, f.key.id, loginProof.challenge, actionProof.challenge])
    expect(serialized).not.toContain(secret);
});

test("key recovery preserves disabled access and mandatory password replacement", async () => {
  const f = await fixture();
  f.database.getClient().$client.exec("UPDATE users SET access_state = 'disabled', password_change_required = 1 WHERE role = 'admin'");
  expect(runAdministratorKeyRecoveryCommand()).toBe(0);
  expect((await f.service.login("owner", password, "192.0.2.31")).ok).toBe(false);
  f.database.getClient().$client.exec("UPDATE users SET access_state = 'active' WHERE role = 'admin'");
  const login = await f.service.login("owner", password, "192.0.2.32");
  if (!login.ok) throw new Error("password login failed after explicitly restoring access");
  expect(login.session.user.passwordChangeRequired).toBe(true);
  expect(f.service.keys.status(login.session.token)).toMatchObject({ enabled: false, credentials: [{ id: f.key.id }] });
});

test("already-disabled recovery revokes password sessions and re-enable proofs while retaining reusable keys", async () => {
  const f = await fixture();
  expect(runAdministratorKeyRecoveryCommand()).toBe(0);
  const login = await f.service.login("owner", password, "192.0.2.6");
  if (!login.ok) throw new Error("password login failed");
  const proof = await f.service.keys.beginModeChange(login.session.token, "re-enable", true);
  expect(runAdministratorKeyRecoveryCommand()).toBe(0);
  expect(await f.service.authenticate(login.session.token)).toBeUndefined();
  await expect(f.service.keys.finishModeChange(login.session.token, "re-enable", true, f.key.assertion(proof, 2))).rejects.toThrow();
  const after = await f.service.login("owner", password, "192.0.2.7");
  if (!after.ok) throw new Error("unchanged password login failed");
  expect(f.service.keys.status(after.session.token)).toMatchObject({ enabled: false, credentials: [{ id: f.key.id }] });
  const fresh = await f.service.keys.beginModeChange(after.session.token, "fresh-enable", true);
  const enabled = await f.service.keys.finishModeChange(after.session.token, "fresh-enable", true, f.key.assertion(fresh, 2));
  expect(f.service.keys.status(enabled!.token).enabled).toBe(true);
});

test.each(["missing-administrator", "multiple-administrators", "missing-password"])("terminal recovery fails without mutation for %s", async (failure) => {
  const f = await fixture();
  const sqlite = f.database.getClient().$client;
  if (failure === "missing-administrator") sqlite.exec("UPDATE users SET role = 'member'");
  if (failure === "multiple-administrators") {
    sqlite.exec("DROP INDEX users_single_admin_unique");
    await seedAccount(f.database.getClient(), "other.admin", password, "admin");
  }
  if (failure === "missing-password") sqlite.exec("DELETE FROM password_credentials");
  const before = sqlite.serialize();
  const output: string[] = [];
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(runAdministratorKeyRecoveryCommand({ writeStandardOutput: (value) => output.push(value) })).toBe(1);
  expect(output).toEqual([]);
  expect(sqlite.serialize()).toEqual(before);
  expect(JSON.stringify(log.mock.calls)).not.toContain(password);
  expect(await f.service.authenticate(f.session.token)).toBeDefined();
  expect(f.service.keys.status(f.session.token).enabled).toBe(true);
});

test.each(["UPDATE OF key_login_enabled ON users", "UPDATE OF authentication_version ON users", "DELETE ON sessions", "DELETE ON webauthn_ceremonies"])("terminal recovery rolls back %s failures, including pending proofs", async (operation) => {
  const f = await fixture();
  const pending = await f.service.keys.beginLogin("owner", "rollback-login", "192.0.2.8");
  const sqlite = f.database.getClient().$client;
  sqlite.exec(`CREATE TRIGGER refuse_recovery BEFORE ${operation} BEGIN SELECT RAISE(ABORT, 'secret assertion session material'); END`);
  const output: string[] = [];
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(runAdministratorKeyRecoveryCommand({ writeStandardOutput: (value) => output.push(value) })).toBe(1);
  expect(output).toEqual([]);
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret assertion session material");
  sqlite.exec("DROP TRIGGER refuse_recovery");
  expect(await f.service.authenticate(f.session.token)).toBeDefined();
  expect(f.service.keys.status(f.session.token)).toMatchObject({ enabled: true, credentials: [{ id: f.key.id }] });
  expect((await f.service.login("owner", password, "192.0.2.9")).ok).toBe(false);
  const signedIn = await f.service.keys.finishLogin("rollback-login", f.key.assertion(pending, 2));
  expect(await f.service.authenticate(signedIn.token)).toBeDefined();
});

test.each(["database", "migrations", "storage"])("invalid %s configuration fails with redacted output and no account changes", async (failure) => {
  const f = await fixture();
  const before = f.database.getClient().$client.serialize();
  if (failure === "database") vi.stubEnv("DATABASE_PATH", " ");
  if (failure === "migrations") vi.stubEnv("MIGRATIONS_PATH", "/nonexistent/credential-secret-migrations");
  if (failure === "storage") vi.stubEnv("DATABASE_PATH", "/dev/null/credential-secret.sqlite");
  const output: string[] = [];
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(runAdministratorKeyRecoveryCommand({ writeStandardOutput: (value) => output.push(value) })).toBe(1);
  expect(output).toEqual([]);
  expect(f.database.getClient().$client.serialize()).toEqual(before);
  expect(JSON.stringify(log.mock.calls)).not.toContain("credential-secret");
});

test("lost-password recovery remains separate, preserves key mode, and retains forced password replacement after key recovery", async () => {
  const f = await fixture();
  const temporaryPassword = "separate temporary recovery password";
  const pending = await f.service.keys.beginLogin("owner", "before-password-reset", "192.0.2.10");
  expect(await runAdministratorRecoveryCommand({
    applicationDatabase: openApplicationDatabase({ databasePath: process.env.DATABASE_PATH!, migrationsFolder: process.env.MIGRATIONS_PATH! }),
    temporaryPasswordGenerator: () => temporaryPassword,
    writeStandardOutput: () => {},
  })).toBe(0);
  expect((await f.service.login("owner", temporaryPassword, "192.0.2.11")).ok).toBe(false);
  await expect(f.service.keys.finishLogin("before-password-reset", f.key.assertion(pending, 2))).rejects.toThrow();
  const fresh = await f.service.keys.beginLogin("owner", "after-password-reset", "192.0.2.12");
  const restrictedKeySession = await f.service.keys.finishLogin("after-password-reset", f.key.assertion(fresh, 2));
  expect(restrictedKeySession.user.passwordChangeRequired).toBe(true);
  expect(runAdministratorKeyRecoveryCommand()).toBe(0);
  expect(await f.service.authenticate(restrictedKeySession.token)).toBeUndefined();
  const login = await f.service.login("owner", temporaryPassword, "192.0.2.13");
  if (!login.ok) throw new Error("separate temporary password failed");
  expect(login.session.user.passwordChangeRequired).toBe(true);
  expect(f.service.keys.status(login.session.token)).toMatchObject({ enabled: false, credentials: [{ id: f.key.id }] });
  const changed = await f.service.changePassword(login.session, temporaryPassword, "new private recovery password");
  expect(changed.ok).toBe(true);
});

test("recovery invalidates a login already performing assertion verification", async () => {
  const f = await fixture();
  const pending = await f.service.keys.beginLogin("owner", "in-flight", "192.0.2.14");
  const signingIn = f.service.keys.finishLogin("in-flight", f.key.assertion(pending, 2));
  expect(runAdministratorKeyRecoveryCommand()).toBe(0);
  await expect(signingIn).rejects.toThrow();
  expect((await f.service.login("owner", password, "192.0.2.15")).ok).toBe(true);
});

// Opt in after building the production Dockerfile: RECOVERY_CONTAINER_IMAGE=<tag> pnpm exec vitest run tests/administrator-key-recovery.test.ts
test.skipIf(!process.env.RECOVERY_CONTAINER_IMAGE)("the production container executes key and separate password recovery against persistent storage", async () => {
  const f = await fixture();
  const run = (entry: string) => execFileSync("docker", [
    "run", "--rm", "--user", `${process.getuid!()}:${process.getgid!()}`,
    "--mount", `type=bind,source=${f.directory},target=/app/data`,
    "--env", "DATABASE_PATH=/app/data/application.sqlite",
    process.env.RECOVERY_CONTAINER_IMAGE!, "node", `build/recovery/${entry}.js`,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  expect(run("recover-administrator-keys")).toBe("Administrator key login disabled; sessions and pending proofs revoked.\n");
  expect(await f.service.authenticate(f.session.token)).toBeUndefined();
  const passwordLogin = await f.service.login("owner", password, "192.0.2.16");
  if (!passwordLogin.ok) throw new Error("container recovery did not restore password login");
  expect(f.service.keys.status(passwordLogin.session.token)).toMatchObject({ enabled: false, credentials: [{ id: f.key.id }] });
  const temporaryPassword = run("recover-administrator").trim();
  const restricted = await f.service.login("owner", temporaryPassword, "192.0.2.17");
  if (!restricted.ok) throw new Error("container password recovery failed");
  expect(restricted.session.user.passwordChangeRequired).toBe(true);
});
import { execFileSync } from "node:child_process";
