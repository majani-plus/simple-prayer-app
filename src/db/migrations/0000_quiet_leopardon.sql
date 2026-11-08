CREATE TABLE `exempt_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_day` text NOT NULL,
	`end_day` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exempt_periods_start_day_idx` ON `exempt_periods` (`start_day`);--> statement-breakpoint
CREATE TABLE `prayer_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`prayer` text NOT NULL,
	`status` text NOT NULL,
	`made_up_at` integer,
	`logged_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prayer_logs_day_prayer_unique` ON `prayer_logs` (`day`,`prayer`);--> statement-breakpoint
CREATE INDEX `prayer_logs_day_idx` ON `prayer_logs` (`day`);--> statement-breakpoint
CREATE TABLE `qada_debts` (
	`prayer` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `qada_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`prayer` text,
	`delta` integer NOT NULL,
	`at` integer NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `qada_events_at_idx` ON `qada_events` (`at`);