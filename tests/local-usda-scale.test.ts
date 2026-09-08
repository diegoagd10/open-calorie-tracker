import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import { openApplicationDatabase } from "../app/database/database.server";

test.skipIf(!process.env.USDA_LOCAL_ARCHIVE)("full external Foundation archive imports without blocking local request work", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "usda-scale-"));
  const database = openApplicationDatabase({ databasePath: path.join(directory, "app.sqlite"), migrationsFolder: path.resolve("drizzle") });
  const management = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts") });
  const catalog = new LocalUsdaAdapter(management, directory);
  let peakRss = process.memoryUsage().rss;
  let maxTimerDelay = 0;
  let previous = performance.now();
  const timer = setInterval(() => { const now = performance.now(); maxTimerDelay = Math.max(maxTimerDelay, now - previous - 10); previous = now; peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  try {
    const started = performance.now();
    await management.submitArchive({ filename: path.basename(process.env.USDA_LOCAL_ARCHIVE!), stream: createReadStream(process.env.USDA_LOCAL_ARCHIVE!) });
    while (management.read().busy) await new Promise(resolve => setTimeout(resolve, 20));
    const elapsedMs = performance.now() - started;
    const state = management.read();
    expect(state.job?.phase).toBe("succeeded");
    const timings: number[] = [];
    for (let index = 0; index < 100; index++) {
      const time = performance.now();
      const foods = await catalog.search(["tilapia", "eggs", "broccoli", "spinach"][index % 4]);
      expect(foods.length).toBeGreaterThan(0);
      await catalog.getFood(foods[0].providerFoodId);
      timings.push(performance.now() - time);
    }
    timings.sort((a, b) => a - b);
    const disk = await stat(path.join(directory, `${state.installed!.generation}.sqlite`));
    process.stdout.write(JSON.stringify({ elapsedMs, peakRssMiB: peakRss / 1024 / 1024, maxTimerDelayMs: maxTimerDelay, lookupP95Ms: timings[94], catalogBytes: disk.size, installed: state.installed, exclusions: state.job?.exclusions }));
  } finally { clearInterval(timer); await management.shutdown(); database.close(); await rm(directory, { recursive: true, force: true }); }
}, 60000);
