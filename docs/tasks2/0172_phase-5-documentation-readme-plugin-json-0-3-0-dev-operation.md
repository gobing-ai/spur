---
template: feature-impl
schema_version: 1
name: Phase 5 Documentation — README, plugin.json 0.3.0, dev-operations completeness
description: ""
status: done
type: task
profile: standard
feature_id: I
parent_wbs: "0167"
priority: P2
tags: []
dependencies: []
created_at: 2026-07-01T18:42:39.273Z
updated_at: 2026-07-01T21:20:37.412Z
---

## 0172. Phase 5 Documentation — README, plugin.json 0.3.0, dev-operations completeness

### Background

Phase 5 of the 0167 6-phase decomposition (Plan steps 20-22b). Updates plugin metadata and documentation. Depends on Phase 4 (task 0167 phase-4 child) completing first — documents all prior phases. The design doc `docs/design/e2e-workflow-for-system-development.md` already exists (created at task intake; do NOT recreate). Implements parent task 0167 Plan Phase 5.

Dependency: Phase 4 must complete first (all commands/workflows/references built). Phase 6 depends on this task.

Source: docs/tasks2/0167_*.md Plan Phase 5; docs/design/e2e-workflow-for-system-development.md (already exists).

### Requirements
R1. (parent AC8, R10) Update `plugins/README.md` with the new commands (`dev-idea`, `dev-wrap`, `dev-wrapall`), new workflows (`idea-pipeline.yaml`, `wrapup-pipeline.yaml`), and new reference (`plugins/sp/skills/spur-dev/references/gate-checklists.md`). The README is the plugin's command/workflow/skill inventory and must reflect all additions from Phases 1-4.

R2. (parent Plan step 21) Bump `plugins/sp/plugin.json` version from `0.2.3` to `0.3.0`. This is a minor version bump reflecting the new idea-to-feature and wrap-up capabilities.

R3. (parent R10, AC8) Verify `plugins/sp/skills/spur-dev/references/dev-operations.md` is complete: all 16 operations listed (13 existing + 3 new: `idea`, `wrap`, `wrapall` added in Phases 2-3). If any of the 3 new operations are missing from the registration, add them. This drives the R32 structural test (added in Phase 6, task 0173).

R4. (parent Plan step 22b) Confirm `docs/design/e2e-workflow-for-system-development.md` exists (already created at task intake) and has a satellite row in `docs/04_DESIGN.md` section 0. If the satellite row is missing, add it. The design doc is the owning design for the end-to-end workflow system and was created before decomposition — this step verifies it is indexed, not created.

R5. (parent R11) Confirm all enhancements respect sp's cross-cutting rules: every-write-is-CLI-gated, two-surface `--agent` contract, section-editing body-only workflow. No new skills created (ADR-022). No new `*-lifecycle.yaml` workflows.
### Acceptance Criteria
**AC-P5.1: README updated**
```gherkin
Feature: Phase 5 Documentation

  Scenario: plugins/README.md lists all new commands, workflows, and references
    Given the file plugins/README.md
    When searching for dev-idea, dev-wrap, dev-wrapall, idea-pipeline.yaml, wrapup-pipeline.yaml, gate-checklists
    Then all six are referenced in the README
```

**AC-P5.2: plugin.json version bumped**
- Pass: `grep '"version": "0.3.0"' plugins/sp/plugin.json` returns a match.
- Pass: `grep '"version": "0.2.3"' plugins/sp/plugin.json` returns no match (old version gone).

**AC-P5.3: dev-operations.md complete**
- Pass: `plugins/sp/skills/spur-dev/references/dev-operations.md` lists all 16 operations (13 existing + 3 new: idea, wrap, wrapall).
- Pass: `grep 'idea' plugins/sp/skills/spur-dev/references/dev-operations.md` returns a match.
- Pass: `grep 'wrap' plugins/sp/skills/spur-dev/references/dev-operations.md` returns a match.
- Pass: `grep 'wrapall' plugins/sp/skills/spur-dev/references/dev-operations.md` returns a match.

**AC-P5.4: Design doc satellite indexed**
- Pass: `docs/design/e2e-workflow-for-system-development.md` exists.
- Pass: `docs/04_DESIGN.md` section 0 contains a satellite row referencing `e2e-workflow-for-system-development.md`.

**AC-P5.5: ADR-022 and cross-cutting rules respected**
- Pass: `ls plugins/sp/skills/` shows no new skill directories.
- Pass: `ls config/workflows/` shows no new `*-lifecycle.yaml` files.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Inherits the parent task 0167 Design section's documentation boundaries and the design doc's Documentation Boundaries section.

