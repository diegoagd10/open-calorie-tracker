CREATE TABLE `encrypted_credential_bundles` (
	`name` text PRIMARY KEY NOT NULL,
	`envelope` text NOT NULL,
	`configured_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `photo_attempts` ADD `diagnostics` text;
--> statement-breakpoint
UPDATE application_metadata SET value = '19', updated_at = '2026-09-20T14:20:00.000Z' WHERE key = 'schema_version';
