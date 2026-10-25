CREATE TABLE `food_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`logged_at` integer NOT NULL,
	`name` text NOT NULL,
	`source_id` integer NOT NULL,
	`serving_size_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`calories` real NOT NULL,
	`protein` real,
	`carbohydrate` real,
	`fat` real,
	`fiber` real,
	`sugar` real,
	`sodium` real,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`serving_size_id`) REFERENCES `serving_sizes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `food_entries_user_logged_at` ON `food_entries` (`user_id`,`logged_at`);--> statement-breakpoint
CREATE TABLE `food_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_sources_name_unique` ON `food_sources` (`name`);--> statement-breakpoint
CREATE TABLE `serving_sizes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `serving_sizes_name_unique` ON `serving_sizes` (`name`);--> statement-breakpoint
CREATE TABLE `water_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`logged_at` integer NOT NULL,
	`amount` real NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `water_entries_user_logged_at` ON `water_entries` (`user_id`,`logged_at`);--> statement-breakpoint
INSERT INTO `food_sources` (`name`) VALUES ('manual');
