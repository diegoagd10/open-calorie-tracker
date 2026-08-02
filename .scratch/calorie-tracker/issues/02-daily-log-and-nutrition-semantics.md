# Domain: daily log and nutrition semantics

Status: closed
Labels: wayfinder:grilling, closed
Parent: ../spec.md
Blocked by: none
Assigned: Codex (current session)

## Question

What are the canonical rules for a daily log and its nutritional calculations? Decide the calendar/time-zone behavior, supported meal contexts, quantity and serving units, nutrients shown in the daily summary, rounding and missing-value behavior, and whether editing a historical food entry preserves the original nutritional snapshot or re-reads its source.

The resolution must cover concrete cases such as changing a serving size yesterday, logging half a package, and adding an item whose external record has calories but no fiber or sodium.

## Comments

### Resolution (2026-08-02)

The Daily log is organized by the User's local calendar date. Retained timestamps are stored in UTC and converted through the User's configured Timezone; the browser timezone is the initial default, and the User can change the setting. Food entries remain editable by date and time, and the existing meal contexts are optional `Breakfast`, `Lunch`, `Dinner`, and `Snack` tags that do not replace chronological ordering.

Every Food entry records a quantity against the Food item's declared nutritional basis. Manual entries, barcode-confirmed items, and image-estimated items use the same quantity-scaling rules; calories and the declared quantity basis are required, while other nutrients may remain unknown. Meals are one reusable unit made from confirmed ingredients with their own portions, and logging a Meal scales the number of Meal units consumed. Decimal quantities may be entered but are normalized to fractions where applicable, such as `0.5` to `1/2` and `1.25` to `1 1/4`.

The Daily summary shows consumed totals in this order: Calories, Protein, Total carbohydrates, Fat, Fiber, Added sugar, Total sugar, Saturated fat, and Sodium. Total carbohydrates, Added sugar, and Total sugar remain independent measures, with Added sugar shown before Total sugar. Calories are always required; missing optional nutrients remain unknown in the Food item and Food entry, contribute zero only to summary arithmetic, and produce a missing-data warning. Reference indicators are not invented by this ticket: protein has no default reference in v1, and target/minimum/range/upper-limit policy is deferred to `Domain: daily nutrient targets and limits`.

Nutrition calculations retain full precision through aggregation. All four user-visible nutrition surfaces—Food detail/review, Meal editing, individual Food entries, and the Daily summary—apply the same final-display policy: calories are whole kcal, gram-based nutrients use one decimal place, and milligram- or microgram-based nutrients use whole units. Quantities use normalized fractions where applicable.

Historical entries retain their nutritional snapshots. Editing a saved Meal affects future uses only; editing a historical Food entry changes only that entry and does not reread or mutate the source snapshot. The ticket's daily-log and nutrition semantics are therefore resolved without implementing runtime behavior.
