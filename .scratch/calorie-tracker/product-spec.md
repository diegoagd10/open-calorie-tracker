# Spec: Calories application

Status: ready-for-agent
Labels: ready-for-agent
Type: implementation specification
Map: [Personal calorie tracker](spec.md)

## Problem Statement

The current repository is a small Express/HTMX barcode lookup and food-image ingredient-extraction prototype. It does not yet provide the product the User needs: a trustworthy, day-first food log that combines manual entry, food-data lookup, barcode scanning, food-image analysis, reusable Foods and Meals, historical nutrition snapshots, and optional nutrition targets.

The User needs to record food quickly while retaining control over uncertain data. External food records may be incomplete, AI may misidentify food or portions, and source data may change. Historical entries must therefore remain stable, optional nutrients must remain distinguishable from zero, and no AI or provider may silently create or log data.

The application is intended for one User running an open-source, self-hosted instance. The User owns the instance, its retained images, its credentials, its backups, and its privacy decisions. The first release should be understandable, dark-first, responsive, server-rendered, and suitable for daily use without requiring authentication or cloud synchronization.

## Solution

Build a minimal English-language, dark-first web application with three primary areas: `Log`, `Food Database`, and `Saved Foods`. The User can navigate a Daily log by local calendar date, add Food from the Food Database, Scan Food, or Saved Foods, review and confirm uncertain candidates, create reusable Foods and Meals, and inspect nutrient totals with explicit missing-data behavior.

The application uses TypeScript, Express, HTMX, SQLite, and Drizzle ORM. The supported production deployment is Docker Compose with a host-mounted `DATA_DIR` containing SQLite data, retained Food images, and exports. The application remains a single-user self-hosted instance without authentication, synchronization, or automatic cloud backup.

All uncertain lookup and AI results are Food candidates until the User confirms them. Confirmed Food items and Meals are reusable; Food entries are historical. Each Food entry stores an immutable Nutritional snapshot with calories, optional nutrient values, quantity basis, and the confirmed quantity used for that event. Editing a reusable Food item or Meal affects future uses only. Editing an existing Food entry affects only that entry.

The application supports optional Nutrition estimates for adults 19+. Maintenance estimates use the 2023 National Academies EER equations. Lose and Gain plans use an independently implemented and attributed dynamic energy-balance model in the style of the NIDDK Body Weight Planner. All generated targets are proposals until the User confirms them; manual targets remain available.

## User Stories

