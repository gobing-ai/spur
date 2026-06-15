---
name: "W3: sp:spur-tasks and sp:spur-features companion skills"
description: "W3: sp:spur-tasks and sp:spur-features companion skills"
status: Done
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-15T00:30:14.276Z
folder: docs/tasks
type: task
feature-id: H2
priority: P1
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0066. "W3: sp:spur-tasks and sp:spur-features companion skills"

### Background

Design §12.3, F01. Reference companions: verb usage, conventions, check-before-write discipline. They document; sp:spur-dev acts.


### Requirements

R1. sp:spur-tasks: verb guide, section-editing workflow, matrix querying via check --json.
R2. sp:spur-features: authoring, AC conventions (R-numbering → scenarios), traceability habits.
R3. No pipeline logic in companions.


### Q&A



### Design

Authority: design §12.3 (companions document, `sp:spur-dev` acts — reference skills for verb usage,
conventions, check-before-write discipline; **no pipeline logic**), F01, delivery doc §7.1. Existing
style precedent: `plugins/sp/skills/spur-rules`, `spur-workflows`.


### Solution

Built both companion reference skills against the **real** `spur task` / `spur feature` CLI surface
(grounded per-verb to avoid the invented-CLI traps that bit 0064/0065).

**`sp:spur-tasks`** (`plugins/sp/skills/spur-tasks/`):
- `SKILL.md` — verb map; the dual-mode `update` (status **vs.** `--section`/`--from-file`); the
  readiness matrix via `check --json`; `refresh` (files-win); explicit "NOT the pipeline" boundary.
- `references/verbs.md`, `references/section-editing.md`.
- Corrected the common trap: **`task create` has no `--template`** — template is a `batch-create`
  item field only.

**`sp:spur-features`** (`plugins/sp/skills/spur-features/`):
- `SKILL.md` — verb map; hierarchical IDs (DD-14: one digit/level, ≤9 children, parent = drop last
  char, restructure via `move` cascade-rename); AC conventions (R-numbering, stable titles,
  `@core`/`@edge` tiers); traceability habits (L4 edges, normalized-title matching); one-active-goal.
- `references/verbs.md` (the 4 check layers), `references/acceptance-criteria.md`.
- Corrected the common trap: **`feature update` has no `--section`** — feature bodies
  (Goal/Scope/AC/Tasks/Notes) are hand-edited; the CLI owns status, scalar fields, IDs, and the
  refreshed `## Tasks` block.

Both cross-reference `sp:spur-dev` for the orchestration loop rather than duplicating it (R3), and
match the `spur-rules`/`spur-workflows` frontmatter style.


### Plan

