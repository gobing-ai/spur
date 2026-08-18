---
schema_version: 1
name: "Promote UI boundary rule to error + wire into pre-check gate + doc sync"
status: done
template: feature-impl
created_at: 2026-06-23T06:04:57.965Z
updated_at: "2026-08-18T04:42:46.800Z"
feature_id: F7
priority: P2
tags: ["rules", "ui", "gate", "docs"]
---

## 0104. Promote UI boundary rule to error + wire into pre-check gate + doc sync

### Background

The irreversible-commitment milestone: once the refactor (Tasks 1-2) conforms and the rule (Task 3) reports zero violations at warning, promote both rules to error and make them part of the standing gate so regressions are blocked at pre-check. Separate from Task 3 because flipping to error + wiring the gate is the permanent enforcement step and warrants its own checkpoint.

### Requirements
- [ ] R1. Eliminate the last UI-lib import leak BEFORE wiring/promoting (hard prerequisite): re-export `@uiw/react-md-editor` from `apps/web/src/ui.ts` (`export { default as MDEditor } from '@uiw/react-md-editor'`; preserves `MDEditor.Markdown`), and relocate the `@uiw/react-md-editor/markdown-editor.css` side-effect import out of `TaskDetail.tsx` into `ui.ts` (or `global.css`) so it loads exactly once. Update `MarkdownBody.tsx` + `TaskDetail.tsx` to `import { MDEditor } from '@/ui'`. After this, zero `@uiw/...` references remain under `apps/web/src/modules/**`. Re-export, NOT a wrapper component — MDEditor needs no class-mapping/prop encapsulation, so a passthrough wrapper would be premature abstraction.
- [ ] R2. Tighten Rule A `ui-import-seam-only` (config/rules/ui/): drop `apps/web/src/components/ui/**` from its exclude list, leaving ONLY `ui.ts` (+ tests + node_modules) exempt. Rationale: with all UI libs re-exported from `ui.ts` (R1), no wrapper imports a UI lib, so `ui.ts` becomes the TRUE single import point. The narrowed exclude enforces that invariant — any future raw UI-lib import inside `components/ui/**` is now flagged, pushing it to the `ui.ts` re-export.
- [ ] R3. Promote Rule A `ui-import-seam-only` from `warning` to `error`. Safe only AFTER R1 (the leak is gone) — promoting first would break the gate on the deferred MDEditor import.
- [ ] R4. Promote Rule B `no-daisyui-class-leak` from `warning` to `error`. KEEP `apps/web/src/components/ui/**` in Rule B's exclude — daisyUI classes are `className` strings that physically live inside the wrapper `.tsx` files (a re-export barrel cannot hold a className), so `components/ui/**` is the sanctioned class-authoring site and MUST stay exempt. (Load-bearing for Rule B forever; only Rule A's exclude narrows per R2.)
- [ ] R5. Wire the `ui` rule category into the standing gate: add `ui` to `config/rules/recommended-pre-check.yaml`'s `extends:` list (it extends by CATEGORY name — `typescript`, `structure`, `boundary`, `surface` — not by file path), so `bun run test-pre-check` discovers `config/rules/ui/`. NOTE: `test-pre-check` runs with `--fail-on warning`, so wiring in fires the rules at the WARNING threshold and FAILS the gate even pre-promotion — this is exactly why R1 (leak gone) must precede R5. Sequence: R1 → R2 → R5 → R3/R4.
- [ ] R6. Verify the full gate stays green end-to-end: `bun run lint` + `bun run test` + `bun run test-pre-check` (`--fail-on warning`) + `bun run build` (i.e. `bun run spur-check` + build). With the leak gone (R1) and `ui` wired in (R5), `spur rule run --preset recommended-pre-check` exits 0 at both warning and error thresholds.
- [ ] R7. Doc sync in the SAME commit per the doc-map conflict rules: `docs/05_FEATURES.md` (F7 status / UI-seam sub-feature); `docs/00_ADR.md` ONLY if promoting introduces a new cross-cutting decision (UI-import-seam-as-single-point boundary) — author the ADR entry first if so. No `docs/04_DESIGN.md` change for the preset itself (04 indexes the `spur rule` command surface, not individual presets).
- [ ] R8. Confirm `git status` shows only intentional changes; no `biome-ignore` added to silence the gate.
### Acceptance Criteria
```gherkin
Feature: Promote UI boundary rule to error + wire into pre-check gate

  Scenario: R1 MDEditor is re-exported from the ui.ts seam
    Given the apps/web ui.ts barrel
    When @uiw/react-md-editor is re-exported as MDEditor and the CSS side-effect is centralized
    Then MarkdownBody.tsx and TaskDetail.tsx import MDEditor from "@/ui" and zero @uiw/* references remain under apps/web/src/modules/**

  Scenario: R2 Rule A exclude narrows to ui.ts only
    Given ui-import-seam-only after MDEditor is re-exported
    When apps/web/src/components/ui/** is dropped from its exclude list
    Then only ui.ts (+ tests + node_modules) is exempt and a raw UI-lib import inside components/ui/** would be flagged

  Scenario: R3 Rule A promotes to error without breaking the gate
    Given the MDEditor leak is gone (R1)
    When ui-import-seam-only is set to severity error
    Then spur rule run exits 0 at the error threshold

  Scenario: R4 Rule B promotes to error and keeps the components/ui exclude
    Given daisyUI classes live inside components/ui/** wrapper files
    When no-daisyui-class-leak is set to severity error with components/ui/** still excluded
    Then spur rule run exits 0 and component-class authoring inside components/ui/** is not flagged

  Scenario: R5 The ui category is wired into the standing pre-check gate
    Given recommended-pre-check.yaml extends rule categories by name
    When "ui" is added to its extends list
    Then bun run test-pre-check discovers config/rules/ui/ and evaluates it at the --fail-on warning threshold

  Scenario: R6 The full gate stays green end-to-end
    Given the leak is gone and ui is wired in
    When bun run lint + test + test-pre-check + build all run
    Then every check passes and spur rule run --preset recommended-pre-check exits 0 at both warning and error thresholds

  Scenario: R7 R8 Docs are synced in the same commit and the diff is clean
    Given the promotion is the permanent enforcement step
    When docs/05_FEATURES.md (and 00_ADR.md if a new cross-cutting decision is introduced) are updated in the same commit
    Then git status shows only intentional changes and no biome-ignore was added to silence the gate
```
### Q&A
**Q (operator, during 0103): Why exclude `components/ui/**` from `ui-import-seam-only`? Can we drop it to make `ui.ts` the single point?**

