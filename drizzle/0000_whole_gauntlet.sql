CREATE TABLE `application_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `application_metadata` (`key`, `value`, `updated_at`)
VALUES ('schema_version', '1', '2026-08-29T00:00:00.000Z');
