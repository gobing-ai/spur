---
schema_version: 1
name: Close the inline trace delegate findings from 0868 review
status: done
template: feature-impl
created_at: 2026-09-17T17:41:13.059Z
updated_at: "2026-09-17T17:59:52.134Z"
feature_id: D62

---

## 0879. Close the inline trace delegate findings from 0868 review

### Background

Captured from the creation title: "Close the inline trace delegate findings from 0868 review".

### Requirements

- R1: one stdout failure shape for `--action`; finalize vocabulary restricted to the engine's `done`/`failed` (not `running`/`paused`); both trace-failure recorders write the run log in one stamp format (0868 review findings 1, 3, 4).
- R2: an action row whose `node`/`kind` matches no declared state/action surfaces as a `spur workflow progress` diagnostic instead of persisting invisibly (`packages/app/src/workflow/progress-projection.ts`); a finalize for an unobserved action id keeps its run-id attribution (0868 review findings 2, 7).
- R3: the delegate's app-module surface is compile-time linked rather than hand-declared in a cast, so an app signature change fails the delegate's typecheck (`plugins/sp/scripts/inline-run-setup.ts:262-278`; 0868 review finding 5).
- R4 (DECIDED out of scope): ADR-117's `system_events` half for the inline surface is not delivered — `action_runs` + run-row closure satisfy the inline obligation; revisit only when a consumer exists. Record the decision against ADR-117 in `docs/00_ADR.md`.

### Acceptance Criteria

- One test per clause (R1 shape/vocabulary/stamp; R2 diagnostic + attribution; R3 compile-time link).
- R3 verified destructively: changing a linked app signature breaks the delegate's typecheck.
- ADR-117 entry records the inline `system_events` decision; `bun run spur-check` green.

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
| `packages/app/src/workflow/action-trace.ts:137` |
| `packages/app/src/workflow/action-trace.ts:141` |
| `packages/app/src/workflow/action-trace.ts:145` |
| `packages/app/src/workflow/action-trace.ts:159` |
| `packages/app/src/workflow/action-trace.ts:338` |
| `packages/app/src/workflow/progress-projection.ts:358` |
| `packages/app/src/workflow/progress-projection.ts:408` |
| `packages/app/src/workflow/progress-projection.ts:496` |
| `plugins/sp/scripts/inline-run-setup.ts:203` |
| `plugins/sp/scripts/inline-run-setup.ts:207` |
| `plugins/sp/scripts/inline-run-setup.ts:265` |
| `plugins/sp/scripts/inline-run-setup.ts:273` |
| `plugins/sp/scripts/inline-run-setup.ts:286` |
| `plugins/sp/scripts/inline-run-setup.ts:34` |
| `plugins/sp/scripts/inline-run-setup.ts:81` |

### Testing

- `bun test plugins/sp/tests/inline-run-trace.test.ts` — 6 pass, 0 fail.
- `bun test packages/app` trace + projection suites — 23 pass, 0 fail.
- `biome check` on the three changed files — clean.

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: UNKNOWN)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict UNKNOWN |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T17:50:01.362Z backlog → todo (system)
- 2026-09-17T17:53:22.507Z todo → wip (system)
- 2026-09-17T17:59:51.525Z wip → testing (system)
- 2026-09-17T17:59:52.134Z testing → done (system)