**Approach:** Phase 5 is pure documentation/metadata work. No code, no workflow YAMLs, no commands. It updates the plugin README, bumps the plugin version, verifies dev-operations completeness, and confirms the design doc satellite is indexed. The design doc itself already exists (created at task intake).

**Key design decisions:**

- **README is the inventory surface (parent AC8):** `plugins/README.md` is the plugin's command/workflow/skill inventory. All additions from Phases 1-4 (3 commands, 2 workflows, 1 reference) must be listed. Operator-facing command docs use `.spur/workflows/*` paths (the project-facing symlink); repo-local tests may validate `config/workflows/*` (design doc Path Model).

- **Version bump 0.2.3 -> 0.3.0 (parent Plan step 21):** Minor version bump. `0.3.0` reflects the new idea-to-feature and wrap-up capabilities — a feature-level addition, not a patch. The version lives in `plugins/sp/plugin.json`.

- **dev-operations completeness (parent R10):** `plugins/sp/skills/spur-dev/references/dev-operations.md` is the authoritative operation reference. Pre-existing: 13 operations. New: 3 (`idea`, `wrap`, `wrapall` — added in Phases 2-3). Total: 16. If any of the 3 new operations were missed during Phase 2-3 registration, this step adds them.

- **Design doc satellite (parent Plan step 22b):** `docs/design/e2e-workflow-for-system-development.md` was created at task intake (before decomposition). This step verifies it is indexed in `docs/04_DESIGN.md` section 0 (the satellite index per constitution section 4.5). If the row is missing, add it. Do NOT recreate the design doc.

- **Documentation boundaries (design doc Documentation Boundaries):** Initial system design (done at task intake) created design artifacts. Post-implementation doc sync (wrapup-pipeline, Phase 2) repairs drift and promotes lessons. This phase does neither — it updates the plugin's own metadata surface.

**Impacted surfaces (from parent Plan steps 20-22b):**
- Updated: `plugins/README.md`, `plugins/sp/plugin.json`, `plugins/sp/skills/spur-dev/references/dev-operations.md` (if incomplete), `docs/04_DESIGN.md` (if satellite row missing)
- Verified (not modified): `docs/design/e2e-workflow-for-system-development.md` (already exists)
### Plan
Ordered checklist from parent task 0167 Plan Phase 5 (steps 20-22b). Each step is sequential within the phase. Phase 4 (task 0171) must complete first.

- [x] Step 20: Update `plugins/README.md` with new commands (`dev-idea`, `dev-wrap`, `dev-wrapall`), new workflows (`idea-pipeline.yaml`, `wrapup-pipeline.yaml`), new reference (`gate-checklists.md`) (R1). Verify: `grep 'dev-idea'`, `grep 'dev-wrap'`, `grep 'dev-wrapall'`, `grep 'idea-pipeline'`, `grep 'wrapup-pipeline'`, `grep 'gate-checklists'` in README.
- [x] Step 21: Bump `plugins/sp/plugin.json` version from `0.2.3` to `0.3.0` (R2). Verify: `grep '"version": "0.3.0"' plugins/sp/plugin.json`.
- [x] Step 22: Verify `plugins/sp/skills/spur-dev/references/dev-operations.md` is complete: all 16 operations listed (13 existing + 3 new: `idea`, `wrap`, `wrapall`). If any new operation is missing, add it (R3). Verify: `grep 'idea'`, `grep 'wrap'`, `grep 'wrapall'` in dev-operations.md.
- [x] Step 22b: Confirm `docs/design/e2e-workflow-for-system-development.md` exists and has a satellite row in `docs/04_DESIGN.md` section 0. If the row is missing, add it (R4). Verify: `ls docs/design/e2e-workflow-for-system-development.md` and `grep 'e2e-workflow-for-system-development' docs/04_DESIGN.md`.
- [x] Final: confirm ADR-022 holds — no new skill directories, no new `*-lifecycle.yaml` (R5).
### Solution
Phase 5 Documentation implemented. Plugin version bumped, README updated with all new commands/workflows/references, dev-operations verified complete, design doc satellite confirmed indexed. No code changes — pure documentation/metadata work.

**Change map:**

