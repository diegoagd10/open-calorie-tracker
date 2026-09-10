import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { hashPassword, verifyPassword } from "../app/auth/password.server";
import {
  createMigrationFolder,
  waitForHttpResponse,
} from "./support/deployment";

const executeFile = promisify(execFile);
const runDeploymentTests = process.env.RUN_DEPLOYMENT_TESTS === "1";
const suffix = `${process.pid}-${Date.now()}`;
const image = `open-calory-tracker:deployment-${suffix}`;
const durableVolume = `open-calory-tracker-durable-${suffix}`;
const pendingVolume = `open-calory-tracker-pending-${suffix}`;
const recoveryVolume = `open-calory-tracker-recovery-${suffix}`;
const containers = new Set<string>();
const temporaryDirectories: string[] = [];

async function docker(arguments_: string[], timeout = 300_000) {
  return await executeFile("docker", arguments_, {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
    timeout,
  });
}

async function removeContainer(name: string) {
  try {
    await docker(["rm", "--force", name], 30_000);
  } catch {
    // A failed-start container may already have been removed.
  }
  containers.delete(name);
}

async function startContainer({
  environment = {},
  migrationsFolder,
  name,
  port,
  volume,
}: {
  environment?: Record<string, string>;
  migrationsFolder?: string;
  name: string;
  port: number;
  volume: string;
}) {
  const arguments_ = [
    "run",
    "--detach",
    "--name",
    name,
    "--env",
    "APPLICATION_URL=https://calories.example.test",
    "--env",
    "TRUST_PROXY=172.30.0.0/16",
    "--env",
    `PORT=${port}`,
    "--publish",
    `127.0.0.1::${port}`,
    "--volume",
    `${volume}:/app/data`,
  ];
  for (const [key, value] of Object.entries(environment)) {
    arguments_.push("--env", `${key}=${value}`);
  }
  if (migrationsFolder) {
    arguments_.push(
      "--mount",
      `type=bind,source=${migrationsFolder},target=/app/test-migrations,readonly`,
      "--env",
      "MIGRATIONS_PATH=/app/test-migrations",
    );
  }
  arguments_.push(image);
  await docker(arguments_);
  containers.add(name);

  const { stdout } = await docker(["port", name, `${port}/tcp`]);
  const address = stdout.trim();
  const publishedPort = address.slice(address.lastIndexOf(":") + 1);
  return `http://127.0.0.1:${publishedPort}`;
}

async function extraMigration(
  tag: string,
  sql: string,
): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "calory-container-migrations-"),
  );
  temporaryDirectories.push(directory);
  return await createMigrationFolder(path.join(directory, "migrations"), {
    extraMigration: { sql, tag },
  });
}

async function waitForContainerReady(baseUrl: string) {
  return await waitForHttpResponse(`${baseUrl}/health/ready`, {
    accepts: (response) => response.ok,
    intervalMs: 100,
    timeoutMs: 30_000,
  });
}

async function failedDockerRun(arguments_: string[]) {
  try {
    await docker(["run", "--rm", ...arguments_], 30_000);
  } catch (error) {
    const failure = error as Error & {
      code?: number;
      stderr?: string;
      stdout?: string;
    };
    if (typeof failure.code !== "number") throw error;
    return {
      code: failure.code,
      stderr: failure.stderr ?? "",
      stdout: failure.stdout ?? "",
    };
  }
  throw new Error("container unexpectedly started successfully");
}

