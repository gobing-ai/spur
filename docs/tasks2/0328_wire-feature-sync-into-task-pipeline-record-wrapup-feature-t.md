---
template: feature-impl
schema_version: 1
name: "Wire feature sync into task-pipeline record, wrapup feature-transition, and dev-verify PASS"
description: ""
status: todo
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0327"]
created_at: "2026-07-25T00:27:48.753Z"
updated_at: "2026-07-25T00:29:11.747Z"
---

## 0328. Wire feature sync into task-pipeline record, wrapup feature-transition, and dev-verify PASS

### Background
Implements the map's hook-placement decision (see `docs/tasks2/0323_decide-post-verify-feature-refresh-hook-placement-missing-fe.md` — Solution section). Depends on the derivation engine + `spur feature sync` verb (sibling task).

Terrain: wrapup feature-transition step at `.spur/workflows/wrapup-pipeline.yaml:118`; record phase in `.spur/workflows/task-pipeline.yaml`; verify command at `plugins/sp/commands/dev-verify.md`; link helper `plugins/sp/skills/spur-dev/references/feature-link-helper.md`.
### Requirements
- `task-pipeline.yaml`: conditional post-record step — task `feature_id` present ⇒ run `spur feature sync <id> --json` (forward-only auto-apply; reopen proposals go to the run report only); absent ⇒ append an orphan link-proposal line to the run report. Config-only change (ADR-022 — the pipeline never touches files directly).
- `wrapup-pipeline.yaml` feature-transition step: replace the unconditional `spur feature advance ${vars.feature}` with `spur feature sync ${vars.feature} --json`; keep the existing conditional routing.
- `plugins/sp/commands/dev-verify.md`: post-PASS interactive step — show the derivation proposal and confirm before applying; missing `feature_id` ⇒ feature-link-helper propose/confirm/skip; explicit skip persisted via a task-frontmatter marker.
- Persisted-skip marker field (e.g. `feature_link_declined`) added per frontmatter schema conventions in `packages/domain/src/planning/schema.ts` if validation requires it.
- `docs/04_DESIGN.md` updated in the same commit (T3).
- Tests: pipeline YAML validation (`spur workflow validate` + dry-run); verify-command behavior covered by plugin tests where the harness supports it.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

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

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
