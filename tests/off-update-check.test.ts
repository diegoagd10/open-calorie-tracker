import { LocalOpenFoodFactsAdapter } from "../app/catalog/local-off.server";
import { Readable } from "node:stream";
import { offArchive } from "./support/off-archive";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { OffSnapshotSourceTransport } from "../app/catalog-management/off-snapshot-source.server";
import { openApplicationDatabase } from "../app/database/database.server";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup(fetcher: typeof fetch) {
  const directory = await mkdtemp(path.join(tmpdir(), "off-update-"));
  const database = openApplicationDatabase({ databasePath: path.join(directory, "app.sqlite"), migrationsFolder: path.resolve("drizzle") });
  let now = new Date("2026-09-09T18:00:00Z");
  const options = { provider: "open-food-facts" as const, directory, workerPath: path.resolve("app/catalog-management/import-worker.ts"), maxExpandedBytes: 1024 * 1024, offSourceTransport: { latestSnapshot: () => new OffSnapshotSourceTransport(fetcher).latestSnapshot("csv") }, now: () => now };
  const management = new CatalogManagement(database.getClient(), options);
  cleanups.push(async () => { await management.shutdown(); database.close(); await rm(directory, { recursive: true, force: true }); });
  return { management, database, options, advance: () => { now = new Date(now.getTime() + 6 * 60 * 60 * 1000); } };
}
const snapshotHeaders = { "Content-Type": "application/gzip", "Content-Length": "1275171186", "Last-Modified": "Wed, 09 Sep 2026 12:03:41 GMT", ETag: '"opaque-77"', "x-amz-checksum-crc64nvme": "1Oju86qC+6I=", "x-amz-checksum-type": "FULL_OBJECT" };

test("OFF checks persist metadata independently, cache for six hours and never download or import an archive", async () => {
  const requests: { url: string; method?: string }[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("x-amz-checksum-mode")).toBe("ENABLED");
    return new Response(null, { headers: snapshotHeaders });
  });
  const { management, database, options, advance } = await setup(fetcher);
  await management.checkForUpdate();
  expect(management.read()).toMatchObject({ installed: null, job: null, busy: false, updateCheck: {
    status: "indeterminate", checkedAt: "2026-09-09T18:00:00.000Z", availableSnapshot: { lastModified: "2026-09-09T12:03:41.000Z", etag: '"opaque-77"', crc64nvme: "1Oju86qC+6I=" },
  } });
  await management.shutdown();
  const reloaded = new CatalogManagement(database.getClient(), options);
  expect(reloaded.read()).toEqual(management.read());
  await reloaded.checkForUpdate();
  expect(requests).toHaveLength(1);
  advance();
  await reloaded.checkForUpdate();
  await reloaded.checkForUpdate({ force: true });
  expect(requests).toEqual(Array.from({ length: 3 }, () => ({ url: "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz", method: "HEAD" })));
  const usda = new CatalogManagement(database.getClient(), { ...options, provider: "usda-fdc" });
  expect(usda.read()).toEqual({ installed: null, job: null, busy: false });
  await reloaded.shutdown(); await usda.shutdown();
});

test("an uploaded archive is matched by full-object checksum and later snapshots need chronology as well as changed identity", async () => {
  let headers = { ...snapshotHeaders, "Content-Length": "252", "x-amz-checksum-crc64nvme": "JX7I3P/MX4I=" };
  const { management } = await setup(async () => new Response(null, { headers }));
  await management.checkForUpdate();
  const archive = offArchive();
  await management.submitArchive({ filename: "renamed.gz", stream: Readable.from([archive.subarray(0, 5), archive.subarray(5)]), size: archive.length });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read()).toMatchObject({ installed: { sourceSnapshot: { lastModified: "2026-09-09T12:03:41.000Z", crc64nvme: "JX7I3P/MX4I=" } }, updateCheck: { status: "unchanged" } });
  headers = { ...headers, ETag: '"changed"', "Last-Modified": "Wed, 09 Sep 2026 13:03:41 GMT", "x-amz-checksum-crc64nvme": "1Oju86qC+6I=" };
  await management.checkForUpdate({ force: true });
  expect(management.read().updateCheck?.status).toBe("newer");
  headers = { ...headers, "Last-Modified": "Wed, 09 Sep 2026 12:03:41 GMT" };
  await management.checkForUpdate({ force: true });
  expect(management.read().updateCheck?.status).toBe("indeterminate");
});

// CRC64NVME for offArchive() was computed independently with the bitwise
// NVMe polynomial (not the production streaming table implementation).
const matchedHeaders = { ...snapshotHeaders, "Content-Length": "252", "x-amz-checksum-crc64nvme": "JX7I3P/MX4I=" };
async function install(management: CatalogManagement, archive = offArchive()) {
  await management.submitArchive({ filename: "en.openfoodfacts.org.products.csv.gz", stream: Readable.from([archive]), size: archive.length });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read().job?.phase).toBe("succeeded");
}

