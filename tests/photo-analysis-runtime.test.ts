import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../app/database/runtime.server";
import {
  getPhotoAnalysisConfiguration,
  getPhotoAnalysisCredentialStatus,
  getPhotoAnalysisCredentials,
  getPhotoAnalysisReadiness,
  getPhotoAnalysisService,
  shutdownPhotoAnalysis,
} from "../app/photo-analysis/runtime.server";

let directory: string | undefined;

async function initialize() {
  directory = await mkdtemp(path.join(tmpdir(), "photo-runtime-"));
  process.env.DATABASE_PATH = path.join(directory, "application.sqlite");
  process.env.APPLICATION_SECRETS_PATH = path.join(directory, "secrets");
  delete process.env.PHOTO_ANALYSIS_TEST_FIXTURE;
  delete process.env.PHOTO_CREDENTIAL_VALIDATION_TEST_FIXTURE;
  delete process.env.PHOTO_MODEL_DISCOVERY_TEST_FIXTURE;
  initializeApplicationDatabase();
}

afterEach(async () => {
  shutdownPhotoAnalysis();
  shutdownApplicationDatabase();
  for (const name of [
    "DATABASE_PATH",
    "APPLICATION_SECRETS_PATH",
    "PHOTO_ANALYSIS_TEST_FIXTURE",
    "PHOTO_CREDENTIAL_VALIDATION_TEST_FIXTURE",
    "PHOTO_MODEL_DISCOVERY_TEST_FIXTURE",
  ]) delete process.env[name];
  if (directory) await rm(directory, { force: true, recursive: true });
  directory = undefined;
});

test("production runtime constructs Gemini/Jev services and reports missing credentials", async () => {
  await initialize();
  const service = getPhotoAnalysisService();
  expect(getPhotoAnalysisService()).toBe(service);
  await expect(getPhotoAnalysisCredentials()).resolves.toBeDefined();
  await expect(getPhotoAnalysisConfiguration()).resolves.toBeDefined();
  await expect(getPhotoAnalysisReadiness()).resolves.toEqual({
    state: "unavailable",
    code: "missing-credentials",
  });
});

test("unusable master-key storage becomes a non-disclosing readiness failure", async () => {
  await initialize();
  if (!directory) throw new Error("Runtime fixture directory was not created");
  const blockedPath = path.join(directory, "not-a-directory");
  await writeFile(blockedPath, "blocked");
  process.env.APPLICATION_SECRETS_PATH = blockedPath;
  await expect(getPhotoAnalysisCredentialStatus()).resolves.toEqual({
    state: "storage-unavailable",
  });
  await expect(getPhotoAnalysisReadiness()).resolves.toEqual({
    state: "unavailable",
    code: "unreadable-credentials",
  });

  process.env.APPLICATION_SECRETS_PATH = path.join(directory, "repaired-secrets");
  await expect(getPhotoAnalysisCredentialStatus()).resolves.toEqual({
    state: "unconfigured",
  });
  await expect(getPhotoAnalysisConfiguration()).resolves.toBeDefined();
});
