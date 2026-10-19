---
schema_version: 1
name: "Harness operational seams: staging, dispatch, cleanup, scheduler and CLI parity"
status: done
template: issue
created_at: 2026-10-19T02:36:33.290Z
updated_at: "2026-10-19T17:47:02.208Z"

feature_id: D3
priority: P2
ac_altitude: task-local
estimate_hours: 3
dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1259-verdict.json
---

## 1259. Harness operational seams: staging, dispatch, cleanup, scheduler and CLI parity

### Background

Confirmed async-registration defect: apps/cli/src/commands/workflow/run.ts:137-158 catches every trace error as temporary absence, unlike existingWorkflowRun at :166-179 which distinguishes Run not found from a store error. The timeout branch at :612-637 labels an unconfirmed registration as a failed spawn and advises a synchronous rerun even though the detached worker can still register and execute. The launch helper discards child output and returns no worker-death proof, so absence of a row at one instant cannot justify replaying actions.

**Refine corrections (2026-10-18)**
- Removed deletion-staging defect: changedSinceBase includes tracked deletions, and modern git add -- <tracked-deletion> stages them. A fresh real-Git fixture passed commitGuardStage with D delete.yaml and M edit.txt; receipt .spur/run/refine-1259-probe.ts. No deletion flag/status redesign.
- Removed feature-derivation defect: a linked blocked task is live scope under the existing status contract. No accepted deferral marker exists; inventing one to ignore blocked work would weaken completion.
- Removed silent worktree-cleanup claim: execution-worktree-landing.md already fail-stops on removal failure, writes retained + mergeCommit, and documents inspection-only partial-removal recovery with operator authorization for recursive deletion. Git leaving a directory after a failed command is not a new CLI defect.
- Removed scheduler-causality claim: workflow --async directly spawns a detached worker; no queue-consumer dependency establishes the proposed saturation cause. No queue diagnostics or lease changes.
- Removed feature verify --json enhancement: absence is real but not a failure of its receipt-owning contract; no operator consent/design exists for that public extension. It is outside this corrective task.
- Retained: distinguish storage/read failures from registration absence and make uncertain-launch diagnostics truthful without automatic replay. Removed timeout-to-sync fallback because it can duplicate side effects. The existing definite spawn-exception path remains outside this task.
- Title still names removed seams; CLI cannot rename it. Estimate unset → 3h; feature D3 preserved; task-local AC.

### Requirements

- [x] R2. Registration polling retries only genuine Run not found observations. A DB/read/permission error stops polling and surfaces an actionable redacted diagnostic with nonzero launch exit; it never launches a synchronous replacement.
- [x] R7. Human and JSON timeout diagnostics state that registration was not confirmed within the configured deadline and the worker may still be starting. Preserve nonzero exit, existing JSON status/reason/hint shape and absence of a confirmed runId on failure. Guidance requires inspecting workflow list/trace before a manual rerun; do not recommend immediate replay.
- [x] R8. Successful registration, including the final allowed observation, retains the existing started response and plan stamp. Failed confirmation performs no second dispatch and creates no second plan/run.
- [x] R9. Regression fixtures cover eventual registration, never registered, a store-read error and a late worker; assert dispatch count and output contracts in human/JSON modes.

Out of scope: commit-guard changes, feature status/deferral semantics, worktree cleanup, queue diagnostics, feature verify JSON, new verbs/flags/statuses, longer timeout defaults and worker ownership/kill protocols. Gaps in R numbering preserve references to the original issue list.

### Acceptance Criteria

- [x] AC2 — An unconfirmed async launch reports uncertainty and never automatically replays the workflow (req: R7, R8, R9)
- [x] AC5 — Genuine store errors surface separately from missing registration while successful starts remain compatible (req: R2, R8, R9)

### Q&A

- Closed: timeout proves only lack of confirmed registration; no synchronous fallback after successful detached spawn request.
- Closed: preserve existing JSON fields and status vocabulary; clarify failed confirmation through reason/hint.
- Closed: remove unapproved public enhancements and false operational premises instead of carrying them as optional implementation work.

### Design

Chosen: reuse existingWorkflowRun's Run not found predicate inside waitForRunRegistration, retaining the current boolean success/deadline API; other errors propagate to a bounded caller catch and existing error-output conventions. No new API. Repair only registration-observation handling and failure text in apps/cli/src/commands/workflow/run.ts. Keep the existing finite timeout config and poll interval; do not add an extra timeout or synchronous path after a successfully requested detached launch.

Human output distinguishes a registration deadline from a spawn exception. JSON retains status failed for failed launch confirmation, reason and hint; do not imply the workflow row itself is terminal failed. No unconfirmed runId success handle. Tell the operator to inspect workflow list, then trace an existing/explicitly supplied id before deciding to rerun. Redact read errors using existing CLI conventions; never dump database/config contents or raw credentials.

