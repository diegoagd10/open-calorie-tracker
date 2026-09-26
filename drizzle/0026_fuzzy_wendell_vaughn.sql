PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`secret_hash` text,
	`redirect_uris` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "oauth_clients_type_check" CHECK((type = 'public' AND secret_hash IS NULL) OR (type = 'confidential' AND secret_hash IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_oauth_clients`("id", "owner_id", "name", "type", "secret_hash", "redirect_uris", "created_at") SELECT "id", "owner_id", "name", "type", NULL, "redirect_uris", "created_at" FROM `oauth_clients`;--> statement-breakpoint
DROP TABLE `oauth_clients`;--> statement-breakpoint
ALTER TABLE `__new_oauth_clients` RENAME TO `oauth_clients`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `oauth_clients_owner_id_index` ON `oauth_clients` (`owner_id`);
