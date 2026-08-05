# Daily Intake Implementation Plan

**Status:** Ready for implementation
**Audience:** An AI implementation agent working in this repository
**Product:** Daily Intake
**Primary user:** One person tracking personal nutrition, hydration, and weight

## 1. Problem

The current application records one-off food names and calorie values for a
date. That is not enough for the intended daily nutrition workflow. The user
needs to:

- Track calories, protein, carbohydrates, fat, fiber, sugar, and sodium.
- Track water independently from food.
- Define daily intake limits and minimums.
- Reuse manually created food products instead of re-entering nutrition data.
- Review calculated nutrition before adding food to a date.
- Preserve historical food records even when a reusable product changes or is
  deleted.
- Track weight over time and optionally compare it with a target weight.

The product must remain simple. Manual entry is the MVP. Future barcode lookup,
nutrition-label extraction, and AI image analysis must have a clean extension
seam, but must not complicate the current user flow.

## 2. Product Goal

Create a local, single-user nutrition ledger in which the user can configure
daily targets, record food from a reusable serving-based database, record
water, review daily status, and follow weight progress over time.

The primary workflow is:

```text
First visit: Targets -> Daily Log
Normal food entry: Daily Log -> Food Database -> product -> quantity/review -> dated snapshot
Water entry: Daily Log -> add ounces, glass, or bottle
Weight entry: Settings -> Weight -> dated weight history
```

## 3. Scope

### In Scope

- A required first-run setup for daily food and water targets.
- A Daily Log home page for today and past dates.
- A dedicated Food Database page.
- Manually creating, searching, editing, and deleting reusable food products.
- One product measurement type in the MVP: `serving`.
- A free-text serving description such as `2 slices`, `100 g`, or `1 cup`.
- Decimal nutrition values per serving.
- Selecting a product, entering a serving quantity, reviewing calculated
  nutrition, and confirming a log entry.
- Independent historical food snapshots.
- Editing or deleting individual food log entries.
- Daily totals and target status for all tracked nutrition metrics.
- Water stored in fluid ounces with glass and bottle helpers.
- Weight records in pounds, one canonical value per date.
- A weight trend chart with an optional current target line.
- Sidebar navigation with Food Database and Settings.
- Repository, business-logic, API, and UI behavior tests.
- A source-neutral product draft seam for future import providers.

### Out of Scope

- Authentication, accounts, multiple users, roles, or permissions.
- Cloud sync, remote hosting, sharing, or cross-device synchronization.
- Barcode scanning.
- Nutrition-label file upload or OCR.
- AI image analysis.
- Favorite Foods.
- Automatic product parsing or unit conversion.
- Selectable product measurements such as slice, gram, ounce, piece, or cup.
- Recipes, meals, meal planning, shopping lists, or food recommendations.
- Exercise tracking or energy expenditure calculations.
- Reminders, notifications, or scheduled prompts.
- Medical advice or automatic personalized target recommendations.
- Saturated-fat and trans-fat tracking.
- Future-date food or water logging.
- Automatic merging of repeated food log entries.
- Rewriting historical logs when a product or target changes.
- A target weight requirement during first-run setup.

The UI must not show disabled Favorites or Scan choices in the MVP. Future
sources belong behind an application seam, not in the current add-food path.

## 4. Product Vocabulary And Invariants

- **Product:** A reusable food definition in the Food Database.
- **Serving:** The only product measurement type in the MVP.
- **Serving description:** Manual text explaining what one serving means, for
  example `2 slices` or `100 g`. The MVP stores this text and does not parse it.
- **Food log entry:** One consumption event attached to one date.
- **Food snapshot:** The product title, serving description, and nutrition data
  copied into a food log entry at confirmation time.
- **Target version:** A set of daily limits/minimums effective from a date.
- **Selected date:** The date currently being reviewed or edited in the Daily
  Log. It may be today or a past date, never a future date in the MVP.

These invariants are mandatory:

- A product edit affects future food logs only.
- A product deletion affects future selection only.
- Existing food log snapshots remain readable after product edit or deletion.
- Adding the same product twice creates two independent food log entries.
- Food and water are separate entities and separate persistence paths.
- Weight is a dated history, not a food or water entry.
- Daily target changes do not re-evaluate past dates with current values.
- Target weight is optional and is not required to use the Daily Log.

