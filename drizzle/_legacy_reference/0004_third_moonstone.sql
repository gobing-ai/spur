CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_run_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`phase_run_id`) REFERENCES `phase_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `artifact_phase_idx` ON `artifact` (`phase_run_id`);--> statement-breakpoint
CREATE TABLE `asset_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`path` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `asset_ref_run_idx` ON `asset_ref` (`run_id`);--> statement-breakpoint
CREATE TABLE `constraint_finding` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`rule_id` text NOT NULL,
	`severity` text NOT NULL,
	`file` text NOT NULL,
	`line` integer,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `constraint_finding_run_idx` ON `constraint_finding` (`run_id`);--> statement-breakpoint
CREATE TABLE `gate_result` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_run_id` text NOT NULL,
	`transition_to` text NOT NULL,
	`kind` text NOT NULL,
	`passed` integer NOT NULL,
	`evidence` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`phase_run_id`) REFERENCES `phase_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `gate_result_phase_idx` ON `gate_result` (`phase_run_id`);--> statement-breakpoint
CREATE TABLE `run_event` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_run_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`redaction` text,
	`ts` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`phase_run_id`) REFERENCES `phase_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `run_event_phase_idx` ON `run_event` (`phase_run_id`);--> statement-breakpoint
CREATE INDEX `run_event_type_idx` ON `run_event` (`type`);