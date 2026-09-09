import { expect, test, vi } from "vitest";
import { UsdaFoundationSourceTransport } from "../app/catalog-management/usda-foundation-update-source.server";

const downloads = `
  <h2 id="bkmk-2"> Latest Downloads </h2><h4>Releases</h4><table><thead><tr class="head"><th scope="col">Data Type</th><th scope="col">Release Date</th><th scope="col">Download File</th><th scope="col">File Format</th><th scope="col">Zipped</th><th scope="col">Unzipped</th></tr></thead><tbody>
    <tr class="release"><td data-column="type">Foundation&nbsp;Foods</td><td data-column="date">04/2026</td><td data-column="files">
      <a class="download" href="/fdc-datasets/foundation.json.zip" rel="external">April 2026 (JSON)</a>
      <a class="download" href="/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip" rel="external">April 2026 (CSV)</a>
    </td><td data-column="format">JSON<br>CSV</td><td data-column="zipped">459K<br>3.7M</td><td data-column="expanded">6.5M<br>32M</td></tr>
  </tbody></table><h2 class="history"> Historical Downloads </h2>
  <table><tr><td>Foundation Foods</td><td>12/2025</td><td><a href="/old.csv.zip">December 2025 (CSV)</a></td></tr></table>`;
const log = `
  <div id="minor" class="data-release-log minor"><h3>Data Updates - Branded Foods</h3><p>August 2026 - FoodData Central Version 15.4</p></div>
  <div id="current" class="entry data-release-log major"><h3 class="version">April 30, 2026 - FoodData Central Version 15.0</h3><h4 class="section">Data Updates - Foundation Foods</h4></div>
  <div id="previous" class="entry data-release-log major"><h3 class="version">December 18, 2025 - FoodData Central Version 14.0</h3><h4 class="section">Data Updates - Foundation Foods</h4></div>`;

test("official USDA transport corroborates the latest Foundation row and retrieves archive headers only", async () => {
  const requests: { url: string; method: string; hasSignal: boolean }[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? "GET"; requests.push({ url, method, hasSignal: init?.signal instanceof AbortSignal });
    if (url.endsWith("/download-datasets/")) return new Response(downloads, { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/log/")) return new Response(log, { headers: { "Content-Type": "text/html" } });
    return new Response(null, { headers: { "Content-Length": "3825741", "Content-Type": "application/zip" } });
  });

  await expect(new UsdaFoundationSourceTransport(fetcher).latestFoundationRelease()).resolves.toEqual({
    releasePeriod: "2026-04",
    identifier: "FoodData Central 15.0",
    releasedOn: "2026-04-30",
    archiveUrl: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip",
    archiveFilename: "FoodData_Central_foundation_food_csv_2026-04-30.zip",
    archiveByteLength: 3825741,
  });
  expect(requests).toEqual([
    { url: "https://fdc.nal.usda.gov/download-datasets/", method: "GET", hasSignal: true },
    { url: "https://fdc.nal.usda.gov/log/", method: "GET", hasSignal: true },
    { url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip", method: "HEAD", hasSignal: true },
  ]);
});

test("official USDA transport accepts compact headings, nested cell text and the minimum three columns", async () => {
  const compact = `<h2>Latest Downloads</h2><table><tr><th>Data Type</th><th>Release Date</th><th>Download File</th><th>File Format</th><th>Zipped</th><th>Unzipped</th></tr><tr><td><span>Foundation</span><span>Foods</span></td><td>04/2026</td><td><a href="/foundation.zip">April &amp; 2026 (CSV)</a></td></tr></table><h2>Historical Downloads</h2>`;
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/download-datasets/")) return new Response(compact, { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/log/")) return new Response(log, { headers: { "Content-Type": "text/html" } });
    return new Response(null, { headers: { "Content-Length": "7", "Content-Type": "application/zip" } });
  });
  await expect(new UsdaFoundationSourceTransport(fetcher).latestFoundationRelease()).resolves.toMatchObject({
    releasePeriod: "2026-04",
    archiveFilename: "foundation.zip",
    archiveByteLength: 7,
  });
});

