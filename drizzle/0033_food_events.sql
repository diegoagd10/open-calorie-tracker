CREATE TABLE `favorite_foods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source_event_id` integer NOT NULL,
	`name` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favorite_foods_user_source_unique` ON `favorite_foods` (`user_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `favorite_foods_user_name_index` ON `favorite_foods` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `food_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`log_date` text NOT NULL,
	`provider` text NOT NULL,
	`provider_food_id` text NOT NULL,
	`source_favorite_id` integer,
	`copied_from_event_id` integer,
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
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "food_events_provider_check" CHECK("food_events"."provider" IN ('usda-fdc', 'open-food-facts', 'manual')),
	CONSTRAINT "food_events_data_type_check" CHECK("food_events"."source_data_type" IN ('Branded', 'Survey (FNDDS)', 'Foundation', 'Open Food Facts', 'User entered')),
	CONSTRAINT "food_events_units_check" CHECK("food_events"."authoritative_base_unit" IN ('g', 'ml', 'serving')
        AND "food_events"."selected_measurement_unit" IN ('g', 'ml', 'serving')),
	CONSTRAINT "food_events_provider_semantics_check" CHECK(("food_events"."provider" = 'usda-fdc'
          AND "food_events"."source_data_type" IN ('Branded', 'Survey (FNDDS)', 'Foundation')
          AND "food_events"."authoritative_base_unit" IN ('g', 'ml')
          AND "food_events"."selected_measurement_unit" IN ('g', 'ml'))
        OR ("food_events"."provider" = 'open-food-facts'
          AND "food_events"."source_data_type" = 'Open Food Facts'
          AND "food_events"."selected_measurement_unit" = "food_events"."authoritative_base_unit"
          AND (("food_events"."authoritative_base_unit" = 'serving' AND "food_events"."authoritative_base_quantity_microunits" = 1000000)
            OR ("food_events"."authoritative_base_unit" IN ('g', 'ml') AND "food_events"."authoritative_base_quantity_microunits" > 0)))
        OR ("food_events"."provider" = 'manual'
          AND "food_events"."source_data_type" = 'User entered'
          AND "food_events"."authoritative_base_unit" = 'serving'
          AND "food_events"."selected_measurement_unit" = 'serving')),
	CONSTRAINT "food_events_positive_quantities_check" CHECK("food_events"."authoritative_base_quantity_microunits" > 0
        AND "food_events"."selected_measurement_base_quantity_microunits" > 0
        AND "food_events"."quantity_microunits" > 0)
);
--> statement-breakpoint
-- SQLite has no time zones: migrated rows keep their local date and time without an offset here, and
-- convertLegacyFoodEventLogDates (app/database) converts them to UTC with the account's time zone at startup.
-- A legacy copy key `copy:<source id>:<nonce>` becomes copied_from_event_id; idempotency keys are dropped.
INSERT INTO `food_events` (`id`, `user_id`, `provider`, `provider_food_id`, `provider_published_date`, `provider_modified_date`, `source_data_type`, `original_name`, `edited_name`, `brand`, `barcode`, `market_country`, `authoritative_base_unit`, `authoritative_base_quantity_microunits`, `authoritative_nutrition`, `selected_measurement_id`, `selected_measurement_label`, `selected_measurement_unit`, `selected_measurement_base_quantity_microunits`, `supported_measurements`, `quantity_microunits`, `authoritative_energy_milli_kcal`, `authoritative_protein_milligrams`, `authoritative_carbohydrate_milligrams`, `authoritative_fat_milligrams`, `authoritative_fiber_milligrams`, `authoritative_sugar_milligrams`, `authoritative_sodium_milligrams`, `created_at`, `updated_at`, `log_date`, `source_favorite_id`, `copied_from_event_id`)
SELECT
	`id`,
	`user_id`,
	`provider`,
	`provider_food_id`,
	`provider_published_date`,
	`provider_modified_date`,
	`source_data_type`,
	`original_name`,
	`edited_name`,
	`brand`,
	`barcode`,
	`market_country`,
	`authoritative_base_unit`,
	`authoritative_base_quantity_microunits`,
	`authoritative_nutrition`,
	`selected_measurement_id`,
	`selected_measurement_label`,
	`selected_measurement_unit`,
	`selected_measurement_base_quantity_microunits`,
	`supported_measurements`,
	`quantity_microunits`,
	`authoritative_energy_milli_kcal`,
	`authoritative_protein_milligrams`,
	`authoritative_carbohydrate_milligrams`,
	`authoritative_fat_milligrams`,
	`authoritative_fiber_milligrams`,
	`authoritative_sugar_milligrams`,
	`authoritative_sodium_milligrams`,
	`created_at`,
	`updated_at`,
	`food_log_date` || 'T' || `local_event_time`,
	`source_saved_food_id`,
	CASE
		WHEN `idempotency_key` GLOB 'copy:[1-9]*:?*'
			AND length(substr(`idempotency_key`, 6, instr(substr(`idempotency_key`, 6), ':') - 1)) <= 15
			AND substr(`idempotency_key`, 6, instr(substr(`idempotency_key`, 6), ':') - 1) NOT GLOB '*[^0-9]*'
		THEN CAST(substr(`idempotency_key`, 6, instr(substr(`idempotency_key`, 6), ':') - 1) AS INTEGER)
	END
FROM `food_entries`;
--> statement-breakpoint
INSERT INTO `favorite_foods` (`id`, `user_id`, `source_event_id`, `name`, `snapshot`, `created_at`)
SELECT `id`, `user_id`, `source_entry_id`, `name`, `snapshot`, `created_at` FROM `saved_foods`;
--> statement-breakpoint
-- Keep AUTOINCREMENT high-water marks, so a deleted event's ID is never reused by a new one that
-- a favorite's source_event_id or a copy's copied_from_event_id could then mistake for it.
DELETE FROM `sqlite_sequence` WHERE `name` IN ('food_events', 'favorite_foods');
--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT 'food_events', `seq` FROM `sqlite_sequence` WHERE `name` = 'food_entries';
--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT 'favorite_foods', `seq` FROM `sqlite_sequence` WHERE `name` = 'saved_foods';
--> statement-breakpoint
DROP TABLE `food_entries`;
--> statement-breakpoint
DROP TABLE `saved_foods`;
--> statement-breakpoint
CREATE INDEX `food_events_user_log_date_index` ON `food_events` (`user_id`,`log_date`,`id`);