## 5. Domain Model

The exact TypeScript names may vary, but the implementation must preserve these
boundaries and fields.

### 5.1 FoodProduct

One active or retired reusable product:

- `id`
- `name`
- `servingDescription`
- `caloriesPerServingCal`
- `proteinPerServingG`
- `carbsPerServingG`
- `fatPerServingG`
- `fiberPerServingG`
- `sugarPerServingG`
- `sodiumPerServingMg`
- `status` or equivalent active/retired state
- `createdAt`
- `updatedAt`

Validation:

- `name` is required after trimming.
- `servingDescription` is required after trimming.
- Every nutrition value is finite and non-negative.
- Decimal values are accepted and preserved.
- `cal` is the user-facing energy label. Do not render `kcal`.

### 5.2 FoodLogEntry

One independent consumption snapshot:

- `id`
- `date` in `YYYY-MM-DD` format
- nullable `productId` for provenance only; logs must not depend on a live
  product record
- `titleSnapshot`
- `servingDescriptionSnapshot`
- `quantity` in servings, greater than zero
- `caloriesPerServingSnapshotCal`
- `proteinPerServingSnapshotG`
- `carbsPerServingSnapshotG`
- `fatPerServingSnapshotG`
- `fiberPerServingSnapshotG`
- `sugarPerServingSnapshotG`
- `sodiumPerServingSnapshotMg`
- `createdAt`
- `updatedAt`

Displayed totals are calculated as the snapshot per-serving value multiplied by
`quantity`. The stored snapshot must not be read from the current product when
the log is displayed.

When a log entry is edited, its title, serving description, quantity, and
snapshot nutrition values are editable. The edit must affect only that entry.
Changing quantity must recalculate displayed totals from that entry's saved
per-serving snapshot; changing snapshot nutrition values changes future totals
for that entry only.

### 5.3 DailyTargetVersion

One effective-dated target configuration:

- `effectiveDate`
- `calorieMaximumCal`
- `proteinMinimumG`
- `carbsMaximumG`
- `fiberMaximumG`
- `sugarMaximumG`
- `sodiumMaximumMg`
- `waterMinimumFlOz`
- `fatRule`, fixed to a 30% calorie maximum in the MVP
- `createdAt`
- `updatedAt`

There is no manually entered fat gram target in the MVP. The fat limit is
derived from the calorie maximum:

```text
fatLimitG = calorieMaximumCal * 0.30 / 9
```

Use the exact derived value for comparisons and round only for display. The UI
must label it as a fat limit, not as an ideal or medical recommendation.

### 5.4 WaterDay

One daily hydration total:

- `date`
- `totalFluidOz`
- `updatedAt`

The stored value is fluid ounces. The UI derives glasses using:

```text
glasses = totalFluidOz / 8
```

The bottle helper adds `16 fl oz`, equivalent to two glasses.

### 5.5 WeightEntry

One canonical weight per date:

- `date`
- `weightLb`
- `updatedAt`

Writing a weight for an existing date replaces that date's value. It does not
append another same-day reading.

### 5.6 UserSettings

The minimum settings record contains:

- nullable `targetWeightLb`
- `updatedAt`

The target weight is one current value. Historical target-weight versions are
not required.

## 6. Business Rules

### 6.1 Date Rules

- The Daily Log defaults to the local current date.
- The user may select today or any past date.
- Future dates are rejected by the domain/API and unavailable in the UI.
- Food, water, and target lookup use the same selected date.
- Store dates as `YYYY-MM-DD`; do not use server timezone timestamps for the
  calendar date.

### 6.2 Nutrition Scaling

For every nutrient:

```text
logged total = snapshot per-serving value * serving quantity
```

The quantity accepts positive decimals such as `0.5` or `1.5`. The review
screen must show the calculated values before confirmation. Display rounding
must not change stored or comparison values.

### 6.3 Target Status

The selected date uses the target version with the greatest
`effectiveDate <= selectedDate`.

