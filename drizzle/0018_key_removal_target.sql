ALTER TABLE `webauthn_ceremonies` ADD `target_credential_id` text;
--> statement-breakpoint
UPDATE application_metadata SET value = '18', updated_at = '2026-09-18T20:00:00.000Z' WHERE key = 'schema_version';
