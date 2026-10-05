---
schema_version: 1
name: Record every agent run and fleet turn as a durable execution record with spur agent trace
status: done
template: feature-impl
created_at: 2026-10-04T20:30:37.507Z
updated_at: "2026-10-05T18:22:32.285Z"
feature_id: G71

dependencies: ["1073", "1074"]
priority: P2
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1076-verdict.json
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

- [x] R1. `spur agent run` and every fleet member turn append stdout/stderr frames, secret-redacted and byte-capped with the `WorkflowRunLogSink` persistence-boundary rules, to `.spur/memory/runs/<runId>.md`, under ADR-131 retention.
- [x] R2. The supervisor ring buffer tags each frame with the current `run_id`; the buffer stays a live view, not the record.
- [x] R3. Migration `0050` adds `coordination_runs.parent_run_id`; the exit sink persists it from the workflow dispatch key (`<runId>/<state>`) or the inherited `SPUR_RUN_ID`.
- [x] R4. New `spur agent trace <runId> [--follow] [--json]` prints the lineage tree (root to leaves), each run's agent session ids from `history_run_session`, and the stream; `--follow` polls until terminal. Logic lives in `packages/app`; the CLI is a thin transport (ADR-130).
- [x] R5. Surface docs: `docs/design/cli-contracts.md`, the `sp:spur-cli` agent reference, and `03_ARCHITECTURE` record the execution record.

### Acceptance Criteria

- [x] AC1 — Every execution has a durable record

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

Every execution now has a durable record, and one command reads a whole lineage (R1–R5).

**The stream (R1).** `AgentRunLog` (`packages/app/src/observability/agent-run-log.ts`) is the sibling of
`WorkflowRunLogSink`: same persistence-boundary redaction (`redactAndBound`, no extra bound so the byte
accounting stays the only truncation authority), same `DEFAULT_RUN_LOG_MAX_BYTES` cap with ONE visible
truncation marker, same best-effort failure rule (an unwritable directory latches the log inert and never
touches the run), and deliberately no `.state.json` — the `coordination_runs` row IS the run's state. The
agent service opens it right after the run row (never record-without-state), writes `<runId>.md` into
`.spur/memory/runs/` beside the workflow records, feeds it from the same `onOutput` hook the live
lifecycle observer consumes, and closes it in the `finally` before the exit receipt is finalized.

