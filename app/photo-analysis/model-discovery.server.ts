import { z } from "zod";

import type {
  GeminiDiscoveredModel,
  JevDiscoveredModel,
  PhotoAnalysisModelDiscovery,
} from "./configuration.server";
import { ModelDiscoveryError } from "./configuration.server";
export { ModelDiscoveryError } from "./configuration.server";

const geminiPageSchema = z.object({
  models: z.array(z.object({
    name: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    supportedGenerationMethods: z.array(z.string().min(1).max(100)).max(30),
  }).passthrough()).max(1_000),
  nextPageToken: z.string().min(1).max(500).optional(),
}).passthrough();

const legacyJevModelSchema = z.object({
  id: z.string().min(1).max(100),
  effective_model: z.string().min(1).max(100).optional(),
  effectiveModel: z.string().min(1).max(100).optional(),
});
const currentJevModelSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(1_000),
  release_date: z.string().min(1).max(100),
});
const jevModelSchema = z.union([legacyJevModelSchema, currentJevModelSchema]);
const jevEnvelopeSchema = z.union([
  z.object({ data: z.array(jevModelSchema).max(1_000) }).passthrough(),
  z.object({ models: z.array(jevModelSchema).max(1_000) }).passthrough(),
]).transform(value => "data" in value ? value.data : value.models);

// TypeSafe lists moving aliases, while thresholds and provenance require a concrete version.
// Keep this mapping explicit so a provider alias change cannot silently reuse old calibration.
const documentedJevAliasTargets: Readonly<Record<string, string>> = {
  "jev-latest": "jev-1.13.0",
  "jev-preview": "jev-1.13.0",
};

export class RemotePhotoAnalysisModelDiscovery implements PhotoAnalysisModelDiscovery {
  constructor(private readonly network: typeof fetch = fetch) {}

  async discoverGemini(key: string, signal: AbortSignal): Promise<GeminiDiscoveredModel[]> {
    const models: GeminiDiscoveredModel[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const query = new URLSearchParams({ pageSize: "1000" });
      if (pageToken) query.set("pageToken", pageToken);
      const value = await this.request(
        `https://generativelanguage.googleapis.com/v1beta/models?${query.toString()}`,
        { "x-goog-api-key": key },
        signal,
      );
      const parsed = parseProviderSchema(geminiPageSchema, value);
      models.push(...parsed.models.map(model => ({
        id: model.name.replace(/^models\//u, ""),
        displayName: model.displayName,
        methods: model.supportedGenerationMethods,
      })));
      pageToken = parsed.nextPageToken;
      if (!pageToken) return models;
    }
    throw new ModelDiscoveryError("permanent-incompatibility");
  }

  async discoverJev(key: string, signal: AbortSignal): Promise<JevDiscoveredModel[]> {
    const value = await this.request(
      "https://api.typesafe.ai/v1/models",
      { authorization: `Bearer ${key}` },
      signal,
    );
    const models = parseProviderSchema(jevEnvelopeSchema, value) as z.output<typeof jevModelSchema>[];
    return models.map(model => {
      if ("id" in model) {
        const effectiveId = model.effective_model ?? model.effectiveModel ?? model.id;
        return { id: model.id, effectiveId };
      }
      return {
        id: model.name,
        effectiveId: documentedJevAliasTargets[model.name] ?? model.name,
      };
    });
  }

  private async request(url: string, headers: HeadersInit, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.network(url, { method: "GET", headers, signal });
    } catch {
      signal.throwIfAborted();
      throw new ModelDiscoveryError("transient-availability");
    }
    signal.throwIfAborted();
    if (!response.ok) {
      void response.body?.cancel();
      throw new ModelDiscoveryError(
        response.status === 401 || response.status === 403 || response.status === 404
          ? "permanent-incompatibility"
          : "transient-availability",
      );
    }
    return await boundedJson(response, 500_000);
  }
}

function parseProviderSchema<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ModelDiscoveryError("permanent-incompatibility");
  return parsed.data;
}

async function boundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  if (!response.body) throw new ModelDiscoveryError("permanent-incompatibility");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    throw new ModelDiscoveryError("permanent-incompatibility");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new ModelDiscoveryError("permanent-incompatibility");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ModelDiscoveryError("permanent-incompatibility");
  }
}
