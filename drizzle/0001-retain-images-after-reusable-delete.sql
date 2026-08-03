CREATE TABLE images_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  managed_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  meal_id INTEGER REFERENCES meals(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
INSERT INTO images_new (id, managed_name, original_name, mime_type, byte_size, food_id, meal_id, created_at)
  SELECT id, managed_name, original_name, mime_type, byte_size, food_id, meal_id, created_at FROM images;
DROP INDEX IF EXISTS images_food_idx;
DROP INDEX IF EXISTS images_meal_idx;
DROP TABLE images;
ALTER TABLE images_new RENAME TO images;
CREATE INDEX images_food_idx ON images(food_id);
CREATE INDEX images_meal_idx ON images(meal_id);
