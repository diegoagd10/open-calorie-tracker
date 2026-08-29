CREATE TABLE `goal_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`effective_date` text NOT NULL,
	`calorie_target_milli_kcal` integer NOT NULL,
	`water_target_microliters` integer NOT NULL,
	`protein_target_milligrams` integer NOT NULL,
	`carbohydrate_target_milligrams` integer NOT NULL,
	`fat_target_milligrams` integer NOT NULL,
	`fiber_target_milligrams` integer NOT NULL,
	`sugar_maximum_milligrams` integer NOT NULL,
	`sodium_maximum_milligrams` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "goal_versions_positive_values_check" CHECK("goal_versions"."calorie_target_milli_kcal" > 0
        AND "goal_versions"."water_target_microliters" > 0
        AND "goal_versions"."protein_target_milligrams" > 0
        AND "goal_versions"."carbohydrate_target_milligrams" > 0
        AND "goal_versions"."fat_target_milligrams" > 0
        AND "goal_versions"."fiber_target_milligrams" > 0
        AND "goal_versions"."sugar_maximum_milligrams" > 0
        AND "goal_versions"."sodium_maximum_milligrams" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_versions_user_effective_date_unique` ON `goal_versions` (`user_id`,`effective_date`);--> statement-breakpoint
CREATE INDEX `goal_versions_user_effective_date_index` ON `goal_versions` (`user_id`,`effective_date`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`display_units` text NOT NULL,
	`time_zone` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_preferences_display_units_check" CHECK("user_preferences"."display_units" IN ('us', 'metric'))
);
--> statement-breakpoint
UPDATE `application_metadata`
SET `value` = '4', `updated_at` = CURRENT_TIMESTAMP
WHERE `key` = 'schema_version';
