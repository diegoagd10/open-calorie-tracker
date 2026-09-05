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
