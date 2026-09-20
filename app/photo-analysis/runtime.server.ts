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
import { TestPhotoAnalysisCredentialValidator, TestPhotoAnalysisModelDiscovery, TestPhotoAnalyzer } from "./test-fixture.server";
import {
  fixedPhotoAnalysisAttemptSource,
  GeminiJevPhotoAnalysisAttemptSource,
  readinessGatedPhotoAnalysisAttemptSource,
} from "./attempts.server";
import {
  PhotoAnalysisReadinessService,
  PhotoAnalysisUnavailableError,
  presentPhotoAnalysisReadiness,
  type PhotoAnalysisReadiness,
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
  const readiness = fixture ? fixtureReadiness(db) : undefined;
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

const TEST_READINESS_KEY = "photo_analysis_test_readiness";

function fixtureReadiness(db: ApplicationDatabaseClient) {
  const metadata = createDatabaseApplicationMetadata(db);
  return {
    read: async (): Promise<PhotoAnalysisReadiness> => {
      const stored = metadata.read(TEST_READINESS_KEY);
      if (!stored) return { state: "ready" };
      const code = z.enum([
        "missing-credentials",
        "unreadable-credentials",
        "unavailable-models",
        "catalog-not-installed",
        "catalog-reimport-required",
        "catalog-unavailable",
      ]).parse(stored);
      return { state: "unavailable", code };
    },
  };
}

export async function getPhotoAnalysisReadiness(
  role: "admin" | "member",
) {
  const db = getApplicationDatabase().getClient();
  const config = environmentSchema.parse(process.env);
  if (
    process.env.NODE_ENV === "test" &&
    config.PHOTO_ANALYSIS_TEST_FIXTURE === "1"
  ) {
    return presentPhotoAnalysisReadiness(await fixtureReadiness(db).read(), role);
  }
  try {
    const service = new PhotoAnalysisReadinessService(
      await getPhotoAnalysisCredentials(),
      await getPhotoAnalysisConfiguration(),
      getUsdaPhotoAnalysisCatalog(),
    );
    return await service.forRole(role);
  } catch {
    return new PhotoAnalysisUnavailableError("unreadable-credentials").forRole(
      role,
    );
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
