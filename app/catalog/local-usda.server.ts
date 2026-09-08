import { buildUsdaGeneration, readUsdaGenerationFood, searchUsdaGeneration } from "../database/usda-generation.server.ts";
import type { CatalogManagement } from "../catalog-management/catalog-management.server";
import { CatalogConfigurationError, CatalogFoodNotFoundError, CatalogUnavailableError, type CatalogFood, type CatalogSearchResult, type SearchFoodCatalogProvider } from "./food-catalog.server.ts";
import { boundedSearchTokens, normalizedSearchWords } from "./search-normalization.ts";

const basicFoodAliases = [
  { headings: ["egg", "eggs"], aliases: ["egg", "eggs", "huevo", "huevos"] },
  { headings: ["tilapia"], aliases: ["tilapia", "tilapias"] },
  { headings: ["broccoli"], aliases: ["broccoli", "brocoli"] },
  { headings: ["carrot", "carrots"], aliases: ["carrot", "carrots", "zanahoria", "zanahorias"] },
  { headings: ["spinach"], aliases: ["spinach", "espinaca", "espinacas"] },
  { headings: ["tomato", "tomatoes"], aliases: ["tomato", "tomatoes", "tomate", "tomates"] },
  { headings: ["lettuce"], aliases: ["lettuce", "lettuces", "lechuga", "lechugas"] },
  { headings: ["zucchini"], aliases: ["zucchini", "zucchinis", "calabacin", "calabacines"] },
];
function foodHeading(parts: string[]): string {
  if (parts[0] === "fish") return parts[1];
  if (parts[0] === "squash" && parts[1] === "summer") return parts[2] === "green" ? parts[3] : parts[2];
  return parts[0];
}
function aliasesFor(name: string): string[] {
  const parts = name.split(",").map(part => normalizedSearchWords(part).join(" "));
  // USDA uses category-led descriptions for fish and summer squash.
  const heading = foodHeading(parts);
  return basicFoodAliases.find(group => group.headings.includes(heading))?.aliases ?? [];
}
function searchExpression(tokens: string[]): string {
  return tokens.map(token => {
    if (token.length === 1) return `"${token}"`;
    const alternatives = basicFoodAliases.filter(group => group.aliases.some(alias => alias.startsWith(token))).flatMap(group => group.headings);
    return `("${token}"*${alternatives.map(alias => ` OR "${alias}"`).join("")})`;
  }).join(" AND ");
}

function relevance(name: string, tokens: string[]): number | null {
  const words = normalizedSearchWords(name);
  const aliases = aliasesFor(name);
  const searchable = [...words, ...aliases];
  if (!tokens.every(token => searchable.some(word => token.length === 1 ? word === token : word.startsWith(token)))) return null;
  const normalized = tokens.join(" ");
  if (words.join(" ") === normalized) return 0;
  if (aliases.includes(normalized)) return 1;
  if (aliases.some(alias => alias.startsWith(normalized)) || tokens.every(token => searchable.includes(token))) return 2;
  return 3;
}

export function buildLocalUsdaGeneration(directory: string, generation: string, foods: Iterable<CatalogFood>, indexing: () => void) {
  buildUsdaGeneration(directory, generation, foods, indexing, aliasesFor);
}

export class LocalUsdaAdapter implements SearchFoodCatalogProvider {
  readonly #management: CatalogManagement;
  readonly #directory: string;
  constructor(management: CatalogManagement, directory: string) { this.#management = management; this.#directory = directory; }
  async search(query: string): Promise<CatalogSearchResult[]> {
    const tokens = boundedSearchTokens(query);
    if (!tokens) return [];
    const generation = this.#generation();
    try {
      return searchUsdaGeneration(this.#directory, generation, searchExpression(tokens), name => relevance(name, tokens));
    } catch {
      throw new CatalogUnavailableError();
    }
  }
  async getFood(providerFoodId: string): Promise<CatalogFood> {
    if (!/^[1-9]\d*$/.test(providerFoodId)) throw new CatalogFoodNotFoundError();
    const food = readUsdaGenerationFood(this.#directory, this.#generation(), providerFoodId);
    if (!food) throw new CatalogFoodNotFoundError();
    return food;
  }

  #generation(): string {
    const installed = this.#management.read().installed;
    if (!installed) throw new CatalogConfigurationError();
    return installed.generation;
  }
}