- Calories: maximum; current value `<=` target is within the limit, current
  value `>` target is exceeded.
- Carbohydrates: maximum; current value `<=` target is within the limit,
  current value `>` target is exceeded.
- Fiber: maximum; current value `<=` target is within the limit, current value
  `>` target is exceeded.
- Sugar: maximum; current value `<=` target is within the limit, current value
  `>` target is exceeded.
- Sodium: maximum; current value `<=` target is within the limit, current value
  `>` target is exceeded.
- Protein: minimum; current value `>=` target is met, current value `<` target
  is below target.
- Water: minimum; current value `>=` target is met, current value `<` target is
  below target.
- Fat: maximum derived from the selected target version's calorie maximum;
  current value `<=` derived limit is within the limit.

The UI may use concise labels such as `within limit`, `exceeded`, `met`, and
`below target`. It must not call a user-configured threshold medically safe or
unsafe.

### 6.4 Target Versioning

- First-run setup creates the first target version effective on the current
  date.
- Updating targets creates a new version effective on the current date by
  default.
- Past dates continue using the version that was effective on those dates.
- A target update must not rewrite previous target versions.
- Target weight is configured separately and is optional.

### 6.5 Product Lifecycle

- Active products appear in Food Database search and selection.
- Product editing affects only future food logs.
- Product deletion removes it from future selection.
- Existing food log snapshots remain available after product deletion.
- A soft-delete/retired flag is acceptable and preferred if it preserves
  provenance, provided retired products cannot be selected for new entries.

### 6.6 Water Helpers

- `Add glass` increases the selected day's total by `8 fl oz`.
- `Add bottle` increases the selected day's total by `16 fl oz`.
- Manual water entry increases the selected day's total by the entered positive
  fluid-ounce amount.
- The UI shows both fluid ounces and the derived glass count.

## 7. User Stories

Each story uses the required `GIVEN / WHEN / THEN` format. Acceptance criteria
are implementation checks in addition to the scenarios.

### US-01: Configure targets on first use

**As a** person starting Daily Intake
**I want** to define my daily nutrition and water targets before logging
**So that** the Daily Log can evaluate my intake from the first day.

#### Scenario: First visit requires target setup

**GIVEN** no target version exists
**WHEN** the user opens the application
**THEN** the application shows the target setup page instead of the Daily Log

#### Scenario: Save required daily targets

**GIVEN** the target setup page is open
**WHEN** the user enters calorie, protein, carbohydrate, fiber, sugar, sodium,
and water targets and saves
**THEN** the application stores a target version effective on the current date
**AND** redirects the user to the Daily Log

#### Scenario: Target weight is optional

**GIVEN** all daily food and water targets are valid
**WHEN** the user saves setup without a target weight
**THEN** setup succeeds
**AND** no target-weight line is required on the weight chart

#### Acceptance Criteria

- [ ] The first-run page requires all daily food and water target fields.
- [ ] The fat limit is shown as a read-only value derived from the calorie
      maximum.
- [ ] Target weight is not required.
- [ ] Invalid, negative, non-finite, or missing target values receive actionable
      validation messages.
- [ ] A successful save redirects to the Daily Log.
- [ ] A later visit does not show first-run setup when an active target version
      exists.

### US-02: Review today and past daily logs

**As a** person tracking intake
**I want** to open today or a past date
**So that** I can record current food and backfill missed entries.

#### Scenario: Open the Daily Log

**GIVEN** target setup is complete
**WHEN** the user opens the application
**THEN** the Daily Log opens on the local current date
**AND** it shows food totals, target status, water total, and the selected date

#### Scenario: Select a past date

**GIVEN** the Daily Log is open
**WHEN** the user selects a past date
**THEN** food entries, water, totals, and target status are loaded for that date

#### Scenario: Reject a future date

**GIVEN** the user attempts to select or submit a future date
**WHEN** the date is validated
**THEN** the application rejects the operation with actionable feedback

#### Acceptance Criteria

- [ ] The local current date is the default.
- [ ] Past dates can be reviewed and edited.
- [ ] Future dates cannot be selected for food or water logging.
- [ ] The Daily Log shows all seven food nutrient totals.
- [ ] The Daily Log shows water in fluid ounces and glasses.
- [ ] Loading, empty, and error states are explicit and accessible.

