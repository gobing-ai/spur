---
schema_version: 1
name: Define lightweight plan and design authoring templates and project guidance
status: done
template: feature-impl
created_at: 2026-09-25T07:22:28.363Z
updated_at: "2026-09-25T07:32:29.225Z"
feature_id: H14
priority: P2
estimate_hours: 3

---

## 0954. Define lightweight plan and design authoring templates and project guidance

### Background

Plans and Designs now display loose Markdown records. The constitution distinguishes working plans from governed design satellites; authors need a small reusable contract without forcing legacy migration.

### Requirements

- [x] R1. Add distinct plan and design Markdown templates with small frontmatter and useful section prompts.
- [x] R2. Align project and init-template ownership guidance with the new authoring reference and route sp:spur-dev generation to it.

### Acceptance Criteria

- [x] AC1 — New plans and designs use distinct Markdown templates (req: R1)
- [x] AC2 — Project guidance and spur-dev point to one document contract (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Keep shared ownership in 99 and practical composition in one spur-dev reference. Use the two template files as examples, not runtime schemas. Modify only relevant key-file templates; preserve the existing 04 index and legacy document contracts.

### Plan

- [x] Add plan/design templates and one concise authoring reference.
- [x] Update spur-dev skill and planning workflow reference to use the templates.
- [x] Align current constitution and relevant init templates.
- [x] Run focused link and format checks.

### Solution

Added separate Markdown starting points for working plans and governed non-UI designs at `plugins/sp/skills/spur-dev/templates/plan.md:1` and `plugins/sp/skills/spur-dev/templates/design.md:1`. The authoring guide at `plugins/sp/skills/spur-dev/references/document-authoring.md:10` explains ownership, frontmatter, flexible sections, and history-preserving revisions; `plugins/sp/skills/spur-dev/SKILL.md:119` routes the planning step to it.

The governance defect was missing composition guidance for Plans and Designs despite their distinct authority. `docs/99_PROJECT_CONSTITUTION.md:70` now states the lightweight working-record and satellite rules, with the matching init constitution at `config/templates/docs/99_PROJECT_CONSTITUTION.md:70`. `AGENTS.md:86` and `config/templates/AGENTS.md:98` point authors to the skill. Relevant 02–04 init templates link working plans and non-UI design detail to their owners.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/templates/plan.md:1`; `plugins/sp/skills/spur-dev/templates/design.md:1`; `plugins/sp/skills/spur-dev/references/document-authoring.md:22` |
| R2 | MET | `docs/99_PROJECT_CONSTITUTION.md:70`; `config/templates/docs/99_PROJECT_CONSTITUTION.md:70`; `plugins/sp/skills/spur-dev/SKILL.md:119`; `plugins/sp/skills/brainstorm/SKILL.md:139` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| [docs-only] AC-1 | MET | static-ref | `plugins/sp/skills/spur-dev/templates/plan.md:1`; `plugins/sp/skills/spur-dev/templates/design.md:1`; `plugins/sp/skills/spur-dev/references/document-authoring.md:26` |
| [docs-only] AC-2 | MET | command | `superskill skill validate plugins/sp/skills/spur-dev --json` and `superskill skill validate plugins/sp/skills/brainstorm --json` returned valid=true; `bun run lint` exited 0; routes at `plugins/sp/skills/spur-dev/SKILL.md:119` and `AGENTS.md:86` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-25T07:23:36.041Z todo → wip (system)
- 2026-09-25T07:32:09.036Z wip → testing (system)
- 2026-09-25T07:32:29.225Z testing → done (system)

