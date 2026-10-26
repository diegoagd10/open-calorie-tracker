CREATE TABLE `daily_goals` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`calories` integer NOT NULL,
	`protein` integer NOT NULL,
	`carbohydrate` integer NOT NULL,
	`fat` integer NOT NULL,
	`fiber` integer NOT NULL,
	`sugar` integer NOT NULL,
	`sodium` integer NOT NULL,
	`water` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
