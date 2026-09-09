# Local USDA Foundation installation and replacement

Administrators open **Settings → Food Catalogs**, download the Foundation **CSV ZIP** from [USDA's official downloads](https://fdc.nal.usda.gov/download-datasets/), and upload it. USDA search, photo-analysis evidence, and new catalog Food Entries then use local SQLite without an API key or food API request. After installation, the same control accepts a newer archive or a deliberate reimport of the same archive. Open Food Facts replacement uses an independent lifecycle.

The application database stores installation state under the `catalog:usda-fdc` application metadata key. Each USDA generation is a separate SQLite file. The worker validates the archive, joins the CSVs, writes the database, completes FTS5, and checks integrity before the active generation reference is published in one application-database write. That reference includes the validated database size. The previous reference stays active throughout upload, validation, import, and indexing. New readers see the replacement only after publication; a reader that already acquired the previous generation may finish before its file is retired. After a restart during the published handoff, Catalog Management confirms the replacement file's size and USDA schema before retiring the previous generation. A missing, truncated, or unreadable replacement restores the previous complete generation instead of claiming success.

Lookup opens its acquired generation read-only and closes each reader after its bounded query. Food Entries continue to save their own authoritative nutrition and measurements, so replacement never rewrites history. Reviews carry a generation UUID; missing or mismatched generation identity requires another review before a local result can be saved, including when the replacement no longer contains that FDC ID. Saved entries remain viewable, editable by their saved measurements, and copyable after their source generation is retired.

Upload streams to disk with a byte limit. Compression, CSV parsing, database construction, and indexing run in a worker thread. Upload bytes, processed rows, imported foods, and rejected food records are reported separately; counted nutrient or portion exclusions remain itemized and are not mislabeled as rejected foods. No import percentage is inferred from an unknown total. Leaving Settings after upload does not cancel the worker. Progress and terminal errors persist. Startup marks work interrupted before publication and removes that job's archive, staging directory, partial database, and journal while leaving the installed generation available. Graceful shutdown uses the same interrupted outcome for uploads and imports. Failed validation, import, or activation likewise preserves the working generation and permits retry. If retiring the previous file fails after publication, the complete replacement stays active, the handoff error is exposed, competing imports remain blocked, and restart retries the idempotent retirement after confirming the replacement. Startup also removes unreferenced UUID-named upload, staging, database, and journal artifacts while protecting both providers' installed, retiring, and active-job generations; unrelated operator files are not touched. One USDA upload/import/activation may run at a time; repeated submissions are rejected while it is busy, while a completed archive may be submitted again deliberately.

## Source selection policy

Inspected the official April 30, 2026 CSV ZIP directly on September 7, 2026. The main `food.csv` contains 469 `foundation_food` records; `foundation_food.csv` contains 395. The 74 main-food IDs absent from the subtype table include 60 descriptions with a later main-table record of the same name, plus 14 without a later exact-name match. One unmatched example is pasta FDC 2758999, published April 30, 2026 (no usable tracked nutrition in this archive). This demonstrates why subtype membership alone is insufficient for selecting reference identities.

Select main-table `foundation_food` records with valid FDC ID, name, and publication date. Require the subtype table's schema but do not use it as an inclusion whitelist. Explicitly exclude agricultural acquisitions, market acquisitions, samples, and subsamples. Reject archives containing other main-table food types rather than silently treating a full or Branded archive as Foundation.

Preserve every distinct FDC ID and its publication date. Identical descriptions are not proof of identical nutrient records or a reliable replacement relationship. For example, broccoli 321900 and 747447 have different dates and nutrient fields. The archive's main table omits the documented `food_key` lineage field, and the subtype table's NDB numbers do not cover all main records. Do not merge by name, invent lineage, or discard unmatched records. Sort otherwise-equivalent search results by descending publication date, then FDC ID; retain preparation in the original description. Duplicate instances of the same FDC ID make an archive invalid. Neither 395 nor 469 is a completeness gate.

## Release checks

Opening Food Catalogs checks USDA's declared Foundation release, with successful and failed results cached for six hours; **Check USDA updates again** bypasses that cache. The check reads the official Download Datasets page, corroborates its Foundation month with the Foundation-bearing entry in USDA's update log when that page is available, and sends `HEAD` to the CSV link for its exact byte length. It never downloads an archive or starts an import. Network failure, changed page structure, contradictory metadata, or an unverified installed release leaves search and manual upload available.

Release ordering uses only USDA's explicit `M/YYYY` Foundation period. The global FoodData Central version is display/equality metadata, not a sortable Foundation version. Filenames, HTTP validators, local upload/install time, and per-food publication dates do not establish a newer release. An installed archive is associated with a checked official descriptor only after Foundation validation succeeds and its received filename and exact byte count match the descriptor captured before import. Otherwise the installed release remains unknown and the UI reports an indeterminate comparison. A same-period byte-length change is likewise indeterminate because USDA may republish corrections without declaring a newer Foundation release.

The official source evidence, observed page contract, known limitations, and full state semantics are documented in [USDA Foundation bulk-release metadata](usda-foundation-release-metadata.md).

## Nutrition and portions

[USDA field descriptions](https://fdc.nal.usda.gov/docs/Download_Field_Descriptions_Oct2020.pdf) define food nutrient amounts per 100 g, nutrient units in `nutrient.csv`, and portion gram weight as the weight of the entire stated measure. Join on source IDs, not CSV row order or nutrient display names.

Foundation energy precedence remains **2048 → 2047 → 1008** (specific Atwater, general Atwater, legacy energy); each accepted energy value must independently declare KCAL. Protein 1003, fat 1004, carbohydrate 1005, fiber 1079, and sugar 2000 require G; sodium 1093 accepts MG or G with explicit conversion. No energy is synthesized from macros or an unrecognized unit. Invalid, negative, non-finite, duplicate, or out-of-range tracked nutrient values are excluded and counted. Missing values remain null; zero stays zero. A valid lower-precedence calorie value can be used when a higher-precedence field is unavailable. Records without usable calories remain visible but cannot be logged.

All usable foods support grams and 100 g. A portion requires a positive source amount, positive gram weight, a joined named measure, and a valid source portion ID. Its label includes amount, unit, qualifiers, and gram weight. Logging one portion uses the gram weight of that entire measure; it does not divide by the measure amount or infer density. Unsupported portions are excluded without disabling a valid 100 g basis.

Archive-level failures (schema, path, checksum, compression, unusable archive, or storage failure) are distinct from counted row/value exclusions. Paths are never extracted verbatim. Only fixed table filenames are written; all archive members are streamed through size and CRC verification. Duplicate paths, symlinks, encryption, excessive entry counts, and unsafe names are rejected.

## Basic-food search

TKT-06ff03eb extends the same local USDA adapter. Imports index original descriptions alongside explicit English/Spanish aliases for eggs (egg/eggs/huevo/huevos), tilapia, broccoli (brócoli), carrots (zanahoria/zanahorias), spinach (espinaca/espinacas), tomatoes (tomate/tomates), lettuce (lechuga/lechugas), and zucchini (calabacín/calabacines). Aliases attach to the food heading, including USDA's `Fish, tilapia` and `Squash, summer, zucchini` / `Squash, summer, green, zucchini` forms. They do not attach to an overlapping word such as eggplant or a compound heading such as egg substitute or broccoli soup. Source names, dates, IDs, and nutrition are unchanged.

Search normalizes case and accents. Input is limited to 100 characters and eight word tokens, with at least one token of two or more characters. Longer tokens support prefixes; single-letter qualifiers such as Grade A are literal terms. Punctuation is tokenized away, every term is quoted, and operator words are searched literally. Queries cannot supply executable FTS syntax. At most 25 results are returned after ranking all matching candidates.

Exact normalized descriptions rank first, then exact supported aliases, then exact word matches or basic-alias prefixes, then weaker prefixes. Within a relevance tier, foods with usable calories precede unavailable foods; FTS relevance, descending publication date, and descending source ID break remaining ties deterministically. Missing macros remain unknown, and source portions are not required when the authoritative 100 g basis is usable. The UI displays each original preparation and disables records without calories. Raw, cooked, and frozen records remain separate selections.

Catalog-owned alias and ranking policy supplies metadata and criteria to the database implementation. The import worker calls that same catalog implementation to build the index; the architecture contract permits this Catalog Management → Food Catalog dependency. Older installed name-only generations remain read-only and searchable through bounded alias expansion and the same relevance policy, without reinstallation or rewriting a generation.

## Operations and verification

`CATALOG_DIRECTORY` defaults to `catalogs/` beside the application database. Persist it alongside application storage. `CATALOG_MAX_UPLOAD_BYTES` defaults to 64 MiB; `CATALOG_MAX_EXPANDED_BYTES` defaults to 256 MiB. Both are positive integer byte limits. Before receiving a Foundation archive, the application requires currently available space for twice the expanded limit (extracted tables plus the staged database) and the advertised upload size or configured upload limit. A first install or replacement at the defaults therefore requires up to 576 MiB free. The current database already consumes filesystem capacity and is reflected in the available-space reading, so it is not counted a second time; its exact size is persisted for handoff recovery. Raise limits deliberately for larger future Foundation releases. The worker also checks free space while validating. Errors leave personal history untouched.

After an application or host restart, open **Settings → Food Catalogs**. An interrupted job shows **Retry USDA Foundation installation**; select the archive again because partial uploads are not resumed. If activation had not published, the previous generation remains active. If publication occurred, startup either confirms the complete replacement and finishes retirement or restores the previous complete generation and reports that the replacement could not be confirmed. When neither file is usable, USDA is shown as not installed and a fresh upload is required. Do not rename or delete generation files manually; preserve the application database and `CATALOG_DIRECTORY` together when restoring a backup.

The bundled production worker is built by `vite.catalog.config.ts`. Deterministic integration tests submit small real-format ZIP fixtures to Catalog Management and use real temporary application/catalog databases. Browser coverage runs with `pnpm test:browser:catalog`, using the local adapter and no USDA key. Normal browser fixtures remain independent.

For a reproducible full-archive check, run `USDA_LOCAL_ARCHIVE=/absolute/path/to/Foundation.zip pnpm exec vitest run tests/local-usda-scale.test.ts`. The archive is an external developer validation input and is not shipped. The declared lookup budget is p95 below **100 ms** for sequential local searches/details with up to 25 search results on this development machine, with process RSS below **1 GiB**. The opt-in scale test enforces those bounds; ordinary deterministic tests contain no wall-clock assertion. Record import elapsed time, sampled process RSS, catalog disk size, and main-thread timer delay to assess background responsiveness.


Validation on September 7, 2026: Linux x86_64, Intel Core i7-13700F (24 logical CPUs), Node 24.13.0. Official archive SHA-256 `70457ee9d9342f43bda2010318c85f04210c689fdeb9cd2da4c513b0e8dbc655`: 978 ms import, 205 MiB sampled RSS for the Vitest process including its worker, 32 ms maximum observed 10 ms timer delay, 696,320-byte catalog, and 0.39 ms p95 search-plus-detail over 100 sequential queries. Result: 469 retained Foundation identities, 378 with usable calories, 91 without calories, 87,521 research records excluded, and 10 invalid tracked nutrient values excluded. RSS includes the test harness and application database; timings are machine-specific observations, not normal-suite assertions.

Validation of TKT-06ff03eb on September 8, 2026, on the same hardware and official archive: 992 ms import, 208 MiB sampled RSS, 45 ms maximum timer delay, 700,416-byte indexed catalog, and 0.57 ms p95 search-plus-detail over 100 lookups including Spanish aliases. A compatibility check built a name-only generation using the preceding implementation and verified alias/full-name searches through Food Catalog while its read-only file remained byte-identical. Deterministic tests cover a mixed corpus with 30 distracting soup records, unavailable calories, missing macros, preparation-specific nutrition, literal FTS operator input, and the mobile search-to-log journey.

Final cutover validation on September 9, 2026, on the same hardware and archive:
998 ms import, 233 MiB sampled RSS, 63 ms maximum timer delay, a 700,416-byte
catalog, and 0.81 ms p95 search-plus-detail across the representative
tilapia/eggs/huevos/vegetable and prefix queries. The result again retained 469
Foundation identities, with 91 unavailable for calories, 87,521 research
records excluded, and 10 invalid tracked nutrient values excluded.


## Administrator catalog notifications

The Catalog updates control remains available to administrators throughout the app,
including after leaving Settings. It lists separate USDA and Open Food Facts job
outcomes, with the archive and installed snapshot fingerprint. Success is recorded
after activation and reader handoff. Failures and interruptions describe which
snapshot was active at completion and link to that source in Food Catalogs.
Older outcomes describe historical state; the management card shows current state.

Outcomes and acknowledgements are stored in the application database, shared by all
installation administrators, and survive navigation, reload, restart, and later
imports. Acknowledged outcomes remain in the control's history. Repeated polling
and reconnects reuse the same job outcome. Recovery of a failed handoff updates
that job's outcome and makes its new result unread again. Existing terminal jobs
are included when management first opens after an upgrade. Regular members cannot
read or acknowledge these notifications. No external notification service is used.
