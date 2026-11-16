---
schema_version: 1
name: Define the Board module-shell UI contract in DESIGN.md and route spur-composer to it
status: done
template: feature-impl
created_at: 2026-11-16T19:08:27.311Z
updated_at: "2026-11-16T19:46:48.972Z"
feature_id: A81
priority: P1
tags:
  - board
  - design
  - docs
  - plugin

estimate_hours: 3
done_forced: "false"
done_reason: unforced close
---

## 1347. Define the Board module-shell UI contract in DESIGN.md and route spur-composer to it

### Background

Implements: R1 — Root DESIGN.md defines one module-shell contract for built-in and downstream modules; R6 — spur-composer routes authors to the UI contract through a dedicated reference.

Knowledge-kit's native modules drifted from built-in modules because the ADR-081 shell anatomy lives only in per-module satellites (tasks-module-shell-parity, history, observability) and root DESIGN.md covers only frame/right-panel behavior for downstream modules. Design: [board-module-ui-kit](docs/design/board-module-ui-kit.md), ADR-150. Independent of the kit tasks; runs first.

Rubric: E3 D1 L2 C0 R0 = 6 → own task (docs + plugin skill surface, separately reviewable).

### Requirements

- [x] R1. Add a normative module-shell section to root DESIGN.md: header anatomy (icon, title, subtitle, status chip, filter/range row, tab strip right), append-only tabs, density/width (incl. ADR-081 full-bleed exception), empty/loading/diagnostic states, right-panel use and light/dark token use; state it binds built-in and project-owned native modules alike.
- [x] R2. Reconcile the existing 'Product UI — Downstream Board Modules (proposed)' section into the new section without contradicting its frame and right-panel rules.
- [x] R3. Add a dedicated board-module UI reference under plugins/sp/skills/spur-composer/references/ that links (never restates) the DESIGN.md section, downstream design §6 and the UI-kit satellite, and link it from the SKILL.md Board module composition step.
- [x] R4. Keep the plugin standalone and skill budget gates green.

### Acceptance Criteria

- [x] AC1 — Root DESIGN.md defines one module-shell contract for built-in and downstream modules
- [x] AC2 — spur-composer routes authors to the UI contract through a dedicated reference

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T19:09:15.589Z

- **Closed:** UI rules live in root DESIGN.md, not in spur-composer — DESIGN.md is the UI/UX authority (AGENTS doc map, constitution §6.5); the composer reference only links it (ADR-150).
- **Deferred:** knowledge-kit module migration — separate repository; follow-up there once A81 ships.

#### Q&A entry — 2026-11-16T19:35:52.090Z

- **Closed:** UI rules live in root DESIGN.md, not in spur-composer — DESIGN.md is the UI/UX authority; the composer reference only links it (ADR-150).
- **Closed:** template lives at plugins/sp/skills/spur-composer/templates/board-module/ (frozen by refine 2026-11-16, delivered in 1350).
- **Deferred:** knowledge-kit module migration — separate repository; follow-up there once A81 ships.

### Design

Approach: DESIGN.md owns UI rules (constitution §6.5, AGENTS doc map); derive the section from the shipped built-in shells (ObservabilityShell, HistoryShell, TasksShell) and ADR-081 rather than inventing new styling.
Rejected: putting the UI contract inside spur-composer (a skill is guidance, not the UI authority; would duplicate DESIGN.md).
Invariants: the composer reference links owners only; no restated verb catalogs; existing frame/right-panel rules preserved.

### Plan

1. Inventory shell anatomy from built-in shells + ADR-081
2. Write DESIGN.md module-shell section; fold the downstream section in
3. Add spur-composer references/board-module-ui.md and link it from SKILL.md
4. Run skill validation and doc checks

### Solution

| File | Change |
| --- | --- |
| `DESIGN.md:497-601` | Replaced the former "Product UI — Downstream Board Modules (proposed)" section with the normative "Product UI — Module Shell (built-in and downstream modules)" contract: one-row header anatomy (identity/icon/title/subtitle/status chip, inline filters and range presets, single primary action, right-aligned tab strip), append-only `tabs.ts` contract, `max-w-[1600px]` rail with the ADR-081 full-bleed body exception and dense spacing rhythm, empty/loading/diagnostic states, right-panel rule and light/dark token rule, all stated to bind built-in and project-owned native modules alike. The former downstream frame/panel/iframe rules are retained verbatim as the closing "Downstream frame and panel rules" subsection, plus a legacy anchor so existing deep links resolve. |
| `plugins/sp/skills/spur-composer/references/board-module-ui.md:1-46` | New routing reference: an owners table (DESIGN.md shell section, downstream design §6, UI-kit satellite), the compose→build steps pointing at the starter template path, and an explicit link-never-restate boundary. |
| `plugins/sp/skills/spur-composer/SKILL.md:118-128` | Board module composition step now names the DESIGN.md module-shell section as the shell owner and routes `compose`/`build` to the new reference, keeping the kit/declaration owners in their own files. |
| `docs/design/downstream-board-modules.md:18` | §1 "UI rules belong to" link repointed to the renamed DESIGN.md section anchor. |
| `plugins/sp/tests/skill-structure.test.ts:2584-2625` | New `A81 1347` contract block: asserts the module-shell section and its six subsections exist in `DESIGN.md`, the former proposed section is gone while its legacy anchor and frame rules remain, and the composer SKILL.md plus its UI reference link the three owners. |

