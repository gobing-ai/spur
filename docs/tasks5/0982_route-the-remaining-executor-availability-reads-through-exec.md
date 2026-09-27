---
schema_version: 1
name: Route the remaining executor-availability reads through executorDisabled
status: backlog
template: feature-impl
created_at: 2026-09-27T07:11:11.665Z
updated_at: "2026-09-27T07:11:50.958Z"
feature_id: B21

ac_numbering: task-local
ac_altitude: task-local
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

### Requirements

- [ ] R1. Every enablement/eligibility decision in `agent-service.ts` classifies availability through `executorDisabled`; a site that genuinely needs the full availability object (e.g. the doctor report at `:2949`) keeps the object read and carries a one-line justification naming why the boolean would lose information.
- [ ] R2. No behaviour change: identical decisions for the boolean form, the `{owner,since,reason}` object form, and `undefined`/absent `disabled`.
- [ ] R3. `rg -n "normalizeExecutorAvailability\(" packages/app/src/services/agent-service.ts` yields only justified object-reporting sites, and the justification is a source comment at each one.

### Acceptance Criteria

- [ ] AC1 — R1 — classification sites route through `executorDisabled` or carry an in-place justification (`rg` probe pasted into Testing) (command)
- [ ] AC2 — R2 — `bun run spur-check` green, including the existing `agent-service` / `fleet-service` suites, with no assertion changes (test)
- [ ] AC3 — R3 — each remaining direct read names its reason in a comment (static-ref)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

- [ ] Read each listed site and decide boolean-reader vs object-need; convert the enablement decisions (`:569`, `:636`, `:712`) to `executorDisabled`, and keep `:452`/`:2949` only with a justification comment (or convert them too if the object is unused downstream).
- [ ] Re-point the imports if `normalizeExecutorAvailability` becomes unused in the file (Biome flags it).
- [ ] Run `(cd packages/app && bun test tests/services/agent-service.test.ts tests/services/fleet-service.test.ts)` and `bun run spur-check`.
- [ ] Paste the `rg` probe + suite results into `## Testing`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