test("official USDA transport zero-pads a one-digit corroborated day", async () => {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/download-datasets/")) return new Response(downloads, { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/log/")) return new Response(log.replace("April 30, 2026", "April 5, 2026"), { headers: { "Content-Type": "text/html" } });
    return new Response(null, { headers: { "Content-Length": "3825741", "Content-Type": "application/zip" } });
  });
  await expect(new UsdaFoundationSourceTransport(fetcher).latestFoundationRelease()).resolves.toMatchObject({ releasedOn: "2026-04-05" });
});

test.each(["15", "15.0.1", "15.10"])("official USDA transport preserves valid update-log version %s", async version => {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/download-datasets/")) return new Response(downloads, { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/log/")) return new Response(log.replace("Version 15.0", `Version ${version}`), { headers: { "Content-Type": "text/html" } });
    return new Response(null, { headers: { "Content-Length": "3825741", "Content-Type": "application/zip" } });
  });
  await expect(new UsdaFoundationSourceTransport(fetcher).latestFoundationRelease()).resolves.toMatchObject({ identifier: `FoodData Central ${version}` });
});

test("official USDA transport retains the download-table period when update-log retrieval fails", async () => {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/download-datasets/")) return new Response(downloads, { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/log/")) throw new Error("network unavailable");
    expect(init?.method).toBe("HEAD");
    return new Response(null, { headers: { "Content-Length": "3825741", "Content-Type": "application/zip" } });
  });
  await expect(new UsdaFoundationSourceTransport(fetcher).latestFoundationRelease()).resolves.toMatchObject({ releasePeriod: "2026-04", identifier: null, releasedOn: null });
});

test.each([
  ["1/2026", "January", "2026-01", "2026-01-15"],
  ["02/2026", "February", "2026-02", "2026-02-15"],
  ["03/2026", "March", "2026-03", "2026-03-15"],
  ["04/2026", "April", "2026-04", "2026-04-15"],
  ["05/2026", "May", "2026-05", "2026-05-15"],
  ["06/2026", "June", "2026-06", "2026-06-15"],
  ["07/2026", "July", "2026-07", "2026-07-15"],
  ["08/2026", "August", "2026-08", "2026-08-15"],
  ["09/2026", "September", "2026-09", "2026-09-15"],
  ["10/2026", "October", "2026-10", "2026-10-15"],
  ["11/2026", "November", "2026-11", "2026-11-15"],
  ["12/2026", "December", "2026-12", "2026-12-15"],
] as const)("official USDA transport normalizes declared Foundation month %s", async (sourcePeriod, month, releasePeriod, releasedOn) => {
  const downloadHtml = downloads.replace("04/2026", sourcePeriod);
  const logHtml = log.replace("April 30, 2026", `${month} 15, 2026`);
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/download-datasets/")) return new Response(downloadHtml, { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/log/")) return new Response(logHtml, { headers: { "Content-Type": "text/html" } });
    return new Response(null, { headers: { "Content-Length": "3825741", "Content-Type": "application/zip" } });
  });
  await expect(new UsdaFoundationSourceTransport(fetcher).latestFoundationRelease()).resolves.toMatchObject({ releasePeriod, releasedOn, identifier: "FoodData Central 15.0" });
});