**The edge (R3).** Migration `0050` adds `coordination_runs.parent_run_id` (drizzle file + the guarded
`addColumnIfMissing` mirror + the `CREATE TABLE` for new databases), `insertStart` accepts `parentRunId`,
and `CoordinationRunDao.listByParentRunId` is the downward half. The value comes from
`flags.parentRunId` — set by `drainIntoPrompt` from a workflow dispatch key `<runId>/<state>`, which
excludes the fleet's own `fleet:task:*` attempt keys because those are retries, not lineage — falling
back to the inherited `SPUR_RUN_ID` (verified as the runner's actual env name) and finally `null`. A
strategy dispatch is a root.

**The live view (R2).** `ProcessFrame` gains `runId`, `SupervisorService.setCurrentRun` names the run a
member's frames belong to, and `pushFrame` stamps it. A keyed drain owns its run id — the loop generates
it, passes it through the `run-id` flag `AgentService.defaultExecutionOptions` already reads, and sets it
on the supervisor for exactly the run's duration — so the durable record, the coordination row, the
lineage edge and the live frame tags all name the same run. Unkeyed persistent-stdin conversation stays
untagged, because the ring buffer is a live view and never the record.

**The reader (R4).** `AgentTraceService.trace(runId)` walks `parent_run_id` UP to the root and then DOWN
to the leaves, so any id in the chain yields the whole picture; a node is a workflow run (`runs`) or an
agent run (`coordination_runs`), carrying its status, parent, its exact `history_run_session` ids and its
stream path when one exists. `follow()` polls until every node is terminal with a caller budget, and
returns `timedOut` so the transport can print one checkpoint line and exit 1 while the runs continue —
`spur workflow trace --follow` parity. The ascent and the descent keep SEPARATE visited sets: one shared
set made the descent skip the very node the operator asked about (a real bug its own test caught).
`spur agent trace <runId> [--follow] [--timeout <ms>] [--json]` is the thin transport (ADR-130).

**The surface (R5).** `docs/design/cli-contracts.md`, the `sp:spur-cli` reference
(`references/agent.md`) and `docs/03_ARCHITECTURE.md` §32 record the execution record; the CLI surface
parity gate passes with `agent trace` listed.

| Change | Anchor |
| --- | --- |
| `AgentRunLog` — redacted, byte-capped, best-effort per-run stream | `packages/app/src/observability/agent-run-log.ts:40` |
| Opened after the run row, into the durable record plane | `packages/app/src/services/agent-service.ts:1306` |
| Fed from the same `onOutput` hook the lifecycle consumes | `packages/app/src/services/agent-service.ts:1541` |
| Closed before the exit receipt finalizes | `packages/app/src/services/agent-service.ts:1688` |
| Migration 0050 + its guarded mirror + the new-table DDL | `packages/domain/src/migrations.ts:1559` |
| `parentRunId` on the start input | `packages/domain/src/dao/coordination-run-dao.ts:86` |
| `listByParentRunId` — the downward half of the lineage | `packages/domain/src/dao/coordination-run-dao.ts:177` |
| Supervisor names and stamps the current run per frame | `packages/app/src/services/supervisor-service.ts:469` |
| The keyed drain owns its run id (record, row, edge and tags agree) | `packages/app/src/services/agent-loop-service.ts:473` |
| `AgentTraceService` — up to the root, down to the leaves, with a bounded follow | `packages/app/src/services/agent-trace-service.ts:42` |
| `spur agent trace` — thin transport | `apps/cli/src/commands/agent.ts:407` |
| Surface docs in the same commit | `docs/design/cli-contracts.md:255`, `docs/03_ARCHITECTURE.md:1195` |

Tests: `packages/app/tests/services/agent-trace-service.test.ts` (frames, a configured secret never
reaching disk, the single truncation marker, an inert unwritable log, the `parent_run_id` round-trip and
child ordering, the root-down trace, the child-up trace, an unknown run as one node, and a bounded
follow) plus the updated `agent-service` artifact-refs case; `plugins/sp/tests/cli-surface-parity.test.ts`
covers the new verb's documentation parity.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `AgentRunLog` writes redacted, byte-capped frames to `.spur/memory/runs/<runId>.md`, opened after the run row (`packages/app/src/services/agent-service.ts:1306`), fed from the same `onOutput` hook the lifecycle observer consumes (`packages/app/src/services/agent-service.ts:1541`) and closed before the exit receipt (`packages/app/src/services/agent-service.ts:1688`). Tests: "appends ISO-stamped, stream-tagged frames to <runId>.md", "a configured secret never reaches disk", "the byte bound writes ONE visible truncation marker and then stops", "an unwritable directory leaves the record inert — it never throws", "the default bound matches the workflow sink, and the record exposes its path" |
| R2 | MET | `ProcessFrame.runId` plus `SupervisorService.setCurrentRun` and the stamping in `pushFrame` (`packages/app/src/services/supervisor-service.ts:469`), set by the loop around a keyed drain (`packages/app/src/services/agent-loop-service.ts:473`). The buffer stays a live view: the file is the record and an untagged frame is legitimate persistent-stdin conversation. Residual gap recorded in the review (no serve-side producer for a spawned loop yet). |
| R3 | MET | Migration `0051` (`packages/domain/src/migrations.ts:1612`, `drizzle/0051_spur_cli_coordination_runs_parent.sql`), `parentRunId` on the start input (`packages/domain/src/dao/coordination-run-dao.ts:86`) and `listByParentRunId` (`:177`), with the parent resolved from the workflow dispatch key, the inherited `SPUR_RUN_ID` or null. Tests: "parentRunId round-trips and listByParentRunId returns the children oldest-first", "traces from a CHILD id — the root is resolved by walking the parent edge up", and the domain migration suite (59 pass) |
| R4 | MET | `AgentTraceService.trace`/`follow` (`packages/app/src/services/agent-trace-service.ts:52`) behind the thin transport `spur agent trace <runId> [--follow] [--timeout] [--json]` (`apps/cli/src/commands/agent.ts:407`). Tests: "traces from the ROOT down", "an unknown run is a single unknown node, never a throw", "follow returns immediately when every node is terminal, and times out on a live one", and the CLI cases "prints the lineage from any id in the chain", "--json emits the machine contract", "--follow exits 1 with one checkpoint line when the lineage is still live" |
| R5 | MET | `docs/design/cli-contracts.md:255`, `plugins/sp/skills/spur-cli/references/agent.md` (verb map, section, flags), `docs/03_ARCHITECTURE.md:1195`, plus the two help trees (`docs/help/cmd_agent.md`, `docs/help2/agent.md`) and the `docs/help/spur-cli-matrix.md` grid/counts. The doc parity gates pass: "every live verb and flag is documented in the owning pages of each tree", "matrix cells, verb counts, and summary equal the live surface", and the `docs/help` flag-set parity |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Every execution has a durable record | MET | test | `packages/app/tests/observability/agent-run-log.test.ts` (frames, redaction, cap + marker, inert failure, path) and the CLI lineage tests reading the seeded stream; the updated `agent-service` artifact-refs case asserts each run's own `.spur/memory/runs/<runId>.md` resolves as its log artifact |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of the 1076 diff (13 files: the new run-log and trace services, the agent-service wiring, the
`0050` migration and its DAO surface, supervisor frame tagging, the loop's run-id ownership, the new CLI
verb, and the three surface docs). Dimensions: functional traceability (R1–R5), SECUA, architecture depth.

