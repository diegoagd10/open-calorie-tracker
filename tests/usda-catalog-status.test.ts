import { expect, test } from "vitest";
import { archiveSize, releaseName, shortHash, shortReleaseName, timeAgo, usdaCatalogStatus } from "../app/catalog-management/usda-catalog-status";

const now = "2026-10-09T12:00:00.000Z";
const release = { releasePeriod: "2026-10", identifier: "FoodData Central 16.0", releasedOn: "2026-10-01", archiveUrl: "https://fdc.nal.usda.gov/x.zip", archiveFilename: "x.zip", archiveByteLength: 1 };
const installed = { generation: "g", filename: "x.zip", sha256: "abc", foodCount: 1, installedAt: now, publicationDateRange: { earliest: "2019-04-01", latest: "2026-04-30" }, sourceRelease: { ...release, archiveUrl: undefined } };

test.each([
  ["2026-10-09T11:59:30.000Z", "just now"],
  ["2026-10-09T12:00:30.000Z", "just now"],
  ["2026-10-09T11:35:00.000Z", "25 minutes ago"],
  ["2026-10-09T09:00:00.000Z", "3 hours ago"],
  ["2026-10-08T11:00:00.000Z", "yesterday"],
  ["2026-09-21T09:40:57.000Z", "18 days ago"],
  ["2026-06-01T00:00:00.000Z", "4 months ago"],
  ["2024-01-01T00:00:00.000Z", "2 years ago"],
])("%s was %s", (value, expected) => {
  expect(timeAgo(value, now)).toBe(expected);
});

test("release names prefer USDA's identifier and fall back to the release month", () => {
  expect(releaseName(release)).toBe("FoodData Central 16.0");
  expect(shortReleaseName(release)).toBe("FDC 16.0");
  expect(shortReleaseName({ ...release, identifier: null })).toBe("Foundation 2026-10");
});

test("hashes and archive sizes are shortened for display", () => {
  expect(shortHash("3f9a7d1e0b5c42a88e6f1d93b7c0a5e4d2f81c6b9a0e3d7f5c1b8a2e6d4f9c21e")).toBe("3f9a…c21e");
  expect(shortHash("abc123")).toBe("abc123");
  expect(archiveSize(48_250_000)).toBe("48.3 MB");
});

test("a newer status without a declared release cannot be acted on and stays indeterminate", () => {
  const checkedAt = now;
  expect(usdaCatalogStatus({ installed, updateCheck: { status: "newer", checkedAt, availableRelease: null, error: null } })).toEqual({ kind: "indeterminate" });
  expect(usdaCatalogStatus({ installed, updateCheck: { status: "newer", checkedAt, availableRelease: release, error: null } })).toEqual({ kind: "newer", release });
  expect(usdaCatalogStatus({ installed, updateCheck: undefined })).toEqual({ kind: "unchecked" });
});
