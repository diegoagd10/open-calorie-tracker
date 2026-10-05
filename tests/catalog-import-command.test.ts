import { mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, expect, test, vi } from "vitest";

import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import {
  ensureLocalCatalogImportToken,
  localCatalogImportTokenMatches,
  readLocalCatalogImportToken,
} from "../app/catalog-management/local-import-control.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { runCatalogImportCommand } from "../server/import-catalog";
import {
  isLoopbackAddress,
  mountLocalCatalogImport,
} from "../server/local-catalog-import";
import { foundationArchive } from "./support/foundation-archive";

const controlToken = "a".repeat(64);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllEnvs();
});

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-command-"));
  const database = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  const management = new CatalogManagement(database.getClient(), {
    directory: path.join(directory, "catalogs"),
    maxExpandedBytes: 16 * 1024 * 1024,
    maxUploadBytes: 2 * 1024 * 1024,
    workerPath: path.resolve("app/catalog-management/import-worker.ts"),
  });
  const app = express();
  mountLocalCatalogImport(app, {
    controlToken,
    getManagement: () => management,
  });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");

  cleanups.push(async () => {
    await closeServer(server);
    await management.shutdown();
    database.close();
    await rm(directory, { force: true, recursive: true });
  });
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    directory,
    management,
  };
}

test(
  "imports a local USDA archive through the running application and waits for its outcome",
  async () => {
    const provider = "usda-fdc";
    const filename = "foundation.zip";
    const { baseUrl, directory, management } = await fixture();
    const archivePath = path.join(directory, filename);
    await writeFile(archivePath, await foundationArchive());
    const standardOutput: string[] = [];
    const standardError: string[] = [];

    const exitCode = await runCatalogImportCommand([provider, archivePath], {
      baseUrl,
      controlToken,
      pollIntervalMs: 1,
      writeStandardError: (value) => standardError.push(value),
      writeStandardOutput: (value) => standardOutput.push(value),
    });

    expect(exitCode).toBe(0);
    expect(standardError).toEqual([]);
    expect(standardOutput.join("")).toContain("USDA Foundation");
    expect(standardOutput.join("")).toContain("succeeded; ");
    expect(management.read()).toMatchObject({
      busy: false,
      installed: { filename },
      job: { error: null, phase: "succeeded" },
    });
    expect(management.outcomes()[0]).toMatchObject({ phase: "succeeded", operation: "install" });
    const firstGeneration = management.read().installed!.generation;
    expect(await runCatalogImportCommand([provider, archivePath], {
      baseUrl, controlToken, pollIntervalMs: 1,
      writeStandardError: value => standardError.push(value),
      writeStandardOutput: value => standardOutput.push(value),
    })).toBe(0);
    expect(management.read().installed!.generation).not.toBe(firstGeneration);
    expect(management.outcomes().find(outcome => outcome.jobId !== firstGeneration)).toMatchObject({ phase: "succeeded", operation: "update" });

  },
);

test("rejects a symbolic link before contacting the application", async () => {
  const { baseUrl, directory, management } = await fixture();
  const target = path.join(directory, "target.zip");
  const archivePath = path.join(directory, "foundation.zip");
  await writeFile(target, await foundationArchive());
  await symlink(target, archivePath);
  const standardError: string[] = [];

  const exitCode = await runCatalogImportCommand(
    ["usda-fdc", archivePath],
    {
      baseUrl,
      controlToken,
      writeStandardError: (value) => standardError.push(value),
      writeStandardOutput: () => undefined,
    },
  );

  expect(exitCode).toBe(1);
  expect(standardError.join("")).toContain("non-empty regular file");
  expect(management.read().job).toBeNull();
});

test("reports importer failure and returns a non-zero exit code", async () => {
  const { baseUrl, directory, management } = await fixture();
  const archivePath = path.join(directory, "invalid.zip");
  await writeFile(archivePath, "not a zip archive");
  const standardError: string[] = [];

  const exitCode = await runCatalogImportCommand(
    ["usda-fdc", archivePath],
    {
      baseUrl,
      controlToken,
      pollIntervalMs: 1,
      writeStandardError: (value) => standardError.push(value),
      writeStandardOutput: () => undefined,
    },
  );

  expect(exitCode).toBe(1);
  expect(standardError.join("")).toContain("USDA Foundation import failed:");
  expect(management.read()).toMatchObject({
    busy: false,
    installed: null,
    job: { phase: "failed" },
  });
});

