import type {
  UsdaPhotoAnalysisCatalog,
  UsdaPhotoAnalysisSnapshot,
} from "../catalog/usda-evidence";
import type { PhotoAnalysisAttemptConfiguration } from "./configuration.server";
import {
  GeminiHttpMealClient,
  JevHttpChoiceClient,
} from "./gemini-jev-clients.server";
import {
  GeminiJevPhotoAnalyzer,
  type GeminiMealClient,
  type JevChoiceClient,
} from "./gemini-jev.server";
import type { PhotoAnalyzer } from "./photo-analysis.server";
import type { PhotoAnalysisConfigurationSnapshot } from "./provenance.server";

export type PhotoAnalysisAttemptLease = {
  analyzer: PhotoAnalyzer;
  configuration: PhotoAnalysisConfigurationSnapshot | null;
  release(): void;
};

export interface PhotoAnalysisAttemptSource {
  capture(signal: AbortSignal): Promise<PhotoAnalysisAttemptLease>;
}

export interface PhotoAnalysisAttemptConfigurationReader {
  captureAttemptConfiguration(
    signal: AbortSignal,
  ): Promise<PhotoAnalysisAttemptConfiguration>;
}

export type PhotoAnalysisProviderClientFactory = {
  gemini(key: string): GeminiMealClient;
  jev(key: string): JevChoiceClient;
};

const remoteClients: PhotoAnalysisProviderClientFactory = {
  gemini: (key) => new GeminiHttpMealClient(key),
  jev: (key) => new JevHttpChoiceClient(key),
};

export class GeminiJevPhotoAnalysisAttemptSource
implements PhotoAnalysisAttemptSource {
  constructor(
    private readonly configuration: PhotoAnalysisAttemptConfigurationReader,
    private readonly catalog: UsdaPhotoAnalysisCatalog,
    private readonly clients: PhotoAnalysisProviderClientFactory = remoteClients,
  ) {}

  async capture(signal: AbortSignal): Promise<PhotoAnalysisAttemptLease> {
    signal.throwIfAborted();
    const configuration =
      await this.configuration.captureAttemptConfiguration(signal);
    signal.throwIfAborted();
    return await this.captureCatalogLease(configuration, signal);
  }

  private async captureCatalogLease(
    configuration: PhotoAnalysisAttemptConfiguration,
    signal: AbortSignal,
  ): Promise<PhotoAnalysisAttemptLease> {
    return await new Promise<PhotoAnalysisAttemptLease>((resolve, reject) => {
      let captured = false;
      void this.catalog
        .withPhotoAnalysisSnapshot(signal, async (snapshot) => {
          let release!: () => void;
          let released = false;
          const held = new Promise<void>((done) => {
            release = () => {
              if (released) return;
              released = true;
              done();
            };
          });
          captured = true;
          resolve({
            analyzer: this.analyzer(configuration, snapshot),
            configuration: {
              catalogGeneration: snapshot.generation,
              geminiModel: configuration.geminiModel,
              jevModel: configuration.jevModel,
              categoryConfidenceThreshold:
                configuration.categoryConfidenceThreshold,
              productConfidenceThreshold:
                configuration.productConfidenceThreshold,
            },
            release,
          });
          await held;
        })
        .catch((error: unknown) => {
          if (!captured) reject(error instanceof Error ? error : new Error("Catalog unavailable"));
        });
    });
  }

  private analyzer(
    configuration: PhotoAnalysisAttemptConfiguration,
    snapshot: UsdaPhotoAnalysisSnapshot,
  ) {
    const catalog = capturedCatalog(snapshot);
    return new GeminiJevPhotoAnalyzer(
      this.clients.gemini(configuration.geminiKey),
      this.clients.jev(configuration.typeSafeKey),
      catalog,
      {
        geminiModel: configuration.geminiModel,
        jevModel: configuration.jevModel,
        categoryConfidenceThreshold: configuration.categoryConfidenceThreshold,
        productConfidenceThreshold: configuration.productConfidenceThreshold,
      },
    );
  }
}

function capturedCatalog(
  snapshot: UsdaPhotoAnalysisSnapshot,
): UsdaPhotoAnalysisCatalog {
  return {
    photoAnalysisReadiness: async () => ({
      state: "ready",
      generation: snapshot.generation,
    }),
    withPhotoAnalysisSnapshot: async (signal, read) => {
      signal.throwIfAborted();
      return await read(snapshot);
    },
  };
}

export function fixedPhotoAnalysisAttemptSource(
  analyzer: PhotoAnalyzer,
): PhotoAnalysisAttemptSource {
  return {
    capture: async (signal) => {
      signal.throwIfAborted();
      return {
        analyzer,
        configuration: analyzer.configurationSnapshot?.() ?? null,
        release: () => undefined,
      };
    },
  };
}
