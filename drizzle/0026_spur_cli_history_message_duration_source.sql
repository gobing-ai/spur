-- _spur_cli_ assistant-step duration provenance (task 0702 R2).
-- NULL means the value in duration_ms is the provider's own measurement (or absent).
-- 'derived' means the ETL computed it as a timestamp delta — an approximation that
-- includes queue and network time, and must never be reported as provider-measured.
ALTER TABLE history_message ADD COLUMN duration_source TEXT;
