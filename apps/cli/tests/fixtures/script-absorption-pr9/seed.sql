INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json, created_at, terminal_reason) VALUES
 ('r1', 'wrapup-pipeline', 'done', '2025-08-20T00:00:00.000Z', '2025-08-20T00:02:00.000Z', '{}', 1755648000000, 'completed'),
 ('r2', 'wrapup-pipeline', 'done', '2025-08-21T00:00:00.000Z', '2025-08-21T00:05:00.000Z', '{}', 1755734400000, 'completed'),
 ('r3', 'pr-review', 'failed', '2025-08-21T00:00:00.000Z', '2025-08-21T00:00:05.000Z', '{}', 1755734400000, 'failed'),
 ('rdry', 'wrapup-pipeline', 'done', '2025-08-21T00:00:00.000Z', '2025-08-21T00:00:01.000Z', '{"dryRun":true}', 1755734400000, NULL),
 ('r4', 'task-lifecycle', 'running', '2025-08-21T00:00:00.000Z', NULL, '{}', 1755734400000, NULL);
INSERT INTO transition_runs (id, run_id, from_state, to_state, status, created_at) VALUES
 ('t1', 'r1', 'start', 'doc-sync', 'done', 1755648001000),
 ('t2', 'r1', 'doc-sync', 'end', 'done', 1755648100000),
 ('t3', 'r2', 'start', 'doc-sync', 'done', 1755734401000),
 ('t4', 'r2', 'doc-sync', 'doc-sync', 'done', 1755734500000),
 ('t5', 'r2', 'doc-sync', 'end', 'done', 1755734690000);
INSERT INTO action_runs (id, run_id, node, kind, status, duration_ms) VALUES
 ('a1', 'r1', 'doc-sync', 'agent.run', 'done', 60000),
 ('a2', 'r2', 'doc-sync', 'agent.run', 'done', 90000),
 ('a3', 'r2', 'doc-sync', 'agent.run', 'failed', 30000),
 ('a4', 'r3', 'review', 'shell', 'failed', 4000);
