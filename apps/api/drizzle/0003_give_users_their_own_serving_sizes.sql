-- Serving sizes were texts shared by every user. Each user now gets their own copy of the texts
-- their entries use, and their entries point to it. Texts no entry uses have no owner and are
-- dropped. Two texts of a user that differ only in case become one.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_serving_sizes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- With MIN(id), SQLite takes the name from the oldest of the texts that differ only in case.
INSERT INTO `__new_serving_sizes` (`user_id`, `name`)
SELECT `user_id`, `name` FROM (
	SELECT `food_entries`.`user_id`, `serving_sizes`.`name`, MIN(`serving_sizes`.`id`) AS `oldest`
	FROM `food_entries`
	JOIN `serving_sizes` ON `serving_sizes`.`id` = `food_entries`.`serving_size_id`
	GROUP BY `food_entries`.`user_id`, `serving_sizes`.`name` COLLATE NOCASE
)
ORDER BY `user_id`, `oldest`;
--> statement-breakpoint
UPDATE `food_entries` SET `serving_size_id` = (
	SELECT `new`.`id`
	FROM `__new_serving_sizes` AS `new`
	JOIN `serving_sizes` AS `old` ON `old`.`name` = `new`.`name` COLLATE NOCASE
	WHERE `old`.`id` = `food_entries`.`serving_size_id` AND `new`.`user_id` = `food_entries`.`user_id`
);
--> statement-breakpoint
DROP TABLE `serving_sizes`;--> statement-breakpoint
ALTER TABLE `__new_serving_sizes` RENAME TO `serving_sizes`;--> statement-breakpoint
CREATE UNIQUE INDEX `serving_sizes_user_name_unique` ON `serving_sizes` (`user_id`,"name" COLLATE NOCASE);--> statement-breakpoint
PRAGMA foreign_keys=ON;
