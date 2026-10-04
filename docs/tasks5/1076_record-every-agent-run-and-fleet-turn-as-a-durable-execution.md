---
schema_version: 1
name: Record every agent run and fleet turn as a durable execution record with spur agent trace
status: todo
template: feature-impl
created_at: 2026-10-04T20:30:37.507Z
updated_at: "2026-10-04T20:57:46.755Z"
feature_id: G71

dependencies: ["1073", "1074"]
priority: P2
estimate_hours: 8
---

## 1076. Record every agent run and fleet turn as a durable execution record with spur agent trace

### Background

Implements G71 R7 — ADR-132 "Every execution is a run; the run id is Spur's session id" (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 item 15; decision D7, `spur agent trace` consented 2026-10-04).

Verified state (2026-10-04):

- Workflow runs already retain narration through `WorkflowRunLogSink` (`packages/app/src/observability/workflow-run-log-sink.ts:65`) into the `.spur/memory/runs/` record pair (ADR-045, ADR-131; `run-storage.ts:729` durable run dir).
- `spur agent run` and fleet member turns have no durable stream: the supervisor keeps a bounded in-memory ring buffer of frames (`packages/app/src/services/supervisor-service.ts:15-36`), lost on restart.
- `coordination_runs` (`packages/domain/src/migrations.ts:167`) has no parent link; `history_run_session` (`:220`) maps run → agent session.
- `spur workflow trace <runId> --output` streams the record pair but is workflow-scoped.

**Refine corrections (2026-10-04)**

- R1 says to tee into `.spur/memory/runs/<runId>.log` "through the existing `WorkflowRunLogSink`". In reality the sink subscribes only to `workflow.*` observability events (`workflow-run-log-sink.ts:109-121`) and writes `<runId>.md` + `<runId>.state.json`; `.log` is the legacy name, read only as a fallback (`apps/cli/src/commands/workflow.ts:2083`) → agent runs write `.spur/memory/runs/<runId>.md` through a small `AgentRunLog` sibling. It reuses the sink's persistence-boundary redaction (`redactAndBound`, `agent-execution.ts`) and `DEFAULT_RUN_LOG_MAX_BYTES`, and is fed from the `onOutput` hook at `agent-service.ts:1507`. There is no state file; the DB row is the state.
- R3 says "the dispatch message carries the parent run id", but inbox rows have no metadata column → the parent comes from evidence that already exists. A workflow dispatch key `<runId>/<state>` names its parent. Nested runs inherit `SPUR_RUN_ID`, the dispatching run's id, which ts-ai-runner injects (`AGENT_RUN_ID_ENV`, `node_modules/@gobing-ai/ts-ai-runner/dist/ai-runner.js`). Strategy dispatches are roots.
- Next migration prefix: `0050`. `drizzle/0049_spur_cli_runs_terminal_reason.sql` is the latest; follow the guarded-ALTER + `CLI_MIGRATIONS` mirror precedent of 0044/0049 in `packages/domain/src/migrations.ts`.
- Persistent members write no run row (see 1074) → the supervisor stamps frames with the run id only while a keyed `svc.run` is live. Persistent stdin turns are unkeyed conversation and keep untagged frames.

### Requirements

- [ ] R1. `spur agent run` and every fleet member turn append stdout/stderr frames, secret-redacted and byte-capped with the `WorkflowRunLogSink` persistence-boundary rules, to `.spur/memory/runs/<runId>.md`, under ADR-131 retention.
- [ ] R2. The supervisor ring buffer tags each frame with the current `run_id`; the buffer stays a live view, not the record.
- [ ] R3. Migration `0050` adds `coordination_runs.parent_run_id`; the exit sink persists it from the workflow dispatch key (`<runId>/<state>`) or the inherited `SPUR_RUN_ID`.
- [ ] R4. New `spur agent trace <runId> [--follow] [--json]` prints the lineage tree (root to leaves), each run's agent session ids from `history_run_session`, and the stream; `--follow` polls until terminal. Logic lives in `packages/app`; the CLI is a thin transport (ADR-130).
- [ ] R5. Surface docs: `docs/design/cli-contracts.md`, the `sp:spur-cli` agent reference, and `03_ARCHITECTURE` record the execution record.

### Acceptance Criteria

- [ ] AC1 — Every execution has a durable record

Task-local verification:

- After a member turn and a simulated serve restart, `spur agent trace <root> --json` returns the dispatch → turn lineage, the turn's agent session id, and its stdout/stderr lines.
- Redaction masks a configured secret in the stored log.
- The CLI surface parity test lists `agent trace`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-04T20:57:13.688Z

- **Q: Can a trace root be a workflow run?** A: Yes. Nodes are `{ runId, kind: 'workflow' | 'agent', status, parentRunId, sessionIds[], logPath }`:
  - workflow runs come from the `runs` table
  - agent runs come from `coordination_runs`
  - children are `coordination_runs` rows with `parent_run_id = node.runId`
  - a workflow's own agent.run turns are its children through `SPUR_RUN_ID`
