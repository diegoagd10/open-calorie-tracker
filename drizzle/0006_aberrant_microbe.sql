ALTER TABLE `food_entries` ADD `edited_name` text;--> statement-breakpoint
ALTER TABLE `food_entries` ADD `supported_measurements` text DEFAULT '[]' NOT NULL;