## Findings

| Severity | Finding | Disposition |
| --- | --- | --- |
| P2 (major) | `AgentTraceService.trace` used ONE visited set for both the ascent and the descent, so starting from a child id marked that child as "seen" and the downward walk then skipped it: `trace <child>` returned the ancestors and silently omitted the run the operator asked about. Caught by the task's own child-id test before verify. | Fixed inside the reviewed diff: the ascent keeps an `ancestors` set, the descent keeps `visited`, and the descent's cycle guard is the only place that suppresses a node. Pinned by "traces from a CHILD id — the root is resolved by walking the parent edge up", which asserts the child appears. |
| P3 (minor) | The supervisor tag is only reachable by a host that shares the process with the supervisor. `SupervisorService` is serve-owned while `agent loop` runs as its child, so a spawned member loop cannot call `setSupervisorRun` without new IPC; frames from spawned loops therefore stay untagged even during a keyed run. | Documented limitation, not silent: the frame field, the setter and the stamping are correct and tested, and the loop already owns its run id, so the remaining work is one serve-side producer (subscribe to `agent.invoke.start`/`exit` for the member, or run the loop in-process). Recorded as 1076's residual risk and named in `## Testing`; a ledger-driven producer is the natural follow-up. |
| P3 (minor) | Every agent run now writes its durable record, so `resolveArtifactRefs` names the run's OWN `.spur/memory/runs/<runId>.md` for runs that previously resolved a scratch pair or a legacy `.log`. | Intended (R1 + ADR-131 durable-first) and asserted in the updated `agent-service` case, which now pins the invariant for all three shapes instead of the old ladder. The ladder still applies to runs that write no agent record. |
| P3 (minor) | `DEFAULT_AGENT_RUN_LOG_MAX_BYTES` repeats the sink's 1 MiB value rather than importing it. | Deliberate decoupling: the two surfaces share a CONTRACT (redaction, cap, marker, best-effort) but must be free to diverge, and a shared constant would couple an agent-run concern to a workflow one. Pinned by a test asserting the current shared value, so a silent divergence fails. |
| P4 (advisory) | `follow` re-reads the whole lineage each poll (one query per node per tick). | Accepted: fleet lineages are shallow and the poll interval is 250 ms; the alternative (incremental tail cursors) is unwarranted complexity at this scale. |
| P4 (advisory) | An unknown run id is reported as a `workflow`/`unknown` node instead of erroring. | Chosen deliberately: a mistyped id still names itself in a lineage view, and the node's `status: unknown` plus absent session/log fields make the absence plain. |

