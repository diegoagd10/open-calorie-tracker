import test from "node:test";
import assert from "node:assert/strict";
import { OpenFoodFactsAdapter, normalizeBarcode, normalizeOpenFoodFactsProduct } from "../src/adapters/open-food-facts.js";
import { asProviderFailure, ProviderFailure } from "../src/adapters/errors.js";
import { normalizeLabelCandidate, validateImageInput } from "../src/adapters/label.js";
import { sanitizeLogFields } from "../src/infra/logger.js";
import { TermFoodSearchAdapter, normalizeTermCandidate } from "../src/adapters/term-search.js";

test("Open Food Facts normalization prefers declared serving values and preserves unknowns", () => {
  const candidate = normalizeOpenFoodFactsProduct({
    code: "12345678",
    product_name: "Trail mix",
    brands: "Example",
    serving_size: "40 g",
    nutrition_data_per: "serving",
    nutriments: {
      "energy-kcal_serving": 184,
      "proteins_serving": 13,
      "sodium_serving": 0.14,
      sodium_unit: "g",
    },
  });
  assert.equal(candidate.quantityBasis, "serving (40 g)");
  assert.equal(candidate.nutrients.calories, 184);
  assert.equal(candidate.nutrients.sodium, 140);
  assert.equal(candidate.nutrients.fiber, null);
  assert.equal(candidate.complete, true);
  assert.equal(candidate.requiresReview, true);
});

test("barcode adapter validates input, sends a scoped request, and classifies not found", async () => {
  assert.equal(normalizeBarcode("078-742 231587"), "078742231587");
  assert.throws(() => normalizeBarcode("abc"), (error: unknown) => error instanceof ProviderFailure && error.kind === "invalid");
  let requested: unknown;
  const adapter = new OpenFoodFactsAdapter({
    userAgent: "Calories test agent",
    fetchImpl: async (input, init) => {
      requested = input;
      assert.equal(new Headers(init?.headers).get("User-Agent"), "Calories test agent");
      return new Response(JSON.stringify({ status: 0 }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await assert.rejects(adapter.lookup("12345678"), (error: unknown) => error instanceof ProviderFailure && error.kind === "not_found" && !error.retryable);
  assert.match(String(requested), /fields=/);
  assert.doesNotMatch(String(requested), /api_key|token/i);
});

test("temporary upstream failures are retryable but invalid images are not", async () => {
  const adapter = new OpenFoodFactsAdapter({ fetchImpl: async () => new Response("", { status: 503 }) });
  await assert.rejects(adapter.lookup("12345678"), (error: unknown) => error instanceof ProviderFailure && error.kind === "temporarily_unavailable" && error.retryable);
  assert.throws(() => validateImageInput({ buffer: Buffer.from(""), mimeType: "image/jpeg" }), (error: unknown) => error instanceof ProviderFailure && error.kind === "invalid" && !error.retryable);
  const candidate = normalizeLabelCandidate({ nutrients: { calories: 130, protein: null }, quantityBasis: "serving" });
  assert.equal(candidate.complete, true);
  assert.equal(candidate.nutrients.protein, null);
});

test("technical logging removes private payload fields", () => {
  const safe = sanitizeLogFields({ operation: "lookup", apiKey: "secret", prompt: "private", image: Buffer.from("x"), provider: "fake" });
  assert.deepEqual(safe, { operation: "lookup", provider: "fake" });
});

test("term search adapter validates queries and normalizes provider records", async () => {
  const candidate = normalizeTermCandidate({ id: "food-1", name: "Lentils", quantityBasis: "cup", calories: 230, nutrients: { protein: 18, sodium: null } });
  assert.equal(candidate.nutrients.calories, 230);
  assert.equal(candidate.nutrients.sodium, null);
  const adapter = new TermFoodSearchAdapter({ endpoint: "https://provider.test/search", fetchImpl: async () => new Response(JSON.stringify({ results: [{ name: "Lentils", quantityBasis: "cup", calories: 230 }] }), { status: 200 }) });
  assert.equal((await adapter.search("lentils"))[0].name, "Lentils");
  await assert.rejects(adapter.search("x"), (error: unknown) => error instanceof ProviderFailure && error.kind === "invalid");
});

test("only network-shaped TypeErrors are retryable provider failures", () => {
  assert.equal(asProviderFailure(new TypeError("invalid provider payload"), "fake").kind, "unexpected");
  assert.equal(asProviderFailure(new TypeError("fetch failed"), "fake").kind, "temporarily_unavailable");
});