- **Q: Is `--follow` bounded?** A: Yes. It reuses `SHARED_OPTIONS.timeout` and `FOLLOW_POLL_INTERVAL_MS`. On timeout it prints one checkpoint line and exits 1, matching `spur workflow trace --follow`.
- **Q: Retention?** A: The agent `.md` files live in the same `.spur/memory/runs/` directory that the ADR-131 run-log retention resolver (`packages/app/src/workflow/run-record.ts:74`) reclaims. Confirm the reclaimer selects by file age, not by workflow row; if it needs a row, add the agent-run case in the same function.
- **Q: Does the public surface change?** A: Only `agent trace`, which was consented on 2026-10-04 (ADR-051).

### Design

**AgentRunLog** — new file `packages/app/src/observability/agent-run-log.ts`:
- `open(dir, runId, secrets)`, `append(stream, line)`, `close()`
- lines are formatted `[ISO] stdout| …`
- each append runs `redactAndBound(text, secrets, MAX_SAFE_INTEGER)`
- writes stop at `DEFAULT_RUN_LOG_MAX_BYTES`, with one truncation marker
- best-effort: an I/O failure degrades the record, never the run (same contract as `WorkflowRunLogSink`)

**Agent service** (`packages/app/src/services/agent-service.ts`)
- Open the log after `insertStart` (`:1284-1310`) under `.spur/memory/runs/`.
- Wrap `onOutput` at `:1507` so it calls `lifecycle.observe(output)` and then `log.append`.
- Close the log in the `finally` at `:1648-1680`.
- `insertStart` also receives `parentRunId`, in this order:
  1. `flags.parentRunId`, set by `drainIntoPrompt` from a claimed `<runId>/<state>` key
  2. `env.SPUR_RUN_ID`, when it differs from the run's own id
  3. `null`
- Before relying on it, verify that the env name matches `AGENT_RUN_ID_ENV`.

**Migration**
- `drizzle/0050_spur_cli_coordination_runs_parent.sql`: `ALTER TABLE coordination_runs ADD COLUMN parent_run_id TEXT; CREATE INDEX IF NOT EXISTS idx_coordination_runs_parent ON coordination_runs (parent_run_id);`
- Mirror it as a `CLI_MIGRATIONS` entry with guarded `addColumnIfMissing` (0044 precedent) in `packages/domain/src/migrations.ts`.
- Update `COORDINATION_RUNS_SCHEMA_SQL` for new databases.
- `CoordinationRunDao` gains `listByParentRunId(runId)`; `insertStart` accepts `parentRunId`.

**Supervisor** (`packages/app/src/services/supervisor-service.ts`)
- `ProcessFrame` gains `runId?: string`.
- Add `setCurrentRun(agentId, runId | undefined)`; frame push stamps the current value.
- The loop sets it around keyed `svc.run` drains via `AgentLoopDeps`.

**Trace service** — new file `packages/app/src/services/agent-trace-service.ts`:
- `trace(runId): Promise<TraceTree>` resolves the root by walking `parent_run_id` up, then builds the tree down with `listByParentRunId`.
- Session ids come from `RunSessionDao.getByRunId` (exact rows).
- The stream is the `.md` file per node.
- `follow(runId, { timeoutMs, signal, onLine })` tails the files until every node is terminal.

**CLI.** Register `agent trace` in `apps/cli/src/commands/agent.ts` next to `wait`, using the shared options `json`, `jsonEnvelope` and `timeout`. Human output shows an indented tree, then each node's stream.

**Docs**
- `docs/design/cli-contracts.md` (agent trace row)
- `plugins/sp/skills/spur-cli/references/agent.md`
- `docs/03_ARCHITECTURE.md` (execution record)
- `plugins/sp/tests/cli-surface-parity.test.ts` must list `agent trace`

### Plan

1. Write the failure list first as tests:
   - a configured secret leaks into the log
   - a log write failure fails the run
   - the parent is lost across `SPUR_RUN_ID`
   - a trace does not survive a restart
   - `--follow` never ends
2. Add migration 0050, its mirror, and the DAO `parentRunId` / `listByParentRunId`; add domain tests on in-memory SQLite.
3. Add `AgentRunLog` and wire it into `agent-service`; resolve the parent id; set `parentRunId` in `drainIntoPrompt` from the workflow key.
4. Add supervisor frame `runId` tagging and the loop hook.
5. Add `AgentTraceService` and the `agent trace` CLI.
6. Update the docs, the spur-cli reference and the parity test.
7. Scenario test: run a member turn, then recreate the services to simulate a restart. `trace <root> --json` must show the dispatch → turn lineage, session ids and stream lines, with the secret masked.
8. Gates: focused domain/app/cli tests, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:46.755Z backlog → todo (system)

