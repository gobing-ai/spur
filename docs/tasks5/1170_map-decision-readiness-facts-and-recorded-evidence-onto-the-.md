---
schema_version: 1
name: Map decision readiness facts and recorded evidence onto the status report
status: done
template: feature-impl
created_at: 2026-10-11T23:23:16.864Z
updated_at: "2026-10-13T02:58:35.502Z"
feature_id: P11

done_forced: "false"
done_reason: unforced close; PASS artifact at tracked Testing section (scratch verdict not retained)
---

## 1170. Map decision readiness facts and recorded evidence onto the status report

### Background

Slice of feature P11. `DecisionService.status()` answers "what is configured": layers, registered
makers, per-decision effective maker and source. It cannot answer "has it ever worked", because it is
a synchronous pure read with no database access, and the ledger is where that answer lives.

This task adds the readiness mapping: the per-maker registration/configuration/serves facts the
operator cannot currently see, plus the recorded evidence that separates a registered and configured
maker from one that has actually served a decision.

### Requirements

- [x] R1. Add `packages/app/src/decision/decision-status-readiness.ts` with:
  - `DecisionEvidence { recorded, accepted, lastSeen }` — accumulated over one maker or one decision.
  - `DecisionMakerReadiness { name, registered, configuredBy, serves, evidence }` — `configuredBy`
    lists the config keys naming this maker (`decisions.maker`, `decisions.makers.<id>`); `serves`
    lists the decision ids whose effective maker it is.
  - `DecisionStatusEvidenceRow` — `DecisionStatusRow` plus `evidence`.
  - `DecisionStatusReadiness { makers, perDecision, probes? }` — the additive overlay on
    `DecisionStatus`. It is named for the status report, not `DecisionReadiness`, because
    `packages/app/src/workflow/decision-readiness.ts` already owns that name for the workflow's evidence-mode responder.
- [x] R2. `decisionStatusReadiness(status, groups?)`: a pure mapping from `DecisionStatus` plus the
  recorded groups. Per maker it folds every `(decisionId × maker)` group for that maker and lists
  registered makers first, then any configured name the registry does not hold (a config error must
  stay visible as a failing row). Per decision row it attaches the group matching that row's
  effective maker. `accepted` counts rows with `source: model` (exactly what the reliability report
  already computes); a row with no group reports `{ recorded: 0, accepted: 0, lastSeen: null }`.
- [x] R3. `readDecisionStatusReadiness(dao, status)`: reads the ledger through the existing
  `decisionReliability` aggregation and maps it with R2. It never constructs a maker. A database
  without the `system_events` table reports zero evidence, not an error (`SystemEventDao` already
  returns no groups for a missing table).
- [x] R4. Export the new symbols from `packages/app/src/index.ts`.
- [x] R5. Additive only: `DecisionStatus` keeps every existing field and meaning; the readiness
  overlay spreads over it at the CLI boundary so `--json` consumers keep their fields. The per-decision
  row gains `type`, `layer` and `minConfidence` (from the list entry and the served contract) so the
  report can name what it resolves without a second lookup.

### Acceptance Criteria

- [x] AC1 — Every maker row shows registration, configuration and what it serves
- [x] AC2 — Each decision row shows its effective maker, resolution source and catalog facts
- [x] AC3 — Recorded evidence separates registered and configured from actually working

### Q&A

Closed decisions from the original 2026-10-11 refinement and implementation session (deduplicated during this audit):

- Operator request (this session): the report must let an end user see the *registered*, *configured*
  and *actually working* markers per maker and per decision. Accepted the recommended evidence source:
  the recorded `decision.end` ledger via the existing reliability aggregation.

- Deferred: a dedicated `group by maker` DAO aggregate. Condition: a caller needs per-maker evidence
  without a per-decision breakdown, or the group count grows past a single bounded query.

- Deferred: using `decision_logs` as the evidence source. Condition: never for this column — it is
  gated by the `decisions.log` config, so an `off` project would report a working maker as unused.

### Design

**Chosen: reuse the existing reliability aggregation; map in the app layer.**

- `decisionReliability` already groups `system_events` `decision.end` rows by `decisionId × maker` and
  fills `evidence: none` for served ids with no rows. Folding those groups is pure arithmetic, so no
  new DAO method, no new SQL and no new migration.
- `system_events` rather than `decision_logs` as the evidence source: the event ledger is always
  written, while `decision_logs` is controlled by the `decisions.log` config (`full` | `metadata` | `off`)
  — a project with `off` would report a working maker as never-used, which is the exact confusion
  this feature removes.
- Once per status run, three groups in feature P1, remains well inside a bounded read.

**Rejected:**
- A `group by maker` DAO aggregate: the same numbers are already in memory after one query, and the
  per-maker figure is a fold, not an aggregation.
- Computing the join in the CLI: application logic belongs in `packages/app` (ADR-021), and the Board
  or a workflow needs the same readiness view.

### Plan

- [x] Map registry, configuration and effective decision makers in the app layer.
- [x] Fold reliability groups per maker and match per decision/maker; retain unused configured defaults.
- [x] Export the overlay and verify empty/recorded ledgers and maker changes.

### Solution