test.each([
  ["unchanged", {}, "unchanged"],
  ["checksum identity without an ETag", { ETag: "" }, "unchanged"],
  ["validator identity without a checksum", { "x-amz-checksum-crc64nvme": "" }, "unchanged"],
  ["changed opaque validator without chronology", { ETag: '"changed"', "Last-Modified": "", "x-amz-checksum-crc64nvme": "" }, "indeterminate"],
  ["changed validator with later chronology", { ETag: '"changed"', "Last-Modified": "Wed, 09 Sep 2026 13:03:41 GMT", "x-amz-checksum-crc64nvme": "" }, "newer"],
  ["older rolling object", { ETag: '"changed"', "Last-Modified": "Tue, 08 Sep 2026 12:03:41 GMT", "x-amz-checksum-crc64nvme": "1Oju86qC+6I=" }, "indeterminate"],
  ["future dated object", { ETag: '"changed"', "Last-Modified": "Thu, 10 Sep 2026 12:03:41 GMT", "x-amz-checksum-crc64nvme": "1Oju86qC+6I=" }, "indeterminate"],
  ["no identity validators", { ETag: "", "x-amz-checksum-crc64nvme": "", "Last-Modified": "Wed, 09 Sep 2026 13:03:41 GMT" }, "indeterminate"],
  ["conflicting checksum and ETag", { "x-amz-checksum-crc64nvme": "1Oju86qC+6I=", "Last-Modified": "Wed, 09 Sep 2026 13:03:41 GMT" }, "indeterminate"],
  ["conflicting size and ETag", { "Content-Length": "253", "x-amz-checksum-crc64nvme": "" }, "indeterminate"],
] as const)("installed OFF comparison handles %s", async (_label, change, status) => {
  let headers: Record<string, string> = matchedHeaders;
  const { management } = await setup(async () => new Response(null, { headers }));
  await management.checkForUpdate(); await install(management);
  const before = management.read();
  headers = { ...headers, ...change };
  await management.checkForUpdate({ force: true });
  expect(management.read()).toMatchObject({ installed: before.installed, job: before.job, busy: false, updateCheck: { status } });
});

test.each([
  ["missing checksum", { "x-amz-checksum-crc64nvme": "" }],
  ["composite checksum", { "x-amz-checksum-type": "COMPOSITE" }],
  ["malformed checksum", { "x-amz-checksum-crc64nvme": "invalid" }],
  ["noncanonical checksum", { "x-amz-checksum-crc64nvme": "JX7I3P/MX4J=" }],
  ["mismatched checksum", { "x-amz-checksum-crc64nvme": "1Oju86qC+6I=" }],
  ["mismatched size", { "Content-Length": "253" }],
] as const)("%s leaves an uploaded official-looking filename unknown", async (_label, change) => {
  const { management } = await setup(async () => new Response(null, { headers: { ...matchedHeaders, ...change } }));
  await management.checkForUpdate(); await install(management);
  expect(management.read().installed?.sourceSnapshot).toBeUndefined();
  expect(management.read().updateCheck?.status).toBe("indeterminate");
});

test.each([
  { "Content-Type": "text/html" }, { "Content-Length": "0" }, { "Content-Length": "-1" }, { "Content-Length": "1.5" }, { "Content-Length": "NaN" }, { "Content-Length": "9007199254740992" },
])("invalid OFF archive headers remain indeterminate without initiating work: %j", async change => {
  const { management } = await setup(async () => new Response(null, { headers: { ...matchedHeaders, ...change } }));
  await management.checkForUpdate();
  expect(management.read()).toMatchObject({ installed: null, job: null, updateCheck: { status: "indeterminate", availableSnapshot: null } });
});

test.each(["", "invalid", "Wed, 31 Feb 2026 12:03:41 GMT"])("an invalid date %s does not prevent checksum identity but never proves chronology", async modified => {
  let headers = { ...matchedHeaders, "Last-Modified": modified };
  const { management } = await setup(async () => new Response(null, { headers }));
  await management.checkForUpdate(); await install(management);
  expect(management.read()).toMatchObject({ installed: { sourceSnapshot: { lastModified: null } }, updateCheck: { status: "unchanged" } });
  headers = { ...headers, ETag: '"changed"', "x-amz-checksum-crc64nvme": "1Oju86qC+6I=", "Last-Modified": "Wed, 09 Sep 2026 13:03:41 GMT" };
  await management.checkForUpdate({ force: true });
  expect(management.read().updateCheck?.status).toBe("indeterminate");
});

test("a metadata outage is cached, cannot prevent manual import or lookup, and retry can establish the installed snapshot", async () => {
  let failed = true;
  const fetcher = vi.fn(async () => { if (failed) throw new Error("network failure"); return new Response(null, { headers: matchedHeaders }); });
  const { management, options } = await setup(fetcher);
  await management.checkForUpdate();
  expect(management.read().updateCheck).toMatchObject({ status: "unavailable", error: "Official OFF snapshot metadata could not be checked." });
  await install(management);
  expect(management.read().installed?.sourceSnapshot).toBeUndefined();
  const catalog = new LocalOpenFoodFactsAdapter(management, options.directory);
  const food = await catalog.lookupBarcode("0012345678905");
  await management.checkForUpdate();
  expect(fetcher).toHaveBeenCalledTimes(1);
  failed = false;
  await management.checkForUpdate({ force: true });
  expect(management.read().updateCheck?.status).toBe("unchanged");
  expect(await catalog.lookupBarcode("0012345678905")).toEqual(food);
});

