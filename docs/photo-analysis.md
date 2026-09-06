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
Hidden model reasoning is not persisted. Do not publish the database or auth file.

## Operator setup

Each installation supplies its own AI account and USDA FoodData Central API key.
The default subscription path is Pi's `openai-codex` provider, model
`gpt-5.6-luna`, reasoning `low`. An `OPENAI_API_KEY` is a separately billed API
credential and does not authenticate a Codex subscription.

Install the pinned dependencies on Node 24, then provision Pi interactively as
the application service user:

```sh
mkdir -p data/pi
chmod 700 data/pi
PI_CODING_AGENT_DIR="$PWD/data/pi" pnpm exec pi
# In Pi: /login, select OpenAI Codex, and complete the account's OAuth login.
chmod 600 data/pi/auth.json
```

Pi stores renewable credentials in `auth.json`. Keep that file and its directory
writable by the service user so refresh can persist credentials. Do not copy a
personal account's credentials into a public image or commit them. For headless
login, follow Pi's interactive instructions on a trusted terminal and paste the
OAuth redirect when prompted. No end-user account management is exposed by this
application.

For the container, `/app/data` is the existing persistent volume and the default
auth file is `/app/data/pi/auth.json`. With Compose, run the same pinned Pi CLI
inside a one-off service container:

```sh
docker compose run --rm -it -e PI_CODING_AGENT_DIR=/app/data/pi \
  application node node_modules/@earendil-works/pi-coding-agent/dist/cli.js
# /login, then select OpenAI Codex
```

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
| `FDC_API_KEY` | Required for USDA evidence; otherwise explicit AI estimates are permitted |

The Pi SDK adapter creates no coding-agent session, shell, file tools, extension
loader, project-context discovery, or automatic compaction. Only USDA search and
detail are exposed. Each search retrieves up to five complete candidate records,
including Foundation, Survey (FNDDS), and Branded. Detail calls, pagination, model
turns, result size, and context are bounded. Provider configuration stays behind
the backend runtime boundary. Unavailable models or credentials produce a failed
card; they never save an unvalidated completion event as nutrition.

USDA-backed values are derived from retrieved authoritative records and the
component quantity. An explicit AI supplement is required for a missing mandatory
nutrient. Optional unknown nutrients stay unknown. The consumed fraction is
applied once. Structured overlap checks reject duplicate component IDs/names and
prepared-dish ingredient overlap; identifying semantic overlap still depends on
the model and user corrections.

## Verification and live pilot

The deterministic suites use temporary migrated SQLite and simulated Pi/USDA
boundaries. The browser fixture is available only with `NODE_ENV=test` and
`PHOTO_ANALYSIS_TEST_FIXTURE=1`; it does not measure model accuracy.

The installed Pi 0.85.1 registry includes `gpt-5.6-luna` with image support.
Account access was verified with operator-provided Pi OAuth credentials. A live
smoke test on September 5, 2026 used the public
[Hamburger (5) photograph](https://commons.wikimedia.org/wiki/File:Hamburger_(5).jpg)
by cyclonebill (CC BY-SA 2.0), the default Luna model, and USDA's public `DEMO_KEY`.
The final implementation saved an initial estimate of 930 kcal in 16.46 seconds.
A correction specifying five grams of butter replaced the same entry with
966 kcal in 12.89 seconds. Four model calls reported 18,061 total tokens; these
counts do not establish billed subscription cost. Three earlier initial trials
timed out (observed latencies 20.037, 20.029, and 20.016 seconds) before the prompt
was tightened to request compact results. The first lacked a USDA key; the next
two used `DEMO_KEY`. These changing configurations are tuning trials, not a
representative latency distribution.

This is one unweighed photo and one correction, with no reference nutrition.
The accuracy sample size is zero; the below-20% calorie-error goal remains
unmeasured. The smoke report confirms USDA tool calls, but does not establish
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
FDC_API_KEY=your-key pnpm test:photo-live
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

A live smoke test on 2026-09-06 used Pi/Codex Luna with the public USDA key and
two public JPEGs: [a dog portrait by Pittigrilli, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Close-up_portrait_of_dog.jpg)
was rejected as non-food in 3.13 seconds, while [a Pepsi can](https://commons.wikimedia.org/wiki/File:2019-02-26_12_58_50_A_can_of_Pepsi_in_the_Dulles_section_of_Sterling,_Loudoun_County,_Virginia.jpg)
was accepted in 17.42 seconds. This checks rejection and successful processing,
not nutritional accuracy. The photos are not committed to this repository.

For mobile previews, use a compiled release with its own build directory and the
local HTTPS proxy configuration in [deployment.md](deployment.md). Sharing Vite
dependency caches with builds or tests caused stale module URLs and prevented
the browser from hydrating during an earlier development preview.

Primary references: [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md),
[Pi authentication](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md),
[USDA API guide](https://fdc.nal.usda.gov/api-guide/).
