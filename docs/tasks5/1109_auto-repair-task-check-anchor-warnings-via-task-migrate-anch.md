---
schema_version: 1
name: Auto-repair task-check anchor warnings via task migrate-anchors in the driver recovery path
status: todo
template: feature-impl
created_at: 2026-10-07T07:29:49.499Z
updated_at: "2026-10-07T15:57:58.481Z"
feature_id: H15

---

## 1109. Auto-repair task-check anchor warnings via task migrate-anchors in the driver recovery path

### Background

Driver-level task checks fail on L4 anchor-format WARNs (bare basenames instead of repo-relative `path:line` in Solution). Session batch: 1097 and 1099 both needed hand-written sed repair loops at check time; the repair is deterministic and already productized as `spur task migrate-anchors <wbs>` (0583 R1–R3). The driver contract just never invokes it — the operator notices the WARN, writes the map by hand, re-checks.

### Requirements

- [ ] R1. `plugins/sp/skills/spur-dev/references/execution-batch.md` step 3.3b (one-shot recovery) prescribes: on an L4 anchor-format WARN from `spur task check`, run `bun apps/cli/src/index.ts task migrate-anchors <wbs> --json` (or `spur` per tree pinning), then re-run the check once; only surface the failure if the WARN persists or is not anchor-class.
- [ ] R2. `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` recovery section carries the same rule (single source of truth: one section references the other rather than restating the recipe).
- [ ] R3. Guard clause: auto-repair only for anchor-format WARN classes — content conflicts, missing-section, and coverage failures are never auto-migrated.

### Acceptance Criteria

- [ ] AC1 — Driver-level task-check anchor warnings self-repair through task migrate-anchors before failing

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

- 2026-10-07T07:34:13.876Z backlog → todo (system)

### Notes

Verify `task migrate-anchors --help` before writing the recipe (do not invent flags; the 0583 reference owns semantics). Session repair maps to reuse as test fixtures: 1099's basename→repo-relative map (`workflow-service.ts:2046/2179/2182` → `packages/app/src/workflow/...`, `decision-hitl-responder.ts:455-500/76-78` → `packages/app/src/services/...`) — documented in the 1099 checkpoint (`.spur/memory/sessions/1099-checkpoint.md`).

