CREATE TABLE `daily_goals` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`calorie_target_milli_kcal` integer NOT NULL,
	`water_target_ounces` text NOT NULL,
	`protein_target_milligrams` integer NOT NULL,
	`carbohydrate_target_milligrams` integer NOT NULL,
	`fat_target_milligrams` integer NOT NULL,
	`fiber_target_milligrams` integer NOT NULL,
	`sugar_maximum_milligrams` integer NOT NULL,
	`sodium_maximum_milligrams` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "daily_goals_positive_values_check" CHECK("daily_goals"."calorie_target_milli_kcal" > 0
        AND CAST("daily_goals"."water_target_ounces" AS REAL) > 0
        AND "daily_goals"."protein_target_milligrams" > 0
        AND "daily_goals"."carbohydrate_target_milligrams" > 0
        AND "daily_goals"."fat_target_milligrams" > 0
        AND "daily_goals"."fiber_target_milligrams" > 0
        AND "daily_goals"."sugar_maximum_milligrams" > 0
        AND "daily_goals"."sodium_maximum_milligrams" > 0)
);
--> statement-breakpoint
-- Each account keeps the Goal Version active today (UTC): the latest effective date on or before today,
-- the highest id breaking ties, or else its earliest scheduled version. Water moves from microliters to
-- fluid ounces in thousandths, kept within the 0.001 to 500 fl oz the Settings form accepts.
INSERT INTO `daily_goals` (
	`user_id`, `calorie_target_milli_kcal`, `water_target_ounces`, `protein_target_milligrams`,
	`carbohydrate_target_milligrams`, `fat_target_milligrams`, `fiber_target_milligrams`,
	`sugar_maximum_milligrams`, `sodium_maximum_milligrams`, `created_at`, `updated_at`
)
SELECT
	`user_id`,
	`calorie_target_milli_kcal`,
	rtrim(rtrim(printf('%d.%03d', `water_thousandths` / 1000, `water_thousandths` % 1000), '0'), '.'),
	`protein_target_milligrams`,
	`carbohydrate_target_milligrams`,
	`fat_target_milligrams`,
	`fiber_target_milligrams`,
	`sugar_maximum_milligrams`,
	`sodium_maximum_milligrams`,
	`created_at`,
	`created_at`
FROM (
	SELECT
		*,
		max(1, min(500000, CAST(round(`water_target_microliters` / 29.5735295625) AS INTEGER))) AS `water_thousandths`,
		ROW_NUMBER() OVER (
			PARTITION BY `user_id`
			ORDER BY
				`effective_date` > date('now'),
				CASE WHEN `effective_date` <= date('now') THEN `effective_date` END DESC,
				`effective_date`,
				`id` DESC
		) AS `rank`
	FROM `goal_versions`
)
WHERE `rank` = 1;
--> statement-breakpoint
DROP TABLE `goal_versions`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`time_zone` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("user_id", "time_zone", "created_at", "updated_at") SELECT "user_id", "time_zone", "created_at", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;