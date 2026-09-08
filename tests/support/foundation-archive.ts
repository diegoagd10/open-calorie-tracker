import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { crc32 } from "node:zlib";

// Small stored ZIP writer for public archive-submission tests, independent of the importer.
export async function foundationArchive(overrides: Record<string, string | null> = {}) {
  const folder = path.resolve("tests/fixtures/usda-foundation");
  const files: Record<string, string> = {};
  for (const name of await readdir(folder)) {
    if (name.endsWith(".csv")) files[name] = await readFile(path.join(folder, name), "utf8");
  }
  for (const [name, contents] of Object.entries(overrides)) {
    if (contents === null) delete files[name];
    else files[name] = contents;
  }
  return storedZip(Object.entries(files).map(([name, body]) => ({ name: `Foundation_fixture/${name}`, body })));
}

export function storedZip(files: { name: string; body: string; mode?: number; encrypted?: boolean }[]) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const filename = Buffer.from(file.name);
    const plain = Buffer.from(file.body);
    const body = file.encrypted ? Buffer.concat([Buffer.alloc(12), plain]) : plain;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800 | (file.encrypted ? 1 : 0), 6);
    header.writeUInt32LE(crc32(plain), 14); header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(plain.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    header.copy(directory, 8, 6, 28); directory.writeUInt32LE(offset, 42);
    directory.writeUInt32LE(((file.mode ?? 0) << 16) >>> 0, 38);
    local.push(header, filename, body); central.push(directory, filename);
    offset += header.length + filename.length + body.length;
  }
  const entries = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(entries.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, entries, end]);
}
