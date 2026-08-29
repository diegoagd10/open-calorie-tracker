CREATE TABLE `food_entries` (
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
	`brand` text,
	`barcode` text,
	`market_country` text,
	`authoritative_base_unit` text NOT NULL,
	`authoritative_base_quantity_microunits` integer NOT NULL,
	`selected_measurement_id` text NOT NULL,
	`selected_measurement_label` text NOT NULL,
	`selected_measurement_unit` text NOT NULL,
	`selected_measurement_base_quantity_microunits` integer NOT NULL,
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
	CONSTRAINT "food_entries_provider_check" CHECK("food_entries"."provider" = 'usda-fdc'),
	CONSTRAINT "food_entries_data_type_check" CHECK("food_entries"."source_data_type" IN ('Branded', 'Survey (FNDDS)', 'Foundation')),
	CONSTRAINT "food_entries_units_check" CHECK("food_entries"."authoritative_base_unit" IN ('g', 'ml')
        AND "food_entries"."selected_measurement_unit" IN ('g', 'ml')),
	CONSTRAINT "food_entries_positive_quantities_check" CHECK("food_entries"."authoritative_base_quantity_microunits" > 0
        AND "food_entries"."selected_measurement_base_quantity_microunits" > 0
        AND "food_entries"."quantity_microunits" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_entries_user_idempotency_unique` ON `food_entries` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `food_entries_user_date_order_index` ON `food_entries` (`user_id`,`food_log_date`,`local_event_time`,`created_at`,`id`);--> statement-breakpoint
UPDATE `application_metadata`
SET `value` = '5', `updated_at` = CURRENT_TIMESTAMP
WHERE `key` = 'schema_version';
