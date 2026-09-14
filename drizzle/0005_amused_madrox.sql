ALTER TABLE `timeline_events` ADD `kind` text DEFAULT 'timeline' NOT NULL;--> statement-breakpoint
ALTER TABLE `timeline_events` ADD `recurrence` text DEFAULT 'none' NOT NULL;