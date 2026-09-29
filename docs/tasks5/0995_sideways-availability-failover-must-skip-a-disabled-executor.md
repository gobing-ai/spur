---
schema_version: 1
name: Sideways availability failover must skip a disabled executor
status: done
template: issue
created_at: 2026-09-28T23:16:57.820Z
updated_at: "2026-09-29T00:18:46.938Z"
feature_id: B21

ac_altitude: task-local
priority: P2
ac_numbering: task-local
estimate_hours: 2
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

- [x] R1. The sideways availability failover candidate filter excludes disabled executors (`executorDisabled`).
- [x] R2. The failover's semantics beyond that filter are unchanged: same tier, different binary, not the failed executor, not an exhausted binary, not excluded, and array order.
- [x] R3. A regression test pins a disabled same-tier candidate being skipped (and a live same-tier candidate still being chosen), so the hole cannot reopen.

### Acceptance Criteria

- [x] AC1 — A disabled same-tier, different-binary executor is never dispatched on a resource-exhaustion failover (req: R1)
- [x] AC2 — An eligible same-tier candidate is still chosen, in array order, and the existing failover/exhaustion tests pass unchanged (req: R2)
- [x] AC3 — The regression test fails against the current filter and passes with the fix (req: R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Add `!executorDisabled(e)` to the sideways candidate predicate in `resolveStageModelPolicy` (one term, beside the existing `!(exclude?.has(e.name) ?? false)`). `executorDisabled` is already imported in the file. No other change: the loop, the usability probe and the fallback-tier hand-off stay as they are.

Test direction: in `packages/app/tests/services/agent-service.test.ts`, drive `escalationHarness` with two same-tier, different-binary profiles beside the failed one — one `disabled: true`, one live — and assert that on a `resource-exhaustion` signal only the live profile is dispatched (the disabled one never appears in `runPromptCommand.mock.calls`). The existing `R1: a timeout on the starting tier escalates…` and the 0485 sideways cases are the behavior lock.

Pick the fixture agents so the sideways filter is actually reachable: both candidates must share the failed executor's tier, differ from its binary, and not already be in `exclude`/the exhausted set.

### Plan

- [x] Add the `executorDisabled` term to the sideways filter.
- [x] Add the regression test (disabled candidate never dispatched; live candidate still chosen) and confirm it fails before the fix.
- [x] Run `(cd packages/app && bun test tests/services/agent-service.test.ts tests/services/executor-tier.test.ts tests/services/fleet-service.test.ts)` and `bun run spur-check`. Result 2026-09-28: focused suites 265 pass / 0 fail; `bun run spur-check` lint + typecheck + 49 rules pass, tests 9391 pass / 1 fail — the one failure is `apps/cli/tests/commands/feature.test.ts` fixture `git init`, blocked by the agent sandbox (nested `.git/` write denied), file untouched by this task.

### Root Cause

`resolveStageModelPolicy` (`packages/app/src/services/agent-service.ts`) selects a failover candidate on two paths. The **fallback-tier** path was corrected (0982) to start from `cheapestEligibleExecutors`, which filters `!executorDisabled`. The **sideways availability-failover** path keeps its own inline predicate and never gained the disable term:

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

The term is missing because this path predates the 0890 rule ("every eligibility/probe/inventory site branches on `executorDisabled`") and was outside 0982's three-read scope — 0982's R3 required decisions and ordering to be unchanged, so the draft that exposed it was retargeted at the fallback-tier path instead.

The rule is enforced where the extracted helper is used, not at this inline filter, so nothing failed. Reproduced in the 0982 session: with `{ name: 'std-disabled', agent: 'codex', tier: 'standard', disabled: true }` beside `std-exec`/`capable-exec`, a resource-exhaustion signal dispatched `codex` (`Received: ["pi", "codex"]`).

### Solution

| Change (`file:line`) | Rationale |
|---|---|
| `packages/app/src/services/agent-service.ts:2031` | The sideways availability failover filter now starts with `!executorDisabled(e)`, matching the fallback-tier path's `cheapestEligibleExecutors`. All other predicates and array order unchanged. |
| `packages/app/tests/services/agent-service.test.ts:3160` | Regression: a disabled same-tier different-binary executor listed first is skipped; the first live same-tier candidate (`claude`) wins over a later one. Fails before the fix (`Received: ["pi", "codex"]`). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-service.ts:2031` `!executorDisabled(e)` leads the sideways availability failover filter; `packages/app/tests/services/agent-service.test.ts:3160` |
| R2 | MET | Remaining predicates unchanged at `packages/app/src/services/agent-service.ts:2032-2036`; `packages/app/tests/services/agent-service.test.ts:3108` still dispatches `['pi', 'claude', 'codex']`; `(cd packages/app && bun test tests/services/agent-service.test.ts tests/services/executor-tier.test.ts tests/services/fleet-service.test.ts)` → 265 pass / 0 fail (re-run 2026-09-28) |
| R3 | MET | `packages/app/tests/services/agent-service.test.ts:3160` re-proven red this run with line 2031 removed (1 fail, Received `["pi", "codex"]`), green with it restored |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/agent-service.test.ts:3160` disabled `codex` same-tier candidate listed first is never dispatched |
| AC2 | MET | test | `packages/app/tests/services/agent-service.test.ts:3160` first live `claude` chosen over later `gemini`; `packages/app/tests/services/agent-service.test.ts:3108` unchanged and passing; focused suites 265 pass / 0 fail |
| AC3 | MET | test | `packages/app/tests/services/agent-service.test.ts:3160` fails with `packages/app/src/services/agent-service.ts:2031` removed, passes with it (re-proven this run) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Sideways failover block: `packages/app/src/services/agent-service.ts` (`resolveStageModelPolicy`, the `signal === 'resource-exhaustion' && fromExecutor !== undefined` branch)
- Behavior lock: `packages/app/tests/services/agent-service.test.ts` — `R1: a timeout on the starting tier escalates by the declared chain…`, `0485 R3+R4: exhaustion fails over sideways to a same-tier different-binary executor…`
- Sibling selection path (correct model to copy): the fallback-tier block directly below, `cheapestEligibleExecutors` in `packages/app/src/services/executor-tier.ts`
- Related tasks: 0890 (availability ownership rule, feature B6), 0965 (extracted `executor-tier.ts`, B21), 0982 (routed the remaining reads through `executorDisabled`, B21 — commit `cd2f0572f`; this hole was its review finding P3)

### History

- 2026-09-28T23:43:11.326Z todo → wip (system)
- 2026-09-28T23:50:54.658Z wip → testing (system)
- 2026-09-28T23:50:54.994Z testing → done (system)

