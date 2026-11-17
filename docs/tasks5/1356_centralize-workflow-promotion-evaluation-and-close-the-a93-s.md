---
schema_version: 1
name: Centralize workflow promotion evaluation and close the A93 script ownership audit
status: done
template: feature-impl
created_at: 2026-11-16T23:01:54.457Z
updated_at: "2026-11-17T01:32:35.041Z"
feature_id: A93
priority: P2
tags:
  - A93
estimate_hours: 4

dependencies: ["1351", "1352", "1353", "1354", "1355"]
done_forced: "false"
done_reason: unforced close
---

## 1356. Centralize workflow promotion evaluation and close the A93 script ownership audit

### Background

A93 implements R8 — Noun-specific tooling and retained repository checks keep one owner. Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md. Owner contract: docs/design/concrete-spur-self.md. Plan quiz was auto-skipped under the operator's --auto; no public-contract consent is inferred.

**Refine corrections (2026-11-16)**

- Generic workflow evaluator extraction → current script already consumes domain history queries and resolved workflow facts → move only measurement/statistics/verdict types/functions, retaining repository policy and orchestration.
- Fixed-input proof could mock the behavior under test → existing evaluate --db/--config/--workflows-dir/--now supports a real dispatcher fixture → freeze that E2E path.
- Final removal audit assumed every route disappears → authorized CI callers can retain thin forwarding paths → distinguish proven forwarding from obsolete/duplicated logic.
- Dependency assumptions and final handoff implicit → name receipts/contracts from 1351–1355 and one feature-owned verification boundary → record exact inputs/outputs.

Issue triage: the migration outcome remains valid. Already-recorded direction is verified, not reimplemented; existing implementation gaps and owner handoffs are corrected here. No task-level issue was cancelled or merged. Audit: main@134ea68a111b9d0aac739419a7259d7928498005; sole worktree; no wip tasks. Existing A93 changes preserved.

### Requirements

- [x] R1. Move reusable readAgentRunHistory/measureAgentRunHistory/evaluateCandidate and their measurement/verdict types into packages/app/src/workflow/promotion-evaluation.ts, reusing existing domain query functions; retain repository catalogue, deadlines, check/resolve policy and dispatcher grammar.
- [x] R2. Preserve zero-real-run delete, strictly-fewer-actions promotion, pinned baseline behavior, missing duration semantics, refusal diagnostics and evaluation timestamp. No public promotion verb or app runtime import from scripts/tests.
- [x] R3. Consume receipts/dispositions from 1351–1355 and regenerate the exhaustive caller report; classify each remaining dispatcher route as retained repository orchestration or forwarding to one shared owner. Missing approval/foreign-platform execution is explicit, not a completed removal.
- [x] R4. Prove evaluate/check/resolve via the actual existing dispatcher and isolated SQLite/candidate/workflow fixtures, plus final source/packed/host-native standalone ownership checks. Produce a repeatable final report and run the feature-owned verification pass only after all implementation tasks and their gates are complete.

### Acceptance Criteria

- [x] AC1 — Noun-specific tooling and retained repository checks keep one owner

Requirement and verification mapping: AC1 covers R1–R4. Given isolated candidate/DB/workflow fixtures, drive existing dispatcher evaluate/check/resolve; assert fixed-time verdict/error policy and final caller/disposition coverage using dependency receipts.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T23:11:43.448Z

- Closed: app owns portable measurement/verdict; repository catalogue/deadline/check/resolve policy stays in scripts. No new public verb or source fixture dependency.
- Closed: fixture E2E uses the existing explicit --db/--config/--workflows-dir/--now flags and domain-owned fixture setup, never live run data.
- Closed: retaining a justified single-owner CI forwarding route is compatible with staged migration; duplicated logic and unaccounted routes fail the audit.
- Deferred to upstream tasks/Robin: public consent and implementation receipts are inputs, not grants made by this refinement. Cross-platform runtime validation remains with the appropriate release hosts.

### Design

