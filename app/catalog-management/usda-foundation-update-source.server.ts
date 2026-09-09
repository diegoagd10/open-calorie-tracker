import path from "node:path";
import type { CatalogSourceTransport, FoundationReleaseMetadata } from "./catalog-management.server";

const downloadsUrl = "https://fdc.nal.usda.gov/download-datasets/";
const updateLogUrl = "https://fdc.nal.usda.gov/log/";
const maximumMetadataBytes = 2 * 1024 * 1024;

function textContent(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replaceAll("&nbsp;", " ").replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();
}

function latestDownloads(html: string): string | null {
  return html.match(/<h2\b[^>]*>\s*Latest Downloads\s*<\/h2>([\s\S]*?)<h2\b[^>]*>\s*Historical Downloads\s*<\/h2>/i)?.[1] ?? null;
}

function expectedHeaders(html: string): boolean {
  const headers = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(match => textContent(match[1]));
  return headers.join("|") === "Data Type|Release Date|Download File|File Format|Zipped|Unzipped";
}

function foundationRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => match[1]).filter(row => textContent(row).startsWith("Foundation Foods"));
}

function tableCells(row: string): string[] {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match => match[1]);
}

function csvLink(html: string): string | null {
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].filter(match => textContent(match[2]).includes("(CSV)"));
  return links.length === 1 ? links[0][1] : null;
}

function uniqueFoundationCells(html: string): string[] | null {
  if (!expectedHeaders(html)) return null;
  const rows = foundationRows(html);
  if (rows.length !== 1) return null;
  const cells = tableCells(rows[0]);
  if (cells.length < 3 || textContent(cells[0]) !== "Foundation Foods") return null;
  return cells;
}

function officialArchiveUrl(href: string): URL | null {
  const archiveUrl = new URL(href, downloadsUrl);
  return archiveUrl.protocol === "https:" && archiveUrl.hostname === "fdc.nal.usda.gov" ? archiveUrl : null;
}

function foundationDownload(html: string): { month: number; year: number; archiveUrl: URL } | null {
  const latest = latestDownloads(html);
  if (!latest) return null;
  const cells = uniqueFoundationCells(latest);
  if (!cells) return null;
  const period = textContent(cells[1]).match(/^(0?[1-9]|1[0-2])\/(\d{4})$/);
  const href = csvLink(cells[2]);
  if (!period || !href) return null;
  const archiveUrl = officialArchiveUrl(href);
  if (!archiveUrl) return null;
  return { month: Number(period[1]), year: Number(period[2]), archiveUrl };
}

function corroboratedRelease(html: string, month: number, year: number): Pick<FoundationReleaseMetadata, "identifier" | "releasedOn"> | null {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const candidates = html.split(/(?=<div\b[^>]*class=["'][^"']*\bdata-release-log\b)/i).flatMap(block => {
    if (!textContent(block).includes("Data Updates - Foundation Foods")) return [];
    const heading = textContent(block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    const match = heading.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4}) - FoodData Central Version ([0-9]+(?:\.[0-9]+)*)$/);
    if (!match || months.indexOf(match[1]) + 1 !== month || Number(match[3]) !== year) return [];
    const releasedOn = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    return [{ identifier: `FoodData Central ${match[4]}`, releasedOn }];
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export class UsdaFoundationSourceTransport implements CatalogSourceTransport {
  readonly #fetch: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) { this.#fetch = fetcher; }

  async latestFoundationRelease(): Promise<FoundationReleaseMetadata | null> {
    const downloads = await this.#html(downloadsUrl);
    const download = foundationDownload(downloads);
    if (!download) return null;
    const release = await this.#corroboration(download.month, download.year);
    if (release === null) return null;
    const archiveByteLength = await this.#archiveByteLength(download.archiveUrl);
    if (archiveByteLength === null) return null;
    const archiveFilename = path.posix.basename(download.archiveUrl.pathname);
    return {
      releasePeriod: `${download.year}-${String(download.month).padStart(2, "0")}`,
      identifier: release?.identifier ?? null,
      releasedOn: release?.releasedOn ?? null,
      archiveUrl: download.archiveUrl.href,
      archiveFilename,
      archiveByteLength,
    };
  }

  async #corroboration(month: number, year: number): Promise<Pick<FoundationReleaseMetadata, "identifier" | "releasedOn"> | undefined | null> {
    try { return corroboratedRelease(await this.#html(updateLogUrl), month, year); }
    catch { return undefined; }
  }

  async #archiveByteLength(url: URL): Promise<number | null> {
    const response = await this.#fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("USDA archive metadata response was unavailable.");
    const length = Number(response.headers.get("Content-Length"));
    const zip = response.headers.get("Content-Type")?.toLowerCase() === "application/zip";
    return zip && Number.isSafeInteger(length) && length > 0 ? length : null;
  }

  async #html(url: string): Promise<string> {
    const response = await this.#fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.headers.get("Content-Type")?.toLowerCase().includes("text/html")) throw new Error("USDA metadata response was unavailable.");
    const html = await response.text();
    if (Buffer.byteLength(html) > maximumMetadataBytes) throw new Error("USDA metadata response was too large.");
    return html;
  }
}
