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
   persisted catalog outcomes.
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
setup. Follow the [README terminal workflow](../README.md#install-food-catalogs-from-the-terminal)
to download supported official archives, build the command artifacts, start the
application, and install them from server/container-visible regular files.
USDA accepts the official Foundation **CSV ZIP**; Open Food Facts accepts the
official product **JSONL GZIP** (recommended for serving nutrition) or supported **tab-separated CSV GZIP**. Browser archive requests are rejected.
Either source can be installed first, and the same command deliberately replaces
or reimports a source independently. A missing source is identified in search.

Application upgrades run database migrations before readiness. Existing USDA and
OFF Food Entry snapshots remain viewable, editable with their saved measurements,
and copyable even before catalogs are installed or when an old source record is
absent. Use the same terminal commands after upgrading.

Progress, lifecycle phases, counters and detailed errors stay in the terminal.
Food Catalogs shows installed information and metadata-only update checks, with
no upload controls, progress or import reports. Activation occurs only after the
new database and indexes validate; readers keep using the prior complete
generation until the handoff. The command waits for the backend's persisted
terminal outcome; zero means successful activation, while failure/interruption
and command/connection errors return nonzero. Backend work does not depend on the
terminal remaining connected after acceptance.

All connected signed-in administrators and members receive source-specific
installed/updated toasts on any page. Failures and interruptions are visible only
to administrators. Toasts disappear after six seconds, pause while hovered or
focused, and can be dismissed manually. Each browser tab remembers displayed
outcomes across navigation and reload. Another client's dismissal or shared
acknowledgement cannot suppress success delivery. Polling retries quietly after
connection failures and checks on focus/reconnection. Anonymous clients receive
no notifications; members cannot read private operator diagnostics or use
management/acknowledgement mutations. Food Catalogs remains administrator-only.

## Capacity and archive limits

| Setting | Default | Purpose |
| --- | ---: | --- |
| `CATALOG_MAX_UPLOAD_BYTES` | 64 MiB | USDA compressed archive limit |
| `CATALOG_MAX_EXPANDED_BYTES` | 256 MiB | USDA extracted tables and staged database limit |
| `OFF_CATALOG_MAX_UPLOAD_BYTES` | 16 GiB | OFF compressed archive limit |
| `OFF_CATALOG_MAX_EXPANDED_BYTES` | 96 GiB | OFF decompressed stream limit |
| `OFF_CATALOG_MAX_DATABASE_BYTES` | 32 GiB | OFF staged SQLite page limit |
| `OFF_CATALOG_MAX_DOCUMENT_BYTES` | 8 MiB | Individual JSONL document limit |

At the defaults, a USDA import can require up to 576 MiB free. An OFF import
reserves up to 80 GiB beyond storage already occupied by the current generation.
During replacement, retain capacity for the application database, current
catalog, staged catalog, a staged compressed archive and the operator's downloaded
file, plus filesystem overhead. The downloaded input can consume additional space
on the same volume before preflight runs. The local API sends only a file path;
public reverse-proxy upload limits do not apply. The configuration names retain
`UPLOAD_BYTES` for compatibility, limiting server-side archive staging too. See
the [USDA guide](local-usda-catalog.md#operations-and-verification) and
[OFF guide](local-off-catalog.md#resources-and-operations) for detailed limits.

## Recovery and updates

On restart, an unfinished pre-activation job becomes **interrupted**, partial
artifacts are removed, and the previous active generation stays available. If
publication had started, recovery validates the candidate's recorded size,
provider schema, indexes, and SQLite integrity before completing the handoff;
otherwise it restores the prior complete generation. Rerun the source-specific terminal command with the complete archive. Partial
imports are not resumable. Do not rename or delete UUID-named catalog files by
hand.

Update discovery is independent and metadata-only. USDA checks its official
Foundation release declaration and archive headers. OFF checks the known daily
export object's headers and full-object checksum. Unavailable, contradictory,
or incomparable metadata is reported as uncertain and never blocks command
installation or local lookup. The administrator still downloads and imports
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
