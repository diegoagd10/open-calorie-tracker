CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timezone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  quantity_basis TEXT NOT NULL,
  basis_quantity REAL NOT NULL DEFAULT 1,
  calories REAL NOT NULL,
  protein REAL,
  carbohydrates REAL,
  fat REAL,
  fiber REAL,
  added_sugar REAL,
  sugar REAL,
  saturated_fat REAL,
  sodium REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS foods_name_idx ON foods(name);

CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meals_name_idx ON meals(name);

CREATE TABLE IF NOT EXISTS meal_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity_value REAL NOT NULL,
  quantity_display TEXT NOT NULL,
  quantity_unit TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meal_ingredients_meal_idx ON meal_ingredients(meal_id);

CREATE TABLE IF NOT EXISTS food_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  meal_id INTEGER REFERENCES meals(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  logged_at_utc TEXT NOT NULL,
  meal_tag TEXT,
  quantity_value REAL NOT NULL,
  quantity_display TEXT NOT NULL,
  quantity_unit TEXT NOT NULL,
  quantity_basis TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  calories REAL NOT NULL,
  protein REAL,
  carbohydrates REAL,
  fat REAL,
  fiber REAL,
  added_sugar REAL,
  sugar REAL,
  saturated_fat REAL,
  sodium REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS food_entries_logged_at_idx ON food_entries(logged_at_utc);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  food_id INTEGER REFERENCES foods(id) ON DELETE CASCADE,
  meal_id INTEGER REFERENCES meals(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK ((food_id IS NOT NULL AND meal_id IS NULL) OR (food_id IS NULL AND meal_id IS NOT NULL)
));
CREATE UNIQUE INDEX IF NOT EXISTS favorites_food_unique ON favorites(food_id);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_meal_unique ON favorites(meal_id);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  managed_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  meal_id INTEGER REFERENCES meals(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS images_food_idx ON images(food_id);
CREATE INDEX IF NOT EXISTS images_meal_idx ON images(meal_id);

CREATE TABLE IF NOT EXISTS nutrition_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  plan TEXT,
  calories REAL,
  references_json TEXT NOT NULL,
  metadata_json TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
