---
schema_version: 1
name: Make the guard-parity harness enumerate both reference sets and catch spurious dependency edges
status: done
template: feature-impl
created_at: 2026-09-17T17:41:13.770Z
updated_at: "2026-09-17T19:02:35.504Z"
feature_id: D62

---

## 0881. Make the guard-parity harness enumerate both reference sets and catch spurious dependency edges

### Background

Captured from the creation title: "Make the guard-parity harness enumerate both reference sets and catch spurious dependency edges".

### Requirements

- `plugins/sp/scripts/inline-pipeline-parity-check.ts` enumerates state from the pre-refactor reference set as well as the post-refactor one, so removing a reference cannot escape parity.
- An over-declared (spurious) `dependencies[]` edge is caught rather than silently unbound — post-0875 dependency edges no longer move the planning digest (`packages/app/src/services/task-readiness.ts:405`).

### Acceptance Criteria

- Harness test: deleted reference is caught; spurious `dependencies[]` edge is caught.
- `bun run spur-check` green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:14` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:264` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:291` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:58` |
| `plugins/sp/tests/inline-pipeline-parity-check.test.ts:57` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Both reference sets enumerated: `plugins/sp/scripts/inline-pipeline-parity-check.ts` parses markdown reference kinds as a second set; deleted-reference fixture test in `plugins/sp/tests/inline-pipeline-parity-check.test.ts` — re-run 4 pass / 0 fail (2026-09-17). |
| R2 | MET | Spurious dependencies[] edges flagged (wbs-shaped ^\d{3,4}$ only); 'spurious dependency edge caught' test in the 4-test pass; live harness re-run: `bun run inline-pipeline-parity-check` -> ok (9 actions, 4 guards, 9 workflows, both reference sets; 0 spurious edges). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC: harness test — deleted reference caught; spurious edge caught | MET | test | inline-pipeline-parity-check.test.ts 4 pass / 0 fail re-run 2026-09-17. |
| AC: bun run spur-check green | MET | command | FIXED THIS RUN: the file carried 4 lint/complexity/useOptionalChain warnings that failed `bun run lint` (--error-on-warnings) at HEAD — biome --write --unsafe applied (4 behavior-neutral optional-chain rewrites), lint chain (biome + typecheck across 7 workspaces) green after; parity harness still ok post-fix. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Two-reference-set enumeration + spurious-edge detection match the design; lint fix is style-only. |
| P4 | secua | — | Repair: 4 useOptionalChain rewrites in inline-pipeline-parity-check.ts (harness behavior re-verified green after). Residual: none. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T17:50:01.975Z backlog → todo (system)
- 2026-09-17T18:02:05.973Z todo → wip (system)
- 2026-09-17T18:07:00.638Z wip → testing (system)
- 2026-09-17T18:07:01.261Z testing → done (system)

