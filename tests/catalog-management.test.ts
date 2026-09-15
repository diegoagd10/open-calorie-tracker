import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { CatalogManagement, type CatalogImportJob, type CatalogManagementOptions, type FoundationReleaseMetadata } from "../app/catalog-management/catalog-management.server";
import { LocalOpenFoodFactsAdapter } from "../app/catalog/local-off.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { saveCatalogState, saveCatalogUpdateCheck } from "../app/database/catalog-state.server";
import { foundationArchive } from "./support/foundation-archive";
import { offArchive, offWithBasis } from "./support/off-archive";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, statfs: vi.fn(actual.statfs), chmod: vi.fn(actual.chmod), rm: vi.fn(actual.rm) };
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.resetAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup(options: Partial<CatalogManagementOptions> = {}, defaults = false) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "catalog-management-"));
  const database = openApplicationDatabase({ databasePath: path.join(directory, "app.sqlite"), migrationsFolder: path.resolve("drizzle") });
  const settings = { directory, provider: "open-food-facts" as const, workerPath: path.resolve("app/catalog-management/import-worker.ts"), ...(defaults ? {} : { maxExpandedBytes: 10 * 1024 * 1024, maxUploadBytes: 1024 * 1024 }), ...options };
  const management = new CatalogManagement(database.getClient(), settings);
  cleanups.push(async () => { await management.shutdown(); database.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { management, directory, database, settings };
}
const finished = async (management: CatalogManagement) => vi.waitFor(() => expect(management.read().busy).toBe(false));
const officialRelease: FoundationReleaseMetadata = {
  releasePeriod: "2026-04",
  identifier: "FoodData Central 15.0",
  releasedOn: "2026-04-30",
  archiveUrl: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip",
  archiveFilename: "FoodData_Central_foundation_food_csv_2026-04-30.zip",
  archiveByteLength: 1234,
};

test.each([
  ["off.zip", undefined], ["a".repeat(253) + ".gz", undefined], ["off.gz", 0], ["off.gz", -1], ["off.gz", 1.5], ["off.gz", Number.NaN], ["off.gz", 1025],
] as const)("invalid upload metadata %# is rejected before claiming installation", async (filename, size) => {
  const { management } = await setup({ maxUploadBytes: 1024 });
  await expect(management.submitArchive({ filename, size, stream: Readable.from("unused") })).rejects.toThrow(filename.endsWith(".gz") && filename.length <= 255 ? "Archive exceeds the configured upload limit or is empty." : "Choose a Open Food Facts .gz archive.");
  expect(management.read()).toEqual({ installed: null, job: null, busy: false });
});

test("boundary-sized uppercase uploads preserve metadata and remove private staging files", async () => {
  const archive = offArchive([offWithBasis("serving")]);
  const { management, directory } = await setup({ maxUploadBytes: archive.length });
  const filename = "a".repeat(252) + ".GZ";
  await management.submitArchive({ filename, size: archive.length, stream: Readable.from([archive.subarray(0, 5), archive.subarray(5)]) });
  expect(management.read().job?.phase).toBe("queued");
  await finished(management);
  const state = management.read();
  expect(state.installed).toMatchObject({ filename, sha256: createHash("sha256").update(archive).digest("hex"), foodCount: 1 });
  expect(state.job).toMatchObject({ phase: "succeeded", filename, receivedBytes: archive.length, processedRecords: 1, importedRecords: 1, rejectedRecords: 0, error: null });
  const databaseFile = await fs.stat(path.join(directory, `${state.installed!.generation}.sqlite`));
  expect(state.installed?.databaseBytes).toBe(databaseFile.size);
  expect(databaseFile.mode & 0o777).toBe(0o444);
  expect((await fs.readdir(directory)).filter(name => name.startsWith(state.job!.id))).toEqual([`${state.job!.id}.sqlite`]);
});

test.each([
  [0, undefined, "Upload was empty or incomplete. Upload the archive again."],
  [5, 10, "Upload was empty or incomplete. Upload the archive again."],
  [11, undefined, "Archive exceeds the configured upload limit."],
] as const)("failed upload %# reports the specific error and removes the archive", async (bytes, size, error) => {
  const { management, directory } = await setup({ maxUploadBytes: 10 });
  await management.submitArchive({ filename: "off.gz", stream: Readable.from(Buffer.alloc(bytes)), size });
  expect(management.read()).toMatchObject({ installed: null, busy: false, job: { phase: "failed", error } });
  expect((await fs.readdir(directory)).filter(name => name.startsWith(management.read().job!.id))).toEqual([]);
});

test("stream errors are reported as upload failures and shutdown cancels an unfinished upload", async () => {
  const { management, directory } = await setup();
  const stream = new Readable({ read() { this.destroy(new Error("private stream error")); } });
  await management.submitArchive({ filename: "off.gz", stream });
  expect(management.read().job?.error).toBe("Open Food Facts upload failed. Check available disk space and upload the archive again.");
  const pending = new PassThrough();
  const receiving = management.submitArchive({ filename: "off.gz", stream: pending });
  pending.write("partial");
  await vi.waitFor(() => expect(management.read().job?.receivedBytes).toBe(7));
  expect(management.read().job).toMatchObject({ phase: "uploading", processedRecords: 0, exclusions: {}, error: null });
  await management.shutdown(); await receiving;
  expect(management.read()).toMatchObject({ busy: false, installed: null, job: { phase: "interrupted", error: "Open Food Facts installation was interrupted by server shutdown. Upload the archive again." } });
  expect((await fs.readdir(directory)).filter(name => name.startsWith(management.read().job!.id))).toEqual([]);
});

test("disk preflight uses expanded reserve plus the advertised upload size", async () => {
  const { management } = await setup({ maxUploadBytes: 1000, maxExpandedBytes: 10000 });
  const real = await fs.statfs(tmpdir());
  vi.mocked(fs.statfs).mockResolvedValue({ ...real, bavail: 20009, bsize: 1 });
  await management.submitArchive({ filename: "off.gz", size: 10, stream: Readable.from(Buffer.alloc(10)) });
  expect(management.read().job?.error).toBe("Not enough disk space for Open Food Facts import. Free space and retry.");
  vi.mocked(fs.statfs).mockResolvedValue({ ...real, bavail: 20010, bsize: 1 });
  await management.submitArchive({ filename: "off.gz", size: 10, stream: Readable.from(Buffer.alloc(10)) });
  await finished(management);
  expect(management.read().job?.error).toBe("Corrupt OFF GZIP or malformed TSV/JSONL. Download the archive again.");
});

test.each(["usda-fdc", "open-food-facts"] as const)("%s defaults reserve independent archive sizes", async provider => {
  const { management } = await setup({ provider }, true);
  const real = await fs.statfs(tmpdir());
  const reserve = provider === "usda-fdc" ? 576 * 1024 ** 2 : 80 * 1024 ** 3;
  vi.mocked(fs.statfs).mockResolvedValue({ ...real, bavail: reserve - 1, bsize: 1 });
  await management.submitArchive({ filename: provider === "usda-fdc" ? "source.zip" : "source.gz", stream: Readable.from("test") });
  expect(management.read().job?.error).toBe(`Not enough disk space for ${provider === "usda-fdc" ? "USDA" : "Open Food Facts"} import. Free space and retry.`);
  vi.mocked(fs.statfs).mockResolvedValue({ ...real, bavail: reserve, bsize: 1 });
  await management.submitArchive({ filename: provider === "usda-fdc" ? "source.zip" : "source.gz", stream: Readable.from("test") });
  await finished(management);
  expect(management.read().job?.error).toBe(provider === "usda-fdc" ? "Invalid or corrupt Foundation CSV ZIP, or insufficient disk space. Verify the download and retry." : "Corrupt OFF GZIP or malformed TSV/JSONL. Download the archive again.");
});

test.each(["present", "missing"] as const)("restart marks an unfinished provider job interrupted when staging is %s, cleans up, and permits retry", async staging => {
  const { database, settings, directory } = await setup();
  const id = "interrupted-job";
  const job = { id, operation: "install" as const, filename: "off.gz", phase: "importing" as const, receivedBytes: 100, processedRecords: 7, exclusions: {}, error: null, startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  saveCatalogState(database.getClient(), { installed: null, job }, "open-food-facts");
  await fs.writeFile(path.join(directory, `${id}.gz`), "partial");
  await fs.writeFile(path.join(directory, `${id}.sqlite`), "partial database");
  await fs.writeFile(path.join(directory, `${id}.sqlite-journal`), "partial journal");
  if (staging === "present") await fs.mkdir(path.join(directory, `${id}.staging`));
  const recovered = new CatalogManagement(database.getClient(), settings);
  expect(recovered.read()).toMatchObject({ installed: null, busy: false, job: { phase: "interrupted", processedRecords: 7, error: "Open Food Facts installation was interrupted by a server restart. Upload the archive again." } });
  await vi.waitFor(async () => expect((await fs.readdir(directory)).filter(name => name.startsWith(id))).toEqual([]));
  expect(recovered.outcomes()[0]).toMatchObject({ phase: "interrupted", operation: "install" });
  const unchanged = new CatalogManagement(database.getClient(), settings);
  expect(unchanged.read()).toEqual(recovered.read());
  await recovered.submitArchive({ filename: "retry.gz", stream: Readable.from(offArchive([offWithBasis("serving")])) });
  await finished(recovered);
  expect(recovered.read()).toMatchObject({ installed: { filename: "retry.gz" }, job: { phase: "succeeded", error: null } });
});

test("startup removes abandoned generation artifacts without touching either active catalog or unrelated files", async () => {
  const { management: usda, database, directory, settings } = await setup({ provider: "usda-fdc" });
  await usda.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await finished(usda);
  const off = new CatalogManagement(database.getClient(), { ...settings, provider: "open-food-facts" });
  cleanups.unshift(() => off.shutdown());
  await off.submitArchive({ filename: "products.gz", stream: Readable.from(offArchive([offWithBasis("serving")])) });
  await finished(off);
  const activeFiles = [usda.read().installed!.generation, off.read().installed!.generation].map(generation => `${generation}.sqlite`);
  const abandoned = "00000000-0000-4000-8000-000000000099";
  const retiring = "00000000-0000-4000-8000-000000000097";
  const inFlight = "00000000-0000-4000-8000-000000000098";
  await Promise.all([
    fs.writeFile(path.join(directory, `${abandoned}.sqlite`), "abandoned generation"),
    fs.writeFile(path.join(directory, `${abandoned}.sqlite-journal`), "abandoned journal"),
    fs.writeFile(path.join(directory, `${abandoned}.zip`), "abandoned upload"),
    fs.writeFile(path.join(directory, `${abandoned}.gz`), "abandoned upload"),
    fs.mkdir(path.join(directory, `${abandoned}.staging`)),
    fs.writeFile(path.join(directory, `${retiring}.sqlite`), "protected retiring generation"),
    fs.writeFile(path.join(directory, `${inFlight}.gz`), "protected in-flight upload"),
    fs.writeFile(path.join(directory, `${inFlight}.sqlite`), "protected in-flight generation"),
    fs.mkdir(path.join(directory, `${inFlight}.staging`)),
    fs.writeFile(path.join(directory, "operator-note.txt"), "keep me"),
    fs.writeFile(path.join(directory, `${abandoned}.sqlite.backup`), "keep me"),
    fs.writeFile(path.join(directory, `prefix-${abandoned}.sqlite`), "keep me"),
  ]);
  const offInstalled = off.read().installed!;
  saveCatalogState(database.getClient(), {
    installed: offInstalled,
    retiring: { ...offInstalled, generation: retiring },
    job: { ...off.read().job!, id: inFlight, phase: "importing" },
  }, "open-food-facts");

  const restarted = new CatalogManagement(database.getClient(), settings);
  cleanups.unshift(() => restarted.shutdown());
  const abandonedArtifacts = ["sqlite", "sqlite-journal", "zip", "gz", "staging"].map(extension => `${abandoned}.${extension}`);
  await vi.waitFor(async () => expect((await fs.readdir(directory)).filter(name => abandonedArtifacts.includes(name))).toEqual([]));
  await restarted.shutdown();

  expect(await fs.readdir(directory)).toEqual(expect.arrayContaining([
    ...activeFiles,
    `${retiring}.sqlite`,
    `${inFlight}.gz`,
    `${inFlight}.sqlite`,
    `${inFlight}.staging`,
    `${abandoned}.sqlite.backup`,
    `prefix-${abandoned}.sqlite`,
    "app.sqlite",
    "operator-note.txt",
  ]));
  await expect(restarted.withActiveGeneration(generation => generation)).resolves.toBe(usda.read().installed!.generation);
  await expect(off.withActiveGeneration(generation => generation)).resolves.toBe(off.read().installed!.generation);
});

test("worker crashes and activation failures never install a generation", async () => {
  const { management, directory, settings, database } = await setup();
  const workerPath = path.join(directory, "crash.mjs");
  await fs.writeFile(workerPath, 'throw new Error("private worker error");');
  const crashing = new CatalogManagement(database.getClient(), { ...settings, workerPath });
  await crashing.submitArchive({ filename: "off.gz", stream: Readable.from("bytes") });
  await finished(crashing);
  expect(crashing.read().job?.error).toBe("Open Food Facts import worker failed. Check server storage and retry the upload.");
  await crashing.shutdown();
  vi.mocked(fs.chmod).mockRejectedValue(new Error("private disk failure"));
  await management.submitArchive({ filename: "off.gz", stream: Readable.from(offArchive([offWithBasis("serving")])) });
  await finished(management);
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error: "Open Food Facts activation failed. Check server storage and retry the upload." } });
  expect((await fs.readdir(directory)).filter(name => name.startsWith(management.read().job!.id))).toEqual([]);
});

