// Preloaded by both Playwright servers. Answers Open Food Facts v3.5 product requests from
// fixtures and records each one; any other OFF or USDA API access fails, so no request escapes.
import { appendFileSync, readFileSync } from "node:fs";

const requestLog = "data/playwright-tests/off-api-requests.jsonl";
const productUrl = /^https:\/\/world\.openfoodfacts\.org\/api\/v3\.5\/product\/(\d+)(?:\?|$)/;

const cereal = {
  code: "0034000470693", product_name: "Example cereal", brands: "Example Foods", countries: "United States",
  serving_quantity: 30, serving_quantity_unit: "g",
  nutrition: { input_sets: [{
    source: "packaging", preparation: "as_sold", per: "serving", per_quantity: 30, per_unit: "g",
    nutrients: { "energy-kcal": { value: 180, unit: "kcal" }, carbohydrates: { value: 24, unit: "g" }, fat: { value: 0, unit: "g" } },
  }] },
};
const oatDrink = {
  code: "0012345678905", product_name: "Local oat drink", brands: "Example", countries: "United States",
  serving_quantity: 30, serving_quantity_unit: "ml",
  nutrition: { input_sets: [{
    source: "packaging", preparation: "as_sold", per: "100ml", per_quantity: 100, per_unit: "ml",
    nutrients: { "energy-kcal": { value: 400, unit: "kcal" }, proteins: { value: 10, unit: "g" }, carbohydrates: { value: 60, unit: "g" }, fat: { value: 12, unit: "g" } },
  }] },
};
const whey = JSON.parse(readFileSync("tests/fixtures/off-native-serving.json", "utf8"));
const product = (value) => ({ status: 200, body: { code: value.code, product: value, status: "success" } });
const replies = {
  "034000470693": product(cereal),
  "0034000470693": product(cereal),
  "0012345678905": product(oatDrink),
  "643843715887": product(whey),
  "0643843715887": product(whey),
  "0012345678906": product({ code: "0012345678906", product_name: "Ambiguous oats", nutriments: { "energy-kcal_100g": 100 } }),
  "0000000000002": product({ code: "0000000000002", product_name: "No label nutrition", nutrition: { input_sets: [] } }),
  "0000000000004": { status: 503, body: "Service unavailable" },
  "0000000000048": { status: 429, body: "Too many requests" },
  "0000000000005": { status: 200, body: { status: "success", product: { code: 5 } } },
  "0000000000006": product({ ...cereal, code: "0000000000006", product_name: "", brands: "" }),
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("api.nal.usda.gov")) throw new Error("Unexpected USDA food API access");
  if (!url.includes("openfoodfacts")) return originalFetch(input, init);
  const match = productUrl.exec(url);
  if (!match) throw new Error(`Unexpected Open Food Facts access: ${url}`);
  const userAgent = new Headers(init?.headers).get("User-Agent");
  appendFileSync(requestLog, JSON.stringify({ url, userAgent }) + "\n");
  const reply = replies[match[1]] ?? { status: 404, body: { status: "failure" } };
  return typeof reply.body === "string"
    ? new Response(reply.body, { status: reply.status })
    : Response.json(reply.body, { status: reply.status });
};
