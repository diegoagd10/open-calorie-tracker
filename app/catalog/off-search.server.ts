import type { CatalogFood } from "./food-catalog.server.ts";
import { normalizedSearchWords } from "./search-normalization.ts";

const aliasFields = [
  "product_name_en",
  "product_name_es",
  "generic_name",
  "generic_name_en",
  "generic_name_es",
  "abbreviated_product_name",
  "abbreviated_product_name_en",
  "abbreviated_product_name_es",
] as const;

function normalizedPhrase(value: string): string {
  return normalizedSearchWords(value).join(" ");
}

export function offSearchAliases(food: CatalogFood): string[] {
  const values = aliasFields
    .map(field => food.offSourceFields?.[field]?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(values.filter(value => value !== food.name))];
}

export function offSearchRelevance(food: CatalogFood, tokens: string[]): number | null {
  const name = normalizedPhrase(food.name);
  const aliases = offSearchAliases(food).map(normalizedPhrase);
  const brand = normalizedPhrase(food.brand ?? "");
  const words = [name, ...aliases, brand].flatMap(normalizedSearchWords);
  if (!tokens.every(token => words.some(word => token.length === 1 ? word === token : word.startsWith(token)))) return null;
  const query = tokens.join(" ");
  if (name === query) return 0;
  if (aliases.includes(query)) return 1;
  if (brand === query) return 2;
  if (tokens.every(token => words.includes(token))) return 3;
  return 4;
}