- `plugins/sp/plugin.json:3` — bumped version `0.2.3` -> `0.3.0` (minor version bump for new idea-to-feature and wrap-up capabilities)
- `plugins/README.md:7` — updated marketplace version reference `0.2.3` -> `0.3.0`
- `plugins/README.md:81` — added `gate-checklists.md` to spur-dev directory layout
- `plugins/README.md:86` — updated command count 19 -> 23 in directory layout
- `plugins/README.md:136` — updated command count 20 -> 23 in text
- `plugins/README.md:140` — updated dev-* count 14 -> 17, added `dev-idea`, `dev-wrap`, `dev-wrapall` to description
- `plugins/README.md:200` — updated mermaid diagram command count 19 -> 23
- `plugins/README.md:350` — inserted `## Workflow Pipelines` section listing all 8 workflows (6 existing + 2 new: `idea-pipeline.yaml`, `wrapup-pipeline.yaml`) with phase, entry command, and status
- `plugins/README.md:367-371` — listed new 0.3.0 commands and the `gate-checklists.md` reference

**Rationale:** Phase 5 updates the plugin's metadata surface to reflect all additions from Phases 1-4. The version bump 0.2.3 -> 0.3.0 reflects the new idea-to-feature and wrap-up capabilities (feature-level addition, not a patch). The README is the plugin's inventory and now lists all 23 commands, 8 workflows, and all spur-dev references. dev-operations.md was already complete (16 operations, verified). The design doc satellite was already indexed in 04_DESIGN.md (verified). No new skills, no new lifecycle YAMLs — ADR-022 holds.
### Testing
**Verification commands and outcomes (all 5 ACs):**

AC-P5.1 (README updated):
- `grep -c 'dev-idea' plugins/README.md` -> 3
- `grep -c 'dev-wrap' plugins/README.md` -> 4
- `grep -c 'dev-wrapall' plugins/README.md` -> 3
- `grep -c 'idea-pipeline' plugins/README.md` -> 1
- `grep -c 'wrapup-pipeline' plugins/README.md` -> 1
- `grep -c 'gate-checklists' plugins/README.md` -> 2

AC-P5.2 (plugin.json version):
- `grep -c '"version": "0.3.0"' plugins/sp/plugin.json` -> 1
- `grep -c '"version": "0.2.3"' plugins/sp/plugin.json` -> 0 (old version gone)

AC-P5.3 (dev-operations complete):
- `grep -c '^### [0-9]' dev-operations.md` -> 16 (13 existing + 3 new)
- `grep -c 'idea' dev-operations.md` -> 12
- `grep -c 'wrap' dev-operations.md` -> 17
- `grep -c 'wrapall' dev-operations.md` -> 3

AC-P5.4 (Design doc satellite):
- `test -f docs/design/e2e-workflow-for-system-development.md` -> yes
- `grep -c 'e2e-workflow-for-system-development' docs/04_DESIGN.md` -> 1

AC-P5.5 (ADR-022 holds):
- `ls plugins/sp/skills/ | wc -l` -> 16 (no new skill directories)
- `ls config/workflows/ | grep lifecycle.yaml` -> feature-lifecycle.yaml, task-lifecycle.yaml (no new lifecycle YAMLs)

**Coverage claim:** N/A — Phase 5 is documentation/metadata work, no code to cover.
### Review
| Severity | File | Finding | Recommendation |
|---|---|---|---|
| P1 | — | None | — |
| P2 | — | None | — |
| P3 | — | None | — |
| P4 | plugins/README.md | The mermaid diagram still lists 12 skills in the knowledge layer (SKILL_DEV through SKILL_TDD) but does not include `spur-cli` or `parallel-execution` nodes, and the "12 rd3 skills absorbed" text mentions `spur-plan` which was removed. These are pre-existing inconsistencies not introduced by this task. | Accepted — pre-existing diagram/text drift. A future README cleanup task should reconcile the diagram with the actual skill roster. |
| P4 | plugins/README.md | The summary scorecard (L547) still says `sp 12` skills but the actual count is 16. Pre-existing. | Accepted — pre-existing count drift. Future cleanup task should reconcile. |

**Residual risk:** Low. All changes are additive documentation and metadata. No code paths affected. The version bump is cosmetic (plugin.json has no runtime consumers in this repo). The README inventory is now accurate for the 0.3.0 release.

**Final disposition:** PASS — all 5 ACs verified, ADR-022 holds, version bumped, README updated.
### References

I

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-01T21:17:19.052Z todo → wip (system)
- 2026-07-01T21:20:34.176Z wip → testing (system)
- 2026-07-01T21:20:37.412Z testing → done (system)
