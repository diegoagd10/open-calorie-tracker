// THROWAWAY PROTOTYPE: tests Gemini extraction followed by hierarchical Jev USDA selection.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createPartFromBase64, GoogleGenAI } from "@google/genai";
import { parse } from "csv-parse/sync";
import { z } from "zod";

const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_JEV_MODEL = "jev-1.13.0";
const DEFAULT_USDA_ARCHIVE = "/home/dagd/Downloads/FoodData_Central_foundation_food_csv_2026-04-30.zip";
const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const componentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  observedPreparation: z.array(z.string().trim().min(1).max(80)).max(8),
  visibleEvidence: z.array(z.string().trim().min(1).max(240)).max(8),
  estimatedQuantity: z.object({
    value: z.number().finite().positive().max(10_000),
    unit: z.enum(["g", "ml", "item", "serving"]),
    estimatedGrams: z.number().finite().positive().max(10_000).nullable(),
    description: z.string().trim().min(1).max(200),
  }),
  quantityConfidence: z.enum(["low", "medium", "high"]),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(8),
});

const geminiSchema = z
  .object({
    status: z.enum(["food", "no_food"]),
    mealDescription: z.string().trim().min(1).max(240).nullable(),
    components: z.array(componentSchema).max(8),
    overallAssumptions: z.array(z.string().trim().min(1).max(400)).max(12),
  })
  .superRefine((value, context) => {
    if (value.status === "food" && (value.mealDescription === null || value.components.length === 0)) {
      context.addIssue({ code: "custom", message: "Food needs a description and at least one component." });
    }
    if (value.status === "no_food" && (value.mealDescription !== null || value.components.length > 0)) {
      context.addIssue({ code: "custom", message: "No-food cannot contain a meal description or components." });
    }
  });

const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});

const jevResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), choiceAnswerSchema),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().nullable().optional(),
      output_tokens: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
});

const prompt = `
Describe the food visible in this photo as independently matchable nutritional components.

Rules:
- Separate visibly distinct foods even when they are mixed, such as egg and diced potato.
- Keep a prepared food together when its recipe ingredients are not individually visible, such as refried beans.
- Do not invent hidden oil, butter, seasoning, fillings, brands, or recipe ingredients.
- Never assume that a cooking fat was used, even in a phrase such as "minimal oil". Omit invisible cooking fats completely.
- Estimate consumed quantity from visible volume. For scrambled eggs, you may estimate an equivalent egg count, but mark uncertainty.
- Provide estimated grams when visually defensible; otherwise use null.
- Do not calculate calories or nutrients and do not write USDA search queries.
- Use concise English names and preparation terms.
- Return no_food when no recognizable food or drink is visible.

Return only one JSON object with exactly this shape:
{
  "status": "food" | "no_food",
  "mealDescription": string | null,
  "components": [{
    "name": string,
    "observedPreparation": string[],
    "visibleEvidence": string[],
    "estimatedQuantity": {
      "value": number,
      "unit": "g" | "ml" | "item" | "serving",
      "estimatedGrams": number | null,
      "description": string
    },
    "quantityConfidence": "low" | "medium" | "high",
    "assumptions": string[]
  }],
  "overallAssumptions": string[]
}
`.trim();

type Options = {
  imagePath: string;
  usdaArchive: string;
  geminiModel: string;
  jevModel: string;
};
type GeminiAnalysis = z.infer<typeof geminiSchema>;
type Component = z.infer<typeof componentSchema> & { id: string };
type ChoiceAnswer = z.infer<typeof choiceAnswerSchema>;
type UsdaFood = { fdcId: string; description: string; categoryId: string; category: string };
type Nutrition = {
  energyKcal: number | null;
  proteinGrams: number | null;
  carbohydrateGrams: number | null;
  fatGrams: number | null;
  fiberGrams: number | null;
  sugarGrams: number | null;
  sodiumMilligrams: number | null;
};

const nutritionKeys: Array<keyof Nutrition> = [
  "energyKcal",
  "proteinGrams",
  "carbohydrateGrams",
  "fatGrams",
  "fiberGrams",
  "sugarGrams",
  "sodiumMilligrams",
];

function usage(): string {
  return `Usage:
  GEMINI_API_KEY=... TYPESAFE_API_KEY=... pnpm prototype:gemini-jev -- /absolute/path/photo.jpg

Options:
  --usda PATH          Foundation CSV ZIP (default: ${DEFAULT_USDA_ARCHIVE})
  --gemini-model ID    Gemini model (default: ${DEFAULT_GEMINI_MODEL})
  --jev-model ID       Jev model (default: ${DEFAULT_JEV_MODEL})

This is a throwaway selection prototype. It calculates USDA nutrition in memory and persists nothing.
`;
}

