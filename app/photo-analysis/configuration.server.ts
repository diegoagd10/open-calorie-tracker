import { z } from "zod";

import type { PhotoAnalysisCredentialPair } from "./credentials.server";

const CONFIGURATION_KEY = "photo_analysis_configuration";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_JEV_MODEL = "jev-1.13.0";

type GeminiCompatibility = { label: string; lowLatency?: boolean };
const GEMINI_COMPATIBILITY_CATALOG: Readonly<Record<string, GeminiCompatibility>> = {
  "gemini-2.5-pro": { label: "Gemini 2.5 Pro" },
  "gemini-3.1-flash-lite": { label: "Gemini 3.1 Flash-Lite", lowLatency: true },
  "gemini-3.5-flash": { label: "Gemini 3.5 Flash", lowLatency: true },
  "gemini-3.5-flash-lite": { label: "Gemini 3.5 Flash-Lite", lowLatency: true },
  "gemini-3.6-flash": { label: "Gemini 3.6 Flash", lowLatency: true },
  "gemini-3.7-flash": { label: "Gemini 3.7 Flash", lowLatency: true },
  "gemini-3.8-flash": { label: "Gemini 3.8 Flash", lowLatency: true },
};

const thresholdSchema = z.number().finite().min(0).max(1);
const profileSchema = z.object({
  categoryConfidenceThreshold: thresholdSchema,
  productConfidenceThreshold: thresholdSchema,
  calibrated: z.boolean(),
}).strict();
const storedConfigurationSchema = z.object({
  version: z.literal(1),
  geminiModel: z.string().min(1).max(100),
  jevModel: z.string().min(1).max(100),
  profiles: z.record(z.string(), profileSchema),
}).strict();

export type GeminiDiscoveredModel = {
  id: string;
  displayName: string;
  methods: string[];
};
export type JevDiscoveredModel = { id: string; effectiveId: string };

export interface PhotoAnalysisModelDiscovery {
  discoverGemini: (key: string, signal: AbortSignal) => Promise<GeminiDiscoveredModel[]>;
  discoverJev: (key: string, signal: AbortSignal) => Promise<JevDiscoveredModel[]>;
}

export interface PhotoAnalysisCredentialReader {
  read: () => Promise<PhotoAnalysisCredentialPair | undefined>;
}

export interface PhotoAnalysisConfigurationPersistence {
  read: (key: string) => string | undefined;
  replace: (key: string, value: string, updatedAt: string) => void;
}

export type ModelDiscoveryFailureKind = "permanent-incompatibility" | "transient-availability";

export class ModelDiscoveryError extends Error {
  constructor(readonly kind: ModelDiscoveryFailureKind) {
    super(kind === "permanent-incompatibility"
      ? "Provider model discovery is incompatible with this configuration."
      : "Provider model discovery is temporarily unavailable.");
    this.name = "ModelDiscoveryError";
  }
}

export type ModelOption = { id: string; label: string; lowLatency?: boolean };
export type JevThresholdProfile = z.infer<typeof profileSchema>;
export type ModelDiscoveryState =
  | { state: "available"; models: ModelOption[] }
  | { state: "unconfigured"; models: [] }
  | { state: "transient-error" | "incompatible"; models: []; message: string };

export type PhotoAnalysisSettingsSnapshot = {
  configuration: {
    geminiModel: string;
    jevModel: string;
    categoryConfidenceThreshold: number;
    productConfidenceThreshold: number;
    calibrated: boolean;
  };
  gemini: ModelDiscoveryState;
  jev: ModelDiscoveryState;
  profiles: Record<string, JevThresholdProfile>;
  ready: boolean;
  reason?: string;
};

export type PhotoAnalysisConfigurationInput = {
  geminiModel: string;
  jevModel: string;
  categoryConfidenceThreshold: number;
  productConfidenceThreshold: number;
};
export type PhotoAnalysisConfigurationFieldErrors = Partial<Record<keyof PhotoAnalysisConfigurationInput, string>>;

export type PhotoAnalysisAttemptConfiguration = PhotoAnalysisConfigurationInput &
  PhotoAnalysisCredentialPair;

export class PhotoAnalysisAttemptConfigurationUnavailableError extends Error {
  constructor(
    readonly reason: "missing-credentials" | "unavailable-models" =
      "unavailable-models",
  ) {
    super("Photo Analysis configuration is unavailable.");
    this.name = "PhotoAnalysisAttemptConfigurationUnavailableError";
  }
}

export class PhotoAnalysisConfigurationInputError extends Error {
  constructor(readonly fieldErrors: PhotoAnalysisConfigurationFieldErrors) {
    super("Choose available models and enter valid confidence thresholds.");
    this.name = "PhotoAnalysisConfigurationInputError";
  }
}

