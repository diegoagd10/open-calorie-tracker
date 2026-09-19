import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { openEncryptedCredentialBundles } from "../app/credentials/encrypted-credential-bundles.server";
import { DatabaseCredentialBundlePersistence } from "../app/database/credential-bundles.server";
import { openApplicationDatabase, type ApplicationDatabase } from "../app/database/database.server";
import {
  PhotoAnalysisCredentialInputError,
  PhotoAnalysisCredentialValidationError,
  PhotoAnalysisCredentials,
  ProviderCredentialRejectedError,
  type PhotoAnalysisCredentialValidator,
} from "../app/photo-analysis/credentials.server";

const validPair = {
  geminiKey: "AIzaSyGeminiCredential_1234567890",
  typeSafeKey: "ts_live_TypeSafeCredential_1234567890",
};
let directory: string;
let database: ApplicationDatabase;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "photo-credentials-"));
  database = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
});

afterEach(async () => {
  database.close();
  await rm(directory, { force: true, recursive: true });
});

async function service(validator: PhotoAnalysisCredentialValidator) {
  const bundles = await openEncryptedCredentialBundles({
    masterKeyPath: path.join(directory, "secrets", "application-master.key"),
    persistence: new DatabaseCredentialBundlePersistence(database.getClient()),
  });
  return new PhotoAnalysisCredentials(bundles, validator);
}

test("validates both provider keys before exposing only configured status", async () => {
  const validateGemini = vi.fn<(key: string) => Promise<void>>(async () => undefined);
  const validateTypeSafe = vi.fn<(key: string) => Promise<void>>(async () => undefined);
  const validator: PhotoAnalysisCredentialValidator = { validateGemini, validateTypeSafe };
  const credentials = await service(validator);

  expect(await credentials.status()).toEqual({ state: "unconfigured" });
  const status = await credentials.replace(validPair);

  expect(validateGemini).toHaveBeenCalledWith(validPair.geminiKey);
  expect(validateTypeSafe).toHaveBeenCalledWith(validPair.typeSafeKey);
  expect(status).toEqual({
    state: "configured",
    configuredAt: expect.any(String) as unknown,
    updatedAt: expect.any(String) as unknown,
    validatedAt: expect.any(String) as unknown,
  });
  expect(await credentials.status()).toEqual(status);
  expect(await credentials.read()).toEqual(validPair);
  expect(JSON.stringify(status)).not.toContain(validPair.geminiKey);
  expect(JSON.stringify(status)).not.toContain(validPair.typeSafeKey);
});

test.each([
  [{ ...validPair, geminiKey: "short" }, "geminiKey", "Gemini key"],
  [{ ...validPair, typeSafeKey: "contains whitespace in key" }, "typeSafeKey", "TypeSafe key"],
  [{ ...validPair, geminiKey: "x".repeat(513) }, "geminiKey", "Gemini key"],
] as const)("rejects bounded secret input without provider calls: %s", async (pair, field, message) => {
  const validateGemini = vi.fn<(key: string) => Promise<void>>(async () => undefined);
  const validateTypeSafe = vi.fn<(key: string) => Promise<void>>(async () => undefined);
  const validator: PhotoAnalysisCredentialValidator = { validateGemini, validateTypeSafe };
  const credentials = await service(validator);

  const failure: unknown = await credentials.replace(pair).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(PhotoAnalysisCredentialInputError);
  if (!(failure instanceof PhotoAnalysisCredentialInputError)) throw new Error("Expected input failure");
  expect(failure.fieldErrors[field]).toContain(message);
  expect(validateGemini).not.toHaveBeenCalled();
  expect(validateTypeSafe).not.toHaveBeenCalled();
  expect(await credentials.status()).toEqual({ state: "unconfigured" });
});

test("validation and persistence failures preserve the last known-good pair", async () => {
  const validateGemini = vi.fn<(key: string) => Promise<void>>(async () => undefined);
  const validateTypeSafe = vi.fn<(key: string) => Promise<void>>(async () => undefined);
  const validator: PhotoAnalysisCredentialValidator = { validateGemini, validateTypeSafe };
  const credentials = await service(validator);
  await credentials.replace(validPair);

  validateGemini.mockRejectedValueOnce(
    new ProviderCredentialRejectedError(),
  );
  validateTypeSafe.mockRejectedValueOnce(
    new Error(`remote failure containing ${validPair.typeSafeKey}`),
  );
  await expect(credentials.replace({
    geminiKey: "AIzaSyReplacementGemini_1234567890",
    typeSafeKey: "ts_live_ReplacementTypeSafe_1234567890",
  })).rejects.toEqual(new PhotoAnalysisCredentialValidationError({
    geminiKey: "Gemini rejected this key.",
    typeSafeKey: "TypeSafe credential validation is temporarily unavailable.",
  }));
  expect(await credentials.read()).toEqual(validPair);

  database.getClient().run(sql.raw(`
    CREATE TRIGGER reject_photo_credential_update
    BEFORE UPDATE ON encrypted_credential_bundles
    BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END
  `));
  await expect(credentials.replace({
    geminiKey: "AIzaSyPersistGemini_1234567890",
    typeSafeKey: "ts_live_PersistTypeSafe_1234567890",
  })).rejects.toThrow("simulated write failure");
  database.getClient().run(sql`DROP TRIGGER reject_photo_credential_update`);
  expect(await credentials.read()).toEqual(validPair);
});

test("deletion changes future reads without mutating a pair already captured by a caller", async () => {
  const credentials = await service({
    validateGemini: async () => undefined,
    validateTypeSafe: async () => undefined,
  });
  await credentials.replace(validPair);
  const captured = await credentials.read();

  expect(await credentials.remove()).toBe(true);
  expect(await credentials.read()).toBeUndefined();
  expect(await credentials.status()).toEqual({ state: "unconfigured" });
  expect(captured).toEqual(validPair);
});

test("lost master-key status remains non-secret and a validated pair can replace it", async () => {
  const validator = {
    validateGemini: async () => undefined,
    validateTypeSafe: async () => undefined,
  };
  const credentials = await service(validator);
  await credentials.replace(validPair);
  await rm(path.join(directory, "secrets", "application-master.key"));

  const recovered = await service(validator);
  expect(await recovered.status()).toMatchObject({ state: "unreadable" });
  await expect(recovered.read()).rejects.toThrow("Credential bundle is unreadable.");
  await recovered.replace({
    geminiKey: "AIzaSyRecoveredGemini_1234567890",
    typeSafeKey: "ts_live_RecoveredTypeSafe_1234567890",
  });
  expect(await recovered.status()).toMatchObject({ state: "configured" });
});

test("authenticated but malformed feature payloads are unreadable", async () => {
  const bundles = await openEncryptedCredentialBundles({
    masterKeyPath: path.join(directory, "secrets", "application-master.key"),
    persistence: new DatabaseCredentialBundlePersistence(database.getClient()),
  });
  await bundles.replace("photo-analysis", Buffer.from("not a Photo Analysis payload"));
  const credentials = new PhotoAnalysisCredentials(bundles, {
    validateGemini: async () => undefined,
    validateTypeSafe: async () => undefined,
  });

  await expect(credentials.read()).rejects.toThrow("Credential bundle is unreadable.");
  expect(await credentials.status()).toMatchObject({ state: "unreadable" });
});
