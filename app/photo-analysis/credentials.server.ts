import { z } from "zod";

import {
  CredentialBundleUnreadableError,
  type CredentialBundleMetadata,
  type CredentialBundleStatus,
  type EncryptedCredentialBundles,
} from "../credentials/encrypted-credential-bundles.server";

const BUNDLE_NAME = "photo-analysis";

function providerKey(label: string) {
  return z.string()
    .min(16, `${label} must contain at least 16 characters.`)
    .max(512, `${label} must contain at most 512 characters.`)
    .regex(/^[A-Za-z0-9._~-]+$/u, `${label} may contain only token characters without whitespace.`);
}

const inputSchema = z.object({
  geminiKey: providerKey("Gemini key"),
  typeSafeKey: providerKey("TypeSafe key"),
}).strict();

const storedSchema = inputSchema.extend({
  version: z.literal(1),
  validatedAt: z.string().datetime(),
}).strict();

export type PhotoAnalysisCredentialPair = z.infer<typeof inputSchema>;

export interface PhotoAnalysisCredentialValidator {
  validateGemini(key: string): Promise<void>;
  validateTypeSafe(key: string): Promise<void>;
}

export class ProviderCredentialRejectedError extends Error {
  constructor() {
    super("Provider rejected credential.");
    this.name = "ProviderCredentialRejectedError";
  }
}

export class ProviderCredentialUnavailableError extends Error {
  constructor() {
    super("Provider credential validation unavailable.");
    this.name = "ProviderCredentialUnavailableError";
  }
}

export type PhotoAnalysisCredentialFieldErrors = Partial<Record<keyof PhotoAnalysisCredentialPair, string>>;

export class PhotoAnalysisCredentialInputError extends Error {
  constructor(readonly fieldErrors: PhotoAnalysisCredentialFieldErrors) {
    super("Enter a valid Gemini and TypeSafe credential pair.");
    this.name = "PhotoAnalysisCredentialInputError";
  }
}

export class PhotoAnalysisCredentialValidationError extends Error {
  constructor(readonly fieldErrors: PhotoAnalysisCredentialFieldErrors) {
    super("The credential pair could not be validated.");
    this.name = "PhotoAnalysisCredentialValidationError";
  }
}

export type PhotoAnalysisCredentialStatus =
  | { state: "unconfigured" }
  | ({ state: "unreadable" } & CredentialBundleMetadata)
  | ({ state: "configured"; validatedAt: string } & CredentialBundleMetadata);

function inputFailure(error: z.ZodError<PhotoAnalysisCredentialPair>): PhotoAnalysisCredentialInputError {
  const flattened = z.flattenError(error).fieldErrors;
  return new PhotoAnalysisCredentialInputError({
    geminiKey: flattened.geminiKey?.[0],
    typeSafeKey: flattened.typeSafeKey?.[0],
  });
}

function validationMessage(provider: "Gemini" | "TypeSafe", reason: unknown): string {
  return reason instanceof ProviderCredentialRejectedError
    ? `${provider} rejected this key.`
    : `${provider} credential validation is temporarily unavailable.`;
}

export class PhotoAnalysisCredentials {
  constructor(
    private readonly bundles: EncryptedCredentialBundles,
    private readonly validator: PhotoAnalysisCredentialValidator,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(): Promise<PhotoAnalysisCredentialPair | undefined> {
    const plaintext = await this.bundles.read(BUNDLE_NAME);
    if (!plaintext) return undefined;
    try {
      const stored = storedSchema.parse(JSON.parse(plaintext.toString("utf8")) as unknown);
      return { geminiKey: stored.geminiKey, typeSafeKey: stored.typeSafeKey };
    } catch {
      throw new CredentialBundleUnreadableError();
    }
  }

  async replace(candidate: PhotoAnalysisCredentialPair): Promise<PhotoAnalysisCredentialStatus> {
    const parsed = inputSchema.safeParse(candidate);
    if (!parsed.success) throw inputFailure(parsed.error);

    const [gemini, typeSafe] = await Promise.allSettled([
      this.validator.validateGemini(parsed.data.geminiKey),
      this.validator.validateTypeSafe(parsed.data.typeSafeKey),
    ]);
    const fieldErrors: PhotoAnalysisCredentialFieldErrors = {};
    if (gemini.status === "rejected") {
      fieldErrors.geminiKey = validationMessage("Gemini", gemini.reason);
    }
    if (typeSafe.status === "rejected") {
      fieldErrors.typeSafeKey = validationMessage("TypeSafe", typeSafe.reason);
    }
    if (Object.keys(fieldErrors).length) {
      throw new PhotoAnalysisCredentialValidationError(fieldErrors);
    }

    const validatedAt = this.now().toISOString();
    const status = await this.bundles.replace(
      BUNDLE_NAME,
      Buffer.from(JSON.stringify({ version: 1, validatedAt, ...parsed.data }), "utf8"),
    );
    return { ...status, validatedAt };
  }

  async remove(): Promise<boolean> {
    return await this.bundles.remove(BUNDLE_NAME);
  }

  async status(): Promise<PhotoAnalysisCredentialStatus> {
    const status = await this.bundles.status(BUNDLE_NAME);
    if (status.state !== "configured") return status;
    try {
      const plaintext = await this.bundles.read(BUNDLE_NAME);
      if (!plaintext) return { state: "unconfigured" };
      const stored = storedSchema.parse(JSON.parse(plaintext.toString("utf8")) as unknown);
      return { ...status, validatedAt: stored.validatedAt };
    } catch {
      return unreadable(status);
    }
  }
}

function unreadable(status: Extract<CredentialBundleStatus, { state: "configured" }>): PhotoAnalysisCredentialStatus {
  return {
    state: "unreadable",
    configuredAt: status.configuredAt,
    updatedAt: status.updatedAt,
  };
}
