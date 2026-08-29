import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { AuthenticationService } from "../app/auth/authentication.server";
import { PreAuthenticationCsrfService } from "../app/auth/pre-authentication-csrf.server";
import { openApplicationDatabase } from "../app/database/database.server";

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
    applicationDatabase.getConnection(),
    () => now,
  );

  return {
    applicationDatabase,
    database: applicationDatabase.getConnection(),
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

  const storedSession = fixture.database
    .prepare<[], { tokenHash: string }>(
      "SELECT token_hash AS tokenHash FROM sessions",
    )
    .get();
  expect(storedSession?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(storedSession?.tokenHash).not.toContain(registration.session.token);
  const storedCredential = fixture.database
    .prepare<[number], { passwordHash: string }>(
      "SELECT password_hash AS passwordHash FROM password_credentials WHERE user_id = ?",
    )
    .get(registration.session.user.id);
  expect(storedCredential?.passwordHash).toMatch(/^argon2id\$v=1\$/);
  expect(storedCredential?.passwordHash).not.toContain(password);
  expect(
    fixture.database
      .prepare<[], { name: string }>("PRAGMA table_info(sessions)")
      .all()
      .map((column) => column.name),
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
    .prepare<[], { passwordHash: string }>(
      "SELECT password_hash AS passwordHash FROM password_credentials",
    )
    .get();
  if (!current) throw new Error("missing credential");
  const obsolete = current.passwordHash.replace("$v=1$", "$v=0$");
  fixture.database
    .prepare("UPDATE password_credentials SET password_hash = ?")
    .run(obsolete);

  const login = await fixture.service.login(
    "rehash.user",
    password,
    "203.0.113.32",
  );
  expect(login.ok).toBe(true);

  const updated = fixture.database
    .prepare<[], { passwordHash: string }>(
      "SELECT password_hash AS passwordHash FROM password_credentials",
    )
    .get();
  expect(updated?.passwordHash).not.toBe(obsolete);
  expect(updated?.passwordHash).toContain("$v=1$");

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
    .prepare<[], { tokenHash: string }>(
      `SELECT token_hash AS tokenHash
       FROM pre_authentication_csrf_sessions`,
    )
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
