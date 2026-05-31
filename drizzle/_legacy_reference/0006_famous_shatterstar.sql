PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_run_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`phase_run_id`) REFERENCES `phase_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_artifact`("id", "phase_run_id", "kind", "path", "created_at") SELECT "id", "phase_run_id", "kind", "path", "created_at" FROM `artifact`;--> statement-breakpoint
DROP TABLE `artifact`;--> statement-breakpoint
ALTER TABLE `__new_artifact` RENAME TO `artifact`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `artifact_phase_idx` ON `artifact` (`phase_run_id`);--> statement-breakpoint
CREATE TABLE `__new_asset_ref` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`path` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_asset_ref`("id", "run_id", "path", "type", "created_at") SELECT "id", "run_id", "path", "type", "created_at" FROM `asset_ref`;--> statement-breakpoint
DROP TABLE `asset_ref`;--> statement-breakpoint
ALTER TABLE `__new_asset_ref` RENAME TO `asset_ref`;--> statement-breakpoint
CREATE INDEX `asset_ref_run_idx` ON `asset_ref` (`run_id`);--> statement-breakpoint
CREATE INDEX `asset_ref_path_idx` ON `asset_ref` (`path`);--> statement-breakpoint
CREATE TABLE `__new_constraint_finding` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`rule_id` text NOT NULL,
	`severity` text NOT NULL,
	`file` text NOT NULL,
	`line` integer,
	`evidence` text NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_constraint_finding`("id", "run_id", "rule_id", "severity", "file", "line", "evidence", "created_at") SELECT "id", "run_id", "rule_id", "severity", "file", "line", "evidence", "created_at" FROM `constraint_finding`;--> statement-breakpoint
