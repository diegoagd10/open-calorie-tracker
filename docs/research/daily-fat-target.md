# Daily Fat Target Research

**Date:** 2026-08-04  
**Scope:** Total dietary fat for a general healthy-adult nutrition tracker. This is product research, not personalized medical advice.

## Bottom Line

Authoritative guidance does not establish one universal grams-per-day target for total fat. The main authorities express total fat as a percentage of total energy, so the gram value depends on the day's calorie target.

- WHO's current healthy-diet guidance says adults should get at least 15% of energy from fat and says limiting total fat to 30% or less of total energy may help prevent unhealthy weight gain. Its 2023 update frames the public-health recommendation as a 30% ceiling for adults.
- EFSA's adult reference intake range for total fat is 20-35% of energy.
- The National Academies' DRI report gives adults an Acceptable Macronutrient Distribution Range (AMDR) of 20-35% of energy for fat.
- These are different kinds of guidance. WHO's 30% value is a ceiling for a stated public-health purpose; EFSA and the National Academies provide a distribution range. Neither supports treating a single arbitrary gram value as the ideal for every adult.

## Source Findings

### World Health Organization

1. [Healthy diet fact sheet](https://www.who.int/news-room/fact-sheets/detail/healthy-diet) (26 January 2026) states that, for adults, a minimum of 15% of daily energy should come from fat. It then says limiting total fat to 30% or less of total daily energy may help prevent unhealthy weight gain. The same page says unsaturated fat is preferable and gives limits of no more than 10% of energy from saturated fat and no more than 1% from trans fat.
2. [Total fat intake for the prevention of unhealthy weight gain in adults and children: WHO guideline](https://www.who.int/publications/i/item/9789240073654) (17 July 2023) describes the formal guidance as percentage-of-energy guidance and says it replaces earlier WHO total-fat guidance.
3. [WHO updates guidelines on fats and carbohydrates](https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates) (17 July 2023) says WHO reaffirms that adults should limit total fat to 30% of total energy or less, with saturated fat no more than 10% and trans fat no more than 1% of total energy.

**Interpretation:** WHO supports a maximum-style product rule for total fat when the product's purpose is aligned with its unhealthy-weight-gain prevention guidance. The 15% statement is a lower floor in the current fact sheet, but it should not be presented as a universal personalized minimum or combined with the 30% ceiling as though WHO had defined one optimal range for every user.

### European Food Safety Authority

1. [Scientific Opinion on Dietary Reference Values for fats](https://www.efsa.europa.eu/en/efsajournal/pub/1461) (EFSA Journal, 2010; DOI: 10.2903/j.efsa.2010.1461) sets the adult Reference Intake range for total fat at 20-35% of energy.
2. EFSA's [Dietary reference values overview](https://www.efsa.europa.eu/en/topics/topic/dietary-reference-values) explains that reference intake ranges for macronutrients are typically set from the relative contribution to total energy and indicate a range adequate for maintaining health. It also explicitly says DRVs are not nutrient goals or recommendations for individuals, are intended for healthy people, and may not apply to people with diseases.

**Interpretation:** EFSA is direct support for modeling total fat as a range, not as a single minimum or maximum. The EFSA range is a reference for healthy population groups, not an individualized prescription.

### National Academies / DRI

1. The National Academies' [Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids](https://nap.nationalacademies.org/catalog/10490/dietary-reference-intakes-for-energy-carbohydrate-fiber-fat-fatty-acids-cholesterol-protein-and-amino-acids) report (2005) describes AMDRs for fat as a percent of energy and separately identifies Adequate Intakes for the essential fatty acids linoleic acid and alpha-linolenic acid.
2. The report's [Dietary Fats: Total Fat and Fatty Acids chapter](https://www.nationalacademies.org/read/10490/chapter/10) gives the adult total-fat AMDR as 20-35% of energy. The DRI construct is therefore a distribution range for total fat, not one total-fat grams-per-day RDA.

**Interpretation:** The National Academies source agrees with EFSA on a 20-35% adult range. It also reinforces that total fat and essential fatty-acid adequacy are distinct metrics; a total-fat number alone cannot stand in for essential-fatty-acid guidance.

## Converting Energy Percentages to Grams

For a calorie target `K`, the general label-calculation factor is 9 kcal per gram of total fat. This factor is specified in [21 CFR 101.9(c)(1)(i)(B)](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/section-101.9), which points to the general factors of 4, 4, and 9 calories per gram for protein, carbohydrate, and total fat.

```text
fat grams = K * fat percentage / 9
```

Illustrative values for 2,000 kcal/day, rounded to the nearest gram:

| Guidance or boundary | Energy share | Approximate total fat |
| --- | ---: | ---: |
| WHO fact-sheet floor | 15% | 33 g |
| EFSA / National Academies lower bound | 20% | 44 g |
| WHO ceiling | 30% | 67 g |
| EFSA / National Academies upper bound | 35% | 78 g |

The example is arithmetic, not a recommendation that every person needs 2,000 kcal or any particular number of grams. If the calorie target changes, the gram values must change with it.

For a strict integer maximum, round down rather than to the nearest gram. At 2,000 kcal, the exact WHO ceiling is 66.7 g; displaying 67 g is suitable for an approximate reference table but would be slightly above a strict 30% cap.

## Product Implications

| Model | Fit with the sources | Product behavior |
| --- | --- | --- |
| **Range** | Best fit for EFSA and National Academies AMDR guidance | Store/display `minPercent=20`, `maxPercent=35` for a general adult distribution view, then derive gram bounds from the calorie target. Use two values and show a range such as `44-78 g` at 2,000 kcal. |
| **Maximum** | Best fit for the WHO 30% public-health ceiling | If the product must have one numeric value, calculate `maxGrams = floor(calorieTarget * 0.30 / 9)` when storing whole grams, and label it `fat limit` or `maximum`, not `fat goal`. Intake at or below the limit is within this rule; being below it is not a failure. |
| **Minimum** | Supported only as a limited WHO fact-sheet floor, not as a general total-fat target for all users | Do not make a one-number minimum the default total-fat rule. A minimum would need clear population scope and should not be confused with essential fatty-acid metrics. |
| **Single target** | No direct authoritative support for one ideal total-fat gram value | Do not use a midpoint such as 27.5% as though it were an official target. It is a product convention, not a source-backed recommendation. |

### Recommended fallback for a one-number schema

Use a **maximum** with an explicit energy basis if the product cannot represent a range. The least misleading implementation-level contract is conceptually:

```text
metric: totalFat
unit: g
rule: maximum
basis: 30% of configured daily energy
```

Keep the percentage basis and population scope in the product copy or metadata. A hard-coded value such as `78 g` would only correspond to the illustrative 2,000 kcal example and would silently change meaning for anyone with a different energy target.

If the product is intended to communicate general macronutrient balance rather than a WHO-style upper limit, the better choice is to change the metric contract to a range. Total-fat status should also remain separate from saturated-fat and trans-fat status because WHO gives separate quality limits.

## Limitations

- The cited values are population-level guidance or reference values for generally healthy people, not personalized medical advice. Age, pregnancy or lactation, disease, medications, activity, dietary pattern, and clinical goals can change the appropriate interpretation.
- WHO, EFSA, and the National Academies are answering related but different questions. Their 30% ceiling and 20-35% reference range should not be presented as one universally agreed interval without explaining the purpose of each.
- The grams conversion depends on the configured energy target and uses a general 9 kcal/g factor. Food-label rounding and food-specific energy factors can produce small differences.
- Total fat is not the same as fat quality. A total-fat target does not indicate whether fat came primarily from unsaturated, saturated, or trans-fat sources.

## Sources

- WHO, [Healthy diet](https://www.who.int/news-room/fact-sheets/detail/healthy-diet)
- WHO, [Total fat intake for the prevention of unhealthy weight gain in adults and children: WHO guideline](https://www.who.int/publications/i/item/9789240073654)
- WHO, [WHO updates guidelines on fats and carbohydrates](https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates)
- EFSA, [Scientific Opinion on Dietary Reference Values for fats](https://www.efsa.europa.eu/en/efsajournal/pub/1461)
- EFSA, [Dietary reference values](https://www.efsa.europa.eu/en/topics/topic/dietary-reference-values)
- National Academies, [Dietary Reference Intakes for Macronutrients](https://www.nationalacademies.org/projects/HMD-FNB-18-P-119)
- National Academies, [Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids](https://nap.nationalacademies.org/catalog/10490/dietary-reference-intakes-for-energy-carbohydrate-fiber-fat-fatty-acids-cholesterol-protein-and-amino-acids)
- National Academies, [Dietary Fats: Total Fat and Fatty Acids](https://www.nationalacademies.org/read/10490/chapter/10)
- eCFR, [21 CFR 101.9 Nutrition labeling of food](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/section-101.9)