### US-03: Browse and manage the Food Database

**As a** person logging food
**I want** a reusable Food Database
**So that** I do not re-enter the same serving nutrition each time.

#### Scenario: Open Food Database from the Daily Log

**GIVEN** the Daily Log is open for a selected date
**WHEN** the user activates the add-food action
**THEN** the application navigates to the dedicated Food Database page
**AND** preserves the selected date as return context

#### Scenario: Search active products

**GIVEN** the Food Database page is open
**WHEN** the user enters a product name search
**THEN** matching active products are displayed
**AND** retired/deleted products are not selectable

#### Scenario: Edit a product

**GIVEN** an active product exists
**WHEN** the user edits and saves its serving or nutrition fields
**THEN** future food entries use the new values
**AND** existing food snapshots remain unchanged

#### Scenario: Delete a product

**GIVEN** an active product exists
**WHEN** the user deletes it
**THEN** it no longer appears as a selectable product for new entries
**AND** historical food snapshots that used it remain visible

#### Acceptance Criteria

- [ ] Food Database is a dedicated page, not a modal source picker.
- [ ] It can be reached from the Daily Log and the sidebar.
- [ ] Search is case-insensitive and trims the query.
- [ ] Create, edit, and delete operations have explicit success/error states.
- [ ] Product deletion cannot cascade-delete food log entries.
- [ ] The page stays simple; Favorites and Scan are not shown in the MVP.

### US-04: Add an existing product to a date

**As a** person recording a meal
**I want** to select a saved product and enter how many servings I consumed
**So that** the application calculates the correct nutrition for that event.

#### Scenario: Select a product

**GIVEN** the Food Database contains an active product
**WHEN** the user selects it while returning to a selected date
**THEN** the application opens the quantity and review step
**AND** initializes quantity to one serving

#### Scenario: Change serving quantity

**GIVEN** the product review step is open
**WHEN** the user changes quantity from `1` to `1.5`
**THEN** every nutrient preview is multiplied by `1.5`
**AND** the preview uses decimal values without losing precision

#### Scenario: Cancel before confirmation

**GIVEN** a product is selected but not confirmed
**WHEN** the user cancels or navigates back
**THEN** no food log entry is created

#### Acceptance Criteria

- [ ] Quantity is a positive decimal serving count.
- [ ] Quantity validation rejects zero, negative, empty, and non-finite values.
- [ ] The review shows calories, protein, carbs, fat, fiber, sugar, and sodium.
- [ ] The review uses `cal`, `g`, and `mg` labels as appropriate.
- [ ] The user must explicitly confirm before persistence.
- [ ] The selected date is preserved through the Food Database flow.

### US-05: Create a product and immediately log it

**As a** person adding a food not yet in my database
**I want** to create the serving definition and continue directly to review
**So that** product creation and today's intake entry are one uninterrupted task.

#### Scenario: Add a new food from Food Database

**GIVEN** the Food Database page is open
**WHEN** the user chooses `Add new food`
**THEN** the application shows fields for name, serving description, calories,
protein, carbs, fat, fiber, sugar, and sodium

#### Scenario: Save a valid manual product

**GIVEN** the manual product form contains a valid name, description, and
non-negative nutrition values
**WHEN** the user saves the product
**THEN** the reusable product is stored
**AND** the application continues directly to quantity and nutrition review for
the selected date

#### Scenario: Reject incomplete product data

**GIVEN** one or more required product fields are empty or invalid
**WHEN** the user submits the form
**THEN** the product is not stored
**AND** the form identifies the invalid fields with actionable feedback

#### Acceptance Criteria

- [ ] The form uses one measurement type, `serving`.
- [ ] Serving description is free text and is not parsed.
- [ ] Decimal nutrition values are accepted.
- [ ] All seven nutrition values are captured for one serving.
- [ ] Saving a product does not automatically create a food log entry.
- [ ] The user reviews quantity and calculated totals before confirmation.
- [ ] A product created from a direct catalog visit can remain in the catalog if
      no selected-date return context exists.

