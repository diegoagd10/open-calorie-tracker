import { expect, test, vi } from "vitest";
import { z } from "zod";
import type { GeminiMealRequest, JevChoiceRequest } from "../app/photo-analysis/gemini-jev.server";
import {
  GeminiHttpMealClient,
  JevHttpChoiceClient,
  PhotoAnalysisProviderError,
} from "../app/photo-analysis/gemini-jev-clients.server";

const mealRequest: GeminiMealRequest = {
  model: "gemini-3.1-flash-lite",
  photo: { bytes: Buffer.from("photo bytes"), mimeType: "image/jpeg" },
  instruction: "Describe visible food only.",
  context: { correction: "One egg, not two" },
};

test("the Gemini adapter sends one authenticated structured multimodal request", async () => {
  const network = vi.fn<typeof fetch>(async () => Response.json({
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify({ status: "no_food" }) }] },
    }],
  }));
  const client = new GeminiHttpMealClient("gemini-private-key", network);
  const signal = new AbortController().signal;

  await expect(client.analyzeMeal(mealRequest, signal)).resolves.toEqual({ status: "no_food" });

  expect(network).toHaveBeenCalledOnce();
  const [url, init] = network.mock.calls[0];
  expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent");
  expect(init?.signal).toBe(signal);
  expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("gemini-private-key");
  const body = JSON.parse(String(init?.body)) as {
    contents: { parts: unknown[] }[];
    generationConfig: {
      responseMimeType: string;
      responseJsonSchema: unknown;
      temperature: number;
      maxOutputTokens: number;
    };
  };
  expect(body.contents[0].parts).toEqual([
    { text: `${mealRequest.instruction}\nApplication context:\n${JSON.stringify(mealRequest.context)}` },
    { inlineData: { mimeType: "image/jpeg", data: mealRequest.photo.bytes.toString("base64") } },
  ]);
  expect(body.generationConfig.responseMimeType).toBe("application/json");
  expect(body.generationConfig.temperature).toBe(0.2);
  expect(body.generationConfig.maxOutputTokens).toBe(8_192);
  expect(z.object({ anyOf: z.array(z.unknown()).min(1) }).parse(body.generationConfig.responseJsonSchema).anyOf)
    .not.toHaveLength(0);
  const schemaText = JSON.stringify(body.generationConfig.responseJsonSchema);
  expect(schemaText).toContain('"enum":["no_food"]');
  expect(schemaText).toContain('"enum":["food"]');
  expect(schemaText).toContain("Egg and diced potato must be separate items");
  expect(schemaText).toContain("Never combine egg and diced potato in one component");
  expect(schemaText).toContain("Never mention invisible cooking fats");
  for (const unsupported of ["const", "minLength", "maxLength", "pattern", "exclusiveMinimum"]) {
    expect(schemaText).not.toContain(`"${unsupported}"`);
  }
  expect(body.generationConfig.responseJsonSchema).not.toHaveProperty("$schema");
  expect(String(url)).not.toContain("gemini-private-key");
  expect(JSON.stringify(body)).not.toContain("gemini-private-key");
});

test("the Gemini adapter keeps the provider schema shallow and decodes bounded nutrition JSON", async () => {
  const nutrition = {
    energyKcal: 155,
    proteinGrams: 13,
    carbohydrateGrams: 1.1,
    fatGrams: 11,
    fiberGrams: 0,
    sugarGrams: 1.1,
    sodiumMilligrams: 124,
  };
  const providerObservation = {
    status: "food",
    name: "Two eggs",
    consumedFraction: 1,
    assumptions: [],
    components: [{
      id: "eggs",
      name: "Eggs",
      preparationEvidence: "Two cooked eggs are visible.",
      quantityDescription: "2 large eggs",
      grams: 100,
      uncertainty: "Preparation fat is not visible.",
      assumptions: [],
      nutrition: JSON.stringify(nutrition),
    }],
  };
  const network = vi.fn<typeof fetch>(async () => Response.json({
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify(providerObservation) }] },
    }],
  }));
  const client = new GeminiHttpMealClient("gemini-private-key", network);

  await expect(client.analyzeMeal(mealRequest, new AbortController().signal)).resolves.toEqual({
    ...providerObservation,
    components: [{ ...providerObservation.components[0], includes: [], nutrition }],
  });

  const body = JSON.parse(String(network.mock.calls[0][1]?.body)) as {
    generationConfig: { responseJsonSchema: { anyOf: { properties?: Record<string, unknown> }[] } };
  };
  const foodSchema = body.generationConfig.responseJsonSchema.anyOf.find(option => option.properties?.components);
  const nutritionSchema = z.object({
    properties: z.object({
      components: z.object({
        items: z.object({
          properties: z.object({ nutrition: z.object({ type: z.literal("string") }) }).passthrough(),
        }).passthrough(),
      }).passthrough(),
    }).passthrough(),
  }).parse(foodSchema).properties.components.items.properties.nutrition;
  expect(nutritionSchema).toEqual(expect.objectContaining({ type: "string" }));
  expect(JSON.stringify(foodSchema)).not.toContain('"includes"');
});

