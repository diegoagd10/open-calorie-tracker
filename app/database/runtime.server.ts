import path from "node:path";

import { z } from "zod";

import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./database.server";

function environmentSchema() {
  return z.object({
    DATABASE_PATH: z.string().optional(),
    MIGRATIONS_PATH: z.string().optional(),
  });
}

export function configuredPath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const candidate = value.trim();
  if (candidate === "") throw new Error("Configured database paths cannot be blank");
  return candidate;
}

let applicationDatabase: ApplicationDatabase | undefined;

export function initializeApplicationDatabase(): ApplicationDatabase {
  if (applicationDatabase) {
    return applicationDatabase;
  }

  const environment = environmentSchema().parse(process.env);

  applicationDatabase = openApplicationDatabase({
    databasePath:
      configuredPath(environment.DATABASE_PATH) ??
      path.resolve("data", "open-calory-tracker.sqlite"),
    migrationsFolder:
      configuredPath(environment.MIGRATIONS_PATH) ?? path.resolve("drizzle"),
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
