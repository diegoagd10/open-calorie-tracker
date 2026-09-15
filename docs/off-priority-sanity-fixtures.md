# OFF nutrition priority: real-data sanity fixtures

Investigation date: 2026-09-15.

## Purpose

This document identifies compact, real Open Food Facts products that exercise
the nutrition-priority resolver introduced in commit `aec494e`. The examples
are intended to become frozen test fixtures: tests should copy the small source
projection shown here and must not depend on the 9.8 GiB catalog at runtime.

The investigation also looked for records outside the priority rules and for
records where the deterministic rule produces a technically valid but
questionable result.

## Data and method

The replay read all 4,745,915 products from the installed immutable generation:

```text
/home/dagd/.codex/worktrees/d10b/open-calory-tracker/data/playwright-tests/catalogs/
009fc89c-4597-4ba0-9f79-468e3064f785.sqlite
```

For each of the 2,547,955 records containing a retained native
`nutrition.input_sets` projection, the investigation:

1. parsed `offSourceFields["nutrition.input_sets"]`;
2. passed the sets and retained serving metadata to the current
   `offNativeNutrition` function;
3. compared its result with the outcome stored by the previous importer; and
4. classified the exact resolver branch, measurements, chosen base and
   unavailable reason.

The replay did not alter the catalog. The retained projection is sufficient to
replay valid candidates. It is not sufficient to reconstruct malformed sets,
unsupported source/preparation sets, or the original invalid barcode: those
fields were deliberately discarded during the original import. Those cases
are called out separately instead of presenting a lossy replay as authoritative.

### Complete branch population

These categories are mutually exclusive and cover every native projection:

| Current resolver branch | Products |
| --- | ---: |
| At least one usable serving; use the serving tier | 344,479 |
| No usable serving; declared serving unit selects a matching per-100 dimension | 437,488 |
| No usable serving and no matching dimension evidence; use the sole per-100 dimension | 1,639,945 |
| Mass and volume both remain eligible without dimension evidence | 2,101 |
| No usable candidate or outside nutrition selection | 123,942 |
| **Total native projections** | **2,547,955** |

The previous generation stored 52,058 native products as
`conflicting_nutrition_bases`. Replaying the current resolver resolves 49,962
of those and leaves 2,096 unavailable. The branch replay sees five additional
mass/volume conflicts whose old result was `invalid_nutrition_reference`;
because their malformed raw sets were removed from the retained projection,
they must not be counted as genuine behavior changes without a fresh import.

## Rule 1: a usable serving outranks per-100 alternatives

### Real fixture: Premier Protein Café Latte

| Field | Value |
| --- | --- |
| Barcode | `0643843716686` |
| Product | Café Latte Protein Shake |
| Serving metadata | `325 ml`; `1 shake (325 ml)` |
| Previous result | unavailable: `conflicting_nutrition_bases` |
| Current result | selectable; authoritative base `1 serving (325 ml)` |

Retained input sets:

| Set | Energy | Protein | Carbohydrate | Fat |
| --- | ---: | ---: | ---: | ---: |
| `100g`, 100 g | 49.184 kcal | 9.222 g | 1.230 g | 0.922 g |
| `100ml`, 100 ml | 160 kcal | 30 g | 4 g | 3 g |
| `serving`, 325 ml | 160 kcal | 30 g | 4 g | 3 g |

The current resolver returns the serving values unchanged and offers
`serving`, `ml` and `100ml` measurements. Lower-priority contradictions no
longer block the serving.

This tier contains 344,479 products. Of the previously conflicting records,
46,494 become selectable through this serving-first branch.

Suggested frozen fixture and assertions:

```ts
nativeProduct([
  set("100g", 100, "g", { kcal: 49.1841577827782, protein: 9.22202958427091 }),
  set("100ml", 100, "ml", { kcal: 160, protein: 30, carbs: 4, fat: 3 }),
  set("serving", 325, "ml", { kcal: 160, protein: 30, carbs: 4, fat: 3 }),
], {
  code: "0643843716686",
  serving_quantity: 325,
  serving_quantity_unit: "ml",
})
```

Assert `isSelectable === true`, base unit `ml`, base quantity `325_000_000`,
energy `160`, and first measurement `serving`.

### Important counterexample: the rule is deterministic, not a truth check

`0009800800056`, **nutella & GO! with Breadsticks**, contains `500 kcal` per
100 g and also `500 kcal` per 52 g serving. Its serving claims approximately
98 g of protein, carbohydrate and fat inside a 52 g serving. The new resolver
nevertheless selects the 52 g serving because it is usable according to the
implemented structural rules.

This is the correct result for the agreed priority, but it is a valuable
regression/risk fixture. A future physical-sanity policy must be specified
separately; it should not be smuggled into the priority test.

## Rule 2: serving metadata selects the matching per-100 dimension

### Real fixture: Tabasco Habanero Sauce

| Field | Value |
| --- | --- |
| Barcode | `0011210006508` |
| Serving metadata | `5 ml` |
| Previous result | unavailable: `conflicting_nutrition_bases` |
| Current result | selectable; authoritative base `100 ml` |

