CREATE TABLE `encrypted_credential_bundles` (
	`name` text PRIMARY KEY NOT NULL,
	`envelope` text NOT NULL,
	`configured_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
UPDATE application_metadata SET value = '18', updated_at = '2026-09-19T20:20:00.000Z' WHERE key = 'schema_version';