async function workerSetup(ending: string) {
  const context = await setup();
  const workerPath = path.join(context.directory, "controlled.mjs");
  await fs.writeFile(workerPath, `import { parentPort, workerData } from "node:worker_threads";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
const { directory, generation } = workerData;
writeFileSync(path.join(directory, generation + ".sqlite"), "temporary generation");
writeFileSync(path.join(directory, generation + ".sqlite-journal"), "temporary journal");
mkdirSync(path.join(directory, generation + ".staging"));
parentPort.postMessage({progress: {phase: "importing", processedRecords: 7, exclusions: { invalid_record: 2 }}});
const release = setInterval(() => {
  if (!existsSync(path.join(directory, "release"))) return;
  clearInterval(release);
  ${ending}
}, 1);
`);
  const management = new CatalogManagement(context.database.getClient(), { ...context.settings, workerPath });
  cleanups.unshift(() => management.shutdown());
  return { ...context, management, release: () => fs.writeFile(path.join(context.directory, "release"), "ready") };
}
const resultMessage = 'parentPort.postMessage({result: {foodCount: 1, publicationDateRange: {earliest: "2024-01-01", latest: "2025-01-01"}}});';
function activatingJob(id: string, filename = "replacement.zip"): CatalogImportJob {
  return {
    id, filename, phase: "activating", receivedBytes: 100, processedRecords: 4,
    exclusions: {}, error: null, startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
}
type RecoveryProvider = "usda-fdc" | "open-food-facts";
type BrokenReplacement = (input: { databaseBytes: number; path: string; provider: RecoveryProvider; sourcePath: string }) => Promise<void>;
async function restartWithBrokenPublishedReplacement(provider: RecoveryProvider, breakReplacement: BrokenReplacement) {
  const context = await setup({ provider });
  const archive = provider === "usda-fdc" ? await foundationArchive() : offArchive([offWithBasis("serving")]);
  const filename = provider === "usda-fdc" ? "foundation.zip" : "products.gz";
  await context.management.submitArchive({ filename, stream: Readable.from(archive) });
  await finished(context.management);
  const previous = context.management.read().installed!;
  const replacementId = "00000000-0000-4000-8000-000000000009";
  const replacement = { ...previous, generation: replacementId, filename: `replacement${path.extname(filename)}` };
  await breakReplacement({ databaseBytes: previous.databaseBytes!, path: path.join(context.directory, `${replacementId}.sqlite`), provider, sourcePath: path.join(context.directory, `${previous.generation}.sqlite`) });
  saveCatalogState(context.database.getClient(), { installed: replacement, retiring: previous, job: activatingJob(replacementId, replacement.filename) }, provider);
  const restarted = new CatalogManagement(context.database.getClient(), context.settings);
  cleanups.unshift(() => restarted.shutdown());
  return { ...context, previous, restarted };
}
const brokenPublishedReplacements: [string, BrokenReplacement][] = [
  ["missing", async () => undefined],
  ["empty", async ({ path: replacementPath }) => fs.writeFile(replacementPath, "")],
  ["a directory", async ({ path: replacementPath }) => fs.mkdir(replacementPath).then(() => undefined)],
  ["truncated", async ({ databaseBytes, path: replacementPath }) => fs.writeFile(replacementPath, Buffer.alloc(databaseBytes - 1))],
  ["unreadable", async ({ databaseBytes, path: replacementPath }) => fs.writeFile(replacementPath, Buffer.alloc(databaseBytes))],
  ["a readable database with an unexpected size", async ({ path: replacementPath, sourcePath }) => {
    await fs.copyFile(sourcePath, replacementPath);
    await fs.chmod(replacementPath, 0o600);
    const generation = new BetterSqlite3(replacementPath);
    generation.exec("CREATE TABLE recovery_padding (value BLOB); INSERT INTO recovery_padding VALUES (zeroblob(65536))");
    generation.close();
  }],
  ["unusable required records", async ({ path: replacementPath, provider, sourcePath }) => {
    await fs.copyFile(sourcePath, replacementPath);
    await fs.chmod(replacementPath, 0o600);
    const generation = new BetterSqlite3(replacementPath);
    generation.exec(`DELETE FROM ${provider === "usda-fdc" ? "names" : "products"}`);
    generation.close();
  }],
];

test("shutdown interrupts the live worker and removes its partial generation", async () => {
  const { management, directory } = await workerSetup(resultMessage);
  await management.submitArchive({ filename: "off.gz", stream: Readable.from("archive") });
  await vi.waitFor(() => expect(management.read().job?.processedRecords).toBe(7));
  expect(management.read().job?.exclusions).toEqual({ invalid_record: 2 });
  await management.shutdown();
  expect(management.outcomes()).toMatchObject([{ provider: "open-food-facts", phase: "interrupted", installed: null, acknowledgedAt: null }]);
  expect(management.read()).toMatchObject({ installed: null, busy: false, job: { phase: "interrupted", error: "Open Food Facts installation was interrupted by server shutdown. Upload the archive again." } });
  expect((await fs.readdir(directory)).filter(name => name.startsWith(management.read().job!.id))).toEqual([]);
});

test.each([
  ["", "Open Food Facts import stopped before completion. Upload the archive again."],
  [`${resultMessage} process.exitCode = 1;`, "Open Food Facts import stopped before completion. Upload the archive again."],
  [`parentPort.postMessage({error: "Source validation failed"}); ${resultMessage}`, "Source validation failed"],
] as const)("an incomplete, nonzero, or rejected worker outcome %# cannot activate a generation", async (ending, error) => {
  const { management, directory, release } = await workerSetup(ending);
  await management.submitArchive({ filename: "off.gz", stream: Readable.from("archive") });
  await release();
  await finished(management);
  expect(management.read()).toMatchObject({ installed: null, busy: false, job: { phase: "failed", error } });
  expect((await fs.readdir(directory)).filter(name => name.startsWith(management.read().job!.id))).toEqual([]);
});

test.each(["missing", "different", "interrupted"] as const)("a stale worker does not activate over a %s job", async change => {
  const { management, database, directory, release } = await workerSetup(resultMessage);
  await management.submitArchive({ filename: "off.gz", stream: Readable.from("archive") });
  await vi.waitFor(() => expect(management.read().job?.processedRecords).toBe(7));
  const job = management.read().job!;
  saveCatalogState(database.getClient(), { installed: null, job: change === "missing" ? null : { ...job, id: change === "different" ? "new-job" : job.id, phase: "interrupted" } }, "open-food-facts");
  await release();
  await vi.waitFor(async () => { await expect(fs.access(path.join(directory, `${job.id}.gz`))).rejects.toMatchObject({ code: "ENOENT" }); });
  expect(management.read().installed).toBeNull();
});

test("installation claims prevent overlap and permit deliberate OFF reimport", async () => {
  const { management } = await setup();
  const pending = new PassThrough();
  const upload = management.submitArchive({ filename: "off.gz", stream: pending });
  await expect(management.submitArchive({ filename: "off.gz", stream: Readable.from("other") })).rejects.toThrow("A Open Food Facts installation is already running.");
  pending.end(offArchive([offWithBasis("serving")])); await upload; await finished(management);
  const firstGeneration = management.read().installed?.generation;
  await management.submitArchive({ filename: "off-reimport.gz", stream: Readable.from(offArchive([offWithBasis("serving")])) });
  await finished(management);
  expect(management.read()).toMatchObject({ installed: { filename: "off-reimport.gz" }, job: { phase: "succeeded" } });
  expect(management.read().installed?.generation).not.toBe(firstGeneration);
});

test("activation publishes the replacement to new readers before retiring the generation held by an in-flight reader", async () => {
  const { management, directory } = await setup({ provider: "usda-fdc" });
  const archive = await foundationArchive();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(archive) });
  await finished(management);
  const oldGeneration = management.read().installed!.generation;

  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const heldFirst = new Promise<void>(resolve => { releaseFirst = resolve; });
  const heldSecond = new Promise<void>(resolve => { releaseSecond = resolve; });
  let readersStarted = 0;
  const holdOldReader = (held: Promise<void>) => management.withActiveGeneration(async generation => {
    readersStarted += 1;
    expect(generation).toBe(oldGeneration);
    await held;
    return generation;
  });
  const firstOldReader = holdOldReader(heldFirst);
  const secondOldReader = holdOldReader(heldSecond);
  await vi.waitFor(() => expect(readersStarted).toBe(2));
  await fs.writeFile(path.join(directory, `${oldGeneration}.sqlite-journal`), "retained journal");

  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(archive) });
  await vi.waitFor(() => {
    expect(management.read().installed?.generation).not.toBe(oldGeneration);
    expect(management.read().job?.phase).toBe("activating");
  });
  await expect(fs.access(path.join(directory, `${oldGeneration}.sqlite`))).resolves.toBeUndefined();
  await expect(management.withActiveGeneration(generation => generation)).resolves.toBe(management.read().installed?.generation);

  releaseFirst();
  await expect(firstOldReader).resolves.toBe(oldGeneration);
  expect(management.read().job?.phase).toBe("activating");
  await expect(fs.access(path.join(directory, `${oldGeneration}.sqlite`))).resolves.toBeUndefined();

  releaseSecond();
  await expect(secondOldReader).resolves.toBe(oldGeneration);
  await finished(management);
  await expect(fs.access(path.join(directory, `${oldGeneration}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(fs.access(path.join(directory, `${oldGeneration}.sqlite-journal`))).rejects.toMatchObject({ code: "ENOENT" });
  expect(management.read().job?.phase).toBe("succeeded");
});

test("restart completes an already-published activation handoff instead of interrupting the replacement", async () => {
  const { management, directory, database, settings } = await setup({ provider: "usda-fdc" });
  const archive = await foundationArchive();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(archive) });
  await finished(management);
  const old = management.read().installed!;
  const replacement = { ...old, generation: "00000000-0000-4000-8000-000000000001", filename: "replacement.zip", databaseBytes: undefined };
  await fs.copyFile(path.join(directory, `${old.generation}.sqlite`), path.join(directory, `${replacement.generation}.sqlite`));
  const activating = { ...activatingJob(replacement.generation, replacement.filename), operation: "update" as const };
  saveCatalogState(database.getClient(), { installed: replacement, retiring: old, job: activating }, "usda-fdc");

  const restarted = new CatalogManagement(database.getClient(), settings);
  cleanups.unshift(() => restarted.shutdown());
  await vi.waitFor(() => expect(restarted.read().busy).toBe(false));
  expect(restarted.read()).toMatchObject({
    installed: { generation: replacement.generation, filename: replacement.filename, foodCount: replacement.foodCount },
    job: { phase: "succeeded", error: null },
  });
  expect(restarted.read().retiring).toBeUndefined();
  expect(restarted.outcomes().find(outcome => outcome.jobId === replacement.generation)).toMatchObject({ phase: "succeeded", operation: "update" });
  await expect(fs.access(path.join(directory, `${old.generation}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(fs.access(path.join(directory, `${replacement.generation}.sqlite`))).resolves.toBeUndefined();
  await expect(new LocalUsdaAdapter(restarted, directory).getFood("748967")).resolves.toMatchObject({ providerFoodId: "748967" });
});

test("restart rejects an unconfirmed published generation when no previous catalog is available", async () => {
  const { database, directory, settings } = await setup({ provider: "usda-fdc" });
  const replacementId = "00000000-0000-4000-8000-000000000013";
  const replacement = {
    generation: replacementId,
    filename: "missing.zip",
    sha256: "replacement-sha",
    databaseBytes: 100,
    foodCount: 4,
    installedAt: "2026-01-01T00:00:00.000Z",
    publicationDateRange: { earliest: "2025-01-01", latest: "2026-01-01" },
  };
  await fs.writeFile(path.join(directory, `${replacementId}.sqlite`), "invalid catalog generation");
  saveCatalogState(database.getClient(), { installed: replacement, job: activatingJob(replacementId, replacement.filename) }, "usda-fdc");

  const restarted = new CatalogManagement(database.getClient(), settings);
  cleanups.unshift(() => restarted.shutdown());

  expect(restarted.read()).toMatchObject({
    installed: null,
    busy: false,
    job: {
      phase: "interrupted",
      error: "USDA replacement could not be confirmed after restart and no previous catalog is available. Upload the archive again.",
    },
  });
  await restarted.shutdown();
  await expect(fs.access(path.join(directory, `${replacementId}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
});

const recoveryProviders: { provider: RecoveryProvider; label: string; verify: (management: CatalogManagement, directory: string, generation: string) => Promise<void> }[] = [
  {
    provider: "usda-fdc",
    label: "USDA",
    verify: async (management, directory, generation) => {
      await expect(new LocalUsdaAdapter(management, directory).search("egg")).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ catalogGeneration: generation })]));
    },
  },
  {
    provider: "open-food-facts",
    label: "Open Food Facts",
    verify: async (management, directory, generation) => {
      const catalog = new LocalOpenFoodFactsAdapter(management, directory);
      await expect(catalog.lookupBarcode("0012345678905")).resolves.toMatchObject({ catalogGeneration: generation });
    },
  },
];
for (const { provider, label, verify } of recoveryProviders) {
  test.each(brokenPublishedReplacements)(`${provider} restart restores the previous generation when the published replacement is %s`, async (_failure, breakReplacement) => {
    const { previous, restarted, directory } = await restartWithBrokenPublishedReplacement(provider, breakReplacement);

    expect(restarted.read()).toMatchObject({
      installed: previous,
      busy: false,
      job: {
        phase: "interrupted",
        error: `${label} replacement could not be confirmed after restart. The previous catalog remains active. Upload the archive again.`,
      },
    });
    expect(restarted.read().retiring).toBeUndefined();
    await expect(fs.access(path.join(directory, `${previous.generation}.sqlite`))).resolves.toBeUndefined();
    await verify(restarted, directory, previous.generation);
  });
}

test("restart interrupts activation before publication and preserves the previous generation", async () => {
  const { management, directory, database, settings } = await setup({ provider: "usda-fdc" });
  const archive = await foundationArchive();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(archive) });
  await finished(management);
  const working = management.read().installed!;
  const pendingId = "00000000-0000-4000-8000-000000000002";
  const activating = activatingJob(pendingId);
  await fs.copyFile(path.join(directory, `${working.generation}.sqlite`), path.join(directory, `${pendingId}.sqlite`));
  await fs.writeFile(path.join(directory, `${pendingId}.zip`), archive);
  saveCatalogState(database.getClient(), { installed: working, job: activating }, "usda-fdc");

  const restarted = new CatalogManagement(database.getClient(), settings);
  cleanups.unshift(() => restarted.shutdown());
  expect(restarted.read()).toMatchObject({
    installed: working,
    busy: false,
    job: { phase: "interrupted", error: "USDA installation was interrupted by a server restart. Upload the archive again." },
  });
  await vi.waitFor(async () => expect((await fs.readdir(directory)).filter(name => name.startsWith(pendingId))).toEqual([]));
  await expect(fs.access(path.join(directory, `${working.generation}.sqlite`))).resolves.toBeUndefined();
});

test("restart interrupts an unpublished activation when no previous generation exists", async () => {
  const { database, directory, settings } = await setup({ provider: "usda-fdc" });
  const pendingId = "00000000-0000-4000-8000-000000000004";
  const activating = activatingJob(pendingId, "foundation.zip");
  await fs.writeFile(path.join(directory, `${pendingId}.sqlite`), "unpublished generation");
  saveCatalogState(database.getClient(), { installed: null, job: activating }, "usda-fdc");

  const restarted = new CatalogManagement(database.getClient(), settings);
  cleanups.unshift(() => restarted.shutdown());
  expect(restarted.read()).toMatchObject({
    installed: null,
    busy: false,
    job: { phase: "interrupted", error: "USDA installation was interrupted by a server restart. Upload the archive again." },
  });
  await vi.waitFor(async () => expect((await fs.readdir(directory)).filter(name => name.startsWith(pendingId))).toEqual([]));
});

test("reader release completes only the exact published activation handoff", async () => {
  const { management, database } = await setup({ provider: "usda-fdc" });
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await finished(management);
  const installed = management.read().installed!;
  const succeeded = management.read().job!;
  const importing = { ...succeeded, phase: "importing" as const };
  const mismatched = { ...succeeded, id: "00000000-0000-4000-8000-000000000003", phase: "activating" as const };
  const incompleteStates = [
    { installed, job: null },
    { installed, job: importing },
    { installed, job: mismatched },
    { installed: null, job: { ...succeeded, phase: "activating" as const } },
  ];

  for (const incomplete of incompleteStates) {
    saveCatalogState(database.getClient(), { installed, job: succeeded }, "usda-fdc");
    const read = management.withActiveGeneration(generation => {
      saveCatalogState(database.getClient(), incomplete, "usda-fdc");
      return generation;
    });
    await expect(read).resolves.toBe(installed.generation);
    expect(management.read()).toEqual({ ...incomplete, busy: incomplete.job !== null });
  }
});

test("a retirement failure keeps the replacement usable, reports the handoff error and recovers on restart", async () => {
  const { management, database, directory, settings } = await setup({ provider: "usda-fdc" });
  const archive = await foundationArchive();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(archive) });
  await finished(management);
  const old = management.read().installed!;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const oldReader = management.withActiveGeneration(async generation => { await held; return generation; });

  await management.submitArchive({ filename: "replacement.zip", stream: Readable.from(archive) });
  await vi.waitFor(() => {
    const state = management.read();
    expect(state.installed?.generation).not.toBe(old.generation);
    expect(state.retiring).toEqual(old);
    expect(state.job?.phase).toBe("activating");
  });
  const replacement = management.read().installed!;
  expect(management.outcomes()).toHaveLength(1);
  vi.mocked(fs.rm).mockRejectedValueOnce(new Error("private retirement failure"));
  release();

  await expect(oldReader).resolves.toBe(old.generation);
  await vi.waitFor(() => {
    expect(management.read()).toMatchObject({
      installed: replacement,
      retiring: old,
      busy: false,
      job: { phase: "failed", error: "USDA catalog handoff failed. The replacement remains active; check catalog storage and restart the server." },
    });
  });
  const failure = management.outcomes().find(outcome => outcome.jobId === replacement.generation)!;
  expect(failure).toMatchObject({ phase: "failed", installed: replacement, acknowledgedAt: null });
  expect(management.acknowledgeOutcome(failure.jobId, failure.completedAt)).toBe(true);
  await expect(management.submitArchive({ filename: "next.zip", stream: Readable.from(archive) })).rejects.toThrow("A USDA installation is already running.");

  const restarted = new CatalogManagement(database.getClient(), settings);
  cleanups.unshift(() => restarted.shutdown());
  await finished(restarted);
  expect(restarted.read()).toMatchObject({ installed: replacement, job: { phase: "succeeded", error: null } });
  expect(restarted.read().retiring).toBeUndefined();
  expect(restarted.outcomes()).toHaveLength(2);
  expect(restarted.outcomes().find(outcome => outcome.jobId === failure.jobId)).toMatchObject({ phase: "succeeded", operation: "update", installed: replacement, acknowledgedAt: null });
  expect(restarted.acknowledgeOutcome(failure.jobId, failure.completedAt)).toBe(false);
  await expect(fs.access(path.join(directory, `${old.generation}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
});

test.each(["missing job", "nonfailed job", "mismatched generation", "missing installed generation"] as const)("restart does not recover a handoff with %s", async invalid => {
  const { management, database, settings } = await setup({ provider: "usda-fdc" });
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(await foundationArchive()) });
  await finished(management);
  const installed = management.read().installed!;
  const succeeded = management.read().job!;
  const failed = { ...succeeded, phase: "failed" as const, error: "USDA catalog handoff failed." };
  const retiring = { ...installed, generation: "00000000-0000-4000-8000-000000000005" };
  const candidate = invalid === "missing job"
    ? { installed, job: null, retiring }
    : invalid === "nonfailed job"
      ? { installed, job: succeeded, retiring }
      : invalid === "mismatched generation"
        ? { installed, job: { ...failed, id: "00000000-0000-4000-8000-000000000006" }, retiring }
        : { installed: null, job: failed, retiring };
  saveCatalogState(database.getClient(), candidate, "usda-fdc");

  const restarted = new CatalogManagement(database.getClient(), settings);
  cleanups.unshift(() => restarted.shutdown());
  expect(restarted.read()).toEqual({ ...candidate, busy: false });
});

test("a USDA replacement activation failure leaves the working generation active and permits retry", async () => {
  const { management, directory } = await setup({ provider: "usda-fdc" });
  const archive = await foundationArchive();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(archive) });
  await finished(management);
  const working = management.read().installed!;

  vi.mocked(fs.chmod).mockRejectedValueOnce(new Error("private activation fault"));
  await management.submitArchive({ filename: "replacement.zip", stream: Readable.from(archive) });
  await finished(management);
  expect(management.read()).toMatchObject({
    installed: working,
    job: { phase: "failed", error: "USDA activation failed. Check server storage and retry the upload." },
  });
  await expect(fs.access(path.join(directory, `${working.generation}.sqlite`))).resolves.toBeUndefined();

  await management.submitArchive({ filename: "replacement.zip", stream: Readable.from(archive) });
  await finished(management);
  expect(management.read()).toMatchObject({ installed: { filename: "replacement.zip" }, job: { phase: "succeeded", error: null } });
  expect(management.read().installed?.generation).not.toBe(working.generation);
});

