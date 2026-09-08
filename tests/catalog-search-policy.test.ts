import { describe, expect, test, vi } from "vitest";

import type { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import {
  CatalogConfigurationError,
  CatalogUnavailableError,
  type CatalogFood,
} from "../app/catalog/food-catalog.server";
import { LocalOpenFoodFactsAdapter } from "../app/catalog/local-off.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import {
  offSearchAliases,
  offSearchRelevance,
} from "../app/catalog/off-search.server";
import {
  boundedSearchTokens,
  controlledSingularPluralAliases,
  normalizedSearchWords,
  prefixSearchExpression,
} from "../app/catalog/search-normalization";

function packagedFood(overrides: Partial<CatalogFood> = {}): CatalogFood {
  return {
    authoritativeBaseQuantityMicrounits: 100_000_000,
    authoritativeBaseUnit: "g",
    barcode: "0012345678905",
    brand: "Maison Test",
    catalogGeneration: "generation-1",
    dataType: "Open Food Facts",
    isSelectable: true,
    marketCountry: null,
    measurementSummary: "100 g",
    measurements: [],
    name: "Crème brûlée",
    nutritionPerAuthoritativeBase: {
      carbohydrateMilligrams: null,
      energyMilliKcal: null,
      fatMilligrams: null,
      fiberMilligrams: null,
      proteinMilligrams: null,
      sodiumMilligrams: null,
      sugarMilligrams: null,
    },
    offSourceFields: {
      abbreviated_product_name: "Crème brûlée",
      abbreviated_product_name_en: "Custard",
      generic_name: "Dessert custard",
      generic_name_es: "Crema catalana",
      product_name_en: "  Creme brulee  ",
      product_name_es: "Crema quemada",
    },
    originalName: "Crème brûlée",
    provider: "open-food-facts",
    providerFoodId: "0012345678905",
    providerModifiedDate: null,
    providerPublishedDate: null,
    ...overrides,
  };
}

describe("catalog search normalization", () => {
  test("normalizes accents, case, punctuation, and numbers into words", () => {
    expect(normalizedSearchWords("  Crème-À LA 42!  ")).toEqual([
      "creme",
      "a",
      "la",
      "42",
    ]);
    expect(normalizedSearchWords("!!!")).toEqual([]);
  });

  test("accepts only bounded useful queries", () => {
    expect(boundedSearchTokens(" a ")).toBeUndefined();
    expect(boundedSearchTokens("!!")).toBeUndefined();
    expect(boundedSearchTokens("a bb")).toEqual(["a", "bb"]);
    expect(boundedSearchTokens("one two three four five six seven eight")).toHaveLength(8);
    expect(boundedSearchTokens("one two three four five six seven eight nine")).toBeUndefined();
    expect(boundedSearchTokens("x".repeat(100))).toEqual(["x".repeat(100)]);
    expect(boundedSearchTokens("x".repeat(101))).toBeUndefined();
  });

  test("quotes every token and adds prefix matching only to multi-letter words", () => {
    expect(prefixSearchExpression(["a", "egg", "not"])).toBe(
      '"a" AND "egg"* AND "not"*',
    );
    expect(prefixSearchExpression([])).toBe("");
  });

  test("adds only the supported singular or plural form within a phrase", () => {
    expect(controlledSingularPluralAliases("Egg noodles and tomatoes")).toEqual([
      "eggs noodles and tomatoes",
      "egg noodles and tomato",
    ]);
    expect(controlledSingularPluralAliases("Cereal snacks")).toEqual([]);
  });

  test.each([
    ["egg", "eggs"],
    ["carrot", "carrots"],
    ["tomato", "tomatoes"],
    ["lettuce", "lettuces"],
    ["zucchini", "zucchinis"],
    ["tilapia", "tilapias"],
    ["spinach", "spinaches"],
    ["huevo", "huevos"],
    ["zanahoria", "zanahorias"],
    ["tomate", "tomates"],
    ["lechuga", "lechugas"],
    ["espinaca", "espinacas"],
    ["calabacin", "calabacines"],
  ])("maps the controlled %s/%s pair in both directions", (singular, plural) => {
    expect(controlledSingularPluralAliases(singular)).toEqual([plural]);
    expect(controlledSingularPluralAliases(plural)).toEqual([singular]);
  });
});

describe("OFF search policy", () => {
  test("requires an installed local catalog for a valid query", async () => {
    const read = vi.fn(() => ({ installed: null }));
    const adapter = new LocalOpenFoodFactsAdapter(
      { read } as unknown as CatalogManagement,
      "/unused",
    );

    await expect(adapter.search("egg")).rejects.toBeInstanceOf(
      CatalogConfigurationError,
    );
    expect(read).toHaveBeenCalledOnce();
  });

  test.each([
    ["OFF", (management: CatalogManagement) => new LocalOpenFoodFactsAdapter(management, "/missing-catalog-directory")],
    ["USDA", (management: CatalogManagement) => new LocalUsdaAdapter(management, "/missing-catalog-directory")],
  ])("maps an unreadable installed %s generation to catalog unavailability", async (_label, adapterFor) => {
    const management = {
      read: () => ({ installed: { generation: "missing" } }),
    } as unknown as CatalogManagement;

    await expect(adapterFor(management).search("egg")).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });

  test("collects non-empty, distinct source aliases without repeating the display name", () => {
    expect(offSearchAliases(packagedFood())).toEqual([
      "Creme brulee",
      "Crema quemada",
      "Dessert custard",
      "Crema catalana",
      "Custard",
    ]);
    expect(offSearchAliases(packagedFood({ offSourceFields: undefined }))).toEqual([]);
    expect(offSearchAliases(packagedFood({
      name: "Egg noodles",
      offSourceFields: { product_name_en: "Egg noodles" },
    }))).toEqual(["eggs noodles"]);
  });

  test.each([
    ["exact normalized name", ["creme", "brulee"], 0],
    ["exact alias", ["dessert", "custard"], 1],
    ["exact brand", ["maison", "test"], 2],
    ["exact words", ["creme", "test"], 3],
    ["prefix words", ["cre", "mai"], 4],
  ] as const)("ranks %s", (_label, tokens, expected) => {
    expect(offSearchRelevance(packagedFood(), [...tokens])).toBe(expected);
  });

  test("requires every token and treats a one-letter token as an exact word", () => {
    expect(offSearchRelevance(packagedFood(), ["cre", "missing"])).toBeNull();
    expect(offSearchRelevance(packagedFood(), ["c"])).toBeNull();
    expect(offSearchRelevance(packagedFood(), ["creme", "mai"])).toBe(4);
    expect(
      offSearchRelevance(packagedFood({ name: "Vitamin A" }), ["a"]),
    ).toBe(3);
    expect(
      offSearchRelevance(packagedFood({ brand: null }), ["stryker"]),
    ).toBeNull();
  });

  test("does not confuse exact name, alias, and brand tiers", () => {
    const food = packagedFood({
      brand: "Brand phrase",
      name: "Name phrase",
      offSourceFields: { generic_name: "Alias phrase" },
    });
    expect(offSearchRelevance(food, ["name", "phrase"])).toBe(0);
    expect(offSearchRelevance(food, ["alias", "phrase"])).toBe(1);
    expect(offSearchRelevance(food, ["brand", "phrase"])).toBe(2);
  });
});
