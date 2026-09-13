PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_food_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`food_log_date` text NOT NULL,
	`local_event_time` text NOT NULL,
	`provider` text NOT NULL,
	`provider_food_id` text NOT NULL,
	`provider_published_date` text,
	`provider_modified_date` text,
	`source_data_type` text NOT NULL,
	`original_name` text NOT NULL,
	`edited_name` text,
	`brand` text,
	`barcode` text,
	`market_country` text,
	`authoritative_base_unit` text NOT NULL,
	`authoritative_base_quantity_microunits` integer NOT NULL,
	`authoritative_nutrition` text DEFAULT '{"carbohydrateMilligrams":null,"energyMilliKcal":null,"fatMilligrams":null,"fiberMilligrams":null,"proteinMilligrams":null,"sodiumMilligrams":null,"sugarMilligrams":null}' NOT NULL,
	`selected_measurement_id` text NOT NULL,
	`selected_measurement_label` text NOT NULL,
	`selected_measurement_unit` text NOT NULL,
	`selected_measurement_base_quantity_microunits` integer NOT NULL,
	`supported_measurements` text DEFAULT '[]' NOT NULL,
	`quantity_microunits` integer NOT NULL,
	`authoritative_energy_milli_kcal` integer,
	`authoritative_protein_milligrams` integer,
	`authoritative_carbohydrate_milligrams` integer,
	`authoritative_fat_milligrams` integer,
	`authoritative_fiber_milligrams` integer,
	`authoritative_sugar_milligrams` integer,
	`authoritative_sodium_milligrams` integer,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "food_entries_provider_check" CHECK("__new_food_entries"."provider" IN ('usda-fdc', 'open-food-facts', 'manual', 'ai-photo')),
	CONSTRAINT "food_entries_data_type_check" CHECK("__new_food_entries"."source_data_type" IN ('Branded', 'Survey (FNDDS)', 'Foundation', 'Open Food Facts', 'User entered', 'AI analysis')),
	CONSTRAINT "food_entries_units_check" CHECK("__new_food_entries"."authoritative_base_unit" IN ('g', 'ml', 'serving')
        AND "__new_food_entries"."selected_measurement_unit" IN ('g', 'ml', 'serving')),
	CONSTRAINT "food_entries_provider_semantics_check" CHECK(("__new_food_entries"."provider" = 'usda-fdc'
          AND "__new_food_entries"."source_data_type" IN ('Branded', 'Survey (FNDDS)', 'Foundation')
          AND "__new_food_entries"."authoritative_base_unit" IN ('g', 'ml')
          AND "__new_food_entries"."selected_measurement_unit" IN ('g', 'ml'))
        OR ("__new_food_entries"."provider" = 'open-food-facts'
          AND "__new_food_entries"."source_data_type" = 'Open Food Facts'
          AND "__new_food_entries"."selected_measurement_unit" = "__new_food_entries"."authoritative_base_unit"
          AND (("__new_food_entries"."authoritative_base_unit" = 'serving' AND "__new_food_entries"."authoritative_base_quantity_microunits" = 1000000)
            OR ("__new_food_entries"."authoritative_base_unit" IN ('g', 'ml') AND "__new_food_entries"."authoritative_base_quantity_microunits" > 0)))
        OR ("__new_food_entries"."provider" = 'manual'
          AND "__new_food_entries"."source_data_type" = 'User entered'
          AND "__new_food_entries"."authoritative_base_unit" = 'serving'
          AND "__new_food_entries"."selected_measurement_unit" = 'serving')
        OR ("__new_food_entries"."provider" = 'ai-photo'
          AND "__new_food_entries"."source_data_type" = 'AI analysis'
          AND "__new_food_entries"."authoritative_base_unit" = 'serving'
          AND "__new_food_entries"."selected_measurement_unit" = 'serving')),
	CONSTRAINT "food_entries_positive_quantities_check" CHECK("__new_food_entries"."authoritative_base_quantity_microunits" > 0
        AND "__new_food_entries"."selected_measurement_base_quantity_microunits" > 0
        AND "__new_food_entries"."quantity_microunits" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_food_entries`("id", "user_id", "food_log_date", "local_event_time", "provider", "provider_food_id", "provider_published_date", "provider_modified_date", "source_data_type", "original_name", "edited_name", "brand", "barcode", "market_country", "authoritative_base_unit", "authoritative_base_quantity_microunits", "authoritative_nutrition", "selected_measurement_id", "selected_measurement_label", "selected_measurement_unit", "selected_measurement_base_quantity_microunits", "supported_measurements", "quantity_microunits", "authoritative_energy_milli_kcal", "authoritative_protein_milligrams", "authoritative_carbohydrate_milligrams", "authoritative_fat_milligrams", "authoritative_fiber_milligrams", "authoritative_sugar_milligrams", "authoritative_sodium_milligrams", "idempotency_key", "created_at", "updated_at") SELECT "id", "user_id", "food_log_date", "local_event_time", "provider", "provider_food_id", "provider_published_date", "provider_modified_date", "source_data_type", "original_name", "edited_name", "brand", "barcode", "market_country", "authoritative_base_unit", "authoritative_base_quantity_microunits", "authoritative_nutrition", "selected_measurement_id", "selected_measurement_label", "selected_measurement_unit", "selected_measurement_base_quantity_microunits", "supported_measurements", "quantity_microunits", "authoritative_energy_milli_kcal", "authoritative_protein_milligrams", "authoritative_carbohydrate_milligrams", "authoritative_fat_milligrams", "authoritative_fiber_milligrams", "authoritative_sugar_milligrams", "authoritative_sodium_milligrams", "idempotency_key", "created_at", "updated_at" FROM `food_entries`;--> statement-breakpoint
DROP TABLE `food_entries`;--> statement-breakpoint
ALTER TABLE `__new_food_entries` RENAME TO `food_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `food_entries_user_idempotency_unique` ON `food_entries` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `food_entries_user_date_order_index` ON `food_entries` (`user_id`,`food_log_date`,`local_event_time`,`created_at`,`id`);
--> statement-breakpoint
UPDATE application_metadata SET value = '16', updated_at = '2026-09-13T00:00:00.000Z' WHERE key = 'schema_version';
