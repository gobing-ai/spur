---
name: "W3: Prompt-skill moves — brainstorm, anti-hallucination, daily-summary"
description: "W3: Prompt-skill moves — brainstorm, anti-hallucination, daily-summary"
status: done
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-15T04:35:07.330Z
folder: docs/tasks
type: task
feature-id: H3
priority: P2
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0069. "W3: Prompt-skill moves — brainstorm, anti-hallucination, daily-summary"

### Background

Delivery doc §7.2 dispositions. brainstorm: move + plan scenario-command set; anti-hallucination: move-only; daily-summary: verify+enhance before adoption (script stays embedded).


### Requirements

R1. sp:brainstorm moved; scenario-specific command candidates listed for Stage-later.
R2. sp:anti-hallucination moved verbatim.
R3. sp:daily-summary verified working, enhanced, then adopted; no CLI extraction.


### Q&A



### Design

Authority: delivery doc §7.2 dispositions — `sp:brainstorm`: move + record scenario-specific command
candidates for later (today's skill too generic); `sp:anti-hallucination`: move verbatim (K05 — stays a
skill forever); `sp:daily-summary`: verify-and-enhance **before** adoption, script stays embedded (I16 —
no CLI extraction). Source skills live in `cc-agents/plugins/rd3/skills/`. Removal side is cc-agents
task 0406, gated on this landing.


### Solution

Moved the three rd3 prompt-skills into `plugins/sp/skills/` per delivery §7.2 dispositions, with the
namespace rewrites + the fixes each move needed to actually run in the sp plugin.

**`sp:brainstorm`** (R1, move — `plugins/sp/skills/brainstorm/`): SKILL + references + example.
Rewrote `rd3:`→`sp:` self-refs; re-pointed delegations to what sp/spur actually has —
research/synthesis → `spur agent run` (the single LLM surface, 0068), task breakdown → `sp:spur-dev`,
task files → `sp:spur-tasks`; verification → `sp:anti-hallucination`. Fixed a stale CLI shape (the
0064 trap): `tasks batch-create --from-json decomposition.json` → `spur task batch-create <file>`
(bare JSON array). Recorded the scenario-command candidate list in a new Notes section (R1 — captured,
not shipped).

**`sp:anti-hallucination`** (R2, verbatim — `plugins/sp/skills/anti-hallucination/`): 22 files incl. 8
scripts + 5 test files. "Verbatim" can't mean "broken": the move surfaced two breaks — the scripts/tests
imported the rd3 plugin's `../../../scripts/logger` (gone in sp) and hardcoded `plugins/rd3/...` paths.
Added a self-contained `scripts/logger.ts` (exactly the used API: `logger.log` + `isGlobalSilent`/
`setGlobalSilent`), re-pointed the imports, and fixed the paths. 95 tests now pass (were 0/8 + 4 errors).

**`sp:daily-summary`** (R3, verify + enhance — `plugins/sp/skills/daily-summary/`): SKILL + embedded
script + test. R3's gate is "run it end-to-end" — doing so surfaced the same rd3-logger-import break.
Fixed with a self-contained `scripts/logger.ts` (script stays embedded, no CLI extraction — I16). Then
ran it: `--help` works, `--dry-run` produces a full markdown summary, and it degrades gracefully when
`ccusage` isn't on PATH (warns + continues). 56 tests pass. Verified working → adopted.


### Plan

- [x] R1: `sp:brainstorm` moved → `plugins/sp/skills/brainstorm/` (SKILL + references + example); namespace-rewritten (`rd3:`→`sp:`, `platform: sp`); research/synthesis re-pointed at `spur agent run`, task creation at `sp:spur-dev`/`sp:spur-tasks`; fixed a stale CLI shape (`tasks batch-create --from-json` → `spur task batch-create <file>`)
- [x] R1: scenario-specific command candidates recorded in the skill's Notes (`brainstorm-arch`/`-fix`/`-feature`/`-stack`/`-refactor`) — none shipped now; ADR-016 test deferred to the later batch
- [x] R2: `sp:anti-hallucination` moved verbatim → `plugins/sp/skills/anti-hallucination/` (22 files incl. 8 scripts + 5 test files); to make "verbatim" actually run: added self-contained `scripts/logger.ts`, fixed rd3-relative logger imports + hardcoded `plugins/rd3/` paths; 95 tests green
- [x] R3: `sp:daily-summary` moved → `plugins/sp/skills/daily-summary/`; VERIFIED end-to-end (`--help` + `--dry-run` produce a summary; degrades gracefully without `ccusage`); script stays embedded (no CLI extraction); self-contained `scripts/logger.ts`; 56 tests green
- [x] All three fully namespace-clean (no residual `rd3:` / `plugins/rd3/` / `platform: rd3`)
- [x] Same-commit doc-sync: delivery §7.2 all three rows `proposed → shipped (0069)`
- [x] Flag: cc-agents task 0406 (removal side) is gated on this landing — now satisfied; the note belongs in the cc-agents repo (outside this workspace), recorded here as the unblock signal


### Review

