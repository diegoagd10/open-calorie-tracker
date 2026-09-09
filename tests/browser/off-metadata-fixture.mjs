// Only preloaded by the catalog Playwright server. No source request escapes.
import { appendFile, readFile } from "node:fs/promises";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("openfoodfacts.org") || url.includes("openfoodfacts-ds.s3.")) {
    await appendFile("data/playwright-tests/off-metadata-requests.jsonl", JSON.stringify({ url, method: init?.method ?? "GET" }) + "\n");
    if (init?.method !== "HEAD" || url !== "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz") throw new Error("Unexpected OFF download or API access");
    const fixture = JSON.parse(await readFile("data/playwright-tests/off-metadata.json", "utf8").catch(() => '{"status":503}'));
    return new Response(null, fixture);
  }
  return originalFetch(input, init);
};