1. As a User, I want to open the application and see my current Daily log, so that I can understand today’s intake immediately.
2. As a User, I want to navigate to a previous or future calendar date, so that I can review and correct food entries for any day.
3. As a User, I want stored UTC timestamps converted through my configured Timezone, so that entries appear on the correct local calendar date and time.
4. As a User, I want the Daily log ordered newest first, so that the latest consumption is easiest to find.
5. As a User, I want to add an optional Breakfast, Lunch, Dinner, or Snack meal tag, so that I can categorize an entry without changing chronological ordering.
6. As a User, I want to edit the date, time, quantity, meal tag, and Food details of an existing Food entry, so that historical records can be corrected without changing reusable Foods or Meals.
7. As a User, I want to delete a Food entry and undo the deletion briefly, so that accidental deletions are recoverable.
8. As a User, I want to see Calories, Protein, Total carbohydrates, Fat, Fiber, Added sugar, Total sugar, Saturated fat, and Sodium in a consistent order, so that I can review my day quickly.
9. As a User, I want missing optional nutrients to show a warning instead of appearing as known zero, so that I understand the limits of my data.
10. As a User, I want missing optional nutrients to contribute zero only to Daily summary arithmetic, so that available totals remain useful without claiming false precision.
11. As a User, I want calculations to aggregate with full precision and round only final displayed values, so that totals do not accumulate rounding errors.
12. As a User, I want calories displayed as whole kcal, gram-based nutrients to one decimal place, and milligram- or microgram-based nutrients as whole units, so that values are readable and consistent.
13. As a User, I want an `Add Food` action with exactly Food Database, Scan Food, and Saved Foods choices, so that I can choose the right capture path.
14. As a User, I want to search Food Database records, so that I can find a packaged product or ingredient without scanning it.
15. As a User, I want Food Database filters for All, My Meals, My Favorites, and My Foods, so that I can narrow results to reusable items I own.
16. As a User, I want to see recent logged Foods in Food Database, so that frequently used items are fast to select.
17. As a User, I want Food Database results to open a shared Food Detail and Review surface, so that every source uses the same confirmation experience.
18. As a User, I want to choose a natural or declared unit and adjust quantity, so that nutrition recalculates for the amount I actually consumed.
19. As a User, I want to see full available nutrition and the declared quantity basis before adding a Food, so that I can judge whether the record is usable.
20. As a User, I want explicit `Add to Log` and `Save to Saved Foods` actions, so that viewing a Food never logs or saves it silently.
21. As a User, I want Scan Food to provide Food, Barcode, and Food Label modes, so that the capture intent is clear.
22. As a User, I want the scan flow to reject an image of a non-food object such as a sofa, so that invalid input is explained instead of producing invented nutrition.
23. As a User, I want barcode lookup to distinguish not found, invalid, incomplete/conflicting, temporarily unavailable, and unexpected failures, so that I know what happened.
24. As a User, I want retry offered for backend or upstream temporary unavailability, so that transient outages are recoverable.
25. As a User, I do not want retry offered for not found or invalid input, so that I am not sent through a pointless loop.
26. As a User, I want a barcode result to be a Food candidate until I review and confirm it, so that external records never log silently.
27. As a User, I want an image analysis result to list visible or confidently identifiable ingredients and editable natural-unit portions, so that I can correct the proposal.
28. As a User, I want one matching food lookup to be selected for review automatically, so that a confident result is fast while remaining editable.
29. As a User, I want multiple matching foods to be shown for selection, so that ambiguous ingredient matches are not chosen silently.
30. As a User, I want no-match ingredients to become a prefilled manual Food draft requiring calories and explicit confirmation, so that I always have a fallback.
31. As a User, I want to edit or delete individual proposed ingredients, so that an AI meal proposal reflects what I actually see and consumed.
32. As a User, I want to ask AI to propose an edit to one ingredient or the whole meal, so that AI can help without applying changes automatically.
33. As a User, I want all AI proposals to require explicit confirmation before becoming a Food item, Meal ingredient, or Food entry, so that uncertain AI output remains under my control.
34. As a User, I want failed scans to notify me and suggest manual entry or retry later when appropriate, so that I can continue working without losing context.
35. As a User, I want Saved Foods to contain reusable Foods, Favorites, and Meals, so that I can quickly reuse confirmed items.
36. As a User, I want to create a manual Food with calories and a declared quantity basis, so that I can record items unavailable from external sources.
37. As a User, I want optional nutrient values to remain unknown when I do not provide them, so that manual Foods do not invent zeros.
38. As a User, I want to create a Meal from independently captured confirmed Food ingredients, so that each ingredient retains its own portion and nutrition.
39. As a User, I want to add, edit, replace, and remove Meal ingredients, so that I can maintain the assembled Meal accurately.
40. As a User, I want Meal nutrition to equal the sum of ingredient nutrition scaled by ingredient quantities, so that the Meal total is explainable.
41. As a User, I want a Meal to represent one reusable assembled unit without a separate yield or servings-produced field, so that logging remains simple.
42. As a User, I want to log a Meal by choosing the number of Meal units consumed, so that a half or multiple Meal is easy to record.
43. As a User, I want quantity entry to accept decimals and fractions and normalize values such as `0.5` to `1/2` and `1.25` to `1 1/4`, so that portions are precise without unnecessary complexity.
44. As a User, I want edits to a saved Meal to affect future uses only, so that historical Food entries remain accurate.
45. As a User, I want to save a Food entry as a Favorite from its exact historical snapshot and quantity, so that the Favorite represents what I actually logged.
46. As a User, I want a Favorite created from a log entry to be independently editable, so that changing it never changes the historical entry.
47. As a User, I want to Favorite a confirmed Food Database result, so that I can reuse it without depending on future source corrections.
48. As a User, I want to Favorite an existing Meal without copying it, so that the Favorite remains a marker on the reusable Meal.
49. As a User, I want to remove a Favorite marker without deleting its Food or Meal, so that convenience state never destroys domain data.
50. As a User, I want to attach a Food image to the Food or Meal it helps identify, create, or correct, so that the image remains correlated with reusable data.
51. As a User, I want retained Food images to persist until I explicitly delete them, so that I can audit why a Food or Meal exists.
52. As a User, I want to configure my Timezone, so that local dates and times remain understandable while the backend stores UTC.
53. As an adult User 19+, I want an optional Nutrition estimate based on age, the equation’s sex category, height, weight, and selected activity level, so that I can receive a general starting reference.
54. As a User, I want explicit activity choices of Inactive, Low active, Active, or Very active, so that the estimate does not pretend to infer activity from unreliable data.
55. As a User, I want to choose a Nutrition plan of Lose, Maintain, or Gain, so that the estimate reflects my intention.
56. As a User, I want Maintain to use an estimated maintenance calorie baseline, so that the target is understandable.
57. As a User, I want Lose or Gain to request a target weight and target date, so that the proposed target has an explicit trajectory.
58. As a User, I want the app to propose a target using a documented dynamic energy-balance model, so that it does not apply an arbitrary fixed deficit or surplus.
59. As a User, I want to review and confirm any proposed Nutrition target, so that no calculated target becomes active silently.
60. As a User, I want manual calorie and nutrient targets available when I do not want or cannot complete an estimate, so that the estimator is optional.
61. As a User, I want generated protein references shown as a `1.2–1.6 g/kg/day` range with `0.8 g/kg/day` as a separate adequacy reference, so that the meanings are not conflated.
62. As a User, I want generated carbohydrate references shown as a `45–65%` calorie range, so that they are not presented as a universal maximum.
63. As a User, I want generated total-fat references shown as a `20–35%` calorie range, so that total fat is not confused with saturated fat.
64. As a User, I want fiber shown as a minimum of `14 g per 1,000 kcal` when a calorie target exists, so that it is not incorrectly treated as a maximum.
65. As a User, I want saturated fat shown as a general upper reference below `10%` of daily calories, so that it is distinct from total fat and not presented as medical advice.
66. As a User, I want sodium shown as a general upper reference below `2,300 mg/day` for adults 19+, so that it is useful without pretending to be a clinical limit.
67. As a User, I want total sugar and added sugar tracked separately, so that natural sugar is not incorrectly judged by an added-sugar reference.
68. As a User, I want total sugar to remain informational and added sugar’s `50 g` value to remain label-reference context, so that neither becomes an automatic personal limit.
69. As a User, I want a secondary FDA Label reference profile available as comparison context, so that standardized label values are not confused with my personal target.
70. As a User, I want no active target or progress evaluation until I confirm a Nutrition target or enter a manual target, so that no default value is treated as my goal.
71. As a User, I want to edit or disable individual generated nutrient references after confirmation, so that the profile remains under my control.
72. As a User, I want target indicators to say below minimum, within range, above range, or over upper reference, so that the app avoids diagnosis, shame, and one-day health conclusions.
73. As a User, I want generated estimates and targets to retain their source edition, reference-profile version, model version, and inputs, so that future guideline updates do not rewrite history.
74. As a User, I want the app to explain when my requested profile is outside the supported general adult scope, so that I know when to seek individualized professional guidance.
75. As a User, I want technical errors recorded for troubleshooting without exposing API keys, environment values, images, prompts, or raw provider responses, so that diagnostics do not leak secrets or private data.
76. As a User, I want to export structured data and images, so that I retain control of the information in my self-hosted instance.
77. As a User, I want deleting a reusable Food or Meal to preserve historical snapshots, so that data history is not destroyed by reusable-item cleanup.
78. As a User, I want a confirmed delete-all operation to remove records and retained images, so that I can fully clear my self-hosted data.
79. As a self-hosting User, I want Docker Compose to be the supported production deployment, so that installation is reproducible.
80. As a self-hosting User, I want SQLite data, Food images, and exports under one mounted `DATA_DIR`, so that persistent data is easy to locate and back up.
81. As a self-hosting User, I want application logs emitted to container output and secrets supplied through the deployment environment, so that operational data and credentials remain separate.
82. As a self-hosting User, I want a health check and restart policy for the local app and database, so that ordinary process failures recover without restart loops caused by external provider outages.
83. As a self-hosting User, I want to back up the complete `DATA_DIR` while the app is stopped, so that SQLite data and images remain consistent.
84. As a self-hosting User, I want an explicit upgrade sequence that backs up data, applies migrations, and starts the new image, so that schema changes are controlled and recoverable.
85. As a self-hosting User, I want HTTPS and public exposure handled by an optional reverse proxy, so that the application does not own certificate management.

