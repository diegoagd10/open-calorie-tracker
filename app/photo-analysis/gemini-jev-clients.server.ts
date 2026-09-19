import { z } from "zod";
import {
  GEMINI_MEAL_RESPONSE_JSON_SCHEMA,
  type GeminiMealClient,
  type GeminiMealRequest,
  type JevChoiceClient,
  type JevChoiceRequest,
} from "./gemini-jev.server.ts";

export type PhotoAnalysisNetwork = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class PhotoAnalysisProviderError extends Error {
  constructor() {
    super("Photo Analysis provider unavailable");
    this.name = "PhotoAnalysisProviderError";
  }
}

const providerKeySchema = z.string().min(8).max(512).regex(/^\S+$/u);
const geminiEnvelopeSchema = z.object({
  candidates: z.array(z.object({
    finishReason: z.literal("STOP"),
    content: z.object({
      parts: z.array(z.object({ text: z.string().max(50_000) }).passthrough()).min(1).max(8),
    }).passthrough(),
  }).passthrough()).length(1),
}).passthrough();

export class GeminiHttpMealClient implements GeminiMealClient {
  private readonly key: string;
  constructor(key: string, private readonly network: PhotoAnalysisNetwork = fetch) {
    this.key = providerKeySchema.parse(key);
  }

  async analyzeMeal(request: GeminiMealRequest, signal: AbortSignal): Promise<unknown> {
    const response = await providerRequest(this.network, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.key },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: `${request.instruction}\nApplication context:\n${JSON.stringify(request.context)}` },
            { inlineData: { mimeType: request.photo.mimeType, data: request.photo.bytes.toString("base64") } },
          ],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: GEMINI_MEAL_RESPONSE_JSON_SCHEMA,
        },
      }),
      signal,
    }, signal);
    const envelope = providerSchema(geminiEnvelopeSchema, await boundedJson(response, 100_000));
    const text = envelope.candidates[0].content.parts.map(part => part.text).join("");
    if (text.length > 50_000) throw new PhotoAnalysisProviderError();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new PhotoAnalysisProviderError();
    }
  }
}

export class JevHttpChoiceClient implements JevChoiceClient {
  private readonly key: string;
  constructor(key: string, private readonly network: PhotoAnalysisNetwork = fetch) {
    this.key = providerKeySchema.parse(key);
  }

  async choose(request: JevChoiceRequest, signal: AbortSignal): Promise<unknown> {
    const response = await providerRequest(this.network, "https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { "authorization": `Bearer ${this.key}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    }, signal);
    return await boundedJson(response, 500_000);
  }
}

async function providerRequest(network: PhotoAnalysisNetwork, url: string, init: RequestInit, signal: AbortSignal) {
  let response: Response;
  try {
    response = await network(url, init);
  } catch {
    signal.throwIfAborted();
    throw new PhotoAnalysisProviderError();
  }
  signal.throwIfAborted();
  if (!response.ok) throw new PhotoAnalysisProviderError();
  return response;
}

async function boundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    throw new PhotoAnalysisProviderError();
  }
  if (response.body === null) throw new PhotoAnalysisProviderError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new PhotoAnalysisProviderError();
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new PhotoAnalysisProviderError();
  }
}

function providerSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new PhotoAnalysisProviderError();
  return result.data;
}