test.each([
  ["newer", { releasePeriod: "2025-12", identifier: "FoodData Central 14.0", releasedOn: "2025-12-18", archiveFilename: "FoodData_Central_foundation_food_csv_2025-12-18.zip", archiveByteLength: 1200 }, officialRelease],
  ["unchanged", { releasePeriod: officialRelease.releasePeriod, identifier: officialRelease.identifier, releasedOn: officialRelease.releasedOn, archiveFilename: officialRelease.archiveFilename, archiveByteLength: officialRelease.archiveByteLength }, officialRelease],
] as const)("USDA update checks report %s releases from explicit source metadata", async (status, installedRelease, availableRelease) => {
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(availableRelease) };
  const now = vi.fn(() => new Date("2026-09-09T14:30:00.000Z"));
  const { management, database } = await setup({ provider: "usda-fdc", sourceTransport: transport, now });
  saveCatalogState(database.getClient(), {
    installed: {
      generation: "installed-generation", filename: "foundation.zip", sha256: "installed-sha", foodCount: 469,
      installedAt: "2026-01-02T03:04:05.000Z", publicationDateRange: { earliest: "2019-04-01", latest: "2025-12-18" }, sourceRelease: installedRelease,
    },
    job: null,
  });

  await management.checkForUpdate();

  expect(management.read().updateCheck).toEqual({
    status, checkedAt: "2026-09-09T14:30:00.000Z", availableRelease, error: null,
  });
});