export class PhotoAnalysisConfigurationService {
  constructor(
    private readonly persistence: PhotoAnalysisConfigurationPersistence,
    private readonly credentials: PhotoAnalysisCredentialReader,
    private readonly discovery: PhotoAnalysisModelDiscovery,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readSettings(): Promise<PhotoAnalysisSettingsSnapshot> {
    const stored = this.readStored();
    const selectedProfile = stored.profiles[stored.jevModel] ?? uncalibratedProfile();
    const configuration = {
      geminiModel: stored.geminiModel,
      jevModel: stored.jevModel,
      ...selectedProfile,
    };
    const pair = await this.credentials.read();
    if (!pair) {
      return {
        configuration,
        gemini: { state: "unconfigured", models: [] },
        jev: { state: "unconfigured", models: [] },
        profiles: stored.profiles,
        ready: false,
        reason: "Configure both provider credentials before selecting models.",
      };
    }

    const signal = AbortSignal.timeout(5_000);
    const discovered = await this.discover(pair, signal);
    const gemini = discovered.gemini.status === "fulfilled"
      ? { state: "available" as const, models: discovered.geminiModels }
      : discoveryFailureState(discovered.gemini.reason);
    const jev = discovered.jev.status === "fulfilled"
      ? { state: "available" as const, models: discovered.jevModels }
      : discoveryFailureState(discovered.jev.reason);
    const selectedGeminiAvailable = discovered.geminiModels.some(model => model.id === stored.geminiModel);
    const selectedJevAvailable = discovered.jevModels.some(model => model.id === stored.jevModel);
    const ready = gemini.state === "available" && jev.state === "available"
      && selectedGeminiAvailable && selectedJevAvailable;
    return {
      configuration,
      gemini,
      jev,
      profiles: stored.profiles,
      ready,
      ...(!ready ? { reason: discoveryReason(gemini, jev, selectedGeminiAvailable, selectedJevAvailable) } : {}),
    };
  }

  async save(input: PhotoAnalysisConfigurationInput): Promise<PhotoAnalysisSettingsSnapshot> {
    const pair = await this.credentials.read();
    if (!pair) {
      throw new PhotoAnalysisConfigurationInputError({
        geminiModel: "Configure provider credentials before selecting models.",
        jevModel: "Configure provider credentials before selecting models.",
      });
    }
    const signal = AbortSignal.timeout(5_000);
    const discovered = await this.discover(pair, signal);
    if (discovered.gemini.status === "rejected") throw discovered.gemini.reason;
    if (discovered.jev.status === "rejected") throw discovered.jev.reason;
    const fieldErrors = validateConfigurationInput(
      input,
      discovered.geminiModels,
      discovered.jevModels,
    );
    if (Object.keys(fieldErrors).length) throw new PhotoAnalysisConfigurationInputError(fieldErrors);

    const previous = this.readStored();
    const stored: z.infer<typeof storedConfigurationSchema> = {
      version: 1,
      geminiModel: input.geminiModel,
      jevModel: input.jevModel,
      profiles: {
        ...previous.profiles,
        [input.jevModel]: {
          categoryConfidenceThreshold: input.categoryConfidenceThreshold,
          productConfidenceThreshold: input.productConfidenceThreshold,
          calibrated: true,
        },
      },
    };
    this.persistence.replace(CONFIGURATION_KEY, JSON.stringify(stored), this.now().toISOString());
    return await this.readSettings();
  }

  async captureAttemptConfiguration(
    signal: AbortSignal = new AbortController().signal,
  ): Promise<PhotoAnalysisAttemptConfiguration> {
    for (let capturePass = 0; capturePass < 3; capturePass++) {
      signal.throwIfAborted();
      const credentials = await this.credentials.read();
      if (!credentials) {
        throw new PhotoAnalysisAttemptConfigurationUnavailableError(
          "missing-credentials",
        );
      }
      const stored = this.readStored();
      const discovered = await this.discover(credentials, signal);
      signal.throwIfAborted();
      const currentCredentials = await this.credentials.read();
      const currentStored = this.readStored();
      if (
        !sameCredentialPair(credentials, currentCredentials) ||
        JSON.stringify(stored) !== JSON.stringify(currentStored)
      ) {
        continue;
      }
      if (
        discovered.gemini.status === "rejected" ||
        discovered.jev.status === "rejected" ||
        !discovered.geminiModels.some(
          (model) => model.id === stored.geminiModel,
        ) ||
        !discovered.jevModels.some(
          (model) => model.id === stored.jevModel,
        )
      ) {
        throw new PhotoAnalysisAttemptConfigurationUnavailableError();
      }
      const profile = stored.profiles[stored.jevModel] ?? uncalibratedProfile();
      return {
        ...credentials,
        geminiModel: stored.geminiModel,
        jevModel: stored.jevModel,
        categoryConfidenceThreshold: profile.categoryConfidenceThreshold,
        productConfidenceThreshold: profile.productConfidenceThreshold,
      };
    }
    throw new PhotoAnalysisAttemptConfigurationUnavailableError();
  }

  private async discover(
    credentials: PhotoAnalysisCredentialPair,
    signal: AbortSignal,
  ) {
    const [gemini, jev] = await Promise.allSettled([
      this.discovery.discoverGemini(credentials.geminiKey, signal),
      this.discovery.discoverJev(credentials.typeSafeKey, signal),
    ]);
    return {
      gemini,
      geminiModels:
        gemini.status === "fulfilled" ? compatibleGeminiModels(gemini.value) : [],
      jev,
      jevModels:
        jev.status === "fulfilled" ? compatibleJevModels(jev.value) : [],
    };
  }

  private readStored(): z.infer<typeof storedConfigurationSchema> {
    const value = this.persistence.read(CONFIGURATION_KEY);
    if (!value) {
      return {
        version: 1,
        geminiModel: DEFAULT_GEMINI_MODEL,
        jevModel: DEFAULT_JEV_MODEL,
        profiles: {},
      };
    }
    return storedConfigurationSchema.parse(JSON.parse(value) as unknown);
  }
}

function sameCredentialPair(
  left: PhotoAnalysisCredentialPair,
  right: PhotoAnalysisCredentialPair | undefined,
) {
  return (
    right !== undefined &&
    left.geminiKey === right.geminiKey &&
    left.typeSafeKey === right.typeSafeKey
  );
}

function uncalibratedProfile(): JevThresholdProfile {
  return {
    categoryConfidenceThreshold: 0,
    productConfidenceThreshold: 0,
    calibrated: false,
  };
}

function compatibleGeminiModels(discovered: GeminiDiscoveredModel[]): ModelOption[] {
  const byId = new Map(discovered.map(model => [model.id.replace(/^models\//u, ""), model]));
  return Object.entries(GEMINI_COMPATIBILITY_CATALOG)
    .filter(([id]) => byId.get(id)?.methods.includes("generateContent"))
    .map(([id, compatible]) => ({ id, ...compatible }));
}

function compatibleJevModels(discovered: JevDiscoveredModel[]): ModelOption[] {
  const versions = new Set<string>();
  for (const model of discovered) {
    if (/^jev-\d+\.\d+\.\d+$/u.test(model.effectiveId)) versions.add(model.effectiveId);
  }
  return [...versions].sort().map(id => ({ id, label: jevLabel(id) }));
}

function jevLabel(id: string): string {
  return `Jev ${id.slice("jev-".length)}`;
}

function unavailableSelectionReason(gemini: boolean, jev: boolean): string {
  if (!gemini && !jev) return "The selected Gemini and Jev models are unavailable.";
  return gemini ? "The selected Jev model is unavailable." : "The selected Gemini model is unavailable.";
}

function discoveryFailureState(reason: unknown): ModelDiscoveryState {
  const kind = reason instanceof ModelDiscoveryError ? reason.kind : "transient-availability";
  return kind === "permanent-incompatibility"
    ? { state: "incompatible", models: [], message: "The provider no longer exposes a compatible model-list response." }
    : { state: "transient-error", models: [], message: "Model availability could not be refreshed. Try again." };
}

function discoveryReason(
  gemini: ModelDiscoveryState,
  jev: ModelDiscoveryState,
  selectedGeminiAvailable: boolean,
  selectedJevAvailable: boolean,
): string {
  if (gemini.state !== "available") return `Gemini: ${"message" in gemini ? gemini.message : "Credentials are not configured."}`;
  if (jev.state !== "available") return `Jev: ${"message" in jev ? jev.message : "Credentials are not configured."}`;
  return unavailableSelectionReason(selectedGeminiAvailable, selectedJevAvailable);
}

function validateConfigurationInput(
  input: PhotoAnalysisConfigurationInput,
  geminiModels: ModelOption[],
  jevModels: ModelOption[],
): PhotoAnalysisConfigurationFieldErrors {
  const fieldErrors: PhotoAnalysisConfigurationFieldErrors = {};
  if (!geminiModels.some(model => model.id === input.geminiModel)) {
    fieldErrors.geminiModel = "Choose an available supported Gemini model.";
  }
  if (!jevModels.some(model => model.id === input.jevModel)) {
    fieldErrors.jevModel = "Choose an available supported Jev model.";
  }
  if (!thresholdSchema.safeParse(input.categoryConfidenceThreshold).success) {
    fieldErrors.categoryConfidenceThreshold = "Enter a value from 0.0 through 1.0.";
  }
  if (!thresholdSchema.safeParse(input.productConfidenceThreshold).success) {
    fieldErrors.productConfidenceThreshold = "Enter a value from 0.0 through 1.0.";
  }
  return fieldErrors;
}
