# OFF serving-default investigation

Investigation date: 2026-09-15.

## Subsequent implementation decision

After reviewing these results, the application policy was simplified to an
explicit priority rather than treating every lower-priority contradiction as a
blocker: a usable native serving is authoritative; without one, a valid
source-declared serving quantity selects the matching mass or volume per-100
dimension; a sole per-100 dimension is otherwise used; unresolved equal-priority
ambiguity remains unavailable. A per-100 basis is displayed as `1 serving` only
when OFF declares a positive serving quantity in that same dimension.

This deliberately accepts the coverage tradeoff documented below: conflicting
lower-priority per-100 values do not override a usable serving. The diagnostic
counts remain useful for monitoring the effects of that policy and for any
future source-quality work.

Replaying the implemented priority against all 52,058 products previously
stored as `conflicting_nutrition_bases` resolves 49,962 and leaves 2,096
unavailable because their ambiguity is still within the selected priority.
This is a resolver replay over the retained full-generation projections, not a
replacement import or a mutation of the installed catalog.

## Conclusion

Do **not** make `per: "serving"` the only/default nutrition source for every
Open Food Facts product.

The September 13 catalog contains 4,745,915 installed products, but only
346,223 (7.30%) retain a valid native packaging/as-sold serving set. Only
297,970 (6.28%) finish import with that native serving actually selected;
298,288 (6.29%) are selectable products that have native serving evidence,
including 318 whose usable authority comes from another basis. Conversely,
2,152,080 products (45.35% of the catalog) have trusted native 100 g or 100 ml
sets and no native serving set. A serving-only policy would discard usable
nutrition for a large part of the catalog.

Presence is not proof of correctness. In the baseline generation, 46,499 of the
346,223 products with a valid native serving set (13.43%) conflict with another
trusted input set. The adopted policy deliberately makes the usable serving
authoritative instead of allowing those lower-priority values to block it.
Products without serving nutrition retain valid 100 g or 100 ml authority;
mass and volume are never converted without a matching source-declared serving
dimension.

## Population results

The primary denominator is the 4,745,915 products in the immutable imported
SQLite generation.

| Population | Products | Percent of catalog | Meaning |
| --- | ---: | ---: | --- |
| Installed products | 4,745,915 | 100.00% | Complete imported catalog |
| Products retaining the native input-set projection | 2,547,955 | 53.69% | Includes 49,652 whose retained trusted-set list is empty |
| Products with at least one retained trusted set | 2,498,303 | 52.64% | Packaging, as sold, supported reference |
| Products with a valid native serving set | 346,223 | 7.30% | Measured serving in g or ml |
| Native serving candidate with usable declared energy | 344,479 | 7.26% | Candidate-level usability; conflict checks still apply |
| Products with only a serving set | 267,244 | 5.63% | No retained 100 g/100 ml alternative |
| Products with serving plus another trusted set | 78,979 | 1.66% | Evidence can be compared or can conflict |
| Products with trusted 100 g/100 ml sets but no serving | 2,152,080 | 45.35% | Would be lost under a serving-only policy |
| Products with more than one retained serving set | 0 | 0.00% | Every retained native-serving product has exactly one serving set |
| Baseline native-serving products selectable | 298,288 | 6.29% | Pre-change result with serving evidence present |
| Baseline products with native serving selected | 297,970 | 6.28% | Excludes 318 whose usable authority came from another basis |
| Baseline native-serving products unavailable | 47,935 | 1.01% | 46,499 conflict; 1,343 lack calories; 12 have invalid references; 81 have unsupported barcodes |

The legacy flat OFF fields provide another 674,341 selectable one-serving
authorities, but they are not native measured `input_sets` and generally do not
establish a g/ml serving conversion. Even adding them to the 297,970 products
whose native serving is actually selected reaches only 972,311 products
(20.49% of the catalog), not the full catalog.

Across all selectable products, 1,404,924 offer a serving **measurement** and
1,617,694 do not. A serving measurement on a 100 g/100 ml authority is not the
same thing as an independent serving nutrition input set: it is a quantity used
to scale the per-100 authority.

## Risk evidence for the serving-first tradeoff

### Conflict prevalence

The baseline importer marked 52,058 products with
`conflicting_nutrition_bases`. A native
serving is involved in 46,499 of them (89.32% of all basis-conflict products).
This does not prove the serving is wrong. It quantifies the lower-priority
evidence that the adopted serving-first policy intentionally disregards.

For the 71,716 native-serving products with an energy value comparable to a
same-unit alternative, the normalized calorie gap is:

| Normalized energy difference | Products | Percent of comparable products |
| --- | ---: | ---: |
| At most 1% | 46,429 | 64.74% |
| More than 1%, at most 5% | 6,367 | 8.88% |
| More than 5%, at most 20% | 7,671 | 10.70% |
| More than 20% | 11,249 | 15.69% |

The first bucket shows how often exact equality was stricter than source label
precision. At the other end, 18,920 products (26.38% of comparable products)
differ by more than 5%, and 11,249 differ by more than 20%; these are useful
monitoring cohorts for the adopted coverage tradeoff.

Additional diagnostics found:

- 3,580 products repeat at least two identical nutrient totals across unequal
  bases. This often means one basis was copied without scaling, but the shape
  alone does not identify which basis is correct.
- 2,253 products trigger a deliberately strong physical-implausibility
  heuristic for a mass serving: protein + carbohydrate + fat exceeds the
  declared serving mass by more than 2 g, or energy exceeds
  `9.5 kcal × serving grams + 5 kcal`. This is intentionally generous to label
  rounding and is a review signal, not a source of corrected values.