### US-06: Preserve independent food snapshots

**As a** person reviewing my history
**I want** each confirmed food event to remain independent
**So that** catalog changes and repeated consumption do not corrupt past data.

#### Scenario: Log the same product twice

**GIVEN** avocado has already been logged for a date
**WHEN** the user logs avocado again two hours later
**THEN** the Daily Log contains two separate entries
**AND** neither entry replaces or merges with the other

#### Scenario: Edit a product after logging it

**GIVEN** a product was logged at 200 cal per serving
**WHEN** the user edits that product to 180 cal per serving
**THEN** the existing food log still uses the 200-calorie snapshot
**AND** future logs use 180 calories

#### Acceptance Criteria

- [ ] Food log rows store copied title, description, quantity, and nutrition
      snapshot values.
- [ ] Daily totals derive from food log snapshots, not current product rows.
- [ ] Product edit and delete tests prove historical snapshots remain intact.
- [ ] Repeated products create distinct IDs and rows.
- [ ] Product deletion never cascades into snapshot deletion.

### US-07: Correct or delete an individual food log

**As a** person correcting my history
**I want** to edit or delete one logged food event
**So that** one mistake does not change the product catalog or other dates.

#### Scenario: Edit a logged snapshot

**GIVEN** a food log entry exists
**WHEN** the user changes its quantity, title/description, or nutrition snapshot
values and saves
**THEN** only that log entry changes
**AND** the selected date's totals recalculate
**AND** the reusable product remains unchanged

#### Scenario: Delete a logged snapshot

**GIVEN** a food log entry exists
**WHEN** the user confirms deletion
**THEN** that entry is removed
**AND** other food entries and the reusable product remain unchanged
**AND** the selected date's totals recalculate

#### Acceptance Criteria

- [ ] Quantity, title/description, and all nutrient snapshot values can be
      edited.
- [ ] Quantity remains positive and nutrient values remain non-negative and
      finite.
- [ ] Delete requires explicit confirmation or an equivalent reversible action.
- [ ] Edit/delete behavior is scoped to one log ID.
- [ ] Empty-log and post-delete states are clear.

### US-08: Record water separately from food

**As a** person tracking hydration
**I want** fast ways to add water to a date
**So that** hydration does not require creating a fake food product.

#### Scenario: Add one glass

**GIVEN** the Daily Log is open
**WHEN** the user activates `Add glass`
**THEN** the selected date's water total increases by `8 fl oz`
**AND** the UI updates the glass count

#### Scenario: Add one bottle

**GIVEN** the Daily Log is open
**WHEN** the user activates `Add bottle`
**THEN** the selected date's water total increases by `16 fl oz`
**AND** the UI displays the equivalent of two glasses added

#### Scenario: Add a manual amount

**GIVEN** the Daily Log is open
**WHEN** the user enters a positive fluid-ounce amount and submits it
**THEN** the selected date's water total increases by that amount
**AND** the stored water value remains independent of food entries

#### Acceptance Criteria

- [ ] Water has a separate persistence entity and API/repository seam.
- [ ] The stored unit is fluid ounces.
- [ ] The UI displays fluid ounces and `totalFluidOz / 8` glasses.
- [ ] Glass and bottle helpers are present on the Daily Log.
- [ ] Manual amounts reject zero, negative, non-finite, and malformed values.
- [ ] Water totals load correctly for past dates.

### US-09: Evaluate intake against metric-specific targets

**As a** person monitoring nutrition
**I want** each metric evaluated according to its own rule
**So that** exceeding a limit is not confused with failing to meet a minimum.

#### Scenario: Maximum metric is within limit

**GIVEN** the calorie maximum is 1600 cal
**WHEN** the selected date totals 1200 cal
**THEN** calories are shown as within the limit

#### Scenario: Maximum metric is exceeded

**GIVEN** the sodium maximum is 2300 mg
**WHEN** the selected date totals 2400 mg
**THEN** sodium is shown as exceeded

#### Scenario: Minimum metric is met

**GIVEN** the protein minimum is 140 g
**WHEN** the selected date totals 140 g or more
**THEN** protein is shown as met

