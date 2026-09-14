ALTER TABLE `timeline_events` ADD `source_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_events_source_key_unique` ON `timeline_events` (`source_key`);