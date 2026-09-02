import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { asc, count, eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";

import { AuthenticationService } from "../app/auth/authentication.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { sessions, users } from "../app/database/schema.server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test("concurrent bootstrap attempts create one administrator and one session", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-bootstrap-race-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "application.sqlite");
  const options = { databasePath, migrationsFolder: path.resolve("drizzle") };
  const firstDatabase = openApplicationDatabase(options);
  const secondDatabase = openApplicationDatabase(options);
  const firstService = new AuthenticationService(firstDatabase.getClient());
  const secondService = new AuthenticationService(secondDatabase.getClient());

  const results = await Promise.all([
    firstService.register(
      "first.contender",
      "correct horse battery staple",
      "203.0.113.81",
    ),
    secondService.register(
      "second.contender",
      "correct horse battery staple",
      "203.0.113.82",
    ),
  ]);

  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([
    { error: "claimed-instance", ok: false },
  ]);
  expect(
    firstDatabase.getClient().select({ value: count() }).from(users).get(),
  ).toEqual({ value: 1 });
  expect(
    firstDatabase
      .getClient()
      .select({ accessState: users.accessState, role: users.role })
      .from(users)
      .get(),
  ).toEqual({ accessState: "active", role: "admin" });
  expect(
    firstDatabase.getClient().select({ value: count() }).from(sessions).get(),
  ).toEqual({ value: 1 });

  secondDatabase.close();
  firstDatabase.close();
});

test("a failure before hashing emits a redacted bootstrap event", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-bootstrap-log-"));
  temporaryDirectories.push(directory);
  const applicationDatabase = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  const database = applicationDatabase.getClient();
  const password = "credential material must not be logged";
  const clientIp = "203.0.113.199";
  database.$client.exec("DROP TABLE rate_limit_counters");
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(
    new AuthenticationService(database).register(
      "failed.bootstrap",
      password,
      clientIp,
    ),
  ).rejects.toThrow(/rate_limit_counters|no such table/i);

  const record = JSON.parse(String(errorLog.mock.calls.at(-1)?.[0])) as Record<
    string,
    unknown
  >;
  expect(record).toMatchObject({
    error: { name: expect.any(String) as unknown },
    event: "administrator_bootstrap",
    outcome: "failed",
  });
  expect(JSON.stringify(record)).not.toContain(password);
  expect(JSON.stringify(record)).not.toContain(clientIp);
  errorLog.mockRestore();
  applicationDatabase.close();
});

test("the user contract permits supported roles and access states only", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-role-contract-"));
  temporaryDirectories.push(directory);
  const applicationDatabase = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  const database = applicationDatabase.getClient();
  const service = new AuthenticationService(database);
  await expect(
    service.register(
      "role.owner",
      "correct horse battery staple",
      "203.0.113.84",
    ),
  ).resolves.toMatchObject({ ok: true });

  expect(() =>
    database.$client.prepare(
      `INSERT INTO users (username_normalized, role, created_at)
       VALUES ('second.admin', 'admin', '2026-09-01T12:00:00.000Z')`,
    ).run(),
  ).toThrow();
  expect(() =>
    database.$client.prepare(
      `INSERT INTO users (username_normalized, role, access_state, created_at)
       VALUES ('invalid.access', 'member', 'blocked', '2026-09-01T12:00:00.000Z')`,
    ).run(),
  ).toThrow();
  expect(() =>
    database.$client.prepare(
      `INSERT INTO users (username_normalized, role, created_at)
       VALUES ('invalid.role', 'owner', '2026-09-01T12:00:00.000Z')`,
    ).run(),
  ).toThrow();
  expect(() =>
    database.$client.prepare(
      `INSERT INTO users (username_normalized, role, created_at)
       VALUES ('valid.member', 'member', '2026-09-01T12:00:00.000Z')`,
    ).run(),
  ).not.toThrow();
  expect(() =>
    database.$client.prepare(
      `INSERT INTO users (username_normalized, role, access_state, created_at)
       VALUES ('disabled.member', 'member', 'disabled', '2026-09-01T12:00:00.000Z')`,
    ).run(),
  ).not.toThrow();
  expect(
    database
      .select({
        accessState: users.accessState,
        username: users.usernameNormalized,
      })
      .from(users)
      .where(eq(users.role, "member"))
      .orderBy(asc(users.usernameNormalized))
      .all(),
  ).toEqual([
    { accessState: "disabled", username: "disabled.member" },
    { accessState: "active", username: "valid.member" },
  ]);

  applicationDatabase.close();
});
