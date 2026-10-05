import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importFoundation } from "../../app/catalog-management/foundation-import.server";
import type { ImportMessage, ImportOptions } from "../../app/catalog-management/import-contract";
import { readUsdaGenerationFood, searchUsdaGeneration } from "../../app/database/usda-generation.server";

export async function runArchive(archive: Buffer, cleanup: (action: () => Promise<void>) => void, limits: Partial<ImportOptions> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-module-"));
  cleanup(() => rm(directory, { recursive: true, force: true }));
  const options = { directory, archivePath: path.join(directory, "archive"), generation: randomUUID(), maxExpandedBytes: 10 * 1024 * 1024, ...limits };
  await writeFile(options.archivePath, archive);
  const messages: ImportMessage[] = [];
  await importFoundation(options, message => messages.push(structuredClone(message)));
  return {
    options, messages, final: messages.at(-1)!,
    read: (id: string) => readUsdaGenerationFood(options.directory, options.generation, id),
    search: (expression: string) => searchUsdaGeneration(options.directory, options.generation, expression, () => 0),
  };
}
