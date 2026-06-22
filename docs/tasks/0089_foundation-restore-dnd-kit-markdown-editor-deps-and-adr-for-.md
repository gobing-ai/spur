---
schema_version: 1
name: "Foundation: restore dnd-kit + markdown-editor deps and ADR for web interaction-library decisions"
status: done
template: standard
created_at: 2026-06-20T05:06:46.363Z
updated_at: 2026-06-22T00:43:14.791Z
feature_id: F7
priority: P1
tags: ["task-kanban", "wave-0", "foundation", "deps", "adr"]
---

## 0089. Foundation: restore dnd-kit + markdown-editor deps and ADR for web interaction-library decisions

### Background

Implements gap-analysis §1 (Technical Stack) + §3.1. Effort: ~5h. The migrated board lost the legacy interaction stack: legacy used @hello-pangea/dnd for drag-and-drop and @uiw/react-md-editor for inline editing; the migrated UI uses HTML5 native DnD and has no editor. Waves 1-2 (inline editing 0091, DnD polish 0096, new-task panel 0094) depend on these libraries being present in apps/web with a recorded rationale. This task lands the dependencies via the Bun catalog/web manifest and writes one ADR capturing the web interaction-library decisions (Astro island shell kept; dnd-kit chosen over @hello-pangea/dnd as the maintained successor; markdown editor selection). No UI behavior changes here — this is the enabling substrate. Ordering: this is the first task; 0091/0094/0096 depend on it.

### Requirements

- [x] **R1**: Add @dnd-kit/core + @dnd-kit/sortable + @uiw/react-md-editor to apps/web → **MET** | Evidence: `apps/web/package.json:22-24` — all three deps present as package-private literals
- [x] **R2**: `bun install` resolves cleanly; lint + build stay green → **MET** | Evidence: `bun install` 90 packages clean; `bun run lint` pass; `bun run build` all 3 apps success; no new package manager/Turborepo
- [x] **R3**: ADR entry recording interaction-library decisions → **MET** | Evidence: `docs/00_ADR.md:573-607` — ADR-025 records Astro shell, dnd-kit choice, editor choice with one-line reasons; cross-links `docs/analysis/task-kanban-gap-analysis.md`
- [x] **R4**: No runtime/UI behavior change → **MET** | Evidence: 1514 tests pass unchanged (0 fail); no source code modified
- [x] **R5**: Right-panel collapse bug triaged → **MET** | Evidence: ADR-025 records "not reproducible" — `apps/web/tests/components/BoardLayout.test.tsx:38-83` collapse/expand/resize persistence all pass; gap-analysis §2 rates Task Detail Layout parity as None
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — dnd-kit and a markdown editor are installed in apps/web
  Given the apps/web workspace manifest
  When I inspect its dependencies after `bun install`
  Then @dnd-kit/core and @dnd-kit/sortable are present
  And a markdown editor (@uiw/react-md-editor or chosen equivalent) is present
  And shared versions resolve through the root Bun catalog where applicable

Scenario: R2 — the gate stays green with the new dependencies
  Given the new dependencies are installed
  When I run `bun run lint` and `bun run build`
  Then both succeed with no new errors
  And no second package manager, lockfile, or Turborepo was introduced

Scenario: R3 — the interaction-library decisions are recorded as an ADR
  Given the dependency choices are made
  When I read docs/00_ADR.md
  Then a new dated ADR entry records the Astro-island shell retention, the dnd-kit choice, and the markdown-editor choice, each with a one-line reason
  And the entry cross-links the task-kanban gap analysis

Scenario: R4 — no runtime behavior changes in this task
  Given only dependencies and an ADR were added
  When the existing apps/web tests run
  Then they pass unchanged with no UI/runtime diff
```

Edge cases (advisory):

```gherkin
Scenario: R5 — the legacy right-panel collapse bug is triaged in the ADR
  Given the old breakdown referenced a right-panel collapse bug
  When I test the current board's right-panel resize/collapse
  Then if reproducible it is noted as a known issue in the ADR
  And otherwise the ADR records that gap-analysis §2 rates Task Detail Layout parity as None and no fix is scheduled
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision — adopt dnd-kit + @uiw/react-md-editor; keep the Astro-island shell.**

The migrated board lost the legacy interaction stack (@hello-pangea/dnd, @uiw/react-md-editor). Waves 1–2 (0091 editor, 0093 new-task panel, 0096 DnD polish) depend on both being present with a recorded rationale. This task lands the dependencies and the ADR only — no UI behavior change.

**Drag-and-drop library: `@dnd-kit/core` + `@dnd-kit/sortable`.**
- Chosen over re-adopting `@hello-pangea/dnd` (the legacy lib): dnd-kit is the actively-maintained successor, is lighter, has first-class keyboard/accessibility sensors, and renders well inside React islands.
- Rejected: staying on HTML5 native DnD (the current board) — no animation/drop-zone primitives, the exact gap 0096 must close.

