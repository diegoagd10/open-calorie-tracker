CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`key_hash` text NOT NULL,
	`preview` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_user_name_unique` ON `api_keys` (`user_id`,"name" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `api_keys_user_created_at` ON `api_keys` (`user_id`,`created_at`);