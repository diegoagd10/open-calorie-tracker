export function normalizedSearchWords(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function boundedSearchTokens(query: string): string[] | undefined {
  if (query.length > 100) return undefined;
  const tokens = normalizedSearchWords(query);
  if (tokens.length > 8 || !tokens.some(token => token.length >= 2)) return undefined;
  return tokens;
}

export function prefixSearchExpression(tokens: string[]): string {
  return tokens.map(token => token.length === 1 ? `"${token}"` : `"${token}"*`).join(" AND ");
}

export function controlledSingularPluralAliases(value: string): string[] {
  const pairs = [
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
  ] as const;
  const words = normalizedSearchWords(value);
  return words.flatMap((word, index) => {
    const pair = pairs.find(([singular, plural]) =>
      word === singular || word === plural
    );
    const replacement = pair?.[word === pair[0] ? 1 : 0];
    if (!replacement) return [];
    const alias = [...words];
    alias[index] = replacement;
    return [alias.join(" ")];
  });
}