- [x] R1: `plugins/sp/skills/spur-tasks/SKILL.md` — verb map (create/show/update/list/batch-create/refresh/check/resolve), section-editing workflow (`update --section --from-file`), matrix querying via `check --json`, status lifecycle vocabulary
- [x] R1: `references/verbs.md` (per-verb flags, JSON shapes, exit codes) + `references/section-editing.md` (temp-file recipe, which section when)
- [x] R2: `plugins/sp/skills/spur-features/SKILL.md` — verb map (create/show/update/list/move/refresh/check), hierarchical IDs (DD-14), AC conventions (R-numbering → scenarios, `@core`/`@edge`), traceability habits, one-active-goal
- [x] R2: `references/verbs.md` (per-verb flags, the 4 check layers) + `references/acceptance-criteria.md` (Gherkin/checklist templates, R-numbering, L4 mechanics)
- [x] R3: zero pipeline logic — both delegate orchestration to `sp:spur-dev`; every "decomposition/pipeline" mention is a delegation or a "NOT this skill" boundary (verified by scan)
- [x] Frontmatter style matches `spur-rules`/`spur-workflows` (name/description/license/metadata + openclaw emoji)
- [x] Resolves 0065 forward-deps: `expert-tasks` → `sp:spur-tasks`, `expert-features` → `sp:spur-features` now exist
- [x] Same-commit doc-sync: delivery doc §7.1 both companion rows `proposed → shipped (0066)`; §7.4 subagent rows flipped `shipped` now their skills exist (closes 0065's §7.4 miss)


### Review

**SECU verdict: FAIL (unbuilt) → PASS** (verified + built 2026-06-14; doc-sync added 2026-06-15 cleanup pass)

The `/rd3:dev-run` loop shipped **nothing** for 0066 — neither `sp:spur-tasks` nor `sp:spur-features`
existed (`plugins/sp/skills/` held only spur-dev/spur-rules/spur-workflows). All of R1/R2/R3 were
unmet. Built both companion skills from scratch, grounded against the real CLI.

**S — Security:** Markdown skill text only; every mutation routes through a CLI verb that validates.
No secrets, no injection surface.

**C — Correctness / architecture:**
- R1 ✓ `sp:spur-tasks` — verb guide, the section-editing workflow (`update --section --from-file`,
  temp-file recipe), matrix querying via `check --json`. Grounded; fixed the `--template`-on-create trap.
- R2 ✓ `sp:spur-features` — authoring guide, AC conventions (R-numbering → scenarios, stable titles,
  `@core`/`@edge`), traceability habits (L4 edges, normalized-title matching), hierarchical IDs,
  one-active-goal. Grounded; fixed the `--section`-on-feature-update trap (features are hand-edited).
- R3 ✓ Zero pipeline logic. Every decomposition/pipeline reference is a delegation to `sp:spur-dev`
  or an explicit "NOT this skill" boundary (verified by scan). The companions document; `sp:spur-dev` acts.

**U — Usability:** Trigger phrases, verb-map tables, "what this skill is NOT" sections, cross-refs to
`sp:spur-dev` and to each other; frontmatter mirrors `spur-rules`/`spur-workflows`.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | Both companion skills did not exist — the dev-run loop produced no files. R1/R2/R3 all unmet. | Correctness | `plugins/sp/skills/` | P1 | **FIXED** — authored both SKILL.md + 4 references. |
| 2 | Risk of teaching a non-existent flag (`task create --template`, `feature update --section`) — the class that broke 0064/0065. | Correctness | both SKILL.md | P2 | **AVOIDED** — grounded every verb/flag against `task.ts`/`feature.ts`; both absences stated explicitly. |
| 3 | Same-commit doc-sync missed on first pass: delivery doc §7.1 still listed both companion skills `proposed` after they shipped (the §7.x sync class that hit 0064/0065). Also §7.4 subagent rows were stale (`sp:expert-tasks`/`expert-features` were inert at 0065, now functional). | Process | delivery §7.1, §7.4 | P2 | **FIXED** (cleanup pass) — §7.1 rows → `shipped (0066)`; §7.4 → `shipped` with the 0065/0066 provenance. |

No remaining P1/P2.

**Gate:** `bun run lint` clean · `bun run test` 1108 pass / 0 fail · all taught verbs/flags exist ·
no pipeline logic in companions · 0065 forward-deps resolve · delivery §7.1/§7.4 in sync.


### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | Both companion skills did not exist — the dev-run loop produced no files. R1/R2/R3 all unmet. | Correctness | `plugins/sp/skills/` | P1 | **FIXED** — authored both SKILL.md + 4 references. |
| 2 | Risk of teaching a non-existent flag (`task create --template`, `feature update --section`) — the class that broke 0064/0065. | Correctness | both SKILL.md | P2 | **AVOIDED** — grounded every verb/flag against `task.ts`/`feature.ts`; both absences stated explicitly. |

No remaining P1/P2.

**Gate:** `bun run lint` clean · `bun run test` 1108 pass / 0 fail · all taught verbs/flags exist ·
no pipeline logic in companions · 0065 forward-deps (expert-tasks/expert-features) now resolve.


### Testing

Verified 2026-06-14. Prose deliverable (ADR-023 Fat-Skill companions) — verified by grounding
against the real CLI + scan, not unit tests.

- **Verb grounding (R1/R2):** every verb/flag the two skills teach exists in
  `apps/cli/src/commands/task.ts` / `feature.ts`. Task verbs: create/show/update/list/batch-create/
  refresh/check/resolve. Feature verbs: create/show/update/list/move/refresh/check.
- **Invented-flag scan:** zero occurrences of `--template` on `task create` and zero `--section` on
  `feature update` (the two real CLI constraints) — both skills state them correctly as the absence.
- **R3 no-pipeline scan:** grep of both skills + 4 references for `task-pipeline` / `workflow run` /
  `workflow continue` / orchestration verbs → every hit is a delegation to `sp:spur-dev` or an
  explicit "this skill is NOT the pipeline" boundary. No embedded orchestration.
- **Vocabulary (DD-08/DD-14) drift check:** task sections match the DD-08 headings; statuses match
  `TASK_STATUSES`/`FEATURE_STATUSES`; AC R-numbering + `@core`/`@edge` + the 4 check layers match
  `feature-check.ts` and `ac-style-guide.md`.
- **0065 forward-dep resolution:** `expert-tasks` (`skills: [sp:spur-tasks]`) and `expert-features`
  (`skills: [sp:spur-features]`) now reference existing skills.

**Status before verify:** UNBUILT — the dev-run loop shipped no SKILL.md for 0066. All three
requirements were unmet; authored from scratch here.

Gate: `bun run lint` clean · `bun run test` 1108 pass / 0 fail (markdown-only — unchanged).


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


