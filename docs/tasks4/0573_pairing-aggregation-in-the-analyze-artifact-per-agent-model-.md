---
template: feature-impl
schema_version: 1
name: "Pairing aggregation in the analyze artifact: per-(agent,model,role) stats"
description: ""
status: todo
type: task
profile: standard
feature_id: J8
parent_wbs: null
priority: P2
tags: ["history", "analytics", "pairings"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T18:47:41.892Z"
updated_at: "2026-08-16T18:54:37.195Z"
---

## 0573. Pairing aggregation in the analyze artifact: per-(agent,model,role) stats

### Background
Feature J8 Layer 1. The history plane already persists everything needed — premise-verified 2026-08-16 against the current tree:

- `system_events` rows for `agent.invoke.start` / `agent.invoke.exit` carry `$.data.agent`, `$.data.model` (optional), and the routing block `$.data.routing.{role,tier,executor,source}` (merged by `withInvokeRouting`, `packages/app/src/services/event-bridge.ts:38`). Exit rows carry `outcome` / `exitCode` / `durationMs` (`packages/app/src/observability/agent-execution.ts:72-80`).
- Escalations are their own event: `agent.invoke.escalated` with `fromExecutor / fromTier / toExecutor / toTier / trigger` (the objective signal) + `runId` (`packages/app/src/services/agent-service.ts:1050-1063`, task 0545 R2). Absence of the row is the did-not-escalate signal — no null fields.
- Prior art for the aggregation shape: `packages/domain/src/analytics/role-tokens.ts` (`roleTokenSummary`) already reads these exact rows via `json_extract(payload_json, …)`.

Two corrections from premise verification (supersede the batch-create background): (1) the artifact contract is ADDITIVE-ONLY — `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1, bumps reserved for removed/retyped fields (`packages/domain/src/analytics/artifact.ts:66`), so this task adds optional fields and bumps nothing; the graceful-degradation scenario moved to feature R6 (R4 deprecated). (2) The report-mode registry is pure `HistoryArtifact → string` renderers with no I/O (`packages/domain/src/analytics/report-modes.ts`), so the ladder cannot be read at render time — this task embeds a `ladderSnapshot` into the artifact at analyze time; 0574 renders the diff from that snapshot. Also dropped from scope: verdict pass rate — verdicts are not in the analytics plane (zero verdict references under `packages/domain/src/analytics/`).
### Requirements
- [ ] R1. Add `pairingSummary` to `packages/domain/src/analytics/pairings.ts` (new file, mirroring `role-tokens.ts`): per pairing key (executor, role) — denormalized `agent` + nullable `model` — compute dispatch count, success rate (final-dispatch `outcome='done'` / dispatches), escalation counts split by `trigger`, total/mean duration, and cost/tokens folded through the same run→session mapping `roleTokenSummary` uses. Pairings with zero attributed dispatches are absent, never zero-valued. (feature J8 R1)
- [ ] R2. Extend the analyze artifact (`packages/domain/src/analytics/artifact.ts`) with optional additive fields `pairings?: PairingStat[]` and `ladderSnapshot?: LadderEntry[]` — `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1 (artifact.ts:66 contract). `ladderSnapshot` is the executor ladder (name/tier/array-order) read from project config by the app layer at analyze time and embedded; the domain layer stays config-free. (feature J8 R6)
- [ ] R3. Wire both fields into the analyze path (`packages/app/src/services/history-service.ts` or its analyze delegate) so `spur history analyze` always writes them; unit coverage in `packages/domain/tests/analytics/pairings.test.ts` with in-memory SQLite fixtures: a two-role fixture with known outcomes proves rates/counts; an unattributed-runs fixture proves absence-not-zero; a fixture with `agent.invoke.escalated` rows proves per-trigger counts. (feature J8 R1)
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
- [ ] Write `packages/domain/src/analytics/pairings.ts` (PairingStat + pairingSummary SQL) following role-tokens.ts structure (R1)
- [ ] Add `PairingStat[]`/`LadderEntry[]` optional fields + `LadderEntry` interface to artifact.ts (R2)
- [ ] Embed the ladder snapshot in the analyze path in history-service.ts (R2)
- [ ] Write `packages/domain/tests/analytics/pairings.test.ts` fixtures: known-outcomes rates, absence-not-zero, per-trigger escalation counts (R3)
- [ ] Verify: `bun test packages/domain` green, then `bun run lint` (R3)
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