Two different things flow through the seam with different physics:

1. **JS imports** (`@uiw/react-md-editor`) — CAN be fully centralized in `ui.ts` via re-export. Once every UI lib is re-exported from `ui.ts` (no wrapper imports a lib), the `components/ui/**` exclude on Rule A (`ui-import-seam-only`) becomes unnecessary and is DROPPED — `ui.ts` is then the true single import point. → R1, R2.
2. **daisyUI classes** (`btn-primary`, `select-bordered`, …) — CANNOT be centralized in `ui.ts`. They are `className` strings that physically live inside the wrapper `.tsx` files; a re-export barrel cannot hold JSX/className. So `components/ui/**` is the sanctioned class-authoring site and MUST stay in Rule B's (`no-daisyui-class-leak`) exclude forever. → R4.

**Decision:** `ui.ts` = single **import** seam (exclude narrows to `ui.ts` only). `components/ui/**` = single **class-authoring** seam (stays exempt on the class-leak rule). Two seams, not one — `ui.ts` can't absorb `components/ui/**` because a barrel can't contain className. MDEditor is moved via plain re-export, not a wrapper (nothing to encapsulate).
### Design
**Approach.** The irreversible enforcement step for the UI seam. Sequenced because the order is
load-bearing: **R1 (eliminate the leak) → R2 (narrow Rule A's exclude) → R5 (wire into pre-check) →
R3/R4 (promote to error)**. Each later step is unsafe before its predecessor.

**Why this ordering (the two non-obvious blockers).**
1. *Promotion can't precede leak removal.* `ui-import-seam-only` cannot go to `error` while
   `@uiw/react-md-editor` is still imported directly in `MarkdownBody.tsx`/`TaskDetail.tsx` — the
   gate would break. So R1 re-exports MDEditor from `ui.ts` first.
2. *Wiring fires at `warning`, not `error`.* `package.json` `test-pre-check` runs
   `spur rule run --preset recommended-pre-check --fail-on warning`. The moment `ui` is added to the
   preset (R5), the rules fail the gate at the **warning** threshold — pre-promotion. So R1 must
   precede R5, not just R3/R4.

**The two-seam model (answers the 0103 operator question — see ### Q&A).** Two different things flow
through the boundary and centralize differently:
- **JS imports** → centralize in `ui.ts` (re-export barrel). After R1, no wrapper imports a UI lib,
  so Rule A's `components/ui/**` exclude is removed (R2) and `ui.ts` is the *single import point*.
- **daisyUI classes** → cannot centralize in `ui.ts` (a barrel holds no `className`). They live in
  the wrapper `.tsx` files, so Rule B's `components/ui/**` exclude is **permanent** (R4).

**MDEditor: re-export, not wrapper.** `export { default as MDEditor } from '@uiw/react-md-editor'`
preserves `MDEditor.Markdown` and needs no class-mapping/prop encapsulation — a passthrough wrapper
would be premature abstraction.

**Wiring mechanism.** `recommended-pre-check.yaml` uses `extends: [typescript, structure, boundary,
surface]` — **category (directory) names**, not file paths. R5 adds `ui` to that list; the resolver
then discovers `config/rules/ui/`.

**Rejected alternatives.**
- *Promote in 0103*: rejected — 0103 is the warning-adoption tier; flipping to error is the permanent
  commitment and warrants its own checkpoint (DD-06 ramp).
- *Wrap MDEditor in components/ui/*: rejected — nothing to encapsulate; re-export is simpler and
  honest (see above).
- *Drop components/ui/** from BOTH rules*: rejected — only valid for Rule A (imports). Rule B's
  classes physically require the wrapper exclude.

**Invariants.**
- `ui.ts` = single **import** seam (Rule A exclude = `ui.ts` only, post-R2).
- `components/ui/**` = single **class-authoring** seam (Rule B exclude = permanent).
- Both rules at `error` after this task; any regression is blocked at `test-pre-check`.
- No `04_DESIGN.md` change for the preset (04 indexes the `spur rule` command surface, not presets).
### Plan
- [ ] R1: re-export `@uiw/react-md-editor` from `apps/web/src/ui.ts` (`export { default as MDEditor } from '@uiw/react-md-editor'`); centralize the `markdown-editor.css` side-effect into `ui.ts`/`global.css`; rewrite `MarkdownBody.tsx` + `TaskDetail.tsx` to `import { MDEditor } from '@/ui'`. Verify zero `@uiw/*` under `apps/web/src/modules/**` (`rg`).
- [ ] R2: drop `apps/web/src/components/ui/**` from `ui-import-seam-only`'s exclude (leave `ui.ts` + tests + node_modules).
- [ ] R5: add `ui` to `config/rules/recommended-pre-check.yaml` `extends:`; confirm `spur rule list --preset recommended-pre-check` now includes the two ui rules.
- [ ] R3: set `ui-import-seam-only` severity `warning` → `error`.
- [ ] R4: set `no-daisyui-class-leak` severity `warning` → `error`; confirm its `components/ui/**` exclude is retained.
- [ ] R6: run `bun run lint` → `bun run test-pre-check` → `bun run test` → `bun run build` (i.e. `bun run spur-check` + build); confirm `spur rule run --preset recommended-pre-check` exits 0 at both `--fail-on warning` and `--fail-on error`.
- [ ] R7: doc sync in the SAME commit — `docs/05_FEATURES.md` (F7 status / UI-seam sub-feature); add a `docs/00_ADR.md` entry FIRST only if the single-import-seam boundary is a new cross-cutting decision. No `04_DESIGN.md` preset change.
- [ ] R8: `git status` shows only intentional changes; no `biome-ignore` added to silence the gate. Commit `feat(rules): promote UI seam boundary to error + wire into pre-check`.
### Solution
| File | Change | What / Why |
| ---- | ------ | ---------- |
| `apps/web/src/ui.ts:5` | CSS side-effect | R1: centralize `@uiw/react-md-editor/markdown-editor.css` here (loads once). |
| `apps/web/src/ui.ts:7` | re-export | R1: `export { default as MDEditor } from '@uiw/react-md-editor'` — `ui.ts` is the single UI import point. |
| `apps/web/src/modules/task-kanban/MarkdownBody.tsx:3` | import swap | R1: `import { MDEditor } from '@/ui'` replaces the raw `@uiw/react-md-editor` import. |
| `apps/web/src/modules/task-kanban/TaskDetail.tsx:3` | import fold | R1: `MDEditor` folded into the existing `@/ui` import; raw import + centralized CSS side-effect removed. |
| `apps/web/src/modules/task-kanban/TaskDetail.tsx:40` | JSDoc | R1: reference the `MDEditor` seam (`@/ui`) instead of the raw specifier. |
| `config/rules/ui/ui-import-boundary.yaml:16` | severity | R3: Rule A `ui-import-seam-only` `warning→error`. |
| `config/rules/ui/ui-import-boundary.yaml:25` | exclude narrow | R2: drop `components/ui/**` from Rule A's exclude (imports centralize to `ui.ts`). |
| `config/rules/ui/ui-import-boundary.yaml:39` | severity | R4: Rule B `no-daisyui-class-leak` `warning→error`; `components/ui/**` exclude KEPT (classes live in wrappers). |
| `config/rules/recommended-pre-check.yaml:13` | extends | R5: add `ui` so `test-pre-check` enforces the seam at the standing gate. |
| `docs/00_ADR.md:636` | consequence note | R7: ADR-025 — single UI import seam is the enforcement *mechanism*, not a new decision (no new ADR). |
| `docs/05_FEATURES.md:81` | status row | R7: §4 Rules — UI seam-boundary preset ✅ (0103 warning → 0104 error). |

**Outcome.** R1 eliminated the last UI-lib leak (zero `@uiw/*` imports under `apps/web/src/modules/**`; only `apps/web/src/ui.ts:7` imports it). R2 narrowed Rule A's exclude to `ui.ts` only; R3/R4 promoted both rules to `error` (Rule B keeps `components/ui/**`). R5 wired `ui` into `recommended-pre-check`. R7 synced docs in-commit: ADR-025 consequence note (no new ADR — mechanism, not decision) + 05_FEATURES §4 row.

**Gate (R6):** `bun run lint` ✓ · `bun run test` ✓ 1895 pass / 0 fail · `bun run test-cf` ✓ · `bun run build` ✓ · `spur rule run --preset recommended-pre-check` exits 0 at both `--fail-on warning` and `--fail-on error`.

**Browser verification NOT performed (auto-chain limitation).** The MDEditor seam refactor moves a live React import + a fragile CSS side-effect (`0101 #4`). `bun run build` proves import + CSS resolve through Vite and component tests pass — but markdown rendering/editor styling was NOT visually confirmed in a browser. Recommend a manual smoke test of the task-detail panel (preview + edit modes, code-block styling) before merge.
### Testing

**Verdict: PASS** — all 8 requirements MET. Evidence below.

| Req | Status | Evidence |
| --- | ------ | -------- |
| R1 | MET | `MDEditor` re-exported from `apps/web/src/ui.ts:7`; CSS side-effect at `apps/web/src/ui.ts:5`; `apps/web/src/modules/task-kanban/MarkdownBody.tsx:3` + `apps/web/src/modules/task-kanban/TaskDetail.tsx:3` import from `@/ui`. `rg` → zero `@uiw/*` imports under `apps/web/src/modules/**`; only `ui.ts` imports the lib. |
| R2 | MET | `config/rules/ui/ui-import-boundary.yaml:25-28` — Rule A exclude = `ui.ts` + tests + node_modules (dropped `components/ui/**`). Authoritative probe: a raw UI-lib import placed inside `components/ui/` is **now flagged** (1 finding) — pre-0104 it was exempt. |
| R3 | MET | `config/rules/ui/ui-import-boundary.yaml:16` — `ui-import-seam-only` severity `error`. `spur rule run` exits 0 at `--fail-on error` (leak gone). |
| R4 | MET | `config/rules/ui/ui-import-boundary.yaml:39` — `no-daisyui-class-leak` severity `error`; `components/ui/**` retained in its exclude (`:45`) — the sanctioned class-authoring site. |
| R5 | MET | `config/rules/recommended-pre-check.yaml:13` extends `ui`; `rule list --preset` shows both ui rules; `test-pre-check` (`--fail-on warning`) exits 0. |
| R6 | MET | `lint` 0 · `test` 1895 pass / 0 fail · `test-cf` 0 · `build` 0; preset run exits 0 at both `--fail-on warning` and `--fail-on error`. |
| R7 | MET | `00_ADR.md` ADR-025 consequence note (NO new ADR — the seam is the enforcement *mechanism*, not a new decision; ADR-025 already owns the `@uiw/react-md-editor` choice); `05_FEATURES.md §4` status row added. |
| R8 | MET | `git status` shows only intentional changes; no `biome-ignore` added to silence the gate. |

**Checks:** lint ✓ · test 1895/0 ✓ · test-cf ✓ · build ✓ · preset@error ✓ · preset@warning ✓ · **browser smoke ⚠ NOT performed** (auto-chain limitation — see Review).

### Review


SECU pass over the 0104 change surface: 3 web TS files (seam refactor), 2 rule YAML files, 2 docs.

| # | Severity | Dimension | Finding |
| - | -------- | --------- | ------- |
| 1 | P2 (major / process) | Correctness | **Browser verification not performed.** R1 relocates a live React import (`MDEditor`) and a fragile CSS side-effect (`@uiw/react-md-editor/markdown-editor.css`, the `0101 #4` styling fix) from `TaskDetail.tsx` into `ui.ts`. `bun run build` proves both resolve through Vite and component tests pass — but the markdown **preview rendering and editor styling were not visually confirmed**. The CSS now loads via `ui.ts` (a TS module) rather than the previous direct import; load order/scoping should be eyeballed. Recommend a manual smoke test of the task-detail panel (preview + edit modes, fenced code-block styling, mermaid block) before merge. Not a blocker for the rule/doc work, but gates the UI refactor. |
| 2 | P4 (minor) | Correctness | `daisyui` remains in Rule A's `forbidden` list though it is never a JS import (Tailwind plugin via `global.css`). Harmless (can never fire) but dead config — a future cleanup could drop it, leaving class-leak coverage to Rule B. Out of 0104's scope. |

**Security:** none — declarative rules + re-export wiring; no secrets, shell, or dynamic eval introduced. **Efficiency:** CSS now loads once via the shared `ui.ts` barrel (was per-`TaskDetail`-import) — neutral-to-better. **Usability:** rule descriptions clearly state the two-seam model; ADR-025 note + 05_FEATURES row make the boundary discoverable.

No P1 blockers. The P2 is a process gap (visual confirmation), not a code defect — flagged honestly because an `--auto` chain cannot perform it.

### History
- 2026-06-26T07:38:09.446Z todo → wip (system)
- 2026-06-26T07:38:37.560Z wip → testing (system)
- 2026-06-26T15:45:19.651Z testing → done (system)
