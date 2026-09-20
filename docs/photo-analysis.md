# Plate photos

Take a JPEG, PNG, or WebP plate photo (up to 8 MB) from the Daily Log. Upload is
shown separately; after acceptance, you can navigate away or reload. The selected
date and event time are fixed when accepted. Successful analysis automatically
saves one aggregate Food Entry. Open it to inspect component references and
assumptions or choose **Correct with AI**. Corrections replace that entry while
retaining its previous totals until success. Other food-entry methods stay usable.

Each attempt has a 20-second deadline after upload. Cancel stops an attempt and
ignores late results. Failed, canceled, timed-out, or interrupted work requires an
explicit Retry; a server restart never reruns lost work. New unsuccessful meals
contribute no nutrition. There is no lifetime correction quota.

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
catalog from **Settings → Food Catalogs**.
The default subscription path is Pi's `openai-codex` provider, model
`gpt-5.6-luna`, reasoning `low`. An `OPENAI_API_KEY` is a separately billed API
credential and does not authenticate a Codex subscription.

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

These provider settings are staged for the later runtime cutover and do not change
the active Pi analyzer in this expand step. The legacy Pi authorization UI is no
longer shown on this page; the existing auth file remains untouched and active.

Pi stores renewable credentials in `auth.json` and refreshes them during model
requests. In Docker the default path is `/app/data/pi/auth.json`, inside the
existing persistent volume. Pi creates the directory and file with private
permissions. Keep them writable by the service user. Do not bake credentials into
an image or commit them. An existing operator-provisioned auth file continues to
work; `PHOTO_AI_AUTH_PATH` still overrides its location.

The mounted data directory must be writable by container UID 1000; provision it
using the ownership instructions in [deployment.md](deployment.md). Persist the
entire data directory across container replacements. Run one application process
per SQLite database: this feature intentionally has no distributed worker or
resumable execution system.

| Environment variable | Default |
| --- | --- |
| `PHOTO_AI_PROVIDER` | `openai-codex` |
| `PHOTO_AI_MODEL` | `gpt-5.6-luna` |
| `PHOTO_AI_REASONING` | `low` (`minimal`, `medium`, `high` also supported) |
| `PHOTO_AI_AUTH_PATH` | `data/pi/auth.json` under the working directory |
| `PHOTO_AI_USDA_ROUNDS` | `3` (range 1–5) |
| `APPLICATION_SECRETS_PATH` | `secrets` under the working directory (separate from `data`) |
| `APPLICATION_MASTER_KEY_PATH` | `application-master.key` inside `APPLICATION_SECRETS_PATH` |

The Pi SDK adapter creates no coding-agent session, shell, file tools, extension
loader, project-context discovery, or automatic compaction. Only local USDA
Foundation search and detail are exposed. Each search retrieves up to five
complete source-backed candidate records from the installed generation. Detail calls, pagination, model
turns, result size, and context are bounded. Provider configuration stays behind
the backend runtime boundary. Unavailable models or credentials produce a failed
card; they never save an unvalidated completion event as nutrition.

If no Foundation catalog is installed, or if it lacks the food or preparation
shown, analysis can still save an explicit AI estimate with a reason. It never
falls back to the USDA food API or invents an FDC identity. Evidence selected
during an analysis is captured with its nutrition and portions so a catalog
replacement cannot revise the source before validation and saving.

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

The deterministic suites use temporary migrated SQLite and simulated Pi/USDA
boundaries. The browser fixture is available only with `NODE_ENV=test` and
`PHOTO_ANALYSIS_TEST_FIXTURE=1`; it does not measure model accuracy.

The staged Gemini→Jev→USDA analyzer has its own opt-in live integration seam.
It installs a supplied Foundation archive in a temporary catalog, sends one food
image to Gemini, sends only Gemini's structured observations and installed-catalog
choices to TypeSafe, and validates the selected evidence locally under the
five-second analyzer deadline. It is not part of ordinary verification and does
not change the active Pi runtime during this expand step. Run it explicitly with
private inputs; it consumes both provider accounts:

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

