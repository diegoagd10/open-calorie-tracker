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
  | { state: "unavailable"; code: PhotoAnalysisReadinessCode };

export type PresentedPhotoAnalysisReadiness =
  | { state: "ready" }
  | { state: "unavailable"; reason: string; destination?: string };

export type CredentialStatusReader = {
  status(): Promise<PhotoAnalysisCredentialStatus>;
};

export type SettingsReadinessReader = {
  readSettings(): Promise<{ ready: boolean; reason?: string }>;
};

const administratorPresentation: Record<
  PhotoAnalysisReadinessCode,
  { reason: string; destination: string }
> = {
  "missing-credentials": {
    reason: "Configure Gemini and TypeSafe credentials.",
    destination: "/settings/ai",
  },
  "unreadable-credentials": {
    reason: "Repair the Photo Analysis credential encryption setup.",
    destination: "/settings/ai",
  },
  "unavailable-models": {
    reason: "Refresh the selected Gemini and Jev models.",
    destination: "/settings/ai",
  },
  "catalog-not-installed": {
    reason: "Install USDA Foundation for Photo Analysis.",
    destination: "/settings/catalogs",
  },
  "catalog-reimport-required": {
    reason: "Reimport USDA Foundation for Photo Analysis.",
    destination: "/settings/catalogs",
  },
  "catalog-unavailable": {
    reason: "Repair or reimport USDA Foundation for Photo Analysis.",
    destination: "/settings/catalogs",
  },
};

const memberReason = "AI photo analysis is not available right now.";

export function presentPhotoAnalysisReadiness(
  readiness: PhotoAnalysisReadiness,
  role: "admin" | "member",
  modelReason?: string,
): PresentedPhotoAnalysisReadiness {
  if (readiness.state === "ready") return readiness;
  if (role === "member") {
    return { state: "unavailable", reason: memberReason };
  }
  const presentation = administratorPresentation[readiness.code];
  return {
    state: "unavailable",
    reason:
      readiness.code === "unavailable-models" && modelReason
        ? modelReason
        : presentation.reason,
    destination: presentation.destination,
  };
}

export class PhotoAnalysisUnavailableError extends Error {
  constructor(readonly code: PhotoAnalysisReadinessCode) {
    super(memberReason);
    this.name = "PhotoAnalysisUnavailableError";
  }

  forRole(
    role: "admin" | "member",
  ): Extract<PresentedPhotoAnalysisReadiness, { state: "unavailable" }> {
    return presentPhotoAnalysisReadiness(
      { state: "unavailable", code: this.code },
      role,
    ) as Extract<PresentedPhotoAnalysisReadiness, { state: "unavailable" }>;
  }
}

export class PhotoAnalysisReadinessService {
  constructor(
    private readonly credentials: CredentialStatusReader,
    private readonly settings: SettingsReadinessReader,
    private readonly catalog: Pick<UsdaPhotoAnalysisCatalog, "photoAnalysisReadiness">,
  ) {}

  async read(): Promise<PhotoAnalysisReadiness> {
    const { readiness } = await this.inspect();
    return readiness;
  }

  private async inspect(): Promise<{
    readiness: PhotoAnalysisReadiness;
    modelReason?: string;
  }> {
    let credentials: PhotoAnalysisCredentialStatus;
    try {
      credentials = await this.credentials.status();
    } catch {
      return {
        readiness: { state: "unavailable", code: "unreadable-credentials" },
      };
    }
    if (credentials.state === "unconfigured") {
      return {
        readiness: { state: "unavailable", code: "missing-credentials" },
      };
    }
    if (credentials.state === "unreadable") {
      return {
        readiness: { state: "unavailable", code: "unreadable-credentials" },
      };
    }
    let settings: { ready: boolean; reason?: string };
    try {
      settings = await this.settings.readSettings();
    } catch {
      return {
        readiness: { state: "unavailable", code: "unavailable-models" },
      };
    }
    if (!settings.ready) {
      return {
        readiness: { state: "unavailable", code: "unavailable-models" },
        modelReason: settings.reason,
      };
    }
    try {
      return {
        readiness: catalogReadiness(await this.catalog.photoAnalysisReadiness()),
      };
    } catch {
      return {
        readiness: { state: "unavailable", code: "catalog-unavailable" },
      };
    }
  }

  async forRole(
    role: "admin" | "member",
  ): Promise<PresentedPhotoAnalysisReadiness> {
    const { readiness, modelReason } = await this.inspect();
    return presentPhotoAnalysisReadiness(readiness, role, modelReason);
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
