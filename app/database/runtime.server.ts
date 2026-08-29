import path from "node:path";

import { z } from "zod";

import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./database.server";

const environmentSchema = z.object({
  DATABASE_PATH: z.string().trim().min(1).optional(),
  MIGRATIONS_PATH: z.string().trim().min(1).optional(),
});

let applicationDatabase: ApplicationDatabase | undefined;

export function initializeApplicationDatabase(): ApplicationDatabase {
  if (applicationDatabase) {
    return applicationDatabase;
  }

  const environment = environmentSchema.parse(process.env);

  applicationDatabase = openApplicationDatabase({
    databasePath:
      environment.DATABASE_PATH ??
      path.resolve("data", "open-calory-tracker.sqlite"),
    migrationsFolder:
      environment.MIGRATIONS_PATH ?? path.resolve("drizzle"),
  });

  return applicationDatabase;
}

export function getApplicationDatabase(): ApplicationDatabase {
  return applicationDatabase ?? initializeApplicationDatabase();
}

export function shutdownApplicationDatabase(): void {
  applicationDatabase?.close();
  applicationDatabase = undefined;
}
