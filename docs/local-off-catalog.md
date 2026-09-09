# Local Open Food Facts installation and replacement

Administrators install or replace OFF independently in **Settings → Food Catalogs**. Download the official tab-separated product CSV GZIP from [Open Food Facts](https://world.openfoodfacts.org/data), then upload it to the OFF card. The same control accepts a newer archive or a deliberate reimport of the current archive. USDA can be absent, importing, failing, or remain in use throughout this operation. Barcode scanning, manual barcode entry, product search, review, and saving use the local OFF database; no OFF API configuration or network fallback is used. OFF data is licensed under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

## Nutrition authority and current export limitation

The standard daily export **does not identify whether its `_100g` values describe 100 g or 100 ml**. The supplied September 2026 file also omits explicit per-serving nutrients and normalized serving units. Its products are retained for identification/review but cannot support calculated logging. Neither the package quantity, free-text serving size, food category, nor the ambiguous legacy `nutrition_data_per=100g` is used to guess a basis. No density is inferred and package size never becomes a serving.

Source-backed calculation is supported when a supplied OFF CSV includes either:

- Direct legacy `*_serving` fields: one serving is the authority, with no conversion to mass or volume. Nutrients use the units defined by OFF: grams, kcal for `energy-kcal`, and kJ for `energy-kj`/`energy`.
- The official configurable CSV export's explicit `nutrition.input_sets.packaging.as_sold.<per>.nutrients.<nutrient>.value`, `.unit`, and optional `.modifier` fields. Exactly one populated basis, `100g`, `100ml`, or `serving`, is accepted. Only packaging values for the product as sold are used. Conflicting bases, prepared data, inferred/estimated sets, unknown units, and qualified values are not substituted for source authority. Supported nutrient units are g/mg and kcal/kJ. Kilojoules convert using 4.184 kJ/kcal; results use the existing fixed-point snapshot rounding.

For a mass or volume authority, 1 and 100 units are offered. A serving is offered only with a positive `serving_quantity` and explicit `serving_quantity_unit` matching that authority. This provides a measure in the same dimension, never a density conversion. Missing nutrients stay null; explicit zero stays zero. Missing/invalid calories, ambiguous/conflicting bases and an explicit no-nutrition flag have separate calculation-unavailable reasons. Existing one-serving snapshots retain their quantities, nutrition, supported measures, edits and copies without source lookup.

These decisions follow the [OFF field definitions](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/html/data-fields.txt), [explicit nutrition input-set units](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/lib/ProductOpener/Nutrition.pm), and [configurable CSV exporter](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/lib/ProductOpener/Export.pm), inspected September 8, 2026. The explicit input-set format is supported by the exporter; it is **not present in the supplied daily dump**. Adding optional input-set fields to a fixture does not establish their availability in a standard downloaded dump.

## Parsing and storage

The [daily exporter](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/scripts/export_database.pl) sanitizes control characters and joins fields with literal tabs; quotes are ordinary text. Its known ordered identity/date header identifies this dialect. Other projections use the configurable exporter's CSV quoting, including escaped quotes, embedded tabs and embedded newlines. The importer does not guess a dialect from product text. A changed daily header that no longer matches the known schema must be verified against the upstream exporter before support is added.

GZIP decompression and TSV parsing stream directly into 500-product SQLite transactions. Only identity, selected display/English/Spanish names and aliases, brands, countries, required nutrient fields, quantities/units and source dates are retained. An indexed TEXT primary key preserves leading-zero identifiers. A separate FTS5 index covers the displayed name, supported alternate names and brand, using the same accent/case normalization and bounded prefix-query rules as USDA search. Noncommercial identifiers remain in the import report/database but cannot be scanned. Repeated identifiers keep the first source row and are counted; no deduplication by name occurs. Width mismatches and oversized selected fields are rejected and counted. No data archive or generated catalog is committed.

OFF and USDA store separate job state in application metadata and separate immutable SQLite generation files under `CATALOG_DIRECTORY`. Each OFF replacement streams into a staging generation and completes its barcode/name indexes before one provider-scoped active reference, including the validated database size, is published. Existing readers hold a generation lease until their barcode, detail, or search operation finishes; only then is the retired file removed. New readers see the complete replacement after publication. A failed OFF job cannot activate a partial generation or change USDA/personal history, and a slow or failed OFF job cannot block a ready USDA generation from activating. Preview/save carries the reviewed OFF generation and rejects a stale review after activation, while existing Food Entry snapshots remain unchanged. Import runs in a worker, survives navigation, records imported and rejected row counts, and persists a catalog-specific outcome. Shutdown/restart marks unfinished uploads or imports interrupted and permits retry. A published handoff completes only after startup confirms the replacement file's size and OFF schema; otherwise the previous complete generation is restored. Startup removes unreferenced UUID-named upload, staging, database, and journal artifacts without removing either provider's installed, retiring, or active-job files. Update discovery belongs to a later ticket. Archive filename and SHA-256 identify the supplied snapshot; product modification dates are explicitly **not an official release version**.

## Resources and operations

| Setting | Default | Scope |
| --- | --- | --- |
| `OFF_CATALOG_MAX_UPLOAD_BYTES` | 4 GiB | Compressed OFF upload |
| `OFF_CATALOG_MAX_EXPANDED_BYTES` | 32 GiB | Streamed decompressed bytes and staged SQLite size cap |
| `CATALOG_MAX_UPLOAD_BYTES` | 64 MiB | USDA only |
| `CATALOG_MAX_EXPANDED_BYTES` | 256 MiB | USDA only |

The preflight reserves currently available space for one expanded-data limit for the streamed staged database and the compressed upload size (or upload limit if unknown): up to **36 GiB free** at the defaults for either initial installation or replacement. The current generation already consumes filesystem capacity and is reflected in the available-space reading, so it is not counted a second time; its exact size is persisted for handoff recovery. A volume holding the measured 8.89 GiB current catalog therefore needs about 44.89 GiB total capacity before proxy buffering, other application data, or filesystem overhead to retain it while providing the 36 GiB replacement reserve. This check reserves capacity; it does not allocate that amount. The uncompressed export is never written to disk. SQLite uses an 8 MiB page cache; an individual parsed record is capped at 2 MiB, headers at 256 KiB/1,000 columns, and selected text fields at 2,000 characters (names/brands 500). Resource-limit failures, insufficient storage, incompatible schemas and corrupt archives have different errors; row rejections appear in the report.

Persist `CATALOG_DIRECTORY` on a volume with enough free space. Run only on supported Node 24. The HTTP host allows up to two hours to receive a request. For reverse proxies, allow at least the configured compressed limit, disable request buffering where practical, and allow upload/read timeouts appropriate to the connection. Buffered proxies need additional temporary disk space. For example, Nginx deployments can set `client_max_body_size 4g`, `proxy_request_buffering off`, and suitable `client_body_timeout`/`proxy_read_timeout`; apply equivalent controls on the actual proxy. A partial upload is not resumable. After restart, open **Settings → Food Catalogs**. An interrupted job shows **Retry Open Food Facts installation**; select the archive again. The page states whether the previous generation remains active or no usable OFF catalog is installed. Do not remove active generation files manually, and back up the application database together with `CATALOG_DIRECTORY`.

## Verification and scale

Deterministic tests exercise installation and replacement, old/new barcode/detail/search reads, generation leases, stale review, independent USDA/OFF success and failure, expected nutrient totals, null/zero, invalid units, ambiguous records, corruption, schema errors, limits, restart/retry, authorization, and populated migration/history compatibility. Browser coverage uploads both catalogs at a mobile viewport, fails an OFF replacement without losing either installed catalog, deliberately reimports OFF, simulates scanning, changes measurements, saves nutrition, and checks missing/incomplete products and member denial.

The OFF and Foundation importer modules also accept an archive path and progress/result callback directly. Tests call these entry points with real archives and SQLite so Vitest and mutation testing can observe importer behavior; Catalog Management and browser tests retain the native worker lifecycle. Each invocation owns its import state.

The opt-in full-archive check is separate from ordinary tests:

```sh
OFF_LOCAL_ARCHIVE=/path/to/en.openfoodfacts.org.products.csv.gz \
OFF_SCALE_DIRECTORY=/path/on/a/large/disk \
pnpm exec vitest run tests/local-off-scale.test.ts
```

It seeds a small OFF generation, replaces it with the full archive through Catalog Management, measures process RSS including its worker, database size and elapsed time, and repeatedly performs old-generation OFF barcode/name reads plus installed USDA reads during the replacement. It then measures local OFF barcode reads and representative product, brand, and multi-word FTS searches against the activated full generation. The budget, established before the run, is p95 lookup below 100 ms and RSS below 1 GiB on the measured host. Search timings are recorded without a flaky ordinary-test threshold. The external dataset and temporary database stay outside Git; the test removes its temporary files.

Measured September 9, 2026 on Node 24.13.0, Intel Core i7-13700F (24 logical CPUs), 32 GB RAM and a local encrypted Linux filesystem. The full archive replaced a small installed OFF generation while both the old OFF generation and USDA were queried:

| Measurement | Result |
| --- | --- |
| Compressed archive | 1,275,171,186 bytes |
| Expanded source | 13,042,211,705 bytes |
| Replacement import, FTS indexing, and activation elapsed | 322.15 seconds |
| Peak process RSS including worker | 353.43 MiB |
| Installed SQLite size | 9,548,214,272 bytes (8.89 GiB) |
| Source rows / installed products | 4,535,553 / 4,535,483 |
| Duplicate identifiers / oversized selected fields | 60 / 10 |
| USDA lookup p95 during OFF replacement | 0.415 ms |
| Old OFF barcode-plus-name-read p95 during replacement | 0.790 ms |
| OFF barcode lookup p95 after activation | 0.167 ms |
| OFF representative FTS search p95 after activation | 73.778 ms |

Archive SHA-256: `f72687ee8bc6522054fe69dbfda6b91902c16af1ec2e043cde27bc6c29ad8176`. The resource and concurrent-read latency budgets passed; representative FTS search remained below 100 ms p95 as an observed benchmark rather than an ordinary test assertion. All products in this particular daily dump remain unavailable for calculated logging because it lacks explicit nutrition authority; the result verifies replacement, indexed identification and failure-safe eligibility rather than usable nutrition coverage. Calculation tests use explicit source-backed export fields. The daily raw-TSV dialect preserves records containing literal quotes that a conventional quoted-CSV parse can incorrectly combine.
