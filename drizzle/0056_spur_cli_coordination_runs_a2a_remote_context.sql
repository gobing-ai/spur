-- 1334 R4: persist the remote A2A context id beside the task id.
ALTER TABLE coordination_runs ADD COLUMN remote_context_id TEXT;