test("malformed Gemini nutrition JSON fails at the provider boundary", async () => {
  const network = vi.fn<typeof fetch>(async () => Response.json({
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify({
        status: "food",
        components: [{ nutrition: "not json" }],
      }) }] },
    }],
  }));

  await expect(new GeminiHttpMealClient("gemini-private-key", network)
    .analyzeMeal(mealRequest, new AbortController().signal)).rejects.toBeInstanceOf(PhotoAnalysisProviderError);
});

test("the Jev adapter sends one Bearer-authenticated batched Choice request", async () => {
  const response = { model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } };
  const network = vi.fn<typeof fetch>(async () => Response.json(response));
  const client = new JevHttpChoiceClient("typesafe-private-key", network);
  const request: JevChoiceRequest = {
    model: "jev-1.13.0",
    state: { components: [{ name: "egg" }] },
    questions: {
      component_0: {
        type: "choice",
        instructions: "Choose a category.",
        criteria: { category_1: "Eggs", none: "No adequate category" },
      },
    },
  };
  const signal = new AbortController().signal;

  await expect(client.choose(request, signal)).resolves.toEqual(response);

  expect(network).toHaveBeenCalledOnce();
  const [url, init] = network.mock.calls[0];
  expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
  expect(init?.signal).toBe(signal);
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer typesafe-private-key");
  expect(JSON.parse(String(init?.body))).toEqual(request);
});

test.each([401, 429, 500])("provider HTTP %s fails generically without a retry", async status => {
  const network = vi.fn<typeof fetch>(async () => new Response("secret upstream detail", { status }));
  const gemini = new GeminiHttpMealClient("gemini-private-key", network);

  await expect(gemini.analyzeMeal(mealRequest, new AbortController().signal))
    .rejects.toBeInstanceOf(PhotoAnalysisProviderError);
  expect(network).toHaveBeenCalledOnce();
});

test("malformed and oversized provider payloads fail generically", async () => {
  const malformed = vi.fn<typeof fetch>(async () => new Response("not json"));
  const malformedEnvelope = vi.fn<typeof fetch>(async () => Response.json({ candidates: [] }));
  const oversized = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ padding: "x".repeat(500_001) })));

  await expect(new GeminiHttpMealClient("gemini-private-key", malformed)
    .analyzeMeal(mealRequest, new AbortController().signal)).rejects.toBeInstanceOf(PhotoAnalysisProviderError);
  await expect(new JevHttpChoiceClient("typesafe-private-key", oversized)
    .choose({ model: "jev-1.13.0", state: {}, questions: {} }, new AbortController().signal))
    .rejects.toBeInstanceOf(PhotoAnalysisProviderError);
  await expect(new GeminiHttpMealClient("gemini-private-key", malformedEnvelope)
    .analyzeMeal(mealRequest, new AbortController().signal)).rejects.toBeInstanceOf(PhotoAnalysisProviderError);
  expect(malformed).toHaveBeenCalledOnce();
  expect(malformedEnvelope).toHaveBeenCalledOnce();
  expect(oversized).toHaveBeenCalledOnce();
});

test.each([
  ["oversized output text", () => Response.json({
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: "x".repeat(30_000) }, { text: "y".repeat(30_000) }] },
    }],
  })],
  ["missing body", () => new Response(null)],
  ["invalid content length", () => new Response("{}", { headers: { "content-length": "invalid" } })],
  ["oversized declared length", () => new Response("{}", { headers: { "content-length": "500001" } })],
] as const)("a %s is rejected at the bounded provider boundary", async (_case, response) => {
  const network = vi.fn<typeof fetch>(async () => response());
  const client = _case === "oversized output text"
    ? new GeminiHttpMealClient("gemini-private-key", network)
    : new JevHttpChoiceClient("typesafe-private-key", network);

  const request = _case === "oversized output text"
    ? client instanceof GeminiHttpMealClient
      ? client.analyzeMeal(mealRequest, new AbortController().signal)
      : Promise.resolve()
    : client instanceof JevHttpChoiceClient
      ? client.choose({ model: "jev-1.13.0", state: {}, questions: {} }, new AbortController().signal)
      : Promise.resolve();
  await expect(request).rejects.toBeInstanceOf(PhotoAnalysisProviderError);
  expect(network).toHaveBeenCalledOnce();
});

test("network failure and caller cancellation remain distinct", async () => {
  const network = vi.fn<typeof fetch>(async () => { throw new Error("socket failed"); });
  const client = new GeminiHttpMealClient("gemini-private-key", network);
  await expect(client.analyzeMeal(mealRequest, new AbortController().signal))
    .rejects.toBeInstanceOf(PhotoAnalysisProviderError);

  const canceled = new AbortController();
  const reason = new Error("caller canceled");
  canceled.abort(reason);
  await expect(client.analyzeMeal(mealRequest, canceled.signal)).rejects.toBe(reason);
  expect(network).toHaveBeenCalledTimes(2);
});