Targets: apps/cli/src/commands/workflow/run.ts, apps/cli/tests/commands/workflow/run.test.ts, apps/cli/tests/commands/workflow-run-registration.test.ts; owning docs/design/cli-contracts.md workflow async contract. Inspect plugins/sp/skills/spur-cli/references/workflows.md and update only conflicting guidance. Reuse current fake detached launcher and actual CLI command fixtures; helper-only assertions cannot establish dispatch count or JSON behavior.

Dependencies: none. Source-local Git probe disproved deletion scope; 1258 owns retention and 1256 owns terminal reason classification. No new schema, process supervisor, queue queries, generated adapter edits or dependencies. Budget 3h.

### Plan

- [x] 1. Add failing cases for non-not-found trace error and timeout wording; assert no second dispatch and unchanged absence of runId on failure (R2, R7, R9).
- [x] 2. Reuse the existing missing-run distinction in polling; catch other errors at the command boundary with nonzero redacted output (R2).
- [x] 3. Correct timeout text and recovery guidance without adding retry/fallback behavior or changing successful response fields (R7, R8).
- [x] 4. Drive delayed/never/error/late registration through human and JSON command fixtures; confirm one dispatch and compatible started/plan behavior (R8, R9).
- [x] 5. Run the focused CLI tests inside apps/cli, link/rebuild CLI bundle, update owning async guidance and run task-local gate. Save invocation/output plus dispatch-count evidence before review/verify.

### Root Cause

waitForRunRegistration treats all thrown trace errors as Run not found and erases their cause. The caller then overstates a deadline observation as worker failure, despite no worker-exit ownership evidence. Existing existingWorkflowRun already implements the correct absence-versus-read-error predicate and can be reused.

### Solution

Repaired the `workflow run --async` registration observation: a store/read failure is no longer
mistaken for an unregistered run, and an unconfirmed registration no longer claims the worker failed
or recommends a replay.