test("USDA update checks cache results and explicit checks bypass the cache", async () => {
  let current = new Date("2026-09-09T14:30:00.000Z");
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(officialRelease) };
  const { management } = await setup({ provider: "usda-fdc", sourceTransport: transport, now: () => current, updateCheckCacheMs: 60_000 });

  await management.checkForUpdate();
  current = new Date("2026-09-09T14:30:30.000Z");
  await management.checkForUpdate();
  expect(transport.latestFoundationRelease).toHaveBeenCalledOnce();

  await management.checkForUpdate({ force: true });
  expect(transport.latestFoundationRelease).toHaveBeenCalledTimes(2);
  expect(management.read().updateCheck?.checkedAt).toBe("2026-09-09T14:30:30.000Z");
});

test("the default USDA update cache lasts six hours", async () => {
  let current = new Date("2026-09-09T00:00:00.000Z");
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(officialRelease) };
  const { management } = await setup({ provider: "usda-fdc", sourceTransport: transport, now: () => current });
  await management.checkForUpdate();
  current = new Date("2026-09-09T05:59:59.999Z"); await management.checkForUpdate();
  expect(transport.latestFoundationRelease).toHaveBeenCalledOnce();
  current = new Date("2026-09-09T06:00:00.000Z"); await management.checkForUpdate();
  expect(transport.latestFoundationRelease).toHaveBeenCalledTimes(2);
});

