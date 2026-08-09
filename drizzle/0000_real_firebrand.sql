CREATE TABLE `private_states` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `private_states_owner_kind_idx` ON `private_states` (`owner_email`,`kind`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`age_band` text DEFAULT 'unspecified' NOT NULL,
	`smoking` text DEFAULT 'unspecified' NOT NULL,
	`drinking` text DEFAULT 'unspecified' NOT NULL,
	`mbti` text DEFAULT 'unspecified' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `share_snapshots` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trips_owner_updated_idx` ON `trips` (`owner_email`,`updated_at`);