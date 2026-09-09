# USDA Foundation bulk-release metadata

Reviewed September 9, 2026. This note answers the release-detection question in TKT-9a0e06a5 using first-party USDA sources.

## Finding

The canonical source for the currently downloadable Foundation archives is USDA FoodData Central's [Download Datasets page](https://fdc.nal.usda.gov/download-datasets/). Its **Latest Downloads** table gives separate, explicit columns for `Data Type`, `Release Date`, `Download File`, and `File Format`; the current Foundation row says `Foundation Foods`, `04/2026`, and offers April 2026 JSON and CSV archives. The page's historical table uses the same fields for earlier Foundation releases, including December 2025, April 2025, and October 2024 ([USDA Download Datasets](https://fdc.nal.usda.gov/download-datasets/)).

USDA's [FoodData Central Inventory and Update Log](https://fdc.nal.usda.gov/log/) is the best first-party corroborating source. It identifies the current Foundation-bearing event as **April 30, 2026 — FoodData Central Version 15.0**, immediately followed by **Data Updates - Foundation Foods**; it similarly identifies December 18, 2025 as version 14.0, April 24, 2025 as version 13.0, and October 31, 2024 as version 12.0 ([USDA update log](https://fdc.nal.usda.gov/log/)). This exact date and version are useful display and equality metadata, but USDA does not document the version string as Semantic Versioning or as an independently sortable Foundation version.

Use the download page as the availability authority and the update log as corroboration/enrichment. A check is **known** only when it can identify exactly one latest `Foundation Foods` row and parse its explicit release period; when update-log enrichment is available, its most recent heading whose following section is `Data Updates - Foundation Foods` must agree on the same year and month. The archive URL and human label are payload links, not the source of the release ordering.

### Observed HTML and transport contract

On the download page, the stable semantic anchor observed on September 9, 2026 was `h2#bkmk-2` with text `Latest Downloads`, followed by an `h4` with text `Releases` and then a table. The observed structural selector is `h2#bkmk-2 + h4 + app-shadow-table table`; also validate the heading text instead of treating that selector alone as the contract. Do not depend on Angular's generated `_ngcontent-*` attributes. Validate the table headers in order as `Data Type`, `Release Date`, `Download File`, `File Format`, `Zipped`, and `Unzipped`, then select the single body row whose first cell normalizes to `Foundation Foods` ([USDA Download Datasets](https://fdc.nal.usda.gov/download-datasets/)). Its observed values were:

| Field | Observed value |
| --- | --- |
| Release Date | `04/2026` |
| JSON link | `/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip` |
| CSV link | `/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip` |
| JSON size | `459K` zipped / `6.5M` unzipped |
| CSV size | `3.7M` zipped / `32M` unzipped |

On the update log, select `.data-release-log.major` blocks and retain only a block containing a direct-child `h4` whose normalized text is `Data Updates - Foundation Foods`; parse that block's direct-child `h3` (`.data-release-log.major > h3`). The current observed `h3` was `April 30, 2026 - FoodData Central Version 15.0` ([USDA update log](https://fdc.nal.usda.gov/log/)). Later version 15.1 through 15.4 entries are in Branded Foods sections, so the numerically latest site-wide FDC version is not necessarily the latest Foundation release ([USDA update log](https://fdc.nal.usda.gov/log/)).

Repeated `HEAD` requests to the CSV URL on September 9, 2026 returned `200`, `Content-Type: application/zip`, and the same exact `Content-Length: 3825741`, but two different validator pairs: `Last-Modified: Wed, 19 Aug 2026 20:12:48 GMT` with `ETag: "6a860e40-3a604d"`, and `Last-Modified: Wed, 19 Aug 2026 20:09:43 GMT` with `ETag: "6a860d87-3a604d"` ([USDA April 2026 Foundation CSV ZIP](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip)). Preserve the exact byte length in the checked descriptor as a correlation signal. Record transport validators for diagnostics at most: even concurrent observations are not stable enough to be the Foundation release identity or an ordering key.

## Why the alternatives are insufficient

- A Foundation food's `FDC Published` date is the date that food was first added to FoodData Central, even though Foundation data for that food may be updated later. It is therefore not a bulk-release date ([USDA Help: Dates](https://fdc.nal.usda.gov/help/)).
- USDA describes Foundation Foods as normally updated in April and October, but the official history includes a December 2025 Foundation release. A checker must read explicit published metadata rather than predict a release from the normal schedule ([USDA Data Type Documentation](https://fdc.nal.usda.gov/data-documentation/), [USDA Download Datasets](https://fdc.nal.usda.gov/download-datasets/)).
- The documented FoodData Central API exposes food search/list/detail operations, not a bulk-download release-catalog endpoint ([USDA API Guide](https://fdc.nal.usda.gov/api-guide/), [USDA OpenAPI documentation](https://fdc.nal.usda.gov/api-spec/fdc_api.html)). The USDA Ag Data Commons collection likewise points consumers back to the FoodData Central download page rather than publishing Foundation release distributions of its own ([USDA Ag Data Commons: FoodData Central](https://agdatacommons.nal.usda.gov/collections/FoodData_Central/6953745)).
- Direct inspection of the current official CSV ZIP found the data tables and the included field-description workbook, but no manifest containing a release ID, release date, version, checksum, or link back to a release record ([USDA April 2026 Foundation CSV ZIP](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip)). Consequently, an archive filename, ZIP member timestamps, or the maximum food publication date cannot establish the official release by themselves.
- USDA has previously corrected and republished download files after their named release: the update log records December 2022 corrections to the October 2022 Foundation JSON and other archives, and a later correction to the October 2022 full CSV ([USDA update log](https://fdc.nal.usda.gov/log/)). Release-period comparison can detect a newer named release, but it cannot prove that an installed copy includes every same-period repack or correction.

No reviewed USDA surface publishes a documented, machine-readable Foundation release feed with a stable release identifier and checksum. The download and update-log pages are server-rendered HTML. This is an explicit research limitation, not proof that an undisclosed endpoint does not exist; the implementation should treat a page-shape change as indeterminate rather than reverse-engineer a private endpoint or silently fall back to HTTP `ETag`/`Last-Modified` values ([USDA Download Datasets](https://fdc.nal.usda.gov/download-datasets/), [USDA API Guide](https://fdc.nal.usda.gov/api-guide/)).

## Recommended metadata model

Keep these facts distinct:

| Fact | Meaning | Source |
| --- | --- | --- |
| `installedReleasePeriod` | The official Foundation release period associated with the uploaded archive, stored canonically as `{ year, month }` | Captured release descriptor; the source value is the Foundation row's `Release Date` ([USDA Download Datasets](https://fdc.nal.usda.gov/download-datasets/)) |
| `installedReleaseDate` | Optional exact USDA release date | Matching Foundation-bearing update-log heading ([USDA update log](https://fdc.nal.usda.gov/log/)) |
| `installedFdcVersion` | Optional opaque USDA display/equality label, such as `15.0` | Matching Foundation-bearing update-log heading ([USDA update log](https://fdc.nal.usda.gov/log/)) |
| `installedArchiveSha256` | Immutable local identity for the bytes that were imported; not an official USDA release identifier | Calculated locally because USDA does not publish one on its download table ([USDA Download Datasets](https://fdc.nal.usda.gov/download-datasets/)) |
| `officialCsvUrl` / `officialCsvByteLength` | The CSV link taken from the checked Foundation row and the exact size observed with `HEAD` | Official archive link and response metadata ([USDA April 2026 Foundation CSV ZIP](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip)) |
| `uploadedAt` / `installedAt` | When this application received or activated the archive | Local clock; not source-release metadata |
| `lastCheckedAt` | When the application last completed an official metadata check | Local clock; not source-release metadata |

An existing installation that has only filename, checksum, upload time, or food publication-date range does **not** have a verified official release identity. Report it as `indeterminate`; do not retrofit a release period from those fields. Because the official ZIP lacks a release manifest or checksum, bind a future installation to the checked descriptor only after the upload passes the Foundation schema/content validation **and** the received filename and exact received byte count match the checked official CSV URL basename and `Content-Length`. Preserve the descriptor that was actually checked, rather than whatever is in a later cache entry. This is conservative correlation, not cryptographic proof: the local SHA-256 identifies imported bytes but is not USDA attestation ([USDA April 2026 Foundation CSV ZIP](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip)). A mismatch must not reject an otherwise valid manual upload; it leaves the installed official release identity unverified and therefore update comparison `indeterminate`.

## Comparison and state semantics

Normalize an explicit USDA `M/YYYY` or `MM/YYYY` release value to `{ year, month }` only after validating it as a real calendar month. Compare `(year, month)` lexicographically; do not parse the archive filename, order FDC food dates, interpret the FDC version as SemVer, or use HTTP validators as the ordering key.

| Condition | State | Meaning shown to the administrator |
| --- | --- | --- |
| No catalog is installed | `not-installed` | Show the available official release when known and the upload guidance, but never say the catalog is current. |
| Both periods are valid and available is later | `newer` | A newer named USDA Foundation release is available. |
| Periods and any version values present on both sides are equal, and any byte lengths present on both sides agree | `unchanged` | The installed named release matches the latest named release known to the checker. This does not guarantee detection of a same-length, same-period corrected archive. |
| Installed period is absent/unverified, either period is invalid, available is earlier than installed, same-period versions conflict, same-period byte lengths conflict, or a successful page response has no unique valid Foundation row | `indeterminate` | USDA metadata and installed metadata cannot support a defensible ordering. Preserve manual upload. A same-period length change may be an in-place correction, not a newer named release. |
| The official request fails, times out, or is non-successful | `unavailable` | The check could not retrieve official metadata. Preserve the installed catalog and manual upload. |

If the download page succeeds but the update log is temporarily unavailable, year/month comparison from the explicit Foundation `Release Date` remains defensible; omit the exact date/version and say they were not corroborated. If both pages respond but disagree on year/month, return `indeterminate` because USDA may be updating them non-atomically. USDA's own history of post-release download corrections is why `unchanged` must be phrased as “same named release,” not “identical archive bytes” ([USDA update log](https://fdc.nal.usda.gov/log/)).

## Manual-download guidance

Link administrators to the [official USDA Download Datasets page](https://fdc.nal.usda.gov/download-datasets/), instruct them to choose the **Foundation Foods CSV** ZIP in **Latest Downloads**, download it outside the application, then return and upload the ZIP. USDA states that FoodData Central datasets are offered as CSV and JSON, and its Foundation documentation identifies those downloadable data files as the way to obtain Foundation Foods ([USDA Download Datasets](https://fdc.nal.usda.gov/download-datasets/), [USDA Foundation Foods Documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/)). A metadata check should fetch only the official HTML metadata pages; it should not fetch an archive or start an import.
