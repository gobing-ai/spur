CREATE TABLE `history_features_conversation` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`feature_json` text DEFAULT '{}' NOT NULL,
	`duration_min` real,
	`msg_count` integer,
	`tool_call_count` integer,
	`tool_error_rate` real,
	`cache_hit_ratio` real,
	`model_switches` integer,
	`cost_usd` real,
	`intent_label` text,
	`opus_msg_ratio` real,
	`baseline_mean` real,
	`baseline_stddev` real,
	`classifier_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `history_conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `history_features_conversation_intent_idx` ON `history_features_conversation` (`intent_label`);--> statement-breakpoint
CREATE TABLE `history_features_day` (
	`date` text NOT NULL,
	`platform` text NOT NULL,
	`feature_json` text DEFAULT '{}' NOT NULL,
	`active_hours` real,
	`conv_count` integer,
	`cost_total` real,
	`tool_diversity_score` real,
	`commits_attributed` integer,
	`baseline_mean` real,
	`baseline_stddev` real,
	`classifier_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`date`, `platform`)
);
--> statement-breakpoint
CREATE TABLE `history_conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`session_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`model` text NOT NULL,
	`msg_count` integer NOT NULL,
	`intent_label` text,
	`cost_usd` real NOT NULL,
	`cache_hit_ratio` real NOT NULL,
	`model_switches` integer NOT NULL,
	`classifier_version` integer NOT NULL,
	`computer_name` text,
	`user_name` text,
	`project_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_conversation_platform_started_idx` ON `history_conversation` (`platform`,`started_at`);--> statement-breakpoint
CREATE INDEX `history_conversation_session_idx` ON `history_conversation` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_conversation_intent_idx` ON `history_conversation` (`intent_label`);--> statement-breakpoint
CREATE TABLE `history_daily_summary` (
	`date` text NOT NULL,
	`platform` text NOT NULL,
	`conversations` integer DEFAULT 0 NOT NULL,
	`messages` integer DEFAULT 0 NOT NULL,
	`tool_calls` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`total_input_tokens` integer DEFAULT 0 NOT NULL,
	`total_output_tokens` integer DEFAULT 0 NOT NULL,
	`active_hours` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`date`, `platform`)
);
--> statement-breakpoint
CREATE TABLE `history_intent_summary` (
	`date` text NOT NULL,
	`intent_label` text NOT NULL,
	`conversations` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`avg_msg_count` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`date`, `intent_label`)
);
--> statement-breakpoint
CREATE TABLE `history_message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content_sha256` text NOT NULL,
	`content_length` integer NOT NULL,
	`ts` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `history_conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `history_message_conversation_idx` ON `history_message` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `history_message_ts_idx` ON `history_message` (`ts`);--> statement-breakpoint
CREATE TABLE `history_token_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`pricing_snapshot_id` text,
	`ts` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `history_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `history_message`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_snapshot_id`) REFERENCES `history_pricing_snapshot`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `history_token_usage_conversation_idx` ON `history_token_usage` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `history_token_usage_pricing_idx` ON `history_token_usage` (`pricing_snapshot_id`);--> statement-breakpoint
CREATE TABLE `history_tool_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`success` integer NOT NULL,
	`is_retry` integer NOT NULL,
	`duration_ms` integer,
	`error_message` text,
	`ts` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `history_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `history_message`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `history_tool_usage_conversation_idx` ON `history_tool_usage` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `history_tool_usage_tool_idx` ON `history_tool_usage` (`tool_name`);--> statement-breakpoint
