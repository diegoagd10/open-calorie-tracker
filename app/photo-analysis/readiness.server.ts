import type {
  UsdaPhotoAnalysisCatalog,
  UsdaPhotoAnalysisReadiness,
} from "../catalog/usda-evidence";
import type { PhotoAnalysisCredentialStatus } from "./credentials.server";

export type PhotoAnalysisReadinessCode =
  | "missing-credentials"
  | "unreadable-credentials"
  | "unavailable-models"
  | "catalog-not-installed"
  | "catalog-reimport-required"
  | "catalog-unavailable";

export type PhotoAnalysisReadiness =
  | { state: "ready" }
  | {
      state: "unavailable";
      code: PhotoAnalysisReadinessCode;
      detail?: string;
    };

export type CredentialStatusReader = {
  status(): Promise<PhotoAnalysisCredentialStatus>;
};

export type SettingsReadiness = { ready: boolean; reason?: string };

export type SettingsReadinessReader = {
  readSettings(): Promise<SettingsReadiness>;
};

export type PhotoAnalysisReadinessInput = {
  credentials: PhotoAnalysisCredentialStatus;
  settings?: SettingsReadiness;
};

export class PhotoAnalysisUnavailableError extends Error {
  constructor(readonly code: PhotoAnalysisReadinessCode) {
    super("Photo Analysis is unavailable.");
    this.name = "PhotoAnalysisUnavailableError";
  }
}

export class PhotoAnalysisReadinessService {
  constructor(
    private readonly credentials: CredentialStatusReader,
    private readonly settings: SettingsReadinessReader,
    private readonly catalog: Pick<UsdaPhotoAnalysisCatalog, "photoAnalysisReadiness">,
  ) {}

  async read(
    input?: PhotoAnalysisReadinessInput,
  ): Promise<PhotoAnalysisReadiness> {
    let credentials = input?.credentials;
    if (!credentials) {
      try {
        credentials = await this.credentials.status();
      } catch {
        return { state: "unavailable", code: "unreadable-credentials" };
      }
    }
    if (credentials.state === "unconfigured") {
      return { state: "unavailable", code: "missing-credentials" };
    }
    if (
      credentials.state === "unreadable" ||
      credentials.state === "storage-unavailable"
    ) {
      return { state: "unavailable", code: "unreadable-credentials" };
    }
    let settings = input?.settings;
    if (!settings) {
      try {
        settings = await this.settings.readSettings();
      } catch {
        return { state: "unavailable", code: "unavailable-models" };
      }
    }
    if (!settings.ready) {
      return {
        state: "unavailable",
        code: "unavailable-models",
        ...(settings.reason ? { detail: settings.reason } : {}),
      };
    }
    try {
      return catalogReadiness(await this.catalog.photoAnalysisReadiness());
    } catch {
      return { state: "unavailable", code: "catalog-unavailable" };
    }
  }
}

function catalogReadiness(
  readiness: UsdaPhotoAnalysisReadiness,
): PhotoAnalysisReadiness {
  switch (readiness.state) {
    case "ready":
      return { state: "ready" };
    case "not-installed":
      return { state: "unavailable", code: "catalog-not-installed" };
    case "reimport-required":
      return { state: "unavailable", code: "catalog-reimport-required" };
    case "unavailable":
      return { state: "unavailable", code: "catalog-unavailable" };
  }
}