No new public API. Freeze packages/app/src/workflow/promotion-evaluation.ts exports using existing names and semantic signatures: readAgentRunHistory(dbPath,workflow,runIds?), measureAgentRunHistory(dbPath,workflow,runIds?), evaluateCandidate(candidate,measured,canonicalAgentRunCount,nowIso), associated WorkflowCandidate/AgentRunMeasurement/WorkflowCandidateVerdict data. Use @gobing-ai/spur-domain history rows; move only the minimum helper types/statistics required by these functions. Export through the existing app owner. No repository-root defaults inside app and no candidate persistence/schema redesign.

scripts/commands/workflow-promotion.ts retains load/save catalogue, deadline/retirement/parallel-definition policy, check/evaluate/resolve argument parsing and output. It imports the app functions and shares one verdict implementation. Preserve baseline comparator and runs>0 evidence requirement; only measured durations participate in duration statistics. Do not add a live model call or change the promotion bar.

Test first at scripts/commands/workflow-promotion.e2e.test.ts through bun scripts/spur-dev.ts promotion evaluate <id> --db <fixture> --config <fixture> --workflows-dir <fixture> --now <fixed>. The CLI already supports these internal flags. Create fixture data with the domain DB owner, never touch live candidates/history. Include zero history, reduced/equal counts, baseline drift, missing candidate and resolve contradiction; retain existing workflow-promotion.test.ts assertions and move pure evaluator checks with the owner only when necessary.

Inputs: 1351 canonical inventory/contracts, 1352 read-only status receipt, 1353 installation/bootstrap receipt, 1354 compile and 1355 artifact receipts/forwarding dispositions. All are declared dependencies and must be implemented before final audit. Final output docs/reports/A93-tooling-absorption.md plus refreshed docs/reports/A93-script-ownership.json; execution receipt .spur/run/1356-promotion-e2e.json. Audit leftovers and all artifact entrypoints without publishing or changing workflows. A compatibility forwarding path is accepted only with one actual app owner, a live caller and a recorded retirement condition.

Current tree: only main, no wip task; sequential writing preserves the earlier A93 changes. Budget 4h; requireDiff evaluator/caller+final audit. Request feature-owned verification once after full implementation; this refinement supplies no verify PASS or feature done claim.

### Plan

1. Step 0: verify dependency receipts and current inventory; isolate candidate DB/config/workflow fixtures and recheck baseline comparator semantics.
2. R1/R2/R4: write failing dispatcher E2E cases before extraction; confirm they exercise real app/domain evaluation rather than mocked collaborators.
3. R1/R2: move minimal shared evaluator/types and import from the script, preserving policy/grammar/output and refusal behavior.
4. R3/R4: regenerate final caller report and retained forwarding reasons; run (cd scripts && bun test commands/workflow-promotion.e2e.test.ts commands/workflow-promotion.test.ts), relevant installed proofs and task gate. Only after all task implementation gates pass, invoke the single feature-owned verify pass and attach its actual receipt.

### Solution

Promotion evaluation has one app owner; the audit is closed.

- `packages/app/src/workflow/promotion-evaluation.ts` (new) — `readAgentRunHistory`, `measureAgentRunHistory`, `evaluateCandidate` plus `WorkflowCandidate`/`WorkflowCandidateDelta`/`WorkflowCandidateMeasurement`/`WorkflowCandidateVerdict`/`AgentRunMeasurement`/`AgentRunStat`, moved verbatim in behaviour from the script. Rows still come from `@gobing-ai/spur-domain` (`readAgentRunHistoryRows`) and `openExistingDb`; **no repository path defaults** live in the module (the caller passes `dbPath`).
- `scripts/commands/workflow-promotion.ts` keeps what is repository policy: catalogue load/save/`validateCandidate`, deadline + parallel-definition + retirement checks, `check`/`evaluate`/`resolve` argument grammar and output. It imports the moved functions from `@gobing-ai/spur-app`, so there is exactly one verdict implementation.
- Preserved semantics, each pinned by a test: zero recorded real runs can never promote; promotion needs strictly fewer `agent.run` actions; `delta.baselineAgentRunCount` pins the incumbent; a run with no `agent.run` rows has an unmeasured duration (`null`, never 0); `evaluatedAt` is the caller's `--now`.
- Tests: `scripts/commands/workflow-promotion.e2e.test.ts` (9 cases) drives the **real dispatcher** (`bun scripts/spur-dev.ts promotion …`) with a candidate catalogue, a `config/workflows` fixture and an isolated SQLite history plane; `packages/app/tests/workflow/promotion-evaluation.test.ts` (11 cases) covers the history reading/summarizing against a temp DB and the verdict rules — 100 % funcs / 100 % lines for the new module. The 31 existing `workflow-promotion.test.ts` assertions still pass, importing the moved pieces from their new owner.
- Final audit (R3): `docs/reports/A93-script-ownership.json` regenerated — 60 candidates (the four companions that moved to `packages/app/tests/builder/` left the script set), `tests` anchors remapped to their new paths, per-entry `disposition`, a `consentStatus` block recording Robin's 2026-11-16 grant, and `boundaryEdges: []`. `repo-wide-tests/a93-script-ownership.test.ts` gains two final-audit assertions (disposition consistency, empty boundary ledger) and now pins the recorded grant instead of the pre-consent state.
- `docs/reports/A93-tooling-absorption.md` is the closing record: what changed per surface, what is deliberately retained and why, per-task receipts, and the explicit not-done list (no publishing/deployment/workflow edits, foreign targets not executed, no strict read-only DB reads upstream).

