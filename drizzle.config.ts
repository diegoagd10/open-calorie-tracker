import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./app/database/schema.server.ts",
    "./app/water-event/water-event.schema.server.ts",
    "./app/daily-goal/daily-goal.schema.server.ts",
    "./app/food-event/food-event.schema.server.ts",
  ],
  out: "./drizzle",
});
