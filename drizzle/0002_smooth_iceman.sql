CREATE TABLE `pre_authentication_csrf_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
UPDATE `application_metadata`
SET `value` = '3', `updated_at` = CURRENT_TIMESTAMP
WHERE `key` = 'schema_version';
