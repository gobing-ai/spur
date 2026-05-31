CREATE TABLE `history_raw_message_openclaw` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`role` text,
	`content_text` text,
	`model_id` text,
	`provider_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`event_ts` integer,
	`event_date` text,
	`source_file` text NOT NULL,
	`source_offset` integer,
	`processing_status` integer DEFAULT 0 NOT NULL,
	`processed_at` integer,
	`computer_name` text,
	`user_name` text,
	`project_name` text,
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_raw_message_openclaw_status_idx` ON `history_raw_message_openclaw` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_message_openclaw_session_idx` ON `history_raw_message_openclaw` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_message_openclaw_event_ts_idx` ON `history_raw_message_openclaw` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_message_openclaw_event_date_idx` ON `history_raw_message_openclaw` (`event_date`);