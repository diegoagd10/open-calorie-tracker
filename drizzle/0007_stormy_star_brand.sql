CREATE TABLE `water_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`food_log_date` text NOT NULL,
	`amount_microliters` integer NOT NULL,
	`local_event_time` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "water_events_positive_amount_check" CHECK("water_events"."amount_microliters" > 0)
);
--> statement-breakpoint
CREATE INDEX `water_events_user_date_order_index` ON `water_events` (`user_id`,`food_log_date`,`local_event_time`,`created_at`,`id`);
--> statement-breakpoint
UPDATE `application_metadata`
SET `value` = '7', `updated_at` = '2026-08-30T00:00:00.000Z'
WHERE `key` = 'schema_version';
