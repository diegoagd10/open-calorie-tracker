import { z } from "zod";
import { getApplicationDatabase } from "../database/runtime.server";
import { createDatabaseApplicationMetadata } from "../database/application-metadata.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { initializeCredentialStorage, shutdownCredentialStorage } from "../credentials/runtime.server";
import { getUsdaAnalysisReader, getUsdaPhotoAnalysisCatalog } from "../catalog/runtime.server";
import { PhotoAnalysisService } from "./photo-analysis.server";
import { PhotoAnalysisCredentials } from "./credentials.server";
import { RemotePhotoAnalysisCredentialValidator } from "./provider-credential-validation.server";
import { PhotoAnalysisConfigurationService } from "./configuration.server";
import { RemotePhotoAnalysisModelDiscovery } from "./model-discovery.server";
import { TestPhotoAnalysisCredentialValidator, TestPhotoAnalysisModelDiscovery, TestPhotoAnalysisReadiness, TestPhotoAnalyzer } from "./test-fixture.server";
import {
  fixedPhotoAnalysisAttemptSource,
  GeminiJevPhotoAnalysisAttemptSource,
  readinessGatedPhotoAnalysisAttemptSource,
} from "./attempts.server";
import {
  PhotoAnalysisReadinessService,
  type PhotoAnalysisReadiness,
  type PhotoAnalysisReadinessInput,
} from "./readiness.server";

const environmentSchema = z.object({
  PHOTO_ANALYSIS_TEST_FIXTURE: z.enum(["0", "1"]).optional(),
  PHOTO_CREDENTIAL_VALIDATION_TEST_FIXTURE: z.enum(["0", "1"]).optional(),
  PHOTO_MODEL_DISCOVERY_TEST_FIXTURE: z.enum(["0", "1"]).optional(),
  FOOD_LOG_TEST_NOW: z.string().optional(),
});
let current:
  | { db: ApplicationDatabaseClient; service: PhotoAnalysisService }
  | undefined;

export function getPhotoAnalysisService() {
  const db = getApplicationDatabase().getClient();
  if (current?.db === db) return current.service;
  const config = environmentSchema.parse(process.env);
  const test = process.env.NODE_ENV === "test";
  const fixture = test && config.PHOTO_ANALYSIS_TEST_FIXTURE === "1";
  const readiness = fixture
    ? new TestPhotoAnalysisReadiness(createDatabaseApplicationMetadata(db))
    : undefined;
  const attempts = fixture
    ? readinessGatedPhotoAnalysisAttemptSource(
        fixedPhotoAnalysisAttemptSource(new TestPhotoAnalyzer()),
        readiness!,
      )
    : new GeminiJevPhotoAnalysisAttemptSource(
        {
          captureAttemptConfiguration: async (signal) =>
            await (
              await getPhotoAnalysisConfiguration()
            ).captureAttemptConfiguration(signal),
        },
        getUsdaPhotoAnalysisCatalog(),
      );
  const service = new PhotoAnalysisService(
    db,
    attempts,
    {
      now:
        test && config.FOOD_LOG_TEST_NOW
          ? () => new Date(config.FOOD_LOG_TEST_NOW!)
          : undefined,
      ...(fixture ? { usda: getUsdaAnalysisReader() } : {}),
    },
  );
  current = { db, service };
  return service;
}

export async function getPhotoAnalysisReadiness(
  input?: PhotoAnalysisReadinessInput,
): Promise<PhotoAnalysisReadiness> {
  const db = getApplicationDatabase().getClient();
  const config = environmentSchema.parse(process.env);
  if (
    process.env.NODE_ENV === "test" &&
    config.PHOTO_ANALYSIS_TEST_FIXTURE === "1"
  ) {
    return await new TestPhotoAnalysisReadiness(
      createDatabaseApplicationMetadata(db),
    ).read();
  }
  try {
    const service = new PhotoAnalysisReadinessService(
      await getPhotoAnalysisCredentials(),
      await getPhotoAnalysisConfiguration(),
      getUsdaPhotoAnalysisCatalog(),
    );
    return await service.read(input);
  } catch {
    return { state: "unavailable", code: "unreadable-credentials" };
  }
}

let credentials: Promise<PhotoAnalysisCredentials> | undefined;

export function getPhotoAnalysisCredentials(): Promise<PhotoAnalysisCredentials> {
  credentials ??= initializeCredentialStorage().then(bundles => {
    const config = environmentSchema.parse(process.env);
    const validator = process.env.NODE_ENV === "test" && config.PHOTO_CREDENTIAL_VALIDATION_TEST_FIXTURE === "1"
      ? new TestPhotoAnalysisCredentialValidator()
      : new RemotePhotoAnalysisCredentialValidator();
    return new PhotoAnalysisCredentials(bundles, validator);
  });
  return credentials;
}

export async function getPhotoAnalysisCredentialStatus() {
  try {
    return await (await getPhotoAnalysisCredentials()).status();
  } catch {
    return { state: "storage-unavailable" as const };
  }
}

let configuration: Promise<PhotoAnalysisConfigurationService> | undefined;

export function getPhotoAnalysisConfiguration(): Promise<PhotoAnalysisConfigurationService> {
  configuration ??= getPhotoAnalysisCredentials().then(credentialService => {
    const config = environmentSchema.parse(process.env);
    const discovery = process.env.NODE_ENV === "test" && config.PHOTO_MODEL_DISCOVERY_TEST_FIXTURE === "1"
      ? new TestPhotoAnalysisModelDiscovery()
      : new RemotePhotoAnalysisModelDiscovery();
    return new PhotoAnalysisConfigurationService(
      createDatabaseApplicationMetadata(getApplicationDatabase().getClient()),
      credentialService,
      discovery,
    );
  });
  return configuration;
}

export function shutdownPhotoAnalysis() {
  current?.service.shutdown();
  current = undefined;
  credentials = undefined;
  configuration = undefined;
  shutdownCredentialStorage();
}
