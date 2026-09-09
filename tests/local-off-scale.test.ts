import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import { LocalOpenFoodFactsAdapter } from "../app/catalog/local-off.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { foundationArchive } from "./support/foundation-archive";
import { offArchive, offWithBasis } from "./support/off-archive";

test.skipIf(!process.env.OFF_LOCAL_ARCHIVE)("full OFF export imports with bounded memory while USDA remains responsive", async () => {
  const directory = await mkdtemp(path.join(process.env.OFF_SCALE_DIRECTORY ?? tmpdir(), "off-scale-"));
  const database = openApplicationDatabase({ databasePath: path.join(directory, "app.sqlite"), migrationsFolder: path.resolve("drizzle") });
  const workerPath = path.resolve("app/catalog-management/import-worker.ts");
  const usda = new CatalogManagement(database.getClient(), { directory, workerPath });
  const off = new CatalogManagement(database.getClient(), { directory, workerPath, provider: "open-food-facts" });
  const basic = new LocalUsdaAdapter(usda, directory);
  const packaged = new LocalOpenFoodFactsAdapter(off, directory);
  let peakRss = process.memoryUsage().rss;
  const usdaResponsiveness: number[] = [];
  const offResponsiveness: number[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let sample: Promise<void> | undefined;
  let sampleError: unknown;
  try {
    await usda.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
    while (usda.read().busy) await new Promise(resolve => setTimeout(resolve, 20));
    expect(usda.read().job?.phase).toBe("succeeded");
    await off.submitArchive({ filename: "installed.csv.gz", stream: Readable.from(offArchive([{ ...offWithBasis("100g"), product_name: "Installed oats" }])) });
    while (off.read().busy) await new Promise(resolve => setTimeout(resolve, 20));
    const previousOffGeneration = off.read().installed!.generation;
    timer = setInterval(() => {
      if (sample) return;
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      sample = (async () => {
        const usdaStarted = performance.now();
        await basic.getFood("748967");
        usdaResponsiveness.push(performance.now() - usdaStarted);
        const offStarted = performance.now();
        await Promise.all([packaged.lookupBarcode("0012345678905"), packaged.search("installed oats")]);
        offResponsiveness.push(performance.now() - offStarted);
      })().catch(error => { sampleError = error; }).finally(() => { sample = undefined; });
    }, 100);
    const started = performance.now();
    await off.submitArchive({ filename: path.basename(process.env.OFF_LOCAL_ARCHIVE!), stream: createReadStream(process.env.OFF_LOCAL_ARCHIVE!) });
    while (off.read().busy) await new Promise(resolve => setTimeout(resolve, 100));
    const elapsedMs = performance.now() - started;
    clearInterval(timer);
    await sample;
    expect(sampleError).toBeUndefined();
    expect(off.read().job, JSON.stringify(off.read())).toMatchObject({ phase: "succeeded" });
    expect(off.read().installed?.generation).not.toBe(previousOffGeneration);
    const lookups: number[] = [];
    const exactSearches: number[] = [];
    const prefixSearches: number[] = [];
    const knownProduct = await packaged.lookupBarcode("3017620422003");
    const exactProductQuery = knownProduct.name;
    const prefixProductQuery = knownProduct.name.slice(0, Math.max(2, Math.min(6, knownProduct.name.length - 1)));
    let exactProductNameMatched = false;
    let prefixProductNameMatched = false;
    const normalizedExactProductQuery = exactProductQuery.toLocaleLowerCase("en");
    const normalizedPrefixProductQuery = prefixProductQuery.toLocaleLowerCase("en");
    for (let index = 0; index < 100; index++) {
      const started = performance.now();
      // Missing as well as present indexed text identifiers exercise the local lookup path.
      await packaged.lookupBarcode(["3017620422003", "5449000000996", "0000000000000"][index % 3]).catch(() => undefined);
      lookups.push(performance.now() - started);
    }
    for (let index = 0; index < 40; index++) {
      const started = performance.now();
      const exactResults = await packaged.search(exactProductQuery);
      exactProductNameMatched ||= exactResults.some(result => result.name.toLocaleLowerCase("en") === normalizedExactProductQuery);
      exactSearches.push(performance.now() - started);
      const prefixStarted = performance.now();
      const prefixResults = await packaged.search(prefixProductQuery);
      prefixProductNameMatched ||= prefixResults.some(result => result.name.toLocaleLowerCase("en").startsWith(normalizedPrefixProductQuery));
      prefixSearches.push(performance.now() - prefixStarted);
    }
    const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
    const state = off.read();
    const bytes = (await stat(path.join(directory, `${state.installed!.generation}.sqlite`))).size;
    const measurements = {
      usdaDuringReplacementP95Ms: p95(usdaResponsiveness),
      offDuringReplacementP95Ms: p95(offResponsiveness),
      offLookupP95Ms: p95(lookups),
      offExactSearchP95Ms: p95(exactSearches),
      offPrefixSearchP95Ms: p95(prefixSearches),
    };
    process.stdout.write(JSON.stringify({ elapsedMs, peakRssMiB: peakRss / 1024 ** 2, catalogBytes: bytes, exactProductQuery, prefixProductQuery, ...measurements, state }));
    // Opt-in benchmark budget: p95 local lookup <100ms, process RSS <1GiB.
    expect(Object.values(measurements).every(value => value < 100)).toBe(true);
    expect(exactProductNameMatched).toBe(true);
    expect(prefixProductNameMatched).toBe(true);
    expect(exactSearches).toHaveLength(40);
    expect(prefixSearches).toHaveLength(40);
    expect(peakRss).toBeLessThan(1024 ** 3);
  } finally {
    clearInterval(timer); await off.shutdown(); await usda.shutdown(); database.close(); await rm(directory, { recursive: true, force: true });
  }
}, 30 * 60 * 1000);
