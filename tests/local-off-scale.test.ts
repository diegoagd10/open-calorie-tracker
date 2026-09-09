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
    const searches: number[] = [];
    for (let index = 0; index < 100; index++) {
      const started = performance.now();
      // Missing as well as present indexed text identifiers exercise the local lookup path.
      await packaged.lookupBarcode(["3017620422003", "5449000000996", "0000000000000"][index % 3]).catch(() => undefined);
      lookups.push(performance.now() - started);
    }
    for (let index = 0; index < 40; index++) {
      const started = performance.now();
      await packaged.search(["nutella", "coca cola", "oat milk", "whole grain cereal"][index % 4]);
      searches.push(performance.now() - started);
    }
    const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
    const state = off.read();
    const bytes = (await stat(path.join(directory, `${state.installed!.generation}.sqlite`))).size;
    process.stdout.write(JSON.stringify({ elapsedMs, peakRssMiB: peakRss / 1024 ** 2, catalogBytes: bytes, usdaDuringReplacementP95Ms: p95(usdaResponsiveness), offDuringReplacementP95Ms: p95(offResponsiveness), offLookupP95Ms: p95(lookups), offSearchP95Ms: p95(searches), state }));
    // Opt-in benchmark budget: p95 local lookup <100ms, process RSS <1GiB.
    expect(p95(usdaResponsiveness)).toBeLessThan(100);
    expect(p95(offResponsiveness)).toBeLessThan(100);
    expect(p95(lookups)).toBeLessThan(100);
    expect(searches).toHaveLength(40);
    expect(peakRss).toBeLessThan(1024 ** 3);
  } finally {
    clearInterval(timer); await off.shutdown(); await usda.shutdown(); database.close(); await rm(directory, { recursive: true, force: true });
  }
}, 30 * 60 * 1000);
