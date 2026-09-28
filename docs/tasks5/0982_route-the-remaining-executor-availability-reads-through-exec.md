---
schema_version: 1
name: Route the remaining executor-availability reads through executorDisabled
status: done
template: feature-impl
created_at: 2026-09-27T07:11:11.665Z
updated_at: "2026-09-28T23:29:26.925Z"
feature_id: B21

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 2
---

## 0982. Route the remaining executor-availability reads through executorDisabled

### Background

Task 0965 extracted the executor-tier policy into the leaf module `packages/app/src/services/executor-tier.ts` (`AgentExecutorConfig`, `executorDisabled`, `getExecutorTier`, `cheapestEligibleExecutors`) and re-pointed `fleet-service.ts` / `history-service.ts` at it. The 0965 review recorded one deliberately unfixed residue (finding P4-2, advisory): the 0890 rule — "every eligibility/probe/inventory site branches on `executorDisabled` instead of comparing the raw `disabled` field" — still holds only where the moved helper is used.

Direct `normalizeExecutorAvailability(...)` reads remain in `packages/app/src/services/agent-service.ts`:

| Site | Current read | Note |
| --- | --- | --- |
| `:452` | `normalizeExecutorAvailability(entry.disabled)` | returns the availability object for a lookup — review whether the boolean reader or the object is the honest need |
| `:569` | `!normalizeExecutorAvailability(e.disabled).disabled` | enablement filter — classifies availability |
| `:636` | `normalizeExecutorAvailability(e.disabled).disabled && …` | enablement filter |
| `:712` | `normalizeExecutorAvailability(e.disabled).disabled` | executor-level gate |
| `:2949` | `normalizeExecutorAvailability(executor.disabled)` | doctor report field — legitimately needs the full object |

A second, larger observation from the same review (`agent-service.ts:2124-2133` keeps its own eligible-executor filter adding `exclude`/`exhaustedAgents` predicates on top of `executorDisabled` + `getExecutorTier` + `isTierEligible`) needs a design decision and is explicitly **out of scope** here — 0965 deliberately changed no behaviour.

**Refine corrections (2026-09-27)**

- The earlier out-of-scope inline tier selector duplicates `cheapestEligibleExecutors`; it is now included with the boolean availability reads.

### Requirements

- [x] R1. Every boolean enablement decision in `agent-service.ts` uses `executorDisabled`. Full availability-object reads remain only where callers use owner/since/reason metadata.
- [x] R2. The resource-exhaustion selection path obtains tier-filtered, tier-sorted candidates from `cheapestEligibleExecutors`, then applies its local `exclude` and exhausted-agent filters. No second tier-selection/sort funnel remains.
- [x] R3. Decisions and ordering are unchanged for boolean, object and absent `disabled`, including excluded and exhausted candidates.

### Acceptance Criteria

- [x] AC1 — Boolean availability decisions use the shared helper; object consumers keep their metadata (req: R1)
- [x] AC2 — Resource-exhaustion selection uses the shared tier funnel and preserves local exclusions (req: R2, R3)
- [x] AC3 — Focused agent/fleet tests and the task gate pass (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Replace the three boolean `normalizeExecutorAvailability(...).disabled` reads with `executorDisabled`. Keep the availability-object lookup and doctor report as object reads because their callers use metadata, without adding comments that merely repeat the type.

At the resource-exhaustion path, start with `cheapestEligibleExecutors(executors, targetTier)`, then apply the existing `exclude` and exhausted-agent predicates. This reuses the helper's disabled filtering and ascending tier order while keeping the stage-specific exclusions local. Check stable ordering and unknown-agent handling with focused tests. This closes both parts of 0965 review finding P4-2 rather than leaving its inline tier funnel behind.

### Plan

- [x] Trace each direct availability read and the resource-exhaustion selection callers.
- [x] Replace boolean reads and use `cheapestEligibleExecutors` in the selection path, preserving exclusions and ordering.
- [x] Test boolean/object/absent disabled forms, excluded/exhausted candidates and unknown-agent behavior.
- [x] Run focused agent/fleet suites and `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/agent-service.ts:2118` |
| `packages/app/src/services/agent-service.ts:2122` |
| `packages/app/src/services/agent-service.ts:2130` |
| `packages/app/src/services/agent-service.ts:569` |
| `packages/app/src/services/agent-service.ts:634` |
| `packages/app/src/services/agent-service.ts:707` |
| `packages/app/tests/services/agent-service.test.ts:3727` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-service.ts:569`, `packages/app/src/services/agent-service.ts:634`, `packages/app/src/services/agent-service.ts:707` use `executorDisabled`; remaining object reads `packages/app/src/services/agent-service.ts:452` (availability lookup) and `packages/app/src/services/agent-service.ts:2939` (doctor report) consume owner/since/reason |
| R2 | MET | `packages/app/src/services/agent-service.ts:2120` starts from `cheapestEligibleExecutors(executors, targetTier)` then applies only `exclude`/exhausted-agent predicates; inline tier filter + `TIER_RANK` sort removed (cd2f0572f) |
| R3 | MET | `packages/app/src/services/executor-tier.ts:68` funnel = removed inline filter + stable ascending sort; `packages/app/tests/services/executor-tier.test.ts:52` boolean/object forms, `packages/app/tests/services/executor-tier.test.ts:56` absent, `packages/app/tests/services/agent-service.test.ts:3108` excluded + exhausted-agent siblings skipped with order `['pi','claude','codex']` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/executor-tier.test.ts:75` both disabled forms filtered; doctor availability object preserved at `packages/app/src/services/agent-service.ts:2939` |
| AC2 | MET | test | `packages/app/tests/services/agent-service.test.ts:3727` disabled fallback skipped by the shared funnel; `packages/app/tests/services/agent-service.test.ts:3108` local exclusions preserved |
| AC3 | MET | command | `(cd packages/app && bun test tests/services/agent-service.test.ts tests/services/executor-tier.test.ts tests/services/fleet-service.test.ts tests/services/agent-quota-updates.test.ts tests/services/agent-roles.test.ts)` → 298 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T16:45:14.026Z backlog → todo (system)
- 2026-09-28T22:16:01.316Z todo → wip (system)
- 2026-09-28T22:16:01.797Z wip → testing (system)
- 2026-09-28T22:16:02.817Z testing → done (system)