function parseArguments(args: string[]): Options | null {
  if (args.includes("--help") || args.includes("-h")) return null;
  let imagePath: string | undefined;
  let usdaArchive = process.env.USDA_FOUNDATION_ARCHIVE?.trim() || DEFAULT_USDA_ARCHIVE;
  let geminiModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  let jevModel = process.env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (["--usda", "--gemini-model", "--jev-model"].includes(argument ?? "")) {
      const value = args[index + 1]?.trim();
      if (!value) throw new Error(`${argument} requires a value.`);
      if (argument === "--usda") usdaArchive = value;
      if (argument === "--gemini-model") geminiModel = value;
      if (argument === "--jev-model") jevModel = value;
      index += 1;
    } else if (argument?.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (imagePath) {
      throw new Error("Provide exactly one image path.");
    } else {
      imagePath = argument;
    }
  }

  if (!imagePath) throw new Error("Provide an image path.");
  return {
    imagePath: path.resolve(imagePath),
    usdaArchive: path.resolve(usdaArchive),
    geminiModel,
    jevModel,
  };
}

function imageMimeType(imagePath: string): "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif" {
  const extension = path.extname(imagePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".heic") return "image/heic";
  if (extension === ".heif") return "image/heif";
  throw new Error("Use a JPEG, PNG, WebP, HEIC, or HEIF image.");
}

function readArchiveCsv(archivePath: string, filename: string): Record<string, string>[] {
  const csv = execFileSync("unzip", ["-p", archivePath, `*/${filename}`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const rows: unknown = parse(csv, { columns: true, skip_empty_lines: true });
  return z.array(z.record(z.string(), z.string())).parse(rows);
}

function loadUsdaCatalog(archivePath: string): UsdaFood[] {
  const categoryNames = new Map(
    readArchiveCsv(archivePath, "food_category.csv").map((row) => [row.id, row.description]),
  );
  const foods = readArchiveCsv(archivePath, "food.csv")
    .filter((row) => row.data_type === "foundation_food")
    .map((row) => ({
      fdcId: row.fdc_id,
      description: row.description,
      categoryId: row.food_category_id,
      category: categoryNames.get(row.food_category_id) ?? "Unknown USDA category",
    }));
  if (foods.length === 0) throw new Error("The USDA archive contains no Foundation foods.");
  return foods;
}

function loadNutritionPer100g(archivePath: string, selectedIds: Set<string>): Map<string, Nutrition> {
  const units = new Map(readArchiveCsv(archivePath, "nutrient.csv").map((row) => [row.id, row.unit_name.toUpperCase()]));
  const amounts = new Map([...selectedIds].map((id) => [id, new Map<string, number | null>()]));
  for (const row of readArchiveCsv(archivePath, "food_nutrient.csv")) {
    const food = amounts.get(row.fdc_id);
    if (!food || !["1003", "1004", "1005", "1008", "1079", "1093", "2000", "2047", "2048"].includes(row.nutrient_id)) continue;
    const value = Number(row.amount);
    if (!Number.isFinite(value) || value < 0 || food.has(row.nutrient_id)) {
      food.set(row.nutrient_id, null);
    } else {
      food.set(row.nutrient_id, value);
    }
  }

  function nutrient(food: Map<string, number | null>, id: string, expectedUnit: string) {
    return units.get(id) === expectedUnit ? (food.get(id) ?? null) : null;
  }

  return new Map(
    [...amounts].map(([fdcId, food]) => [
      fdcId,
      {
        energyKcal:
          nutrient(food, "2048", "KCAL") ?? nutrient(food, "2047", "KCAL") ?? nutrient(food, "1008", "KCAL"),
        proteinGrams: nutrient(food, "1003", "G"),
        carbohydrateGrams: nutrient(food, "1005", "G"),
        fatGrams: nutrient(food, "1004", "G"),
        fiberGrams: nutrient(food, "1079", "G"),
        sugarGrams: nutrient(food, "2000", "G"),
        sodiumMilligrams: nutrient(food, "1093", "MG"),
      },
    ]),
  );
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function scaleNutrition(per100g: Nutrition, grams: number): Nutrition {
  return Object.fromEntries(
    nutritionKeys.map((key) => [key, per100g[key] === null ? null : rounded((per100g[key] * grams) / 100)]),
  ) as Nutrition;
}

function totalNutrition(components: Array<{ nutrition: Nutrition }>): Nutrition {
  return Object.fromEntries(
    nutritionKeys.map((key) => {
      const values = components.map((component) => component.nutrition[key]);
      return [key, values.some((value) => value === null) ? null : rounded(values.reduce<number>((sum, value) => sum + value!, 0))];
    }),
  ) as Nutrition;
}

function hasCoreNutrition(nutrition: Nutrition | undefined): nutrition is Nutrition {
  return Boolean(
    nutrition &&
      nutrition.energyKcal !== null &&
      nutrition.proteinGrams !== null &&
      nutrition.carbohydrateGrams !== null &&
      nutrition.fatGrams !== null,
  );
}

async function analyzePhoto(options: Options, apiKey: string): Promise<GeminiAnalysis> {
  const bytes = await readFile(options.imagePath);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error("Choose a non-empty image up to 8 MiB.");
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 30_000 } });
  const response = await client.models.generateContent({
    model: options.geminiModel,
    contents: [
      {
        role: "user",
        parts: [
          createPartFromBase64(bytes.toString("base64"), imageMimeType(options.imagePath)),
          { text: prompt },
        ],
      },
    ],
    config: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 8_192 },
  });
  if (!response.text) throw new Error("Gemini returned no text.");
  return geminiSchema.parse(JSON.parse(response.text));
}

