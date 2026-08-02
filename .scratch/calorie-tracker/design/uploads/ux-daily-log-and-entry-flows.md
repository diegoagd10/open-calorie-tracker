# Calories — UX design brief

## Purpose

Design the interface for an individual calorie and nutrition tracker. The product is an open-source web application. The UI must be designed in English and must feel minimal, simple, calm, and dark-first.

This is a UI design brief only. Produce visual mocks and interaction states; do not implement application behavior, backend code, database logic, or API integrations.

## Primary mental model

The product is day-first. The first screen is the current day's food log, not a general dashboard or marketing page.

The primary navigation has three destinations:

- `Log`
- `Food Database`
- `Saved Foods`

On mobile, use a compact fixed bottom navigation. On desktop, use a compact side or top navigation. `Add Food` is a contextual primary action inside `Log`, not a fourth navigation destination.

## Visual direction

- Dark theme is the only theme for the first version.
- Use a charcoal background rather than pure black.
- Use slightly lighter dark surfaces for cards and panels.
- Use soft white for primary text and muted gray for secondary text.
- Use subtle borders and little or no shadow.
- Use one primary green accent for actions and neutral progress.
- Use amber for warnings and red only for errors or exceeded limits.
- Avoid gradients, glossy effects, decorative illustrations, and visual clutter.
- Use a highly legible sans-serif typeface with clear numerical hierarchy.
- Keep the visual tone focused and non-judgmental; this is a personal food journal, not an aggressive fitness-gamification product.

### Nutrient chart colors

Progress bars and nutrient summaries may use distinct, muted colors while the surrounding UI remains minimal:

- Calories — green
- Protein — blue
- Carbs — purple
- Fat — orange
- Fiber — teal
- Sugar — pink
- Sodium — amber

Never communicate status by color alone. Every chart must also show the nutrient name, current amount, unit, and reference/target context.

## Screen 1: Daily Log

### Header and date navigation

- Show the current date prominently.
- Provide previous-day and next-day controls.
- Provide a date picker for jumping to any date.
- Show `Today` as a shortcut whenever the user is viewing a past or future date.

### Daily nutrition summary

Place the summary before the food feed:

- `Calories` is the largest metric.
- Show compact progress bars/cards for `Protein`, `Carbs`, `Fat`, `Fiber`, `Sugar`, and `Sodium`.
- Use `Daily Reference` language when a value is not a user-defined target.
- Calories use the user's optional daily calorie target. If no target exists, show calories consumed and a `Set calorie goal` CTA instead of inventing a target.
- Nutrient reference types must be visually distinguishable in the design system:
  - target or goal;
  - minimum;
  - recommended range;
  - upper limit.
- When an upper limit is exceeded, keep the bar visually full, switch to an alert state, and show the current amount plus the amount over the limit. Do not shrink or hide the value.

The exact reference numbers are intentionally not part of this design brief. They will be decided from official nutrition research in the domain decision.

### Food feed

Show one chronological feed, sorted newest to oldest. Do not separate the feed into visual meal sections.

Each food entry shows:

- title;
- logged time;
- calories;
- protein;
- carbs;
- fat.

An optional meal tag may appear as a small label: `Breakfast`, `Lunch`, `Dinner`, or `Snack`. The tag is optional and may be empty.

The default logged time is the current time, but the user can edit it before saving. Historical entries can also change date and time.

Each entry has an accessible overflow action (`...`) with:

- `Edit Entry`;
- `Delete Entry`.

Editing allows changing the food, quantity/unit, date, time, and optional meal tag. Nutritional values are not edited directly inside a historical entry; manual food definitions are edited from `Saved Foods`. The interface should make this distinction clear.

Deleting requires confirmation and shows a short success toast with `Undo`.

### Add Food action

Use a prominent `Add Food` button. On mobile it may be fixed near the bottom of the screen; on desktop it may sit next to the day header or in a visible side panel.

The action opens a source selector with exactly three choices:

1. `Food Database`
2. `Scan Food`
3. `Saved Foods`

Use a bottom sheet on mobile and a modal or side panel on desktop.

## Screen 2: Food Database

This is a unified food picker and search surface, not only an external API search.

- Put the search bar at the top.
- Put filter controls directly below it:
  - `All`
  - `My Meals`
  - `My Favorites`
  - `My Foods`
- On first open, show recent logged food entries before requiring a search.
- Search results and recent results use the same visual card/list treatment.
- Each result shows at minimum its name and calories consumed/selected.
- A result can come from an external food database or from the user's own data, but the source/state should be clear.
- Selecting a result opens the shared Food Detail and Review surface described below.
- Food Database does not create manual foods. Manual creation belongs in `Saved Foods`.

## Shared Food Detail and Review surface

Reuse the same component/screen for Food Database results, barcode results, Food Label results, and Saved Foods.

Show:

- food/product name;
- brand or source when available;
- serving size;
- unit selector using the product's natural unit when available (`serving`, `package`, `item`, etc.);
- quantity control with `-`, numeric value, and `+`, defaulting to `1`;
- full nutrition details;
- live recalculation of calories and nutrients as quantity changes.

