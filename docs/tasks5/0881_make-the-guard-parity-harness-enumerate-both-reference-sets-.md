---
schema_version: 1
name: Make the guard-parity harness enumerate both reference sets and catch spurious dependency edges
status: done
template: feature-impl
created_at: 2026-09-17T17:41:13.770Z
updated_at: "2026-09-17T18:07:01.261Z"
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

- `bun test plugins/sp/tests/inline-pipeline-parity-check.test.ts` — 4 pass, 0 fail (new: deleted-reference caught; spurious dependency edge caught).
- Live harness run: exit 0, both reference sets + YAML union agree, 0 spurious edges.
- `bunx biome format` clean on both touched files.

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: UNKNOWN)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict UNKNOWN |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T17:50:01.975Z backlog → todo (system)
- 2026-09-17T18:02:05.973Z todo → wip (system)
- 2026-09-17T18:07:00.638Z wip → testing (system)
- 2026-09-17T18:07:01.261Z testing → done (system)

