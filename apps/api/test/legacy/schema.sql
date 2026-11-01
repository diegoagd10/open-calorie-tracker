-- The tables the import reads, as the last open-calory-tracker release created them in production
-- (copied from its sqlite_master). The import reads nothing else.
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username_normalized` text NOT NULL,
	`created_at` text NOT NULL
, `role` text DEFAULT 'member' NOT NULL
CONSTRAINT "users_role_check" CHECK(`role` IN ('admin', 'member')), `access_state` text DEFAULT 'active' NOT NULL
CONSTRAINT "users_access_state_check" CHECK(`access_state` IN ('active', 'disabled')), `password_change_required` integer DEFAULT false NOT NULL, `key_login_enabled` integer DEFAULT false NOT NULL, `authentication_version` integer DEFAULT 0 NOT NULL, `webauthn_user_handle` text);

CREATE UNIQUE INDEX `users_username_normalized_unique` ON `users` ("username_normalized" COLLATE NOCASE);

CREATE UNIQUE INDEX `users_single_admin_unique`
ON `users` (`role`)
WHERE `role` = 'admin';

CREATE TABLE `daily_goals` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`calorie_target_milli_kcal` integer NOT NULL,
	`water_target_ounces` text NOT NULL,
	`protein_target_milligrams` integer NOT NULL,
	`carbohydrate_target_milligrams` integer NOT NULL,
	`fat_target_milligrams` integer NOT NULL,
	`fiber_target_milligrams` integer NOT NULL,
	`sugar_maximum_milligrams` integer NOT NULL,
	`sodium_maximum_milligrams` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "daily_goals_positive_values_check" CHECK("daily_goals"."calorie_target_milli_kcal" > 0
        AND CAST("daily_goals"."water_target_ounces" AS REAL) > 0
        AND "daily_goals"."protein_target_milligrams" > 0
        AND "daily_goals"."carbohydrate_target_milligrams" > 0
        AND "daily_goals"."fat_target_milligrams" > 0
        AND "daily_goals"."fiber_target_milligrams" > 0
        AND "daily_goals"."sugar_maximum_milligrams" > 0
        AND "daily_goals"."sodium_maximum_milligrams" > 0)
);

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

CREATE INDEX `food_events_user_log_date_index` ON `food_events` (`user_id`,`log_date`,`id`);

CREATE TABLE "water_events" (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`log_date` text NOT NULL,
	`ounces` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "water_events_positive_ounces_check" CHECK(CAST("water_events"."ounces" AS REAL) > 0)
);

CREATE INDEX `water_events_user_log_date_index` ON `water_events` (`user_id`,`log_date`,`id`);