describe.skipIf(!runDeploymentTests)("production container deployment", () => {
  beforeAll(async () => {
    await docker(["build", "--tag", image, "."]);
    await Promise.all([
      docker(["volume", "create", durableVolume]),
      docker(["volume", "create", pendingVolume]),
      docker(["volume", "create", recoveryVolume]),
    ]);
  }, 300_000);

  afterAll(async () => {
    for (const container of [...containers]) await removeContainer(container);
    for (const volume of [durableVolume, pendingVolume, recoveryVolume]) {
      try {
        await docker(["volume", "rm", volume], 30_000);
      } catch {
        // Keep cleanup best-effort so the original test failure is reported.
      }
    }
    try {
      await docker(["image", "rm", image], 30_000);
    } catch {
      // Keep cleanup best-effort so the original test failure is reported.
    }
    await Promise.all(
      temporaryDirectories.map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
  }, 120_000);

  test("Compose publishes a host port and bind-mounts application data", async () => {
    const { stdout } = await executeFile(
      "docker",
      ["compose", "config", "--format", "json"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          APPLICATION_URL: "https://calories.example.test",
          DATA_PATH: "/srv/open-calory-tracker/data",
          HOST_PORT: "3001",
          TRUST_PROXY: "172.30.0.0/16",
        },
      },
    );
    const configuration = JSON.parse(stdout) as {
      networks?: Record<string, { external?: boolean; name?: string }>;
      services: {
        application: {
          environment: Record<string, string>;
          labels?: unknown;
          networks?: Record<string, unknown>;
          ports: Array<{
            mode: string;
            protocol: string;
            published: string;
            target: number;
          }>;
          volumes: Array<{
            source: string;
            target: string;
            type: string;
          }>;
        };
      };
    };
    const application = configuration.services.application;

    expect(application.ports).toContainEqual({
      mode: "ingress",
      protocol: "tcp",
      published: "3001",
      target: 3000,
    });
    expect(application.volumes).toContainEqual({
      source: "/srv/open-calory-tracker/data",
      target: "/app/data",
      type: "bind",
    });
    expect(application.environment).toMatchObject({
      APPLICATION_URL: "https://calories.example.test",
      PORT: "3000",
      TRUST_PROXY: "172.30.0.0/16",
    });
    expect(application.networks).not.toHaveProperty("traefik");
    expect(configuration.networks).not.toHaveProperty("traefik");
    expect(application.labels).toBeUndefined();
  });

  test("the final image is a minimal non-root Node 24 SSR runtime", async () => {
    const { stdout } = await docker(["image", "inspect", image]);
    const [inspection] = JSON.parse(stdout) as Array<{
      Config: {
        Cmd: string[];
        Env: string[];
        User: string;
        WorkingDir: string;
      };
    }>;
    expect(inspection.Config).toMatchObject({
      Cmd: ["node", "server.js"],
      User: "node",
      WorkingDir: "/app",
    });
    expect(inspection.Config.Env).toContain("NODE_ENV=production");

    const [{ stdout: nodeVersion }, { stdout: userId }, { stdout: osRelease }] =
      await Promise.all([
        docker(["run", "--rm", "--entrypoint", "node", image, "--version"]),
        docker(["run", "--rm", "--entrypoint", "id", image, "-u"]),
        docker([
          "run",
          "--rm",
          "--entrypoint",
          "sh",
          image,
          "-c",
          "grep PRETTY_NAME /etc/os-release && ! command -v g++",
        ]),
      ]);
    expect(nodeVersion.trim()).toMatch(/^v24\./);
    expect(userId.trim()).not.toBe("0");
    expect(osRelease).toContain("Debian GNU/Linux 12 (bookworm)");

    const productionDependencies = await docker([
      "run",
      "--rm",
      "--entrypoint",
      "node",
      image,
      "--input-type=module",
      "--eval",
      "try { await import('typescript'); process.exit(1); } catch (error) { if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error; }",
    ]);
    expect(productionDependencies.stderr).toBe("");
  });

  test("operator commands run through pnpm without repairing production dependencies", async () => {
    const result = await failedDockerRun([
      "--network",
      "none",
      "--entrypoint",
      "pnpm",
      image,
      "catalog:import:off",
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).toContain("pnpm catalog:import:off");
    expect(result.stderr).not.toContain("pnpm install");
    expect(result.stderr).not.toContain("EACCES");
  });

  test("fresh install and replacement startup preserve durable SQLite", async () => {
    const firstName = `calory-fresh-${suffix}`;
    const firstUrl = await startContainer({
      name: firstName,
      port: 4317,
      volume: durableVolume,
    });
    const readiness = await waitForContainerReady(firstUrl);
    expect(await readiness.json()).toEqual({ status: "ready" });
    const liveness = await fetch(`${firstUrl}/health/live`);
    expect(await liveness.json()).toEqual({ status: "live" });
    const page = await fetch(firstUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Open Calorie Tracker");

    await docker([
      "exec",
      firstName,
      "node",
      "--input-type=module",
      "--eval",
      `import Database from 'better-sqlite3';
       const database = new Database('/app/data/open-calory-tracker.sqlite');
       database.prepare("INSERT INTO application_metadata (key, value, updated_at) VALUES ('deployment_test_marker', 'preserved', '2026-08-30T12:00:00.000Z')").run();
       database.close();`,
    ]);
    await removeContainer(firstName);

    const replacementName = `calory-replacement-${suffix}`;
    const replacementUrl = await startContainer({
      name: replacementName,
      port: 4318,
      volume: durableVolume,
    });
    await waitForContainerReady(replacementUrl);
    const marker = await docker([
      "exec",
      replacementName,
      "node",
      "--input-type=module",
      "--eval",
      `import Database from 'better-sqlite3';
       const database = new Database('/app/data/open-calory-tracker.sqlite', { readonly: true });
       process.stdout.write(database.prepare("SELECT value FROM application_metadata WHERE key = 'deployment_test_marker'").pluck().get());
       database.close();`,
    ]);
    expect(marker.stdout).toBe("preserved");
    await removeContainer(replacementName);
  }, 60_000);

  test("administrator recovery runs against the live configured database", async () => {
    const name = `calory-recovery-${suffix}`;
    const baseUrl = await startContainer({
      name,
      port: 4321,
      volume: recoveryVolume,
    });
    await waitForContainerReady(baseUrl);
    const originalPassword = "forgotten container password";
    const originalPasswordHash = await hashPassword(originalPassword);
    await docker([
      "exec",
      "--env",
      `ORIGINAL_PASSWORD_HASH=${originalPasswordHash}`,
      name,
      "node",
      "--input-type=module",
      "--eval",
      `import Database from 'better-sqlite3';
       const database = new Database('/app/data/open-calory-tracker.sqlite');
       const timestamp = '2026-09-02T12:00:00.000Z';
       const user = database.prepare("INSERT INTO users (username_normalized, role, created_at) VALUES ('recover.admin', 'admin', ?)").run(timestamp);
       database.prepare('INSERT INTO password_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)').run(user.lastInsertRowid, process.env.ORIGINAL_PASSWORD_HASH, timestamp);
       const insertSession = database.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?, ?)');
       insertSession.run('a'.repeat(64), user.lastInsertRowid, timestamp, timestamp, '2026-09-07T12:00:00.000Z', '2026-12-01T12:00:00.000Z');
       insertSession.run('b'.repeat(64), user.lastInsertRowid, timestamp, timestamp, '2026-09-07T12:00:00.000Z', '2026-12-01T12:00:00.000Z');
       database.close();`,
    ]);

    const recovered = await docker([
      "exec",
      name,
      "node",
      "build/recovery/recover-administrator.js",
    ]);
    const temporaryPassword = recovered.stdout.trim();
    expect(recovered.stdout).toBe(`${temporaryPassword}\n`);
    expect(temporaryPassword).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(recovered.stderr).toContain('"event":"administrator_recovery"');
    expect(recovered.stderr).toContain('"outcome":"succeeded"');
    expect(recovered.stderr).not.toContain(temporaryPassword);
    expect(recovered.stderr).not.toContain(originalPasswordHash);

    const { stdout: persistedOutput } = await docker([
      "exec",
      name,
      "node",
      "--input-type=module",
      "--eval",
      `import Database from 'better-sqlite3';
       const database = new Database('/app/data/open-calory-tracker.sqlite', { readonly: true });
       const user = database.prepare("SELECT id, password_change_required AS passwordChangeRequired FROM users WHERE role = 'admin'").get();
       const passwordHash = database.prepare('SELECT password_hash FROM password_credentials WHERE user_id = ?').pluck().get(user.id);
       const sessions = database.prepare('SELECT count(*) FROM sessions WHERE user_id = ?').pluck().get(user.id);
       process.stdout.write(JSON.stringify({ passwordChangeRequired: user.passwordChangeRequired, passwordHash, sessions }));
       database.close();`,
    ]);
    const persisted = JSON.parse(persistedOutput) as {
      passwordChangeRequired: number;
      passwordHash: string;
      sessions: number;
    };
    expect(persisted.passwordChangeRequired).toBe(1);
    expect(persisted.passwordHash).not.toBe(temporaryPassword);
    await expect(
      verifyPassword(temporaryPassword, persisted.passwordHash),
    ).resolves.toMatchObject({ matches: true });
    expect(persisted.sessions).toBe(0);
    expect((await fetch(`${baseUrl}/health/ready`)).status).toBe(200);
    await removeContainer(name);
  }, 60_000);

  test("a container applies a pending migration before becoming ready", async () => {
    const baselineName = `calory-pending-base-${suffix}`;
    const baselineUrl = await startContainer({
      name: baselineName,
      port: 4319,
      volume: pendingVolume,
    });
    await waitForContainerReady(baselineUrl);
    await removeContainer(baselineName);

    const migrationsFolder = await extraMigration(
      "0009_container_pending",
      "CREATE TABLE deployment_pending_probe (value text NOT NULL);\n",
    );
    const upgradedName = `calory-pending-upgrade-${suffix}`;
    const upgradedUrl = await startContainer({
      migrationsFolder,
      name: upgradedName,
      port: 4320,
      volume: pendingVolume,
    });
    await waitForContainerReady(upgradedUrl);
    const probe = await docker([
      "exec",
      upgradedName,
      "node",
      "--input-type=module",
      "--eval",
      `import Database from 'better-sqlite3';
       const database = new Database('/app/data/open-calory-tracker.sqlite', { readonly: true });
       process.stdout.write(database.prepare("SELECT name FROM sqlite_master WHERE name = 'deployment_pending_probe'").pluck().get());
       database.close();`,
    ]);
    expect(probe.stdout).toBe("deployment_pending_probe");
    await removeContainer(upgradedName);
  }, 60_000);

  test("failed migration, read-only storage, and missing config stop the container", async () => {
    const failingMigrations = await extraMigration(
      "0009_container_failure",
      `CREATE TABLE deployment_failed_probe (value text NOT NULL);
--> statement-breakpoint
INSERT INTO users (username_normalized, created_at)
VALUES ('must-not-survive', '2026-08-30T12:00:00.000Z');
--> statement-breakpoint
THIS IS NOT VALID SQL;\n`,
    );
    const failedMigration = await failedDockerRun([
      "--env",
      "APPLICATION_URL=https://calories.example.test",
      "--env",
      "TRUST_PROXY=172.30.0.0/16",
      "--volume",
      `${durableVolume}:/app/data`,
      "--mount",
      `type=bind,source=${failingMigrations},target=/app/test-migrations,readonly`,
      "--env",
      "MIGRATIONS_PATH=/app/test-migrations",
      image,
    ]);
    expect(failedMigration.code).not.toBe(0);
    expect(failedMigration.stderr).toContain('"event":"startup_failed"');

    const rollback = await docker([
      "run",
      "--rm",
      "--volume",
      `${durableVolume}:/app/data`,
      "--entrypoint",
      "node",
      image,
      "--input-type=module",
      "--eval",
      `import Database from 'better-sqlite3';
       const database = new Database('/app/data/open-calory-tracker.sqlite', { readonly: true });
       const table = database.prepare("SELECT count(*) FROM sqlite_master WHERE name = 'deployment_failed_probe'").pluck().get();
       const user = database.prepare("SELECT count(*) FROM users WHERE username_normalized = 'must-not-survive'").pluck().get();
       process.stdout.write(JSON.stringify({ table, user }));
       database.close();`,
    ]);
    expect(JSON.parse(rollback.stdout)).toEqual({ table: 0, user: 0 });

    const readOnly = await failedDockerRun([
      "--env",
      "APPLICATION_URL=https://calories.example.test",
      "--env",
      "TRUST_PROXY=172.30.0.0/16",
      "--volume",
      `${durableVolume}:/app/data:ro`,
      image,
    ]);
    expect(readOnly.code).not.toBe(0);
    expect(readOnly.stderr).toContain('"event":"startup_failed"');

    const missingConfiguration = await failedDockerRun([image]);
    expect(missingConfiguration.code).not.toBe(0);
    expect(missingConfiguration.stderr).toContain('"event":"startup_failed"');
  }, 90_000);
});
