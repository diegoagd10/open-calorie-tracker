import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { saveCatalogState } from "../app/database/catalog-state.server";

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

test.each([
  [249, "Not enough disk space for USDA import. Free space and retry."],
  [250, "Invalid or corrupt Foundation CSV ZIP, or insufficient disk space. Verify the download and retry."],
] as const)("disk preflight reserves new staged data while available space already reflects the current generation at %i bytes", async (available, error) => {
  disk.mockResolvedValue({ bavail: available, bsize: 1 });
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-current-storage-"));
  const database = openApplicationDatabase({ databasePath: path.join(directory, "app.sqlite"), migrationsFolder: path.resolve("drizzle") });
  const generation = "00000000-0000-4000-8000-000000000020";
  await writeFile(path.join(directory, `${generation}.sqlite`), Buffer.alloc(250));
  saveCatalogState(database.getClient(), {
    installed: { generation, filename: "installed.zip", sha256: "sha", databaseBytes: 250, foodCount: 1, installedAt: "2026-01-01T00:00:00.000Z", publicationDateRange: { earliest: "2026-01-01", latest: "2026-01-01" } },
    job: null,
  });
  const management = new CatalogManagement(database.getClient(), { directory, workerPath: path.resolve("app/catalog-management/import-worker.ts"), maxUploadBytes: 1000, maxExpandedBytes: 100 });
  cleanups.push(async () => { await management.shutdown(); database.close(); await rm(directory, { recursive: true, force: true }); });

  await management.submitArchive({ filename: "archive.zip", size: 50, stream: Readable.from(Buffer.alloc(50)) });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));

  expect(management.read().job?.error).toBe(error);
});
