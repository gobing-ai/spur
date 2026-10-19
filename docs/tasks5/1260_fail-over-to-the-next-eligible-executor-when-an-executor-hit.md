---
schema_version: 1
name: Fail over to the next eligible executor when an executor hits quota or auth failure
status: todo
template: issue
created_at: 2026-10-19T02:36:33.983Z
updated_at: "2026-10-19T06:38:10.980Z"

feature_id: B6
priority: P1
ac_altitude: task-local
estimate_hours: 6
dependencies: ["1255"]
---

## 1260. Fail over to the next eligible executor when an executor hits quota or auth failure

### Background

Two concrete gaps remain in an already implemented failover path. A current-tree classifyDispatch probe returns undefined for the reported failed-result text You've hit your session limit · resets 1:10am, AccountQuotaExceeded: allowance resets at 05:23 +0800, and OAuth refresh failed for openai: invalid_grant. Thus these unrecognized failures cannot enter the existing configured resource-exhaustion/auth ladder without a correlated structured event. Separately, agent-run.ts:995-1027 checks review independence before calling runTraced, while AgentRunExecutor can replace the executor internally at :666-745 without that workflow-level policy. The success writeback at agent-run.ts:1628 records canonical resolvedAgent rather than the final executor profile expected by AgentRoutingIdentity.

**Refine corrections (2026-10-18)**
- Removed the claim that no re-dispatch, next-candidate selection, attempt bound or eventing exists. AgentRunExecutor already has the escalation loop, correlated quota override, attempted set and agent.invoke.escalated/exhausted events; AgentResolver already supports same-tier different-binary resource failover followed by configured tier fallback. Existing agent-service tests cover all of these.
- Retained only the reported classification misses and preservation of existing P0/P1 independence/final routing identity across the current replacement loop. Historical wait percentages, run IDs and lost-work amounts are not re-established evidence and are removed as implementation premises.
- Removed provider-session-limit/TerminalReasonClass unions, maxExecutorFailovers config, nextUsableExecutor API, new availability events, new DB attempt fields and per-WBS failover markers. Reuse existing vocabulary, bounded attempted set, lifecycle correlation and durable partial-work artifacts.
- Removed automatic auth disable/recovery: B6 quota ownership permits only confirmed quota events; auth, transient rate/timeout and capability failures must not masquerade as quota exhaustion. 1256 retains the existing terminal-reason vocabulary.
- Removed a guarantee of model-session resume or rollback after a mid-stage failure. Existing retries share the working tree and can preserve partial edits; resuming another provider's session is not supported. No tree reset or action replay outside existing policy.
- Estimate unset → 6h. Preserve B6 link and use task-local AC. Depends on 1255 for actual-attempt model binding and capability-aware eligibility.

### Requirements

- [ ] R1. Recognize the three bounded failed-result fixtures using existing signals: session-limit and AccountQuotaExceeded → resource-exhaustion; OAuth refresh failure together with invalid_grant → auth. Successful output, incidental identifiers/quoted vocabulary, generic task failure and OS permission denials do not newly trigger these matches. Preserve existing policy opt-in; no fallback configured means no invented retry.
- [ ] R2. Feed recognized failures into the existing AgentRunExecutor loop and AgentResolver ladder. Keep attempted-executor exclusion, existing tier/same-binary policy, per-attempt capability admission, original cwd/action input and cancellation behavior. Do not introduce another retry budget or restart the workflow.
- [ ] R3. When review/verify requires distinctness, apply checkExecutorIndependence to every actual attempt's executor identity before spawn, including replacement attempts. Missing or forbidden identity fails closed. Persist __agentRouting_<node> using the final successful invocation.executor, falling back to the existing bare-agent identity only where policy allows it; use the invocation's actual model.
- [ ] R5. Reuse existing escalation/exhaustion events and failure diagnostics. Confirmed quota events still flow through the B6 ownership-scoped pipeline; auth must not emit a fabricated quota-disable. On final failure retain the existing durable partial-work artifact and nonzero outcome; 1256 owns terminal reason classification.
- [ ] R7. Hermetic service/action fixtures prove recognition-to-replacement behavior, final routing evidence, independence rejection, no-fallback/exhaustion, cancellation, permission and ordinary task-failure negatives. Save repeatable captured attempts and event evidence.

Out of scope: new provider adapters/catalogs, upstream package publication, public CLI/config/schema, changing tier/binary exclusion policy, arbitrary auth recovery, new Board/doctor surface, cross-provider session migration and automatic retries of substantive verification failures.

### Acceptance Criteria

- [ ] AC1 — Recognized refusal fixtures use the existing eligible bounded replacement path when policy allows (req: R1, R2, R7)
- [ ] AC3 — Exhaustion remains actionable and auth cannot fabricate quota availability changes (req: R5, R7)
- [ ] AC4 — Negative results do not acquire retries and every replacement preserves review independence and final routing evidence (req: R1, R2, R3, R7)

