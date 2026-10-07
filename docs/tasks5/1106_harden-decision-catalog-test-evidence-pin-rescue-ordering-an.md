---
schema_version: 1
name: "Harden decision-catalog test evidence: pin rescue ordering and persisted gate rows"
status: todo
template: feature-impl
created_at: 2026-10-07T07:09:24.800Z
updated_at: "2026-10-07T07:21:20.221Z"
feature_id: P1

ac_altitude: task-local
---

## 1106. Harden decision-catalog test evidence: pin rescue ordering and persisted gate rows

### Background

Session review of runall-P1-20261006-02 (wrap, 2026-10-07) triaged two report-only P4 review findings from tasks 1098 and 1099 into this task. Not duplicates: both are evidence-hardening gaps, not deferred requirements. No code behavior defect is known.

1. `apps/cli/tests/workflow-decision-scan.test.ts` covers the history-anatomy rescue step's verdicts but does not pin that the rescue shell action runs only after the normalization shell action (composition contract of the second shell action in `config/workflows/history-anatomy.yaml`). If the two steps were reordered or collapsed back into one step, tests would stay green while the ADR-115 composition deviation loses its stated property.
2. The gate-evidence fallback event lifecycle is asserted in committed tests via a recording bus only (`packages/app/tests/workflow/decision-gate-catalog.test.ts`); the proof that persisted rows reach `system_events` through the run tap exists only in the gitignored artifact `.spur/run/1099-gate.json` (implementing worktree, since removed). Post-landing, committed coverage should prove persistence, not just in-memory emission.

### Requirements

- [ ] R1. `apps/cli/tests/workflow-decision-scan.test.ts` gains an explicit normalize-then-rescue ordering assertion; reordering either shell action fails the test.
- [ ] R2. A committed test in `packages/app/tests/` asserts evidence-mode gate fallback persists decision rows through the run tap (system_events) with caller `gate` and runId/node correlation — no reliance on gitignored artifacts.

### Acceptance Criteria

- [ ] AC1 — History-anatomy rescue fires only after normalization, pinned by a failing-if-reordered test
- [ ] AC2 — Gate-evidence fallback decision rows are persisted and provable from committed coverage alone

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

1. Read the current structural test `apps/cli/tests/workflow-decision-scan.test.ts` (89 lines) and the rescue step at `config/workflows/history-anatomy.yaml:253` — the existing test parses the workflow YAML and asserts the rescue appears exactly once in the history-anatomy allowlist; R1 extends this same file and style (no new framework).
2. R1 ordering pin, two assertions in that one test file: (a) structural — parsed step order has normalization before rescue; (b) behavioral — in the E2E verdicts matrix (`.spur/run/1098-verdicts.json` contract: exact FAIL -> zero decision rows), assert rescue lifecycle rows never appear when normalization did not produce exact-FAIL input first.
3. R2 persistence test: new file `packages/app/tests/workflow/decision-gate-persistence.test.ts`, mirroring the bus assertions in `packages/app/tests/workflow/decision-gate-catalog.test.ts` (real catalog, `gate-evidence` choice, fallback `defer`) but wiring the run tap to in-memory SQLite per repo test conventions (bunfig preload; DAO tests use in-memory SQLite) and asserting persisted `system_events` rows: decision start/failure|success/end, `caller: 'gate'`, `correlation.runId`/`correlation.nodeId`, fallback reason `no-backend`.
4. Env hygiene: copy the save/restore-`TYPESAFE_API_KEY`-in-`finally` pattern from `packages/app/tests/services/workflow-service.test.ts:323` region.
5. Offline contract: no-backend fallback IS the tested path — do not stub a model maker. Legacy `decisionMaker` must stay untouched in both modes (1099 reviewer invariant 4).
6. Gates: workspace-focused tests while iterating, then one `bun run spur-check` at the end. No workflow YAML edits expected; if a YAML change becomes necessary, stop — that is a design deviation, surface it.

### Solution

- Add an ordering assertion to the scan test: normalize-before-rescue (e.g. assert rescue rows/lifecycle only appear when normalization produced exact-FAIL input, and pin step order from the YAML or an ordered execution double).
- Add a DB-backed test for evidence-mode gate fallback asserting persisted decision rows (caller `gate`, correlation runId/node, fallback lifecycle) via the run tap against in-memory SQLite, mirroring the `.spur/run/1099-gate.json` shape.


Key anchors: rescue step `config/workflows/history-anatomy.yaml:253`; scan test `apps/cli/tests/workflow-decision-scan.test.ts:1`; bus-only lifecycle assertion `packages/app/tests/workflow/decision-gate-catalog.test.ts:245`; gitignored artifact `.spur/run/1099-gate.json` (implementing worktree, removed at cleanup).

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T07:19:56.733Z backlog → todo (system)

### Notes

- Filed from session review triage (runall-P1-20261006-02 wrap): consolidates 1098 review P4 (ordering pin, reviewer 8dd04170 report) and 1099 review P4 (persisted-rows proof only in gitignored artifact, reviewer 024d982e report).
- Evidence conventions that made source tasks verifiable first-attempt: bare R/AC ids, executable evidenceType (test/command) for code claims, verbatim scenario-title twin rows. Reuse them in the verify answer.
- Production anchors are repo-relative: `packages/app/src/workflow/decision-hitl-responder.ts:458` (catalog branch), `:463-469` (lifecycle+correlation), `:471-487` (accepted requires served.source=="model" && value in {yes,no}); persistence shape reference: gitignored `.spur/run/1099-gate.json` was regenerated in the implementing worktree (now removed) — reproduce via `decision run` on a gate-evidence gate with no backend configured, or derive assertions from `packages/app/src/workflow/decision-events.ts:136-158`.
- `decision-gate-catalog.test.ts` asserts `minConfidence: 0.7` and `makerSource: 'catalog-default'` — persistence test should assert the same served values in stored payloads.
- Do not broaden scope to other workflows' rescues (idea-pipeline rescue has its own test file `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts` and is already behaviorally covered).

