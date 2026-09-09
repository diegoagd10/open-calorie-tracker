import type { PhotoAnalyzer } from "./photo-analysis.server";

export class TestPhotoAnalyzer implements PhotoAnalyzer {
  async analyze(input: Parameters<PhotoAnalyzer["analyze"]>[0]) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1800);
      input.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Canceled"));
        },
        { once: true },
      );
    });
    if (input.correction === "fail this analysis")
      throw new Error("Fixture failure");
    if (input.photo.bytes.subarray(-7).toString() === "no-food")
      return { status: "no_food" };
    if (input.photo.bytes.toString("utf8").endsWith("local-usda")) {
      try {
        const candidates = await input.usda.search("broccoli raw", 1);
        const candidate = candidates[0];
        if (!candidate) throw new Error("No matching local evidence");
        const evidence = await input.usda.detail(candidate.food.providerFoodId);
        return {
          name: "Photo broccoli plate",
          consumedFraction: 1,
          assumptions: ["The photo contains 100 g of raw broccoli"],
          components: [{
            id: "broccoli",
            name: evidence.food.name,
            quantity: 100,
            unit: "g",
            includes: [],
            source: { kind: "usda", fdcId: evidence.food.providerFoodId },
            supplements: [
              { nutrient: "proteinGrams", amount: 2.5, reason: "Installed Foundation fixture omits protein" },
              { nutrient: "carbohydrateGrams", amount: 6, reason: "Installed Foundation fixture omits carbohydrate" },
              { nutrient: "fatGrams", amount: 0.3, reason: "Installed Foundation fixture omits fat" },
            ],
          }],
        };
      } catch {
        return {
          name: "Estimated broccoli plate",
          consumedFraction: 1,
          assumptions: ["No suitable installed Foundation evidence was available"],
          components: [{
            id: "broccoli",
            name: "Broccoli",
            quantity: 100,
            unit: "g",
            includes: [],
            source: { kind: "ai", reason: "Installed Foundation evidence unavailable" },
            nutrition: {
              energyKcal: 32,
              proteinGrams: 2.5,
              carbohydrateGrams: 6,
              fatGrams: 0.3,
            },
          }],
        };
      }
    }
    return {
      name: "Photo rice plate",
      consumedFraction: 1,
      assumptions: ["Rice portion estimated from the photo"],
      components: [
        {
          id: "rice",
          name: "Cooked rice",
          quantity: 200,
          unit: "g",
          includes: [],
          source: { kind: "ai", reason: "Deterministic browser fixture" },
          nutrition: {
            energyKcal: input.correction ? 350 : 250,
            proteinGrams: 5,
            carbohydrateGrams: 50,
            fatGrams: 2,
          },
        },
      ],
    };
  }
}
