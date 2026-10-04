import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { initializeCredentialStorage, shutdownCredentialStorage } from "../app/credentials/runtime.server";
import { initializeApplicationDatabase, shutdownApplicationDatabase } from "../app/database/runtime.server";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "credential-runtime-"));
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  vi.stubEnv("APPLICATION_SECRETS_PATH", path.join(directory, "secrets"));
  initializeApplicationDatabase();
});

afterEach(async () => {
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { force: true, recursive: true });
});

test("credential runtime reuses one initialized bundle service for the active database and key", async () => {
  const first = await initializeCredentialStorage();
  const second = await initializeCredentialStorage();

  expect(second).toBe(first);
  expect(await readFile(path.join(directory, "secrets", "application-master.key"))).toHaveLength(32);
});

test("credential runtime can recover after master-key initialization fails", async () => {
  const directoryKeyPath = path.join(directory, "directory-key");
  await mkdir(directoryKeyPath, { mode: 0o700 });
  vi.stubEnv("APPLICATION_MASTER_KEY_PATH", directoryKeyPath);
  await expect(initializeCredentialStorage()).rejects.toThrow(
    "Application master key must be a regular file.",
  );

  const recoveredPath = path.join(directory, "recovered", "application-master.key");
  vi.stubEnv("APPLICATION_MASTER_KEY_PATH", recoveredPath);
  const recovered = await initializeCredentialStorage();
  expect(await recovered.status("sample-integration")).toEqual({ state: "unconfigured" });
  expect(await readFile(recoveredPath)).toHaveLength(32);
});
