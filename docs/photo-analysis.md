# Plate photos

Take a JPEG, PNG, or WebP plate photo (up to 8 MB) from the Daily Log. Upload is
shown separately; after acceptance, you can navigate away or reload. The selected
date and event time are fixed when accepted. Successful analysis automatically
saves one aggregate Food Entry. Open it to inspect component references and
assumptions or choose **Correct with AI**. Corrections replace that entry while
retaining its previous totals until success. Other food-entry methods stay usable.

Each attempt has a five-second deadline after upload. Cancel stops an attempt and
ignores late results. Failed, canceled, timed-out, or interrupted work requires an
explicit Retry; a server restart never reruns lost work. New unsuccessful meals
contribute no nutrition. There is no lifetime correction quota.

Before an attempt is exposed as active, it captures copies of the usable provider
credentials, selected Gemini and effective Jev models, model-specific thresholds,
and one leased Photo Analysis-capable USDA generation. Credential replacement or
deletion, configuration changes, and catalog activation affect only later
attempts. Credentials remain in memory for the active attempt and are never added
to attempt diagnostics. The catalog lease stays held through both Jev stages and
evidence validation. Every correction and explicit retry captures a fresh lease;
it never resumes interrupted work or silently reuses a previous match.

Photos, application-relevant USDA evidence, correction text, and result revisions
are private SQLite records. Deleting a Food Entry (or an unsuccessful photo card)
cascades to its photo and history. Account deletion does the same. Database
backups remain subject to the operator's retention policy. Images are sent to the
configured AI provider; deleting local data does not promise provider-side deletion.
For staged Gemini/Jev attempts, each revision retains the concrete models,
thresholds, validated category and product choices, confidence, selected
probability, at most five top candidates per choice, fallback reason, and the
captured Foundation evidence used for validation. Failed attempts retain the
model and threshold snapshot available before provider work. This diagnostic
history follows the meal owner's access boundary and is not returned by the
ordinary meal endpoint or administrator credential settings. Provider payloads,
hidden reasoning, credentials, authorization headers, local secret paths, and
image bytes are not part of matching diagnostics. Legacy revisions remain
readable and are labeled when detailed provenance is unavailable. Do not publish
the database or auth file.

## Operator setup

Each installation supplies its own AI account and installs a USDA Foundation
catalog from **Settings → Food Catalogs**. Production Photo Analysis sends the
plate image to Gemini, uses TypeSafe Jev for constrained category and product
choices, and validates the chosen Foundation evidence locally.

On a local installation, sign in as the application administrator and open
**Settings → AI photo estimates**. Enter the Gemini and TypeSafe API keys as one
pair. Both are validated before the application atomically replaces the encrypted
shared bundle; saved keys are never displayed again. Settings then discovers the
models available to those credentials without returning either key to the browser.

Choose a supported Gemini model and a concrete Jev version from the searchable
selectors. Free-text model identifiers cannot be saved. Category and product
confidence thresholds range from `0.0` through `1.0` and are stored separately for
each Jev version. `0.0` accepts any non-`none` choice regardless of distribution
ambiguity; higher values require a more concentrated probability distribution.
If either Jev decision is below its threshold, that component uses its Gemini
estimate. New Jev versions begin at `0.0` and are marked uncalibrated. A saved
selection that later becomes unavailable remains selected and makes new Photo
Analysis configuration unready instead of switching silently.

**New-attempt readiness** on that page combines the encrypted credential pair,
current model discovery and selections, and the active USDA Foundation
generation. Missing or unreadable credentials, unavailable selected models, a
missing catalog, a legacy catalog that needs reimport, or corrupt/unavailable
catalog data blocks new starts, corrections, and retries before provider dispatch
or persistence. Administrators receive a settings destination. Regular members
see only a short non-sensitive unavailable message. Search, barcode, manual entry,
saved meals, and already-running attempts remain usable.

The mounted data directory must be writable by container UID 1000; provision it
using the ownership instructions in [deployment.md](deployment.md). Persist the
entire data directory across container replacements. Run one application process
per SQLite database: this feature intentionally has no distributed worker or
resumable execution system.