## Implementation Decisions

- Use TypeScript with ESM, Node.js, Express 5, HTMX, SQLite, Drizzle ORM, and versioned Drizzle migrations. The current JavaScript prototype is a starting point to evolve, not the final architecture.
- Use Docker Compose as the canonical supported self-hosted production deployment. Direct package-manager execution is a development path.
- Keep the application server-rendered and understandable. Express routes compose domain Modules and return HTML/HTMX responses; provider SDKs and ORM models do not leak into route handlers.
- Use a composition root that wires the persistence Modules, pure calculation Module, external Adapters, image-storage Module, technical logger, and configuration. The highest user-facing seam is the application/HTTP composition boundary.
- Use a pure nutrition and Meal calculation Module with a small Interface. It scales Nutritional profiles, composes Meal totals, calculates Daily summaries, applies full-precision aggregation, and produces neutral missing-data and reference-status results without knowing Express, Drizzle, HTTP, or AI.
- Use a dedicated persistence Module backed by Drizzle. Persist reusable Food items, Meals, Meal ingredients, Food entries, Favorites, nutrition reference profiles/targets, image metadata, User settings, and exportable records as separate relational concepts.
- Persist every Food entry’s Nutritional snapshot independently from reusable Food and Meal definitions. The snapshot includes calories, optional nutrients, declared quantity basis, quantity, and the confirmed values used for that historical event. Reusable references may support navigation, but calculations never reread a source.
- Treat optional nutrient values as nullable/unknown, not zero. Summary arithmetic may contribute unknowns as zero only while attaching missing-data warnings.
- Represent Meals as one reusable assembled unit with confirmed Food ingredients and per-ingredient portions. Meal nutrition is the sum of ingredient nutrition scaled by each ingredient quantity. Do not add a yield or servings-produced domain field.
- Support decimal and fraction Quantity input with normalized fraction display. Logging a Meal scales Meal units consumed; editing a saved Meal affects future uses only.
- Model Favorites as user-owned markers. Saving a log entry as a Favorite creates an independent Food item from the exact snapshot and quantity; favoriting a database result creates an independent Food item from confirmed values; favoriting a Meal marks that Meal; unfavoriting never deletes the underlying item.
- Keep unconfirmed Food candidates and AI review drafts transient. They become Food items, Meal ingredients, or Food entries only after explicit User confirmation.
- Place each external food-data provider and configured AI provider behind a separate Adapter Interface. Translate provider-specific response shapes and failures into application-level outcomes such as not found, invalid, temporarily unavailable, and unexpected. Retry only temporary availability failures; offer manual fallback for other operational failures where appropriate.
- Use the existing Open Food Facts barcode prototype as the first provider Adapter, with selected-field requests, identifying User-Agent, incomplete-data handling, and no browser-exposed provider credentials. Future providers remain replaceable Adapters.
- Use a configured AI provider for image analysis and AI editing proposals. AI may identify visible ingredients, propose portions, suggest matches, and propose edits, but it never applies, saves, or logs without confirmation. Provider configuration is supplied by the self-hosted operator through environment values.
- Use a dedicated image-storage Module. Validate uploads, generate managed identifiers, store retained Food images as local files outside the public static directory, and store only metadata/associations in SQLite. The Module owns retrieval, export, and explicit deletion.
- Store technical troubleshooting events separately from domain data in structured container logs. Include safe categories, operation names, provider identifiers, and correlation IDs; exclude API keys, environment values, images, prompts, raw provider responses, and sensitive nutrition data by default.
- Make user-visible writes atomic inside the persistence Module. Logging a Food or Meal, saving snapshots and relationships, deleting records, and changing image metadata must either complete together or leave no partial domain state.
- Use the User’s configured Timezone to derive Daily log local dates/times from UTC timestamps. The browser timezone can seed the initial setting, but the User’s setting is authoritative.
- Offer an optional Nutrition estimate only for adults 19+ and only when age, equation sex category, height, weight, and explicit activity level are present. Do not guess missing inputs; allow manual targets instead.
- Use the 2023 National Academies EER equations as the maintenance-calorie baseline. For Lose and Gain plans, independently implement and attribute a documented dynamic energy-balance model in the style of the NIDDK Body Weight Planner. Do not copy hosted code or NIH/NIDDK branding. Treat all outputs as proposals until confirmation and preserve model/version metadata and inputs.
- After confirmation, activate supported references with per-nutrient edit/disable controls: protein `1.2–1.6 g/kg/day` with `0.8 g/kg/day` adequacy context; carbohydrates `45–65%`; total fat `20–35%`; fiber minimum `14 g/1,000 kcal`; saturated fat below `10%` of calories; sodium below `2,300 mg/day` for adults 19+; total sugar informational; added sugar `50 g` label context only.
- Keep the optional FDA Label reference profile separate from personal Nutrition targets. It is context based on a 2,000-kcal label reference and never becomes a personal default.
- Do not show active progress evaluation until a Nutrition target is User-confirmed or manually entered. Use neutral direction-specific labels and avoid medical, diagnostic, or shame-based language.
- Store reference-profile version, source edition/date, model version, and input values with every generated estimate and confirmed target. Later updates create new estimates/targets and do not silently rewrite historical targets.
- Keep the first release single-user and self-hosted with no authentication, synchronization, or multi-user data model. Preserve a clean extension seam for future authentication and multiple users without implementing them now.
- Store durable application data under a configurable host-mounted `DATA_DIR`: SQLite database, retained Food images, and generated exports. Keep technical logs in container output and secrets in deployment environment configuration outside `DATA_DIR`.
- Define Docker Compose health checks for the local application/database and a restart policy. External provider outages remain application errors and must not cause restart loops.
- Keep the application on configurable internal HTTP. Optional reverse-proxy deployment owns HTTPS, certificates, domains, and public exposure.
- Define backup as an operator-run archive of the complete `DATA_DIR` while the application is stopped. Restore replaces the complete data directory and verifies the restored instance through the health check. No automatic cloud backup is included.
- Define upgrades as backup, stop, explicit migration application, and new-image start. The application must not mutate the schema implicitly at startup; failed migrations require restoring the prior image and backup.
- Retain the UX mock archive/design brief as visual reference only. The discussion and this spec are authoritative when mocks contain stale labels or recipe/yield semantics.

