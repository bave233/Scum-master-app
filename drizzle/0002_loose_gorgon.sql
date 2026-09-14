ALTER TABLE `people` ADD `account_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_people_account_id` ON `people` (`account_id`);