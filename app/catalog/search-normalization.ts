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