test("concurrent USDA checks share one metadata request", async () => {
  let release!: (value: FoundationReleaseMetadata) => void;
  const transport = { latestFoundationRelease: vi.fn(() => new Promise<FoundationReleaseMetadata>(resolve => { release = resolve; })) };
  const { management } = await setup({ provider: "usda-fdc", sourceTransport: transport });
  const first = management.checkForUpdate({ force: true });
  const second = management.checkForUpdate({ force: true });
  expect(transport.latestFoundationRelease).toHaveBeenCalledOnce();
  release(officialRelease);
  await Promise.all([first, second]);
  expect(management.read().updateCheck?.availableRelease).toEqual(officialRelease);
  transport.latestFoundationRelease.mockResolvedValueOnce(officialRelease);
  await management.checkForUpdate({ force: true });
  expect(transport.latestFoundationRelease).toHaveBeenCalledTimes(2);
});

test("Open Food Facts ignores the USDA-only update transport", async () => {
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(officialRelease) };
  const { management, database } = await setup({ provider: "open-food-facts", sourceTransport: transport });
  saveCatalogUpdateCheck(database.getClient(), { status: "newer", checkedAt: "2026-09-09T14:30:00.000Z", availableRelease: officialRelease, error: null }, "open-food-facts");
  await management.checkForUpdate({ force: true });
  expect(transport.latestFoundationRelease).not.toHaveBeenCalled();
  expect(management.read().updateCheck).toMatchObject({ status: "indeterminate", availableSnapshot: null });
});

