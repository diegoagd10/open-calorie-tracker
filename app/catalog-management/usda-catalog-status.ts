import type { CatalogState, FoundationReleaseMetadata } from "./catalog-management.server";

type ReleaseLabelSource = Pick<FoundationReleaseMetadata, "identifier" | "releasedOn" | "releasePeriod">;
export type UsdaCatalogInformation = Pick<CatalogState, "installed" | "updateCheck">;

/** The one answer the USDA card leads with, derived from installation and the latest metadata check. */
export type UsdaCatalogStatus =
  | { kind: "not-installed" }
  | { kind: "unbound" }
  | { kind: "unchecked" }
  | { kind: "current" }
  | { kind: "newer"; release: FoundationReleaseMetadata }
  | { kind: "unavailable" }
  | { kind: "indeterminate" };

export function usdaCatalogStatus({ installed, updateCheck }: UsdaCatalogInformation): UsdaCatalogStatus {
  if (!installed) return { kind: "not-installed" };
  if (!installed.sourceRelease) return { kind: "unbound" };
  if (!updateCheck) return { kind: "unchecked" };
  if (updateCheck.status === "newer" && updateCheck.availableRelease) return { kind: "newer", release: updateCheck.availableRelease };
  if (updateCheck.status === "unchanged") return { kind: "current" };
  if (updateCheck.status === "unavailable") return { kind: "unavailable" };
  return { kind: "indeterminate" };
}

/** "FoodData Central 15.0", or the release month when USDA declared no identifier. */
export function releaseName(release: ReleaseLabelSource): string {
  return release.identifier ?? `Foundation ${release.releasePeriod}`;
}

/** A compact release name for tight spaces, such as "FDC 15.0". */
export function shortReleaseName(release: ReleaseLabelSource): string {
  return releaseName(release).replace(/^FoodData Central\s+/, "FDC ");
}

export function releaseDate(release: ReleaseLabelSource): string {
  return release.releasedOn ?? release.releasePeriod;
}

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;

/** Elapsed time from `value` to `now` in words: "just now", "25 minutes ago", "18 days ago". */
export function timeAgo(value: string, now: string): string {
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(value));
  if (elapsed < minute) return "just now";
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (elapsed < hour) return format.format(-Math.floor(elapsed / minute), "minute");
  if (elapsed < day) return format.format(-Math.floor(elapsed / hour), "hour");
  const days = Math.floor(elapsed / day);
  if (days < 30) return format.format(-days, "day");
  if (days < 365) return format.format(-Math.floor(days / 30), "month");
  return format.format(-Math.floor(days / 365), "year");
}

/** Archive size as USDA lists it, such as "48 MB". */
export function archiveSize(bytes: number): string {
  return new Intl.NumberFormat("en", { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(bytes / 1_000_000);
}

/** The first and last four characters of a hash, for recognition at a glance. */
export function shortHash(sha256: string): string {
  return sha256.length > 12 ? `${sha256.slice(0, 4)}…${sha256.slice(-4)}` : sha256;
}

export function importCommand(filename: string): string {
  return `pnpm catalog:import:usda -- /absolute/path/to/${filename}`;
}
