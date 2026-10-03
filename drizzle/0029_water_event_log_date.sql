CREATE TABLE `__new_water_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`log_date` text NOT NULL,
	`ounces` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "water_events_positive_ounces_check" CHECK(CAST("__new_water_events"."ounces" AS REAL) > 0)
);
--> statement-breakpoint
-- SQLite has no time zones: migrated rows keep their local date and time without an offset here, and
-- convertLegacyWaterEventLogDates (app/database) converts them to UTC with the account's time zone at startup.
INSERT INTO `__new_water_events` (`id`, `user_id`, `log_date`, `ounces`, `created_at`, `updated_at`)
SELECT
	`id`,
	`user_id`,
	`food_log_date` || 'T' || `local_event_time`,
	CASE
		WHEN `amount_microliters` < 15 THEN '0.001'
		ELSE rtrim(rtrim(printf('%.3f', `amount_microliters` / 29573.5295625), '0'), '.')
	END,
	`created_at`,
	`updated_at`
FROM `water_events`;
--> statement-breakpoint
DROP TABLE `water_events`;
--> statement-breakpoint
ALTER TABLE `__new_water_events` RENAME TO `water_events`;
--> statement-breakpoint
CREATE INDEX `water_events_user_log_date_index` ON `water_events` (`user_id`,`log_date`,`id`);
