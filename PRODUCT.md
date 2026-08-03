# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary User is an individual recording and reviewing their own food intake on a self-hosted instance. The User is also the instance operator: they own the data, retained images, credentials, backups, and privacy decisions. Optional Nutrition estimates are limited to the supported general adult scope of age 19 and older.

## Product Purpose

Calories is an open-source personal food and nutrition tracker. It helps a User record food by local calendar date, review calories and nutrients for the day, correct historical entries, and reuse confirmed Foods and Meals. Success means fast everyday logging without hiding uncertainty, inventing missing nutrition, silently applying AI output, or rewriting historical records when reusable definitions change.

## Positioning

The product is day-first and confirmation-first: the User opens on the current Daily log, while external food data and AI output remain editable Food candidates until explicit confirmation. Confirmed Food entries retain immutable Nutritional snapshots, so the User can keep a trustworthy history even when a provider record or reusable Food changes later.

## Operating Context

- The first-use workflow is the current day's Daily log, with navigation to past and future dates through the User's configured Timezone.
- The primary areas are `Log`, `Food Database`, and `Saved Foods`.
- `Add Food` offers exactly `Food Database`, `Scan Food`, and `Saved Foods` as capture paths.
- `Scan Food` supports `Food`, `Barcode`, and `Food Label` modes. Barcode and label results use the shared Food Detail and Review flow.
- The User can create reusable Foods and one-unit Meals, favorite reusable items, attach retained Food images, and export or delete their data.
- The supported production deployment is Docker Compose. SQLite data, retained Food images, and exports live below a host-mounted `DATA_DIR`; technical logs go to container output and secrets come from deployment environment configuration.
- Backups and restores are operator-controlled workflows over the complete `DATA_DIR`. Upgrades require an explicit backup, stop, migration, and new-image start sequence.

## Capabilities and Constraints

- The application is single-user in v1. It has no authentication, authorization, synchronization, multi-user model, automatic cloud backup, or app-managed TLS.
- Food entries are historical records with an immutable Nutritional snapshot. Editing or deleting a reusable Food or Meal must not rewrite existing entries; editing an existing entry affects only that entry.
- Calories and the declared quantity basis are required for a confirmed Food. Other nutrient values are optional and remain unknown when unavailable; unknown values are not represented as known zero, although Daily summary arithmetic may contribute them as zero with a missing-data warning.
- Quantities support decimals and fractions, normalize to a readable fraction representation, and scale declared Food or Meal units. Meal nutrition is the sum of confirmed Food ingredients scaled by their quantities; a Meal has no separate yield or servings-produced domain field.
- Daily summaries use a fixed nutrient order: Calories, Protein, Total carbohydrates, Fat, Fiber, Added sugar, Total sugar, Saturated fat, and Sodium. Calculations retain full precision and round only final displayed values.
- Manual Food creation is available. Barcode, external lookup, Food Label, and AI results are candidates or review drafts until the User confirms them. No provider or AI result may silently log, save, edit, or create a persisted domain record.
- Barcode lookup distinguishes invalid, not found, incomplete or conflicting data, temporary unavailability, and unexpected failures. Retry is offered only for retryable backend or upstream availability failures; other failures preserve a manual fallback where appropriate.
- Image analysis may identify visible or confidently identifiable ingredients and propose natural-unit portions. The User may edit or remove ingredients, request an AI edit proposal, and must explicitly confirm every proposal before it becomes a Food, Meal ingredient, or Food entry.
- External food-data providers and AI providers are replaceable adapters. Provider credentials remain server-side and technical troubleshooting logs must exclude API keys, environment values, images, prompts, raw provider responses, and sensitive nutrition data by default.
- Optional Nutrition estimates are for adults 19+ with explicit age, equation sex category, height, weight, and activity level. The supported activity choices are `Inactive`, `Low active`, `Active`, and `Very active`.
- Nutrition plans are `Lose`, `Maintain`, or `Gain`. Generated estimates and plan targets are proposals until the User confirms them; manual targets remain available. No active progress evaluation exists without a confirmed or manually entered target.
- Generated references use the specified adult general-nutrition policies: protein `1.2–1.6 g/kg/day` with separate `0.8 g/kg/day` adequacy context, carbohydrates `45–65%`, total fat `20–35%`, fiber minimum `14 g/1,000 kcal`, saturated fat below `10%` of calories, sodium below `2,300 mg/day`, informational total sugar, and `50 g` added-sugar label context. These are not medical advice or automatic prescriptions.
- The optional FDA Label reference profile is comparison context only and never becomes a personal target by default. Generated estimates and confirmed targets retain their source edition, reference-profile version, model version, and input values; later reference updates do not rewrite history.
- The target architecture is TypeScript with ESM, Express 5, HTMX, SQLite, Drizzle ORM, and explicit versioned migrations. The current repository is an earlier JavaScript/Express/HTMX prototype and is not yet the complete target application.
- The supported self-hosting boundary keeps the application on configurable internal HTTP. An optional reverse proxy owns HTTPS, certificates, domains, and public exposure.

