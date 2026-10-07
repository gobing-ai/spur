---
schema_version: 1
name: "Harden decision-catalog test evidence: pin rescue ordering and persisted gate rows"
status: todo
template: feature-impl
created_at: 2026-10-07T07:09:24.800Z
updated_at: "2026-10-07T17:16:11.267Z"
feature_id: P1

ac_altitude: task-local
priority: P3
estimate_hours: 3
---

## 1106. Harden decision-catalog test evidence: pin rescue ordering and persisted gate rows

### Background

Session review of runall-P1-20261006-02 (wrap, 2026-10-07) triaged two report-only P4 review findings from tasks 1098 and 1099 into this task. Not duplicates: both are evidence-hardening gaps, not deferred requirements. No code behavior defect is known.

1. `apps/cli/tests/workflow-decision-scan.test.ts` covers the history-anatomy rescue step's verdicts but does not pin that the rescue shell action runs only after the normalization shell action (composition contract of the second shell action in `config/workflows/history-anatomy.yaml`). If the two steps were reordered or collapsed back into one step, tests would stay green while the ADR-115 composition deviation loses its stated property.
2. The gate-evidence fallback event lifecycle is asserted in committed tests via a recording bus only (`packages/app/tests/workflow/decision-gate-catalog.test.ts`); the proof that persisted rows reach `system_events` through the run tap exists only in the gitignored artifact `.spur/run/1099-gate.json` (implementing worktree, since removed). Post-landing, committed coverage should prove persistence, not just in-memory emission.

**Refine corrections (2026-10-07)**

- `.spur/run/1099-gate.json` → absent in the main tree. Confirmed with `ls`: the implementing worktree has been removed. → The R2 assertions derive from code (`decision-events.ts:134-175`, `decision-hitl-responder.ts:458-469`), not from that artifact.
- "rescue step at `history-anatomy.yaml:253`" → both actions are in state `validate` (`:215`). The normalization action's comment starts at `:237` and the rescue's at `:255`. They are consecutive `kind: shell` actions; the anchor holds.
- R2 seam "in-memory SQLite" was unnamed → the established pattern is `createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' })` + `applyCliMigrations(adapter)` + `new SystemEventDao(adapter)` (`packages/app/tests/services/system-event-catch-all.test.ts:388-390`). Read back through `dao.query({...})` (`packages/domain/src/dao/system-event-dao.ts:359`) after `tap.flush()` (`system-event-tap.ts:37`).
- Interaction with task 1113 → 1113 R5 adds `evidenceDigest` to gate `decision.start`, and R3 adds `workflowName`/`wbs` correlation. → R2 asserts presence of required fields only. It never asserts the absence of `evidenceDigest`, `workflowName` or `wbs`, so either landing order stays green.
- The behavioral ordering check runs the real rescue command, which needs `jq` on PATH (installed: `/opt/homebrew/bin/jq`). → The test skips with a named reason when `jq` is missing, rather than failing.

### Requirements

- [ ] R1. `apps/cli/tests/workflow-decision-scan.test.ts` gains an explicit normalize-then-rescue ordering assertion; reordering either shell action fails the test.
- [ ] R2. A committed test in `packages/app/tests/` asserts evidence-mode gate fallback persists decision rows through the run tap (system_events) with caller `gate` and runId/node correlation — no reliance on gitignored artifacts. The seam is `registerSystemEventTap(bus, new SystemEventDao(<in-memory SQLite>), …)` (`packages/app/src/services/system-event-tap.ts:51`), not the `FakeSystemEventDao` that `packages/app/tests/decision/decision-events.test.ts:342` uses. Assert the `run_id` column is populated from the nested `correlation.runId` (`extractSystemEventCorrelation`, `:195`) and the source is `decision`.

### Acceptance Criteria

- [ ] AC1 — History-anatomy rescue fires only after normalization, pinned by a failing-if-reordered test
- [ ] AC2 — Gate-evidence fallback decision rows are persisted and provable from committed coverage alone

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:28:02.626Z

- 2026-10-07 P1 review: R1(b) replaced the E2E-artifact assertion with a stub-`spurBin` shell test, because `.spur/run/1098-verdicts.json` is gitignored and would repeat the gap R2 closes. The stub keeps the test offline.
- Independent of task 1113: 1113's env-adopted correlation (R4) changes what the rescue's events carry, not the step order this task pins.

### Design

**What.** Test-only hardening. There are no production, YAML or public-surface changes.

**R1: ordering pin.** It extends `apps/cli/tests/workflow-decision-scan.test.ts`, which already parses the workflow YAML.

- **Structural check.** In state `validate` of `config/workflows/history-anatomy.yaml`, locate the two shell actions by content:
  - normalization: the `command` contains `grep -vx 'Verdict: PASS'`;
  - rescue: the `command` contains `decision run anatomy-validation-verdict`.

  Assert `rescueIndex === normalizeIndex + 1`. Each must match exactly one action.
