import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, expect, test, vi } from "vitest";
import { runArchive } from "./support/catalog-import";

vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, statfs: vi.fn(actual.statfs) };
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.resetAllMocks(); await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });
type Entry = { name: string; body: string; attributes?: number; flags?: number };
// Tiny independent stored-ZIP writer permits fixtures ordinary archive tools reject.
function zip(entries: Entry[]) {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const body = Buffer.from(entry.body);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE((entry.flags ?? 0) | 0x800, 6);
    header.writeUInt32LE(crc32(body), 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length - ((entry.flags ?? 0) & 1 ? 12 : 0), 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314, 4); directory.writeUInt16LE(20, 6);
    header.copy(directory, 8, 6, 28); directory.writeUInt32LE(entry.attributes ?? 0, 38); directory.writeUInt32LE(offset, 42);
    local.push(header, name, body); central.push(directory, name); offset += header.length + name.length + body.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
async function fixtureEntries() {
  const directory = path.resolve("tests/fixtures/usda-foundation");
  return Promise.all((await fs.readdir(directory)).filter(name => name.endsWith(".csv")).map(async name => ({ name: `source/${name}`, body: await fs.readFile(path.join(directory, name), "utf8") })));
}
const install = (entries: Entry[], maxExpandedBytes = 10 * 1024 * 1024) => runArchive(zip(entries), cleanup => cleanups.push(cleanup), { maxExpandedBytes });

test.each([
  { name: "source/./food.csv", body: "" },
  { name: "source/bad\u001fname", body: "" },
  { name: "source/link", body: "target", attributes: 0xa0000000 },
  { name: "source/pipe", body: "", attributes: 0x10000000 },
  { name: "source/encrypted", body: "x".repeat(12), flags: 1 },
])("unsafe archive entry %# is rejected before extraction", async entry => {
  expect((await install([entry])).final.error).toBe("ZIP contains unsafe paths, links or encrypted content.");
});

test.each(["../food.csv", "/food.csv", "C:/food.csv", "source/../food.csv", "source\\food.csv"])("traversal name %s cannot be extracted", async name => {
  const imported = await install([{ name, body: "invalid" }]);
  expect(imported.final.error).toBe("Invalid or corrupt Foundation CSV ZIP, or insufficient disk space. Verify the download and retry.");
  expect(imported.final.result).toBeUndefined();
});

test("duplicate paths, duplicate tables, and different source directories have distinct errors", async () => {
  const entries = await fixtureEntries();
  expect((await install([{ name: "unused.txt", body: "one" }, { name: "unused.txt", body: "two" }])).final.error).toBe("ZIP contains duplicate file paths.");
  expect((await install([...entries, { name: "another/food.csv", body: "" }])).final.error).toBe("Duplicate Foundation table.");
  expect((await install(entries.map(entry => entry.name.endsWith("food.csv") ? { ...entry, name: entry.name.replace("source/", "another/") } : entry))).final.error).toBe("Foundation tables must occur in a single archive directory.");
});

test("200 members and the exact expanded limit are accepted, with directories and unknown files ignored", async () => {
  const entries: Entry[] = [...await fixtureEntries(), { name: "source/", body: "", attributes: 0x40000000 }, { name: "source/file with spaces", body: "extra", attributes: 0x80000000 }];
  while (entries.length < 200) entries.push({ name: `extra/${entries.length}.txt`, body: "extra" });
  const bytes = entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.body), 0);
  const imported = await install(entries, bytes);
  expect(imported.final.result?.foodCount).toBe(4);
  expect((await fs.readdir(path.join(imported.options.directory, `${imported.options.generation}.staging`))).sort()).toEqual(["food.csv", "food_nutrient.csv", "food_portion.csv", "foundation_food.csv", "measure_unit.csv", "nutrient.csv"]);
  expect((await install([...entries, { name: "extra/201.txt", body: "" }])).final.error).toBe("ZIP contains too many files for a Foundation archive.");
});

test("member extraction checks available storage before writing a table", async () => {
  const entries = await fixtureEntries();
  const first = entries[0]; const bytes = Buffer.byteLength(first.body);
  const real = await fs.statfs(tmpdir());
  vi.mocked(fs.statfs).mockResolvedValue({ ...real, bsize: 1, bavail: bytes * 2 - 1 });
  expect((await install(entries)).final.error).toBe("Not enough disk space to validate USDA archive.");
  vi.mocked(fs.statfs).mockResolvedValueOnce({ ...real, bsize: 1, bavail: bytes * 2 }).mockResolvedValue(real);
  expect((await install(entries)).final.result?.foodCount).toBe(4);
});

test("Foundation accepts BOM headers, quoted fields, and blank lines but rejects oversized CSV records", async () => {
  const entries = await fixtureEntries();
  const source = entries.find(entry => entry.name === "source/food.csv")!;
  source.body = '\uFEFF' + source.body.replace('"Broccoli, raw"', '"Broccoli, ""raw""\nchopped"') + "\n\n";
  const imported = await install(entries);
  expect(imported.read("321900")?.name).toBe('Broccoli, "raw"\nchopped');
  source.body = source.body.split("\n")[0] + `\n1,foundation_food,${"a".repeat(65537)},2024-01-01\n`;
  expect((await install(entries)).final.error).toBe("Invalid or corrupt Foundation CSV ZIP, or insufficient disk space. Verify the download and retry.");
});
