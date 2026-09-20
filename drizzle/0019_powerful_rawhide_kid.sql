ALTER TABLE `photo_attempts` ADD `diagnostics` text;--> statement-breakpoint
UPDATE application_metadata SET value = '19', updated_at = '2026-09-20T14:20:00.000Z' WHERE key = 'schema_version';
