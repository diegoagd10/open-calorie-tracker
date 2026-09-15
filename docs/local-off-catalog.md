# Local Open Food Facts installation and replacement

Operators download the official product JSONL GZIP (recommended for source-backed serving nutrition; tab-separated CSV GZIP remains supported) from [Open Food Facts](https://world.openfoodfacts.org/data) and run `pnpm catalog:import:off -- /absolute/path/to/products.jsonl.gz` on the running server. Follow the [README prerequisites and container examples](../README.md#install-food-catalogs-from-the-terminal). Food Catalogs shows availability, provenance and metadata checks only. The same command accepts a newer archive or deliberate reimport. USDA can be absent, importing, failing, or remain in use throughout this independent operation. Barcode scanning, manual barcode entry, review, and saving use the local OFF database; Search food uses USDA only. No OFF API configuration or network fallback is used. OFF data is licensed under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

## Nutrition authority and CSV limitations

The standard daily CSV export **does not identify whether its `_100g` values describe 100 g or 100 ml**. The supplied September 2026 file also omits explicit per-serving nutrients and normalized serving units. Its products are retained only for import diagnostics and are not exposed by public barcode or detail reads. Neither the package quantity, free-text serving size, food category, nor the ambiguous legacy `nutrition_data_per=100g` is used to guess a basis. No density is inferred and package size never becomes a serving.

Source-backed calculation is supported by JSONL native nutrition and by compatible CSV projections:

- Native JSON `nutrition.input_sets` arrays: only explicit `source: packaging`, `preparation: as_sold` sets with supported `per` (`100g`, `100ml`, `serving`), positive `per_quantity` and matching `per_unit` (`g`, `ml`) are accepted. A 100-unit declaration must agree with its quantity and dimension. A usable serving is authoritative when present. Without serving nutrition, a positive source-declared serving quantity in `g` or `ml` selects per-100 candidates in the matching dimension; otherwise the sole available per-100 dimension is used, while unresolved mass/volume ambiguity remains a conflict. Compatible candidates at the selected priority prefer the most complete tracked nutrition, then canonical nutrient order for a deterministic tie. Nutrients come entirely from the selected set, and lower-priority sets cannot overwrite it. Equal-priority overlapping values are compared per 100 source units after rounding to integer milli-kcal/milligrams; differing serving quantities or overlapping rounded values are conflicts. Native serving measures come first, followed by 1/100 g or ml using only the declared quantity, never inferred density. A per-100 authority offers `1 serving` only when the source declares a positive serving quantity in the same dimension. `value_computed`, aggregated sets and macro-derived calories are ignored. Any present native array (including empty/invalid arrays) prevents legacy fallback; an invalid trusted reference blocks calculation rather than hiding its authority. Unsupported prepared/manufacturer/USDA/estimate sets are excluded, counted and never replace packaging values.
- Direct legacy `*_serving` fields: one serving is the authority, with no conversion to mass or volume. Nutrients use the units defined by OFF: grams, kcal for `energy-kcal`, and kJ for `energy-kj`/`energy`.
- The official configurable CSV export's explicit `nutrition.input_sets.packaging.as_sold.<per>.nutrients.<nutrient>.value`, `.unit`, and optional `.modifier` fields. Exactly one populated basis, `100g`, `100ml`, or `serving`, is accepted. Only packaging values for the product as sold are used. Conflicting bases, prepared data, inferred/estimated sets, unknown units, and qualified values are not substituted for source authority. Supported nutrient units are g/mg and kcal/kJ. Kilojoules convert using 4.184 kJ/kcal; results use the existing fixed-point snapshot rounding.

For a mass or volume authority, 1 and 100 units are offered. A serving is offered only with a positive `serving_quantity` and explicit `serving_quantity_unit` matching that authority. This provides a measure in the same dimension, never a density conversion. Missing nutrients stay null; explicit zero stays zero. Missing/invalid calories, ambiguous/conflicting bases and an explicit no-nutrition flag have separate calculation-unavailable reasons. The application schema allows positive source-declared measured bases such as the native 41 g serving. Migration 0016 copies every stored snapshot field unchanged while extending that constraint; no nutrition is recalculated and dependent photo rows remain intact. Existing one-serving snapshots retain their quantities, nutrition, supported measures, edits and copies without source lookup.

The public OFF adapter exposes selectable products and the one unresolved outcome that is still inside the priority tree: `conflicting_nutrition_bases`. Every other non-selectable result is treated as absent. Barcode and detail reads raise the catalog not-found error, which the HTTP route maps to 404. This includes ambiguous legacy CSV nutrition, invalid or unsupported native input sets, missing calories, explicit no-nutrition declarations, unsupported barcodes, and any future unavailable reason not explicitly admitted. OFF is not registered as a search provider; Search food remains USDA-only. The immutable generation still retains projected product records and exclusion counters for diagnostics and reimport analysis.

The legacy/CSV decisions follow the [OFF field definitions](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/html/data-fields.txt), [explicit nutrition input-set units](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/lib/ProductOpener/Nutrition.pm), and [configurable CSV exporter](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/lib/ProductOpener/Export.pm), inspected September 8, 2026. The explicit input-set format is supported by the exporter; it is **not present in the September 9 daily CSV dump**. Native arrays are present in the September 13 JSONL snapshot and follow the [native nutrition schema](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/ref/schemas/product_nutrition_v3.yaml), inspected September 13, 2026. Adding optional input-set fields to a fixture does not establish their availability in a standard downloaded dump.

## Parsing and storage

Barcode lookup first checks the exact source identifier, then tries equivalent
zero-padded 12-, 13-, and 14-digit representations for a valid GTIN. For example,
the printed UPC `643843715887` finds OFF's `0643843715887`. This follows
[GS1's leading-zero representation rules](https://www.gs1.org/edi-xml/technical-user-guide/Item_Numbers).
Significant digits and packaging indicators are preserved. Short identifiers and
invalid-check-digit manual identifiers retain exact lookup only. Review and
saving retain the stored OFF identifier; detail lookup remains exact.

The [daily exporter](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/scripts/export_database.pl) sanitizes control characters and joins fields with literal tabs; quotes are ordinary text. Its known ordered identity/date header identifies this dialect. Other projections use the configurable exporter's CSV quoting, including escaped quotes, embedded tabs and embedded newlines. The importer does not guess a dialect from product text. A changed daily header that no longer matches the known schema must be verified against the upstream exporter before support is added.

GZIP decompression and JSONL/TSV parsing stream directly into 500-product SQLite transactions. Source identity, names, brands, countries, nutrient fields, quantities/units, and dates are read only to construct the projected product needed for barcode review and saving. Raw source fields and alternate-name search data are not persisted. Each projected product is stored as a JSON record behind an indexed TEXT barcode primary key that preserves leading zeros; no OFF FTS or name index is built. Noncommercial identifiers remain in the import report/database but cannot be scanned. Repeated identifiers keep the first source row and are counted; no deduplication by name occurs. Width mismatches, malformed individual JSON documents, non-object documents, invalid identities and oversized/invalid selected fields are rejected and counted. JSONL handles UTF-8 chunk boundaries, CRLF and a final line without a newline. Native country tags are validated string arrays projected to compact text. Invalid nutrient values and unsupported units/modifiers are excluded and counted while missing optional nutrients remain unknown. An oversized individual JSONL document, invalid UTF-8, unusable archive schema, no valid products, configured stream/database limits, storage failure or corrupt/truncated GZIP is an archive failure: staging never activates. The complete compressed stream and GZIP trailer/CRC must validate before any result can activate. No data archive or generated catalog is committed.

OFF and USDA store separate job state in application metadata and separate immutable SQLite generation files under `CATALOG_DIRECTORY`. Each OFF replacement streams into a staging generation and completes its barcode-keyed product table before one provider-scoped active reference, including the validated database size, is published. Existing readers hold a generation lease until their barcode or detail operation finishes; only then is the retired file removed. New readers see the complete replacement after publication. A failed OFF job cannot activate a partial generation or change USDA/personal history, and a slow or failed OFF job cannot block a ready USDA generation from activating. Preview/save carries the reviewed OFF generation and rejects a stale review after activation, while existing Food Entry snapshots remain unchanged. Import runs in a worker, survives navigation, records imported and rejected row counts, and persists a catalog-specific outcome. Shutdown/restart marks unfinished uploads or imports interrupted and permits retry. A published handoff completes only after startup confirms the replacement file's size and OFF schema; otherwise the previous complete generation is restored. Startup accepts legacy OFF generations that still contain the former search index, but does not query that index; the next normal import replaces them with the barcode-only schema. Startup removes unreferenced UUID-named upload, staging, database, and journal artifacts without removing either provider's installed, retiring, or active-job files. Update discovery is metadata-only, as described below. Archive filename and SHA-256 identify the supplied snapshot; product modification dates are explicitly **not an official release version**.

## Resources and operations

| Setting | Default | Scope |
| --- | --- | --- |
| `OFF_CATALOG_MAX_UPLOAD_BYTES` | 16 GiB | Compressed OFF archive |
| `OFF_CATALOG_MAX_EXPANDED_BYTES` | 96 GiB | Streamed decompressed bytes only |
| `OFF_CATALOG_MAX_DATABASE_BYTES` | 32 GiB | Staged SQLite page limit |
| `OFF_CATALOG_MAX_DOCUMENT_BYTES` | 8 MiB | Individual decompressed JSONL document; exceeding it fails the archive |
| `CATALOG_MAX_UPLOAD_BYTES` | 64 MiB | USDA only |
| `CATALOG_MAX_EXPANDED_BYTES` | 256 MiB | USDA only |

The supplied September 13 JSONL archive is 12,870,197,024 compressed bytes and 81,761,895,722 expanded bytes; the defaults accommodate it without overrides. The expanded dump is never saved. Preflight requires free space for twice the database limit (staging plus SQLite transaction work) and the compressed size, or upload limit when size is unknown: up to **80 GiB free** at defaults. With the known supplied size this is about 76 GiB free. The active generation and the operator's original compressed archive already occupy disk and are reflected in available space; retain both while providing that additional reserve. SQLite enforces its own page cap and uses an 8 MiB cache and 500-product batches. The OFF worker caps its V8 old-generation heap at 512 MiB; native SQLite memory and the application thread also contribute to measured process RSS. TSV records remain capped at 2 MiB, headers at 256 KiB/1,000 columns and selected text at 2,000 characters (names/brands 500). Native input sets are bounded to 100 per document. Raise positive integer byte limits deliberately for future growth.

Persist `CATALOG_DIRECTORY` on a volume with enough free space, including the downloaded input archive and the backend's staged copy. Run only on supported Node 24. Public proxy upload limits do not apply to the loopback command API, which submits a file path rather than a request-body archive. Partial imports are not resumable. After restart, rerun the OFF terminal command with the complete archive. Food Catalogs shows whether a usable OFF catalog is installed; failure/interruption toasts are administrator-only and detailed errors stay in the terminal. Do not remove active generation files manually, and back up the application database together with `CATALOG_DIRECTORY`.

## Verification and scale

Deterministic tests exercise installation and replacement, old/new barcode/detail reads, generation leases, stale review, independent USDA/OFF success and failure, expected nutrient totals, null/zero, invalid units, ambiguous records, corruption, schema errors, limits, restart/retry, authorization, and populated migration/history compatibility. Browser coverage imports both catalogs through terminal commands at a mobile viewport, fails an OFF replacement without losing either installed catalog, deliberately reimports OFF, confirms Search food remains USDA-only, simulates scanning, changes measurements, saves nutrition, and checks missing/incomplete products and member denial.

The OFF and Foundation importer modules also accept an archive path and progress/result callback directly. Tests call these entry points with real archives and SQLite so Vitest can exercise importer behavior directly; Catalog Management and browser tests retain the native worker lifecycle. Each invocation owns its import state.

The opt-in full-archive check is separate from ordinary tests:

```sh
pnpm build
OFF_LOCAL_ARCHIVE=/home/dagd/Downloads/openfoodfacts-products.jsonl.gz \
OFF_SCALE_DIRECTORY=/path/on/a/large/disk \
pnpm exec vitest run tests/local-off-scale.test.ts
```

It seeds a small OFF generation, invokes the bundled `pnpm catalog:import:off -- PATH` command against the authenticated loopback endpoint, and replaces it with the full archive through persisted Catalog Management, measures process RSS including its worker, database size and elapsed time, and repeatedly performs old-generation OFF barcode reads plus installed USDA reads during the replacement. It then measures local OFF barcode reads against the activated full generation. The budget, established before the run, is p95 lookup below 100 ms and RSS below 1 GiB on the measured host. The opt-in scale test enforces that budget; ordinary deterministic tests contain no wall-clock assertion. The external dataset and temporary database stay outside Git; the test removes its temporary files.

### Legacy indexed JSONL benchmark (2026-09-13)

This result predates the barcode-only OFF schema and is retained only as historical import evidence. Its database size, indexing duration, and text-search measurements do not characterize current generations; rerun the opt-in benchmark for current figures.

The supplied archive completed through the unchanged bundled operator command, authenticated loopback endpoint and persisted Catalog Management in isolated storage. The host was Node 24.13.0 on Linux 7.1.9-arch1-2, Intel Core i7-13700F (24 logical CPUs), 33,338,925,056 bytes RAM and the local encrypted Linux filesystem. Defaults from the resource table were used, including the 512 MiB worker heap cap. The expanded dump was never saved. The test removed its isolated application/catalog files; the machine-readable evidence remains in ignored `reports/off-jsonl-scale.json`.

| Measurement | Result |
| --- | ---: |
| Compressed archive | 12,870,197,024 bytes |
| Expanded stream | 81,761,895,722 bytes |
| Installed SQLite | 10,498,605,056 bytes (9.78 GiB) |
| Command upload, import, indexing and validated activation | 1,917.79 seconds (31m 57.79s) |
| Peak process RSS including native worker | 396.23 MiB |
| Source records / installed products / rejected records | 4,745,990 / 4,745,915 / 75 |
| Installed products usable for calculated logging | 3,022,618 (63.69%) |
| Rejected duplicate IDs / oversized fields / invalid IDs | 61 / 13 / 1 |
| OFF barcode-plus-name read p95 before replacement | 0.858 ms |
| USDA lookup p95 during replacement | 0.820 ms |
| Prior OFF barcode-plus-name read p95 during replacement | 1.344 ms |
| OFF barcode lookup p95 after activation | 0.226 ms |
| Exact `Nutella` search p95 after activation | 24.266 ms |
| Prefix `Nutell` search p95 after activation | 27.558 ms |

Archive SHA-256: `9f6c5a19666aac27e43060268fdf0fb8d540a1474bef3f88db9b83c5bbd67d0e`; upload CRC-64/NVME: `m93WB/Opev8=`. Both established budgets passed: peak RSS below 1 GiB and every measured local p95 below 100 ms. An independent bounded scan observed 4,745,990 lines and a maximum document of 508,303 bytes, below the 8 MiB document cap.

Actual exclusion counters were:

| Reason | Events |
| --- | ---: |
| Unsupported nutrition source/preparation | 828,704 |
| Ambiguous nutrition basis | 1,473,649 |
| Unsupported nutrition authority | 40,909 |
| Conflicting nutrition bases | 52,058 |
| Invalid nutrition reference | 17,472 |
| Nutrition not provided | 4,250 |
| Unsupported nutrient unit/modifier | 34,537 |
| Calories unavailable | 72,348 |
| Invalid nutrient value | 40 |
| Unsupported barcode | 71,382 |

These counters describe records, input sets or nutrient values; a product may contribute multiple events. They are not a partition of installed products. Usable coverage counts selectable products actually stored, after deduplication.

The full generation resolves UPC `643843715887` and EAN `0643843715887` to **100% Whey Protein Powder**, Premier Protein. Its complete packaging/as-sold 41 g serving is selected alongside the compatible calorie-only 100 g set; computed calories and estimate sets do not replace declared values. Native review matches 150 kcal, 30 g protein, 4 g carbohydrate, 2 g fat, 1 g fiber, 1 g sugar and 170 mg sodium per serving. Saving one/two servings verifies 150/300 kcal and 30/60 g protein through Food Entry Service. The compact native-fixture lifecycle test also verifies the full saved two-serving snapshot: 8 g carbohydrate, 4 g fat, 2 g fiber, 2 g sugar and 340 mg sodium. Historical snapshots survive failed JSONL and successful CSV replacements.

Earlier development runs were stopped while correcting country-tag projection, native serving normalization and snapshot constraints; they are not counted as completed scale verification. Combined browser runs exposed canceled setup navigation and upload controls usable before their JavaScript handler attached. Those issues were fixed, and the completed full-archive run plus the final deterministic/browser gates passed. The measured duration is an observation on this host, not an import-time promise.

### Legacy indexed CSV benchmark (2026-09-09)

Historical CSV benchmark, measured September 9, 2026 on Node 24.13.0, Intel Core i7-13700F (24 logical CPUs), 32 GB RAM and a local encrypted Linux filesystem. The full archive replaced a small installed OFF generation while both the old OFF generation and USDA were queried:

| Measurement | Result |
| --- | --- |
| Compressed archive | 1,275,171,186 bytes |
| Expanded source | 13,042,211,705 bytes |
| Replacement import, FTS indexing, and activation elapsed | 393.82 seconds |
| Peak process RSS including worker | 369.04 MiB |
| Installed SQLite size | 9,554,251,776 bytes (8.90 GiB) |
| Source rows / installed products | 4,535,553 / 4,535,483 |
| Duplicate identifiers / oversized selected fields | 60 / 10 |
| Ambiguous basis / unsupported barcode / nutrition not provided | 4,459,866 / 70,701 / 4,976 |
| USDA lookup p95 during OFF replacement | 0.645 ms |
| Old OFF barcode-plus-name-read p95 during replacement | 1.233 ms |
| OFF barcode lookup p95 after activation | 0.814 ms |
| Exact `Nutella` FTS search p95 after activation | 28.209 ms |
| Prefix `Nutell` FTS search p95 after activation | 23.389 ms |

Archive SHA-256: `f72687ee8bc6522054fe69dbfda6b91902c16af1ec2e043cde27bc6c29ad8176`. The resource and concurrent-read latency budgets passed. All products in this particular daily dump remain unavailable for calculated logging because it lacks explicit nutrition authority; the result verifies replacement, indexed identification and failure-safe eligibility rather than usable nutrition coverage. Calculation tests use explicit source-backed export fields. The daily raw-TSV dialect preserves records containing literal quotes that a conventional quoted-CSV parse can incorrectly combine.

## Rolling export update checks

Food Catalogs checks OFF independently of USDA when opened, reuses a persisted
result for six hours, and provides **Check OFF updates again**. A failed check
is cached too. Checks cannot start an import or interrupt local lookup. The
administrator uses [OFF's official downloads page](https://world.openfoodfacts.org/data)
to download the recommended JSONL GZIP or supported tab-separated CSV GZIP externally, then imports it through the terminal command.

### Format-aware metadata discovery

Detected content format persists with each installed generation. An installation without that field is an existing CSV installation. New installations discover `https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz`; CSV installations continue to discover their CSV object. Each format follows only its corresponding exact official S3 redirect. Cached metadata for another installed format is refreshed; cross-format checksums, ETags and object dates never establish a comparison. The source snapshot format is persisted alongside validators. Filename extensions do not select nutrition/parser behavior. Settings performs HEAD requests only and never starts a download or import.

### Historical CSV metadata investigation (2026-09-09)

A `HEAD` request to the official supported export,
`https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz`,
redirected to
`https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/en.openfoodfacts.org.products.csv.gz`.
The application follows only this exact known redirect, with a five-second
budget shared by both requests. It never falls back to `GET`, range downloads,
or a product API. A changed hosting arrangement produces unavailable metadata
until reviewed.

The observed S3 response with `x-amz-checksum-mode: ENABLED` included:

- `Last-Modified: Wed, 09 Sep 2026 12:03:41 GMT`
- `Content-Type: application/gzip`, `Content-Length: 1275171186`
- `ETag: "8d6629ac4d18f33e1ddec4cd9856f19d-77"`
- `x-amz-checksum-type: FULL_OBJECT`
- `x-amz-checksum-crc64nvme: 1Oju86qC+6I=`

These are observations of a rolling object, not permanent release identifiers.
OFF describes [daily exports](https://github.com/openfoodfacts/openfoodfacts-exports)
and says it does not currently provide
[historical CSV dumps](https://support.openfoodfacts.org/help/en-gb/12-api-data-reuse/105-how-can-i-access-historical-data).
Its [field definitions](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/html/data-fields.txt)
identify `last_modified_t` as a **product** modification time; it is not the dump
version.

[S3 HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
returns object metadata without its body and documents the checksum-mode header.
[S3's checksum documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html)
distinguishes full-object checksums from composite multipart checksums. ETags,
including multipart values, are treated as opaque identity validators. They are
never parsed as hashes or ordered as versions.

### Comparison contract

The upload stream computes CRC-64/NVME in bounded memory alongside the existing
SHA-256 fingerprint. A matching detected format, full-object CRC and exact byte length associate
the upload with observed official metadata, regardless of its filename. The
checksum is an integrity association for administrator-supplied data, not a
cryptographic authenticity guarantee. Composite, missing, invalid or mismatched
checksums leave the installed official snapshot unknown. Previously imported
archives without this checksum remain unknown until deliberately reimported.
An upload performed during an outage can be matched by a later successful check.

A matching checksum or strong ETag, with matching length and no conflicting
checksum, means **no detected change**. A changed identity plus a strictly later
valid object last-modified timestamp means **newer export snapshot**. A changed
opaque validator alone, missing identity, equal or older timestamps with changed
identity, future timestamps, or conflicting evidence remains **indeterminate**.
HTTP/network failures are **unavailable**. Unknown installed snapshots cannot
claim to be current or older.

An object timestamp can describe republication; it does not establish product
freshness or a dated OFF release. Settings explains this limitation and displays
the installed snapshot, available object timestamp, installation time and last check
separately. Snapshot association, upload checksum and update-check results persist
in per-provider application management storage; the catalog database and saved
Food Entries are not rewritten by checking.