## Brand Commitments

- The working product name is `Calories`; no final public brand identity or logo asset has been established.
- All visible product UI copy is English.
- The product specification commits to a minimal, simple, calm, dark-first experience that is focused and non-judgmental rather than gamified or shame-based.
- Direct action language and visible uncertainty are required. The product must not imply medical diagnosis, treatment, individualized clinical advice, government endorsement, or certainty beyond its data.

## Evidence on Hand

- `.scratch/calorie-tracker/product-spec.md` is the confirmed implementation specification and was approved as authoritative for this product record.
- `.scratch/calorie-tracker/spec.md` records the decision map and links the resolved domain and technical decisions.
- `CONTEXT.md` defines the domain language and model boundaries, including Daily logs, Food entries, Nutritional snapshots, Meals, Favorites, Nutrition references, and targets.
- `.scratch/calorie-tracker/design/ux-daily-log-and-entry-flows.md` contains the existing English dark-first interaction brief and required UI states; it is visual reference, not a replacement for product truth.
- `.scratch/calorie-tracker/research/` contains the source research for food-data quality, nutrition references, calorie estimation, and weight-change modeling.
- The current prototype in `src/server.js` and `public/` provides Open Food Facts barcode lookup through an Express/HTMX surface. `src/extract-ingredients.js` provides a separate OpenAI image ingredient-extraction CLI with a non-food result.
- No testimonials, customer evidence, commercial claims, or final brand assets are present. Future work must not fabricate them.

## Product Principles

1. Keep the User in control of uncertain data: candidates, estimates, and AI proposals require explicit review and confirmation.
2. Preserve historical truth: logged snapshots remain stable when reusable Foods, Meals, providers, or reference profiles change.
3. Make data quality visible: distinguish unknown nutrients, source limitations, reference types, and retryable failures instead of hiding them.
4. Support everyday logging without judgment: prioritize a clear day-first workflow and neutral, direction-specific language over gamification or shame.
5. Respect self-hosting ownership: keep credentials and sensitive diagnostics private, make data export and deletion explicit, and keep operational recovery understandable.

## Accessibility & Inclusion

- The web interface must be responsive, usable on mobile and desktop, and must not rely on hover-only interactions.
- Touch targets should be large enough for mobile use, and status must not be communicated by color alone; labels, values, units, and reference context remain visible.
- The product intentionally excludes medical, pregnancy/lactation, adolescent automatic-target, and condition-specific nutrition profiles from v1 rather than presenting unsupported guidance.
- A formal accessibility conformance target has not been specified and remains an open decision for future implementation planning.

## Open Decisions

- Final public product name, logo, and brand identity are not yet established.
- The target TypeScript/Drizzle/SQLite architecture has been selected, but the repository still contains the earlier prototype and implementation work has not yet begun for the full product.
- The formal accessibility conformance target and verification process remain undecided.
