import { readFileSync } from "node:fs";

/** The real native-serving JSONL record of `0643843715887`, as OFF v3.5 also returns it. */
export const offNativeServingProduct = JSON.parse(
  readFileSync(new URL("../fixtures/off-native-serving.json", import.meta.url), "utf8"),
) as Record<string, unknown> & { code: string };

export type OffApiReply = Record<string, unknown> | Response | Error | (() => Response | Promise<Response>);
export type OffApiRequest = { url: URL; userAgent: string | null };

/** A v3.5 product reply wrapping `product`, with OFF's canonical `code`. */
export function offProductReply(product: Record<string, unknown>): Response {
  return Response.json({ code: product.code, product, status: "success" });
}

/**
 * A `fetch` that answers OFF v3.5 product requests from `replies`, keyed by the requested barcode,
 * and records each request. Unknown barcodes get OFF's 404; any other URL fails the test.
 */
export function fakeOffApi(replies: Record<string, OffApiReply> = {}) {
  const requests: OffApiRequest[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const match = /^\/api\/v3\.5\/product\/(\d+)$/.exec(url.pathname);
    if (url.origin !== "https://world.openfoodfacts.org" || !match) {
      throw new Error(`Unexpected request to ${url.href}`);
    }
    requests.push({ url, userAgent: new Headers(init?.headers).get("User-Agent") });
    const reply = replies[match[1]];
    if (reply === undefined) return Response.json({ status: "failure" }, { status: 404 });
    if (reply instanceof Error) throw reply;
    if (reply instanceof Response) return reply.clone();
    if (typeof reply === "function") return reply();
    return offProductReply(reply);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

/** A packaged cereal labelled per 30 g serving; OFF canonicalizes `034000470693` to this code. */
export const exampleCerealProduct = {
  code: "0034000470693",
  product_name: "Example cereal",
  brands: "Example Foods",
  countries: "United States",
  serving_quantity: 30,
  serving_quantity_unit: "g",
  nutrition: {
    input_sets: [{
      source: "packaging", preparation: "as_sold", per: "serving", per_quantity: 30, per_unit: "g",
      nutrients: {
        "energy-kcal": { value: 180, unit: "kcal" },
        carbohydrates: { value: 24, unit: "g" },
        fat: { value: 0, unit: "g" },
      },
    }],
  },
};

/** Replies for the deterministic barcodes route and component tests use. */
export function offApiFixtureReplies(): Record<string, OffApiReply> {
  return {
    "034000470693": exampleCerealProduct,
    "0034000470693": exampleCerealProduct,
    "1234567": { ...exampleCerealProduct, code: "1234567" },
    "0000000000002": { code: "0000000000002", product_name: "No label nutrition", nutrition: { input_sets: [] } },
    "0000000000004": new Response("Service unavailable", { status: 503 }),
    "0000000000005": Response.json({ status: "success", product: { code: 5 } }),
    "0000000000006": { ...exampleCerealProduct, code: "0000000000006", product_name: "", brands: "" },
    "0000000000007": {
      code: "0000000000007", product_name: "Conflicting cereal",
      nutrition: { input_sets: [
        exampleCerealProduct.nutrition.input_sets[0],
        { ...exampleCerealProduct.nutrition.input_sets[0], per_quantity: 40 },
      ] },
    },
  };
}