Primary actions:

- `Add to Log`
- `Save to Saved Foods` when applicable.

The user must review and confirm before anything is added to the log.

## Screen 3: Scan Food camera hub

Open a camera-focused screen with a clear capture area and a persistent bottom mode switcher:

`Scan Food | Barcode | Food Label`

The default mode is `Scan Food`.

### Scan Food mode

1. Capture a food photo.
2. Show an analysis state.
3. Open an editable review of identified ingredients.
4. For every ingredient, show name, estimated quantity, calories, key nutrients, and an `Estimated`/confidence state where appropriate.
5. Allow per-ingredient actions:
   - edit manually;
   - delete;
   - `Edit with AI`.
6. Provide a top-level `Edit entire meal with AI` action.
7. AI edits accept a short natural-language instruction and always return a visible proposal.
8. The user reviews the proposal and explicitly confirms with `Add to Log`.

AI must never silently add a meal or silently overwrite a user's corrections.

### Barcode mode

- Use automatic camera detection.
- Provide `Enter barcode manually` as a fallback.
- After lookup, open the shared Food Detail and Review surface.
- If no product is found, offer retry, name search, or a path to create a manual food in `Saved Foods`.

### Food Label mode

- Show a framing guide for the nutrition label.
- Capture the label and extract product name, serving size, and visible nutrient values.
- Open the shared Food Detail and Review surface with all extracted values editable.
- Highlight missing or uncertain fields.
- Allow `Add to Log` or `Save to Saved Foods` after review.

## Screen 4: Saved Foods

Saved Foods is the user's personal library. It contains:

- manually created foods;
- favorite foods;
- saved meals/recipes;
- products saved from Food Database, Barcode, or Food Label.

Use the same search/filter vocabulary where useful: `All`, `My Meals`, `My Favorites`, and `My Foods`.

Provide visible actions:

- `Create Food`
- `Create Meal`

Selecting a saved item opens the shared Food Detail and Review surface. Saved items can be edited, favorited, or deleted according to their type.

## Screen 5: Create Meal

The meal builder supports the user's real-world workflow of scanning or photographing ingredients independently and combining them later.

Show:

- meal name;
- optional meal photo;
- number of servings produced;
- `Add Ingredient` action.

Each ingredient can come from `Food Database`, `Scan Food`, or `Saved Foods`. The ingredient list shows editable quantity/unit, calories, and actions to edit, remove, or replace an ingredient. Update the total recipe nutrition and per-serving nutrition as ingredients change.

On save:

- save the item into `My Meals`;
- allow it to be favorited;
- optionally add it immediately to the daily log.

## Screen 6: Daily Targets settings

Provide a secondary settings surface called `Daily Targets`:

- allow the user to set a daily calorie goal;
- do not force setup on first use;
- do not calculate or present a personalized medical recommendation;
- if no calorie goal exists, show `Set calorie goal` from the daily summary.

## Responsive behavior

### Mobile

- Single-column layout.
- Summary first, feed second.
- Fixed or sticky `Add Food` action.
- Bottom navigation for `Log`, `Food Database`, and `Saved Foods`.
- Camera and review screens may use nearly the full viewport.
- Use large tap targets and avoid hover-only interactions.

### Desktop

- Keep the summary and daily feed as the primary content area.
- Use a compact side panel or top navigation.
- A visible side panel may expose quick actions and Saved Foods without obscuring the log.
- Camera and review can use a centered modal or focused panel.

## Required states for mocks

Create at least one mock for each:

- empty daily log;
- populated daily log;
- past-date log with `Today` shortcut;
- daily summary with normal progress;
- nutrient upper-limit exceeded state;
- Food Database with recent results;
- Food Database with search results and filters;
- shared Food Detail and Review surface;
- Scan Food AI review with multiple editable ingredients;
- per-ingredient `Edit with AI` proposal;
- `Edit entire meal with AI` proposal;
- Barcode not-found state;
- Food Label partial extraction requiring manual correction;
- Saved Foods library;
- Create Meal builder;
- loading/skeleton state;
- retryable external-service error;
- delete confirmation and undo toast.

## Copy and interaction principles

- All visible UI copy is English.
- Prefer direct labels: `Add Food`, `Add to Log`, `Save to Saved Foods`, `Edit Entry`, `Edit with AI`, `Edit entire meal with AI`, `Create Food`, `Create Meal`.
- Make source and uncertainty visible without making the user feel judged.
- Keep confirmation explicit for AI-derived or incomplete nutrition data.
- Do not make colors the only indicator of status.

## Deliverable requested from the design tool

Produce a coherent dark-theme design system and high-fidelity mocks for the required screens and states above. Include desktop and mobile variants for the Daily Log, Add Food source selector, Food Database, Scan Food, Saved Foods, and Create Meal flows. Keep all behavior as annotated interaction design; do not generate production code.
