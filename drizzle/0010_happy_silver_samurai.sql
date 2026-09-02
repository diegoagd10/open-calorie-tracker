ALTER TABLE `users`
ADD COLUMN `access_state` text DEFAULT 'active' NOT NULL
CONSTRAINT "users_access_state_check" CHECK(`access_state` IN ('active', 'disabled'));--> statement-breakpoint
UPDATE `application_metadata`
SET `value` = '10', `updated_at` = '2026-09-01T12:00:00.000Z'
WHERE `key` = 'schema_version';
