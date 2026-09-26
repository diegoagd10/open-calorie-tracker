CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "oauth_clients_type_check" CHECK(type = 'public')
);
--> statement-breakpoint
CREATE INDEX `oauth_clients_owner_id_index` ON `oauth_clients` (`owner_id`);