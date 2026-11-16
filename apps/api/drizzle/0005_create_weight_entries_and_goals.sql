CREATE TABLE `weight_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`date` text NOT NULL,
	`weight` real NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weight_entries_user_date_unique` ON `weight_entries` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `weight_goals` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`start_weight` real NOT NULL,
	`goal_weight` real NOT NULL,
	`start_date` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
