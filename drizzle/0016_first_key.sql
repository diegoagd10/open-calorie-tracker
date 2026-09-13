CREATE TABLE `webauthn_ceremonies` (
	`browser_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`purpose` text NOT NULL,
	`challenge` text NOT NULL,
	`origin` text NOT NULL,
	`rp_id` text NOT NULL,
	`authentication_version` integer NOT NULL,
	`session_hash` text,
	`staged_credential` text,
	`name` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webauthn_ceremonies_owner` ON `webauthn_ceremonies` (`user_id`);--> statement-breakpoint
CREATE TABLE `webauthn_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`transports` text NOT NULL,
	`name` text NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webauthn_credentials_owner` ON `webauthn_credentials` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `key_login_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `authentication_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `webauthn_user_handle` text;--> statement-breakpoint
UPDATE `application_metadata`
SET `value` = '16', `updated_at` = '2026-09-13T19:00:00.000Z'
WHERE `key` = 'schema_version';
