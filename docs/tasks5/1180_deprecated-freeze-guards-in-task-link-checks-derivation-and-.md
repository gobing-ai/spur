---
schema_version: 1
name: Deprecated freeze guards in task link, checks, derivation and advance
status: todo
template: feature-impl
created_at: 2026-10-12T05:21:53.039Z
updated_at: "2026-10-12T05:22:38.505Z"
feature_id: F42
priority: P1
tags:
  - feature-lifecycle
  - app

dependencies: ["1179"]
---

## 1180. Deprecated freeze guards in task link, checks, derivation and advance

### Background

Implements: R3 — New work cannot be linked to a deprecated feature; R4 — Checks flag live work under a deprecated feature and advise on edits; R5 — Derivation and routing never pull a deprecated feature back into active work.

Design: docs/design/feature-deprecated-status.md; ADR-136. Surfaces S5–S12, S14 and the next-feature skill (S15).

### Requirements

- [ ] R1. `guardParentFeature` in `packages/app/src/services/task-service.ts` rejects a deprecated parent for create, update `--feature` and batch-create phase 1, writing nothing and attempting no reopen; the message names the freeze and points to a separate removal feature.
- [ ] R2. `task-check.ts` emits warning `L4.feature-deprecated` for a live task under a deprecated feature with re-parent or cancel guidance.
- [ ] R3. `spur feature update <id> --section` on a deprecated feature succeeds and adds a freeze note to `warnings[]`.
- [ ] R4. `deriveFeatureStatus`, sync, refresh and `check --fix` propose no status for a deprecated feature.
- [ ] R5. `spur feature advance` refuses a deprecated feature with the un-deprecate command.
- [ ] R6. `plugins/sp/skills/next-feature/SKILL.md` excludes deprecated candidates; audit `wrapup-steps.ts` and `batch-preflight.ts` (expected no change).

### Acceptance Criteria

- [ ] AC1 — New work cannot be linked to a deprecated feature
- [ ] AC2 — Checks flag live work under a deprecated feature and advise on edits
- [ ] AC3 — Derivation and routing never pull a deprecated feature back into active work

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Freeze lives in the existing seams: the parent link guard, the task-check L4 block, the derivation early-return and the advance forward path. Warning (not error) for existing live tasks so unrelated gates stay green; the link guard stops new attachments. No override flag (YAGNI; removal runs under its own feature).

### Plan

- Link guard + batch-create phase 1
- L4.feature-deprecated finding
- Section-write warning
- Derivation early return (sync/refresh/fix)
- advance refusal
- next-feature skill + script audit
- E2E: CLI run on a temp deprecated feature covering link refusal, check warning, sync no-op, advance refusal

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