#### Scenario: Minimum metric is below target

**GIVEN** the water minimum is 64 fl oz
**WHEN** the selected date totals 48 fl oz
**THEN** water is shown as below target

#### Scenario: Fat limit derives from calories

**GIVEN** the calorie maximum is 1600 cal
**WHEN** target status is calculated
**THEN** the fat limit is derived as `1600 * 0.30 / 9`
**AND** the UI identifies it as a derived maximum

#### Acceptance Criteria

- [ ] All target directions are encoded as business rules, not inferred in UI
      code.
- [ ] Calories, carbs, fiber, sugar, and sodium use maximum semantics.
- [ ] Protein and water use minimum semantics.
- [ ] Fat uses the derived 30% maximum.
- [ ] Status calculations are covered by unit tests at boundary, below, and
      above values.
- [ ] Status copy avoids medical claims.

### US-10: Preserve historical target context

**As a** person reviewing a previous day
**I want** that day evaluated against the target version active at that time
**So that** changing today's target does not rewrite my history.

#### Scenario: Change a target today

**GIVEN** yesterday used a 1600-calorie maximum
**WHEN** the user changes today's maximum to 1800 calories
**THEN** yesterday still uses 1600 calories
**AND** today and future dates use 1800 calories

#### Acceptance Criteria

- [ ] Target configurations are effective-dated.
- [ ] The target resolver selects the latest version on or before a selected
      date.
- [ ] Updating targets creates a new version instead of mutating old rows.
- [ ] Historical target resolution has repository and business-logic tests.

### US-11: Track weight progress

**As a** person tracking body-weight progress
**I want** a dated weight history and optional target line
**So that** I can see whether my weight is changing, stable, or approaching my
target.

#### Scenario: Record a weight

**GIVEN** the Weight settings page is open
**WHEN** the user enters a weight in pounds for a date
**THEN** the application stores that dated weight
**AND** the progress chart includes it

#### Scenario: Replace a same-date weight

**GIVEN** a weight already exists for a date
**WHEN** the user records another weight for the same date
**THEN** the existing value is replaced
**AND** only one canonical value remains for that date

#### Scenario: Show an optional target line

**GIVEN** a target weight is configured in Settings
**WHEN** the user opens the weight progress chart
**THEN** the chart shows a horizontal target-weight line
**AND** the dated weight trend remains visible
**AND** the view shows the current distance from the target in pounds

#### Scenario: View a trend without a target

**GIVEN** no target weight is configured
**WHEN** the user opens the weight progress chart
**THEN** the chart shows the weight trend without a target line

#### Acceptance Criteria

- [ ] Weight uses pounds in input, storage, and display.
- [ ] The date is unique for weight records.
- [ ] Same-date writes replace rather than append.
- [ ] The chart orders points chronologically.
- [ ] Target weight is optional and editable under Settings.
- [ ] The target line is horizontal and absent when no target exists.
- [ ] The view shows the current weight-to-target difference when a target is
      configured.
- [ ] The ordered trend makes weight gain, loss, or maintenance visible without
      making a medical judgment.
- [ ] Weight history does not depend on food or water tables.

### US-12: Use simple navigation and accessible responsive UI

**As a** person using the tracker frequently
**I want** predictable navigation and readable controls on desktop and mobile
**So that** recording intake stays quick.

#### Scenario: Use sidebar navigation

**GIVEN** the application shell is visible
**WHEN** the user opens the sidebar
**THEN** the sidebar provides Daily Log, Food Database, and Settings
**AND** Settings exposes Targets and Weight

#### Scenario: Return from Food Database

**GIVEN** the user entered Food Database from a selected Daily Log date
**WHEN** the user cancels or completes the flow
**THEN** the application can return to the same selected date

#### Scenario: Use the application on a narrow screen

**GIVEN** the viewport is mobile width
**WHEN** the user opens the Daily Log or Food Database
**THEN** content stacks without horizontal overflow
**AND** all primary controls remain reachable and readable

#### Acceptance Criteria

- [ ] Food Database is reachable both contextually from `+` and directly from
      the sidebar.