test.each([
  [{ identifier: null, releasedOn: null }, { ...officialRelease, identifier: null, releasedOn: null }],
  [{ identifier: "  FoodData Central 15.0  " }, officialRelease],
] as const)("valid USDA metadata normalizes optional enrichment %#", async (patch, expected) => {
  const available = { ...officialRelease, ...patch };
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(available) };
  const { management, database } = await setup({ provider: "usda-fdc", sourceTransport: transport });
  saveCatalogState(database.getClient(), {
    installed: { generation: "generation", filename: "foundation.zip", sha256: "sha", foodCount: 1, installedAt: "2026-01-01T00:00:00Z", publicationDateRange: { earliest: "2020-01-01", latest: "2025-12-18" }, sourceRelease: { ...officialRelease, releasePeriod: "2025-12" } },
    job: null,
  });
  await management.checkForUpdate();
  expect(management.read().updateCheck).toMatchObject({ status: "newer", availableRelease: expected });
});

test.each([
  { identifier: "" },
  { identifier: "   " },
  { releasedOn: "April 30, 2026" },
  { releasedOn: "2026-04-99" },
  { releasedOn: "2026-05-01" },
  { releasePeriod: "2026-13" },
  { archiveFilename: "../foundation.zip" },
  { archiveByteLength: 0 },
  { archiveByteLength: -1 },
  { archiveByteLength: 1.5 },
  { archiveByteLength: Number.NaN },
  { archiveUrl: "http://fdc.nal.usda.gov/foundation.zip" },
  { archiveUrl: "https://example.com/foundation.zip" },
  { archiveUrl: "not a URL" },
] as const)("successful but invalid official metadata is indeterminate %#", async patch => {
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue({ ...officialRelease, ...patch }) };
  const { management } = await setup({ provider: "usda-fdc", sourceTransport: transport });
  await management.checkForUpdate();
  expect(management.read().updateCheck).toMatchObject({ status: "indeterminate", availableRelease: null, error: null });
});

