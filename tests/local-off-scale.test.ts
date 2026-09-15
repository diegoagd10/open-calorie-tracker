import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import express from "express";
import { mountLocalCatalogImport } from "../server/local-catalog-import";

import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { FoodCatalog } from "../app/catalog/food-catalog.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import { users, userPreferences } from "../app/database/schema.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import { LocalOpenFoodFactsAdapter } from "../app/catalog/local-off.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { foundationArchive } from "./support/foundation-archive";
import { offArchive, offWithBasis } from "./support/off-archive";

test.skipIf(!process.env.OFF_LOCAL_ARCHIVE)("full OFF export imports with bounded memory while USDA remains responsive", async () => {
  const directory = await mkdtemp(path.join(process.env.OFF_SCALE_DIRECTORY ?? tmpdir(), "off-scale-"));
  const database = openApplicationDatabase({ databasePath: path.join(directory, "app.sqlite"), migrationsFolder: path.resolve("drizzle") });
  const workerPath = path.resolve("build/catalog/import-worker.js");
  const usda = new CatalogManagement(database.getClient(), { directory, workerPath });
  const off = new CatalogManagement(database.getClient(), { directory, workerPath, provider: "open-food-facts" });
  const basic = new LocalUsdaAdapter(usda, directory);
  const packaged = new LocalOpenFoodFactsAdapter(off, directory);
  let peakRss = process.memoryUsage().rss;
  const usdaResponsiveness: number[] = [];
  const offResponsiveness: number[] = [];
  const offBeforeReplacement: number[] = [];
  const controlToken = "b".repeat(64);
  await writeFile(path.join(directory, ".local-import-token"), controlToken + "\n", { mode: 0o600 });
  const app = express();
  mountLocalCatalogImport(app, { controlToken, getManagement: provider => provider === "open-food-facts" ? off : usda });
  const server = createServer(app);
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing scale port");
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
    for (let index = 0; index < 30; index++) {
      const started = performance.now();
      await packaged.lookupBarcode("0012345678905");
      offBeforeReplacement.push(performance.now() - started);
    }
    timer = setInterval(() => {
      if (sample) return;
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      sample = (async () => {
        const usdaStarted = performance.now();
        await basic.getFood("748967");
        usdaResponsiveness.push(performance.now() - usdaStarted);
        const offStarted = performance.now();
        await packaged.lookupBarcode("0012345678905");
        offResponsiveness.push(performance.now() - offStarted);
      })().catch(error => { sampleError = error; }).finally(() => { sample = undefined; });
    }, 100);
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const command = spawn("pnpm", ["catalog:import:off", "--", process.env.OFF_LOCAL_ARCHIVE!], { env: { ...process.env, PORT: String(address.port), CATALOG_DIRECTORY: directory }, stdio: ["ignore", "pipe", "pipe"] });
      command.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
      command.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
      command.once("error", reject);
      command.once("exit", code => code === 0 ? resolve() : reject(new Error(`Operator command exited ${code}: ${JSON.stringify(off.read())}`)));
    });
    while (off.read().busy) await new Promise(resolve => setTimeout(resolve, 100));
    const elapsedMs = performance.now() - started;
    clearInterval(timer);
    await sample;
    expect(sampleError).toBeUndefined();
    expect(off.read().job, JSON.stringify(off.read())).toMatchObject({ phase: "succeeded" });
    expect(off.read().installed?.generation).not.toBe(previousOffGeneration);
    const target = await packaged.lookupBarcode("643843715887");
    expect(await packaged.lookupBarcode("0643843715887")).toEqual(target);
    expect(target).toMatchObject({ name: "100% Whey Protein Powder", isSelectable: true, nutritionPerAuthoritativeBase: { energyMilliKcal: { amount: 150 }, proteinMilligrams: { amount: 30 }, carbohydrateMilligrams: { amount: 4 }, fatMilligrams: { amount: 2 }, fiberMilligrams: { amount: 1 }, sugarMilligrams: { amount: 1 }, sodiumMilligrams: { amount: 0.17 } } });
    const client = database.getClient();
    const createdAt = "2026-09-13T12:00:00.000Z";
    const user = client.insert(users).values({ usernameNormalized: "scale.member", createdAt }).returning().get();
    client.insert(userPreferences).values({ userId: user.id, timeZone: "UTC", displayUnits: "metric", createdAt, updatedAt: createdAt }).run();
    const entries = new FoodEntryService(client, new FoodCatalog([{ provider: "open-food-facts", capability: "barcode", service: packaged }]));
    for (const quantity of ["1", "2"]) {
      const saved = await entries.log(user.id, { provider: target.provider, providerFoodId: target.providerFoodId, catalogGeneration: target.catalogGeneration, selectedMeasurementId: "serving", quantity, foodLogDate: "2026-09-13", idempotencyKey: `scale-serving-${quantity}` });
      expect(entries.read(user.id, saved.id)).toMatchObject({ energyMilliKcal: quantity === "1" ? 150_000 : 300_000, proteinMilligrams: quantity === "1" ? 30_000 : 60_000 });
    }
    const lookups: number[] = [];
    for (let index = 0; index < 100; index++) {
      const started = performance.now();
      // Missing as well as present identifiers exercise the local barcode lookup path.
      await packaged.lookupBarcode(["3017620422003", "5449000000996", "0000000000000"][index % 3]).catch(() => undefined);
      lookups.push(performance.now() - started);
    }
    const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
    const state = off.read();
    const bytes = (await stat(path.join(directory, `${state.installed!.generation}.sqlite`))).size;
    const measurements = {
      offBeforeReplacementP95Ms: p95(offBeforeReplacement),
      usdaDuringReplacementP95Ms: p95(usdaResponsiveness),
      offDuringReplacementP95Ms: p95(offResponsiveness),
      offLookupP95Ms: p95(lookups),
    };
    const report = { hardware: { cpu: cpus()[0].model, logicalCpus: cpus().length, memoryBytes: totalmem(), os: `${platform()} ${release()}`, runtime: process.version }, elapsedMs, peakRssMiB: peakRss / 1024 ** 2, catalogBytes: bytes, compressedBytes: (await stat(process.env.OFF_LOCAL_ARCHIVE!)).size, ...measurements, state };
    await mkdir("reports", { recursive: true });
    await writeFile("reports/off-jsonl-scale.json", JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify(report));
    // Opt-in benchmark budget: p95 local lookup <100ms, process RSS <1GiB.
    expect(Object.values(measurements).every(value => value < 100)).toBe(true);
    expect(peakRss).toBeLessThan(1024 ** 3);
  } finally {
    clearInterval(timer); await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); }); await off.shutdown(); await usda.shutdown(); database.close(); await rm(directory, { recursive: true, force: true });
  }
}, 120 * 60 * 1000);