| Environment variable | Default |
| --- | --- |
| `APPLICATION_SECRETS_PATH` | `secrets` under the working directory (separate from `data`) |
| `APPLICATION_MASTER_KEY_PATH` | `application-master.key` inside `APPLICATION_SECRETS_PATH` |

Provider configuration stays behind the backend runtime boundary. Gemini and Jev
requests use the captured generic API credentials and concrete model identifiers;
there is no coding-agent session, shell, file tool, extension loader, or project
context. The whole attempt, including readiness capture, has a five-second
deadline. Unavailable models, credentials, or catalogs reject the request before
an attempt card is stored and never save an unvalidated completion as nutrition.

An AI-capable Foundation catalog must be active before an attempt starts. If that
catalog lacks the food or preparation shown, analysis can still save an explicit
Gemini estimate with a reason. It never falls back to the USDA food API or invents
an FDC identity. Evidence selected during an analysis is captured with its
nutrition and portions so a catalog replacement cannot revise the source before
validation and saving.

USDA-backed values are derived from retrieved authoritative records and the
component quantity. An explicit AI supplement is required for a missing mandatory
nutrient. Optional unknown nutrients stay unknown. The consumed fraction is
applied once. Structured overlap checks reject duplicate component IDs/names and
prepared-dish ingredient overlap; identifying semantic overlap still depends on
the model and user corrections.

The normal meal details deliberately summarize rather than dump diagnostics. A
USDA-backed component shows `USDA Foundation` and its captured FDC identity. A
Gemini-backed component shows the concise fallback explanation, including `none`,
below-threshold category or product decisions, inadequate candidates, or missing
defensible grams. Mixed meals show the source independently for every component.

## Verification and live pilot

The deterministic suites use temporary migrated SQLite and simulated Gemini,
Jev, and USDA
boundaries. The browser fixture is available only with `NODE_ENV=test` and
`PHOTO_ANALYSIS_TEST_FIXTURE=1`; it does not measure model accuracy.

The staged Gemini→Jev→USDA analyzer has its own opt-in live integration seam.
It installs a supplied Foundation archive in a temporary catalog, sends one food
image to Gemini, sends only Gemini's structured observations and installed-catalog
choices to TypeSafe, and validates the selected evidence locally under the
five-second analyzer deadline. It is not part of ordinary verification. Run it
explicitly with private inputs; it consumes both provider accounts:

```sh
GEMINI_API_KEY=... \
TYPESAFE_API_KEY=... \
PHOTO_GEMINI_JEV_USDA_ARCHIVE=/private/usda/FoodData_Central_foundation_food_csv.zip \
PHOTO_GEMINI_JEV_FOOD_IMAGE=/private/meals/food.jpg \
PHOTO_GEMINI_JEV_FOOD_MIME_TYPE=image/jpeg \
pnpm test:gemini-jev-live
```

The live seam does not write credentials, provider payloads, images, or results to
the repository. Deterministic tests cover no-food, mixed USDA/Gemini provenance,
strict provider schemas, malformed choices, catalog readiness, and deadline
cancellation without external network access.

A representative weighed-meal pilot is still required to evaluate nutrition
accuracy and latency distributions. Keep any images, reference nutrition,
credentials, and generated reports private. Neither deterministic fixtures nor
an unrun pilot are evidence that an accuracy target was achieved.

## Mobile feedback verification

Photo capture is available alongside search, barcode, and manual entry in **Add
Food**, labeled **Take photo · AI calories**. Choosing a photo returns to the
Daily Log immediately, which shows upload progress, analysis progress, or an
explicit failure. Non-food results retain the photo and retry controls without
creating a Food Entry. JPEG signature validation permits trailing camera metadata
after the end-of-image marker.

For mobile previews, use a compiled release with its own build directory and the
local HTTPS proxy configuration in [deployment.md](deployment.md). Sharing Vite
dependency caches with builds or tests caused stale module URLs and prevented
the browser from hydrating during an earlier development preview.

Primary reference: [USDA Foundation downloads](https://fdc.nal.usda.gov/download-datasets/).