## Testing Decisions

- Tests should verify observable behavior through the highest useful Module Interface and avoid asserting implementation details such as ORM query shape or private helper calls.
- Start with isolated tests. Add broader integration tests when isolated tests cannot provide confidence or when a failure exposes real persistence or request-wiring behavior.
- Test the pure calculation Module extensively: quantity scaling, Meal sums, fraction normalization, Daily summary ordering, full-precision aggregation, final display rounding, nullable nutrients and warnings, target ranges, upper references, and neutral indicator statuses.
- Test persistence Modules against temporary SQLite databases when migration, transaction, snapshot, deletion, export, or restore semantics require actual SQLite behavior. Verify that reusable-item edits do not rewrite historical snapshots.
- Test external Adapter Interfaces with deterministic fakes and fixtures. Cover candidate normalization, multiple matches, not found, invalid input, incomplete/conflicting data, temporary availability, unexpected errors, retry classification, and safe logging behavior without calling live providers in ordinary tests.
- Test the image-storage Module with temporary directories and fixtures for validation, managed names, Food/Meal association, retrieval, export, explicit deletion, and path-safety behavior.
- Test the Nutrition estimate Module with fixed adult profile inputs and versioned expected outputs. Keep dynamic weight-change model verification separate from generic macro-range tests and retain source/model metadata in test fixtures.
- Test the HTTP/HTMX composition surface with a small set of user-visible route tests: Daily log rendering, add/review/confirm flows, error states, explicit actions, and target activation. Use fake Adapters and a temporary data directory rather than live Open Food Facts or AI calls.
- The current barcode route test is prior art for server response behavior, but the final suite should control its provider boundary rather than depend on a live external service.
- Test Docker/deployment behavior at the operational boundary as needed: mounted `DATA_DIR`, migration-before-start ordering, health check, restart behavior, backup/restore, and secret/log exclusion.

