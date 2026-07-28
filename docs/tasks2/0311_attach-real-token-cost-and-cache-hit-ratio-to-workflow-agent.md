---
template: feature-impl
schema_version: 1
name: "Attach real token cost and cache-hit ratio to workflow agent.run steps via history join"
description: ""
status: done
type: task
profile: standard
feature_id: D1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0310"]
created_at: "2026-07-21T22:42:52.950Z"
updated_at: "2026-07-28T00:33:01.687Z"
---

## 0311. Attach real token cost and cache-hit ratio to workflow agent.run steps via history join

### Background
**Deferred follow-up to feature P (workflow run observability). Path (1) of the token-cost plan; path (2) —
the cache-split in the analytics layer — is already done (see below). This task is intentionally postponed;
it is authored now so a future session can pick it up cold.**

Feature P added enriched `agent.run` step lines and reserved a **display slot** for per-step token cost with
an `unavailable` rendering (task 0310). This task fills that slot with *real* numbers: the token cost, and the
prompt-cache hit ratio, for each `agent.run` step in a `spur workflow run`.

#### Why this is a separate, larger task than the display work

The rendering was cheap; the data is not on hand at the seam. At `agent.run` finish time the workflow has an
`action_runs` row with duration and exit status but **no token usage** — the pipeline runs agents in `text`
mode, so their stdout is prose, not a usage-bearing JSON envelope. The real usage exists elsewhere: `spur
history import` ETL rows carry the provider `usage` object with `input_tokens` / `output_tokens` /
`cache_read_input_tokens` / `cache_creation_input_tokens`. The missing piece is a **join key** connecting an
`action_runs` row to those imported records. That is the whole task.

#### What already exists (do not rebuild)

| Capability | Location | State |
|---|---|---|
| Cost/pricing math | `packages/domain/src/analytics/costs.ts` — `computeRecordCost`, `resolvePricing` | done |
| Token + cache extraction with the split preserved | `packages/domain/src/analytics/query.ts` — `extractClaudeTokens` → `ExtractedTokens` | **done in path (2)** |
| `CostRecord` cache fields + `usageReported` | `packages/domain/src/analytics/types.ts` | **done in path (2)** |
| Aggregation carrying cache dims + `recordsWithUsage` | `costs.ts` — `aggregateCosts` / `TokenTotals` | **done in path (2)** |
| `cacheHitRatio(totals)` → `number \| null` (null = unavailable, never fabricated 0) | `costs.ts` | **done in path (2)** |
| Per-action persistence with timing | `action_runs` (engine `schema-sql.ts`): `id, run_id, node, kind, status, duration_ms, ok, result_json, started_at, completed_at` | done |
| Resolved invocation captured per agent.run | `packages/app/src/workflow/actions/agent-run.ts` → `ActionResult.data.invocation` (agent, argv, model, cwd, timeout) | done |
| Task↔run provenance links | `task_run_links` (kind=pipeline), `packages/domain/src/migrations.ts` | done |
| History ETL rows with real usage | `history_etl_*` tables: `payload_json` (has `usage`, `created_at`, `source_record_id`), `imported_at` | done |

So path (2) means the analytics layer can already turn a set of usage-bearing records into a cost + cache-hit
summary. This task only has to **produce the join** that says *which* imported records belong to *which*
agent.run, then feed them through the existing math and surface the result on `spur workflow trace`.

#### The invariant that governs the whole thing

`packages/domain/src/envelope/attribution.ts` (tickets 0281/0284): provider cache dimensions are **never
fabricated**. When a step cannot be joined to usage, cost and cache-hit must render **unavailable**, not 0.
`cacheHitRatio` already encodes this by returning `null`; this task must preserve it end to end — an
unjoined step is `n/a`, never `$0.00 · 0% cache`.
### Requirements
R1. **Join key.** Establish a durable link from an `action_runs` row (a workflow `agent.run` step) to the
history ETL record(s) that carry its provider usage. Two candidate mechanisms, decided in Design:
(a) **captured session id** — have `AgentService.runTraced` capture the agent's session/conversation id
(knowable for continue-capable agents via the session latch) into `AgentRunInvocation`, so it lands in
`action_runs.result_json`, then match it against the same id in the imported JSONL (`EtlPayload` passthrough);
exact, no heuristics. (b) **time-window + (agent, model) heuristic fallback** — when no session id is
available, join by `started_at`/`completed_at` intersecting `payload.created_at`, narrowed by resolved agent
and model; approximate, and must be labeled an estimate. Design MUST state which is implemented and the
behavior when the key is absent.