| File | Change |
| --- | --- |
| `apps/cli/src/commands/workflow/run.ts:140-171` | `waitForRunRegistration` now retries only a genuine `Run not found:` observation (the predicate shared with the pre-launch existing-run check, extracted as `isRunNotFound`); any other trace error propagates instead of being swallowed into a deadline. |
| `apps/cli/src/commands/workflow/run.ts:602-645` | The caller performs confirmation once and distinguishes the two observations: a deadline (`async run registration was not confirmed within <budget>ms`, worker may still be starting) and a read failure (`async run registration could not be read: <redacted>`, worker may or may not be running). Both keep the existing `{status:'failed', reason, hint}` JSON shape, omit the run id, exit non-zero, and point at `spur workflow list` then `spur workflow trace <run-id>` without recommending a replay; no synchronous replacement is launched. |
| `apps/cli/tests/commands/workflow/run.test.ts:1164-1180` | Unit contract: a non-`Run not found` failure rejects, and the final allowed observation still returns `true` (R2/R8). |
| `apps/cli/tests/commands/workflow/run.test.ts:1220-1348` | CLI contract in human and JSON modes: deadline wording (no replay advice), read-failure wording with a dropped `runs` table, and a late-registering worker — each asserting exactly one dispatch and no phantom `runId`. The two pre-existing tests that pinned the retired "failed to start or register / omit --async" wording were updated to the new contract. |
| `docs/design/cli-contracts.md:935-947` | Owning CLI contract records the absence-versus-read-error predicate, both diagnostics, the preserved JSON shape/run-id omission, and the unchanged started response + single dispatch. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R2 | MET | `apps/cli/src/commands/workflow/run.ts:140` polls only while the error is the engine's `Run not found:` and `:169` holds that single predicate (anchor re-read this run); `apps/cli/tests/commands/workflow/run.test.ts:1164` asserts a non-absence failure rejects, and `:1276` drives a dropped `runs` table to the read-failure diagnostic |
| R7 | MET | `apps/cli/src/commands/workflow/run.ts:626` builds the deadline reason from the configured budget and `:634` the guidance that the worker may still be starting with inspection commands; `apps/cli/tests/commands/workflow/run.test.ts:1220,1258` assert the human and JSON wording, run-id omission and absence of replay advice |
| R8 | MET | `apps/cli/src/commands/workflow/run.ts:645` keeps the unchanged started payload and plan stamp for a confirmed registration; `apps/cli/tests/commands/workflow/run.test.ts:1312` registers the row late and asserts `started`, the run id and exactly one dispatch |
| R9 | MET | Four regression classes in human and JSON modes with dispatch counts: eventual/late registration (`apps/cli/tests/commands/workflow/run.test.ts:1164,1312`), never registered (`:1220,1258`) and store-read error (`:1276`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC2 | MET | test | `apps/cli/tests/commands/workflow/run.test.ts:1220` (human) and `:1258` (JSON) report uncertainty and never replay; `:1312` proves a late registration still succeeds; re-run this session: `bun test tests/commands/workflow/run.test.ts` 47 pass / 0 fail |
| AC5 | MET | test | `apps/cli/tests/commands/workflow/run.test.ts:1276` reports a genuine store error separately from missing registration, and `:1312` keeps the successful-start contract with one dispatch |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1259
**Scope:** task 1259 diff — `apps/cli/src/commands/workflow/run.ts`, `apps/cli/tests/commands/workflow/run.test.ts`, `docs/design/cli-contracts.md`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | usability | The failure diagnostics omit the run id from the guidance as well as the payload, so an operator who supplied `--run-id` reads a `<run-id>` placeholder and must recover the value from `spur workflow list`. Deliberate (an unconfirmed id is not a handle), and the inspection command is named explicitly. | `apps/cli/src/commands/workflow/run.ts:634` | ACCEPTED |
| 2 | P4 (advisory) | correctness | The absence predicate is the engine's message prefix (`Run not found:`), shared with the pre-launch existing-run check. If the engine reworded that error, the poll would classify it as a read failure — a loud, non-destructive degradation (exit 1, no replay) rather than a silent one. | `apps/cli/src/commands/workflow/run.ts:169` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R2 | MET | `apps/cli/src/commands/workflow/run.ts:140-171` retries only `isRunNotFound` and rethrows everything else; `apps/cli/tests/commands/workflow/run.test.ts:1164` asserts the rejection, `:1276` drives a dropped `runs` table through the CLI and asserts the read-failure reason, the inspection hint and exactly one dispatch |
| R7 | MET | `apps/cli/src/commands/workflow/run.ts:626-642` states "not confirmed within <budget>ms" and that the worker may still be starting, keeps `{status:'failed', reason, hint}` and the run-id omission, and points at `spur workflow list`/`trace`; `apps/cli/tests/commands/workflow/run.test.ts:1220` (human) and `:1258` (JSON) assert the wording and the absence of replay advice |
| R8 | MET | A confirmed registration returns the unchanged `started` response and plan stamp (`apps/cli/src/commands/workflow/run.ts:645-655`); `apps/cli/tests/commands/workflow/run.test.ts:1312` registers the row late and asserts `status: started`, the run id and exactly one dispatch, while the failure paths assert one dispatch too |
| R9 | MET | Four regression classes: eventual/late registration (`:1164`, `:1312`), never registered (`:1220`), store-read error (`:1164`, `:1276`), in human and JSON modes with dispatch counts |

**Residual risk:** both findings are advisories; the retired wording ("async worker failed to start or register", "rerun synchronously") is now pinned by tests so it cannot return silently.

**Next:** close 1259 (`record` writes Testing from the PASS verdict; no open P1-P3).
Confidence: MEDIUM

### References

Refinement audit: 2026-10-18, source-local CLI, tasks 1254–1260 processed sequentially.

Evidence: real Git deletion probe passes; run.ts registration catch-all versus existingWorkflowRun; existing WT-4 failure/recovery contract.

Concurrency snapshot: git worktree list shows main only; task list --status wip returns []; one writer per tree. Recheck both before implementation. The tracked tree advanced to release 0.4.15 during the audit; preserve those external commits. Inspect installed versions/bundle at task start, then regenerate only artifacts affected by implementation.

Implement-ready checklist (specification, not an implementation PASS):

```json
[
  {
    "id": "requirements",
    "pass": true,
    "evidence": "Requirements contain bounded observable outcomes, scope exclusions and named current seams."
  },
  {
    "id": "design",
    "pass": true,
    "evidence": "Design freezes reused contracts, algorithm/precedence, files, negative cases and no-new-surface constraints."
  },
  {
    "id": "plan",
    "pass": true,
    "evidence": "Ordered Plan starts with failing fixtures, then minimal fix and named workspace/gate evidence."
  },
  {
    "id": "ac",
    "pass": true,
    "evidence": "Task-local checkbox ACs map every retained requirement to test-observable outcomes; implementation remains unchecked."
  },
  {
    "id": "decisions",
    "pass": true,
    "evidence": "Q&A closes original design choices; false premises and speculative APIs removed."
  },
  {
    "id": "dependencies",
    "pass": true,
    "evidence": "No unmet design prerequisites; boundaries to adjacent tasks explicit."
  },
  {
    "id": "premises",
    "pass": true,
    "evidence": "real Git deletion probe passes; run.ts registration catch-all versus existingWorkflowRun; existing WT-4 failure/recovery contract"
  }
]
```

### History

- 2026-10-19T16:33:46.830Z todo → wip (system)
- 2026-10-19T16:37:51.207Z wip → testing (system)
- 2026-10-19T16:37:53.105Z testing → done (system)

