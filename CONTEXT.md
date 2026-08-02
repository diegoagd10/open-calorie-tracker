# Calorie Tracker Context

## Ubiquitous language

- **User** — the individual who records and reviews their own food intake.
- **Daily log** — the chronological record of a user's food entries for one calendar date.
- **Food entry** — one recorded consumption event in a daily log. It has a date, an optional meal context, a quantity, a nutritional snapshot, and may reference the reusable Food item used to create it.
- **Food item** — a reusable nutritional definition for a packaged product, ingredient, or saved dish.
- **Nutritional profile** — the calories and nutrients associated with one serving or declared quantity of a food item; calories are required, other nutrient values may be unknown, and the quantity basis is declared.
- **Ingredient** — a food item used as a component of a saved dish or identified by an image.
- **Food candidate** — a proposed food item or nutritional match produced by a lookup or AI-assisted flow and awaiting user confirmation.
- **Food image** — a retained image associated with the Food item or Meal it helps identify, create, or correct.
- **Meal** — a named, reusable combination of ingredients that produces a nutritional profile for one assembled Meal unit.
- **Favorite** — a user-owned Food item or Meal marked for convenient reuse in My Favorites.
- **Quantity** — the amount of a Food item or Meal expressed against its unit; it scales the nutritional profile and may be entered as a decimal or fraction.
- **Serving** — a quantity unit used to scale a nutritional profile when it is added to a daily log or Meal.
- **Meal tag** — an optional label on a food entry such as Breakfast, Lunch, Dinner, or Snack; it categorizes an entry without changing the chronological log.
- **Daily summary** — the calculated total of the nutritional snapshots in one daily log.

## Model boundaries

A meal is composed of confirmed food items; a food candidate must be confirmed before it can become an ingredient. A Meal unit's nutrition is the sum of its ingredient profiles scaled by their quantities. Editing a Meal affects future uses only; an existing food entry keeps the nutritional snapshot recorded for that event, while an edit made on the food entry affects only that entry. Saving a Food entry as a Favorite creates an independent Food item from that entry's snapshot and quantity. Favoriting a database result likewise creates an independent Food item from its confirmed values; later source corrections do not mutate it without an explicit refresh. Favoriting an existing Meal marks that Meal, and unfavoriting any item removes only its Favorite marker without deleting or changing the item. A retained Food image belongs to the Food item or Meal it helps identify, create, or correct, rather than to every historical food entry, and remains until explicitly deleted. The first release serves one User per self-hosted deployment; that User owns the instance and its data, while authentication, synchronization, and multiple users are deferred for a future extension. A meal is reusable, while a food entry is historical.
