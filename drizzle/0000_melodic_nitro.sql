CREATE TABLE `holidays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_holidays_date` ON `holidays` (`date`);--> statement-breakpoint
CREATE TABLE `jira_efforts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`sprint_id` integer NOT NULL,
	`story_points` real DEFAULT 0 NOT NULL,
	`issue_count` integer DEFAULT 0 NOT NULL,
	`issues_json` text DEFAULT '[]' NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jira_efforts_person_sprint` ON `jira_efforts` (`person_id`,`sprint_id`);--> statement-breakpoint
CREATE TABLE `jira_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`base_url` text NOT NULL,
	`email` text NOT NULL,
	`api_token` text NOT NULL,
	`story_point_field` text DEFAULT 'customfield_10016' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `leaves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`date` text NOT NULL,
	`units` real NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_leaves_person_date` ON `leaves` (`person_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_leaves_date` ON `leaves` (`date`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_people_display_name` ON `people` (`display_name`);--> statement-breakpoint
CREATE TABLE `sprints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`md_per_story_point` real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sprints_name` ON `sprints` (`name`);