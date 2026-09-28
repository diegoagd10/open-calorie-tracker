CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_ciphertext` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_last_four` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	`last_used_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_owner_name_unique` ON `api_keys` (`owner_id`,"name" COLLATE NOCASE);