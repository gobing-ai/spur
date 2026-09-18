---
schema_version: 1
name: Harden capability gating boundaries and coverage from B8 review findings
status: backlog
template: feature-impl
created_at: 2026-09-18T04:26:57.446Z
updated_at: "2026-09-18T04:29:03.068Z"
feature_id: B8

---

## 0898. Harden capability gating boundaries and coverage from B8 review findings

### Background

Source: session review triage of the B8 batch run `ce44b029` (2026-09-17). Both B8 tasks (0888, 0889) are done and landed on main (`bb4147e99`); this task carries the report-only advisories that survived review `bd02c82d` and verify `fa90ae14`.

Already resolved elsewhere, excluded from scope: design-anchor supersession folded into batch commit `b6a029d49` (`docs/design/session-pinned-dispatch.md:15`); nested `plugins/**/.spur` gitignore gap fixed in `bb4147e99`; R5-letter-vs-JSON stderr contract resolved in favor of the architectural contract (documented in the 0889 verify answer). Out-of-scope pointer: the upstream test seam for stubbing the capability record lives in ts-libs (`src/agents/shims.ts:464`); changing it is an upstream release-train decision, not this task.

### Requirements

- [ ] R1. Pre-spawn contract violation for `continue: true` against an agent whose capability record has `resumeSupported: false` — today the input guard exempts `continue` from requiring `input`, so the request passes gating and fails late inside the shim with a generic dispatch error. Source: 0889 review P4 #1 (`.spur/run/ce44b029-c9f6-48d5-9bfc-2a423597c5c3-review-answer.txt`).
- [ ] R2. Dedicated unit tests for `evaluateSessionCapabilities` (`packages/app/src/services/capability-attestation.ts`): fail-closed deny matrix, unknown/undeclared axis, stale-record path. Coverage today is indirect only, via three agent-run action tests. Source: 0889 verify P4.
- [ ] R3. Commands-layer coverage for the doctor capability surface — CAPS column and `capabilityStale`/`capability-declaration-stale` assertions at the `apps/cli/tests/commands/` level, per the R5/R6 letter in the 0889 verify answer (P3). Current coverage: service-layer tests plus config-layering exact-stderr only.

### Acceptance Criteria

- AC1. Dispatching with `continue` (CLI or workflow action) against a not-resume-capable agent record fails pre-spawn with an ADR-118 `contractViolation` naming the session axis; a regression test encodes the contract. [test, command]
- AC2. A new capability-attestation unit test file covers deny-by-default, unknown axis, and stale record; `bun test` passes in `packages/app`. [test]
- AC3. A commands-layer doctor test asserts capability columns and staleness stderr; the existing config-layering exact-two-line assertion is unchanged. [test]
- AC4. `bun run spur-check` green. [command]

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
