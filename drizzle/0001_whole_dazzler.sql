CREATE TABLE `password_credentials` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limit_counters` (
	`scope` text NOT NULL,
	`subject_hash` text NOT NULL,
	`window_started_at` text NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`scope`, `subject_hash`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`idle_expires_at` text NOT NULL,
	`absolute_expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_index` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username_normalized` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_normalized_unique` ON `users` ("username_normalized" COLLATE NOCASE);
--> statement-breakpoint
UPDATE `application_metadata`
SET `value` = '2', `updated_at` = CURRENT_TIMESTAMP
WHERE `key` = 'schema_version';
