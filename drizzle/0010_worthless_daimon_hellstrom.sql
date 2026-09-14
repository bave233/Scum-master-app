CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`app_name` text NOT NULL,
	`owner_name` text NOT NULL,
	`release_anchor_date` text NOT NULL,
	`release_anchor_version` text NOT NULL,
	`release_cadence_days` integer DEFAULT 14 NOT NULL,
	`import_keywords` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `app_settings`
  (`id`, `app_name`, `owner_name`, `release_anchor_date`, `release_anchor_version`, `release_cadence_days`, `import_keywords`)
VALUES
  (1, 'Team Capacity App', '', date('now'), '1.0.0', 14, 'mobile,ios,android,app');