### Side-by-side examples

| Evidence | Nutella | Premier Protein shake | Nutella & GO |
| --- | ---: | ---: | ---: |
| Barcode | `3017620422003` | `0643843716686` | `0009800800056` |
| Native serving set | **Absent** | 325 ml: **160 kcal** | 52 g: **500 kcal** |
| Native per-100 set | 100 g: **539 kcal** | 100 ml: **160 kcal** | 100 g: **500 kcal** |
| Other source evidence | None needed | 100 g: 49.18 kcal | Serving macros total about 98.08 g inside a 52 g serving |
| If serving is always used | Product becomes unusable | Likely chooses the correct 160 kcal bottle | Chooses a physically implausible serving |
| Adopted-priority result | Use the valid 100 g set | Use the 325 ml serving | Use the 52 g serving; this is a known risk for any future physical-sanity policy |

The last two products document the chosen tradeoff. Both show the same calories
on unequal bases. Serving priority likely fixes the shake and selects the
implausible Nutella & GO serving; the current implementation accepts that risk
in exchange for a simple deterministic policy.

## Implemented resolver behavior

The importer selects candidates in
[`app/catalog-management/off-jsonl.server.ts`](../app/catalog-management/off-jsonl.server.ts).

| Situation | Resolution |
| --- | --- |
| Any usable trusted serving | Select serving; lower-priority per-100 candidates do not block it |
| No serving; valid declared serving quantity and unit | Select per-100 candidates in the matching dimension |
| No serving; only one per-100 dimension | Use that dimension |
| Multiple compatible candidates at the selected priority | Use the most complete set, then a stable canonical tie-break |
| Equal-priority candidates materially disagree | Keep calculation unavailable |
| Both mass and volume remain without selection evidence | Keep calculation unavailable; never infer density |
| Per-100 authority has a compatible declared serving quantity | Offer the scaled quantity as `1 serving` |
| Per-100 authority has no compatible serving quantity | Default to 100 g or 100 ml; do not relabel it as a serving |

Physical-implausibility counts in this report are diagnostics only; introducing
a runtime heuristic or reviewed-override system is outside this implementation.

## Method and provenance

The analysis used the installed immutable generation produced by the supplied
September 13, 2026 JSONL archive:

| Artifact | Value |
| --- | --- |
| Source archive | `/home/dagd/Downloads/openfoodfacts-products.jsonl.gz` |
| Compressed bytes | 12,870,197,024 |
| Archive SHA-256 | `9f6c5a19666aac27e43060268fdf0fb8d540a1474bef3f88db9b83c5bbd67d0e` |
| Imported SQLite | `/home/dagd/.codex/worktrees/d10b/open-calory-tracker/data/playwright-tests/catalogs/009fc89c-4597-4ba0-9f79-468e3064f785.sqlite` |
| SQLite bytes | 10,498,605,056 |

The archive fingerprint, source/import counts and generation size are also
recorded in [`docs/local-off-catalog.md`](local-off-catalog.md). The set trust,
reference validation, serving preference and conflict comparison used by the
application are defined in
[`app/catalog-management/off-jsonl.server.ts`](../app/catalog-management/off-jsonl.server.ts)
and nutrient unit/fixed-point handling is defined in
[`app/catalog-management/off-nutrition.server.ts`](../app/catalog-management/off-nutrition.server.ts).

The main population counts can be reproduced with SQLite JSON1. The following
is the core query shape used to enumerate retained sets:

```sql
WITH product AS (
  SELECT
    id,
    record,
    json_extract(
      record,
      '$.offSourceFields."nutrition.input_sets"'
    ) AS input_sets,
    json_extract(record, '$.isSelectable') AS is_selectable,
    json_extract(
      record,
      '$.calculationUnavailableReason'
    ) AS unavailable_reason
  FROM products
), retained_set AS (
  SELECT
    product.id,
    product.is_selectable,
    product.unavailable_reason,
    json_extract(value, '$.per') AS per,
    json_extract(value, '$.per_quantity') AS per_quantity,
    json_extract(value, '$.per_unit') AS per_unit,
    value AS set_json
  FROM product, json_each(COALESCE(product.input_sets, '[]'))
)
SELECT
  (SELECT count(*) FROM product) AS installed_products,
  (SELECT count(*) FROM product WHERE input_sets IS NOT NULL)
    AS native_projection_products,
  (SELECT count(DISTINCT id) FROM retained_set)
    AS products_with_retained_sets,
  (SELECT count(DISTINCT id) FROM retained_set WHERE per = 'serving')
    AS products_with_serving,
  (SELECT count(*) FROM (
    SELECT id
    FROM retained_set
    GROUP BY id
    HAVING sum(per = 'serving') > 1
  )) AS products_with_multiple_servings;
```

Candidate usability and compatibility diagnostics used the same accepted
numeric grammar, kcal/kJ and g/mg conversions, source/preparation filters,
reference rules and per-100 fixed-point normalization as the importer. The
relative energy gap was `abs(a - b) / max(abs(a), abs(b))` after both values
were normalized to the same 100-unit basis.

### Caveat

The generated database intentionally preserves only the projection needed for
the application. Its `nutrition.input_sets` string contains retained
packaging/as-sold sets with supported references; unsupported source/preparation
sets and some malformed native containers are not preserved. Therefore the
counts above describe exactly what the installed application can evaluate, not
every raw upstream input-set shape. That is the appropriate population for the
serving-default decision, but it should not be presented as a general quality
audit of all raw OFF data.