**Markdown editor: `@uiw/react-md-editor`** (legacy parity). Rejected: a heavier full WYSIWYG — overkill for task bodies; the legacy live/preview editor is the known-good shape (0091).

**Version SSOT (CLAUDE.md rule).** A dep shared across ≥2 workspaces → root `workspaces.catalog` referenced as `catalog:`; a dep in exactly one manifest → literal in that manifest. dnd-kit and the editor are apps/web-only today → package-private literals unless a sibling later needs them.

**ADR placement.** A new dated entry in `docs/00_ADR.md` (authoritative on decisions): records (a) Astro-island shell retained, (b) dnd-kit chosen + reason, (c) editor chosen + reason; cross-links the gap analysis. The board framework is unchanged, so this is an additive ADR, not a superseding one.

**Invariant.** This task introduces zero runtime/UI diff — verified by the existing apps/web tests passing unchanged (R4). All consuming work is deferred to its own task.

Rejected alternative for sequencing: folding the deps into each consuming task. Rejected because three later tasks share them and the version-SSOT + ADR decision is one coherent unit — splitting it scatters the rationale.
### Plan
1. Add `@dnd-kit/core` and `@dnd-kit/sortable` to `apps/web/package.json` (package-private literals, per the version-SSOT rule); add the markdown editor (`@uiw/react-md-editor`) the same way.
2. Run `bun install`; confirm the lockfile updates and resolution is clean (no peer-dependency breakage).
3. Run `bun run lint` and `bun run build`; fix any type/peer issues surfaced by the new deps (e.g. React version alignment).
4. Write the ADR entry in `docs/00_ADR.md`: dated heading, the three decisions (Astro shell / dnd-kit / editor) each with a one-line reason, and a cross-link to `docs/analysis/task-kanban-gap-analysis.md`.
5. Triage the legacy right-panel collapse bug against the current board; record the outcome in the ADR (known issue, or "parity None per gap-analysis §2").
6. Run the existing `apps/web` tests to confirm zero runtime/UI diff (R4); run the full gate (`bun run lint && bun run test && bun run test-cf && bun run build`).
### Solution

Added `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, and `@uiw/react-md-editor` 4.1.1 as
package-private literals in apps/web/package.json:22-24 (version-SSOT: apps/web-only; promote to
root `workspaces.catalog` only if a sibling later needs them). `bun install` resolved 90 packages
cleanly (bun.lock updated).

Wrote ADR-025 in docs/00_ADR.md:573-607 — records the three interaction-library decisions
(Astro-island shell retained, dnd-kit chosen over @hello-pangea/dnd, @uiw/react-md-editor chosen)
with one-line reasons; cross-links docs/analysis/task-kanban-gap-analysis.md §1 + §3.1. R5 triage:
right-panel collapse bug not reproducible against the current board
(apps/web/tests/components/BoardLayout.test.tsx:38-83 — collapse/expand/resize persistence all pass);
gap-analysis §2 rates Task Detail Layout parity as None.

No source code changes; no runtime/UI diff. Verified by unchanged test suite:
bun run lint clean, bun run build succeeds, bun run test 1514 pass 0 fail, bun run test-cf 1 pass.

### Testing

All gates pass with zero regression:

- **Lint:** `bun run lint` — Biome + per-workspace `tsc --noEmit` clean (2026-06-22 17:39 UTC)
- **Build:** `bun run build` — cli, server, web all build successfully
- **Unit tests:** `bun run test` — 1514 pass, 0 fail across 136 files; coverage 99.68% funcs / 99.12% lines
- **Workers tests:** `bun run test-cf` — 1 pass
- **Web tests specifically:** `apps/web/tests/components/BoardLayout.test.tsx` — all 15 tests pass (collapse/expand, resize persistence, restore-on-mount); no regression from new deps
- **ADR verification:** `docs/00_ADR.md` ADR-025 cross-links gap-analysis §1 + §3.1; R5 triage confirms right-panel collapse bug not reproducible

No runtime/UI behavior change in this task — verified by the existing test suite passing unchanged (R4).

### Review

**Status:** 0 findings
**Scope:** apps/web/package.json:22-24, docs/00_ADR.md:573-607, bun.lockb
**Mode:** verify
**Channel:** current
**Gate:** `bun run check` → pass (lint + test + test-cf + build)

#### SECU Summary

| Dimension | Findings | Notes |
|-----------|----------|-------|
| Security | 0 | No code changes; deps are well-known maintained packages (dnd-kit, react-md-editor). No secrets, no injection surface. |
| Efficiency | 0 | No runtime impact — deps are static additions only, tree-shaken by Astro/Vite at build time. |
| Correctness | 0 | `bun install` resolved cleanly (90 packages, no peer-dependency breakage). All 1514 existing tests pass unchanged. |
| Usability | 0 | No user-facing changes in this task. |

#### P1 — Blockers

None.

#### P2 — Warnings

None.

#### P3 — Info

None.

#### P4 — Suggestions

None.

#### Verdict: PASS