- **Behavioral check.** Run both parsed `command` strings with `Bun.spawn(['/bin/sh','-c', cmd], { cwd: tmp, env: { ...minimal PATH, __runId: 'r1', spurBin: stubPath } })`.
  - The temp dir holds `.spur/run/r1-validation.txt`.
  - `stubPath` is an executable script that appends one line to `calls.log` and prints `{"source":"model","value":"PASS"}`.
  - Fixture A is `Verdict: PASS\nprose`. In YAML order, `calls.log` is absent and the final line is `Verdict: PASS`. In reversed order, `calls.log` has one line. The test asserts both, so a reorder flips the observable outcome.
  - Fixture B is `Verdict: FAIL\nprose`. In YAML order, `calls.log` is absent and no `Verdict: PASS` line is appended.

**R2: persistence.** New file `packages/app/tests/workflow/decision-gate-persistence.test.ts`.

- Reuse the `gate-evidence through the real bundled catalog` setup from `decision-gate-catalog.test.ts:249-260`: `DecisionService.create(null, repoRoot, join(repoRoot,'config'))` and `TYPESAFE_API_KEY` cleared through `getEnvVar`/`setEnvVar`, restored in `finally`.
- Replace the recording bus with `new EventBus()` + `registerSystemEventTap(bus, dao, logger)` over the in-memory DAO, call `evaluateDecision`, then `await tap.flush()`.
- Assert the `decision.start`, `decision.failure` and `decision.end` rows:
  - same `invocationId` in the payload, in sequence order;
  - source `decision`;
  - `run_id` = the request `runId`, through `extractSystemEventCorrelation`;
  - payload `caller: 'gate'`, `correlation.nodeId`, failure `reason: 'no-backend'` and `fallbackValue: 'defer'`;
  - start `minConfidence: 0.7` and `makerSource: 'catalog-default'`.

**Anti-patterns.**

- Do not read any `.spur/run/*` artifact.
- Do not stub a model maker for R2: the no-backend fallback is the tested path.
- Do not use `FakeSystemEventDao`.
- Do not touch `process.env` directly.
- Do not edit workflow YAML. If the pin cannot be expressed without a YAML change, stop and surface it as a design deviation.

**Dependencies.** None. The task is independent of 1113 by construction (see the corrections).

### Plan

1. Read the current structural test `apps/cli/tests/workflow-decision-scan.test.ts` (89 lines) and the rescue step at `config/workflows/history-anatomy.yaml:253` — the existing test parses the workflow YAML and asserts the rescue appears exactly once in the history-anatomy allowlist; R1 extends this same file and style (no new framework).
2. R1 ordering pin, two assertions in that one test file, neither reading a gitignored artifact:
   - (a) structural — in the parsed `validate` state's action list, the normalization shell action's index is exactly one less than the rescue action's index.
   - (b) behavioral — extract both `command` strings from the parsed YAML and run them with `/bin/sh -c` in a temp dir, `__runId` exported and `spurBin` pointing at a stub script that appends to a call log and prints `{"source":"model","value":"PASS"}`. Fixture: `Verdict: PASS` on the first line followed by prose. In YAML order, normalization moves PASS to the last line and the stub is never called. Run in reversed order and the stub is called; assert the in-order call log is empty, so a reorder fails the test. Add a second fixture with a `Verdict: FAIL` line: the stub is never called and no PASS is appended.
3. R2 persistence test: new file `packages/app/tests/workflow/decision-gate-persistence.test.ts`, mirroring the bus assertions in `packages/app/tests/workflow/decision-gate-catalog.test.ts` (real catalog, `gate-evidence` choice, fallback `defer`) but wiring the run tap to in-memory SQLite per repo test conventions (bunfig preload; DAO tests use in-memory SQLite) and asserting persisted `system_events` rows: decision start/failure|success/end, `caller: 'gate'`, `correlation.runId`/`correlation.nodeId`, fallback reason `no-backend`.
4. Env hygiene: use the config-gateway pattern already in `packages/app/tests/workflow/decision-gate-catalog.test.ts:245-260` (`getEnvVar`/`setEnvVar('TYPESAFE_API_KEY', undefined)` restored in `finally`), per the env-var-hygiene rule. Do not touch `process.env` directly.
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
- Production anchors are repo-relative: `packages/app/src/workflow/decision-hitl-responder.ts:458` (catalog branch), `:463-469` (lifecycle+correlation), `:471-487` (accepted requires served.source=="model" && value in {yes,no}); persistence shape reference: gitignored `.spur/run/1099-gate.json` was regenerated in the implementing worktree (now removed) — reproduce via `decision run` on a gate-evidence gate with no backend configured, or derive assertions from `packages/app/src/decision/decision-events.ts:134-175` (path corrected 2026-10-07; the module lives under `decision/`, not `workflow/`).
- `decision-gate-catalog.test.ts` asserts `minConfidence: 0.7` and `makerSource: 'catalog-default'` — persistence test should assert the same served values in stored payloads.
- Do not broaden scope to other workflows' rescues (idea-pipeline rescue has its own test file `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts` and is already behaviorally covered).

