import { buildUsdaGeneration, readUsdaGenerationFood, searchUsdaGeneration, withUsdaPhotoAnalysisGeneration, type UsdaGenerationBuild } from "../database/usda-generation.server.ts";
import { usdaPhotoAnalysisGenerationReadiness } from "../database/catalog-generation-validation.server.ts";
import type { CatalogManagement } from "../catalog-management/catalog-management.server";
import { CatalogNotInstalledError, CatalogFoodNotFoundError, CatalogReimportRequiredError, CatalogStaleReviewError, CatalogUnavailableError, type CatalogFood, type CatalogNutrientValue, type CatalogOperationContext, type CatalogSearchResult, type SearchFoodCatalogProvider } from "./food-catalog.server.ts";
import { boundedSearchTokens, normalizedSearchWords } from "./search-normalization.ts";
import type { UsdaAnalysisReader, UsdaEvidence, UsdaPhotoAnalysisCatalog, UsdaPhotoAnalysisReadiness, UsdaPhotoAnalysisSnapshot } from "./usda-evidence";

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

export function buildLocalUsdaGeneration(directory: string, generation: string, source: UsdaGenerationBuild, indexing: () => void) {
  buildUsdaGeneration(directory, generation, source, indexing, aliasesFor);
}

function evidenceAmount(value: CatalogNutrientValue | null, outputMultiplier: number): number | null {
  return value === null ? null : value.amount * value.fixedPointMultiplier / outputMultiplier;
}

function localEvidence(food: CatalogFood): UsdaEvidence {
  const nutrition = food.nutritionPerAuthoritativeBase;
  return {
    food,
    record: {
      fdcId: Number(food.providerFoodId),
      dataType: food.dataType,
      description: food.originalName,
      publicationDate: food.providerPublishedDate,
      nutrientsPer100g: {
        energyKcal: evidenceAmount(nutrition.energyMilliKcal, 1_000),
        proteinGrams: evidenceAmount(nutrition.proteinMilligrams, 1_000),
        carbohydrateGrams: evidenceAmount(nutrition.carbohydrateMilligrams, 1_000),
        fatGrams: evidenceAmount(nutrition.fatMilligrams, 1_000),
        fiberGrams: evidenceAmount(nutrition.fiberMilligrams, 1_000),
        sugarGrams: evidenceAmount(nutrition.sugarMilligrams, 1_000),
        sodiumMilligrams: evidenceAmount(nutrition.sodiumMilligrams, 1),
      },
      supportedPortions: food.measurements.map(measurement => ({
        id: measurement.id,
        label: measurement.label,
        gramWeight: measurement.baseQuantityMicrounits / 1_000_000,
      })),
    },
  };
}

export class LocalUsdaAdapter implements SearchFoodCatalogProvider, UsdaAnalysisReader, UsdaPhotoAnalysisCatalog {
  readonly #management: CatalogManagement;
  readonly #directory: string;
  constructor(management: CatalogManagement, directory: string) { this.#management = management; this.#directory = directory; }
  async #searchFoods(query: string): Promise<CatalogFood[]> {
    const tokens = boundedSearchTokens(query);
    if (!tokens) return [];
    let results: CatalogFood[] | undefined;
    try {
      results = await this.#management.withActiveGeneration(generation => searchUsdaGeneration(this.#directory, generation, searchExpression(tokens), name => relevance(name, tokens)));
    } catch {
      throw new CatalogUnavailableError();
    }
    if (!results) throw new CatalogNotInstalledError();
    return results;
  }
  async search(query: string): Promise<CatalogSearchResult[]> {
    return this.#searchFoods(query);
  }
  async getFood(providerFoodId: string, context?: CatalogOperationContext): Promise<CatalogFood> {
    if (!/^[1-9]\d*$/.test(providerFoodId)) throw new CatalogFoodNotFoundError();
    const food = await this.#management.withActiveGeneration(generation => {
      if (context?.reviewedCatalogGeneration !== undefined && context.reviewedCatalogGeneration !== generation) throw new CatalogStaleReviewError();
      return readUsdaGenerationFood(this.#directory, generation, providerFoodId);
    });
    if (food === undefined && !this.#management.read().installed) throw new CatalogNotInstalledError();
    if (!food) throw new CatalogFoodNotFoundError();
    return food;
  }
  async searchEvidence(query: string, page: number, signal: AbortSignal): Promise<UsdaEvidence[]> {
    signal.throwIfAborted();
    if (!Number.isInteger(page) || page < 1 || page > 3) throw new CatalogUnavailableError();
    const foods = await this.#searchFoods(query);
    signal.throwIfAborted();
    return foods.slice((page - 1) * 5, page * 5).map(localEvidence);
  }
  async getEvidence(id: string, signal: AbortSignal): Promise<UsdaEvidence> {
    signal.throwIfAborted();
    const food = await this.getFood(id);
    signal.throwIfAborted();
    return localEvidence(food);
  }
  async photoAnalysisReadiness(): Promise<UsdaPhotoAnalysisReadiness> {
    const result = await this.#management.withActiveGeneration(generation => ({
      generation,
      state: usdaPhotoAnalysisGenerationReadiness(this.#directory, generation),
    }));
    return result ?? { state: "not-installed" };
  }
  async withPhotoAnalysisSnapshot<T>(signal: AbortSignal, read: (snapshot: UsdaPhotoAnalysisSnapshot) => Promise<T> | T): Promise<T> {
    signal.throwIfAborted();
    const result = await this.#management.withActiveGeneration(async generation => {
      const readiness = usdaPhotoAnalysisGenerationReadiness(this.#directory, generation);
      if (readiness === "reimport-required") throw new CatalogReimportRequiredError();
      if (readiness === "unavailable") throw new CatalogUnavailableError();
      return { value: await withUsdaPhotoAnalysisGeneration(this.#directory, generation, async stored => await read({
        generation,
        categories: () => { signal.throwIfAborted(); return stored.categories(); },
        candidates: categoryId => {
          signal.throwIfAborted();
          return stored.candidates(categoryId).map(food => ({ fdcId: food.providerFoodId, description: food.originalName }));
        },
        evidence: fdcId => {
          signal.throwIfAborted();
          const food = stored.food(fdcId);
          if (!food) throw new CatalogFoodNotFoundError();
          return localEvidence(food);
        },
      })) };
    });
    if (!result) throw new CatalogNotInstalledError();
    return result.value;
  }
}
