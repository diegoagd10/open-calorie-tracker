# Food catalog installation and operations

Open Calory Tracker searches foods in a local USDA reference catalog. It does
not need USDA API credentials and never falls back to a food search API.
Entering **Settings → Food Catalogs** may perform small official metadata
checks; those checks do not download food records or install data.

Barcode lookup is the exception: each scanned or typed barcode, and each save of
a barcode product, is one request to the live [Open Food Facts](https://world.openfoodfacts.org)
product API (v3.5), identified by a User-Agent built from the app version and an
administrator-set contact email. Without that email, barcode lookup is disabled.
Requests time out after about five seconds and are never retried or cached;
saving re-reads the product and refuses the save if it changed since review.

## Storage model

A persistent installation contains two independent SQLite databases:

1. The application database stores accounts, Food Entries,
   catalog job state, active-generation references, update checks, persisted
   catalog outcomes, and the Open Food Facts contact email.
2. The active USDA generation stores imported Foundation foods and its search
   index.

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
USDA accepts the official Foundation **CSV ZIP**. Browser archive requests are
rejected. The same command deliberately replaces or reimports the catalog.
Missing USDA is identified in food search.

Application upgrades run database migrations before readiness. Existing USDA and
Open Food Facts Food Entry snapshots remain viewable, editable with their saved
measurements, and copyable without any catalog or Open Food Facts request. Use
the same terminal command after upgrading. Installations that imported the old
local Open Food Facts catalog can remove it with
`node scripts/remove-local-off-catalog.mjs --yes`; see
[deployment](deployment.md#remove-the-old-local-open-food-facts-catalog).

Progress, lifecycle phases, counters and detailed errors stay in the terminal.
Food Catalogs shows installed information and metadata-only update checks, with
no upload controls, progress or import reports. Activation occurs only after the
new database and its provider-specific schema validate; readers keep using the prior complete
generation until the handoff. The command waits for the backend's persisted
terminal outcome; zero means successful activation, while failure/interruption
and command/connection errors return nonzero. Backend work does not depend on the
terminal remaining connected after acceptance.

All connected signed-in administrators and members receive installed/updated
toasts on any page. Failures and interruptions are visible only
to administrators. Toasts disappear after six seconds, pause while hovered or
focused, and can be dismissed manually. Each browser profile remembers delivered
outcomes for the signed-in account across navigation, reload, and browser restart.
All outcomes accepted in one poll are recorded together, so refreshing cannot
advance through an old queue. Only the newest successful outcome is queued; a later install or replacement has a distinct identity and can notify
again. Another account or client retains independent delivery. Polling retries
quietly after connection failures and checks on focus/reconnection. Anonymous
clients receive no notifications; members cannot read private operator diagnostics
or use management/acknowledgement mutations. Food Catalogs remains
administrator-only.

## Capacity and archive limits

| Setting | Default | Purpose |
| --- | ---: | --- |
| `CATALOG_MAX_UPLOAD_BYTES` | 64 MiB | USDA compressed archive limit |
| `CATALOG_MAX_EXPANDED_BYTES` | 256 MiB | USDA extracted tables and staged database limit |

At the defaults, a USDA import can require up to 576 MiB free. During replacement, retain capacity for the application database, current
catalog, staged catalog, a staged compressed archive and the operator's downloaded
file, plus filesystem overhead. The downloaded input can consume additional space
on the same volume before preflight runs. The local API sends only a file path;
public reverse-proxy upload limits do not apply. The configuration names retain
`UPLOAD_BYTES` for compatibility, limiting server-side archive staging too. See
the [USDA guide](local-usda-catalog.md#operations-and-verification) for detailed limits.

## Recovery and updates

On restart, an unfinished pre-activation job becomes **interrupted**, partial
artifacts are removed, and the previous active generation stays available. If
publication had started, recovery validates the candidate's recorded size,
schema and SQLite integrity before completing the handoff;
otherwise it restores the prior complete generation. Rerun the terminal command with the complete archive. Partial
imports are not resumable. Do not rename or delete UUID-named catalog files by
hand.

Update discovery is metadata-only. USDA checks its official
Foundation release declaration and archive headers. Unavailable, contradictory,
or incomparable metadata is reported as uncertain and never blocks command
installation or local lookup. The administrator still downloads and imports
every replacement deliberately.

## Coverage, units, and attribution

USDA Foundation supplies basic foods only; this scope does not silently add
Branded, Survey/FNDDS, or SR Legacy datasets. Search covers explicit aliases for
tilapia, egg/eggs/huevo/huevos, broccoli, carrots, spinach, tomatoes, lettuce,
and zucchini while preserving raw, cooked, frozen, and other preparation
distinctions as separate source records.

Open Food Facts products count only nutrition declared on the packaging for the
product as sold. Estimated, prepared, and computed values are ignored; tables
that disagree on their basis make the product reviewable but unavailable for
calculated logging, and a product without usable label nutrition is reported as
not found. The application does not guess density or convert package size into a
serving.

USDA records are attributed to USDA FoodData Central. Open Food Facts products
retain Open Food Facts attribution and are subject to the [Open Database
License](https://opendatacommons.org/licenses/odbl/1-0/). Provider IDs and
source dates remain visible in saved history after replacement.

## Reproducible performance verification

The development-machine budget is p95 below **100 ms** for representative local
USDA ingredient searches/details, including reads while USDA is being replaced.
Peak process RSS during a full import must remain below **1 GiB**. These wall-clock
budgets run only in opt-in scale tests, never in the ordinary deterministic
suite:

```sh
USDA_LOCAL_ARCHIVE=/absolute/path/to/Foundation.zip \
  pnpm exec vitest run tests/local-usda-scale.test.ts
```

The scale inputs stay outside Git. The [USDA guide](local-usda-catalog.md) records the tested
archive fingerprints, hardware, import/reject counts, reasons, elapsed time,
memory, resulting database size, and measured lookup latency.