CREATE TABLE `history_pricing_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`model` text NOT NULL,
	`input_per_m_tokens_usd` real NOT NULL,
	`output_per_m_tokens_usd` real NOT NULL,
	`cache_read_per_m_tokens_usd` real,
	`cache_write_per_m_tokens_usd` real,
	`effective_from` integer NOT NULL,
	`effective_until` integer,
	`is_active` integer DEFAULT 0 NOT NULL,
	`source_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_pricing_snapshot_active_idx` ON `history_pricing_snapshot` (`platform`,`model`,`is_active`) WHERE "history_pricing_snapshot"."is_active" = 1;--> statement-breakpoint
CREATE TABLE `history_raw_transcript_claude` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`parent_id` text,
	`index_in_file` integer,
	`message_id` text,
	`message_type` text,
	`role` text,
	`content_text` text,
	`content_sha256` text,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_creation_input_tokens` integer,
	`cache_read_input_tokens` integer,
	`event_ts` integer,
	`event_date` text,
	`source_file` text NOT NULL,
	`source_offset` integer,
	`processing_status` integer DEFAULT 0 NOT NULL,
	`processed_at` integer,
	`computer_name` text,
	`user_name` text,
	`project_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_raw_transcript_claude_status_idx` ON `history_raw_transcript_claude` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_transcript_claude_session_idx` ON `history_raw_transcript_claude` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_transcript_claude_event_ts_idx` ON `history_raw_transcript_claude` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_transcript_claude_event_date_idx` ON `history_raw_transcript_claude` (`event_date`);--> statement-breakpoint
CREATE TABLE `history_raw_usage_claude` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`cluster_id` text,
	`version` text,
	`message_id` text,
	`message_role` text,
	`message_type` text,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_creation_input_tokens` integer,
	`cache_read_input_tokens` integer,
	`total_input_tokens` integer,
	`total_output_tokens` integer,
	`content_text` text,
	`content_sha256` text,
	`event_ts` integer,
	`event_date` text,
	`source_file` text NOT NULL,
	`source_offset` integer,
	`processing_status` integer DEFAULT 0 NOT NULL,
	`processed_at` integer,
	`computer_name` text,
	`user_name` text,
	`project_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_raw_usage_claude_status_idx` ON `history_raw_usage_claude` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_usage_claude_session_idx` ON `history_raw_usage_claude` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_usage_claude_event_ts_idx` ON `history_raw_usage_claude` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_usage_claude_event_date_idx` ON `history_raw_usage_claude` (`event_date`);--> statement-breakpoint
CREATE TABLE `history_raw_session_codex` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`event_timestamp` text,
	`input_tokens` integer,
	`cached_input_tokens` integer,
	`output_tokens` integer,
	`reasoning_output_tokens` integer,
	`total_tokens` integer,
	`model_context_window` integer,
	`event_ts` integer,
	`event_date` text,
	`source_file` text NOT NULL,
	`source_offset` integer,
	`processing_status` integer DEFAULT 0 NOT NULL,
	`processed_at` integer,
	`computer_name` text,
	`user_name` text,
	`project_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_raw_session_codex_status_idx` ON `history_raw_session_codex` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_session_codex_session_idx` ON `history_raw_session_codex` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_session_codex_event_ts_idx` ON `history_raw_session_codex` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_session_codex_event_date_idx` ON `history_raw_session_codex` (`event_date`);--> statement-breakpoint
CREATE TABLE `history_raw_message_opencode` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`provider_id` text,
	`model_id` text,
	`time_created` integer,
	`time_completed` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`reasoning_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`cost` real,
	`event_ts` integer,
	`event_date` text,
	`source_file` text NOT NULL,
	`source_offset` integer,
	`processing_status` integer DEFAULT 0 NOT NULL,
	`processed_at` integer,
	`computer_name` text,
	`user_name` text,
	`project_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_raw_message_opencode_status_idx` ON `history_raw_message_opencode` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_message_opencode_session_idx` ON `history_raw_message_opencode` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_message_opencode_event_ts_idx` ON `history_raw_message_opencode` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_message_opencode_event_date_idx` ON `history_raw_message_opencode` (`event_date`);--> statement-breakpoint