- **R1/R2 — the overlay** (`packages/app/src/decision/decision-status-readiness.ts`, new): `DecisionEvidence`,
  `DecisionMakerReadiness`, `DecisionStatusEvidenceRow`, `DecisionStatusReadiness`, plus the pure
  `decisionStatusReadiness(status, groups?)`. Makers are the registered set first, then any configured name
  the registry does not hold, so an unregistered configured maker stays a visible failing row instead of
  disappearing from the report.
- **R3 — the read** (`packages/app/src/decision/decision-status-readiness.ts:148`): `readDecisionStatusReadiness(dao, status)` calls the existing
  `decisionReliability(dao)` aggregation and maps it; no new DAO method, no new SQL, no new migration.
- **R4 — exports**: the overlay symbols are exported from `packages/app/src/index.ts` next to the
  reliability block, so the CLI imports only through the package index (ADR-021).
- **R5 — additive row fields** (`packages/app/src/decision/decision-service.ts`): `DecisionStatusRow`
  gained `type`, `layer` and `minConfidence`, taken from the list entry the status loop already resolves
  and from `hub.describe(id)`. No existing field changed name or meaning; the CLI test asserts the
  pre-existing key set is still present.
- **Evidence semantics**: matched on `(decisionId, maker)`, never on the id alone — a decision whose
  configured maker changed reports zero evidence for its new maker (asserted by
  `R4: a decision whose maker changed has no evidence for the new maker`).
- **Renamed from the task's first draft**: `decision-readiness.ts` → `decision-status-readiness.ts` and
  `DecisionReadiness` → `DecisionStatusReadiness` (`packages/app/src/workflow/decision-readiness.ts`
  already owned the former name for the workflow's evidence-mode responder). The Requirements section was
  updated to the shipped names.

- **Citations**: `packages/app/src/decision/decision-status-readiness.ts:98` (mapping), `packages/app/src/decision/decision-status-readiness.ts:148` (ledger read), `packages/app/src/decision/decision-service.ts:539` (status rows), `packages/app/src/index.ts:78` (exports).


- Re-audit correction: include the configured default maker even when the catalog has no decisions; the regression test exercises an unregistered default with an empty catalog.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Overlay interfaces and pure mapping at `packages/app/src/decision/decision-status-readiness.ts:98`; exercised by app readiness suite. Fresh this run: bun test tests/decision (cwd packages/app) exited 0, 88 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail. |
| R2 | MET | Empty-catalog default, missing maker, pair matching and fold totals: `packages/app/tests/decision/decision-status-readiness.test.ts:100`. Fresh this run: bun test tests/decision (cwd packages/app) exited 0, 88 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail. |
| R3 | MET | Ledger read via reliability aggregation at `packages/app/src/decision/decision-status-readiness.ts:148`; real in-memory DAO test at `packages/app/tests/decision/decision-status-readiness.test.ts:209`. |
| R4 | MET | Readiness export block at `packages/app/src/index.ts:90-102` (re-anchored this run; prior :78 drifted). |
| R5 | MET | Status rows gain type/layer/minConfidence at `packages/app/src/decision/decision-service.ts:606-616`; pre-existing JSON keys asserted at `apps/cli/tests/commands/decision.test.ts:427`. Fresh this run: bun test tests/decision (cwd packages/app) exited 0, 88 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R2 — Every maker row shows registration, configuration and what it serves | MET | test | `apps/cli/tests/commands/decision.test.ts:427`; scratch-project decision status exited 0 showing CONFIGURED BY/SERVES per maker. Fresh this run: bun test tests/decision (cwd packages/app) exited 0, 88 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail. |
| Scenario: R3 — Each decision row shows its effective maker, resolution source and catalog facts | MET | test | `apps/cli/tests/commands/decision.test.ts:427`; scratch decision status rows show MAKER/SOURCE/MIN/LAYER. Fresh this run: bun test tests/decision (cwd packages/app) exited 0, 88 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail. |
| Scenario: R4 — Recorded evidence separates registered and configured from actually working | MET | test | `packages/app/tests/decision/decision-status-readiness.test.ts:209`; `apps/cli/tests/commands/decision.test.ts:427`. Fresh this run: bun test tests/decision (cwd packages/app) exited 0, 88 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Current audit found and fixed an unused configured default disappearing when the catalog is empty. The mapping now includes that name independently of per-decision rows; its regression test asserts registration, configuration source, empty serves and zero evidence.

Per-maker totals intentionally include historical groups, while each decision matches its current maker. The Decisions table and reliability view supply the breakdown. Rendering serves as a count follows the feature contract; one in-memory descriptor lookup per decision is necessary for its catalog facts. These prior rows were design descriptions, not unresolved defects. Stored ledger timestamps are UTC ISO strings, so the latest timestamp fold follows the existing ledger contract.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 | correctness | packages/app/src/decision/decision-status-readiness.ts | Unregistered configured default omitted with no decisions. | FIXED — default name included independently; empty-catalog regression passes. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-11T23:25:03.910Z backlog → todo (system)
- 2026-10-12T01:39:51.329Z todo → wip (system)
- 2026-10-12T01:39:52.025Z wip → testing (system)
- 2026-10-12T01:44:13.074Z testing → done (system)
- 2026-10-12T01:57:00.894Z done → wip (system)
- 2026-10-12T01:57:01.556Z wip → testing (system)
- 2026-10-12T01:57:02.214Z testing → done (system)