DROP TABLE `constraint_finding`;--> statement-breakpoint
ALTER TABLE `__new_constraint_finding` RENAME TO `constraint_finding`;--> statement-breakpoint
CREATE INDEX `constraint_finding_run_idx` ON `constraint_finding` (`run_id`);--> statement-breakpoint
CREATE TABLE `__new_gate_result` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_run_id` text NOT NULL,
	`transition_to` text NOT NULL,
	`kind` text NOT NULL,
	`passed` integer NOT NULL,
	`evidence` text,
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`phase_run_id`) REFERENCES `phase_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_gate_result`("id", "phase_run_id", "transition_to", "kind", "passed", "evidence", "created_at") SELECT "id", "phase_run_id", "transition_to", "kind", "passed", "evidence", "created_at" FROM `gate_result`;--> statement-breakpoint
DROP TABLE `gate_result`;--> statement-breakpoint
ALTER TABLE `__new_gate_result` RENAME TO `gate_result`;--> statement-breakpoint
CREATE INDEX `gate_result_phase_idx` ON `gate_result` (`phase_run_id`);--> statement-breakpoint
CREATE TABLE `__new_history_features_conversation` (
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
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `history_conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_history_features_conversation`("conversation_id", "feature_json", "duration_min", "msg_count", "tool_call_count", "tool_error_rate", "cache_hit_ratio", "model_switches", "cost_usd", "intent_label", "opus_msg_ratio", "baseline_mean", "baseline_stddev", "classifier_version", "created_at", "updated_at") SELECT "conversation_id", "feature_json", "duration_min", "msg_count", "tool_call_count", "tool_error_rate", "cache_hit_ratio", "model_switches", "cost_usd", "intent_label", "opus_msg_ratio", "baseline_mean", "baseline_stddev", "classifier_version", "created_at", "updated_at" FROM `history_features_conversation`;--> statement-breakpoint
DROP TABLE `history_features_conversation`;--> statement-breakpoint
ALTER TABLE `__new_history_features_conversation` RENAME TO `history_features_conversation`;--> statement-breakpoint
CREATE INDEX `history_features_conversation_intent_idx` ON `history_features_conversation` (`intent_label`);--> statement-breakpoint
CREATE TABLE `__new_history_features_day` (
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
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `platform`)
);
--> statement-breakpoint
INSERT INTO `__new_history_features_day`("date", "platform", "feature_json", "active_hours", "conv_count", "cost_total", "tool_diversity_score", "commits_attributed", "baseline_mean", "baseline_stddev", "classifier_version", "created_at", "updated_at") SELECT "date", "platform", "feature_json", "active_hours", "conv_count", "cost_total", "tool_diversity_score", "commits_attributed", "baseline_mean", "baseline_stddev", "classifier_version", "created_at", "updated_at" FROM `history_features_day`;--> statement-breakpoint
DROP TABLE `history_features_day`;--> statement-breakpoint
ALTER TABLE `__new_history_features_day` RENAME TO `history_features_day`;--> statement-breakpoint
CREATE TABLE `__new_history_conversation` (
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
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_history_conversation`("id", "platform", "session_id", "started_at", "ended_at", "model", "msg_count", "intent_label", "cost_usd", "cache_hit_ratio", "model_switches", "classifier_version", "computer_name", "user_name", "project_name", "created_at", "updated_at") SELECT "id", "platform", "session_id", "started_at", "ended_at", "model", "msg_count", "intent_label", "cost_usd", "cache_hit_ratio", "model_switches", "classifier_version", "computer_name", "user_name", "project_name", "created_at", "updated_at" FROM `history_conversation`;--> statement-breakpoint
DROP TABLE `history_conversation`;--> statement-breakpoint
ALTER TABLE `__new_history_conversation` RENAME TO `history_conversation`;--> statement-breakpoint
CREATE INDEX `history_conversation_platform_started_idx` ON `history_conversation` (`platform`,`started_at`);--> statement-breakpoint
CREATE INDEX `history_conversation_session_idx` ON `history_conversation` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_conversation_intent_idx` ON `history_conversation` (`intent_label`);--> statement-breakpoint
CREATE TABLE `__new_history_daily_summary` (
	`date` text NOT NULL,
	`platform` text NOT NULL,
	`conversations` integer DEFAULT 0 NOT NULL,
	`messages` integer DEFAULT 0 NOT NULL,
	`tool_calls` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`total_input_tokens` integer DEFAULT 0 NOT NULL,
	`total_output_tokens` integer DEFAULT 0 NOT NULL,
	`active_hours` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `platform`)
);
--> statement-breakpoint
INSERT INTO `__new_history_daily_summary`("date", "platform", "conversations", "messages", "tool_calls", "total_cost_usd", "total_input_tokens", "total_output_tokens", "active_hours", "created_at", "updated_at") SELECT "date", "platform", "conversations", "messages", "tool_calls", "total_cost_usd", "total_input_tokens", "total_output_tokens", "active_hours", "created_at", "updated_at" FROM `history_daily_summary`;--> statement-breakpoint
DROP TABLE `history_daily_summary`;--> statement-breakpoint
ALTER TABLE `__new_history_daily_summary` RENAME TO `history_daily_summary`;--> statement-breakpoint
CREATE TABLE `__new_history_intent_summary` (
	`date` text NOT NULL,
	`intent_label` text NOT NULL,
	`conversations` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`avg_msg_count` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `intent_label`)
);
--> statement-breakpoint
INSERT INTO `__new_history_intent_summary`("date", "intent_label", "conversations", "total_cost_usd", "avg_msg_count", "created_at", "updated_at") SELECT "date", "intent_label", "conversations", "total_cost_usd", "avg_msg_count", "created_at", "updated_at" FROM `history_intent_summary`;--> statement-breakpoint
DROP TABLE `history_intent_summary`;--> statement-breakpoint
ALTER TABLE `__new_history_intent_summary` RENAME TO `history_intent_summary`;--> statement-breakpoint
CREATE TABLE `__new_history_message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content_sha256` text NOT NULL,
	`content_length` integer NOT NULL,
	`ts` integer NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `history_conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_history_message`("id", "conversation_id", "role", "content_sha256", "content_length", "ts", "created_at") SELECT "id", "conversation_id", "role", "content_sha256", "content_length", "ts", "created_at" FROM `history_message`;--> statement-breakpoint
DROP TABLE `history_message`;--> statement-breakpoint
ALTER TABLE `__new_history_message` RENAME TO `history_message`;--> statement-breakpoint
CREATE INDEX `history_message_conversation_idx` ON `history_message` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `history_message_ts_idx` ON `history_message` (`ts`);--> statement-breakpoint
CREATE TABLE `__new_history_token_usage` (
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
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `history_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `history_message`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_snapshot_id`) REFERENCES `history_pricing_snapshot`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_history_token_usage`("id", "conversation_id", "message_id", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "cost_usd", "pricing_snapshot_id", "ts", "created_at") SELECT "id", "conversation_id", "message_id", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "cost_usd", "pricing_snapshot_id", "ts", "created_at" FROM `history_token_usage`;--> statement-breakpoint
DROP TABLE `history_token_usage`;--> statement-breakpoint
ALTER TABLE `__new_history_token_usage` RENAME TO `history_token_usage`;--> statement-breakpoint
CREATE INDEX `history_token_usage_conversation_idx` ON `history_token_usage` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `history_token_usage_pricing_idx` ON `history_token_usage` (`pricing_snapshot_id`);--> statement-breakpoint
CREATE TABLE `__new_history_tool_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`success` integer NOT NULL,
	`is_retry` integer NOT NULL,
	`duration_ms` integer,
	`error_message` text,
	`ts` integer NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `history_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `history_message`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_history_tool_usage`("id", "conversation_id", "message_id", "tool_name", "success", "is_retry", "duration_ms", "error_message", "ts", "created_at") SELECT "id", "conversation_id", "message_id", "tool_name", "success", "is_retry", "duration_ms", "error_message", "ts", "created_at" FROM `history_tool_usage`;--> statement-breakpoint
DROP TABLE `history_tool_usage`;--> statement-breakpoint
ALTER TABLE `__new_history_tool_usage` RENAME TO `history_tool_usage`;--> statement-breakpoint
CREATE INDEX `history_tool_usage_conversation_idx` ON `history_tool_usage` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `history_tool_usage_tool_idx` ON `history_tool_usage` (`tool_name`);--> statement-breakpoint
CREATE TABLE `__new_history_pricing_snapshot` (
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
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_history_pricing_snapshot`("id", "platform", "model", "input_per_m_tokens_usd", "output_per_m_tokens_usd", "cache_read_per_m_tokens_usd", "cache_write_per_m_tokens_usd", "effective_from", "effective_until", "is_active", "source_url", "created_at", "updated_at") SELECT "id", "platform", "model", "input_per_m_tokens_usd", "output_per_m_tokens_usd", "cache_read_per_m_tokens_usd", "cache_write_per_m_tokens_usd", "effective_from", "effective_until", "is_active", "source_url", "created_at", "updated_at" FROM `history_pricing_snapshot`;--> statement-breakpoint
DROP TABLE `history_pricing_snapshot`;--> statement-breakpoint
ALTER TABLE `__new_history_pricing_snapshot` RENAME TO `history_pricing_snapshot`;--> statement-breakpoint
CREATE UNIQUE INDEX `history_pricing_snapshot_active_idx` ON `history_pricing_snapshot` (`platform`,`model`,`is_active`) WHERE "history_pricing_snapshot"."is_active" = 1;--> statement-breakpoint
CREATE TABLE `__new_history_raw_transcript_claude` (
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
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_history_raw_transcript_claude`("id", "session_id", "parent_id", "index_in_file", "message_id", "message_type", "role", "content_text", "content_sha256", "model", "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "event_ts", "event_date", "source_file", "source_offset", "processing_status", "processed_at", "computer_name", "user_name", "project_name", "created_at") SELECT "id", "session_id", "parent_id", "index_in_file", "message_id", "message_type", "role", "content_text", "content_sha256", "model", "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "event_ts", "event_date", "source_file", "source_offset", "processing_status", "processed_at", "computer_name", "user_name", "project_name", "created_at" FROM `history_raw_transcript_claude`;--> statement-breakpoint
DROP TABLE `history_raw_transcript_claude`;--> statement-breakpoint
ALTER TABLE `__new_history_raw_transcript_claude` RENAME TO `history_raw_transcript_claude`;--> statement-breakpoint
CREATE INDEX `history_raw_transcript_claude_status_idx` ON `history_raw_transcript_claude` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_transcript_claude_session_idx` ON `history_raw_transcript_claude` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_transcript_claude_event_ts_idx` ON `history_raw_transcript_claude` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_transcript_claude_event_date_idx` ON `history_raw_transcript_claude` (`event_date`);--> statement-breakpoint
CREATE TABLE `__new_history_raw_usage_claude` (
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
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_history_raw_usage_claude`("id", "session_id", "cluster_id", "version", "message_id", "message_role", "message_type", "model", "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "total_input_tokens", "total_output_tokens", "content_text", "content_sha256", "event_ts", "event_date", "source_file", "source_offset", "processing_status", "processed_at", "computer_name", "user_name", "project_name", "created_at") SELECT "id", "session_id", "cluster_id", "version", "message_id", "message_role", "message_type", "model", "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "total_input_tokens", "total_output_tokens", "content_text", "content_sha256", "event_ts", "event_date", "source_file", "source_offset", "processing_status", "processed_at", "computer_name", "user_name", "project_name", "created_at" FROM `history_raw_usage_claude`;--> statement-breakpoint
DROP TABLE `history_raw_usage_claude`;--> statement-breakpoint
ALTER TABLE `__new_history_raw_usage_claude` RENAME TO `history_raw_usage_claude`;--> statement-breakpoint
CREATE INDEX `history_raw_usage_claude_status_idx` ON `history_raw_usage_claude` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_usage_claude_session_idx` ON `history_raw_usage_claude` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_usage_claude_event_ts_idx` ON `history_raw_usage_claude` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_usage_claude_event_date_idx` ON `history_raw_usage_claude` (`event_date`);--> statement-breakpoint
CREATE TABLE `__new_history_raw_session_codex` (
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
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_history_raw_session_codex`("id", "session_id", "event_timestamp", "input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens", "model_context_window", "event_ts", "event_date", "source_file", "source_offset", "processing_status", "processed_at", "computer_name", "user_name", "project_name", "created_at") SELECT "id", "session_id", "event_timestamp", "input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens", "model_context_window", "event_ts", "event_date", "source_file", "source_offset", "processing_status", "processed_at", "computer_name", "user_name", "project_name", "created_at" FROM `history_raw_session_codex`;--> statement-breakpoint
DROP TABLE `history_raw_session_codex`;--> statement-breakpoint
ALTER TABLE `__new_history_raw_session_codex` RENAME TO `history_raw_session_codex`;--> statement-breakpoint
CREATE INDEX `history_raw_session_codex_status_idx` ON `history_raw_session_codex` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_session_codex_session_idx` ON `history_raw_session_codex` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_session_codex_event_ts_idx` ON `history_raw_session_codex` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_session_codex_event_date_idx` ON `history_raw_session_codex` (`event_date`);--> statement-breakpoint
CREATE TABLE `__new_history_raw_message_opencode` (
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
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_history_raw_message_opencode`("id", "session_id", "provider_id", "model_id", "time_created", "time_completed", "input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens", "cost", "event_ts", "event_date", "source_file", "source_offset", "processing_status", "processed_at", "computer_name", "user_name", "project_name", "created_at") SELECT "id", "session_id", "provider_id", "model_id", "time_created", "time_completed", "input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens", "cost", "event_ts", "event_date", "source_file", "source_offset", "processing_status", "processed_at", "computer_name", "user_name", "project_name", "created_at" FROM `history_raw_message_opencode`;--> statement-breakpoint
DROP TABLE `history_raw_message_opencode`;--> statement-breakpoint
ALTER TABLE `__new_history_raw_message_opencode` RENAME TO `history_raw_message_opencode`;--> statement-breakpoint
CREATE INDEX `history_raw_message_opencode_status_idx` ON `history_raw_message_opencode` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_message_opencode_session_idx` ON `history_raw_message_opencode` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_message_opencode_event_ts_idx` ON `history_raw_message_opencode` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_message_opencode_event_date_idx` ON `history_raw_message_opencode` (`event_date`);--> statement-breakpoint
CREATE TABLE `__new_history_raw_session_pi` (
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
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_history_raw_session_pi`("id", "record_type", "session_id", "parent_id", "timestamp", "provider", "model_id", "cwd", "role", "content_text", "content_sha256", "has_thinking", "has_tool_use", "input_tokens", "output_tokens", "total_tokens", "cache_read_tokens", "cache_creation_tokens", "tool_name", "tool_input", "tool_result", "is_error", "thinking_level", "event_ts", "event_date", "source_file", "source_offset", "processing_status", "processed_at", "computer_name", "user_name", "project_name", "created_at") SELECT "id", "record_type", "session_id", "parent_id", "timestamp", "provider", "model_id", "cwd", "role", "content_text", "content_sha256", "has_thinking", "has_tool_use", "input_tokens", "output_tokens", "total_tokens", "cache_read_tokens", "cache_creation_tokens", "tool_name", "tool_input", "tool_result", "is_error", "thinking_level", "event_ts", "event_date", "source_file", "source_offset", "processing_status", "processed_at", "computer_name", "user_name", "project_name", "created_at" FROM `history_raw_session_pi`;--> statement-breakpoint
DROP TABLE `history_raw_session_pi`;--> statement-breakpoint
ALTER TABLE `__new_history_raw_session_pi` RENAME TO `history_raw_session_pi`;--> statement-breakpoint
CREATE INDEX `history_raw_session_pi_status_idx` ON `history_raw_session_pi` (`processing_status`);--> statement-breakpoint
CREATE INDEX `history_raw_session_pi_session_idx` ON `history_raw_session_pi` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_session_pi_type_idx` ON `history_raw_session_pi` (`record_type`);--> statement-breakpoint
CREATE INDEX `history_raw_session_pi_event_ts_idx` ON `history_raw_session_pi` (`event_ts`);--> statement-breakpoint
CREATE INDEX `history_raw_session_pi_event_date_idx` ON `history_raw_session_pi` (`event_date`);--> statement-breakpoint
CREATE TABLE `__new_history_file_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`platform` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_ingested_at` integer,
	`batch_id` text,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `history_import_batch`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_history_file_registry`("id", "path", "sha256", "size_bytes", "platform", "last_seen_at", "last_ingested_at", "batch_id", "created_at", "updated_at") SELECT "id", "path", "sha256", "size_bytes", "platform", "last_seen_at", "last_ingested_at", "batch_id", "created_at", "updated_at" FROM `history_file_registry`;--> statement-breakpoint
DROP TABLE `history_file_registry`;--> statement-breakpoint
ALTER TABLE `__new_history_file_registry` RENAME TO `history_file_registry`;--> statement-breakpoint
CREATE UNIQUE INDEX `history_file_registry_path_sha_idx` ON `history_file_registry` (`path`,`sha256`);--> statement-breakpoint
CREATE INDEX `history_file_registry_platform_idx` ON `history_file_registry` (`platform`);--> statement-breakpoint
CREATE INDEX `history_file_registry_path_idx` ON `history_file_registry` (`path`);--> statement-breakpoint
CREATE TABLE `__new_history_import_batch` (
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
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_history_import_batch`("id", "platform", "source_root", "started_at", "finished_at", "files_discovered", "files_ingested", "events_ingested", "status", "error_message", "created_at", "updated_at") SELECT "id", "platform", "source_root", "started_at", "finished_at", "files_discovered", "files_ingested", "events_ingested", "status", "error_message", "created_at", "updated_at" FROM `history_import_batch`;--> statement-breakpoint
DROP TABLE `history_import_batch`;--> statement-breakpoint
ALTER TABLE `__new_history_import_batch` RENAME TO `history_import_batch`;--> statement-breakpoint
CREATE INDEX `history_import_batch_platform_idx` ON `history_import_batch` (`platform`);--> statement-breakpoint
CREATE INDEX `history_import_batch_status_idx` ON `history_import_batch` (`status`);--> statement-breakpoint
CREATE TABLE `__new_history_projection_run` (
	`id` text PRIMARY KEY NOT NULL,
	`target` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`since_ts` integer,
	`events_processed` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_history_projection_run`("id", "target", "started_at", "finished_at", "status", "since_ts", "events_processed", "error_message", "created_at", "updated_at") SELECT "id", "target", "started_at", "finished_at", "status", "since_ts", "events_processed", "error_message", "created_at", "updated_at" FROM `history_projection_run`;--> statement-breakpoint
DROP TABLE `history_projection_run`;--> statement-breakpoint
ALTER TABLE `__new_history_projection_run` RENAME TO `history_projection_run`;--> statement-breakpoint
CREATE INDEX `history_projection_run_target_idx` ON `history_projection_run` (`target`);--> statement-breakpoint
CREATE INDEX `history_projection_run_status_idx` ON `history_projection_run` (`status`);--> statement-breakpoint
CREATE TABLE `__new_history_raw_event` (
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
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`pricing_snapshot_id`) REFERENCES `history_pricing_snapshot`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_history_raw_event`("id", "event_type", "platform", "source_file", "source_offset", "event_ts", "ingested_at", "pricing_snapshot_id", "table_name", "raw_id", "event_date", "session_id", "model", "input_tokens", "output_tokens", "cache_read_tokens", "role", "computer_name", "user_name", "project_name", "created_at") SELECT "id", "event_type", "platform", "source_file", "source_offset", "event_ts", "ingested_at", "pricing_snapshot_id", "table_name", "raw_id", "event_date", "session_id", "model", "input_tokens", "output_tokens", "cache_read_tokens", "role", "computer_name", "user_name", "project_name", "created_at" FROM `history_raw_event`;--> statement-breakpoint
DROP TABLE `history_raw_event`;--> statement-breakpoint
ALTER TABLE `__new_history_raw_event` RENAME TO `history_raw_event`;--> statement-breakpoint
CREATE INDEX `history_raw_event_session_idx` ON `history_raw_event` (`session_id`);--> statement-breakpoint
CREATE INDEX `history_raw_event_date_idx` ON `history_raw_event` (`event_date`);--> statement-breakpoint
CREATE INDEX `history_raw_event_platform_date_idx` ON `history_raw_event` (`platform`,`event_date`);--> statement-breakpoint
CREATE INDEX `history_raw_event_table_idx` ON `history_raw_event` (`table_name`);--> statement-breakpoint
CREATE INDEX `history_raw_event_pricing_idx` ON `history_raw_event` (`pricing_snapshot_id`);--> statement-breakpoint
CREATE INDEX `history_raw_event_ts_idx` ON `history_raw_event` (`event_ts`);--> statement-breakpoint
CREATE UNIQUE INDEX `history_raw_event_source_dedup_idx` ON `history_raw_event` (`source_file`,`source_offset`,`event_type`);--> statement-breakpoint
CREATE TABLE `__new_history_redaction_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_event_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`original_sha256` text NOT NULL,
	`replacement_token` text NOT NULL,
	`field_path` text NOT NULL,
	`redacted_at` integer NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`raw_event_id`) REFERENCES `history_raw_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_history_redaction_audit`("id", "raw_event_id", "rule_id", "original_sha256", "replacement_token", "field_path", "redacted_at", "created_at") SELECT "id", "raw_event_id", "rule_id", "original_sha256", "replacement_token", "field_path", "redacted_at", "created_at" FROM `history_redaction_audit`;--> statement-breakpoint
DROP TABLE `history_redaction_audit`;--> statement-breakpoint
ALTER TABLE `__new_history_redaction_audit` RENAME TO `history_redaction_audit`;--> statement-breakpoint
CREATE INDEX `history_redaction_audit_event_idx` ON `history_redaction_audit` (`raw_event_id`);--> statement-breakpoint
CREATE INDEX `history_redaction_audit_rule_idx` ON `history_redaction_audit` (`rule_id`);--> statement-breakpoint
CREATE TABLE `__new_phase_run` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`state` text NOT NULL,
	`entered_at` integer NOT NULL,
	`exited_at` integer,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_phase_run`("id", "run_id", "state", "entered_at", "exited_at", "created_at", "updated_at") SELECT "id", "run_id", "state", "entered_at", "exited_at", "created_at", "updated_at" FROM `phase_run`;--> statement-breakpoint
DROP TABLE `phase_run`;--> statement-breakpoint
ALTER TABLE `__new_phase_run` RENAME TO `phase_run`;--> statement-breakpoint
CREATE INDEX `phase_run_run_idx` ON `phase_run` (`run_id`);--> statement-breakpoint
CREATE TABLE `__new_queue_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`last_error` text,
	`processing_at` integer,
	`expires_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_queue_jobs`("id", "type", "payload", "status", "attempts", "max_retries", "created_at", "updated_at", "next_retry_at", "last_error", "processing_at", "expires_at") SELECT "id", "type", "payload", "status", "attempts", "max_retries", "created_at", "updated_at", "next_retry_at", "last_error", "processing_at", "expires_at" FROM `queue_jobs`;--> statement-breakpoint
DROP TABLE `queue_jobs`;--> statement-breakpoint
ALTER TABLE `__new_queue_jobs` RENAME TO `queue_jobs`;--> statement-breakpoint
CREATE INDEX `queue_jobs_ready_idx` ON `queue_jobs` (`status`,`next_retry_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_run` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`workflow` text NOT NULL,
	`task` text NOT NULL,
	`dialect` text DEFAULT 'state-machine' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_run`("id", "workspace_id", "workflow", "task", "dialect", "status", "started_at", "finished_at", "created_at", "updated_at") SELECT "id", "workspace_id", "workflow", "task", "dialect", "status", "started_at", "finished_at", "created_at", "updated_at" FROM `run`;--> statement-breakpoint
DROP TABLE `run`;--> statement-breakpoint
ALTER TABLE `__new_run` RENAME TO `run`;--> statement-breakpoint
CREATE INDEX `run_workspace_idx` ON `run` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `run_status_idx` ON `run` (`status`);--> statement-breakpoint
CREATE TABLE `__new_run_event` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_run_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`redaction` text,
	`ts` integer NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`phase_run_id`) REFERENCES `phase_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_run_event`("id", "phase_run_id", "type", "payload", "redaction", "ts", "created_at") SELECT "id", "phase_run_id", "type", "payload", "redaction", "ts", "created_at" FROM `run_event`;--> statement-breakpoint
DROP TABLE `run_event`;--> statement-breakpoint
ALTER TABLE `__new_run_event` RENAME TO `run_event`;--> statement-breakpoint
CREATE INDEX `run_event_phase_idx` ON `run_event` (`phase_run_id`);--> statement-breakpoint
CREATE INDEX `run_event_type_idx` ON `run_event` (`type`);--> statement-breakpoint
CREATE TABLE `__new_transition_run` (
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
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_transition_run`("id", "run_id", "transition_id", "trigger_kind", "trigger_payload", "fired_at", "finished_at", "success", "result_data", "error", "created_at", "updated_at") SELECT "id", "run_id", "transition_id", "trigger_kind", "trigger_payload", "fired_at", "finished_at", "success", "result_data", "error", "created_at", "updated_at" FROM `transition_run`;--> statement-breakpoint
DROP TABLE `transition_run`;--> statement-breakpoint
ALTER TABLE `__new_transition_run` RENAME TO `transition_run`;--> statement-breakpoint
CREATE INDEX `transition_run_run_idx` ON `transition_run` (`run_id`);--> statement-breakpoint
CREATE INDEX `transition_run_run_fired_idx` ON `transition_run` (`run_id`,`fired_at`);--> statement-breakpoint
CREATE INDEX `transition_run_transition_id_idx` ON `transition_run` (`transition_id`);--> statement-breakpoint
CREATE INDEX `transition_run_trigger_kind_idx` ON `transition_run` (`trigger_kind`);--> statement-breakpoint
CREATE TABLE `__new_workflow_state` (
	`phase_run_id` text PRIMARY KEY NOT NULL,
	`current_state` text NOT NULL,
	`iteration_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`phase_run_id`) REFERENCES `phase_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_workflow_state`("phase_run_id", "current_state", "iteration_count", "created_at", "updated_at") SELECT "phase_run_id", "current_state", "iteration_count", "created_at", "updated_at" FROM `workflow_state`;--> statement-breakpoint
DROP TABLE `workflow_state`;--> statement-breakpoint
ALTER TABLE `__new_workflow_state` RENAME TO `workflow_state`;--> statement-breakpoint
CREATE TABLE `__new_workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_root` text NOT NULL,
	`workdir` text NOT NULL,
	`agent` text,
	`workflow` text,
	`purpose` text,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_workspace`("id", "name", "repo_root", "workdir", "agent", "workflow", "purpose", "created_at", "updated_at") SELECT "id", "name", "repo_root", "workdir", "agent", "workflow", "purpose", "created_at", "updated_at" FROM `workspace`;--> statement-breakpoint
DROP TABLE `workspace`;--> statement-breakpoint
ALTER TABLE `__new_workspace` RENAME TO `workspace`;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_name_unique` ON `workspace` (`name`);