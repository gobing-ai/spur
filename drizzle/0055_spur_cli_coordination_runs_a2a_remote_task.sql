-- 1334 R4: persist the remote A2A task id on the existing coordination run before any wait.
ALTER TABLE coordination_runs ADD COLUMN remote_task_id TEXT;
