CREATE TABLE `phase_run` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`state` text NOT NULL,
	`entered_at` integer NOT NULL,
	`exited_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `phase_run_run_idx` ON `phase_run` (`run_id`);--> statement-breakpoint
CREATE TABLE `run` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`workflow` text NOT NULL,
	`task` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `run_workspace_idx` ON `run` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `run_status_idx` ON `run` (`status`);--> statement-breakpoint
CREATE TABLE `workflow_state` (
	`phase_run_id` text PRIMARY KEY NOT NULL,
	`current_state` text NOT NULL,
	`iteration_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`phase_run_id`) REFERENCES `phase_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_root` text NOT NULL,
	`workdir` text NOT NULL,
	`agent` text,
	`workflow` text,
	`purpose` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