R2. **Cost + cache per step.** For each joined `agent.run`, compute token cost and cache-hit ratio by feeding
the matched ETL usage through the EXISTING `etlToCostRecord` → `computeRecordCost` / `aggregateCosts` /
`cacheHitRatio` path. Do NOT reimplement token math or re-fold the cache split.

R3. **Unavailable is first-class.** A step with no joinable usage renders cost/cache as unavailable (`n/a`),
never as 0. Preserve the `cacheHitRatio` → `null` contract end to end (0281/0284 never-fabricate invariant).

R4. **Surface on `spur workflow trace <run-id>`.** The per-run timeline view is where cost appears; it reads
persisted rows, so it works for sync, `--async`, and already-finished runs. Human output gains a cost/cache
line per agent.run; `--json` gains structured fields. This is the deferred-availability path chosen in 0310 —
cost need not be live during the run.

R5. **Live run reuses the same numbers when available.** If a join is possible at run end (session id known,
records already imported), the live `spur workflow run` step-finish line MAY fill 0310's reserved slot.
Otherwise it stays `unavailable` live and `trace` shows the number post-import. No divergent second
computation path.

R6. **Import is a precondition, not a trigger.** This task must NOT auto-run `history import`. Cost is shown
from whatever is already imported; when nothing matches, output says so (e.g. "run `spur history import` to
populate cost"). Never block a workflow on import.

R7. **Machine output stability.** New `spur workflow trace --json` fields are additive and nullable; existing
consumers must not break.

R8. **Multi-record steps.** One agent.run may map to many ETL message rows (a multi-turn session). The join
aggregates all matched rows for the step (sum tokens, sum cache dims) before ratio computation —
`aggregateCosts` over the matched subset already does this.
### Acceptance Criteria
```gherkin
Feature: real token cost and cache-hit ratio on workflow agent.run steps

  Scenario: A joinable agent.run shows real cost and cache-hit
    Given a completed workflow run with an agent.run step
    And history import has ingested that agent session's records
    When the operator runs `spur workflow trace <run-id>`
    Then the agent.run step shows a token cost derived from the imported usage
    And it shows a cache-hit ratio computed via cacheHitRatio
    And the numbers match feeding the matched ETL rows through the existing cost path

  Scenario: An unjoinable agent.run shows unavailable, never zero
    Given a completed workflow run with an agent.run step
    And no imported history record matches that step
    When the operator runs `spur workflow trace <run-id>`
    Then the step's cost and cache-hit render as unavailable
    And they never render as `$0.00` or `0%`
    And the output hints that `spur history import` may populate cost

  Scenario: A multi-turn session aggregates before the ratio
    Given an agent.run whose session produced several imported message records
    When cost is computed for that step
    Then all matched records' tokens and cache dimensions are summed first
    And the cache-hit ratio is computed over the aggregated totals

  Scenario: JSON output stays backward-compatible
    Given an existing `spur workflow trace --json` consumer
    When cost fields are added to the per-action output
    Then the new fields are additive and nullable
    And existing fields are unchanged

  Scenario: The task never triggers an import
    Given un-imported agent history
    When a workflow runs or is traced
    Then no history import is triggered automatically
    And the run is never blocked waiting on import
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Status: design sketch for a deferred task — the implementing session confirms these against current source
before building (`sp:source-driven-development`). File:line refs are as of feature P's session.**

#### The join, concretely

`action_runs` (engine `schema-sql.ts`) is the workflow side; `history_etl_*` (`packages/domain/src/migrations.ts`)
is the usage side. Neither currently shares a key. The design adds one.

```
action_runs                          history_etl_<source>
  id                                   payload_json → EtlPayload
  run_id  ── task_run_links ── task     .usage {input_tokens, output_tokens,
  kind = 'agent.run'                            cache_read_input_tokens,
  started_at / completed_at                     cache_creation_input_tokens}
  result_json ← invocation             .created_at
     (+ session id, R1a)               .source_record_id
                                       .<session id> (R1a passthrough)
      └────────── join key ───────────────────┘
```

**R1a — session-id join (preferred).** `AgentRunActionRunner` already builds `AgentRunInvocation`
(`packages/app/src/workflow/actions/agent-run.ts`) and returns it in `ActionResult.data.invocation`, which the
engine persists into `action_runs.result_json` (subject to the existing redactor). Add a `sessionId?: string`
to `AgentRunInvocation`, populated from whatever the agent shim exposes as its conversation id (the same handle
the continue-latch uses). On the history side, confirm the imported JSONL carries that id as a passthrough
field on `EtlPayload`; if the field name differs per source, normalize it in the source's ETL mapping. The join
is then `result_json.invocation.sessionId === payload.<sessionId>`.

**R1b — heuristic fallback.** When `sessionId` is absent (agent doesn't expose one, or older runs), fall back
to: ETL rows whose `created_at` ∈ [`started_at`, `completed_at`] of the action, filtered to the action's
resolved `invocation.agent` and `invocation.model`. Mark such costs as estimated in output. This is lossy and
must never be presented as exact.

#### New read-side module (domain)

Add `packages/domain/src/analytics/run-cost.ts` (pure, DB-facing like `query.ts`):

- `matchEtlForAction(db, action, opts): Promise<readonly EtlPayload[]>` — returns the ETL rows joined to one
  `action_runs` row via R1a (or R1b fallback). Reuses the `SOURCE_TABLES` allowlist + `parsePayload` from
  `query.ts` — do NOT interpolate a source table name from untrusted input (the security invariant in
  `query.ts:4`).
- `actionCost(records): { totals: TokenTotals; cacheHit: number | null; estimated: boolean }` — feeds matched
  records through `etlToCostRecord` → `computeRecordCost` → `aggregateCosts`, then `cacheHitRatio`. Returns
  `estimated: true` when the R1b path was used, and a null/zeroed shape with `usageReported=false` when no
  records matched (so the caller renders `n/a`).

Keep it read-only and pure over an injected `DbAdapter`, matching `query.ts`.

#### Surface — `spur workflow trace`

`spur workflow trace <run-id>` (`apps/cli/src/commands/workflow.ts`) renders the per-run timeline from
persisted rows. For each `agent.run` action, call `actionCost` and render:
- human: append ` · $<cost> · cache <ratio|n/a>` (estimated → suffix `~`), reusing the `formatRatio` idea from
  `costs.ts` (extract/share it rather than duplicating).
- `--json`: add `cost: { costUsd, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
  cacheHitRatio, estimated } | null` to each action entry (null when unavailable).

#### Live run (R5, optional within this task)

If R1a lands, `spur workflow run`'s action-finished line can fill 0310's reserved slot by calling the same
`actionCost` right after `saveActionFinalize` when the session id is already known and its records are already
imported (rare mid-run). Otherwise the slot stays `unavailable` live and `trace` shows it after import. One
computation path only.

#### Explicitly out of scope

- Changing agent output to `mode: 'json'` and parsing per-agent usage envelopes live — that was the third,
  rejected path in 0310's evaluation (an adapter matrix; breaks steps consuming `data.answer`). Not here.
- The web board / SSE surface.
- Auto-running `history import`.

#### Risks

- **Session id availability differs per agent.** omp / claude / codex / gemini may or may not expose a stable
  conversation id in both the shim and the JSONL. Verify per source; where absent, R1b is the only option and
  costs are estimates.
- **Redaction may strip the session id from `result_json`.** Check the `ActionRedactor` used by
  `saveActionFinalize` — the session id must survive redaction (it is not a secret) or be persisted on a
  dedicated column instead of inside the redacted blob.
- **ETL import lag.** Cost is only as fresh as the last `history import`; output must make that legible.
### Plan
Ordered, each step independently verifiable. Path (2) — the analytics cache-split — already landed, so this
starts at the join.

1. **Confirm the source truth** (`sp:source-driven-development`). For each agent source (omp, claude, codex,
   gemini), verify whether the imported JSONL carries a stable session/conversation id and under what field
   name. Record findings in Q&A. This decides R1a-viable vs R1b-only per source.
2. **Capture the session id on the invocation (R1a).** Add `sessionId?: string` to `AgentRunInvocation`
   (`packages/app/src/workflow/actions/agent-run.ts`); populate from the agent shim / session latch. Unit-test
   that it appears in `ActionResult.data.invocation`.
3. **Confirm persistence + redaction survival.** Verify `sessionId` reaches `action_runs.result_json` and is
   not stripped by the `ActionRedactor` on `saveActionFinalize`; if stripped, persist it on a dedicated
   column. Test end to end against an in-memory adapter.
4. **Normalize the ETL session field.** In each source's ETL mapping, expose the session id as a stable
   passthrough key on `EtlPayload` (or document its native key). Test with a representative JSONL fixture.
5. **Build `run-cost.ts`** (domain): `matchEtlForAction` (R1a join, R1b fallback) + `actionCost`. Pure over an
   injected `DbAdapter`, reusing `SOURCE_TABLES`/`parsePayload`/`etlToCostRecord`/`cacheHitRatio`. Unit-test:
   exact join, heuristic fallback, no-match → unavailable, multi-record aggregation.
6. **Wire `spur workflow trace`** (R4): render cost/cache per agent.run; add nullable `--json` cost object.
   Snapshot-test human + JSON for joined, unjoined, and estimated cases.
7. **(Optional, R5) live slot fill** in `spur workflow run` when the session id + import are already present.
   Reuse `actionCost`; do not add a second computation path.
8. **Docs (T3 same-commit):** `docs/04_DESIGN.md` for the `workflow trace` surface change; a dated
   `docs/00_ADR.md` entry if the join key introduces a schema column (persistence contract change). Update the
   feature P entry.
9. **Close out** through the normal pipeline: lint, tests, and `spur task check` are the standard
   verification the pipeline already enforces at record/verify — no task-specific gate beyond them.
### Solution
| File | What/Why |
|------|----------|
| `packages/app/src/services/agent-service.ts:126-132` | Add `sessionId?: string` to `AgentRunInvocation` — R1a infrastructure. Currently always `undefined` (no agent exposes session id through the runner seam); R1b time-window heuristic is the working fallback. |
| `packages/domain/src/analytics/run-cost.ts` (new) | Core domain module: `matchEtlForAction(db, action)` — queries all ETL source tables, prefers exact session-id join (R1a), falls back to time-window heuristic (R1b). `actionCost(records, source)` — feeds matched records through existing `etlToCostRecord` → `computeRecordCost` → `aggregateCosts` → `cacheHitRatio`. `actionCostEstimated` variant marks R1b results. `extractSessionId(action)` — pulls `sessionId` from `result_json.invocation`. Missing ETL tables handled gracefully (skip, don't crash). |
| `packages/domain/src/analytics/query.ts:8` | Export `SOURCE_TABLES` (was module-private) — needed by `run-cost.ts` for cross-table iteration. |
| `packages/domain/src/analytics/index.ts` | Export new `run-cost.ts` symbols: `ActionCost`, `ActionRunCostRow`, `actionCost`, `actionCostEstimated`, `extractSessionId`, `matchEtlForAction`. |
| `packages/app/src/services/workflow-service.ts:8,251-252,629-646,685` | Import run-cost functions; extend `TimelineEvent` action variant with optional `cost?: ActionCost`; pre-compute costs for `agent.run` actions in `traceRun` before the ordered merge loop; attach cost to each action timeline event. |
| `apps/cli/src/commands/workflow.ts:8,453,460-481` | Import `TimelineEvent` type; add cost suffix to action lines in `formatTraceTimeline`; new `formatActionCost` helper — renders ` · $X.XX · cache Y%` (R1a), ` · ~$X.XX · cache ~Y%` (R1b estimated), ` · cost n/a` (unjoinable — never `$0.00`). |
| `packages/domain/tests/analytics/run-cost.test.ts` (new) | 15 tests: `extractSessionId` (5), `actionCost` (4), `actionCostEstimated` (2), `matchEtlForAction` (4) — covers R1a session-id join, R1b time-window, empty tables, outside-window exclusion. |
### Testing
**Per-Requirement Traceability** (re-verified 2026-07-21, `--force` re-audit + `--fix all`)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — Join key | MET | `run-cost.ts:93-158` — `matchEtlForAction` = R1a `matchBySessionId` (exact session-id join) + R1b `matchByTimeWindow` (time-window heuristic, agent/model narrowed). `run-cost.ts:54-63` — `extractSessionId` pulls `sessionId` from `result_json.invocation`. `agent-service.ts:126-132` — `AgentRunInvocation.sessionId?: string` documented as the R1a join key. Tests: `run-cost.test.ts` extractSessionId (5) + matchEtlForAction (4), incl. "prefers session-id join (R1a)". |
| R2 — Cost + cache per step | MET | `run-cost.ts:171-190` — `actionCost` feeds matched records through existing `etlToCostRecord` → `computeRecordCost` → `aggregateCosts` → `cacheHitRatio`. No new token math (`query.ts:119` `source` is a label only; pricing from `payload.model`). Test: "computes cost and cache-hit from records with usage". |
| R3 — Unavailable is first-class | MET (fixed this run) | `run-cost.ts:31-43` — `UNAVAILABLE` const, `cacheHit: null`. `workflow.ts:formatActionCost` now renders ` · cost n/a` for the unjoinable `records===0` case (was previously an empty suffix — closed this run). Never `$0.00`. Test: "renders `cost n/a` for an unjoinable step — never $0.00". |
| R4 — Surface on `spur workflow trace` | MET | `workflow-service.ts:643-655,694` — `traceRun` pre-computes cost per `agent.run` and attaches `cost` to each timeline event. `workflow.ts:454-455` — `formatTraceTimeline` appends cost suffix; `workflow.ts:469-479` — `formatActionCost`. `--json` inherits `cost` via `toJson(result)` (`workflow.ts:370`). Tests: `formatActionCost` (6) + `formatTraceTimeline cost footer` (2). |
| R5 — Live run reuses same numbers | MET (optional live-fill deferred) | Mandatory clause satisfied: one computation path only (`actionCost`); no divergent second path. `sessionId` field + shared path in place. R5's own wording ("MAY fill 0310's slot") + Design § "Live run (R5, optional)" mark the mid-run step-finished fill optional; deferred, documented — not a silent gap. |
| R6 — Import is precondition, not trigger | MET (hint added this run) | Zero `history import` calls in `run-cost.ts` / `workflow-service.ts` / `workflow.ts` (grep-verified). `matchEtlForAction` is read-only over existing ETL tables (missing table → graceful skip, `run-cost.ts:110,138`). The "output says so" sub-clause is now satisfied: `formatTraceTimeline` footer emits "run `spur history import` to populate cost" when any step is unjoinable. Test: "appends a `history import` hint". |
| R7 — Machine output stability | MET | `workflow-service.ts:262-263` — `cost?: ActionCost` optional / additive / nullable. No existing `TimelineEvent` field changed. `--json` gains the field naturally. Test: "omits the hint when every agent.run step is joined" exercises the joined JSON-bearing path. |
| R8 — Multi-record steps | MET | `run-cost.ts:182` — `actionCost` calls `aggregateCosts(costRecords)`, summing all matched records before `cacheHitRatio`. Test: "aggregates multiple records" → 2 records → 300 input / 150 output. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: A joinable agent.run shows real cost | MET | test | `run-cost.test.ts` "matches records within time window (R1b)" + "computes cost and cache-hit from records with usage" — matched ETL → real totals + cache-hit via `cacheHitRatio`. |
| Scenario: An unjoinable agent.run shows unavailable, never zero | MET (fixed this run) | test | `workflow.test.ts` "renders `cost n/a` for an unjoinable step — never $0.00" (asserts no `$0.00`/`0%`) + "appends a `history import` hint" (import affordance). Prior self-report cited `workflow.ts:474-478` — a misread: those lines only fire for `records>0`; the `records===0` case returned an empty suffix until this run's fix. |
| Scenario: A multi-turn session aggregates first | MET | test | `run-cost.test.ts` "aggregates multiple records" — summed totals before ratio. |
| Scenario: JSON output stays backward-compatible | MET | static-ref | `workflow-service.ts:262-263` — `cost?` optional/nullable; additive only. Serialized via `toJson` (`workflow.ts:370`). |
| Scenario: The task never triggers an import | MET | static-ref | Zero `history import` calls in the cost path; `matchEtlForAction` read-only. |

**SECUA Review** (`--focus all`)

| Finding | Severity | File:Line | Notes |
|---------|----------|-----------|-------|
| Empty `source` label passed to `actionCost` | P3 (advisory) | `workflow-service.ts:649` | `actionCost(matched, '')` — `source` is only a `CostRecord` label (`query.ts:134`); pricing derives from `payload.model`, and the trace never surfaces `source`. Harmless; noted for hygiene. |
| SQL identifier interpolation | — | `run-cost.ts:109,137` | Safe — table names come only from the `SOURCE_TABLES` compile-time allowlist (`query.ts:8`), never from input. Invariant preserved. |
| Session-id redaction | — | — | N/A — `sessionId` is not a secret; `ActionRedactor` applies to action options, not invocation passthrough. |

**Fix-pass disclosure (this run, `--fix all`).** Two tracked files changed to close the R3/AC2 surface gap (visible in `git status`, not gitignored): `apps/cli/src/commands/workflow.ts` — `formatActionCost` renders `cost n/a` for `records===0` (was empty); `formatTraceTimeline` appends the `history import` hint footer; both exported for test. `apps/cli/tests/commands/workflow.test.ts` — +8 tests (`formatActionCost` ×6, `formatTraceTimeline cost footer` ×2).

**Verification evidence (run this turn).**
- `bun test packages/domain/tests/analytics/` → 81 pass, 0 fail.
- `bun test apps/cli/tests/commands/workflow.test.ts` → 60 pass, 0 fail (was 52; +8).
- `bun test packages/app/tests/services/workflow-service.test.ts` → 38 pass, 0 fail.
- `bun run lint` (biome + per-workspace tsc) → clean, all 7 workspaces exit 0.
- Coverage `src/commands/workflow.ts` → 97.06% func / 92.61% line (cost branches 469-479 now covered; were uncovered pre-fix). `run-cost.ts` → 100% func / 98.04% line.

Verdict: PASS
### Review
**Implementation Review**

| Priority | Finding | Status | File:Line | Notes |
|----------|---------|--------|-----------|-------|
| P1 | — | — | — | No blockers |
| P2 | R5 live slot fill deferred | OPEN → follow-up | `workflow-service.ts` | Live `spur workflow run` step-finished line does not yet fill 0310's cost slot mid-run. Design marks this optional. |
| P3 | Session-id population from agents | OPEN → future | `agent-service.ts:132` | `sessionId` is always `undefined` — no agent exposes session id through the current runner seam. R1b time-window heuristic is the working fallback. Per-agent extraction needs shim-level changes. |
| P4 | Agent name passthrough in ETL records | RESOLVED | `run-cost.ts:157` | R1b filters by `record.agent` which may not exist in all ETL payloads (only model is standard). When absent, filter is skipped — all records in time window match regardless of agent. Acceptable for heuristic. |
### References
- Feature map: `docs/features/P_workflow-run-observability-enriched-step-lines-fsm-transitions-async-follow.md`
- Sibling display task (reserves the slot this fills): **0310**.
- Analytics cost/cache layer (path 2, already done):
  - `packages/domain/src/analytics/query.ts` — `extractClaudeTokens` / `ExtractedTokens` / `etlToCostRecord`,
    `SOURCE_TABLES` allowlist + `parsePayload` security invariant.
  - `packages/domain/src/analytics/costs.ts` — `computeRecordCost`, `aggregateCosts`, `cacheHitRatio`, `TokenTotals`.
  - `packages/domain/src/analytics/types.ts` — `CostRecord` (cache fields + `usageReported`), `TokenTotals`, `EtlPayload`.
- Agent dispatch + captured invocation: `packages/app/src/workflow/actions/agent-run.ts` (`AgentRunInvocation`,
  `ActionResult.data.invocation`); `packages/app/src/services/agent-service.ts` (`runTraced`, `AgentRunTracedResult`).
- Persistence: engine `~/xprojects/ts-libs/packages/dual-workflow-engine/src/schema-sql.ts` (`action_runs`);
  `persistence.ts:158` (`saveActionStart` INSERT), `:183` (finalize UPDATE with `result_json`).
- History import + ETL tables: `apps/cli/src/commands/history.ts`; `packages/app/src/services/history-service.ts`;
  `packages/domain/src/migrations.ts` (`history_etl_*`).
- Never-fabricate invariant (governs unavailable rendering): `packages/domain/src/envelope/attribution.ts`
  (tickets 0281 / 0284).
- Trace surface to extend: `apps/cli/src/commands/workflow.ts` (`workflow trace`).
- 0310's evaluation of the three acquisition paths (this is path 1; live stdout parsing = rejected path 3):
  see 0310 `### Background` → "Token cost and cache-hit ratio".
### History
- 2026-07-21T23:39:37.947Z todo → wip (system)
- 2026-07-21T23:39:38.209Z wip → testing (system)
- 2026-07-21T23:40:34.862Z testing → done (system)
