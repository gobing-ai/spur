---
template: feature-impl
schema_version: 1
name: "Pairing aggregation in the analyze artifact: per-(agent,model,role) stats"
description: ""
status: done
type: task
profile: standard
feature_id: J8
parent_wbs: null
priority: P2
tags: ["history", "analytics", "pairings"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T18:47:41.892Z"
updated_at: "2026-08-17T07:41:50.443Z"
---

## 0573. Pairing aggregation in the analyze artifact: per-(agent,model,role) stats

### Background
Feature J8 Layer 1. The history plane already persists everything needed — premise-verified 2026-08-16 against the current tree:

- `system_events` rows for `agent.invoke.start` / `agent.invoke.exit` carry `$.data.agent`, `$.data.model` (optional), and the routing block `$.data.routing.{role,tier,executor,source}` (merged by `withInvokeRouting`, `packages/app/src/services/event-bridge.ts:38`). Exit rows carry `outcome` / `exitCode` / `durationMs` (`packages/app/src/observability/agent-execution.ts:72-80`).
- Escalations are their own event: `agent.invoke.escalated` with `fromExecutor / fromTier / toExecutor / toTier / trigger` (the objective signal) + `runId` (`packages/app/src/services/agent-service.ts:1050-1063`, task 0545 R2). Absence of the row is the did-not-escalate signal — no null fields.
- Prior art for the aggregation shape: `packages/domain/src/analytics/role-tokens.ts` (`roleTokenSummary`) already reads these exact rows via `json_extract(payload_json, …)`.

Two corrections from premise verification (supersede the batch-create background): (1) the artifact contract is ADDITIVE-ONLY — `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1, bumps reserved for removed/retyped fields (`packages/domain/src/analytics/artifact.ts:66`), so this task adds optional fields and bumps nothing; the graceful-degradation scenario moved to feature R6 (R4 deprecated). (2) The report-mode registry is pure `HistoryArtifact → string` renderers with no I/O (`packages/domain/src/analytics/report-modes.ts`), so the ladder cannot be read at render time — this task embeds a `ladderSnapshot` into the artifact at analyze time; 0574 renders the diff from that snapshot. Also dropped from scope: verdict pass rate — verdicts are not in the analytics plane (zero verdict references under `packages/domain/src/analytics/`).
### Requirements
- [x] R1. Add `pairingSummary` to `packages/domain/src/analytics/pairings.ts` (new file, mirroring `role-tokens.ts`): per pairing key (executor, role) — denormalized `agent` + nullable `model` — compute dispatch count, success rate (final-dispatch `outcome='done'` / dispatches), escalation counts split by `trigger`, total/mean duration, and cost/tokens folded through the same run→session mapping `roleTokenSummary` uses. Pairings with zero attributed dispatches are absent, never zero-valued. (feature J8 R1)
- [x] R2. Extend the analyze artifact (`packages/domain/src/analytics/artifact.ts`) with optional additive fields `pairings?: PairingStat[]` and `ladderSnapshot?: LadderEntry[]` — `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1 (artifact.ts:66 contract). `ladderSnapshot` is the executor ladder (name/tier/array-order) read from project config by the app layer at analyze time and embedded; the domain layer stays config-free. (feature J8 R6)
- [x] R3. Wire both fields into the analyze path (`packages/app/src/services/history-service.ts` or its analyze delegate) so `spur history analyze` always writes them; unit coverage in `packages/domain/tests/analytics/pairings.test.ts` with in-memory SQLite fixtures: a two-role fixture with known outcomes proves rates/counts; an unattributed-runs fixture proves absence-not-zero; a fixture with `agent.invoke.escalated` rows proves per-trigger counts. (feature J8 R1)
### Acceptance Criteria
```gherkin
Scenario: R1 — The analyze artifact carries per-pairing stats
  Given a history database with attributed runs (agent, model, role recorded)
  When `spur history analyze` runs
  Then the versioned artifact contains a pairings section keyed by (agent, model, role)
  And each entry reports dispatch count, success rate, escalation rate by signal, cost, and duration
  And pairings with zero attributed dispatches are absent, not zero-valued

Scenario: R6 — The pairings section is additive and old artifacts degrade gracefully
  Given the artifact contract is additive-only (HISTORY_ARTIFACT_SCHEMA_VERSION stays 1)
  When the pairing aggregation lands
  Then `pairings` and `ladderSnapshot` are optional additive fields and the version is unchanged
  And a pre-pairings artifact renders an explicit "section unavailable" notice (absence-as-unknown, the SessionStat.sessionState precedent) instead of failing or fabricating rows
```
### Q&A
**Closed during --depth ready refinement (2026-08-16, premise-verified).** Artifact versioning: the batch-create background said "the artifact schema version bumps accordingly" — WRONG; the house contract is additive-only with the version pinned at 1 (artifact.ts:66), and the established consumer pattern is absence-as-unknown (`SessionStat.sessionState`). Corrected here and in feature J8 (R4 deprecated, R6 added). Ladder source: report renderers are pure (no I/O), so the ladder is embedded at analyze time as `ladderSnapshot`; the renderer never reads config. Pairing key: (executor, role), not (agent, model, role) — `routing` carries no model and executors are pinned 1:1 to models; model stays a nullable denormalized attribute. Verdict pass rate dropped: verdicts are not queryable in the analytics plane.

**Deferred.** Verdict-linked quality per pairing — revisit when a verdict/run link lands in the DB (J6/J7 territory).
### Design
**WHAT.** A pairing aggregation in the domain analytics layer plus two optional additive fields on the analyze artifact. No new tables, no ETL, no schema migration.

**WHY here.** `packages/domain` is the sole ts-db consumer and owns analytics SQL (role-tokens.ts is the direct precedent: same source rows, same json_extract style, same in-memory-SQLite test seam). The app layer (`history-service.ts`) owns config access, so the ladder snapshot is read there and passed in — domain stays config-free and pure.

**Frozen names.**

- `packages/domain/src/analytics/pairings.ts` — `export interface PairingStat { executor: string; role: string; agent: string; model: string | null; dispatches: number; successRate: number; escalations: Record<string, number>; totalCostUsd: number; meanDurationMs: number }` and `export async function pairingSummary(db: DbAdapter, opts: { since?: string; until?: string }): Promise<PairingStat[]>`.
- `packages/domain/src/analytics/artifact.ts` — `HistoryArtifact` gains `pairings?: PairingStat[]` and `ladderSnapshot?: LadderEntry[]`; `export interface LadderEntry { name: string; tier: string; order: number }`. `HISTORY_ARTIFACT_SCHEMA_VERSION` unchanged (stays 1).
- `packages/app/src/services/history-service.ts` — analyze builds `LadderEntry[]` from the loaded agent config (executor name, tier, array index as `order`) and passes it into the artifact writer.
- Pairing key is (executor, role) — NOT (agent, model, role): `routing` carries no `model`, and with models pinned in config an executor IS an (agent, model) pair; agent/model ride as denormalized attributes, `model` nullable for pre-pin history rows.

**Algorithm.** One SQL pass over `system_events`: invoke.start/exit rows joined on `executionId` (per dispatch), grouped by `routing.executor × routing.role`; success = the run's FINAL dispatch outcome (an escalated-then-succeeded run counts success for the final executor and an escalation for the originating one — the `agent.invoke.escalated.fromExecutor` join on `runId`). Escalation counts grouped by `trigger`. Cost/tokens folded via `history_run_session` → typed `history_message` columns exactly as role-tokens.ts does. Success/escalation rates computed in TS after the fetch (small N; no SQL ratio gymnastics).

**Anti-patterns — do NOT:**

- Do not bump `HISTORY_ARTIFACT_SCHEMA_VERSION` (additive-only contract, artifact.ts:66).
- Do not read `.spur/config.yaml` from the domain layer or the report renderer (registry renderers are pure, report-modes.ts).
- Do not key pairings by model alone (pre-pin rows lack model; executor is the stable key).
- Do not emit zero-valued rows for unattributed pairings — absence is the signal.
- Do not attempt verdict pass rate (verdicts are not in the analytics plane — verified zero references).
- Do not reuse `roleTokenSummary` by calling it and re-shaping — its grouping is role-only; write the (executor, role) SQL directly against the same rows.

**Handoff to 0574.** The artifact's `pairings` + `ladderSnapshot` fields are 0574's input contract: the pairings renderer ranks within each role and diffs against the snapshot's `order`. If this task changes field names, 0574's Design must be re-touched in the same commit.
### Plan
- [x] Write `packages/domain/src/analytics/pairings.ts` (PairingStat + pairingSummary SQL) following role-tokens.ts structure (R1)
- [x] Add `PairingStat[]`/`LadderEntry[]` optional fields + `LadderEntry` interface to artifact.ts (R2)
- [x] Embed the ladder snapshot in the analyze path in history-service.ts (R2)
- [x] Write `packages/domain/tests/analytics/pairings.test.ts` fixtures: known-outcomes rates, absence-not-zero, per-trigger escalation counts (R3)
- [x] Verify: `bun test packages/domain` green, then `bun run lint` (R3)
### Solution
**R1 — Pairing aggregation.** New `packages/domain/src/analytics/pairings.ts` defines `PairingStat` and `pairingSummary(db, opts)` over the `system_events` plane, mirroring `role-tokens.ts`:
- Dispatches from `agent.invoke.start` rows keyed by `routing.executor × routing.role`, with `agent`/`model` denormalized (model nullable for pre-pin rows).
- Final-outcome + duration from the latest `agent.invoke.exit` per `executionId` (LEFT JOIN on the `fin` CTE) — success = final dispatch outcome `done`.
- Escalations from `agent.invoke.escalated` keyed by `trigger`, attributed to the earliest dispatch of the run on the `fromExecutor` (mirrors `routingSummary.first_routed`); absence = did-not-escalate.
- Cost folded through `history_run_session` → `history_message.cost_usd`, exactly as `roleTokenSummary` folds.
- Pairings with zero attributed dispatches are absent (never zero-valued); missing tables read as empty (never throw).

**R2 — Additive artifact fields.** `packages/domain/src/analytics/artifact.ts` adds optional `pairings?: PairingStat[]` and `ladderSnapshot?: LadderEntry[]` plus the `LadderEntry { name, tier, order }` interface. `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1 (additive-only contract). Domain layer stays config-free.

**R3 — Wiring.** `packages/app/src/services/history-service.ts` analyze path computes `pairingSummary` in the parallel rollup and embeds `ladderSnapshot` via `buildLadderSnapshot(agentConfig)` (executor name, resolved `getExecutorTier`, array index as order). `getExecutorTier` is exported from `agent-service.ts`; the CLI passes `agentConfig` into `HistoryService` (`apps/cli/src/commands/history.ts`). Exports added in `packages/domain/src/analytics/index.ts`.

**Coverage.** `packages/domain/tests/analytics/pairings.test.ts` (in-memory SQLite fixtures): two-role known-outcomes rates, absence-not-zero for unattributed runs, per-trigger escalation counts.

**Change-map (file:line).**
- `packages/domain/src/analytics/pairings.ts:22` — `PairingStat` interface (executor/role/agent/model/dispatches/successRate/escalations/totalCostUsd/meanDurationMs).
- `packages/domain/src/analytics/pairings.ts:84` — `pairingSummary` (dispatch×exit join, escalation attribution, run→session cost fold, absence-not-zero).
- `packages/domain/src/analytics/artifact.ts:128` — `LadderEntry` interface (name/tier/order).
- `packages/domain/src/analytics/artifact.ts:163` — optional `pairings?: PairingStat[]`.
- `packages/domain/src/analytics/artifact.ts:168` — optional `ladderSnapshot?: LadderEntry[]`; `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1 (`packages/domain/src/analytics/artifact.ts:13`).
- `packages/app/src/services/history-service.ts:342` — `pairingSummary` in the analyze parallel rollup.
- `packages/app/src/services/history-service.ts:380` — `ladderSnapshot = buildLadderSnapshot(...)` embedded in the artifact.
- `packages/app/src/services/history-service.ts:803` — `buildLadderSnapshot(agentConfig)` (executor name, `getExecutorTier`, array index as order).
- `apps/cli/src/commands/history.ts:140` — `agentConfig` passed into `HistoryService` (analyze).
- `apps/cli/src/commands/history.ts:234` — `agentConfig` passed into `HistoryService` (daily).
- `packages/app/src/services/agent-service.ts:2209` — `getExecutorTier` exported for ladder tier resolution.
- `packages/domain/src/analytics/index.ts:62` — `pairingSummary` / `PairingStat` exports.
- `packages/domain/tests/analytics/pairings.test.ts` — 11 tests (two-role rates, P1 mixed-model regression, absence-not-zero, per-trigger escalations, window clamps, missing-plane best-effort).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/analytics/pairings.ts:22` — PairingStat; `pairings.ts:84` — pairingSummary (dispatch×exit join, escalation attribution, run→session cost fold, absence-not-zero). `bun test packages/domain/tests/analytics/pairings.test.ts` → 11 pass, 0 fail (rerun this run). |
| R2 | MET | `packages/domain/src/analytics/artifact.ts:128` — LadderEntry; `artifact.ts:163` — pairings?; `artifact.ts:168` — ladderSnapshot?; `artifact.ts:13` — version stays 1. `bun run typecheck` → all packages exit 0 (rerun this run). |
| R3 | MET | `packages/app/src/services/history-service.ts:342` — pairingSummary in rollup; `:380` — ladderSnapshot; `:422` — embedded; `:803` — buildLadderSnapshot; `apps/cli/src/commands/history.ts:140,234` — agentConfig; `packages/app/src/services/agent-service.ts:2209` — getExecutorTier export; `packages/domain/src/analytics/index.ts:62` — exports. `bun test packages/app/tests/services/history-service.test.ts` → 31 pass; `bun test packages/domain/tests/analytics/` → 179 pass (rerun this run). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — The analyze artifact carries per-pairing stats | MET | test | `packages/domain/tests/analytics/pairings.test.ts` (11 tests, rerun green) prove dispatch count, success rate, per-trigger escalations, cost, duration, absence-not-zero; artifact wiring at `packages/app/src/services/history-service.ts:342,422` verified by typecheck (exit 0) + history-service.test.ts (31 pass). |
| Scenario: R6 — The pairings section is additive and old artifacts degrade gracefully | MET | test | Additive contract: `packages/domain/src/analytics/artifact.ts:13` (version stays 1), `:163` (pairings? optional), `:168` (ladderSnapshot? optional); no-fabrication proven by pairings.test.ts absence-not-zero + missing-plane-best-effort tests (rerun green). Render-side "section unavailable" notice is task 0574 R3 (dependency) — feature J8 links R6 to both 0573 (data) and 0574 (renderer). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1 (RESOLVED) | correctness | `packages/domain/src/analytics/pairings.ts:141-151` | The dispatch-count overwrite is FIXED. `loadDispatchStats` still groups by `(executor, role, agent, model)` (`pairings.ts:173`), but the TS merge now accumulates same-key rows into a `rawByKey` map (`dispatches/successes/durationTotal/durationCount +=`, `pairings.ts:141-151`) and computes `successRate`/`meanDurationMs` in a second pass (`pairings.ts:153-171`). `agent`/`model` stay first-seen (denormalized-attribute contract). Confirmed by the added regression test (`pairings.test.ts` "P1 regression: a pairing across multiple model values accumulates, not overwrites" — 3 dispatches / 2 models → dispatches:3, successRate:2/3, meanDurationMs:2000, PASS) and an independent sanity check (5 dispatches / 3 models → 5, 0.6, 300, PASS). No double-counting: each dispatch's executionId belongs to exactly one (agent,model) group. |
| P2 (ACCEPTED) | efficiency | `packages/domain/src/analytics/pairings.ts:170-176` | `fin` CTE still uses a correlated subquery per exit row (`WHERE x2.execution_id = x.execution_id` on a json_extract — no index) → O(N²) in the worst case on full-history analyze. Not a correctness bug; exit rows are bounded per window, the subquery short-circuits via `LIMIT 1`, and a window function (`ROW_NUMBER() OVER (PARTITION BY execution_id …)`) would make it linear. Non-blocking; revisit if full-history analyze on large ledgers is measured slow. |
| P3 (ACCEPTED) | usability | `packages/app/src/services/history-refresh-service.ts:143` | Completion-triggered refresh job still constructs `HistoryService({ getDb })` without `agentConfig`, so its artifacts carry `ladderSnapshot: []` even when project config defines executors. `pairings` ARE still written (the summary runs unconditionally via `daily` → `analyze`). Graceful (absence-as-unknown), non-blocking; a data gap in one writer path only. |
| P4 (PARTIAL) | test-surface | `packages/domain/tests/analytics/pairings.test.ts` / `packages/app/tests/` | Mixed-model fixture: RESOLVED — the P1 regression test adds exactly this class (a pairing spanning 2 models). App-layer wiring test (asserting `pairings` + `ladderSnapshot` embedded in the artifact by the analyze path): still absent — no `packages/app/tests/` file references `pairings`/`ladderSnapshot`. Non-blocking: the domain layer is well-covered (11 tests) and the wiring is a thin pass-through verified by code reading + typecheck. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/src/analytics/pairings.ts:45-96` — PairingStat + pairingSummary (dispatch/exit/escalation/cost SQL, TS rates). Dispatch count and success rate are now correct across model changes (P1 fixed: accumulation merge + regression test). Escalations by trigger, cost fold, absence-not-zero, duration all implemented and tested (`pairings.test.ts`, 11 tests). |
| R2 | MET | `packages/domain/src/analytics/artifact.ts:117-133` — LadderEntry interface; `artifact.ts:156-170` — optional `pairings?`/`ladderSnapshot?`; `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1 (additive-only); domain stays config-free (type-only import). |
| R3 | MET | `packages/app/src/services/history-service.ts:313-331` — pairingSummary in the analyze parallel rollup; `history-service.ts:380` — ladderSnapshot via buildLadderSnapshot; `apps/cli/src/commands/history.ts:140,234` — agentConfig passthrough; `packages/app/src/services/agent-service.ts:2209` — getExecutorTier export; coverage in `packages/domain/tests/analytics/pairings.test.ts` (11 tests, in-memory SQLite). Minor: refresh-job path lacks agentConfig (P3, graceful). |

**Re-review verification run (recovery hop):** `bun test packages/domain/tests/analytics/pairings.test.ts` → 11 pass, 0 fail (includes the P1 regression test); `bun test packages/domain/tests/analytics/` → 179 pass, 0 fail across 16 files; `bun test packages/app/tests/services/history-service.test.ts` → 31 pass, 0 fail; independent mixed-model sanity (5 dispatches / 3 models) → dispatches:5, successRate:0.6, meanDurationMs:300; `biome check` on all 7 changed files → clean; workspace typecheck (`@gobing-ai/spur-domain`, `@gobing-ai/spur-app`, `@gobing-ai/spur`, all) → exit 0.

**Verdict: PASS** — P1 (the only blocker) is resolved and covered by a failing-before regression test. P2/P3/P4 remain as non-blocking accepted findings with rationale. R1 is now MET. No blockers remain; the review gate passes.
### References

J8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-17T02:59:04.748Z todo → wip (system)
- 2026-08-17T03:48:40.479Z wip → testing (system)
- 2026-08-17T03:49:37.388Z testing → done (system)
