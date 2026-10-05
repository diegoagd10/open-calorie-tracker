-- AI photo meals are retired. Their entries stay as manual entries with the same name, nutrition and
-- "Analyzed plate" measurement; this runs before 0032 rebuilds food_entries without the ai-photo checks.
UPDATE `food_entries` SET `provider` = 'manual', `source_data_type` = 'User entered' WHERE `provider` = 'ai-photo';
--> statement-breakpoint
DELETE FROM `encrypted_credential_bundles` WHERE `name` = 'photo-analysis';
--> statement-breakpoint
DELETE FROM `application_metadata` WHERE `key` IN ('photo_analysis_configuration', 'photo_analysis_test_readiness');
