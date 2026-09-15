import { describe, expect, test } from "vitest";

import type { CatalogManagement } from "../app/catalog-management/catalog-management.server";
import { CatalogUnavailableError } from "../app/catalog/food-catalog.server";
import { LocalUsdaAdapter } from "../app/catalog/local-usda.server";
import {
  boundedSearchTokens,
  controlledSingularPluralAliases,
  normalizedSearchWords,
  prefixSearchExpression,
} from "../app/catalog/search-normalization";

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

describe("USDA search policy", () => {
  test("maps an unreadable installed generation to catalog unavailability", async () => {
    const management = {
      read: () => ({ installed: { generation: "missing" } }),
      withActiveGeneration: <T>(read: (generation: string) => T) => read("missing"),
    } as unknown as CatalogManagement;

    await expect(new LocalUsdaAdapter(management, "/missing-catalog-directory").search("egg")).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });
});