The installed Pi 0.85.1 registry includes `gpt-5.6-luna` with image support.
Account access was verified with operator-provided Pi OAuth credentials. A
historical smoke test on September 5, 2026, before local Foundation evidence was
introduced, used the public
[Hamburger (5) photograph](https://commons.wikimedia.org/wiki/File:Hamburger_(5).jpg)
by cyclonebill (CC BY-SA 2.0), the default Luna model, and the former API-backed
USDA evidence reader.
The final implementation saved an initial estimate of 930 kcal in 16.46 seconds.
A correction specifying five grams of butter replaced the same entry with
966 kcal in 12.89 seconds. Four model calls reported 18,061 total tokens; these
counts do not establish billed subscription cost. Three earlier initial trials
timed out (observed latencies 20.037, 20.029, and 20.016 seconds) before the prompt
was tightened to request compact results. These tuning trials are not a
representative latency distribution or verification of the current local reader.

This is one unweighed photo and one correction, with no reference nutrition.
The accuracy sample size is zero; the below-20% calorie-error goal remains
unmeasured. The smoke report confirms food-evidence tool calls, but does not establish
which returned references were used. Deterministic tests separately verify
authoritative USDA arithmetic and explicit fallback behavior. A representative
weighed-meal pilot is still required to evaluate accuracy and latency distributions.

Create a private JSON dataset with simple foods, mixed dishes, branded foods,
preparation differences, and hidden fats. Paths are relative to the dataset:

```json
[
  {
    "name": "Weighed meal identifier",
    "photoPath": "meal.jpg",
    "mimeType": "image/jpeg",
    "energyKcal": 500,
    "proteinGrams": 30,
    "carbohydrateGrams": 60,
    "fatGrams": 16,
    "corrections": ["There are 5 grams of butter already mixed into the rice"]
  }
]
```

Use measured reference nutrition for the full consumed meal, rather than the
illustrative numbers above. Reference nutrition fields may be omitted for an
unweighed smoke test; its accuracy metrics remain unknown. Run explicitly; this sends the images to the account's
configured provider and consumes that account's usage:

```sh
PHOTO_AI_AUTH_PATH=/private/pi/auth.json \
PHOTO_PILOT_DATASET=/private/meals/dataset.json \
PHOTO_PILOT_REPORT=/private/meals/report.json \
PHOTO_PILOT_USDA_ARCHIVE=/private/usda/FoodData_Central_foundation_food_csv.zip \
pnpm test:photo-live
```

The report records sample size, individual initial calorie percentage errors,
signed macro errors, elapsed time, failures, successive correction outcomes,
correction counts, and provider-reported token usage. It counts usable results
within 20 seconds and whether more than half of meals have initial calorie error
below 20%. Keep reports private. Provider token usage does not establish remaining
subscription quota or a billed cost. Publish the actual distribution and sample
size if evaluating the goal; neither deterministic fixtures nor an unrun pilot
are evidence that the goal was achieved.

## Mobile feedback verification

Photo capture is available alongside search, barcode, and manual entry in **Add
Food**, labeled **Take photo · AI calories**. Choosing a photo returns to the
Daily Log immediately, which shows upload progress, analysis progress, or an
explicit failure. Non-food results retain the photo and retry controls without
creating a Food Entry. JPEG signature validation permits trailing camera metadata
after the end-of-image marker.

A pre-cutover live smoke test on 2026-09-06 used Pi/Codex Luna and two public
JPEGs: [a dog portrait by Pittigrilli, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Close-up_portrait_of_dog.jpg)
was rejected as non-food in 3.13 seconds, while [a Pepsi can](https://commons.wikimedia.org/wiki/File:2019-02-26_12_58_50_A_can_of_Pepsi_in_the_Dulles_section_of_Sterling,_Loudoun_County,_Virginia.jpg)
was accepted in 17.42 seconds. This checks rejection and successful processing,
not nutritional accuracy. It predates the local Foundation evidence workflow
and is not current cutover verification. The photos are not committed to this
repository.

For mobile previews, use a compiled release with its own build directory and the
local HTTPS proxy configuration in [deployment.md](deployment.md). Sharing Vite
dependency caches with builds or tests caused stale module URLs and prevented
the browser from hydrating during an earlier development preview.

Primary references: [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md),
[Pi authentication](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md),
[USDA Foundation downloads](https://fdc.nal.usda.gov/download-datasets/).