test("the local endpoint requires both loopback transport and its private token", async () => {
  const { baseUrl } = await fixture();
  const withoutToken = await fetch(`${baseUrl}/internal/catalog-imports`, {
    body: JSON.stringify({ archivePath: "/tmp/archive.zip", provider: "usda-fdc" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  expect(withoutToken.status).toBe(404);
  expect(isLoopbackAddress("127.0.0.1")).toBe(true);
  expect(isLoopbackAddress("::1")).toBe(true);
  expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  expect(isLoopbackAddress("172.22.0.4")).toBe(false);
});

test("the local endpoint rejects invalid requests without claiming an import", async () => {
  const { baseUrl, directory, management } = await fixture();
  const headers = {
    Authorization: `Bearer ${controlToken}`,
    "Content-Type": "application/json",
  };
  const invalidRequest = await fetch(`${baseUrl}/internal/catalog-imports`, {
    body: JSON.stringify({ archivePath: "relative.zip", provider: "usda-fdc" }),
    headers,
    method: "POST",
  });
  const missingArchive = await fetch(`${baseUrl}/internal/catalog-imports`, {
    body: JSON.stringify({
      archivePath: path.join(directory, "missing.zip"),
      provider: "usda-fdc",
    }),
    headers,
    method: "POST",
  });
  const wrongExtensionPath = path.join(directory, "foundation.gz");
  await writeFile(wrongExtensionPath, "not a USDA archive");
  const wrongExtension = await fetch(`${baseUrl}/internal/catalog-imports`, {
    body: JSON.stringify({
      archivePath: wrongExtensionPath,
      provider: "usda-fdc",
    }),
    headers,
    method: "POST",
  });
  const invalidStatus = await fetch(
    `${baseUrl}/internal/catalog-imports/usda-fdc/not-a-uuid`,
    { headers },
  );
  const missingStatus = await fetch(
    `${baseUrl}/internal/catalog-imports/usda-fdc/00000000-0000-4000-8000-000000000000`,
    { headers },
  );

  expect(invalidRequest.status).toBe(400);
  expect(missingArchive.status).toBe(400);
  expect(wrongExtension.status).toBe(409);
  expect(invalidStatus.status).toBe(400);
  expect(missingStatus.status).toBe(404);
  expect(management.read().job).toBeNull();
});

test("the private control token is durable, permission-restricted, and validated", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-control-token-"));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  vi.stubEnv("CATALOG_DIRECTORY", directory);

  const created = await ensureLocalCatalogImportToken();

  expect(created).toMatch(/^[a-f0-9]{64}$/);
  expect(await ensureLocalCatalogImportToken()).toBe(created);
  expect(await readLocalCatalogImportToken()).toBe(created);
  expect((await stat(path.join(directory, ".local-import-token"))).mode & 0o777).toBe(
    0o600,
  );
  expect(localCatalogImportTokenMatches(created, `Bearer ${created}`)).toBe(true);
  expect(localCatalogImportTokenMatches(created, "Basic credentials")).toBe(false);
  expect(localCatalogImportTokenMatches(created, `Bearer ${"é".repeat(64)}`)).toBe(
    false,
  );

  await writeFile(path.join(directory, ".local-import-token"), "invalid\n");
  await expect(readLocalCatalogImportToken()).rejects.toThrow("token is invalid");
});

test.each(["other", "open-food-facts"])("prints command usage for the unsupported provider %s", async (provider) => {
  const standardError: string[] = [];

  const exitCode = await runCatalogImportCommand(
    [provider, "/tmp/archive.zip"],
    {
      controlToken,
      writeStandardError: (value) => standardError.push(value),
      writeStandardOutput: () => undefined,
    },
  );

  expect(exitCode).toBe(1);
  expect(standardError.join("")).toContain("pnpm catalog:import:usda");
  expect(standardError.join("")).not.toContain("catalog:import:off");
});
