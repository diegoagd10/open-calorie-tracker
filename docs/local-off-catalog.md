# Local Open Food Facts installation

Administrators install OFF independently in **Settings → Food Catalogs**. Download the official tab-separated product CSV GZIP from [Open Food Facts](https://world.openfoodfacts.org/data), then upload it to the OFF card. USDA can be absent or remain in use throughout this operation. Barcode scanning, manual barcode entry, product review and saving use the local OFF database; no OFF API configuration or network fallback is used. OFF data is licensed under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

## Nutrition authority and current export limitation

The standard daily export **does not identify whether its `_100g` values describe 100 g or 100 ml**. The supplied September 2026 file also omits explicit per-serving nutrients and normalized serving units. Its products are retained for identification/review but cannot support calculated logging. Neither the package quantity, free-text serving size, food category, nor the ambiguous legacy `nutrition_data_per=100g` is used to guess a basis. No density is inferred and package size never becomes a serving.

Source-backed calculation is supported when a supplied OFF CSV includes either:

- Direct legacy `*_serving` fields: one serving is the authority, with no conversion to mass or volume. Nutrients use the units defined by OFF: grams, kcal for `energy-kcal`, and kJ for `energy-kj`/`energy`.
- The official configurable CSV export's explicit `nutrition.input_sets.packaging.as_sold.<per>.nutrients.<nutrient>.value`, `.unit`, and optional `.modifier` fields. Exactly one populated basis, `100g`, `100ml`, or `serving`, is accepted. Only packaging values for the product as sold are used. Conflicting bases, prepared data, inferred/estimated sets, unknown units, and qualified values are not substituted for source authority. Supported nutrient units are g/mg and kcal/kJ. Kilojoules convert using 4.184 kJ/kcal; results use the existing fixed-point snapshot rounding.

For a mass or volume authority, 1 and 100 units are offered. A serving is offered only with a positive `serving_quantity` and explicit `serving_quantity_unit` matching that authority. This provides a measure in the same dimension, never a density conversion. Missing nutrients stay null; explicit zero stays zero. Missing/invalid calories, ambiguous/conflicting bases and an explicit no-nutrition flag have separate calculation-unavailable reasons. Existing one-serving snapshots retain their quantities, nutrition, supported measures, edits and copies without source lookup.

These decisions follow the [OFF field definitions](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/html/data-fields.txt), [explicit nutrition input-set units](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/lib/ProductOpener/Nutrition.pm), and [configurable CSV exporter](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/lib/ProductOpener/Export.pm), inspected September 8, 2026. The explicit input-set format is supported by the exporter; it is **not present in the supplied daily dump**. Adding optional input-set fields to a fixture does not establish their availability in a standard downloaded dump.

## Parsing and storage

The [daily exporter](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/scripts/export_database.pl) sanitizes control characters and joins fields with literal tabs; quotes are ordinary text. Its known ordered identity/date header identifies this dialect. Other projections use the configurable exporter's CSV quoting, including escaped quotes, embedded tabs and embedded newlines. The importer does not guess a dialect from product text. A changed daily header that no longer matches the known schema must be verified against the upstream exporter before support is added.

GZIP decompression and TSV parsing stream directly into 500-product SQLite transactions. Only identity, names, brands, countries, required nutrient fields, quantities/units and source dates are retained. An indexed TEXT primary key preserves leading-zero identifiers. Noncommercial identifiers remain in the import report/database but cannot be scanned. Repeated identifiers keep the first source row and are counted; no deduplication by name occurs. Width mismatches and oversized selected fields are rejected and counted. No data archive or generated catalog is committed.

OFF and USDA store separate job state in application metadata and separate immutable SQLite generation files under `CATALOG_DIRECTORY`. A failed OFF job cannot activate a partial generation or change USDA/personal history. Import runs in a worker, survives navigation, and records a durable result. Shutdown/restart marks unfinished work interrupted and permits retry. Initial installation only: replacement/update checks belong to later tickets. Archive filename and SHA-256 identify the supplied snapshot; product modification dates are explicitly **not an official release version**.

## Resources and operations

| Setting | Default | Scope |
| --- | --- | --- |
| `OFF_CATALOG_MAX_UPLOAD_BYTES` | 4 GiB | Compressed OFF upload |
| `OFF_CATALOG_MAX_EXPANDED_BYTES` | 32 GiB | Streamed decompressed bytes and staged SQLite size cap |
| `CATALOG_MAX_UPLOAD_BYTES` | 64 MiB | USDA only |
| `CATALOG_MAX_EXPANDED_BYTES` | 256 MiB | USDA only |

The existing conservative preflight reserves twice the expanded limit plus compressed upload size (or upload limit if unknown): up to **68 GiB free** at OFF defaults. This reserves capacity; it does not allocate that amount. The uncompressed export is never written to disk. SQLite uses an 8 MiB page cache; an individual parsed record is capped at 2 MiB, headers at 256 KiB/1,000 columns, and selected text fields at 2,000 characters (names/brands 500). Resource-limit failures, insufficient storage, incompatible schemas and corrupt archives have different errors; row rejections appear in the report.

Persist `CATALOG_DIRECTORY` on a volume with enough free space. Run only on supported Node 24. The HTTP host allows up to two hours to receive a request. For reverse proxies, allow at least the configured compressed limit, disable request buffering where practical, and allow upload/read timeouts appropriate to the connection. Buffered proxies need additional temporary disk space. For example, Nginx deployments can set `client_max_body_size 4g`, `proxy_request_buffering off`, and suitable `client_body_timeout`/`proxy_read_timeout`; apply equivalent controls on the actual proxy. A partial upload is not resumable. Do not remove active generation files manually.

## Verification and scale

Deterministic tests exercise installation, barcode/detail lookup, independent expected nutrient totals, null/zero, invalid units, ambiguous records, corruption, schema errors, limits, restart/retry, authorization, and populated migration/history compatibility. Browser coverage uploads both catalogs at a mobile viewport, simulates scanning, manually enters barcodes, changes measurements, saves nutrition, and checks missing/incomplete products and member denial.

The opt-in full-archive check is separate from ordinary tests:

```sh
OFF_LOCAL_ARCHIVE=/path/to/en.openfoodfacts.org.products.csv.gz \
OFF_SCALE_DIRECTORY=/path/on/a/large/disk \
pnpm exec vitest run tests/local-off-scale.test.ts
```

It imports through Catalog Management, measures process RSS including its worker, database size and elapsed time, repeatedly reads installed USDA foods during OFF import, and measures local OFF barcode reads. The budget, established before the run, is p95 lookup below 100 ms and RSS below 1 GiB on the measured host. The external dataset and temporary database stay outside Git; the test removes its temporary files.
