PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_saved_foods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source_entry_id` integer,
	`name` text NOT NULL,
	`snapshot` text NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_saved_foods`("id", "user_id", "source_entry_id", "name", "snapshot", "created_at") SELECT "id", "user_id", "source_entry_id", "name", "snapshot", "created_at" FROM `saved_foods`;--> statement-breakpoint
DROP TABLE `saved_foods`;--> statement-breakpoint
ALTER TABLE `__new_saved_foods` RENAME TO `saved_foods`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `saved_foods_user_source_unique` ON `saved_foods` (`user_id`,`source_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `saved_foods_user_idempotency_unique` ON `saved_foods` (`user_id`,`idempotency_key`) WHERE "saved_foods"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `saved_foods_user_name_index` ON `saved_foods` (`user_id`,`name`);