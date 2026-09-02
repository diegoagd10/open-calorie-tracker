ALTER TABLE `users`
ADD COLUMN `role` text DEFAULT 'member' NOT NULL
CONSTRAINT "users_role_check" CHECK(`role` IN ('admin', 'member'));
--> statement-breakpoint
UPDATE `users`
SET `role` = 'admin'
WHERE `id` = (
  SELECT `id`
  FROM `users`
  ORDER BY `created_at` ASC, `id` ASC
  LIMIT 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_single_admin_unique`
ON `users` (`role`)
WHERE `role` = 'admin';
--> statement-breakpoint
UPDATE `application_metadata`
SET `value` = '9', `updated_at` = '2026-09-01T00:00:00.000Z'
WHERE `key` = 'schema_version';