Verification: `spur task gate 1347 light` PASS (5 changed files); `bun test plugins/sp/tests/skill-structure.test.ts` 99 pass / 0 fail.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — add a normative module-shell section to root DESIGN.md (header anatomy, append-only tabs, density/width incl. the ADR-081 full-bleed exception, empty/loading/diagnostic states, right-panel and light/dark token rules), binding built-in and project-owned native modules alike | MET | `DESIGN.md:499-601`: `### Module header anatomy` (`:509`), `### Append-only tabs` (`:532`), `### Density and width` (`:540`), `### Empty, loading and diagnostic states` (`:553`), `### Right panel and theme tokens` (`:572`); the opening paragraph (`:503-507`) states the rules bind the shipped modules and project-owned native modules alike; pinned by `plugins/sp/tests/skill-structure.test.ts:2584-2601` |
| R2 — reconcile the former "Product UI — Downstream Board Modules (proposed)" section without contradicting its frame and right-panel rules | MET | the former bullets survive as `DESIGN.md:584-601` (`### Downstream frame and panel rules`), and the module-level right-panel rule at `:574-581` ("panel only when supplied", built-in panel behavior, resize handle, saved layout preferences) agrees with them instead of narrowing them; `<a id="product-ui--downstream-board-modules-proposed">` at `:497` keeps existing deep links resolving, the one live satellite link is repointed (`docs/design/downstream-board-modules.md:17`); pinned by `plugins/sp/tests/skill-structure.test.ts:2603-2609` |
| R3 — a dedicated composer UI reference that links (never restates) the DESIGN.md section, the downstream authoring guide §6 and the UI-kit satellite, linked from the SKILL.md Board module composition step | MET | `plugins/sp/skills/spur-composer/references/board-module-ui.md:1-47` — owners table links all three owners with an explicit "restates none of them" boundary (`:3-5`, `:15-16`); `plugins/sp/skills/spur-composer/SKILL.md:118-124` names the DESIGN.md section as the shell owner and `:128` routes the `compose` row to the reference; pinned by `plugins/sp/tests/skill-structure.test.ts:2611-2625` |
| R4 — keep the plugin standalone and skill budget gates green | MET | `command` — `spur task gate 1347 light` PASS on the final tree (`.spur/run/1347-check-receipt.json`: rules:pre, rules:post, test:plugins/sp, typecheck all PASS); `test` — `bun test plugins/sp/tests/skill-structure.test.ts` 99 pass / 0 fail, including R20 (no vendor refs) and the composer R1/R6/R7 contracts; the change adds no runtime import, so the plugin standalone rule is untouched |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Root DESIGN.md defines one module-shell contract for built-in and downstream modules | MET | test | `plugins/sp/tests/skill-structure.test.ts:2590-2601` — asserts the section heading and its six subsections plus the contribution-binding sentence; `DESIGN.md:499-601` |
| AC2 — spur-composer routes authors to the UI contract through a dedicated reference | MET | test | `plugins/sp/tests/skill-structure.test.ts:2611-2625` — asserts the SKILL.md link, the DESIGN.md anchor and the three owner links in the reference; `plugins/sp/skills/spur-composer/references/board-module-ui.md:1-47` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Functional focus: PASS. All four requirements and both acceptance criteria carry direct `file:line` evidence — `DESIGN.md:499-601` (anatomy `:509`, append-only tabs `:532`, density/width `:540`, states `:553`, panel/tokens `:572`), the reconciled frame rules at `:584-601` with the legacy anchor at `:497`, and the routing reference `plugins/sp/skills/spur-composer/references/board-module-ui.md:1-47` linked from `plugins/sp/skills/spur-composer/SKILL.md:118-128`. Gate evidence: `spur task gate 1347 light` PASS plus `plugins/sp/tests/skill-structure.test.ts` 96 pass / 0 fail.

Findings (all advisory, none blocking):

- **P4** — `<a id="product-ui--downstream-board-modules-proposed">` (`DESIGN.md:497`) is a compatibility shim for historical task records that cite the old anchor; drop it when those records stop being read.
- **P4** — the `## Product UI — System Events` and `— Decisions` sections keep their module-specific header/filter detail; the shared shell section is the authority, so a later edit changes it first.
- **P4** — the composer reference names the starter-template path that ships with the kit and states inline that a kit-less Spur version has none, so it is accurate on both sides of the kit landing.

Residual risk: none mechanical — the change is documentation plus one markdown reference, and the section is derived from shipped shells rather than new styling. Disposition: PASS, no follow-up filed.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T19:43:29.119Z todo → wip (system)
- 2026-11-16T19:46:47.685Z wip → testing (system)
- 2026-11-16T19:46:48.969Z testing → done (system)