test.each([
  [downloads.replace("04/2026", "03/2026"), log],
  [downloads.replace('<h2 class="history"> Historical Downloads </h2>', downloads + '<h2 class="history"> Historical Downloads </h2>'), log],
  [downloads.replace("(CSV)", "(TSV)"), log],
  [downloads, log.replace("Data Updates - Foundation Foods", "Data Updates - Experimental Foods")],
  [downloads.replace("Data Type", "Wrong Type"), log],
  [downloads.replace("04/2026", "4/2026 extra"), log],
  [downloads.replace("04/2026", "x04/2026"), log],
  [downloads.replace("04/2026", "00/2026"), log],
  [downloads.replace("04/2026", "13/2026"), log],
  [downloads.replace("Foundation&nbsp;Foods", "Other Foods"), log],
  [downloads.replace("Foundation&nbsp;Foods", "Foundation Foods Extra"), log],
  [downloads.replace(/<tr class="release">[\s\S]*?<\/tr>/, "<tr><td>Foundation Foods</td><td>04/2026</td></tr>"), log],
  [downloads.replace("</tbody>", downloads.match(/<tr class="release">[\s\S]*?<\/tr>/)![0] + "</tbody>"), log],
  [downloads.replace("/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip", "https://example.com/foundation.zip"), log],
  [downloads.replace("/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip", "http://fdc.nal.usda.gov/foundation.zip"), log],
  [downloads, log.replace("April 30, 2026", "April 30, 2025")],
  [downloads, log.replace("April 30, 2026", "March 30, 2026")],
  [downloads, log.replace("April 30, 2026", "April 31, 2026")],
  [downloads, log.replace('<h3 class="version">April 30, 2026 - FoodData Central Version 15.0</h3>', "")],
  [downloads, log.replace("April 30, 2026", "Note April 30, 2026")],
  [downloads, log.replace("Version 15.0", "Version 15.0 notes")],
  [downloads, log.replace("Version 15.0", "Version beta")],
] as const)("official USDA transport fails closed for ambiguous or uncorroborated metadata %#", async (downloadHtml, logHtml) => {
  const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => new Response(String(input).endsWith("/log/") ? logHtml : downloadHtml, { headers: { "Content-Type": "text/html" } }));
  await expect(new UsdaFoundationSourceTransport(fetcher).latestFoundationRelease()).resolves.toBeNull();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "HEAD")).toBe(false);
});

test("official USDA transport accepts the metadata size boundary and rejects a missing content type", async () => {
  const boundary = vi.fn(async () => new Response("x".repeat(2 * 1024 * 1024), { headers: { "Content-Type": "text/html" } }));
  await expect(new UsdaFoundationSourceTransport(boundary).latestFoundationRelease()).resolves.toBeNull();
  const missingType = vi.fn(async () => new Response(downloads));
  await expect(new UsdaFoundationSourceTransport(missingType).latestFoundationRelease()).rejects.toThrow("USDA metadata response was unavailable.");
});

test.each([
  ["download failure", 500, "text/html", downloads],
  ["wrong download content type", 200, "text/plain", downloads],
  ["oversized download metadata", 200, "text/html", "x".repeat(2 * 1024 * 1024 + 1)],
] as const)("official USDA transport rejects %s", async (_label, status, contentType, body) => {
  const fetcher = vi.fn(async () => new Response(body, { status, headers: { "Content-Type": contentType } }));
  await expect(new UsdaFoundationSourceTransport(fetcher).latestFoundationRelease()).rejects.toThrow();
});

test.each([
  [200, "text/plain", "3825741"],
  [200, null, "3825741"],
  [200, "application/zip", null],
  [200, "application/zip", "0"],
  [200, "application/zip", "1.5"],
] as const)("official USDA transport treats malformed archive headers as indeterminate %#", async (status, contentType, length) => {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/download-datasets/")) return new Response(downloads, { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/log/")) return new Response(log, { headers: { "Content-Type": "text/html" } });
    return new Response(null, { status, headers: { ...(contentType === null ? {} : { "Content-Type": contentType }), ...(length === null ? {} : { "Content-Length": length }) } });
  });
  await expect(new UsdaFoundationSourceTransport(fetcher).latestFoundationRelease()).resolves.toBeNull();
});

test("official USDA transport treats an unsuccessful archive HEAD as unavailable", async () => {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/download-datasets/")) return new Response(downloads, { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/log/")) return new Response(log, { headers: { "Content-Type": "text/html" } });
    return new Response(null, { status: 503 });
  });
  await expect(new UsdaFoundationSourceTransport(fetcher).latestFoundationRelease()).rejects.toThrow("USDA archive metadata response was unavailable.");
});
