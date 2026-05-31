CREATE TABLE `history_etl_message_antigravity` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_event_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`block_index` integer DEFAULT 0 NOT NULL,
	`text` text,
	`thinking` text,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_creation_tokens` integer,
	`total_tokens` integer,
	`event_ts` integer NOT NULL,
	`event_date` text NOT NULL,
	`project_name` text,
	`computer_name` text,
	`user_name` text
);
--> statement-breakpoint
CREATE INDEX `etl_message_antigravity_raw_event_idx` ON `history_etl_message_antigravity` (`raw_event_id`);--> statement-breakpoint
CREATE INDEX `etl_message_antigravity_session_idx` ON `history_etl_message_antigravity` (`session_id`);--> statement-breakpoint
CREATE INDEX `etl_message_antigravity_type_idx` ON `history_etl_message_antigravity` (`type`);--> statement-breakpoint
CREATE INDEX `etl_message_antigravity_event_ts_idx` ON `history_etl_message_antigravity` (`event_ts`);--> statement-breakpoint
CREATE INDEX `etl_message_antigravity_event_date_idx` ON `history_etl_message_antigravity` (`event_date`);--> statement-breakpoint
CREATE INDEX `etl_message_antigravity_model_idx` ON `history_etl_message_antigravity` (`model`);--> statement-breakpoint
CREATE TABLE `history_etl_usage_claude` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_event_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`block_index` integer DEFAULT 0 NOT NULL,
	`text` text,
	`thinking` text,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_creation_tokens` integer,
	`total_tokens` integer,
	`event_ts` integer NOT NULL,
	`event_date` text NOT NULL,
	`project_name` text,
	`computer_name` text,
	`user_name` text
);
--> statement-breakpoint
CREATE INDEX `etl_usage_claude_raw_event_idx` ON `history_etl_usage_claude` (`raw_event_id`);--> statement-breakpoint
CREATE INDEX `etl_usage_claude_session_idx` ON `history_etl_usage_claude` (`session_id`);--> statement-breakpoint
CREATE INDEX `etl_usage_claude_type_idx` ON `history_etl_usage_claude` (`type`);--> statement-breakpoint
CREATE INDEX `etl_usage_claude_event_ts_idx` ON `history_etl_usage_claude` (`event_ts`);--> statement-breakpoint
CREATE INDEX `etl_usage_claude_event_date_idx` ON `history_etl_usage_claude` (`event_date`);--> statement-breakpoint
CREATE INDEX `etl_usage_claude_model_idx` ON `history_etl_usage_claude` (`model`);--> statement-breakpoint
CREATE TABLE `history_etl_session_codex` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_event_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`block_index` integer DEFAULT 0 NOT NULL,
	`text` text,
	`thinking` text,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_creation_tokens` integer,
	`total_tokens` integer,
	`event_ts` integer NOT NULL,
	`event_date` text NOT NULL,
	`project_name` text,
	`computer_name` text,
	`user_name` text
);
--> statement-breakpoint
CREATE INDEX `etl_session_codex_raw_event_idx` ON `history_etl_session_codex` (`raw_event_id`);--> statement-breakpoint
CREATE INDEX `etl_session_codex_session_idx` ON `history_etl_session_codex` (`session_id`);--> statement-breakpoint
CREATE INDEX `etl_session_codex_type_idx` ON `history_etl_session_codex` (`type`);--> statement-breakpoint
CREATE INDEX `etl_session_codex_event_ts_idx` ON `history_etl_session_codex` (`event_ts`);--> statement-breakpoint
CREATE INDEX `etl_session_codex_event_date_idx` ON `history_etl_session_codex` (`event_date`);--> statement-breakpoint
CREATE INDEX `etl_session_codex_model_idx` ON `history_etl_session_codex` (`model`);--> statement-breakpoint
CREATE TABLE `history_etl_message_gemini` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_event_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`block_index` integer DEFAULT 0 NOT NULL,
	`text` text,
	`thinking` text,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_creation_tokens` integer,
	`total_tokens` integer,
	`event_ts` integer NOT NULL,
	`event_date` text NOT NULL,
	`project_name` text,
	`computer_name` text,
	`user_name` text
);
--> statement-breakpoint
CREATE INDEX `etl_message_gemini_raw_event_idx` ON `history_etl_message_gemini` (`raw_event_id`);--> statement-breakpoint
CREATE INDEX `etl_message_gemini_session_idx` ON `history_etl_message_gemini` (`session_id`);--> statement-breakpoint
CREATE INDEX `etl_message_gemini_type_idx` ON `history_etl_message_gemini` (`type`);--> statement-breakpoint
CREATE INDEX `etl_message_gemini_event_ts_idx` ON `history_etl_message_gemini` (`event_ts`);--> statement-breakpoint
CREATE INDEX `etl_message_gemini_event_date_idx` ON `history_etl_message_gemini` (`event_date`);--> statement-breakpoint
CREATE INDEX `etl_message_gemini_model_idx` ON `history_etl_message_gemini` (`model`);--> statement-breakpoint
CREATE TABLE `history_etl_message_openclaw` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_event_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`block_index` integer DEFAULT 0 NOT NULL,
	`text` text,
	`thinking` text,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_creation_tokens` integer,
	`total_tokens` integer,
	`event_ts` integer NOT NULL,
	`event_date` text NOT NULL,
	`project_name` text,
	`computer_name` text,
	`user_name` text
);
--> statement-breakpoint
CREATE INDEX `etl_message_openclaw_raw_event_idx` ON `history_etl_message_openclaw` (`raw_event_id`);--> statement-breakpoint
CREATE INDEX `etl_message_openclaw_session_idx` ON `history_etl_message_openclaw` (`session_id`);--> statement-breakpoint
CREATE INDEX `etl_message_openclaw_type_idx` ON `history_etl_message_openclaw` (`type`);--> statement-breakpoint
CREATE INDEX `etl_message_openclaw_event_ts_idx` ON `history_etl_message_openclaw` (`event_ts`);--> statement-breakpoint
CREATE INDEX `etl_message_openclaw_event_date_idx` ON `history_etl_message_openclaw` (`event_date`);--> statement-breakpoint
CREATE INDEX `etl_message_openclaw_model_idx` ON `history_etl_message_openclaw` (`model`);--> statement-breakpoint
CREATE TABLE `history_etl_message_opencode` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_event_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`block_index` integer DEFAULT 0 NOT NULL,
	`text` text,
	`thinking` text,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_creation_tokens` integer,
	`total_tokens` integer,
	`event_ts` integer NOT NULL,
	`event_date` text NOT NULL,
	`project_name` text,
	`computer_name` text,
	`user_name` text
);
--> statement-breakpoint
CREATE INDEX `etl_message_opencode_raw_event_idx` ON `history_etl_message_opencode` (`raw_event_id`);--> statement-breakpoint
CREATE INDEX `etl_message_opencode_session_idx` ON `history_etl_message_opencode` (`session_id`);--> statement-breakpoint
CREATE INDEX `etl_message_opencode_type_idx` ON `history_etl_message_opencode` (`type`);--> statement-breakpoint
CREATE INDEX `etl_message_opencode_event_ts_idx` ON `history_etl_message_opencode` (`event_ts`);--> statement-breakpoint
CREATE INDEX `etl_message_opencode_event_date_idx` ON `history_etl_message_opencode` (`event_date`);--> statement-breakpoint
CREATE INDEX `etl_message_opencode_model_idx` ON `history_etl_message_opencode` (`model`);--> statement-breakpoint
CREATE TABLE `history_etl_session_pi` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_event_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`block_index` integer DEFAULT 0 NOT NULL,
	`text` text,
	`thinking` text,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_creation_tokens` integer,
	`total_tokens` integer,
	`event_ts` integer NOT NULL,
	`event_date` text NOT NULL,
	`project_name` text,
	`computer_name` text,
	`user_name` text
);
--> statement-breakpoint
CREATE INDEX `etl_session_pi_raw_event_idx` ON `history_etl_session_pi` (`raw_event_id`);--> statement-breakpoint
CREATE INDEX `etl_session_pi_session_idx` ON `history_etl_session_pi` (`session_id`);--> statement-breakpoint
CREATE INDEX `etl_session_pi_type_idx` ON `history_etl_session_pi` (`type`);--> statement-breakpoint
CREATE INDEX `etl_session_pi_event_ts_idx` ON `history_etl_session_pi` (`event_ts`);--> statement-breakpoint
CREATE INDEX `etl_session_pi_event_date_idx` ON `history_etl_session_pi` (`event_date`);--> statement-breakpoint
CREATE INDEX `etl_session_pi_model_idx` ON `history_etl_session_pi` (`model`);--> statement-breakpoint
CREATE TABLE `history_etl_transcript_claude` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_event_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`block_index` integer DEFAULT 0 NOT NULL,
	`text` text,
	`thinking` text,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_creation_tokens` integer,
	`total_tokens` integer,
	`event_ts` integer NOT NULL,
	`event_date` text NOT NULL,
	`project_name` text,
	`computer_name` text,
	`user_name` text
);
--> statement-breakpoint
CREATE INDEX `etl_transcript_claude_raw_event_idx` ON `history_etl_transcript_claude` (`raw_event_id`);--> statement-breakpoint
CREATE INDEX `etl_transcript_claude_session_idx` ON `history_etl_transcript_claude` (`session_id`);--> statement-breakpoint
CREATE INDEX `etl_transcript_claude_type_idx` ON `history_etl_transcript_claude` (`type`);--> statement-breakpoint
CREATE INDEX `etl_transcript_claude_event_ts_idx` ON `history_etl_transcript_claude` (`event_ts`);--> statement-breakpoint
CREATE INDEX `etl_transcript_claude_event_date_idx` ON `history_etl_transcript_claude` (`event_date`);--> statement-breakpoint
CREATE INDEX `etl_transcript_claude_model_idx` ON `history_etl_transcript_claude` (`model`);--> statement-breakpoint
CREATE TABLE `history_invocation` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`ts` integer NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_invocation_conversation_idx` ON `history_invocation` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `history_invocation_kind_idx` ON `history_invocation` (`kind`);--> statement-breakpoint
ALTER TABLE `history_raw_message_antigravity` DROP COLUMN `model_id`;--> statement-breakpoint
ALTER TABLE `history_raw_message_antigravity` DROP COLUMN `provider_id`;--> statement-breakpoint
ALTER TABLE `history_raw_message_antigravity` DROP COLUMN `input_tokens`;--> statement-breakpoint
ALTER TABLE `history_raw_message_antigravity` DROP COLUMN `output_tokens`;--> statement-breakpoint
ALTER TABLE `history_raw_message_antigravity` DROP COLUMN `total_tokens`;--> statement-breakpoint
ALTER TABLE `history_raw_message_gemini` DROP COLUMN `model_id`;--> statement-breakpoint
ALTER TABLE `history_raw_message_gemini` DROP COLUMN `provider_id`;--> statement-breakpoint
ALTER TABLE `history_raw_message_gemini` DROP COLUMN `input_tokens`;--> statement-breakpoint
ALTER TABLE `history_raw_message_gemini` DROP COLUMN `output_tokens`;--> statement-breakpoint
ALTER TABLE `history_raw_message_gemini` DROP COLUMN `total_tokens`;--> statement-breakpoint
ALTER TABLE `history_raw_session_pi` DROP COLUMN `has_thinking`;--> statement-breakpoint
ALTER TABLE `history_raw_session_pi` DROP COLUMN `has_tool_use`;