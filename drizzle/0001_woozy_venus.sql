ALTER TABLE `holidays` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `holidays` ADD `active` integer DEFAULT 1 NOT NULL;