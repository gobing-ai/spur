---
schema_version: 1
name: Fail over to the next eligible executor when an executor hits quota or auth failure
status: todo
template: issue
created_at: 2026-10-19T02:36:33.983Z
updated_at: "2026-10-19T02:41:30.047Z"

feature_id: B6
---

## 1260. Fail over to the next eligible executor when an executor hits quota or auth failure

### Background

Every provider failure in the D66 batch (2026-10-18) ended the whole run instead of moving to the next eligible executor. Measured cost: of 19 h 14 m elapsed, roughly 47 % was operator wait, most of it waiting for a quota window to reopen (8 h 58 m total wait; three separate walls).

**Observed failures, one class each.**

| Run | Executor | Error | Restart cost |
| --- | --- | --- | --- |
| `03d1ebe0` | `claude` | `You've hit your session limit · resets 1:10am` after 21 m of implement | 21 m of work preserved, task re-implemented next run |
| `8c7375e3` | `claude` | same limit at `remediate` (192 s in) | run dead at remediation |
| `2503d88c` | `claude` | same limit, resets 8pm | 19 m implement lost to a sync re-run |
| `7d19fd81` | `pi-dsv4.1-flash-volc` | provider `Request timed out` (42 s) | retried by hand |
| `(1250 run)` | `pi-dsv4.1-flash-volc` | `AccountQuotaExceeded … resets at 05:23 +0800` after 24 s | batch halted |
| `cdc15aa1` | `pi-sol` | `OAuth refresh failed for openai … invalid_grant` (5 s) | run dead |
| `grok-4.7` | `grok` | quota disabled itself mid-batch (`agent.quota.exhausted`) | executor unusable, not reported to the running batch |

**Why nothing fails over.** The dispatch path treats a provider refusal as an ordinary action failure: `agent-run.ts` returns failure, the state machine routes to `failed` (or burns the remediation budget), and `classifyTerminalReason` books it as a run failure (see 1256). There is no re-dispatch, no "next eligible executor" query, and no event telling the batch that an executor left the pool. The only recovery is the operator relaunching with a different `--agent`, which restarts the stage from scratch.

**Boundary.** 1255 fixes *resolution* correctness (agent+model pairing, attestation-aware usability). This task adds *runtime* failover once resolution is correct — do not fix one by weakening the other. 0942/ADR-126 already ships a fleet executor and B6 owns the availability lifecycle (disable ownership, recovery, usage producer), so the failover consumer belongs there.

### Requirements

- [ ] R1. A dispatch refusal is classified before it becomes a run failure: `provider-quota` | `provider-auth` | `provider-session-limit` | `timeout` | `capability`. Classification is exhaustive and typed (shared with 1256's reason classes).
- [ ] R2. On a classified provider refusal the runner asks the executor registry for the next eligible executor for the same role and tier — capability-attested, not disabled, not the failed one — and re-dispatches the *same* action with that spec.
- [ ] R3. The re-dispatch preserves stage semantics: `review`/`verify` still resolve a different executor than `implement` (0710 R4); the run's `__agentRouting_*` records the switch; at most `maxExecutorFailovers` (default 2) switches per run.
- [ ] R4. A stage whose work is tree-mutating (`implement`, `remediate`) records a failover marker with the partial artifact path so the next attempt resumes from that tree rather than restarting silently; the attempt count is visible in the run log and on the run row.
- [ ] R5. When no eligible executor remains, the run fails with the reason naming every attempted executor and its class — never a generic failure, never `failed-check` (1256).
- [ ] R6. An `agent.executor` availability event (B6's vocabulary) fires on failover, so the batch, the Board and `agent doctor` see the executor leave the pool.
- [ ] R7. A regression test per class drives one refusal and asserts a second executor is dispatched with the same action input and an incremented attempt marker; a test with no eligible executor asserts the named reason.

### Acceptance Criteria

- [ ] AC1 — A provider refusal re-dispatches the same action on the next eligible attested executor, within a bounded budget (req: R1, R2, R3)
- [ ] AC2 — Tree-mutating stages resume from their partial artifact and record the switch (req: R4)
- [ ] AC3 — With no eligible executor left, the run fails naming every attempt and its class, and availability is reported to B6's consumers (req: R5, R6)
- [ ] AC4 — Each failure class has a regression test, including the exhausted case (req: R7)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Chosen: failover at the dispatch boundary, owned by the availability lifecycle.**
1. **Classify** (R1) in `agent-run.ts`'s error path from what the CLI reported: the existing `errorClass` field where present, structured error text otherwise. Reuse 1256's `TerminalReasonClass` union so the two cannot drift.
2. **Select** (R2): a registry query `nextUsableExecutor(role, minTier, { exclude, requireCapabilities })` — the same predicate 1255 introduces for resolution, so failover and resolution share one definition of "usable".
3. **Re-dispatch** (R3): re-enter the action's dispatch with the new spec inside the same run; the engine's action is retried, not the run. Guard the P1 distinct-executor rule by passing the excluded spec set (the implement spec) into the selection.
4. **Resume semantics** (R4): the existing partial-work artifact (`writePartialWorkArtifact`, `agent-run.ts:1285`) already captures the tree at failure; the failover path reads it and passes the path into the next attempt's input, plus a `.spur/run/<wbs>-executor-failover-<n>.json` marker for auditability.
5. **Eventing** (R6): emit on B6's channel; B6's recovery consumer will re-enable the executor when quota returns.

**Rejected.**
- Retrying the same executor (the refusal is not transient).
- Restarting the run (`spur workflow run` again): loses the state machine's progress and re-runs the gate.
- Silent global "use whatever works" fallback: it breaks the distinct-executor policy and hides availability from the operator.
- Doing failover inside `cheapestEligibleExecutors`: selection is a pure function; retry is control flow.

**Frozen names.** `maxExecutorFailovers` (var, default 2); `executorFailover` run-log event; `.spur/run/<wbs>-executor-failover-<n>.json`; `nextUsableExecutor()`.

**File targets.** `packages/app/src/workflow/actions/agent-run.ts` (error path ~:1459-1500, dispatch ~:688-720); `packages/app/src/services/executor-tier.ts` (shared predicate with 1255); `packages/app/src/services/agent-service.ts` (`resolveRoleFresh`); availability events in `packages/app/src/services/agent-quota-events.ts`; `config/workflows/task-pipeline.yaml` vars (`maxExecutorFailovers`); tests `packages/app/tests/workflow/actions/agent-run.test.ts`, `packages/app/tests/services/executor-tier.test.ts`, an E2E under `apps/cli/tests/commands/workflow/`.

**Anti-patterns.** No failover on a substantive task failure (a red gate, a FAIL verdict) — only on provider/availability refusals. No model translation between CLIs (1255 R3). Never let a failover silently satisfy the distinct-executor rule with the same spec.

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
