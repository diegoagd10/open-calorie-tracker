# Calorie Tracker Context

## Ubiquitous language

- **User** — the individual who records and reviews their own food intake.
- **Daily log** — the chronological record of a user's food entries for one calendar date.
- **Food entry** — one recorded consumption event in a daily log. It has a date, an optional meal context, a quantity, and a nutritional snapshot.
- **Food item** — a reusable nutritional definition for a packaged product, ingredient, or saved dish.
- **Nutritional profile** — the calories and nutrients associated with one serving or declared quantity of a food item.
- **Ingredient** — a food item used as a component of a saved dish or identified by an image.
- **Food candidate** — a proposed food item or nutritional match produced by a lookup or AI-assisted flow and awaiting user confirmation.
- **Recipe** — a named, reusable combination of ingredients that produces a nutritional profile per serving.
- **Serving** — the quantity unit used to scale a nutritional profile when it is added to a daily log or recipe.
- **Meal tag** — an optional label on a food entry such as Breakfast, Lunch, Dinner, or Snack; it categorizes an entry without changing the chronological log.
- **Daily summary** — the calculated total of the nutritional snapshots in one daily log.

## Model boundaries

The nutritional profile of a food item may change when its source data is corrected, but an existing food entry keeps the nutritional snapshot that was recorded for that event. A recipe is reusable, while a food entry is historical.
