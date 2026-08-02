# Domain: meal builder and saved dishes

Status: closed
Labels: wayfinder:grilling, closed
Parent: ../spec.md
Blocked by: 01-ux-daily-log-and-entry-flows.md, 03-food-input-and-ai-confirmation.md
Assigned: Codex (current session)

## Question

What is the canonical workflow for creating, reviewing, saving, editing, and logging a reusable meal? Decide how ingredients enter the builder (manual, barcode, label/photo, or existing food items), how quantities and yield servings work, how meal nutrition is calculated, whether meals are versioned when an ingredient changes, and what “favorite” means in navigation and daily logging.

The resolution must cover a concrete meal assembled from independently scanned or photographed ingredients and the historical behavior after that meal is later edited.

## Comments

### Resolution (2026-08-02)

`Meal` is the canonical domain term for a named reusable combination of confirmed `Food items`. A Meal is one assembled unit with no separate yield field. Each ingredient retains its own confirmed portion, and the Meal's nutrition is the sum of those ingredient profiles scaled by their quantities. The Meal builder can edit, remove, replace, or add ingredients; logging a saved Meal changes only the number of Meal units consumed. Quantity input accepts decimal or fraction expressions and displays normalized fractions.

Ingredients must complete their own source review before entering a Meal. Editing a saved Meal affects future uses only. An existing `Food entry` keeps its historical nutritional snapshot; an edit made directly on that entry affects only that entry.

`Favorite` is a user-owned convenience marker that can apply to a Food item or Meal. Saving a Food entry as a Favorite creates an independent Food item from that entry's exact snapshot and quantity. Favoriting a database result creates an independent Food item from its confirmed values. Favoriting an existing Meal marks that Meal rather than copying it. Unfavoriting removes only the marker and never deletes or changes the underlying item. `My Favorites` can contain both Food items and Meals.