**SECU verdict: FAIL (unbuilt) → PASS** (verified + built 2026-06-14 via `/rd3:dev-verify 0069 --auto --fix all --force`)

The `/rd3:dev-run` loop moved **none** of the three prompt-skills — `plugins/sp/skills/` had only the 5
sp-native skills. All of R1/R2/R3 unmet. Moved all three from the rd3 source, with the namespace
rewrites + the breaks each move surfaced.

**S — Security:** Moved skills include executable scripts (anti-hallucination wrappers, daily-summary
generator). No secrets; the wrappers shell out to agent CLIs the user already has (same trust model as
`spur agent run`). The embedded loggers only gate `console` output. No injection surface added.

**C — Correctness / architecture:**
- R1 ✓ brainstorm moved, namespace-clean, delegations re-pointed to real sp/spur targets, scenario-command
  candidates recorded; fixed a stale `--from-json` CLI shape (the 0064 invented-flag class).
- R2 ✓ anti-hallucination moved; "verbatim" required a self-contained logger + path fixes to actually
  run — 95 tests green (were broken on arrival).
- R3 ✓ daily-summary moved + verified end-to-end (the script runs; dry-run produces a summary; graceful
  ccusage-absent degradation); script stays embedded (no CLI extraction).

**U — Usability:** all three invocable from this repo under the `sp:` namespace; SKILL.md usage examples
point at the correct `plugins/sp/...` paths.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | All three prompt-skills unmoved — dev-run produced nothing. R1/R2/R3 unmet. | Correctness | `plugins/sp/skills/` | P1 | **FIXED** — moved all three + tests. |
| 2 | "Verbatim" anti-hallucination move was broken on arrival: rd3-relative `../../../scripts/logger` import + hardcoded `plugins/rd3/` paths → 0/8 tests, 4 errors. | Correctness | `anti-hallucination/scripts`, `tests` | P1 | **FIXED** — self-contained `scripts/logger.ts` + path rewrites; 95/95 pass. |
| 3 | daily-summary script broke on the same rd3-logger import (caught by R3's end-to-end run). | Correctness | `daily-summary/scripts/daily-summary.ts` | P2 | **FIXED** — self-contained logger; 56/56 pass; runs end-to-end. |
| 4 | brainstorm carried a stale CLI shape (`tasks batch-create --from-json`) and dangling `rd3:` delegations. | Correctness | `brainstorm/SKILL.md`, `references` | P2 | **FIXED** — real `spur task batch-create <file>`; delegations re-pointed to sp/spur. |
| 5 | First-pass embedded loggers shipped unused methods → function-coverage dip below 90%. | Correctness | `*/scripts/logger.ts` | P3 | **FIXED** — trimmed to the used API; 100% covered. |
| 6 | Same-commit doc-sync: delivery §7.2 dispositions still `proposed`. | Process | delivery §7.2 | P2 | **FIXED** — all three → `shipped (0069)`. |

No remaining P1/P2.

**Gate:** lint clean · test 1266 pass / 0 fail (coverage holds) · test-cf 1 pass · build OK · all three
skills namespace-clean and invocable.

**Cross-repo follow-up:** cc-agents task 0406 (the removal side) is gated on this landing — now satisfied.
The note belongs in the cc-agents repo (outside this workspace), so it is recorded here as the unblock
signal rather than written to a foreign repo.


### Testing

Verified 2026-06-14. Skill-move task — verified by running each moved skill's tests + (R3) the script
end-to-end.

- **R1 brainstorm:** prose skill, no tests of its own; verified by namespace grep (zero residual
  `rd3:`/`plugins/rd3/`/`platform: rd3`) and that every delegation target exists in sp (`sp:anti-hallucination`,
  `sp:spur-dev`, `sp:spur-tasks`, `spur agent run`). Stale `--from-json` CLI shape corrected to the real
  `spur task batch-create <file>`.
- **R2 anti-hallucination:** `bun test plugins/sp/skills/anti-hallucination/tests/` → 95 pass / 0 fail
  (was 0 pass / 8 fail + 4 errors before the logger + path fixes). Covers the guard, validators, and the
  per-agent wrappers (codex/opencode/openclaw/pi) at the new location.
- **R3 daily-summary:** `bun test .../daily-summary/tests/` → 56 pass / 0 fail. End-to-end run:
  `bun run .../scripts/daily-summary.ts --help` prints usage; `--dry-run` generates the markdown summary
  and degrades gracefully when `ccusage` is absent (`logger.warn`, continues). Verified working → adopted.
- **Self-contained loggers:** both embedded `scripts/logger.ts` files are exactly the used API and 100%
  covered (no unused methods — trimmed after the first pass dipped function coverage).

**Status before verify:** UNBUILT — `plugins/sp/skills/` held only the 5 sp-native skills; none of the
three rd3 prompt-skills were moved. R1/R2/R3 all unmet; moved + fixed from the rd3 source here.

Gate: `bun run lint` clean · `bun run test` 1266 pass / 0 fail (+151; coverage threshold holds, exit 0) ·
`bun run test-cf` 1 pass · `bun run build` all workspaces OK.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


