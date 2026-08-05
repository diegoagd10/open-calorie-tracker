import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CalorieRepository } from "./calorie-repository";

const databasePath =
  process.env.CALORIE_DB_PATH ?? join(process.cwd(), "data", "calories.db");

mkdirSync(dirname(databasePath), { recursive: true });

export const calorieRepository = new CalorieRepository(databasePath);