test.each([
  [null, "FoodData Central 15.0"],
  ["FoodData Central 15.0", null],
] as const)("same-period descriptors compare unchanged when only one side lacks update-log enrichment", async (installedIdentifier, availableIdentifier) => {
  const available = { ...officialRelease, identifier: availableIdentifier };
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(available) };
  const { management, database } = await setup({ provider: "usda-fdc", sourceTransport: transport });
  saveCatalogState(database.getClient(), {
    installed: { generation: "generation", filename: "foundation.zip", sha256: "sha", foodCount: 1, installedAt: "2026-01-01T00:00:00Z", publicationDateRange: { earliest: "2020-01-01", latest: "2026-04-30" }, sourceRelease: { releasePeriod: officialRelease.releasePeriod, identifier: installedIdentifier, releasedOn: officialRelease.releasedOn, archiveFilename: officialRelease.archiveFilename, archiveByteLength: officialRelease.archiveByteLength } },
    job: null,
  });
  await management.checkForUpdate();
  expect(management.read().updateCheck?.status).toBe("unchanged");
});

test("same-period conflicting USDA versions are indeterminate", async () => {
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(officialRelease) };
  const { management, database } = await setup({ provider: "usda-fdc", sourceTransport: transport });
  saveCatalogState(database.getClient(), {
    installed: { generation: "generation", filename: "foundation.zip", sha256: "sha", foodCount: 1, installedAt: "2026-01-01T00:00:00Z", publicationDateRange: { earliest: "2020-01-01", latest: "2026-04-30" }, sourceRelease: { releasePeriod: officialRelease.releasePeriod, identifier: "FoodData Central 14.9", releasedOn: officialRelease.releasedOn, archiveFilename: officialRelease.archiveFilename, archiveByteLength: officialRelease.archiveByteLength } },
    job: null,
  });
  await management.checkForUpdate();
  expect(management.read().updateCheck?.status).toBe("indeterminate");
});

test("same-period conflicting exact USDA release dates are indeterminate", async () => {
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(officialRelease) };
  const { management, database } = await setup({ provider: "usda-fdc", sourceTransport: transport });
  saveCatalogState(database.getClient(), {
    installed: { generation: "generation", filename: "foundation.zip", sha256: "sha", foodCount: 1, installedAt: "2026-01-01T00:00:00Z", publicationDateRange: { earliest: "2020-01-01", latest: "2026-04-29" }, sourceRelease: { releasePeriod: officialRelease.releasePeriod, identifier: officialRelease.identifier, releasedOn: "2026-04-29", archiveFilename: officialRelease.archiveFilename, archiveByteLength: officialRelease.archiveByteLength } },
    job: null,
  });
  await management.checkForUpdate();
  expect(management.read().updateCheck?.status).toBe("indeterminate");
});

test.each([
  ["not installed", null, officialRelease, "indeterminate", null],
  ["unknown official metadata", { releasePeriod: "2025-12", identifier: "FoodData Central 14.0", releasedOn: "2025-12-18", archiveFilename: "foundation.zip", archiveByteLength: 1200 }, null, "indeterminate", null],
  ["incomparable identifiers", { releasePeriod: "invalid", identifier: "unversioned", releasedOn: null, archiveFilename: "foundation.zip", archiveByteLength: 1200 }, officialRelease, "indeterminate", null],
  ["an apparently older official release", { releasePeriod: "2026-12", identifier: "FoodData Central 16.0", releasedOn: "2026-12-01", archiveFilename: "foundation.zip", archiveByteLength: 1200 }, officialRelease, "indeterminate", null],
  ["a same-release artifact revision", { releasePeriod: officialRelease.releasePeriod, identifier: officialRelease.identifier, releasedOn: officialRelease.releasedOn, archiveFilename: officialRelease.archiveFilename, archiveByteLength: officialRelease.archiveByteLength - 1 }, officialRelease, "indeterminate", null],
  ["a same-release filename revision", { releasePeriod: officialRelease.releasePeriod, identifier: officialRelease.identifier, releasedOn: officialRelease.releasedOn, archiveFilename: "foundation-renamed.zip", archiveByteLength: officialRelease.archiveByteLength }, officialRelease, "indeterminate", null],
] as const)("USDA update checks keep %s honest", async (_case, sourceRelease, available, status, error) => {
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(available) };
  const { management, database } = await setup({ provider: "usda-fdc", sourceTransport: transport, now: () => new Date("2026-09-09T14:30:00.000Z") });
  if (sourceRelease) saveCatalogState(database.getClient(), {
    installed: {
      generation: "installed-generation", filename: "foundation.zip", sha256: "installed-sha", foodCount: 469,
      installedAt: "2026-01-02T03:04:05.000Z", publicationDateRange: { earliest: "2019-04-01", latest: "2025-12-18" }, sourceRelease,
    },
    job: null,
  });

  await management.checkForUpdate();

  expect(management.read().updateCheck).toMatchObject({ status, availableRelease: available, error });
});

