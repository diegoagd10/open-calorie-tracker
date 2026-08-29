import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./app/database/schema.server.ts",
  out: "./drizzle",
});
