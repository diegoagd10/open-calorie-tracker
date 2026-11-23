ALTER TABLE `food_entries` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `food_entries` ADD `attempt` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `food_entries_user_request_unique` ON `food_entries` (`user_id`,`request_id`);--> statement-breakpoint
ALTER TABLE `water_entries` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `water_entries` ADD `attempt` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `water_entries_user_request_unique` ON `water_entries` (`user_id`,`request_id`);