export type OffSnapshotMetadata = {
  lastModified: string | null;
  etag: string | null;
  archiveByteLength: number;
  crc64nvme: string | null;
};
export type OffSourceTransport = { latestSnapshot(): Promise<OffSnapshotMetadata | null> };
const exportUrl = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";
const storageUrl = "https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/en.openfoodfacts.org.products.csv.gz";

function lastModifiedDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toUTCString() === value ? date.toISOString() : null;
}
function fullObjectChecksum(headers: Headers): string | null {
  if (headers.get("x-amz-checksum-type") !== "FULL_OBJECT") return null;
  const checksum = headers.get("x-amz-checksum-crc64nvme");
  if (!checksum || !/^[A-Za-z0-9+/]{11}=$/.test(checksum)) return null;
  return Buffer.from(checksum, "base64").toString("base64") === checksum ? checksum : null;
}
function snapshot(headers: Headers): OffSnapshotMetadata | null {
  const archiveByteLength = Number(headers.get("Content-Length"));
  if (headers.get("Content-Type") !== "application/gzip" || !Number.isSafeInteger(archiveByteLength) || archiveByteLength <= 0) return null;
  const etag = headers.get("ETag");
  return {
    lastModified: lastModifiedDate(headers.get("Last-Modified")),
    etag: etag && /^"[!#-~]+"$/.test(etag) ? etag : null,
    archiveByteLength,
    crc64nvme: fullObjectChecksum(headers),
  };
}

export class OffSnapshotSourceTransport implements OffSourceTransport {
  readonly #fetch: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) { this.#fetch = fetcher; }

  async latestSnapshot(): Promise<OffSnapshotMetadata | null> {
    const init: RequestInit = { method: "HEAD", redirect: "manual", headers: { "x-amz-checksum-mode": "ENABLED" }, signal: AbortSignal.timeout(5000) };
    let response = await this.#fetch(exportUrl, init);
    if ([301, 302, 307, 308].includes(response.status) && response.headers.get("Location") === storageUrl) response = await this.#fetch(storageUrl, init);
    if (response.status !== 200) throw new Error("Official OFF snapshot metadata could not be checked.");
    return snapshot(response.headers);
  }
}

export function matchOffSnapshot(available: OffSnapshotMetadata | null | undefined, checksum: string | undefined, byteLength: number | undefined): OffSnapshotMetadata | undefined {
  return available?.crc64nvme && available.crc64nvme === checksum && available.archiveByteLength === byteLength ? available : undefined;
}

function compareValidator(installed: string | null, available: string | null): "same" | "changed" | "unknown" {
  if (installed === null || available === null) return "unknown";
  return installed === available ? "same" : "changed";
}
function compareIdentity(installed: OffSnapshotMetadata, available: OffSnapshotMetadata): "same" | "changed" | "unknown" {
  const checksum = compareValidator(installed.crc64nvme, available.crc64nvme);
  const tag = compareValidator(installed.etag, available.etag);
  if (checksum === "same" || tag === "same") {
    return checksum !== "changed" && installed.archiveByteLength === available.archiveByteLength ? "same" : "unknown";
  }
  return checksum === "changed" || tag === "changed" ? "changed" : "unknown";
}
export function offUpdateStatus(installed: OffSnapshotMetadata | undefined, available: OffSnapshotMetadata | null, checkedAt: string): "newer" | "unchanged" | "indeterminate" {
  if (!installed || !available) return "indeterminate";
  const identity = compareIdentity(installed, available);
  if (identity === "same") return "unchanged";
  if (identity !== "changed" || !installed.lastModified || !available.lastModified) return "indeterminate";
  return available.lastModified <= checkedAt && available.lastModified > installed.lastModified ? "newer" : "indeterminate";
}