- [ ] Weight and Targets are under Settings, not required as top-level home
      destinations.
- [ ] The MVP has no source-picker modal or disabled future-source controls.
- [ ] Keyboard focus is visible for every interactive control.
- [ ] Forms expose labels and actionable validation errors.
- [ ] Loading and status changes use appropriate live-region semantics.
- [ ] Desktop and mobile layouts preserve the existing Daily Intake visual
      language from `DESIGN.md`.

### US-13: Preserve a future source-provider seam

**As an** implementation agent adding future input providers
**I want** barcode, label, and AI results to map to one product draft contract
**So that** future integrations do not rewrite the product or log domain.

#### Scenario: Manual input creates a product draft

**GIVEN** the manual Food Database form is submitted
**WHEN** the input is valid
**THEN** it produces the same normalized product-draft shape that future
providers must produce

#### Scenario: A future provider supplies product data

**GIVEN** a future provider returns nutrition data
**WHEN** the provider is integrated
**THEN** its result can populate the product draft for user review
**AND** it cannot directly rewrite historical food snapshots

#### Acceptance Criteria

- [ ] Product creation accepts a source-neutral draft shape.
- [ ] The manual provider is the only active provider in this MVP.
- [ ] No barcode, label, or AI dependency is added to the MVP.
- [ ] Product draft review remains separate from food-log snapshot confirmation.
- [ ] Future source metadata can be added without changing the food-log
      snapshot contract.

## 8. Navigation And Screen Contract

### `/`

The Daily Log is the home page.

- Defaults to the local current date.
- Allows today and past dates.
- Shows all food nutrient totals and target status.
- Shows water total, glass count, and water helpers.
- Shows independent food log rows.
- The `+` action navigates to Food Database while preserving the selected date.

### `/foods`

The Food Database is a dedicated page.

- Search active products.
- Select an existing product to log it.
- Create a new product manually.
- Edit an existing product.
- Delete/retire a product for future selection.
- Return to the selected Daily Log date when a return context exists.

### `/settings/targets`

The Targets page edits the current daily target configuration and creates a
new effective-dated version. Fat is displayed as a derived 30% limit.

### `/settings/weight`

The Weight page records dated pounds, replaces same-date values, displays the
trend chart, and optionally edits the current target weight.

The implementation may choose different route names, but the page boundaries
and navigation behavior above are required.

## 9. Persistence And API Guidance

The application uses SQLite through the existing Node.js repository pattern.
Keep database access server-side and expose testable repository and business
logic seams.

Suggested persistence boundaries:

- `products`
- `food_log_entries`
- `daily_target_versions`
- `water_days`
- `weight_entries`
- `user_settings`

Suggested HTTP seams:

- `GET/POST/PATCH/DELETE /api/products`
- `GET/POST/PATCH/DELETE /api/food-log`
- `GET/PATCH /api/water?date=YYYY-MM-DD`
- `GET/PUT /api/targets`
- `GET/PUT /api/weights`
- `GET/PATCH /api/settings`

The exact endpoint decomposition may follow repository conventions, but each
public behavior must be independently testable.

### Existing Data Migration

The repository already contains the calorie-only `calorie_entries` model and
may contain `data/calories.db`. Do not silently discard it.

Implement a migration or compatibility path that:

- Preserves each existing calorie entry's date, name, and calories.
- Creates a legacy food snapshot when macro values are unavailable.
- Uses zero or an explicitly documented unknown representation for unavailable
  nutrients; do not invent macro values.
- Does not create a misleading reusable product unless serving data exists.
- Leaves migrated historical entries editable under the new log model.

## 10. Validation And Error Handling

The same domain validation must be used by UI, API, and repository-facing
business logic where appropriate.

- Names and serving descriptions are trimmed and required.
- Nutrition values must be finite and non-negative.
- Serving quantities must be finite and greater than zero.
- Dates must be valid `YYYY-MM-DD` values and not future dates for log/water
  operations.
- Weight must be finite and greater than zero.
- Target values must be finite and non-negative; minimum/maximum semantics are
  determined by the metric, not by the user entering a sign.
