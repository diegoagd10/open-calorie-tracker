import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, statfs } from "node:fs/promises";
import path from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";
import { parse } from "csv-parse";
import { openPromise, type Entry, type ZipFile } from "yauzl";

export class ArchiveError extends Error {}
const tables: Record<string, string[]> = {
  "food.csv": ["fdc_id", "data_type", "description", "food_category_id", "publication_date"],
  "foundation_food.csv": ["fdc_id", "NDB_number"],
  "food_nutrient.csv": ["id", "fdc_id", "nutrient_id", "amount"],
  "nutrient.csv": ["id", "name", "unit_name"],
  "food_portion.csv": ["id", "fdc_id", "amount", "measure_unit_id", "gram_weight", "modifier", "portion_description"],
  "measure_unit.csv": ["id", "name"],
};

function validateEntry(entry: Entry) {
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
  const unsafePath = /(^\/)|(^|\/)\.{1,2}(\/|$)|[\\:]/.test(entry.fileName);
  const controlCharacter = [...entry.fileName].some(character => character.charCodeAt(0) < 32);
  if ([unsafePath, controlCharacter, ![0, 0x8000, 0x4000].includes(mode), entry.isEncrypted()].some(Boolean)) throw new ArchiveError("ZIP contains unsafe paths, links or encrypted content.");
}
class ArchiveContents {
  readonly #names = new Set<string>();
  readonly #tables = new Set<string>();
  #root: string | undefined;
  #expanded = 0;
  inspect(entry: Entry, limit: number): string | null {
    validateEntry(entry);
    if (this.#names.has(entry.fileName)) throw new ArchiveError("ZIP contains duplicate file paths.");
    this.#names.add(entry.fileName);
    this.#expanded += entry.uncompressedSize;
    if (this.#expanded > limit) throw new ArchiveError("Expanded archive exceeds the configured import limit.");
    return this.#table(entry.fileName);
  }
  #table(filename: string): string | null {
    const name = path.posix.basename(filename);
    if (!Object.hasOwn(tables, name) || filename.endsWith("/")) return null;
    this.#requireUniqueTable(name, path.posix.dirname(filename));
    this.#tables.add(name);
    return name;
  }
  #requireUniqueTable(name: string, root: string) {
    if (this.#tables.has(name)) throw new ArchiveError("Duplicate Foundation table.");
    if (this.#root !== undefined && this.#root !== root) throw new ArchiveError("Foundation tables must occur in a single archive directory.");
    this.#root = root;
  }
  requireTables() {
    for (const table of Object.keys(tables)) if (!this.#tables.has(table)) throw new ArchiveError(`Missing Foundation table: ${table}. Choose the Foundation CSV ZIP with supporting data.`);
  }
}
async function verifyMember(zip: ZipFile, entry: Entry, staging: string, name: string | null) {
  const space = await statfs(staging);
  if (space.bavail * space.bsize < entry.uncompressedSize * 2) throw new ArchiveError("Not enough disk space to validate USDA archive.");
  let checksum = 0;
  const verify = new Transform({ transform(chunk: Buffer, _encoding, done) { checksum = crc32(chunk, checksum); done(null, chunk); } });
  const destination = name ? createWriteStream(path.join(staging, name), { flags: "wx", mode: 0o600 }) : new Writable({ write(_chunk, _encoding, done) { done(); } });
  await pipeline(await zip.openReadStreamPromise(entry), verify, destination);
  if (checksum !== entry.crc32) throw new ArchiveError("ZIP checksum failed. Download the archive again.");
}
// Archive names never become filesystem paths; only fixed table names are written.
export async function unpackFoundation(archivePath: string, staging: string, maxExpandedBytes: number) {
  await mkdir(staging, { mode: 0o700 });
  const zip = await openPromise(archivePath, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  const contents = new ArchiveContents();
  try {
    if (zip.entryCount > 200) throw new ArchiveError("ZIP contains too many files for a Foundation archive.");
    for await (const entry of zip.eachEntry()) {
      const name = contents.inspect(entry, maxExpandedBytes);
      if (!entry.fileName.endsWith("/")) await verifyMember(zip, entry, staging, name);
    }
    contents.requireTables();
  } finally { zip.close(); }
}

export async function* foundationRows(staging: string, table: string): AsyncGenerator<Record<string, string>> {
  let headerSeen = false;
  const parser = createReadStream(path.join(staging, table)).pipe(parse({
    bom: true, skip_empty_lines: true, max_record_size: 64 * 1024,
    columns: (header: string[]) => {
      headerSeen = true;
      if (new Set(header).size !== header.length || tables[table].some(column => !header.includes(column))) throw new ArchiveError(`Incompatible Foundation schema in ${table}.`);
      return header;
    },
  }));
  for await (const row of parser) yield row as Record<string, string>;
  if (!headerSeen) throw new ArchiveError(`Missing CSV header in ${table}.`);
}
