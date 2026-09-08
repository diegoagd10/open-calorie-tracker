import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { openApplicationDatabase } from "../app/database/database.server";

const disk = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>(), statfs: disk }));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

test.each([
  [undefined, 599, "Not enough disk space for USDA import. Free space and retry."],
  [undefined, 600, "Invalid or corrupt Foundation CSV ZIP, or insufficient disk space. Verify the download and retry."],
  [500, 349, "Not enough disk space for USDA import. Free space and retry."],
  [500, 350, "Invalid or corrupt Foundation CSV ZIP, or insufficient disk space. Verify the download and retry."],
])("disk preflight reserves expanded data plus upload bytes (size %s, blocks %i)", async (size, blocks, error) => {
  disk.mockResolvedValue({ bavail: blocks, bsize: 2 });
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-storage-"));
  const database = openApplicationDatabase({ databasePath: path.join(directory, "app.sqlite"), migrationsFolder: path.resolve("drizzle") });
  const management = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts"), maxUploadBytes: 1000, maxExpandedBytes: 100 });
  cleanups.push(async () => { await management.shutdown(); database.close(); await rm(directory, { recursive: true, force: true }); });
  await management.submitArchive({ filename: "archive.zip", size, stream: Readable.from(Buffer.alloc(500)) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: null, job: { phase: "failed", error } });
});