- Water additions must be finite and greater than zero.
- Malformed JSON, missing fields, invalid dates, and invalid numbers return
  actionable 4xx responses from API routes.
- Network failures show recovery copy and never leave the UI stuck in a loading
  or saving state.
- Date changes and submissions are disabled only when an operation would create
  a conflicting write or stale display.

## 11. Test Plan

Use TDD and retain the existing public seams.

### Business Logic Tests

- Product validation and trimming.
- Decimal nutrition acceptance.
- Serving quantity validation.
- Nutrient scaling for whole and fractional quantities.
- Daily nutrient aggregation across independent entries.
- Maximum and minimum target status at below, equal, and above boundaries.
- Derived fat-limit calculation.
- Effective-dated target resolution.
- Water ounce-to-glass conversion.
- Future-date rejection.

### Repository Tests

- Product create, search, update, and delete/retire.
- Food snapshot creation independent from product mutation.
- Repeated product additions create separate rows.
- Food log edit and delete are scoped to one entry.
- Daily water upsert/add behavior.
- Weight same-date replacement.
- Target version persistence and historical lookup.
- Optional target weight persistence.
- Existing calorie-entry migration.

### HTTP/API Tests

- First target configuration.
- Product CRUD validation and responses.
- Food log creation with calculated snapshot values.
- Food log edit/delete.
- Date-filtered food and water reads.
- Weight upsert and chart data response.
- Historical target resolution for a selected date.
- Malformed and invalid request handling.

### UI/Interaction Tests

- First visit routes to target setup.
- Successful target setup routes to Daily Log.
- Daily Log `+` preserves selected date when opening Food Database.
- Existing product selection reaches review.
- New product creation reaches review without an intermediate dead end.
- Quantity changes update every nutrient preview.
- Confirmation adds one independent row.
- Repeated additions remain separate.
- Water helpers update the selected date.
- Same-date weight input replaces the previous value.
- Target line appears only when configured.
- Mobile layout has no horizontal overflow.

## 12. Implementation Order

1. Replace the calorie-only domain types with product, food snapshot, target,
   water, weight, and settings types.
2. Add schema initialization/migrations while preserving existing calorie data.
3. Implement pure nutrition scaling, aggregation, target status, fat-limit,
   water conversion, and date-validation functions.
4. Implement repositories for products, food logs, target versions, water,
   weight, and settings.
5. Implement API route handlers and their tests.
6. Implement first-run target setup and effective-dated target updates.
7. Implement the Daily Log with date selection, nutrient summary, target
   status, independent food rows, and water helpers.
8. Implement the dedicated Food Database page with search, create, edit, and
   delete/retire.
9. Implement existing-product and new-product quantity/review flows.
10. Implement individual food snapshot edit/delete.
11. Implement Weight settings and the trend chart with optional target line.
12. Add the sidebar navigation and responsive/accessibility behavior.
13. Add the future source-provider interface without enabling future providers.
14. Run lint, all tests, production build, and a desktop/mobile browser pass.
15. Remove or simplify the throwaway prototype before treating the production
    flow as complete; do not promote prototype code directly into production.

## 13. Definition Of Done

- [ ] All in-scope user stories and scenarios pass.
- [ ] The first-run target setup is required, but target weight is optional.
- [ ] The Daily Log supports today and past dates only.
- [ ] Food Database is a dedicated page reachable from both required paths.
- [ ] Product serving data supports all seven nutrients and decimals.
- [ ] Product creation continues directly to quantity and review.
- [ ] Confirmed food entries are independent snapshots.
- [ ] Product changes/deletion cannot rewrite or remove historical snapshots.
- [ ] Individual food snapshots can be edited or deleted.
- [ ] Water is separate and uses fluid ounces with glass/bottle helpers.
- [ ] Target status uses the defined metric-specific rules.
- [ ] Target changes preserve historical evaluation.
- [ ] Weight history replaces same-date values and supports an optional target
      line.
- [ ] Future source adapters have a source-neutral product-draft seam but no
      future source UI or dependency is active.
- [ ] Existing calorie data is preserved through migration.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm build` passes.
- [ ] Desktop and mobile browser verification passes without horizontal
      overflow or inaccessible controls.