## Out of Scope

- Payments, subscriptions, monetization, or proprietary hosted services.
- Authentication, authorization, synchronization, multi-user data, or cloud account infrastructure in v1.
- Native mobile applications.
- Medical diagnosis, treatment, prescriptive advice, clinical profiles, pregnancy/lactation profiles, adolescent automatic targets, or condition-specific nutrition plans.
- Automatic weight-loss or weight-gain prescriptions without the defined general estimate flow and explicit User confirmation.
- A universal protein maximum, a universal total-sugar limit, or treating label reference values as personal medical goals.
- Silent AI logging, silent AI edits, hidden-ingredient invention, or unconfirmed Food candidates becoming persisted domain records.
- Automatic cloud backups, app-managed TLS/certificate issuance, or provider credentials exposed to the browser.
- Copying the NIDDK hosted Body Weight Planner implementation, using NIH/NIDDK branding, or implying government endorsement.
- Persisting raw AI prompts/responses, raw uploaded images outside the retained Food-image decision, or API keys/environment values in logs.

## Further Notes

- The Wayfinder map contains the authoritative decision history; this document is the collapsed handoff for implementation planning.
- The visual mock archive and UX design brief are references for UI composition and states. Product decisions in this spec override stale mock language, including recipe yield/servings semantics and user-visible source labels.
- The current repository is a prototype rather than an implementation of this spec. The next step is to use `/to-tickets` to turn this spec into dependency-ordered tracer-bullet implementation tickets. Runtime implementation must wait until those tickets exist.
- The implementation should preserve the user’s current source-data policy: calories and declared quantity basis are mandatory for confirmed Foods, macros/other nutrients may be unknown, and failures notify the User while backend/upstream availability failures are the only retryable operational class.
