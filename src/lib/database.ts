import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { FoodLogRepository } from "./food-log-repository";
import { IntakeService } from "./intake-service";
import { ProductRepository } from "./product-repository";
import { SettingsRepository } from "./settings-repository";
import { TargetRepository } from "./target-repository";
import { WaterRepository } from "./water-repository";
import { WeightRepository } from "./weight-repository";

export const databasePath =
  process.env.DAILY_INTAKE_DB_PATH ??
  process.env.CALORIE_DB_PATH ??
  join(process.cwd(), "data", "calories.db");

mkdirSync(dirname(databasePath), { recursive: true });

export class IntakeDatabase {
  readonly connection: Database.Database;
  readonly userId: string;

  constructor(path: string) {
    this.connection = new Database(path);
    this.connection.pragma("foreign_keys = ON");
    this.initializeSchema();
    this.userId = this.bootstrapUser();
    this.migrateLegacyCalorieEntries();
  }

  close(): void {
    this.connection.close();
  }

  private initializeSchema(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS calorie_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        calories INTEGER NOT NULL CHECK (calories > 0),
        entry_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        name_normalized TEXT NOT NULL,
        measurement_type TEXT NOT NULL DEFAULT 'serving'
          CHECK (measurement_type = 'serving'),
        serving_description TEXT NOT NULL,
        calories_per_serving_cal REAL NOT NULL CHECK (calories_per_serving_cal >= 0),
        protein_per_serving_g REAL NOT NULL CHECK (protein_per_serving_g >= 0),
        carbs_per_serving_g REAL NOT NULL CHECK (carbs_per_serving_g >= 0),
        fat_per_serving_g REAL NOT NULL CHECK (fat_per_serving_g >= 0),
        fiber_per_serving_g REAL NOT NULL CHECK (fiber_per_serving_g >= 0),
        sugar_per_serving_g REAL NOT NULL CHECK (sugar_per_serving_g >= 0),
        sodium_per_serving_mg REAL NOT NULL CHECK (sodium_per_serving_mg >= 0),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, name_normalized)
      );

      CREATE INDEX IF NOT EXISTS products_search_idx
        ON products (user_id, status, name_normalized);

      CREATE TABLE IF NOT EXISTS food_log_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        entry_date TEXT NOT NULL,
        product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
        title_snapshot TEXT NOT NULL,
        serving_description_snapshot TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        calories_per_serving_cal REAL NOT NULL CHECK (calories_per_serving_cal >= 0),
        protein_per_serving_g REAL NOT NULL CHECK (protein_per_serving_g >= 0),
        carbs_per_serving_g REAL NOT NULL CHECK (carbs_per_serving_g >= 0),
        fat_per_serving_g REAL NOT NULL CHECK (fat_per_serving_g >= 0),
        fiber_per_serving_g REAL NOT NULL CHECK (fiber_per_serving_g >= 0),
        sugar_per_serving_g REAL NOT NULL CHECK (sugar_per_serving_g >= 0),
        sodium_per_serving_mg REAL NOT NULL CHECK (sodium_per_serving_mg >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS food_log_date_idx
        ON food_log_entries (user_id, entry_date, created_at DESC);

      CREATE TABLE IF NOT EXISTS daily_target_versions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        effective_date TEXT NOT NULL,
        calorie_maximum_cal REAL NOT NULL CHECK (calorie_maximum_cal >= 0),
        protein_minimum_g REAL NOT NULL CHECK (protein_minimum_g >= 0),
        carbs_maximum_g REAL NOT NULL CHECK (carbs_maximum_g >= 0),
        fiber_maximum_g REAL NOT NULL CHECK (fiber_maximum_g >= 0),
        sugar_maximum_g REAL NOT NULL CHECK (sugar_maximum_g >= 0),
        sodium_maximum_mg REAL NOT NULL CHECK (sodium_maximum_mg >= 0),
        water_minimum_fl_oz REAL NOT NULL CHECK (water_minimum_fl_oz >= 0),
        fat_rule TEXT NOT NULL DEFAULT 'calorie-30-percent'
          CHECK (fat_rule = 'calorie-30-percent'),
        created_sequence INTEGER NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS target_resolution_idx
        ON daily_target_versions (user_id, effective_date DESC, created_sequence DESC);

      CREATE TABLE IF NOT EXISTS water_days (
        user_id TEXT NOT NULL REFERENCES users(id),
        entry_date TEXT NOT NULL,
        total_fluid_oz REAL NOT NULL DEFAULT 0 CHECK (total_fluid_oz >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, entry_date)
      );

      CREATE TABLE IF NOT EXISTS weight_entries (
        user_id TEXT NOT NULL REFERENCES users(id),
        entry_date TEXT NOT NULL,
        weight_lb REAL NOT NULL CHECK (weight_lb > 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, entry_date)
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        target_weight_lb REAL CHECK (target_weight_lb IS NULL OR target_weight_lb > 0),
        updated_at TEXT NOT NULL
      );
    `);
  }

  private bootstrapUser(): string {
    const existing = this.connection
      .prepare("SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1")
      .get() as { id: string } | undefined;
    if (existing) return existing.id;

    const id = randomUUID();
    this.connection
      .prepare("INSERT INTO users (id, created_at) VALUES (?, ?)")
      .run(id, new Date().toISOString());
    return id;
  }

  private migrateLegacyCalorieEntries(): void {
    const migrationVersion = 1;
    const migrate = this.connection.transaction(() => {
      // Serialize startup across Next.js build workers and server processes.
      const applied = this.connection
        .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
        .get(migrationVersion);
      if (applied) return;

      const legacyTable = this.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calorie_entries'",
        )
        .get();

      if (legacyTable) {
        const legacyEntries = this.connection
          .prepare(
            `SELECT name, calories, entry_date, created_at
             FROM calorie_entries
             ORDER BY id ASC`,
          )
          .all() as Array<{
          name: string;
          calories: number;
          entry_date: string;
          created_at: string | null;
        }>;
        const insert = this.connection.prepare(`
          INSERT INTO food_log_entries (
            id, user_id, entry_date, product_id, title_snapshot,
            serving_description_snapshot, quantity,
            calories_per_serving_cal, protein_per_serving_g,
            carbs_per_serving_g, fat_per_serving_g, fiber_per_serving_g,
            sugar_per_serving_g, sodium_per_serving_mg, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, ?, ?, 1, ?, 0, 0, 0, 0, 0, 0, ?, ?)
        `);

        for (const entry of legacyEntries) {
          const timestamp = entry.created_at ?? new Date().toISOString();
          insert.run(
            randomUUID(),
            this.userId,
            entry.entry_date,
            entry.name,
            "Imported legacy calorie entry",
            entry.calories,
            timestamp,
            timestamp,
          );
        }
      }

      this.connection
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        )
        .run(migrationVersion, new Date().toISOString());
    });
    migrate.immediate();
  }
}

export const intakeDatabase = new IntakeDatabase(databasePath);
export const productRepository = new ProductRepository(
  intakeDatabase.connection,
  intakeDatabase.userId,
);
export const foodLogRepository = new FoodLogRepository(
  intakeDatabase.connection,
  intakeDatabase.userId,
);
export const targetRepository = new TargetRepository(
  intakeDatabase.connection,
  intakeDatabase.userId,
);
export const waterRepository = new WaterRepository(
  intakeDatabase.connection,
  intakeDatabase.userId,
);
export const weightRepository = new WeightRepository(
  intakeDatabase.connection,
  intakeDatabase.userId,
);
export const settingsRepository = new SettingsRepository(
  intakeDatabase.connection,
  intakeDatabase.userId,
);
export const intakeService = new IntakeService(
  productRepository,
  foodLogRepository,
  intakeDatabase.userId,
  targetRepository,
  waterRepository,
  weightRepository,
  settingsRepository,
);
