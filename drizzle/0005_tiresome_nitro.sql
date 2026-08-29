ALTER TABLE `food_entries` ADD `authoritative_nutrition` text DEFAULT '{"carbohydrateMilligrams":null,"energyMilliKcal":null,"fatMilligrams":null,"fiberMilligrams":null,"proteinMilligrams":null,"sodiumMilligrams":null,"sugarMilligrams":null}' NOT NULL;
--> statement-breakpoint
UPDATE `application_metadata`
SET `value` = '6', `updated_at` = CURRENT_TIMESTAMP
WHERE `key` = 'schema_version';
