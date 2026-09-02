ALTER TABLE `users` ADD `password_change_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `application_metadata`
SET `value` = '11', `updated_at` = '2026-09-02T10:45:00.000Z'
WHERE `key` = 'schema_version';
