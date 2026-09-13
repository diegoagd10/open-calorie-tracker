import { createReadStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import type { ImportOptions, ImportMessage } from "./import-contract.ts";
import { z } from "zod";
import { parse } from "csv-parse";
import { buildOffGeneration } from "../database/off-generation.server.ts";
import type { CatalogFood } from "../catalog/food-catalog.server.ts";
import { offNutrition, requiredOffField } from "./off-nutrition.server.ts";
import { offJsonRow, offNativeNutrition, offObject, offJsonLines } from "./off-jsonl.server.ts";
import { offSearchAliases } from "../catalog/off-search.server.ts";

function jsonlPrefix(prefix: Buffer): boolean {
  const firstLine = prefix.toString("utf8").split("\n", 1)[0].trimStart();
  if (firstLine.startsWith("{") || firstLine.startsWith("[")) return true;
  try { JSON.parse(firstLine); return true; } catch { return false; }
}

export async function importOff(options: ImportOptions, publish: (message: ImportMessage) => void): Promise<void> {
  const exclusions: Record<string, number> = {};
  let processedRecords = 0;
  let importedRecords = 0;
  let usableNutritionRecords = 0;
  let rejectedRecords = 0;
  let earliest: string | null = null;
  let latest: string | null = null;
  function exclude(reason: string) { exclusions[reason] = (exclusions[reason] ?? 0) + 1; }
  function reject(reason: string) { exclude(reason); rejectedRecords++; }
  function progress(phase: "validating" | "importing" | "indexing") { publish({ progress: { phase, processedRecords, importedRecords, usableNutritionRecords, rejectedRecords, exclusions } }); }
  function date(value: string | undefined) {
    if (!value || !/^\d{1,11}$/.test(value)) return null;
    const timestamp = Number(value) * 1000;
    return timestamp <= Date.now() ? new Date(timestamp).toISOString() : null;
  }
  function text(value: string | undefined) { return value?.trim() || null; }
  function sourceDates(row: Record<string, string>) {
    const modified = date(row.last_modified_t);
    if (modified) {
      earliest = earliest === null ? modified : [earliest, modified].sort()[0];
      latest = latest === null ? modified : [latest, modified].sort()[1];
    }
    return { providerPublishedDate: date(row.created_t), providerModifiedDate: modified };
  }
  function product(row: Record<string, string>, native?: unknown): CatalogFood | null {
    const id = row.code.trim();
    const nutrition = native === undefined ? offNutrition(row, exclude) : offNativeNutrition(row, native, exclude);
    const reason = /^(?:\d{7,8}|\d{12,14})$/.test(id) ? nutrition.calculationUnavailableReason : "unsupported_barcode";
    if (reason) exclude(reason);
    const name = text(row.product_name) ?? text(row.product_name_en) ?? text(row.product_name_es) ?? "Unnamed product";
    return {
      provider: "open-food-facts", providerFoodId: id, barcode: id, catalogGeneration: options.generation,
      dataType: "Open Food Facts", name, originalName: name,
      brand: text(row.brands), marketCountry: text(row.countries),
      ...sourceDates(row),
      ...nutrition, isSelectable: !reason, calculationUnavailableReason: reason,
      offSourceFields: row,
    };
  }
  function validateHeader(header: string[]) {
    const required = ["code", "product_name", "energy-kcal_100g", "proteins_100g", "fat_100g", "carbohydrates_100g"];
    const valid = [header.length <= 1000, new Set(header).size === header.length, required.every(key => header.includes(key))].every(Boolean);
    if (!valid) throw new Error("OFF_SCHEMA");
    return header.map((key, index) => ({ key, index })).filter(({ key }) => requiredOffField(key));
  }
  const selectedFieldsSchema = z.record(z.string(), z.string().max(2000)).and(z.object({ code: z.string().min(1).max(128).refine(value => value.trim().length > 0), product_name: z.string().max(500), brands: z.string().max(500).optional() }));
  function validatedProduct(row: Record<string, string>, native?: unknown) {
    const parsed = selectedFieldsSchema.safeParse(row);
    if (!parsed.success) { reject(parsed.error.issues.some(issue => issue.path[0] === "code") ? "invalid_identity" : "oversized_product_field"); return null; }
    return product(row, native);
  }
  function readProduct(fields: string[], width: number, selected: { key: string; index: number }[]) {
    processedRecords++;
    if (processedRecords % 5000 === 0) progress("importing");
    if (fields.length !== width) { reject("row_width_mismatch"); return null; }
    const row = Object.fromEntries(selected.map(({ key, index }) => [key, fields[index]]));
    return validatedProduct(row);
  }
  async function* foods(rows: AsyncIterable<string[]>) {
    const iterator = rows[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new Error("OFF_SCHEMA");
    const header = first.value;
    const selected = validateHeader(header);
    progress("importing");
    for await (const fields of { [Symbol.asyncIterator]: () => iterator }) {
      const food = readProduct(fields, header.length, selected);
      if (food) yield food;
    }
  }

  async function readPrefix(iterator: AsyncIterator<Buffer>) {
    let prefix = Buffer.alloc(0);
    while (!prefix.includes(10)) {
      const next = await iterator.next();
      if (next.done) { if (!prefix.length) throw new Error("OFF_SCHEMA"); break; }
      prefix = Buffer.concat([prefix, next.value]);
      if (jsonlPrefix(prefix)) break;
      if (prefix.length > 256 * 1024) throw new Error("OFF_SCHEMA");
    }
    return prefix;
  }
  function jsonProduct(text: string): CatalogFood | null {
    processedRecords++;
    if (processedRecords % 5000 === 0) progress("importing");
    let value: unknown;
    try { value = JSON.parse(text); } catch { reject("malformed_json"); return null; }
    const { row, rejection } = offJsonRow(value);
    if (rejection) { reject(rejection); return null; }
    row.product_name ??= "";
    const nutrition = offObject(offObject(value)?.nutrition);
    const native = nutrition && Object.hasOwn(nutrition, "input_sets") ? nutrition.input_sets ?? null : undefined;
    return validatedProduct(row, native);
  }
  async function* jsonFoods(chunks: AsyncIterable<Buffer>) {
    progress("importing");
    for await (const text of offJsonLines(chunks, options.maxDocumentBytes ?? 8 * 1024 * 1024)) {
      const food = jsonProduct(text); if (food) yield food;
    }
  }
  async function importRows(chunks: AsyncIterable<Buffer>): Promise<number> {
    const iterator = chunks[Symbol.asyncIterator]();
    const prefix = await readPrefix(iterator);
    // The official daily export_database.pl emits literal tabs/newlines and does
    // not CSV-escape quotes. The configurable Export.pm CSV uses quoted fields.
    const daily = prefix.subarray(0, prefix.indexOf(10)).toString("utf8").replace(/^\uFEFF/, "").startsWith("code\turl\tcreator\tcreated_t\tcreated_datetime\tlast_modified_t\tlast_modified_datetime\tlast_modified_by\tlast_updated_t\tlast_updated_datetime\t");
    async function* replay() {
      yield prefix;
      for (;;) { const next = await iterator.next(); if (next.done) return; yield next.value; }
    }
    const jsonl = jsonlPrefix(prefix);
    archiveFormat = jsonl ? "jsonl" : "csv";
    const build = (foods: AsyncIterable<CatalogFood>) => buildOffGeneration({ aliasesFor: offSearchAliases, directory: options.directory, foods, generation: options.generation, maxBytes: options.maxDatabaseBytes ?? options.maxExpandedBytes, onDuplicate: () => reject("duplicate_identity"), onIndexing: () => progress("indexing"), onStored: food => { importedRecords++; if (food.isSelectable) usableNutritionRecords++; } });
    if (jsonl) return build(jsonFoods(replay()));
    let count = 0;
    await pipeline(replay(), parse({ delimiter: "\t", bom: true, quote: daily ? false : '"', relax_column_count: true, skip_empty_lines: true, max_record_size: 2 * 1024 * 1024 }), async rows => {
      try {
        count = await build(foods(rows as AsyncIterable<string[]>));
      } catch (error) { importFailure = error; throw error; }
    });
    return count;
  }

  let importFailure: unknown;
  let archiveFormat: "csv" | "jsonl" = "csv";
  let expanded = 0;
  try {
    progress("validating");

    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      expanded += chunk.length;
      callback(expanded > options.maxExpandedBytes ? new Error("OFF_LIMIT") : null, chunk);
    } });
    let foodCount = 0;
    await pipeline(createReadStream(options.archivePath), createGunzip(), meter, async chunks => {
      foodCount = await importRows(chunks as AsyncIterable<Buffer>);
    });
    publish({ progress: { processedRecords, importedRecords, usableNutritionRecords, rejectedRecords, exclusions } });
    publish({ result: { archiveFormat, expandedBytes: expanded, foodCount, publicationDateRange: { earliest: "", latest: "" }, sourceDateRange: { earliest, latest } } });
  } catch (pipelineError) {
    const error = importFailure ?? pipelineError;
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : "";
    const messages: Record<string, string> = {
      OFF_SCHEMA: "Incompatible OFF schema. Upload the official product JSONL GZIP or supported tab-separated CSV GZIP.",
      OFF_DOCUMENT_LIMIT: "OFF product document exceeds the configured individual-document limit. Nothing was installed.",
      OFF_LIMIT: "OFF expanded data exceeds the configured resource limit.",
      OFF_EMPTY: "OFF archive contains no product records. Nothing was installed.",
      OFF_DATABASE_INVALID: "OFF database validation failed. Nothing was installed.",
    };
    const storage = code === "SQLITE_FULL" || code === "ENOSPC";
    publish({ progress: { processedRecords, importedRecords, usableNutritionRecords, rejectedRecords, exclusions }, error: storage ? "Insufficient storage for OFF import. Free space or increase the resource limit and retry." : messages[message] ?? "Corrupt OFF GZIP or malformed TSV/JSONL. Download the archive again." });
  }

}
