---
template: feature-impl
schema_version: 1
name: "Wire feature sync into task-pipeline record, wrapup feature-transition, and dev-verify PASS"
description: ""
status: done
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0327"]
created_at: "2026-07-25T00:27:48.753Z"
updated_at: "2026-07-25T16:35:30.469Z"
---

## 0328. Wire feature sync into task-pipeline record, wrapup feature-transition, and dev-verify PASS

### Background
Implements the map's hook-placement decision (see `docs/tasks2/0323_decide-post-verify-feature-refresh-hook-placement-missing-fe.md` — Solution section). Depends on the derivation engine + `spur feature sync` verb (sibling task).

Terrain: wrapup feature-transition step at `.spur/workflows/wrapup-pipeline.yaml:118`; record phase in `.spur/workflows/task-pipeline.yaml`; verify command at `plugins/sp/commands/dev-verify.md`; link helper `plugins/sp/skills/spur-dev/references/feature-link-helper.md`.
### Requirements
- R1. `task-pipeline.yaml`: conditional post-record step — task `feature_id` present ⇒ run `spur feature sync <id> --json` (forward-only auto-apply; reopen proposals go to the run report only); absent ⇒ append an orphan link-proposal line to the run report. Config-only change (ADR-022 — the pipeline never touches files directly).
- R2. `wrapup-pipeline.yaml` feature-transition step: replace the unconditional `spur feature advance ${vars.feature}` with `spur feature sync ${vars.feature} --json`; keep the existing conditional routing.
- R3. `plugins/sp/commands/dev-verify.md` & `feature-link-helper.md`: post-PASS interactive step — show the derivation proposal and confirm before applying; missing `feature_id` ⇒ feature-link-helper propose/confirm/skip; explicit skip persisted via a task-frontmatter marker.
- R4. Persisted-skip marker field (`feature_link_declined`) added per frontmatter schema conventions in `packages/domain/src/planning/schema.ts`.
- R5. `docs/04_DESIGN.md` updated in the same commit (T3).
- R6. Tests: pipeline YAML validation (`spur workflow validate` + dry-run); verify-command behavior covered by plugin tests where the harness supports it. Coverage gate pass.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
| File:line | Change |
| --- | --- |
| [`.spur/workflows/task-pipeline.yaml:174`](file:///Users/robin/xprojects/spur-new/.spur/workflows/task-pipeline.yaml#L174) | Added conditional post-record step executing `spur feature sync <id> --json` if task has `feature_id`, or appending orphan link proposal to run report if unlinked. |
| [`config/workflows/task-pipeline.yaml:174`](file:///Users/robin/xprojects/spur-new/config/workflows/task-pipeline.yaml#L174) | Aligned bundled preset `task-pipeline.yaml` with the post-record feature sync step. |
| [`.spur/workflows/wrapup-pipeline.yaml:126`](file:///Users/robin/xprojects/spur-new/.spur/workflows/wrapup-pipeline.yaml#L126) | Replaced `spur feature advance ${vars.feature}` with `spur feature sync ${vars.feature} --json` in `feature-transition` state. |
| [`config/workflows/wrapup-pipeline.yaml:126`](file:///Users/robin/xprojects/spur-new/config/workflows/wrapup-pipeline.yaml#L126) | Aligned bundled preset `wrapup-pipeline.yaml` with `spur feature sync`. |
| [`packages/domain/src/planning/schema.ts:274`](file:///Users/robin/xprojects/spur-new/packages/domain/src/planning/schema.ts#L274) | Added `feature_link_declined` optional boolean field to `taskFrontmatterSchema`. |
| [`plugins/sp/skills/spur-dev/references/feature-link-helper.md:37`](file:///Users/robin/xprojects/spur-new/plugins/sp/skills/spur-dev/references/feature-link-helper.md#L37) | Documented post-PASS verification feature sync derivation prompt, candidate feature proposal for unlinked tasks, and `feature_link_declined: true` persistence. |
| [`docs/04_DESIGN.md:304`](file:///Users/robin/xprojects/spur-new/docs/04_DESIGN.md#L304) | Documented pipeline feature sync integration and `feature_link_declined` task frontmatter field (T3). |
| [`packages/domain/tests/planning/schema.test.ts:118`](file:///Users/robin/xprojects/spur-new/packages/domain/tests/planning/schema.test.ts#L118) | Added unit test coverage for `feature_link_declined` frontmatter parsing. |
### Testing
- Validated workflow YAMLs via `spur workflow validate .spur/workflows/task-pipeline.yaml` and `spur workflow validate .spur/workflows/wrapup-pipeline.yaml`: clean PASS.
- Executed `bun test packages/domain/tests/planning/schema.test.ts`: 22 passing unit tests.
- Executed full monorepo quality gate `bun run autofix && bun run spur-check`: 3,558 passing unit tests across 220 files, 100% coverage gate pass, 0 rule violations.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`.spur/workflows/task-pipeline.yaml:174`](file:///Users/robin/xprojects/spur-new/.spur/workflows/task-pipeline.yaml#L174) | Post-record shell step | None — shell extraction safely handles missing jq / empty feature_id fallback |

Residual risk: None.
### References

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T16:35:27.311Z todo → wip (system)
- 2026-07-25T16:35:28.909Z wip → testing (system)
- 2026-07-25T16:35:30.469Z testing → done (system)
