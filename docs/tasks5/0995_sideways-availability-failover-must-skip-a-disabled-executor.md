---
schema_version: 1
name: Sideways availability failover must skip a disabled executor
status: todo
template: issue
created_at: 2026-09-28T23:16:57.820Z
updated_at: "2026-09-28T23:17:39.565Z"
feature_id: B21

ac_altitude: task-local
---

## 0995. Sideways availability failover must skip a disabled executor

### Background

Found during the task 0982 implementation (2026-09-28) and recorded as review finding P3 there; not fixed because 0982's R3 required decisions and ordering to be unchanged and the site was outside its three-read scope.

`AgentService.resolveStageModelPolicy` has two candidate paths for a `resource-exhaustion` signal. The **sideways availability failover** (the `signal === 'resource-exhaustion' && fromExecutor !== undefined` block in `packages/app/src/services/agent-service.ts`) selects a same-tier executor on a different binary:

```ts
const sideways = executors.filter((e) => {
    const canonical = resolveAgentName(e.agent);
    return (
        e.name !== fromExecutor &&
        getExecutorTier(e) === failedTier &&
        canonical !== failedCanonical &&
        (canonical === undefined || !exhaustedAgents.has(canonical)) &&
        !(exclude?.has(e.name) ?? false)
    );
});
```

It never consults `executorDisabled`, so a **disabled** same-tier profile is a candidate and can be dispatched. The fallback-tier path immediately below is correct: it now starts from `cheapestEligibleExecutors` (which filters `!executorDisabled`) and applies only the local exclusions.

Evidence (0982 session, `packages/app/tests/services/agent-service.test.ts`): a first draft asserted `['pi', 'claude']` for a config with `{ name: 'std-disabled', agent: 'codex', tier: 'standard', disabled: true }` beside `std-exec`/`capable-exec`; the run dispatched `codex` — `Received: ["pi", "codex"]`. The draft was retargeted at the fallback-tier path to keep 0982 behavior-preserving, leaving this open.

### Requirements

- [ ] R1. The sideways availability failover candidate filter excludes disabled executors (`executorDisabled`).
- [ ] R2. The failover's semantics beyond that filter are unchanged: same tier, different binary, not the failed executor, not an exhausted binary, not excluded, and array order.
- [ ] R3. A regression test pins a disabled same-tier candidate being skipped (and a live same-tier candidate still being chosen), so the hole cannot reopen.

### Acceptance Criteria

- [ ] AC1 — A disabled same-tier, different-binary executor is never dispatched on a resource-exhaustion failover (req: R1)
- [ ] AC2 — An eligible same-tier candidate is still chosen, in array order, and the existing failover/exhaustion tests pass unchanged (req: R2)
- [ ] AC3 — The regression test fails against the current filter and passes with the fix (req: R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Add `!executorDisabled(e)` to the sideways candidate predicate in `resolveStageModelPolicy` (one term, beside the existing `!(exclude?.has(e.name) ?? false)`). `executorDisabled` is already imported in the file. No other change: the loop, the usability probe and the fallback-tier hand-off stay as they are.

Test direction: in `packages/app/tests/services/agent-service.test.ts`, drive `escalationHarness` with a standard-tier `disabled: true` profile sharing the failed binary's successor slot and assert it is never dispatched while a live same-tier profile is. The existing `R1: a timeout on the starting tier escalates…` and the 0485 sideways cases are the behavior lock.

### Plan

- [ ] Add the `executorDisabled` term to the sideways filter.
- [ ] Add the regression test (disabled candidate never dispatched; live candidate still chosen) and confirm it fails before the fix.
- [ ] Run `(cd packages/app && bun test tests/services/agent-service.test.ts tests/services/executor-tier.test.ts tests/services/fleet-service.test.ts)` and `bun run spur-check`.

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