| Candidate | Energy | Protein | Carbohydrate | Fat |
| --- | ---: | ---: | ---: | ---: |
| `100g`, 100 g | 88 kcal | 1.3 g | 20 g | 0.36 g |
| `100ml`, 100 ml | 121 kcal | 1.5 g | 23 g | 0 g |

The declared serving unit is `ml`, so only the volume candidate remains in the
selected tier. The result also offers `1 serving (5 ml)`.

The matching-dimension tier contains 437,488 products. The 3,468 records that
previously conflicted because both mass and volume were present now become
selectable through this branch. Together with Rule 1, that accounts for all
49,962 previously conflicting products resolved by the new policy.

Suggested assertions: base unit `ml`, base quantity `100_000_000`, energy
`121`, and a serving measurement with `baseQuantityMicrounits: 5_000_000`.
Do not assert against the 100 g values: they are deliberately ignored after
the dimension is selected.

## Rule 3: without dimension evidence, use the sole per-100 dimension

### Real fixture: Nutella

| Field | Value |
| --- | --- |
| Barcode | `3017620422003` |
| Serving metadata | no serving quantity; unit alone is `g` |
| Candidate | only `100g`: 539 kcal, 6.3 g protein, 57.5 g carbohydrate, 30.9 g fat |
| Previous result | selectable, `100 g` |
| Current result | selectable, `100 g` |

The incomplete metadata does not create a serving measurement. There is only
one usable dimension, so the resolver uses it.

Suggested assertions: base unit `g`, energy `539`, measurements exactly `g`
and `100g`, with no `serving` measurement.

### Mismatched metadata fixture

`0012000041709`, **Green Tea Zero Sugar**, is an especially useful boundary:
it has only a `100g` input set but declares a `500 ml` serving. The resolver
uses the sole `100g` authority, but does **not** create a 500 ml serving because
mass cannot be converted to volume without density.

Suggested assertions: result remains selectable with base `100 g`, and
`measurements.some(m => m.id === "serving") === false`.

## Rule 4: unresolved mass/volume ambiguity remains unavailable

### Real fixture: Tabasco Pepper Sauce

| Field | Value |
| --- | --- |
| Barcode | `0011210000018` |
| Product | 16000085 Tabasco Pepper Sauce |
| Serving metadata | absent |
| Previous result | unavailable: `conflicting_nutrition_bases` |
| Current result | unavailable: `conflicting_nutrition_bases` |

The record contains complete `100g` and `100ml` sets. Both happen to contain
the same displayed nutrient numbers, including 16 kcal, but grams and
millilitres are incompatible dimensions. Equal numbers do not establish a
density of 1 g/ml.

Suggested assertions: `isSelectable === false`, reason
`conflicting_nutrition_bases`, empty measurements, and all returned nutrition
fields null.

This example also exercises the only naturally occurring equal-tier conflict
shape in the retained generation: without serving-unit evidence, both per-100
dimensions remain in the selected tier and conflict by unit.

## Rule 5: expose `1 serving` only for a compatible declared quantity

Use a positive and a negative fixture together so the test cannot pass merely
because all per-100 products either gain or lose a serving.

| Behavior | Positive fixture | Negative fixture |
| --- | --- | --- |
| Barcode | `0000236555909` | `0012000041709` |
| Product | Bakers Best, White Bread | Green Tea Zero Sugar |
| Authority | `100g`, 235 kcal | `100g`, 0 kcal |
| Declared serving | 34 g | 500 ml |
| Current measurements | `g`, `100g`, `serving (34 g)` | `g`, `100g`; no serving |

Suggested positive assertion: serving quantity `34_000_000`. Suggested
negative assertion: no measurement with id `serving`. In both cases the
nutrition authority remains the original `100g` set; creating a display
measurement must not rewrite its nutrient values.

## Rule 6: conflicts inside the selected priority remain unavailable

There are no products with duplicate `100g`, duplicate `100ml`, or multiple
retained serving sets in this full generation. Therefore no real product can
exercise a same-basis duplicate conflict.

The real Tabasco Pepper Sauce fixture from Rule 4 still validates the broader
selected-tier rule: two candidates survive selection and conflict by
dimension, so calculation remains unavailable.

Keep a small synthetic duplicate-serving fixture for the same-basis branch:

```ts
[
  set("serving", 40, "g", { kcal: 150 }),
  set("serving", 50, "g", { kcal: 150 }),
]
```

Assert `conflicting_nutrition_bases`. A second synthetic case with equal
quantities but differing normalized calories should assert the same result.

## Rule 7: compatible equal-priority candidates prefer completeness

No real record matches this rule in the retained full generation. Counts were:

| Duplicate shape | Products |
| --- | ---: |
| More than one retained `100g` set | 0 |
| More than one retained `100ml` set | 0 |
| More than one retained `serving` set | 0 |

This rule is defensive behavior for future OFF shapes. It cannot honestly be
called a database-backed sanity fixture today. Keep it synthetic:

```ts
[
  set("serving", 41, "g", { kcal: 150 }),
  set("serving", 41, "g", { kcal: 150, proteinMg: 30_000 }),
]
```

Assert that the complete candidate wins and that values are not merged between
sets. Add a same-completeness case with fields in reversed source order and
assert an identical canonical result, proving deterministic behavior.

## Records outside the priority tree

The priority rules only choose among structurally valid, usable nutrition
candidates. They do not make every native product selectable.

The fallback example immediately below re-enters the tree through its usable
per-100 candidate and remains public. When the final result stays outside the
tree, barcode and detail reads produce the catalog not-found error (HTTP 404),
and search removes the record before its result limit is applied. The imported
generation retains the record and reason for diagnostics.
`conflicting_nutrition_bases` is the exception because it is reached inside the
priority tree and remains visible as an explicit, non-selectable conflict.

### Serving unusable, per-100 fallback usable

`0009542009984`, **SUPREME DARK 90% COCOA**, has:

- a `serving`, 20 g set with no usable energy; and
- a usable `100g` set with 592.734 kcal derived from declared kJ.

The current resolver ignores the unusable serving candidate, chooses `100g`,
and exposes `1 serving (20 g)` from the compatible metadata. The full replay
found 398 products with this shape.

This deserves a fixture because “serving wins” means **usable serving wins**;
an empty serving must not suppress valid nutrition.

### Calories unavailable

`00008570`, **Miel crémeux d'été**, contains a valid `100g` reference but no
usable calorie value. Old and current outcomes are both
`calories_unavailable`, with no measurements. The old installed generation
contains 72,346 native records with this outcome.

### Unsupported authority

`0002983542515`, **100% Soja Protein Neutral**, retains an empty candidate
projection and is `unsupported_nutrition_authority` under both old and current
projection replay. The old installed generation contains 40,908 such native
records. The empty projection proves there is no trusted packaging/as-sold
candidate, but it does not reveal which unsupported upstream source or
preparation was discarded.

Use synthetic `source: "estimate"` and `preparation: "prepared"` fixtures to
test the exact rejection branches.

### Invalid reference

`0008563994606`, **Macarons Pistache**, was stored as
`invalid_nutrition_reference`. There are 8,728 native records with that stored
outcome. Its malformed set is absent from the retained projection, so replaying
only the projection changes the apparent reason to
`unsupported_nutrition_authority`. That is a projection artifact, not evidence
that the current importer would accept or reclassify the raw record.

Invalid quantity, mismatched `100g`/unit, unsupported reference unit, and
missing `nutrients` must remain synthetic fixtures unless a raw archive record
is frozen alongside the test.

### Nutrition explicitly not provided

`5999563621744`, **Basemix - Supporting treatment of gout disease**, declares
`no_nutrition_data: "on"`. Old and current outcomes are both
`nutrition_not_provided`. The generation contains two such native products.

### Barcode validity is a separate gate

The old catalog stores 25,636 native records as `unsupported_barcode`.
Replaying `offNativeNutrition` alone can make many of their nutrition sets look
selectable because barcode validation is outside this resolver. A nutrition
fixture must not claim to test product identity acceptance.

## Sanity checks that expose the policy tradeoff

These are not unmatched resolver branches; they are products that match the
priority exactly while showing why the outcome should be monitored:

| Barcode | Product | Current result | Risk demonstrated |
| --- | --- | --- | --- |
| `0009800800056` | nutella & GO! with Breadsticks | selects 500 kcal per 52 g serving | serving is structurally usable but physically implausible |
| `0008229107005` | Classic 7-inch Chocolate Cake | selects 400 kcal per 118 g serving | serving and per-100 sets look like different labels/versions |
| `0643843716686` | Premier Protein Café Latte | selects 160 kcal per 325 ml serving | desired result; contradictory lower tiers are ignored |

Freeze at least the Nutella & GO! case as a characterization test. It prevents
a future contributor from assuming the resolver performs physical plausibility
validation that it does not currently implement.

## Recommended test set

The smallest high-value suite is:

1. Premier Protein: serving tier wins over contradictory per-100 sets.
2. Tabasco Habanero: declared `ml` selects `100ml` over `100g`.
3. Nutella `3017620422003`: sole `100g`, no usable serving quantity.
4. Tabasco Pepper Sauce: mass/volume ambiguity remains unavailable.
5. Bread plus Green Tea: compatible-only serving measurement pair.
6. Supreme Dark: unusable serving falls back to usable per-100 authority.
7. Nutella & GO!: characterize the agreed priority's plausibility risk.
8. Synthetic duplicate candidates: conflicting and compatible/completeness
   cases, because the current database contains no natural examples.
9. Synthetic invalid/unsupported sets: preserve reasons that cannot be
   reconstructed from the immutable projection.

These fixtures should assert resolver outputs rather than the full catalog
record. Names, aliases, dates and country metadata are unrelated to priority
selection and would make the tests unnecessarily brittle.
