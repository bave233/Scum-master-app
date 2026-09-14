CREATE TABLE `timeline_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`epic_url` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`color` text DEFAULT '#2563eb' NOT NULL
);
