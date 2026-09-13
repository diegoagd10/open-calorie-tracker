# Food catalog installation and operations

Open Calory Tracker uses local reference catalogs for every food lookup. It
does not need USDA or Open Food Facts API credentials and never falls back to a
food lookup API. The separate AI connection remains required only for photo
analysis. Entering **Settings → Food Catalogs** may perform small official
metadata checks; those checks do not download food records or install data.

## Storage model

A persistent installation contains three independent SQLite databases:

1. The application database stores accounts, Food Entries, photo records,
   catalog job state, active-generation references, update checks, and
   administrator notifications.
2. The active USDA generation stores imported Foundation foods and its search
   index.
3. The active Open Food Facts generation stores imported products and its
   barcode/name indexes.

The catalog generation files and temporary import files live in
`CATALOG_DIRECTORY`, which defaults to `catalogs/` beside the application
database. Persist and back up the application database and this directory
together. Replacing a catalog does not rewrite Food Entries: saved nutrition,
measurement, provider ID (`usda-fdc` or `open-food-facts`), upstream ID, and
source attribution remain in each historical entry.

## Initial installation and upgrades

For a fresh deployment, claim the administrator account and complete nutrition
setup, then open **Settings → Food Catalogs**. Download each archive in the
browser from its linked official source and upload it to the matching card:

- USDA accepts the official Foundation **CSV ZIP**.
- Open Food Facts accepts the official product **JSONL GZIP** (recommended) and the supported existing **tab-separated CSV GZIP** dialects.
- Operators can bypass public proxy upload limits by placing an archive in a
  container-visible regular file and running `pnpm catalog:import:usda -- PATH`
  or `pnpm catalog:import:off -- PATH`. These commands use the same installation
  lifecycle as the settings page and wait for its persisted terminal outcome.

The application never reads a user's Downloads folder and does not download an
archive on the administrator's behalf. Either catalog can be installed first.
Search and saved entries continue to work with only one installed catalog; the
missing source is identified in the search UI.

An application upgrade runs application-database migrations before the server
becomes ready. Existing USDA and OFF Food Entry snapshots remain viewable,
editable with their saved measurements, and copyable even before catalogs are
installed or when their old upstream record is absent. After upgrading, use the
same Food Catalogs UI to install or replace each local generation independently.

Upload and import continue after navigation. The card reports received bytes,
validation/import/indexing/activation phases, processed records, installed and
rejected food counts, and exclusion reasons. Activation occurs only after the
new database and indexes validate; readers keep using the prior complete
generation until the handoff. Persistent in-app outcomes identify USDA or OFF
separately and remain available to administrators after navigation, reload, and
restart. Administrators receive a brief toast at the top of the page when an
unseen outcome is detected. Toasts disappear after six seconds, pause while
hovered or focused, and can be dismissed manually. Dismissed outcomes do not
reappear on navigation or reload in that browser tab; dismissal does not mark
the outcome as acknowledged for other administrators. Installation details
remain in **Settings → Food Catalogs**. Regular members may search and log
foods but server authorization and
CSRF protection deny catalog reads or mutations in Settings.

## Capacity and proxy limits

| Setting | Default | Purpose |
| --- | ---: | --- |
| `CATALOG_MAX_UPLOAD_BYTES` | 64 MiB | USDA compressed upload limit |
| `CATALOG_MAX_EXPANDED_BYTES` | 256 MiB | USDA extracted tables and staged database limit |
| `OFF_CATALOG_MAX_UPLOAD_BYTES` | 16 GiB | OFF compressed upload limit |
| `OFF_CATALOG_MAX_EXPANDED_BYTES` | 96 GiB | OFF decompressed stream limit |
| `OFF_CATALOG_MAX_DATABASE_BYTES` | 32 GiB | OFF staged SQLite page limit |
| `OFF_CATALOG_MAX_DOCUMENT_BYTES` | 8 MiB | Individual JSONL document limit |

At the defaults, a USDA import can require up to 576 MiB free. An OFF import
reserves up to 80 GiB beyond storage already occupied by the current generation.
During replacement, retain capacity for the application database, current
catalog, staged catalog, compressed upload, proxy buffering, and filesystem
overhead. Configure the reverse proxy to accept at least the chosen compressed
limit, allow the two-hour application upload timeout, and disable request
buffering when practical. The detailed calculations and Nginx examples are in
the [USDA guide](local-usda-catalog.md#operations-and-verification) and
[OFF guide](local-off-catalog.md#resources-and-operations).

## Recovery and updates

On restart, an unfinished pre-activation job becomes **interrupted**, partial
artifacts are removed, and the previous active generation stays available. If
publication had started, recovery validates the candidate's recorded size,
provider schema, indexes, and SQLite integrity before completing the handoff;
otherwise it restores the prior complete generation. Open Food Catalogs and
choose the same archive again with the source-specific retry action. Partial
uploads are not resumable. Do not rename or delete UUID-named catalog files by
hand.

Update discovery is independent and metadata-only. USDA checks its official
Foundation release declaration and archive headers. OFF checks the known daily
export object's headers and full-object checksum. Unavailable, contradictory,
or incomparable metadata is reported as uncertain and never blocks manual
installation or local lookup. The administrator still downloads and uploads
every replacement deliberately.

## Coverage, units, and attribution

USDA Foundation supplies basic foods only; this scope does not silently add
Branded, Survey/FNDDS, or SR Legacy datasets. Search covers explicit aliases for
tilapia, egg/eggs/huevo/huevos, broccoli, carrots, spinach, tomatoes, lettuce,
and zucchini while preserving raw, cooked, frozen, and other preparation
distinctions as separate source records.

The standard OFF daily dump identifies products but does not establish whether
its `_100g` nutrition describes mass or volume, and the validated September
2026 archive lacks authoritative serving fields. Those products remain useful
for search, barcode review, and source identification but are deliberately
unavailable for calculated logging. The application does not guess density,
convert package size into a serving, or retrieve missing facts from an API.

USDA records are attributed to USDA FoodData Central. OFF products retain Open
Food Facts attribution and are subject to the [Open Database
License](https://opendatacommons.org/licenses/odbl/1-0/). Provider IDs and
source dates remain visible in saved history after replacement.

## Reproducible performance verification

The development-machine budget is p95 below **100 ms** for representative local
ingredient searches/details, exact product searches, product-prefix searches,
and barcode lookups, including reads while OFF is being replaced. Peak process
RSS during either full import must remain below **1 GiB**. These wall-clock
budgets run only in opt-in scale tests, never in the ordinary deterministic
suite:

```sh
USDA_LOCAL_ARCHIVE=/absolute/path/to/Foundation.zip \
  pnpm exec vitest run tests/local-usda-scale.test.ts

OFF_LOCAL_ARCHIVE=/home/dagd/Downloads/openfoodfacts-products.jsonl.gz \
  pnpm exec vitest run tests/local-off-scale.test.ts
```

The scale inputs stay outside Git. The source-specific guides record the tested
archive fingerprints, hardware, import/reject counts, reasons, elapsed time,
memory, resulting database size, and measured lookup latency.
