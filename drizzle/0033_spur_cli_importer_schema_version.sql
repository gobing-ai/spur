-- 0748: record the applied importer schema version in the Spur migration ledger.
-- Sourced dynamically from @gobing-ai/ts-llm-jsonl-importer (HISTORY_IMPORT_SCHEMA_VERSION).
-- Suffix encoding gives idempotency for free via primary key (__spur_cli_migrations.id).
INSERT OR REPLACE INTO "__spur_cli_migrations" (id, applied_at)
VALUES ('importer_schema@0.4.55', strftime('%s', 'now') * 1000);
