# 19 - Create and log one-unit Meals from confirmed Foods

**What to build:** Make the Saved Foods Meal builder work from independently confirmed Food items and preserve explainable Meal nutrition and historical behavior.

**Blocked by:** 14 - Build the Saved Foods library and Food favorites, 15 - Search Food Database and confirm external Food candidates, 16 - Import barcode Food candidates with classified failures, 17 - Review Food Label candidates, and 18 - Analyze food images into editable Food candidates.

**Status:** ready-for-agent

**Mockup starting point:** Start with Saved Foods My Meals, Create Meal, ingredient rows, nutrition-per-unit summary, optional photo, and Meal review states in `public/mockup.html`.

- [ ] The Meal builder creates a named reusable Meal from confirmed Food ingredients and has no servings-produced or yield field; one saved Meal is one assembled unit.
- [ ] Ingredients can be added, edited, replaced, and removed with decimal/fraction quantities, and the builder shows each ingredient's quantity and nutrition.
- [ ] Meal nutrition equals the full-precision sum of ingredient Nutritional profiles scaled by their quantities, with consistent rounding and missing-data warnings.
- [ ] The User can save an optional Food image association, save the Meal, favorite or unfavorite the existing Meal, and find it in My Meals and My Favorites.
- [ ] Logging a Meal accepts fractional or multiple Meal units and stores an immutable Nutritional snapshot; later Meal edits affect future uses only.
- [ ] Confirmed image-analysis ingredients can enter the builder only after their candidate review and explicit confirmation.