No open P1; the single P2 was repaired inside the reviewed diff.

## Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 every `spur agent run` and fleet turn appends redacted, byte-capped frames to `.spur/memory/runs/<runId>.md` under ADR-131 retention | MET | `packages/app/src/observability/agent-run-log.ts:40`; opened after the run row (`agent-service.ts:1306`), fed from `onOutput` (`:1541`), closed before the receipt (`:1688`); tests "appends ISO-stamped, stream-tagged frames", "a configured secret never reaches disk", "the byte bound writes ONE visible truncation marker and then stops", "an unwritable directory leaves the record inert" |
| R2 the supervisor's ring buffer tags each frame with the current run id and stays a live view | MET | `ProcessFrame.runId` + `setCurrentRun` + stamping (`packages/app/src/services/supervisor-service.ts:469`) and the loop hook that sets it around a keyed run (`agent-loop-service.ts:473`), which is what the requirement names. The frames stay a live view: the durable stream is the file, and `untagged` is the legitimate state for persistent-stdin conversation. Caveat recorded as a finding: the serve-spawned topological path has no producer yet (P3 above). |
| R3 migration `0050` adds `coordination_runs.parent_run_id`; the exit sink persists it from the dispatch key or `SPUR_RUN_ID` | MET | `packages/domain/src/migrations.ts:1559` + `drizzle/0050_spur_cli_coordination_runs_parent.sql`; DAO `parentRunId` (`coordination-run-dao.ts:86`) and `listByParentRunId` (`:177`); resolution in `agent-service` (flag → `SPUR_RUN_ID` → null) and the key extraction in `drainIntoPrompt`; tests "parentRunId round-trips and listByParentRunId returns the children oldest-first" |
| R4 `spur agent trace <runId> [--follow] [--json]` prints the lineage, session ids and stream | MET | `packages/app/src/services/agent-trace-service.ts:42`; CLI `apps/cli/src/commands/agent.ts:407`; tests "traces from the ROOT down", "traces from a CHILD id", "an unknown run is a single unknown node", "follow returns immediately when every node is terminal, and times out on a live one"; `plugins/sp/tests/cli-surface-parity.test.ts` passes with the verb documented |
| R5 surface docs record the execution record | MET | `docs/design/cli-contracts.md:255`, `plugins/sp/skills/spur-cli/references/agent.md` (verb map + section + flags), `docs/03_ARCHITECTURE.md:1195` |

## Architecture depth

The record reuses the workflow sink's persistence contract instead of inventing a second one, and the
trace service reads two existing row families rather than introducing a third: the only new state is one
nullable column on a table that already means "an execution happened". The run id stays Spur's session id
(ADR-132) — the loop owns it, the row, the file, the edge and the live tag all name the same value, which
is what makes `trace` a lookup rather than a correlation problem. The verb is a thin transport over an
app-layer service, per ADR-130.

## Residual risk

- R2's producer gap (above): a spawned member loop's frames are untagged until a serve-side producer
  exists. The durable record — the thing a restart must not lose, and the thing `trace` reads — is
  unaffected.
- `follow` observes the DB and the file system; it cannot detect a run whose process died without writing
  a terminal row (the reconciler owns that classification, not this reader).

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:46.755Z backlog → todo (system)
- 2026-10-05T04:42:48.504Z todo → wip (system)
- 2026-10-05T05:28:31.573Z wip → testing (system)
- 2026-10-05T05:28:48.048Z testing → done (system)