### Q&A

- Closed: failover already exists; repair its inputs and policy preservation instead of adding nextUsableExecutor/maxExecutorFailovers.
- Closed: quota and auth share routing signals only where configured; auth is not evidence for quota-owned disable/recovery.
- Closed: retain partial working-tree edits without claiming cross-provider session resume.
- Closed: 1255 is the prerequisite; terminal run reason classification stays in 1256.

### Design

Chosen: repair the existing classifier/dispatch boundary; no new public CLI, config, schema or retry framework. Add the minimum precise alternatives to FAILURE_RULES in packages/app/src/services/failure-classification.ts. Require both OAuth refresh failure and invalid_grant for the auth fixture; do not match a bare invalid_grant identifier. Keep exit-success and permission precedence. These are broad fallback signals, not the upstream confirmed-quota event classifier; do not add a duplicate quota producer.

Reuse AgentRunExecutor's currentStage policy, attemptedExecutors, quota event bridge and resolver. Thread the existing workflow independence decision through the existing execution beforeDispatch hook so it can inspect the current AgentRunInvocation (or the equivalent existing per-attempt boundary) before every spawn. Pass current attempt identity explicitly; never infer it from stale pin or model spelling. This is minimal internal callback/context plumbing, not a new public selector. Reuse checkExecutorIndependence, preserve its priority policy and fail-closed diagnostics, and do not mutate availability to enforce independence. The action's final successful __agentRouting writeback uses invocation.executor and invocation.model.

Targets: packages/app/src/services/failure-classification.ts; packages/app/src/services/agent-run-executor.ts; packages/app/src/workflow/actions/agent-run.ts; existing execution-hook types only where needed. Reuse packages/app/src/services/review-independence.ts. Tests: packages/app/tests/services/failure-classification.test.ts, packages/app/tests/services/agent-service.test.ts and packages/app/tests/workflow/actions/agent-run.test.ts, plus the existing review-independence tests. Contract owners: docs/design/workflow-execution-foundation.md for action routing/independence and docs/design/executor-availability.md for the confirmed-quota boundary; edit only changed facts.

Fixture: named implement A, reviewer B that refuses, replacement C allowed → exactly B then C in one action with final identity C. Companion B → A replacement must fail before A spawns under P0/P1. Include two named profiles sharing a binary to prove profile identity is not lost. Run fake executors against one temporary cwd with a partial-edit sentinel; no provider credentials, tree cleanup or paid calls. Keep existing routing policy rather than selecting a new candidate by a second algorithm.

Dependency 1255 must land first: it owns selected agent/model pairing and stage capability selection, including replacements. This task consumes that contract, not its implementation ownership. 1256 remains independent and owns final run reason attribution. Budget 6h.

### Plan

- [ ] 1. After 1255, add failing registry fixtures for the three reported refusal texts and precision negatives; capture current classification results (R1, R7).
- [ ] 2. Add fake-runner service/action fixtures for B → C, no fallback, exhausted pool and B → forbidden A; assert actual attempts rather than mocked selector success (R2, R3, R7).
- [ ] 3. Extend only existing classifier alternatives; carry actual-attempt invocation identity to the existing beforeDispatch policy check and correct final routing writeback (R1-R3).
- [ ] 4. Assert original cwd/input and partial-edit sentinel survive, capability checks run per attempt, cancellation stops replacement, existing events identify attempts and auth emits no quota mutation (R2, R5, R7).
- [ ] 5. Run focused app classifier/service/action/independence suites inside packages/app, affected typechecks and task-local gate. Update only changed contract text, save attempt/event receipts, review and verify these ACs. No live model calls or new retry knobs.

### Root Cause

The existing failure-classification registry lacks the three specific refusal forms above. The existing workflow independence guard runs once before the service's multi-attempt execution, so replacement can escape that guard; routing evidence also substitutes a binary identity where the existing review-independence contract calls for an executor entry name. The mechanism to retry already exists and should be corrected rather than duplicated.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Refinement audit: 2026-10-18, source-local CLI, tasks 1254–1260 processed sequentially.

Evidence: classifyDispatch reported-phrase probe; AgentRunExecutor existing ladder; review-independence.ts contract; action precheck/final writeback.

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
    "evidence": "dependencies=[1255]; execute only after 1255 is done. Spec is ready; execution precheck must currently block."
  },
  {
    "id": "premises",
    "pass": true,
    "evidence": "classifyDispatch reported-phrase probe; AgentRunExecutor existing ladder; review-independence.ts contract; action precheck/final writeback"
  }
]
```

Current-tree baseline verification: (cd packages/app && bun test tests/services/failure-classification.test.ts tests/services/agent-service.test.ts --test-name-pattern 'failure classification|in-run quota exclusion|0995') → 15 pass, 0 fail, 225 filtered. This establishes existing registry/escalation/quota behavior; the missing refusal/independence regressions remain implementation work.

### History
