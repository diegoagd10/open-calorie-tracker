import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogManagement, type CatalogManagementOptions } from "../app/catalog-management/catalog-management.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { saveCatalogState } from "../app/database/catalog-state.server";
import { offArchive, offWithBasis } from "./support/off-archive";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, statfs: vi.fn(actual.statfs), chmod: vi.fn(actual.chmod) };
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
  expect(state.job).toMatchObject({ phase: "succeeded", filename, receivedBytes: archive.length, processedRecords: 1, error: null });
  expect((await fs.stat(path.join(directory, `${state.installed!.generation}.sqlite`))).mode & 0o777).toBe(0o444);
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
  expect(management.read()).toMatchObject({ busy: false, installed: null, job: { phase: "failed" } });
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
  expect(management.read().job?.error).toBe("Corrupt OFF GZIP or malformed TSV. Download the archive again.");
});

test.each(["usda-fdc", "open-food-facts"] as const)("%s defaults reserve independent archive sizes", async provider => {
  const { management } = await setup({ provider }, true);
  const real = await fs.statfs(tmpdir());
  const reserve = provider === "usda-fdc" ? 576 * 1024 ** 2 : 68 * 1024 ** 3;
  vi.mocked(fs.statfs).mockResolvedValue({ ...real, bavail: reserve - 1, bsize: 1 });
  await management.submitArchive({ filename: provider === "usda-fdc" ? "source.zip" : "source.gz", stream: Readable.from("test") });
  expect(management.read().job?.error).toBe(`Not enough disk space for ${provider === "usda-fdc" ? "USDA" : "Open Food Facts"} import. Free space and retry.`);
  vi.mocked(fs.statfs).mockResolvedValue({ ...real, bavail: reserve, bsize: 1 });
  await management.submitArchive({ filename: provider === "usda-fdc" ? "source.zip" : "source.gz", stream: Readable.from("test") });
  await finished(management);
  expect(management.read().job?.error).toBe(provider === "usda-fdc" ? "Invalid or corrupt Foundation CSV ZIP, or insufficient disk space. Verify the download and retry." : "Corrupt OFF GZIP or malformed TSV. Download the archive again.");
});

test("restart marks only an unfinished provider job interrupted and removes its staging", async () => {
  const { database, settings, directory } = await setup();
  const id = "interrupted-job";
  const job = { id, filename: "off.gz", phase: "importing" as const, receivedBytes: 100, processedRecords: 7, exclusions: {}, error: null, startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  saveCatalogState(database.getClient(), { installed: null, job }, "open-food-facts");
  await fs.writeFile(path.join(directory, `${id}.gz`), "partial");
  await fs.writeFile(path.join(directory, `${id}.sqlite`), "partial database");
  await fs.writeFile(path.join(directory, `${id}.sqlite-journal`), "partial journal");
  await fs.mkdir(path.join(directory, `${id}.staging`));
  const recovered = new CatalogManagement(database.getClient(), settings);
  expect(recovered.read()).toMatchObject({ installed: null, busy: false, job: { phase: "interrupted", processedRecords: 7, error: "Open Food Facts installation was interrupted by a server restart. Upload the archive again." } });
  await vi.waitFor(async () => expect((await fs.readdir(directory)).filter(name => name.startsWith(id))).toEqual([]));
  const unchanged = new CatalogManagement(database.getClient(), settings);
  expect(unchanged.read()).toEqual(recovered.read());
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

test("shutdown interrupts the live worker and removes its partial generation", async () => {
  const { management, directory } = await workerSetup(resultMessage);
  await management.submitArchive({ filename: "off.gz", stream: Readable.from("archive") });
  await vi.waitFor(() => expect(management.read().job?.processedRecords).toBe(7));
  expect(management.read().job?.exclusions).toEqual({ invalid_record: 2 });
  await management.shutdown();
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

test("installation claims distinguish busy and already installed providers", async () => {
  const { management } = await setup();
  const pending = new PassThrough();
  const upload = management.submitArchive({ filename: "off.gz", stream: pending });
  await expect(management.submitArchive({ filename: "off.gz", stream: Readable.from("other") })).rejects.toThrow("A Open Food Facts installation is already running.");
  pending.end(offArchive([offWithBasis("serving")])); await upload; await finished(management);
  await expect(management.submitArchive({ filename: "off.gz", stream: Readable.from("other") })).rejects.toThrow("Open Food Facts is already installed. Catalog replacement is not available yet.");
});
