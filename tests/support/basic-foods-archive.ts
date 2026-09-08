import { foundationArchive } from "./foundation-archive";
import { readFile } from "node:fs/promises";

// Synthetic relevance corpus; each preparation has its own source identity and nutrition.
export async function basicFoodsArchive(researchRecords = 0) {
  const foods: [number, string, number | null][] = [
    [101, "Eggs, whole, raw", 147],
    [102, "Eggs, whole, cooked, scrambled", 180],
    [103, "Eggplant, raw", 25],
    [104, "Egg noodles, enriched", 138],
    [105, "Fish, tilapia, raw", 96],
    [106, "Fish, tilapia, cooked, dry heat", 128],
    [107, "Broccoli, raw", 32],
    [108, "Broccoli, frozen, chopped, unprepared", 29],
    [109, "Carrots, raw", 41],
    [110, "Spinach, raw", 23],
    [111, "Tomatoes, raw", 18],
    [112, "Lettuce, green leaf, raw", 15],
    [113, "Squash, summer, green, zucchini, includes skin, raw", 17],
    [114, "Egg substitute, liquid", 50],
    [115, "Spinach", 23],
    [116, "Épinard, raw", 23],
    [999, "Eggs, whole, raw", null],
    [998, "Eggs, whole, raw", 147],
    ...Array.from({ length: 30 }, (_, index): [number, string, number] => [200 + index, `Broccoli soup mix ${index}`, 300]),
  ];
  const originalFoods = await readFile("tests/fixtures/usda-foundation/food.csv", "utf8");
  const originalNutrients = await readFile("tests/fixtures/usda-foundation/food_nutrient.csv", "utf8");
  const nutrientColumns = originalNutrients.split("\n")[0].split(",").length;
  const research = Array.from({ length: researchRecords }, (_, index) => `${9000000 + index},sample_food,Research sample,1,2026-01-01`).join("\n");
  return foundationArchive({
    "food.csv": originalFoods + foods.map(([id, name]) => `${id},foundation_food,"${name}",1,2026-01-01`).join("\n") + "\n" + research + "\n",
    "food_nutrient.csv": originalNutrients + foods.filter(([, , energy]) => energy !== null).map(([id, , energy]) => [`${id}`, `${id}`, "2048", `${energy}`, ...Array<string>(nutrientColumns - 4).fill("")].join(",")).join("\n") + "\n",
  });
}
