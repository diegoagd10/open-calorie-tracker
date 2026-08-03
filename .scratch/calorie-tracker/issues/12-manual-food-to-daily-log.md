# 12 - Log a manual Food with an immutable Nutritional snapshot

**What to build:** Make the first complete user journey work: create a manual Food, review the amount consumed, and add it to the current Daily log. The journey must establish nullable optional nutrients, quantity scaling, display rules, and historical snapshot semantics.

**Blocked by:** 11 - Bootstrap the TypeScript application and persistence boundary.

**Status:** ready-for-agent

**Mockup starting point:** Start with the empty/populated Daily log, Add Food source sheet, Saved Foods manual Food card, and shared review drawer in `public/mockup.html`.

- [ ] The current Daily log renders from the User's configured local date and has an empty state that leads to Add Food.
- [ ] Add Food opens exactly Food Database, Scan Food, and Saved Foods; manual Food creation is available from Saved Foods rather than as an extra source choice.
- [ ] A manual Food requires calories and a declared quantity basis; optional nutrient values remain unknown when omitted instead of becoming zero.
- [ ] Review accepts decimal and fraction quantities, displays normalized fractions where applicable, recalculates all available nutrients with full precision, and applies the agreed final display rounding.
- [ ] Explicit Add to Log persists a Food entry with its own Nutritional snapshot and renders the fixed summary order: Calories, Protein, Total carbohydrates, Fat, Fiber, Added sugar, Total sugar, Saturated fat, and Sodium.
- [ ] Unknown nutrient values contribute zero only to Daily summary arithmetic and produce a visible missing-data warning; no target or progress evaluation is invented.
