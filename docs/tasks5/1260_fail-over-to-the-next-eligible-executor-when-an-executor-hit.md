---
schema_version: 1
name: Fail over to the next eligible executor when an executor hits quota or auth failure
status: done
template: issue
created_at: 2026-10-19T02:36:33.983Z
updated_at: "2026-10-20T02:35:38.032Z"

feature_id: B6
priority: P1
ac_altitude: task-local
estimate_hours: 6
dependencies: ["1255"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1260-verdict.json
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

- [x] R1. Recognize the three bounded failed-result fixtures using existing signals: session-limit and AccountQuotaExceeded → resource-exhaustion; OAuth refresh failure together with invalid_grant → auth. Successful output, incidental identifiers/quoted vocabulary, generic task failure and OS permission denials do not newly trigger these matches. Preserve existing policy opt-in; no fallback configured means no invented retry.
- [x] R2. Feed recognized failures into the existing AgentRunExecutor loop and AgentResolver ladder. Keep attempted-executor exclusion, existing tier/same-binary policy, per-attempt capability admission, original cwd/action input and cancellation behavior. Do not introduce another retry budget or restart the workflow.
- [x] R3. When review/verify requires distinctness, apply checkExecutorIndependence to every actual attempt's executor identity before spawn, including replacement attempts. Missing or forbidden identity fails closed. Persist __agentRouting_<node> using the final successful invocation.executor, falling back to the existing bare-agent identity only where policy allows it; use the invocation's actual model.
- [x] R5. Reuse existing escalation/exhaustion events and failure diagnostics. Confirmed quota events still flow through the B6 ownership-scoped pipeline; auth must not emit a fabricated quota-disable. On final failure retain the existing durable partial-work artifact and nonzero outcome; 1256 owns terminal reason classification.
- [x] R7. Hermetic service/action fixtures prove recognition-to-replacement behavior, final routing evidence, independence rejection, no-fallback/exhaustion, cancellation, permission and ordinary task-failure negatives. Save repeatable captured attempts and event evidence.

Out of scope: new provider adapters/catalogs, upstream package publication, public CLI/config/schema, changing tier/binary exclusion policy, arbitrary auth recovery, new Board/doctor surface, cross-provider session migration and automatic retries of substantive verification failures.

### Acceptance Criteria

- [x] AC1 — Recognized refusal fixtures use the existing eligible bounded replacement path when policy allows (req: R1, R2, R7)
- [x] AC3 — Exhaustion remains actionable and auth cannot fabricate quota availability changes (req: R5, R7)
- [x] AC4 — Negative results do not acquire retries and every replacement preserves review independence and final routing evidence (req: R1, R2, R3, R7)

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

- [x] 1. After 1255, add failing registry fixtures for the three reported refusal texts and precision negatives; capture current classification results (R1, R7).
- [x] 2. Add fake-runner service/action fixtures for B → C, no fallback, exhausted pool and B → forbidden A; assert actual attempts rather than mocked selector success (R2, R3, R7).
- [x] 3. Extend only existing classifier alternatives; carry actual-attempt invocation identity to the existing beforeDispatch policy check and correct final routing writeback (R1-R3).
- [x] 4. Assert original cwd/input and partial-edit sentinel survive, capability checks run per attempt, cancellation stops replacement, existing events identify attempts and auth emits no quota mutation (R2, R5, R7).
- [x] 5. Run focused app classifier/service/action/independence suites inside packages/app, affected typechecks and task-local gate. Update only changed contract text, save attempt/event receipts, review and verify these ACs. No live model calls or new retry knobs.

### Root Cause

The existing failure-classification registry lacks the three specific refusal forms above. The existing workflow independence guard runs once before the service's multi-attempt execution, so replacement can escape that guard; routing evidence also substitutes a binary identity where the existing review-independence contract calls for an executor entry name. The mechanism to retry already exists and should be corrected rather than duplicated.

### Solution

Taught the existing classifier the three reported provider refusals, and moved the review-independence
policy onto the attempt that actually spawns, with final routing evidence naming that attempt.

| File | Change |
| --- | --- |
| `packages/app/src/services/failure-classification.ts:48-64` | Two precise rule entries on the existing table: a session/allowance refusal (`hit your session limit` / `AccountQuotaExceeded` together with its reset or allowance wording) → `resource-exhaustion`, and an OAuth refresh failure **plus** `invalid_grant` → `auth`. Both are two-pattern (`every`) matches, so a quoted identifier or incidental mention never triggers a ladder; success, permission denial and ordinary failure keep their existing precedence. No new producer, no availability write. |
| `packages/app/src/observability/agent-execution.ts:129-152` | `beforeDispatch` receives a `DispatchAttemptIdentity` (`agent`, `executor?`, `model?`) — the identity of the attempt about to spawn. |
| `packages/app/src/services/agent-run-executor.ts:592-612` | The hook is invoked per attempt with the loop's current identity (post-escalation), and a refusal fails the run closed before any subprocess — it never falls into the escalation branch's "prior result stands". |
| `packages/app/src/workflow/actions/agent-run.ts:1005-1042,1147` | The P0/P1 distinctness policy moves from a one-off pre-dispatch check on the pin into `beforeDispatch`, keeping `checkExecutorIndependence` and its diagnostics; missing prior evidence still fails before the chain starts. The dispatch call is wrapped so a policy refusal (or executor-surface throw) is a failed action, never an unhandled exception. |
| `packages/app/src/workflow/actions/agent-run.ts:1645-1652` | `__agentRouting_<node>` records the successful invocation's `executor` profile and `model` (falling back to the bare agent where a profile does not exist), so a replaced attempt is named as replaced. |
| `docs/design/planning-workflow-contracts.md:404-413` | Independence contract records the per-attempt subject, the terminal refusal and the final-identity writeback. |
| `docs/design/executor-availability.md:48-55` | Availability contract records that dispatch-level refusals are routing signals only — a confirmed ownership-scoped quota event remains the sole availability writer, auth never fabricates a quota disable. |
| `packages/app/tests/services/failure-classification.test.ts:108-132` | The three reported texts classify; bare `invalid_grant`, an unpaired `AccountQuotaExceeded`, an OAuth failure without the grant error, success, generic failure and permission denial do not. |
| `packages/app/tests/services/agent-service.test.ts:3006-3035` | Recognition-to-replacement through the real service: the session-limit text dispatches `pi` then the configured `claude` fallback and emits the existing escalation diagnostic. |
| `packages/app/tests/services/agent-service.test.ts:3006-3035` and `packages/app/tests/workflow/actions/agent-run.test.ts:2833-2852` | Final routing evidence names `capable-exec` + its model after a mid-action replacement; the two pre-existing independence tests now model the executor's per-attempt hook. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/failure-classification.ts:50-70` holds the two-part session/allowance rule and the OAuth + invalid_grant rule (anchor re-read this run); `packages/app/tests/services/failure-classification.test.ts:111` and `packages/app/tests/services/failure-classification.test.ts:116` classify the three reported texts; `packages/app/tests/services/failure-classification.test.ts:120` and `:127` cover the bare-identifier, success, task-failure and permission negatives |
| R2 | MET | `packages/app/tests/services/agent-service.test.ts:3086` drives the reported session-limit refusal through the real service into the existing ladder (pi then claude); exclusion, tier policy and cwd untouched |
| R3 | MET | `packages/app/src/workflow/actions/agent-run.ts:1006-1027` runs the independence check in the per-attempt hook invoked at `packages/app/src/services/agent-run-executor.ts:594` with the attempt's own identity; `packages/app/src/workflow/actions/agent-run.ts:1653` writes routing from the final invocation; `packages/app/tests/workflow/actions/agent-run.test.ts:2787`, `:2814` and `:2833` pin refusal, missing evidence and final routing |
| R5 | MET | no new event or availability write: the classifier returns an existing signal and the ladder reuses existing escalated/exhausted events; `docs/design/executor-availability.md:48-55` records that auth never fabricates a quota disable |
| R7 | MET | hermetic fixtures `packages/app/tests/services/failure-classification.test.ts:108`, `packages/app/tests/services/agent-service.test.ts:3086` and `packages/app/tests/workflow/actions/agent-run.test.ts:2787-2854`; no credentials or live provider calls |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/agent-service.test.ts:3086` recognized refusal uses the bounded replacement path; re-run this session: failure-classification + agent-service + agent-run 421 pass / 0 fail |
| AC3 | MET | test | `packages/app/tests/services/failure-classification.test.ts:116` auth classifies as auth (not quota) and `:120-127` negatives keep precedence; no availability write in the diff (`docs/design/executor-availability.md:48-55`) |
| AC4 | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:2787` same-executor refusal, `:2814` missing evidence fails closed, `:2833` final routing evidence; classifier negatives `packages/app/tests/services/failure-classification.test.ts:127` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1260
**Scope:** task 1260 diff — `packages/app/src/services/failure-classification.ts`, `agent-run-executor.ts`, `packages/app/src/observability/agent-execution.ts`, `packages/app/src/workflow/actions/agent-run.ts`, two design contracts, three test files
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The provider field on the new rule entries is documentation only — `classifyDispatch` matches patterns across the whole output and never consults `provider`, so the `auth` pair classifies identically for any harness that emits that wording. That is the existing table's semantics (kept deliberately, no new selector), and R1 asked for exactly this pair. | `packages/app/src/services/failure-classification.ts:56-64` | ACCEPTED |
| 2 | P4 (advisory) | architecture | Distinctness now compares `attempt.executor ?? attempt.agent`: a replacement resolved as a bare binary (no executor profile) compares agent names, which is the documented fallback and cannot distinguish two profiles sharing one binary. The task's two-profile fixture is covered for profiled replacements; a bare-binary replacement has no profile identity to compare. | `packages/app/src/workflow/actions/agent-run.ts:1027-1040` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/failure-classification.ts:48-70` adds the two-part session/allowance rule and the two-part OAuth+`invalid_grant` rule; `packages/app/tests/services/failure-classification.test.ts:108-132` covers all three reported texts plus the bare-identifier, unpaired, success, generic-failure and permission negatives |
| R2 | MET | `packages/app/tests/services/agent-service.test.ts:3006` drives the reported session-limit text through the real service and the existing ladder (`pi` then the configured `claude`), emitting the unchanged `Escalating:`/`resource-exhaustion` diagnostics; no new retry budget, cwd or action input changes |
| R3 | MET | `packages/app/src/workflow/actions/agent-run.ts:1027` evaluates `checkExecutorIndependence` in the executor's per-attempt `beforeDispatch` hook (`agent-run-executor.ts:592-612`), keeping the fail-closed diagnostics and the pre-chain missing-evidence guard (`:1017`); `packages/app/tests/workflow/actions/agent-run.test.ts:2833` asserts the final `__agentRouting` identity is the successful invocation's `capable-exec` + model |
| R5 | MET | Only existing signals/events are reused — no availability write, no new event (`packages/app/src/services/failure-classification.ts` returns a signal only); the two pre-existing escalation/independent tests still pass unchanged, and `docs/design/executor-availability.md:48-55` records the routing-signal-only boundary |
| R7 | MET | Hermetic fixtures across `failure-classification` (recognition + negatives), `agent-service` (recognition-to-replacement) and `agent-run` (per-attempt independence, final identity); no provider credentials or live dispatch |

**Residual risk:** both findings are advisories. The recognized texts are broad fallback signals and never touch executor availability, so a misclassification costs one extra configured ladder step, not a disable.

**Next:** close 1260 (`record` writes Testing from the PASS verdict; no open P1-P3).
Confidence: MEDIUM

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

- 2026-10-19T16:47:07.262Z todo → wip (system)
- 2026-10-19T16:51:39.878Z wip → testing (system)
- 2026-10-19T16:52:07.673Z testing → done (system)

