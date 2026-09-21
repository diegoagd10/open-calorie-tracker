CREATE TABLE `saved_foods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source_entry_id` integer NOT NULL,
	`name` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_foods_user_source_unique` ON `saved_foods` (`user_id`,`source_entry_id`);--> statement-breakpoint
CREATE INDEX `saved_foods_user_name_index` ON `saved_foods` (`user_id`,`name`);