CREATE TABLE `history_raw_session_pi` (
	`id` text PRIMARY KEY NOT NULL,
	`record_type` text NOT NULL,
	`session_id` text,
	`parent_id` text,
	`timestamp` text,
	`provider` text,
	`model_id` text,
	`cwd` text,
	`role` text,
	`content_text` text,
	`content_sha256` text,
	`has_thinking` integer,
	`has_tool_use` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`cache_read_tokens` integer,
	`cache_creation_tokens` integer,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`thinking_level` text,
	`event_ts` integer,
	`event_date` text,
	`source_file` text NOT NULL,
	`source_offset` integer,
	`processing_status` integer DEFAULT 0 NOT NULL,
	`processed_at` integer,
	`computer_name` text,
	`user_name` text,
	`project_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_raw_session_pi_status_idx` ON `history_raw_session_pi` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_session_pi_session_idx` ON `history_raw_session_pi` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_session_pi_type_idx` ON `history_raw_session_pi` (`record_type`);--> statement-breakpoint
CREATE INDEX `history_raw_session_pi_event_ts_idx` ON `history_raw_session_pi` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_session_pi_event_date_idx` ON `history_raw_session_pi` (`event_date`);--> statement-breakpoint
CREATE TABLE `history_file_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`platform` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_ingested_at` integer,
	`batch_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `history_import_batch`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_file_registry_path_sha_idx` ON `history_file_registry` (`path`,`sha256`);--> statement-breakpoint
CREATE INDEX `history_file_registry_platform_idx` ON `history_file_registry` (`platform`);--> statement-breakpoint
CREATE INDEX `history_file_registry_path_idx` ON `history_file_registry` (`path`);--> statement-breakpoint
CREATE TABLE `history_import_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`source_root` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`files_discovered` integer DEFAULT 0 NOT NULL,
	`files_ingested` integer DEFAULT 0 NOT NULL,
	`events_ingested` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_import_batch_platform_idx` ON `history_import_batch` (`platform`);--> statement-breakpoint
CREATE INDEX `history_import_batch_status_idx` ON `history_import_batch` (`status`);--> statement-breakpoint
CREATE TABLE `history_projection_run` (
	`id` text PRIMARY KEY NOT NULL,
	`target` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`since_ts` integer,
	`events_processed` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_projection_run_target_idx` ON `history_projection_run` (`target`);--> statement-breakpoint
CREATE INDEX `history_projection_run_status_idx` ON `history_projection_run` (`status`);--> statement-breakpoint
CREATE TABLE `history_raw_event` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`platform` text NOT NULL,
	`source_file` text NOT NULL,
	`source_offset` integer NOT NULL,
	`event_ts` integer NOT NULL,
	`ingested_at` integer NOT NULL,
	`pricing_snapshot_id` text,
	`table_name` text NOT NULL,
	`raw_id` text NOT NULL,
	`event_date` text NOT NULL,
	`session_id` text,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`role` text,
	`computer_name` text,
	`user_name` text,
	`project_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pricing_snapshot_id`) REFERENCES `history_pricing_snapshot`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `history_raw_event_session_idx` ON `history_raw_event` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_event_date_idx` ON `history_raw_event` (`event_date`);--> statement-breakpoint
CREATE INDEX `history_raw_event_platform_date_idx` ON `history_raw_event` (`platform`,`event_date`);--> statement-breakpoint
CREATE INDEX `history_raw_event_table_idx` ON `history_raw_event` (`table_name`);--> statement-breakpoint
CREATE INDEX `history_raw_event_pricing_idx` ON `history_raw_event` (`pricing_snapshot_id`);--> statement-breakpoint
CREATE INDEX `history_raw_event_ts_idx` ON `history_raw_event` (`event_ts`);--> statement-breakpoint
CREATE UNIQUE INDEX `history_raw_event_source_dedup_idx` ON `history_raw_event` (`source_file`,`source_offset`,`event_type`);--> statement-breakpoint
CREATE TABLE `history_redaction_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_event_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`original_sha256` text NOT NULL,
	`replacement_token` text NOT NULL,
	`field_path` text NOT NULL,
	`redacted_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`raw_event_id`) REFERENCES `history_raw_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `history_redaction_audit_event_idx` ON `history_redaction_audit` (`raw_event_id`);--> statement-breakpoint
CREATE INDEX `history_redaction_audit_rule_idx` ON `history_redaction_audit` (`rule_id`);--> statement-breakpoint
CREATE TABLE `transition_run` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`transition_id` text NOT NULL,
	`trigger_kind` text NOT NULL,
	`trigger_payload` text,
	`fired_at` integer NOT NULL,
	`finished_at` integer,
	`success` integer,
	`result_data` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transition_run_run_idx` ON `transition_run` (`run_id`);--> statement-breakpoint
CREATE INDEX `transition_run_run_fired_idx` ON `transition_run` (`run_id`,`fired_at`);--> statement-breakpoint
CREATE INDEX `transition_run_transition_id_idx` ON `transition_run` (`transition_id`);--> statement-breakpoint
CREATE INDEX `transition_run_trigger_kind_idx` ON `transition_run` (`trigger_kind`);--> statement-breakpoint
ALTER TABLE `run` ADD `dialect` text DEFAULT 'state-machine' NOT NULL;--> statement-breakpoint
CREATE INDEX `asset_ref_path_idx` ON `asset_ref` (`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_name_unique` ON `workspace` (`name`);