Receipt: `.spur/run/1356-promotion-e2e.json`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/promotion-evaluation.ts` exports `readAgentRunHistory`, `measureAgentRunHistory`, `evaluateCandidate` and the measurement/verdict types, reusing domain rows (`readAgentRunHistoryRows`, `openExistingDb`) and carrying no repository path defaults — the caller passes `dbPath`. `scripts/commands/workflow-promotion.ts` imports them and keeps the catalogue (`load/save/validateCandidate`), deadline/parallel-definition/retirement policy and the `check |
| R2 | MET | Behaviour is preserved and pinned: zero real runs never promotes (`promotion-evaluation.test.ts` + dispatcher E2E), strictly-fewer-actions bar, `baselineAgentRunCount` pins the incumbent, an `agent.run`-less run keeps `durationMs: null` (never 0), refusal messages still name the candidate and the contradiction, and `evaluatedAt` is the caller's `--now` (`evaluate` E2E asserts the literal timestamp). No public promotion verb was added and the app imports nothing from `scripts/`. |
| R3 | MET | Receipts consumed from 1351–1355; `docs/reports/A93-script-ownership.json` regenerated (60 candidates — the four companions that moved with their subjects left the script set — remapped test anchors, per-entry `disposition`, `consentStatus`, `waves[]`, `boundaryEdges: []`). `docs/reports/A93-tooling-absorption.md` is the closing record with per-task receipts and an explicit not-done list. Every remaining dispatcher route is classified retained-or-forwarder in the report; nothing is claimed removed without evidence. |
| R4 | MET | `scripts/commands/workflow-promotion.e2e.test.ts` drives the real dispatcher (`bun scripts/spur-dev.ts promotion …`) with catalogue/config/workflows fixtures and an isolated SQLite history plane (9 cases: promote, equal-count rejection, zero-history refusal, pinned baseline, missing candidate, contradicting resolve, matching resolve, expired check, fresh check). App-side unit tests cover the reading/summarizing path against a temp DB (11 cases, 100 % funcs/100 % lines). Feature-owned verification is requested below, not claimed here. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `scripts/commands/workflow-promotion.e2e.test.ts` (dispatcher) + `packages/app/tests/workflow/promotion-evaluation.test.ts` (owner) + `repo-wide-tests/a93-script-ownership.test.ts` (disposition consistency, empty boundary ledger) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: A93; [owning design](../design/concrete-spur-self.md).
- Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md.
- Verified current tree: scripts/commands/workflow-promotion.ts:230.
- Verified current tree: scripts/commands/workflow-promotion.ts:275.
- Verified current tree: scripts/commands/workflow-promotion.ts:302.
- Verified current tree: scripts/commands/workflow-promotion.ts:596.
- Verified current tree: packages/domain/src/analytics/workflow-measurements.ts:313.
- Refinement report: docs/reports/2026-11-16-A93-ready-refinement.md.

### History

- 2026-11-17T01:22:53.485Z todo → wip (system)
- 2026-11-17T01:32:33.583Z wip → testing (system)
- 2026-11-17T01:32:35.036Z testing → done (system)