async function askJev(
  state: unknown,
  questions: Record<string, unknown>,
  model: string,
  apiKey: string,
) {
  const response = await fetch(TYPESAFE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, questions, model }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`TypeSafe request failed (${response.status}).`);
  return jevResponseSchema.parse(await response.json());
}

function categoryCriteria(foods: UsdaFood[]) {
  const categories = new Map(foods.map((food) => [food.categoryId, food.category]));
  const criteria: Record<string, string> = Object.fromEntries(
    [...categories].sort((left, right) => left[1].localeCompare(right[1])).map(([id, name]) => [
      `category_${id}`,
      name,
    ]),
  );
  criteria.none = "No USDA Foundation category adequately represents this observed food";
  return criteria;
}

function componentState(analysis: GeminiAnalysis, components: Component[]) {
  return {
    mealDescription: analysis.mealDescription,
    components,
    instruction: "Judge only the foods described by Gemini. Do not infer hidden recipe ingredients.",
  };
}

function topProbabilities(answer: ChoiceAnswer, labels: Record<string, string>, limit = 5) {
  return Object.entries(answer.probabilities)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([option, probability]) => ({ option, label: labels[option] ?? option, probability }));
}

async function run(options: Options) {
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const typesafeApiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!geminiApiKey) throw new Error("Set GEMINI_API_KEY.");
  if (!typesafeApiKey) throw new Error("Set TYPESAFE_API_KEY.");

  const foods = loadUsdaCatalog(options.usdaArchive);
  const nutritionPer100g = loadNutritionPer100g(options.usdaArchive, new Set(foods.map((food) => food.fdcId)));
  const selectableFoods = foods.filter((food) => hasCoreNutrition(nutritionPer100g.get(food.fdcId)));
  if (selectableFoods.length === 0) throw new Error("The USDA archive contains no foods with complete core nutrition.");
  const analysis = await analyzePhoto(options, geminiApiKey);
  if (analysis.status === "no_food") {
    return { prototype: true, models: { gemini: options.geminiModel, jev: options.jevModel }, analysis };
  }

  const components = analysis.components.map((component, index) => ({ id: `component-${index + 1}`, ...component }));
  const categories = categoryCriteria(selectableFoods);
  const categoryQuestions = Object.fromEntries(
    components.map((component) => [
      component.id,
      {
        type: "choice",
        instructions: `Which USDA Foundation category best represents ${component.id}: ${component.name}?`,
        criteria: categories,
      },
    ]),
  );
  const categoryResponse = await askJev(componentState(analysis, components), categoryQuestions, options.jevModel, typesafeApiKey);

  const chosenCategories = new Map<string, string>();
  for (const component of components) {
    const choice = categoryResponse.answers[component.id]?.choice;
    if (choice?.startsWith("category_")) chosenCategories.set(component.id, choice.slice("category_".length));
  }

  const foodLabelsByComponent = new Map<string, Record<string, string>>();
  const productQuestions = Object.fromEntries(
    components.flatMap((component) => {
      const categoryId = chosenCategories.get(component.id);
      if (!categoryId) return [];
      const candidates = selectableFoods.filter((food) => food.categoryId === categoryId);
      if (candidates.length > 254) throw new Error(`USDA category ${categoryId} exceeds the Jev Choice limit.`);
      const labels = Object.fromEntries(candidates.map((food) => [`fdc_${food.fdcId}`, food.description]));
      labels.none = "No listed record has the same base food identity as this observed component";
      foodLabelsByComponent.set(component.id, labels);
      return [
        [
          component.id,
          {
            type: "choice",
            instructions: `Which USDA Foundation record best represents the food identity of ${component.id}: ${component.name}? Prefer an exact prepared-food record when one exists. Otherwise choose the closest base ingredient even when the record is raw and the observed food is cooked. Do not choose none merely because raw and cooked preparation differ; choose none only when the food identity differs. Do not infer hidden ingredients.`,
            criteria: labels,
          },
        ] as const,
      ];
    }),
  );

  const productResponse = Object.keys(productQuestions).length
    ? await askJev(
        { ...componentState(analysis, components), selectedCategories: Object.fromEntries(chosenCategories) },
        productQuestions,
        options.jevModel,
        typesafeApiKey,
      )
    : null;

  const selections = components.map((component) => {
    const categoryAnswer = categoryResponse.answers[component.id];
    if (!categoryAnswer) throw new Error(`Jev omitted the category answer for ${component.id}.`);
    const productAnswer = productResponse?.answers[component.id];
    const selectedFood = productAnswer?.choice.startsWith("fdc_")
      ? selectableFoods.find((food) => food.fdcId === productAnswer.choice.slice("fdc_".length))
      : undefined;
    const productLabels = foodLabelsByComponent.get(component.id) ?? {};
    return {
      component,
      category: {
        choice: categoryAnswer.choice,
        label: categories[categoryAnswer.choice] ?? categoryAnswer.choice,
        confidence: categoryAnswer.confidence,
        selectedProbability: categoryAnswer.probabilities[categoryAnswer.choice] ?? 0,
        topCandidates: topProbabilities(categoryAnswer, categories),
      },
      product: productAnswer
        ? {
            choice: productAnswer.choice,
            fdcId: selectedFood?.fdcId ?? null,
            description: selectedFood?.description ?? null,
            confidence: productAnswer.confidence,
            selectedProbability: productAnswer.probabilities[productAnswer.choice] ?? 0,
            candidateCount: Object.keys(productLabels).length,
            topCandidates: topProbabilities(productAnswer, productLabels),
          }
        : null,
    };
  });

  const unmatched = selections.filter(
    (selection) => !selection.product?.fdcId || selection.component.estimatedQuantity.estimatedGrams === null,
  );
  let appResult = null;
  if (unmatched.length === 0) {
    const appComponents = selections.map((selection) => {
      const fdcId = selection.product!.fdcId!;
      const grams = selection.component.estimatedQuantity.estimatedGrams!;
      const per100g = nutritionPer100g.get(fdcId);
      if (!per100g) throw new Error(`USDA nutrients are missing for FDC ${fdcId}.`);
      const nutrition = scaleNutrition(per100g, grams);
      if ([nutrition.energyKcal, nutrition.proteinGrams, nutrition.carbohydrateGrams, nutrition.fatGrams].some((value) => value === null)) {
        throw new Error(`USDA core nutrients are incomplete for FDC ${fdcId}.`);
      }
      return {
        id: selection.component.id,
        name: selection.component.name,
        quantity: grams,
        unit: "g" as const,
        includes: [],
        source: { kind: "usda" as const, fdcId, dataType: "Foundation" as const },
        supplements: [],
        nutrition,
      };
    });
    appResult = {
      name: analysis.mealDescription,
      consumedFraction: 1,
      assumptions: [
        "Component quantities are Gemini visual estimates.",
        "Nutrition is calculated from the Jev-selected USDA Foundation records.",
        "Unobserved cooking fats and seasonings are excluded.",
      ],
      components: appComponents,
      totals: totalNutrition(appComponents),
    };
  }

  return {
    prototype: true,
    input: {
      image: options.imagePath,
      usdaArchive: options.usdaArchive,
      usdaFoodCount: foods.length,
      usdaSelectableFoodCount: selectableFoods.length,
    },
    models: { gemini: options.geminiModel, jev: productResponse?.model ?? categoryResponse.model },
    gemini: analysis,
    jevUsage: { category: categoryResponse.usage ?? null, product: productResponse?.usage ?? null },
    selections,
    appResult,
    unmatchedComponents: unmatched.map((selection) => selection.component.id),
  };
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (!options) {
      process.stdout.write(usage());
      return;
    }
    process.stdout.write(`${JSON.stringify(await run(options), null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prototype failed.";
    process.stderr.write(`Error: ${message}\n\n${usage()}`);
    process.exitCode = 1;
  }
}

await main();
