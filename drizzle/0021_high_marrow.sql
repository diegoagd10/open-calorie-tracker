ALTER TABLE `water_events` ADD `preset_8_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `water_events` ADD `preset_16_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `water_events` ADD `preset_24_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE application_metadata SET value = '20', updated_at = '2026-09-21T00:00:00.000Z' WHERE key = 'schema_version';
