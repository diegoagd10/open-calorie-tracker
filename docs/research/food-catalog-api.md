# Food catalog API for phase-one search and logging

**Research date:** 2026-08-29

**Decision status:** approved for phase one, subject to the integration spike
**Question:** Which external catalog should power phase-one food search when a user may log only an existing catalog result and the application must preserve an immutable local nutrition/measurement snapshot?

## Executive recommendation

Use **USDA FoodData Central (FDC) as the only phase-one provider**, behind a small server-side `FoodCatalogProvider` adapter. The owner has confirmed a United States-first market.

FDC is the best fit for this phase because:

- its data is public domain and published under CC0, so the application may retain historical snapshots without a cache-expiration or share-alike obligation; USDA merely requests source attribution ([FDC API guide — Licensing](https://fdc.nal.usda.gov/api-guide/));
- it has a documented versioned REST API for text search and food detail, supports branded and generic foods, and allows GTIN/UPC searches through the same search facility ([FDC API guide](https://fdc.nal.usda.gov/api-guide/), [FDC help — identifiers and search](https://fdc.nal.usda.gov/help/));
- a registered `data.gov` key receives a documented default allowance of 1,000 requests/hour per IP, which is ample for a one-user self-hosted service ([FDC API guide — Rate Limits](https://fdc.nal.usda.gov/api-guide/)); and
- its missing nutrients and uneven portion metadata fit the already-approved nullable, provider-backed snapshot model rather than requiring the product to invent values ([FDC data-type documentation](https://fdc.nal.usda.gov/data-documentation/), [FDC FAQ — portions and measures](https://fdc.nal.usda.gov/faq/)).

Do **not** make Open Food Facts (OFF) the phase-one text-search provider. OFF remains a strong candidate for a later barcode-focused phase, especially outside the United States, but its current official documentation still says full-text search is unavailable in the current v2/v3 Product Opener APIs, the only Product Opener full-text endpoint is legacy, and the public search limit is 10 requests/minute with an explicit warning not to implement search-as-you-type ([OFF API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/)). Its ODbL/DbCL data and CC BY-SA images also add attribution/share-alike analysis that FDC avoids ([OFF terms of use](https://world.openfoodfacts.org/terms-of-use), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)).

Do not adopt a two-provider runtime for phase one. A fallback doubles ranking, deduplication, measurement, failure, and licensing behavior before the basic search-and-log loop is proven. Keep the provider port replaceable, then reconsider an **FDC text search + OFF barcode fallback** only when barcode scanning enters scope.

## Repository evidence and status

The authoritative [MVP specification](https://github.com/diegoagd10/open-calory-tracker/issues/13) and its [catalog-search](https://github.com/diegoagd10/open-calory-tracker/issues/19) and [snapshot-logging](https://github.com/diegoagd10/open-calory-tracker/issues/20) tickets require external-catalog-only phase-one logging, immutable local snapshots, nullable missing nutrients, and provider-backed measurement conversions. They approve FDC for the United States-first MVP subject to the integration spike in this report.

Open Food Facts appeared in deleted history, but that is prior art rather than a current decision:

- commit `d81b40e` implemented an OFF **barcode** prototype;
- commit `ae2a891` later included OFF barcode lookup and legacy `/cgi/search.pl` text search; and
- commit `ce08f89` recorded that OFF was suitable for barcode lookup but that a stable, recommended free-text contract had not been validated.

Those implementations and notes were removed by commit `0dcf71b`. No current application, package, provider adapter, API key, or selected catalog exists. Deleted specs in commit `567c39e` were vendor-neutral and required a provider spike; they did not approve OFF or USDA.

## Scope assumptions

- Phase one runs on the user's own Docker/Portainer server and calls the catalog from the React Router server, never directly from the browser.
- Initial traffic is approximately one user.
- Phase one needs text search, result selection, and logging; barcode capability is evaluated for future compatibility but barcode scanning is not part of this release.
- Every log operation persists a self-contained snapshot. Later provider edits must not rewrite history.
- Product images are not required for phase one. Catalog results and Food Entries are text-only.
- The confirmed initial market is **United States first**, matching FDC's catalog strengths.
- The application interface is English and provider product names remain in their original form.

## Decision matrix

| Criterion                       | USDA FoodData Central                                                                                                                                                                                                                                                                                                     | Open Food Facts                                                                                                                                                                                                                                                                                                                                                                                                                    | FatSecret Platform                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data/source model               | US government data system combining USDA analytical/survey data and manufacturer-supplied branded label data ([data types](https://fdc.nal.usda.gov/data-documentation/))                                                                                                                                                 | Collaborative global product database; contributors and manufacturers may supply data ([API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/))                                                                                                                                                                                                                                                              | Proprietary API/content license, revocable by provider ([terms](https://platform.fatsecret.com/terms))                                                                                                                                                                                                                                                      |
| License and immutable snapshots | **Strong fit:** public domain/CC0; indefinite local snapshot storage is allowed ([API guide](https://fdc.nal.usda.gov/api-guide/))                                                                                                                                                                                        | **Conditional fit:** ODbL database, DbCL contents, CC BY-SA images; internal use is exempt from ODbL share-alike, but public use/combining databases may trigger attribution and share-alike duties ([ODbL sections 4.3–4.6](https://opendatacommons.org/licenses/odbl/1-0/), [OFF reuse summary](https://support.openfoodfacts.org/help/en-gb/12-api-data-reuse/94-are-there-conditions-to-use-the-api))                          | **Reject:** nutrition content is not listed as indefinitely storable and generally must be removed/refetched within 24 hours; an internal-network-only production app is also disallowed without separate permission ([storable data](https://platform.fatsecret.com/docs/guides/storable-data), [terms 1.2 and 1.5](https://platform.fatsecret.com/terms)) |
| Credentials                     | Required `data.gov` API key; keep it server-side ([API guide](https://fdc.nal.usda.gov/api-guide/))                                                                                                                                                                                                                       | Reads require no account/key, but a custom identifying `User-Agent` is required/recommended and OFF asks reusers to submit its usage form ([API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/))                                                                                                                                                                                                          | Developer account plus OAuth client credentials/tokens ([authentication](https://platform.fatsecret.com/docs/guides/authentication), [OAuth 2](https://platform.fatsecret.com/docs/guides/authentication/oauth2))                                                                                                                                           |
| Documented rate                 | 1,000 requests/hour/IP for a registered key; 429 and a one-hour block on excess. `DEMO_KEY` has lower documented limits and is only for exploration ([API guide](https://fdc.nal.usda.gov/api-guide/))                                                                                                                    | 10 search requests/minute/IP; 15 product reads/minute/IP; global overload can return 503, and abusive clients may be IP-banned ([API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/))                                                                                                                                                                                                                     | 5,000 calls/day/application, subject to unilateral change ([terms 1.4](https://platform.fatsecret.com/terms))                                                                                                                                                                                                                                               |
| Text search                     | **Current, documented:** `/fdc/v1/foods/search` with query, pagination, data-type filters and detail lookup by `fdcId` ([API guide and OpenAPI](https://fdc.nal.usda.gov/api-guide/))                                                                                                                                     | **Weak phase-one fit:** v3 has no search; v2 has structured filters but not full text; full text is legacy `/cgi/search.pl` while Search-a-licious remains a separate evolving service ([API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/), [Search-a-licious repository](https://github.com/openfoodfacts/search-a-licious))                                                                           | Documented paged search with detailed servings, but unusable for immutable snapshots under the standard terms ([foods.search v3](https://platform.fatsecret.com/docs/v3/foods.search), [storable data](https://platform.fatsecret.com/docs/guides/storable-data))                                                                                           |
| Barcode/GTIN                    | No dedicated endpoint, but branded foods have `gtinUpc` and FDC documents searching by GTIN ([field descriptions](https://fdc.nal.usda.gov/docs/Download_Field_Descriptions_Oct2020.pdf), [help](https://fdc.nal.usda.gov/help/))                                                                                         | **Strong:** documented direct product-by-barcode endpoint, barcode normalization, and friendly not-found flow ([v3 product lookup](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/), [barcode tutorial](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/scanning-barcodes/))                                                                | Dedicated GTIN-13 endpoint, but barcode scope/premier access and storage terms apply ([barcode endpoint](https://platform.fatsecret.com/docs/v2/food.find_id_for_barcode))                                                                                                                                                                                  |
| Geography                       | Foundation/FNDDS/SR focus on US foods; branded market-country documentation currently identifies US and New Zealand ([FDC home](https://fdc.nal.usda.gov/), [branded documentation](https://fdc.nal.usda.gov/GBFPD_Documentation/))                                                                                       | Global, multilingual product catalog; depth is uneven because it is community supplied ([documentation overview](https://openfoodfacts.github.io/documentation/docs/), [terms — completeness](https://world.openfoodfacts.org/terms-of-use))                                                                                                                                                                                       | Localized, region-specific search and barcode lookup, but standard terms conflict with this deployment/snapshot model ([API demo](https://platform.fatsecret.com/api-demo), [terms](https://platform.fatsecret.com/terms))                                                                                                                                  |
| Nutrients and measures          | Strong nutrient vocabulary across data types; branded serving size and household text, plus `foodPortions` for some generic/survey foods. Not every food has every nutrient or serving measure ([FAQ](https://fdc.nal.usda.gov/faq/), [field descriptions](https://fdc.nal.usda.gov/portal-data/external/dataDictionary)) | Standardized per-100g/per-serving nutrient fields exist, but fields may be absent; serving text is contributor-entered and the normalized serving quantity is only present when derivable ([nutrition schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/), [product schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product/)) | Rich serving model and standardized derived servings in newer endpoints, but not persistable as the required snapshot under standard terms ([foods.search v4](https://platform.fatsecret.com/docs/v4/foods.search))                                                                                                                                         |
| Images                          | The documented FDC `BrandedFoodItem` API schema has no image field ([FDC OpenAPI](https://fdc.nal.usda.gov/api-spec/fdc_api.html))                                                                                                                                                                                        | Front/ingredients/nutrition/packaging image URLs are available; images are CC BY-SA and may include third-party packaging rights ([image guide](https://openfoodfacts.github.io/openfoodfacts-server/api/how-to-download-images/), [OFF terms](https://world.openfoodfacts.org/terms-of-use))                                                                                                                                      | Images require a separate premier offering ([foods.search v3](https://platform.fatsecret.com/docs/v3/foods.search))                                                                                                                                                                                                                                         |
| API evolution                   | URL is versioned `/fdc/v1`; official OpenAPI is published. No explicit support/SLA guarantee was found ([OpenAPI](https://fdc.nal.usda.gov/api-spec/fdc_api.html))                                                                                                                                                        | v3.6 is current, v2 deprecated, v1/v0 legacy; v3 is explicitly under active development and may change frequently ([API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/), [schema/API changelog](https://openfoodfacts.github.io/openfoodfacts-server/api/ref-api-and-product-schema-change-log/))                                                                                                         | Versioned endpoints, but service/content access and terms can change or terminate ([terms](https://platform.fatsecret.com/terms))                                                                                                                                                                                                                           |

FatSecret was examined because it is technically plausible—good full-text search, localization, servings and barcode—but it is not a viable finalist for this product. Its standard contract conflicts directly with both self-hosted internal deployment and permanent nutrition snapshots. No additional proprietary candidate merits an integration spike until it provides explicit indefinite storage rights.

## Provider analysis

### USDA FoodData Central

#### Catalog and freshness

FDC exposes distinct food types rather than one uniform catalog:

- **Branded Foods** contains manufacturer/data-provider label information and is updated monthly in the API.
- **Survey (FNDDS)** models foods and portion weights reported in the US dietary survey and is updated on the NHANES cycle.
- **Foundation Foods** provides analytically derived data and is updated twice yearly.
- **SR Legacy** is historical and its final release was in 2018.

These update cadences and data sources are documented by USDA ([data-type comparison](https://fdc.nal.usda.gov/data-documentation/), [FAQ](https://fdc.nal.usda.gov/faq/)). Phase one should query `Branded`, `Survey (FNDDS)`, and `Foundation`, but omit `SR Legacy` initially to reduce old/duplicate results.

There is a material freshness caveat: the branded database still updates monthly through GDSN, but it stopped receiving new or updated food-component data from Label Insight after 2023-11-16; existing Label Insight records remain ([FDC home](https://fdc.nal.usda.gov/)). Therefore, “monthly updates” does not mean every branded record is current.

FDC assigns a new `fdcId` when a food record changes, and multiple rows may share a GTIN/UPC across versions; USDA says publication date distinguishes the newest update ([FDC help](https://fdc.nal.usda.gov/help/), [field descriptions](https://fdc.nal.usda.gov/docs/Download_Field_Descriptions_Oct2020.pdf)). The search adapter must not treat GTIN as a unique database key. Logged history should preserve the selected `fdcId` and provider dates.

#### Data quality and missing values

Branded nutrition is supplied from product labels by data partners; providers are responsible for description, serving, nutrients and ingredients, while USDA standardizes presentation on a 100 g or 100 ml basis, depending on the provider-backed unit ([branded documentation](https://fdc.nal.usda.gov/GBFPD_Documentation/)). Label rounding can turn small nutrient amounts into zero, and provider corrections do not necessarily mean a reformulation ([branded documentation — standardization and update log](https://fdc.nal.usda.gov/GBFPD_Documentation/)).

Foundation Foods also does not guarantee every nutrient: a nutrient may truly not occur or may simply not have been analyzed ([Foundation Foods documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/)). This validates the product's `NULL = unknown/not reported` decision. Absence must never be coerced to zero.

Portions differ by data type. Branded foods expose label serving size/units and household serving text; generic/survey foods may expose multiple `foodPortions` with gram weights, but USDA explicitly says not every item has both 100-unit and serving measures ([FDC FAQ](https://fdc.nal.usda.gov/faq/), [download field descriptions](https://fdc.nal.usda.gov/portal-data/external/dataDictionary)). Only conversions with a positive provider-supplied gram/milliliter weight may be offered.

A read-only API probe on the research date also returned at least one implausible branded serving unit (`28 MG` for a ham result) and a search hit whose detail lookup returned 404. These are observations, not coverage statistics, but they demonstrate why the integration spike must validate units and tolerate search/detail drift rather than trusting the provider schema blindly. The official endpoints used were `/fdc/v1/foods/search` and `/fdc/v1/food/{fdcId}` as documented in the [API guide](https://fdc.nal.usda.gov/api-guide/).

#### Privacy and secrets

All calls should originate from the React Router server. `FDC_API_KEY` belongs in Portainer/Docker secrets or environment configuration and must never enter browser bundles or logs; USDA says exposed keys are deactivated ([API guide — Key Responsibility](https://fdc.nal.usda.gov/api-guide/)).

With server-side proxying, FDC receives the server IP, API key, and catalog query—not the application's username or food-log history. This is an architectural inference, not a special FDC privacy guarantee. USDA states that its sites automatically store IP/domain, device/browser, access time and pages visited, without cross-referencing or selling browsing information ([USDA privacy policy](https://www.usda.gov/privacy-policy)). The app should still avoid attaching user IDs to outbound requests and should not log raw queries together with authenticated identity.

### Open Food Facts

OFF is genuinely attractive for later barcode work: reads need no API key, the product-by-barcode contract is direct, product images are available, and the catalog is global. Its normalized `<nutrient>_100g` values have standard units; for example energy-kcal is kcal and weight-based nutrients are grams per 100 g/100 ml ([nutrition schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/)).

It is weaker for this phase's central requirement—plain-text name search. OFF's current API introduction identifies v3.6 as current for product lookup, but says v3 has no search, v2 only has structured filters, and full text remains the legacy `/cgi/search.pl`; it also points toward the separately evolving Search-a-licious service ([OFF API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/), [Search-a-licious source](https://github.com/openfoodfacts/search-a-licious)). That makes a new text-search integration depend on either a legacy endpoint or a service whose stable public contract and operational limits need their own validation.

OFF also disclaims accuracy, completeness and comprehensiveness because data is collaboratively entered ([API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/), [terms](https://world.openfoodfacts.org/terms-of-use)). This does not make OFF unusable; it means selection requires the same strict nullable validation and a visible source label.

For snapshots, the ODbL permits internal use of a derivative database without its public share-alike condition, but public use of produced works requires attribution and public use of a derivative database can require offering that derivative database under ODbL ([ODbL sections 4.3–4.6](https://opendatacommons.org/licenses/odbl/1-0/)). OFF's own reuse guidance says attribution and share-alike apply and warns that combining OFF with another database may require releasing the resulting database ([OFF API reuse conditions](https://support.openfoodfacts.org/help/en-gb/12-api-data-reuse/94-are-there-conditions-to-use-the-api)). For a single private instance the immediate burden is bounded, but public/multi-user expansion or mixing OFF and USDA data deserves a specific license review. This report is technical product research, not legal advice.

Images add another layer: OFF licenses contributor photos CC BY-SA, requires attribution, and warns that packaging may carry third-party copyrights/trademarks beyond the contributor's photo rights ([OFF terms](https://world.openfoodfacts.org/terms-of-use)). Do not copy OFF images into the private upload volume in phase one.

## Normalized provider contract

The application should own a narrow contract so provider JSON never reaches routes, forms, or database code directly:

```ts
type CatalogFood = {
  provider: "usda-fdc";
  providerFoodId: string;
  providerPublishedDate: string | null;
  name: string;
  brand: string | null;
  barcode: string | null;
  dataType: "Branded" | "Survey (FNDDS)" | "Foundation";
  marketCountry: string | null;
  measurements: CatalogMeasurement[];
  nutritionPerBase: NutritionSnapshot;
};

type NutritionSnapshot = {
  caloriesMilliKcal: number | null;
  proteinMg: number | null;
  carbohydrateMg: number | null;
  fatMg: number | null;
  fiberMg: number | null;
  sugarMg: number | null;
  sodiumMg: number | null;
};
```

`CatalogFood` is ephemeral search/detail data. When a user selects it, the server creates a separate immutable-source food-entry snapshot containing provider provenance, chosen measurement/quantity, and scaled fixed-point nutrients. The client sends only `providerFoodId`, measurement ID and quantity; the server refetches/validates detail and computes the snapshot so a manipulated browser cannot submit nutrition values.

### FDC field mapping

| Snapshot field          | FDC source                                                   | Mapping rule                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providerFoodId`        | `fdcId`                                                      | Decimal ID converted to string; required. Preserve the chosen revision rather than replacing it with a newer same-GTIN record.                                                                                                           |
| provenance dates        | `publicationDate`, `modifiedDate`                            | Store when returned; nullable.                                                                                                                                                                                                           |
| `name`                  | `description`                                                | Trim, Unicode-normalize for display/search only, require a non-empty bounded string. Preserve original display text in the snapshot.                                                                                                     |
| `brand`                 | `brandName`, then `brandOwner`                               | Optional; do not invent a brand for generic food.                                                                                                                                                                                        |
| `barcode`               | `gtinUpc`                                                    | Optional string; digits only after validation; preserve leading zeroes. Never parse as a JavaScript number.                                                                                                                              |
| catalog type/market     | `dataType`, `marketCountry`                                  | Allow-list supported data types; market nullable.                                                                                                                                                                                        |
| base nutrition          | `foodNutrients[].nutrient.id`, `.unitName`, `.amount`        | Match by numeric nutrient ID and validate unit; never match localized nutrient names. FDC's dictionary defines nutrient values on a 100-unit basis ([field descriptions](https://fdc.nal.usda.gov/portal-data/external/dataDictionary)). |
| branded serving         | `servingSize`, `servingSizeUnit`, `householdServingFullText` | Offer only when size is finite/positive and unit is exactly supported `g` or `ml`. Text is a label, not a conversion by itself.                                                                                                          |
| generic/survey measures | `foodPortions[].amount`, `.gramWeight`, `.measureUnit`       | Offer only finite positive provider-backed gram weights; otherwise retain only the canonical 100 g base.                                                                                                                                 |
| image                   | none                                                         | `null`; phase-one cards are text-only.                                                                                                                                                                                                   |

Use FDC nutrient IDs, not names:

- `1003` protein;
- `1004` total lipid/fat;
- `1005` carbohydrate by difference;
- `1079` total dietary fiber;
- `2000` total sugars; and
- `1093` sodium.

Energy needs data-type-specific precedence. FDC says legacy/general API energy ID `1008` continues for non-Foundation types, while Foundation Foods uses metabolizable energy IDs `2047` (Atwater general) and `2048` (Atwater specific) ([Foundation Foods — Energy](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/)). The spike must verify a deterministic precedence—proposed: `2048`, then `2047`, then `1008` for Foundation; `1008` for Branded/FNDDS—and must reject contradictory units.

Conversion into the approved storage model:

- kcal × 1,000 → `caloriesMilliKcal`;
- protein/carbohydrate/fat/fiber/sugar grams × 1,000 → milligrams;
- sodium must already be in mg; convert from g only if the nutrient's documented unit explicitly says g;
- missing/non-numeric/non-finite values → `NULL`, never zero;
- negative values → invalid provider data for that nutrient, recorded as `NULL` plus a structured diagnostic;
- apply integer rounding once at snapshot creation, then scale quantities from the unrounded validated base and round only at the fixed-point boundary; and
- keep quantity in millionths of the selected measurement, as already decided.

### What an OFF adapter would map later

If OFF is added for barcode lookup, map `code` as provider ID/barcode, localized `product_name*`, `brands`, `serving_quantity` plus `serving_quantity_unit`, and normalized `nutriments.energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`, `fat_100g`, `fiber_100g`, `sugars_100g`, and `sodium_100g`. OFF documents `_100g` as the normalized form to use and documents grams as the standard unit for weight-based nutrients, including sodium ([nutrition schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/)). Sodium would therefore be converted from grams to snapshot milligrams. Missing fields remain `NULL`.

Do not infer a serving conversion from free-form `serving_size`. Only accept OFF's normalized numeric `serving_quantity` with an allowed `g`/`ml` unit ([product schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product/)).

## Search, selection, and caching behavior

1. Require authentication before catalog search.
2. Accept a trimmed query of 2–100 characters and an allow-listed page size (for example, 20).
3. Call FDC from the server using the registered key, a short timeout and cancellation signal.
4. Search the three selected data types and return normalized candidates. Do not send FDC JSON to the browser.
5. Do not query on every keystroke. A 300–500 ms debounce after two characters would technically fit FDC's one-user allowance, but explicit submit (or a deliberate Search button) is more predictable and transfers cleanly if OFF is added later.
6. On selection, fetch `/food/{fdcId}` again, validate the full detail, and create the local snapshot in one SQLite transaction. Search results are discovery hints, not authoritative snapshot input.
7. Cache search responses only as a bounded performance optimization (for example, 15 minutes keyed by normalized query/data types/page), not as a local mirror. CC0 permits longer retention, but short caching reduces stale result IDs.
8. Never refresh an existing food entry from the provider. A user edit changes that local occurrence's snapshot; it does not mutate the catalog or other historical entries.

Because FDC data is CC0, persistent snapshots and test fixtures derived from responses are allowed. Still show “Source: USDA FoodData Central” on search results and logged entries because USDA requests attribution ([API guide](https://fdc.nal.usda.gov/api-guide/)).

## Expected failure states and required product behavior

| Failure                                       | Detection                                                                                                                             | Phase-one behavior                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty query / invalid length                  | Local Zod validation                                                                                                                  | 400; no provider call.                                                                                                                                    |
| No matches                                    | Successful search with empty `foods`                                                                                                  | 200 with `items: []`; show “No results”; create nothing.                                                                                                  |
| Missing/disabled key                          | FDC 403; api.data.gov documents missing/invalid/disabled key errors ([developer manual](https://api.data.gov/docs/developer-manual/)) | Log configuration-class error without the key; readiness may report catalog misconfigured; user sees provider unavailable.                                |
| Rate limited                                  | FDC 429 and rate headers ([API guide](https://fdc.nal.usda.gov/api-guide/))                                                           | Typed `rate_limited`, respect/reset conservatively, no retry storm.                                                                                       |
| Provider overload/outage/network timeout      | timeout, DNS/TLS/5xx                                                                                                                  | Typed `unavailable`; preserve current day/log; retry only on a new user action.                                                                           |
| Result disappears or changes before selection | detail 404 or detail identity differs                                                                                                 | Do not log stale search data; tell the user the result is no longer available and refresh search.                                                         |
| Missing nutrient                              | nutrient ID absent                                                                                                                    | Snapshot `NULL`; affected daily total is incomplete.                                                                                                      |
| Explicit zero                                 | valid nutrient amount `0`                                                                                                             | Snapshot integer zero; total remains known for that nutrient.                                                                                             |
| Unsupported/malformed unit or portion         | failed allow-list/finite/positive validation                                                                                          | Hide that measurement; if no safe base remains, mark result non-selectable.                                                                               |
| Duplicate/historical GTIN results             | same `gtinUpc`, different `fdcId`/publication date                                                                                    | Prefer newest published current record for display, retain provider ID/version in selection, and test that deduplication never merges different products. |
| Schema drift / unexpected JSON                | strict boundary schema that allows unknown extra fields but validates used fields                                                     | Typed `invalid_response`; capture field-level diagnostic without logging the whole response or user identity.                                             |
| User double-submits selection                 | local idempotency key                                                                                                                 | Return the first committed entry; do not create two accidental food events.                                                                               |

## Required compile/integration spike

Before converting this recommendation into the phase-one implementation spec, complete a bounded spike using a **registered FDC key**, not `DEMO_KEY`:

1. Compile a minimal TypeScript adapter under the selected React Router/Node versions with strict TypeScript and `skipLibCheck: false`.
2. Define runtime schemas for search and full detail. Permit unknown unused fields, but strictly validate every consumed field and numeric/unit boundary.
3. Prove server-only secret loading and confirm the API key is absent from client bundles, loader JSON, errors and logs.
4. Probe at least 10 representative US searches: generic produce, raw/cooked foods, a restaurant-style food, branded packaged foods, Spanish search text, exact brand/product, no result, punctuation, and a very broad query.
5. Probe at least 10 known GTIN/UPC values and record found/not-found, duplicate versions, market country, serving metadata and nutrient null rates. This validates future compatibility; it does not add barcode UI to phase one.
6. For every result, fetch detail and measure: search→detail consistency, missing fields, invalid units, duplicate GTINs, selectable measurement count, and availability of all seven required nutrition values. Do not present this small sample as catalog-wide coverage.
7. Verify energy precedence for Foundation, Branded and FNDDS against the FDC web display and label nutrients where available.
8. Verify nutrient scaling for 0.5, 1, 1.5 and 2 servings and for at least one gram-weighted generic portion; assert fixed-point results and display rounding separately.
9. Exercise 403, 404, 429, timeout, abort, 5xx, invalid JSON, partial nutrient and invalid serving-unit fixtures. Record actual rate-limit headers because documentation and gateway behavior can change.
10. Record p50/p95 observed latency only as local test evidence, choose a timeout, and ensure automated tests use captured/synthetic CC0 fixtures rather than the network.
11. Verify that the English interface presents original catalog names and United States catalog-type labels clearly.

## Decision-ready architecture

```text
React Router UI
  -> authenticated server loader/action
    -> FoodCatalogProvider port
      -> UsdaFoodDataCentralAdapter
        -> FDC /foods/search and /food/{fdcId}

selection
  -> refetch + validate full detail
    -> normalize measurements/nutrients
      -> SQLite immutable-source food-entry snapshot
```

Configuration:

```text
FOOD_CATALOG_PROVIDER=usda-fdc
FDC_API_KEY=<Portainer secret/environment value>
FDC_BASE_URL=https://api.nal.usda.gov/fdc/v1
FDC_MARKET_COUNTRY=United States
FDC_TIMEOUT_MS=<chosen by spike>
```

The base URL may be configurable for tests, but production must allow-list HTTPS FDC hosts so configuration cannot turn authenticated server requests into arbitrary SSRF.

## Risks

1. **US-centric catalog:** FDC is the wrong sole provider if the owner expects Mexican, European, or broadly international retail coverage. Confirm initial market.
2. **Branded freshness gaps:** some Label Insight records stopped receiving updates in 2023 even though the broader branded database continues monthly updates ([FDC home](https://fdc.nal.usda.gov/)).
3. **No catalog images:** FDC does not satisfy image-rich result cards. Phase one should deliberately ship text-only cards.
4. **Duplicates and stale IDs:** FDC uses new IDs for record updates and can return multiple GTIN versions. Deduplication/ranking needs explicit tests.
5. **Variable portions:** not every item provides a safe household/serving conversion. The UI must allow canonical grams when necessary and never invent conversions.
6. **Data is informative, not infallible:** manufacturer label rounding, missing analysis and source updates mean user edits remain necessary; snapshots preserve what was selected, not objective truth.
7. **No provider SLA found:** degrade gracefully and never make existing local logs dependent on live FDC availability.
8. **Future OFF licensing:** adding OFF later is not just another adapter; attribution, ODbL database separation/share-alike, and CC BY-SA image handling require a discrete decision.

## Resolved and deferred owner decisions

1. The phase-one market is the **United States**.
2. Search includes `Branded`, `Survey (FNDDS)`, and `Foundation` together and labels the result type. A filter may be reconsidered only if the integration spike demonstrates confusing duplicates.
3. The application interface is English and provider product names remain in their original form.
4. Phase-one catalog results and Food Entries are text-only; barcode scanning, product photos, and nutrition-label capture/extraction are deferred.
5. Whether OFF becomes a later barcode fallback is deferred until barcode work enters scope.

## Minimal acceptance-test checklist

- [ ] Registered FDC key is server-only and redacted from all logs/errors.
- [ ] Search success returns normalized, bounded `CatalogFood` records from supported data types.
- [ ] Empty/no-match search creates no local data.
- [ ] Selecting a result refetches detail; the browser cannot supply nutrition values.
- [ ] A valid selection stores name, provider ID/version, chosen measurement, quantity and all nutrients as a local immutable-source snapshot.
- [ ] Editing/updating a provider fixture after logging does not change the saved entry.
- [ ] Missing nutrient maps to `NULL`; explicit zero maps to `0`; affected totals report incomplete only for `NULL`.
- [ ] kcal, gram nutrients and sodium convert to the approved integer fixed-point units without premature display rounding.
- [ ] Only positive provider-backed `g`/`ml` or gram-weighted portion conversions are selectable.
- [ ] Leading-zero GTINs remain strings; duplicate GTIN versions do not collide.
- [ ] 403, 404, 429, timeout, abort, 5xx and malformed response produce typed, user-safe failures and no food entry.
- [ ] Search/detail provider failures do not affect reading, editing or deleting existing local logs.
- [ ] Search and logging queries are authorized by local `userId`; outbound provider calls contain no local username or food-log history.
- [ ] Automated tests run offline from CC0 fixtures; live provider probes are opt-in.
- [ ] Search results and logged source snapshots display USDA FoodData Central attribution.

## Final decision

**USDA FoodData Central is approved as the sole phase-one catalog for the confirmed United States-first market, contingent on the compile/integration spike.** Keep Open Food Facts out of phase-one text search; retain it as the leading later candidate for barcode fallback after a separate API-stability and ODbL/image-license review. Reject FatSecret under its standard terms because the required immutable nutrition snapshot and internal-network deployment are not permitted.