test("failed USDA metadata checks preserve the installed catalog and manual upload state", async () => {
  const transport = { latestFoundationRelease: vi.fn().mockRejectedValue(new Error("private network failure")) };
  const { management } = await setup({ provider: "usda-fdc", sourceTransport: transport, now: () => new Date("2026-09-09T14:30:00.000Z") });
  const archive = await foundationArchive();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(archive) });
  await finished(management);
  const before = management.read();

  await management.checkForUpdate();

  expect(management.read()).toMatchObject({
    installed: before.installed,
    job: before.job,
    busy: false,
    updateCheck: { status: "unavailable", checkedAt: "2026-09-09T14:30:00.000Z", availableRelease: null, error: "Official USDA release metadata could not be checked." },
  });
});

test("a successful USDA metadata check cannot activate or mutate the installed catalog", async () => {
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(officialRelease) };
  const { management, database, directory } = await setup({ provider: "usda-fdc", sourceTransport: transport, now: () => new Date("2026-09-09T14:30:00.000Z") });
  const archive = await foundationArchive();
  await management.submitArchive({ filename: "foundation.zip", stream: Readable.from(archive) });
  await finished(management);
  const completed = management.read();
  saveCatalogState(database.getClient(), {
    installed: { ...completed.installed!, sourceRelease: { releasePeriod: "2025-12", identifier: "FoodData Central 14.0", releasedOn: "2025-12-18", archiveFilename: "foundation-old.zip", archiveByteLength: 1200 } },
    job: completed.job,
  });
  const before = management.read();
  const filesBefore = await fs.readdir(directory);

  await management.checkForUpdate();

  expect(management.read()).toMatchObject({ installed: before.installed, job: before.job, busy: false, updateCheck: { status: "newer", availableRelease: officialRelease } });
  expect(await fs.readdir(directory)).toEqual(filesBefore);
});

test("a validated upload records the corroborated official release only when filename and exact byte length match", async () => {
  const archive = await foundationArchive();
  const release = { ...officialRelease, archiveByteLength: archive.length };
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(release) };
  const { management } = await setup({ provider: "usda-fdc", sourceTransport: transport, now: () => new Date("2026-09-09T14:30:00.000Z") });
  await management.checkForUpdate();

  await management.submitArchive({ filename: release.archiveFilename, size: archive.length, stream: Readable.from(archive) });
  await finished(management);

  expect(management.read().installed?.sourceRelease).toEqual({ releasePeriod: release.releasePeriod, identifier: release.identifier, releasedOn: release.releasedOn, archiveFilename: release.archiveFilename, archiveByteLength: release.archiveByteLength });
  expect(management.read().updateCheck?.status).toBe("unchanged");
});

test.each([
  ["renamed.zip", 0],
  [officialRelease.archiveFilename, 1],
] as const)("valid manual uploads with unmatched official correlation remain installable (%s)", async (filename, lengthDelta) => {
  const archive = await foundationArchive();
  const release = { ...officialRelease, archiveByteLength: archive.length + lengthDelta };
  const transport = { latestFoundationRelease: vi.fn().mockResolvedValue(release) };
  const { management } = await setup({ provider: "usda-fdc", sourceTransport: transport });
  await management.checkForUpdate();
  await management.submitArchive({ filename, size: archive.length, stream: Readable.from(archive) });
  await finished(management);
  expect(management.read()).toMatchObject({ installed: { filename }, job: { phase: "succeeded" }, updateCheck: { status: "indeterminate" } });
  expect(management.read().installed?.sourceRelease).toBeUndefined();
});


test("terminal outcomes survive replacement and acknowledgement across management instances", async () => {
  const { management, database, settings } = await setup();
  await management.submitArchive({ filename: "products.gz", stream: Readable.from(offArchive()) });
  expect(management.outcomes()).toEqual([]);
  await finished(management);
  const outcome = management.outcomes()[0];
  expect(outcome).toMatchObject({ provider: "open-food-facts", jobId: management.read().job!.id, phase: "succeeded", filename: "products.gz", installed: { filename: "products.gz", foodCount: 1 }, acknowledgedAt: null });
  management.acknowledgeOutcome(outcome.jobId, outcome.completedAt);
  management.acknowledgeOutcome(outcome.jobId, outcome.completedAt);
  const acknowledged = management.outcomes();
  expect(acknowledged).toHaveLength(1);
  expect(acknowledged[0].acknowledgedAt).not.toBeNull();
  await management.submitArchive({ filename: "broken.gz", stream: Readable.from("invalid gzip") });
  await finished(management);
  const restarted = new CatalogManagement(database.getClient(), settings);
  cleanups.unshift(() => restarted.shutdown());
  expect(restarted.outcomes()).toHaveLength(2);
  expect(restarted.outcomes()).toContainEqual(acknowledged[0]);
  expect(restarted.outcomes().find(item => item.phase === "failed")).toMatchObject({ filename: "broken.gz", installed: outcome.installed, acknowledgedAt: null });
  expect(restarted.outcomes()).toEqual(restarted.outcomes());
});


test("legacy terminal state remains readable without claiming first installation", async () => {
  const { management, database, settings } = await setup();
  await management.submitArchive({ filename: "products.gz", stream: Readable.from(offArchive()) });
  await finished(management);
  const state = management.read();
  const legacyJob = { ...state.job!, id: "legacy-job" };
  delete legacyJob.operation;
  saveCatalogState(database.getClient(), { installed: { ...state.installed!, generation: legacyJob.id }, job: legacyJob }, "open-food-facts");
  const restarted = new CatalogManagement(database.getClient(), settings);
  cleanups.unshift(() => restarted.shutdown());
  const legacy = restarted.outcomes().find(outcome => outcome.jobId === legacyJob.id)!;
  expect(legacy.phase).toBe("succeeded");
  expect(legacy.operation).toBeUndefined();
});
