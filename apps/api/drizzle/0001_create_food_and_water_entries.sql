CREATE TABLE `food_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`logged_at` integer NOT NULL,
	`name` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`serving_size` text NOT NULL,
	`quantity` real NOT NULL,
	`calories` real NOT NULL,
	`protein` real,
	`carbohydrate` real,
	`fat` real,
	`fiber` real,
	`sugar` real,
	`sodium` real,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `food_entries_user_logged_at` ON `food_entries` (`user_id`,`logged_at`);--> statement-breakpoint
CREATE TABLE `water_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`logged_at` integer NOT NULL,
	`amount` real NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `water_entries_user_logged_at` ON `water_entries` (`user_id`,`logged_at`);