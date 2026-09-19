import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import type { CatalogFood } from "../app/catalog/food-catalog.server";
import type { UsdaAnalysisReader } from "../app/catalog/usda-evidence";
import type { PhotoAnalyzer } from "../app/photo-analysis/photo-analysis.server";
import { ProviderPipelineDemo } from "../app/photo-analysis/provider-pipeline-demo.server";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "provider-pipeline-"));
  directories.push(directory);
  return path.join(directory, "private", "keys.json");
}

const egg: CatalogFood = {
  authoritativeBaseQuantityMicrounits: 100_000_000,
  authoritativeBaseUnit: "g",
  barcode: null,
  brand: null,
  catalogGeneration: "test",
  dataType: "Foundation",
  isSelectable: true,
  marketCountry: null,
  measurementSummary: "100 g",
  measurements: [],
  name: "Egg, whole, cooked, fried",
  nutritionPerAuthoritativeBase: {
    carbohydrateMilligrams: null,
    energyMilliKcal: null,
    fatMilligrams: null,
    fiberMilligrams: null,
    proteinMilligrams: null,
    sodiumMilligrams: null,
    sugarMilligrams: null,
  },
  originalName: "Egg, whole, cooked, fried",
  provider: "usda-fdc",
  providerFoodId: "171288",
  providerModifiedDate: null,
  providerPublishedDate: null,
};

function usda(): UsdaAnalysisReader {
  return {
    searchEvidence: vi.fn(async () => [{ food: egg, record: {} }]),
    getEvidence: vi.fn(async () => ({ food: egg, record: {} })),
  };
}

test("stores provider keys privately and never returns them from status", async () => {
  const credentialsPath = await fixture();
  const demo = new ProviderPipelineDemo(credentialsPath, usda());
  expect(await demo.status()).toEqual({ geminiConfigured: false, jevConfigured: false, ready: false });
  await demo.save({ geminiApiKey: "gemini-secret-key", jevApiKey: "jev-secret-key" });
  expect(await demo.status()).toEqual({ geminiConfigured: true, jevConfigured: true, ready: true });
  expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
  expect(await readFile(credentialsPath, "utf8")).toContain("gemini-secret-key");
  await demo.save({ jevApiKey: "jev-replacement-key" });
  expect(await readFile(credentialsPath, "utf8")).toContain("gemini-secret-key");
  await demo.remove();
  expect(await demo.status()).toEqual({ geminiConfigured: false, jevConfigured: false, ready: false });
});

test("sends the image only to Gemini and asks Jev to choose from local USDA candidates", async () => {
  const credentialsPath = await fixture();
  const requests: Array<{ body: Record<string, unknown>; headers: Headers; url: string }> = [];
  const network = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ body, headers: new Headers(init?.headers), url });
    if (url.includes("generativelanguage")) {
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        status: "food",
        mealName: "Fried eggs",
        assumptions: ["Two eggs estimated from the image"],
        foods: [{
          name: "fried eggs", quantity: 100, unit: "g", searchQuery: "fried egg",
          energyKcal: 180, proteinGrams: 13, carbohydrateGrams: 1, fatGrams: 14,
        }],
      }) }] } }] });
    }
    return Response.json({
      model: "jev-1.13.0",
      answers: { food_0: { type: "choice", choice: "candidate_0", confidence: 0.91, probabilities: { candidate_0: 0.96, none: 0.04 } } },
      usage: { input_tokens: 80, output_tokens: 10 },
    });
  });
  const searchEvidence = vi.fn(async () => [{ food: egg, record: {} }]);
  const reader: UsdaAnalysisReader = {
    searchEvidence,
    getEvidence: vi.fn(async () => ({ food: egg, record: {} })),
  };
  const piAnalyze = vi.fn<PhotoAnalyzer["analyze"]>(async () => ({
    name: "Pi fried eggs", consumedFraction: 1, assumptions: [],
    components: [{
      id: "egg", name: "fried eggs", quantity: 100, unit: "g", includes: [],
      source: { kind: "ai", reason: "test" }, supplements: [],
      nutrition: { energyKcal: 170, proteinGrams: 12, carbohydrateGrams: 1, fatGrams: 13, fiberGrams: 0, sugarGrams: 0, sodiumMilligrams: 170 },
    }],
  }));
  const demo = new ProviderPipelineDemo(credentialsPath, reader, network, { analyze: piAnalyze });
  await demo.save({ geminiApiKey: "gemini-secret-key", jevApiKey: "jev-secret-key" });
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const result = await demo.compare({ bytes, mimeType: "image/png" });

  expect(result.pipelines).toHaveLength(3);
  expect(result.pipelines.map(pipeline => pipeline.id)).toEqual(["pi", "gemini", "gemini-jev"]);
  expect(result.pipelines[0]?.product?.totals.energyKcal).toBe(170);
  expect(result.pipelines[1]?.product?.totals.energyKcal).toBe(180);
  expect(result.pipelines[2]?.matches?.[0]).toMatchObject({ selected: "Egg, whole, cooked, fried", confidence: 0.91, source: "usda" });
  expect(piAnalyze).toHaveBeenCalledWith(expect.objectContaining({ photo: { bytes, mimeType: "image/png" } }));
  expect(searchEvidence).toHaveBeenCalledWith("fried egg", 1, expect.any(AbortSignal));
  expect(requests).toHaveLength(2);
  expect(requests[0]?.headers.get("x-goog-api-key")).toBe("gemini-secret-key");
  expect(JSON.stringify(requests[0]?.body)).toContain(bytes.toString("base64"));
  expect(requests[1]?.headers.get("Authorization")).toBe("Bearer jev-secret-key");
  expect(JSON.stringify(requests[1]?.body)).not.toContain(bytes.toString("base64"));
  expect(requests[1]?.body).toMatchObject({ model: "jev-1.13.0" });
});