test.each([301, 302, 307, 308])("OFF follows only the official storage redirect (%s), always with HEAD", async status => {
  const requests: { url: string; method?: string; redirect?: string }[] = [];
  const { management } = await setup(async (url, init) => {
    requests.push({ url: String(url), method: init?.method, redirect: init?.redirect });
    return String(url).startsWith("https://static.") ? new Response(null, { status, headers: { Location: "https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/en.openfoodfacts.org.products.csv.gz" } }) : new Response(null, { headers: matchedHeaders });
  });
  await management.checkForUpdate();
  expect(requests).toEqual([
    { url: "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz", method: "HEAD", redirect: "manual" },
    { url: "https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/en.openfoodfacts.org.products.csv.gz", method: "HEAD", redirect: "manual" },
  ]);
  expect(management.read().updateCheck?.availableSnapshot?.crc64nvme).toBe("JX7I3P/MX4I=");
});

test.each([503, 405, 304, 206, 302])("OFF metadata failure %s never falls back to a GET or untrusted redirect", async status => {
  const fetcher = vi.fn(async () => new Response(null, { status, headers: { Location: "https://attacker.example/export.gz" } }));
  const { management } = await setup(fetcher);
  await management.checkForUpdate();
  expect(management.read()).toMatchObject({ installed: null, job: null, updateCheck: { status: "unavailable" } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test.each([
  ["invalid", ""],
  ["AAAAJX7I3P/MX4I=", ""],
  ["JX7I3P/MX4J=", ""],
  ["", 'W/"weak"'],
  ["", 'prefix"tag"'],
  ["", '"tag"suffix'],
] as const)("malformed identity metadata (%s, %s) cannot establish a newer OFF snapshot", async (checksum, etag) => {
  let headers = matchedHeaders;
  const { management } = await setup(async () => new Response(null, { headers }));
  await management.checkForUpdate(); await install(management);
  headers = { ...headers, "Last-Modified": "Wed, 09 Sep 2026 13:03:41 GMT", "x-amz-checksum-crc64nvme": checksum, ETag: etag };
  await management.checkForUpdate({ force: true });
  expect(management.read().updateCheck).toMatchObject({ status: "indeterminate", availableSnapshot: { crc64nvme: null, etag: null } });
});

test("native JSONL discovery uses its validated endpoint and cannot compare CSV object metadata", async () => {
  const requests: string[] = [];
  const source = new OffSnapshotSourceTransport(async (url, init) => {
    requests.push(String(url));
    expect(init?.method).toBe("HEAD");
    return String(url).startsWith("https://static.") ? new Response(null, { status: 302, headers: { Location: "https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/openfoodfacts-products.jsonl.gz" } }) : new Response(null, { headers: snapshotHeaders });
  });
  const available = await source.latestSnapshot();
  expect(requests).toEqual(["https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz", "https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/openfoodfacts-products.jsonl.gz"]);
  expect(available?.format).toBe("jsonl");
  const { offUpdateStatus } = await import("../app/catalog-management/off-snapshot-source.server");
  expect(offUpdateStatus({ ...available!, format: "csv" }, available, "2026-09-13T18:00:00.000Z")).toBe("indeterminate");
});

test("persisted lifecycle refreshes metadata when the detected import format changes and retains old CSV compatibility", async () => {
  const requests: string[] = [];
  const { management: prior, database, options } = await setup(async () => new Response(null, { headers: matchedHeaders }));
  await prior.shutdown();
  const management = new CatalogManagement(database.getClient(), { ...options, offSourceTransport: new OffSnapshotSourceTransport(async url => { requests.push(String(url)); return new Response(null, { headers: matchedHeaders }); }) });
  cleanups.unshift(() => management.shutdown());
  await install(management);
  await management.checkForUpdate();
  expect(requests.at(-1)).toBe("https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz");
  expect(management.read().installed?.sourceSnapshot?.format).toBe("csv");
  const { offJsonlArchive } = await import("./support/off-archive");
  const archive = offJsonlArchive([{ code: "3017620422003", product_name: "JSONL serving", nutriments: { "energy-kcal_serving": 150 } }]);
  await management.submitArchive({ filename: "renamed.csv.gz", stream: Readable.from(archive), size: archive.length });
  await vi.waitFor(() => expect(management.read().busy).toBe(false));
  expect(management.read().job?.phase, JSON.stringify(management.read().job)).toBe("succeeded");
  expect(management.read().installed).toMatchObject({ archiveFormat: "jsonl", filename: "renamed.csv.gz" });
  await management.checkForUpdate();
  expect(requests.at(-1)).toBe("https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz");
  expect(management.read().updateCheck?.availableSnapshot?.format).toBe("jsonl");
  expect(management.read().updateCheck?.status).toBe("indeterminate");
});
