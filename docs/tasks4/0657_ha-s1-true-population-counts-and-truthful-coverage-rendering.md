---
schema_version: 1
name: "HA-S1: true population counts and truthful coverage rendering in the history forensics artifact"
status: done
template: feature-impl
created_at: 2026-08-25T04:06:58.483Z
updated_at: "2026-08-25T05:19:53.922Z"
feature_id: I8
priority: P2
tags: ["history", "analytics", "ha-s1"]
---

## 0657. HA-S1: true population counts and truthful coverage rendering in the history forensics artifact

### Background

Prefactor for feature I8. The daily `history-anatomy` report inherits every coverage claim the
forensics renderer makes, so the renderer must stop overstating coverage before anything consumes it.

**Verified against the tree on 2026-08-24:**

| Claim | Evidence |
| --- | --- |
| The `Sessions` metric prints a bounded array length | `packages/domain/src/analytics/render-forensics.ts:54` |
| The Raw Data counts line repeats it for sessions/tools/loops/warnings | `packages/domain/src/analytics/render-forensics.ts:381` |
| `analyze --top` (default `20`) bounds `bySession` / `byTool` | `packages/app/src/services/history-service.ts:439-440`; `apps/cli/src/commands/history.ts` `--top` default `'20'` |
| `CoverageEntry` already carries `lastImportedAt`, `parseErrors`, `validationErrors` and sample arrays | `packages/domain/src/analytics/artifact.ts:51-70` |
| …but the rendered coverage table shows only six columns and drops all of them | `packages/domain/src/analytics/render-forensics.ts:386-395` |
| Warnings render as codes only, never detail | `packages/domain/src/analytics/render-forensics.ts:383` |
| Error samples are capped at `MAX_ERROR_SAMPLES` with no truncation indicator downstream | `packages/app/src/services/history-service.ts:735-736` |
| `CacheWasteStat` already models "full count + bounded ranking" — the shape to copy | `packages/domain/src/analytics/artifact.ts:154-162` |
| Additive fields do not bump the schema version | `packages/domain/src/analytics/artifact.ts:75-77` |
| Render-time `--top` re-slices client-side, so narrowing must not corrupt the population | `packages/domain/src/analytics/narrow-artifact.ts:85-97` |

**Consent.** HA-S1 was granted explicit operator surface consent on 2026-08-24 under the ADR-051
gate: additive artifact fields and renderer changes inside the shipped `analyze` / `report --mode
forensics` surfaces. It does **not** authorize a new verb or flag.

Decision record: ADR-080. Shapes: `docs/design/history-anatomy.md` §HA-S1.

### Requirements

- [x] R1. `spur history analyze` records, for each bounded leaderboard, the true selection population and the applied leaderboard depth. The bounded `bySession` / `byTool` arrays keep their existing shape and cap.
- [x] R2. The forensics renderer reports the true population rather than the bounded array length, and labels each leaderboard as `top N of M`. No bounded array length is presented as a total anywhere in the renderer, including the counts line at `:381`.
- [x] R3. The forensics coverage section renders per-source `lastImportedAt`, parse-error and validation-error counts, an indicator when error samples were truncated, and warning detail rather than only a warning count.
- [x] R4. An artifact written before these fields existed still renders: absent population and depth values read `not available`, and no population figure is reconstructed from an array length.
- [x] R5. Tests pin true population counts, bounded ranking labels, last-import and error rendering, and pre-addition backward compatibility. No new `spur history` verb or flag is added.
- [x] R6. `docs/04_DESIGN.md` records the additive artifact fields and the renderer change in the same commit (T3).

### Acceptance Criteria

```gherkin
Feature: HA-S1 — true population counts and truthful coverage rendering

  @core
  Scenario: R29 — The analyze artifact records true selection population and applied depth
    Given a window whose selection contains more sessions and tools than the applied leaderboard depth
    When "spur history analyze --top <n>" writes the artifact
    Then the artifact records the true total session population and the true total tool population for the selection
    And it records the applied leaderboard depth
    And the bounded "bySession" and "byTool" arrays remain at most the applied depth

  @core
  Scenario: R30 — The forensics renderer reports "top N of M" instead of a bounded array length
    Given an artifact whose true session population exceeds the applied leaderboard depth
    When "spur history report --mode forensics" renders it
    Then the sessions figure reports the true population, not the bounded array length
    And each leaderboard is labeled with its applied depth against the true population
    And no bounded array length is presented as a total

  @core
  Scenario: R31 — The coverage section renders freshness and error detail the artifact already carries
    Given an artifact whose coverage entries carry lastImportedAt, parse errors, validation errors and sample overflow
    When the forensics report renders its coverage section
    Then it shows per-source lastImportedAt
    And it shows parse-error and validation-error counts
    And it indicates when error samples were truncated
    And it renders warning detail rather than only a warning count

  @core
  Scenario: R32 — Pre-addition artifacts still render without the new fields
    Given an artifact written before the HA-S1 fields existed
    When "spur history report --mode forensics" renders it
    Then rendering succeeds
    And the absent population and depth values render as "not available"
    And no population figure is fabricated from the bounded array length
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT.** One additive optional block on `HistoryArtifact` carrying the true selection population
plus the leaderboard depth that was applied, and the renderer changes that consume it. No new
`spur history` verb, no new flag, no schema-version bump.

**WHY.** `render-forensics.ts:54` renders `artifact.bySession.length` as the `Sessions` metric and
`:381` repeats the pattern for sessions/tools/loops/warnings — but `analyze --top` (default `20`)
bounds `bySession` and `byTool` at `history-service.ts:439-440`. Any selection with more than `top`
sessions therefore publishes a false coverage figure. Feature I8's daily report inherits every
coverage claim this renderer makes, so the artifact must stop overstating coverage before anything
consumes it. Decision: ADR-080.

**WHERE.**

| File | Change |
| --- | --- |
| `packages/domain/src/analytics/artifact.ts` | add `SelectionPopulation`; add optional `population?` to `HistoryArtifact` |
| `packages/app/src/services/history-service.ts` | `analyze()` (~:403-460) populates `population` from unbounded count queries |
| `packages/domain/src/analytics/render-forensics.ts` | `renderSessionSummary` `:54`, `renderRawData` `:381` counts line, `:383` warning codes, `:386-395` coverage table |
| `packages/domain/src/analytics/narrow-artifact.ts` | `:85-97` — re-slicing lowers `appliedTop`, never `population` counts |

**Frozen names.**

```ts
/** True selection population behind the bounded leaderboards (HA-S1, ADR-080). */
export interface SelectionPopulation {
    /** Distinct sessions in the selection — NOT bounded by `top`. */
    sessions: number;
    /** Distinct tools in the selection — NOT bounded by `top`. */
    tools: number;
    /** Loop findings in the selection. */
    loops: number;
    /** Warnings attached to the artifact. */
    warnings: number;
    /** Leaderboard depth applied when the bounded arrays were built (`analyze --top`). */
    appliedTop: number;
}

// on HistoryArtifact — additive, absent on pre-HA-S1 artifacts:
population?: SelectionPopulation;
```

Renderer helper (new, module-private to `render-forensics.ts`):

```ts
function fmtTopOf(boundedLength: number, population: number | undefined, appliedTop: number | undefined): string
// population present and > boundedLength  -> "top 20 of 35"
// population present and <= boundedLength -> "35"           (whole population shown)
// population undefined                    -> "not available"
```

**Precedent to follow — do not invent a second shape.** `CacheWasteStat` (`artifact.ts:154-162`)
already models exactly this: a full-selection aggregate (`steps`, "full count, not bounded by
`top`") beside a bounded ranking (`topSteps`). `SelectionPopulation` is the same pattern generalized;
match its comment style and its optionality convention.

**Precedence / algorithm.**

1. `analyze()` issues unbounded `COUNT(DISTINCT …)` queries for sessions and tools over the same
   selector the bounded leaderboards use. The counts must come from the selector, not from
   `bySession.length` — deriving them from the bounded arrays reintroduces the exact defect.
2. `appliedTop` is the `top` value `analyze()` actually used (`opts.top ?? 20`, `:403`).
3. `narrowArtifact` re-slicing (`--top` at render time, `:87-97`) sets
   `appliedTop = min(requestedTop, existing appliedTop)` and leaves every population count untouched.
   Narrowing the view never narrows the truth.
4. Renderer reads `population` only. It never falls back to an array length.

**Anti-patterns — do not implement.**

- Do **not** bump `HISTORY_ARTIFACT_SCHEMA_VERSION`. The comment at `artifact.ts:75-77` reserves
  version bumps for removed or retyped fields; this is purely additive.
- Do **not** make `population` required. A pre-HA-S1 artifact must still render (R32).
- Do **not** compute `population.sessions` as `bySession.length` anywhere, including tests and
  fixtures — that is the bug wearing the fix's name.
- Do **not** add a `--population` / `--full-counts` flag. ADR-051 gates public CLI surface changes;
  HA-S1's operator consent covers additive artifact/renderer work only.
- Do **not** widen the bounded arrays or change the `--top` default. The rankings stay bounded;
  only the *labeling* becomes truthful.
- Do **not** touch the importer, the database schema, or `spur history daily`.

**Coverage-table shape** (`renderRawData`, replacing the six-column table at `:386-395`):

```
| Source | Status | Files | Messages | Tool calls | Unknown | Last imported | Parse err | Validation err |
```

`lastImportedAt` renders `not available` when `null`. When
`parseErrorSamples.length === 20` (the `MAX_ERROR_SAMPLES` cap at `history-service.ts:735`),
append a truncation note naming the source rather than silently showing 20. Warning rendering
changes from the code-only line at `:383` to one `code — detail` line per warning.

**Handoff.** 0658 (skill) and 0659 (cache helper) both depend on this task: the report contract's
coverage section and the cache helper's semantic digest read `population`. Freeze
`SelectionPopulation`'s field names here; downstream tasks consume them verbatim and must not
rename or re-shape them.

### Plan

- [x] 1. Add `SelectionPopulation` and the optional `population?` field to `HistoryArtifact`
      (`packages/domain/src/analytics/artifact.ts`), matching the `CacheWasteStat` comment style.
      Confirm `HISTORY_ARTIFACT_SCHEMA_VERSION` stays `1`. (R1)
- [x] 2. Populate it in `HistoryService.analyze()` from unbounded `COUNT(DISTINCT …)` queries over
      the active selector, with `appliedTop` = the `top` actually used. Never derive a count from a
      bounded array. (R1)
- [x] 3. Update `narrowArtifact` so a render-time `--top` lowers `appliedTop` to
      `min(requested, existing)` and leaves every population count untouched. (R1)
- [x] 4. Add the module-private `fmtTopOf` helper to `render-forensics.ts`; replace the `Sessions`
      metric at `:54` and the counts line at `:381` so they read the population and label each
      leaderboard `top N of M`. Grep the whole renderer for any remaining `.length` used as a
      total. (R2)
- [x] 5. Widen the coverage table at `:386-395` with `Last imported`, `Parse err` and
      `Validation err`; add the sample-truncation note keyed on `MAX_ERROR_SAMPLES`; replace the
      warning-codes line at `:383` with per-warning `code — detail` lines. (R3)
- [x] 6. Tests — `packages/domain/tests/analytics/`: population > applied depth renders `top N of
      M`; population == bounded length renders the plain count; a pre-HA-S1 artifact (no
      `population`) renders `not available` and never fabricates from `.length`; coverage columns
      and the truncation note render; `narrowArtifact` lowers `appliedTop` without touching counts.
      Extend `narrow-artifact.test.ts` rather than starting a parallel suite. (R5)
- [x] 7. Service-level test in `packages/app/tests/` proving `analyze --top 2` over a fixture with
      more than two sessions writes the true population, not `2`. (R1, R5)
- [x] 8. Record the additive artifact fields and the renderer change in `docs/04_DESIGN.md`
      (same-commit T3). Confirm no new verb or flag appears in `apps/cli/src/commands/history.ts`. (R6)
- [x] 9. Gate: targeted tests first (`bun test <file> --test-name-pattern …`), then
      `bun run spur-check`.

### Solution

**Goal:** stop the forensics renderer from overstating coverage — record the true selection
population + applied leaderboard depth on the artifact, render `top N of M` truthfully, and surface
the per-source freshness/error detail the artifacts already carry.

| File | Change |
| --- | --- |
| `packages/domain/src/analytics/artifact.ts:165` | Added the `SelectionPopulation` interface (sessions, tools, loops, warnings, appliedTop). |
| `packages/domain/src/analytics/artifact.ts:245` | Added the optional additive `population?` field on `HistoryArtifact`; schema version stays 1. |
| `packages/domain/src/analytics/forensic-query.ts:464` | Added `selectionPopulation`, returning unbounded distinct session/tool counts over the active selector. |
| `packages/domain/src/analytics/index.ts:67` | Exported `selectionPopulation`. |
| `packages/app/src/services/history-service.ts:459` | `analyze()` added `selectionPopulation` to the shared Promise.all query batch. |
| `packages/domain/src/analytics/render-forensics.ts:375` | `renderRawData` renders Counts via `fmtTopOf`, per-warning `code — detail` lines, and a widened coverage table. |
| `packages/domain/src/analytics/render-forensics.ts:422` | Added module-private `fmtTopOf` (`top N of M` / plain count / `not available`). |
| `packages/domain/src/analytics/narrow-artifact.ts:101` | `--top` re-slice lowers `appliedTop` to min(requested, existing) and leaves population counts untouched. |

No new `spur history` verb or flag was added; no schema-version bump; the bounded leaderboard
shape and `--top` default are unchanged.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | packages/domain/src/analytics/artifact.ts:165 — SelectionPopulation interface; packages/app/src/services/history-service.ts:459 — selectionPopulation added to analyze query batch; app test proves analyze --top 2 over 3 sessions records population.sessions == 3. |
| R2 | MET | packages/domain/src/analytics/render-forensics.ts:422 — fmtTopOf labels top N of M; render test pins top 20 of 35 and whole-population plain count. |
| R3 | MET | packages/domain/src/analytics/render-forensics.ts:375 — renderRawData widened table + per-warning lines; tests pin truncation note and warning detail. |
| R4 | MET | packages/domain/src/analytics/render-forensics.ts:422 — fmtTopOf returns not available when population absent; render test pins no fabricated count. |
| R5 | MET | packages/app/tests/services/history-service.test.ts + domain tests extended; apps/cli/src/commands/history.ts unchanged. |
| R6 | MET | docs/04_DESIGN.md — HA-S1 paragraph added in this commit. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R29 — analyze records true population + applied depth; bounded arrays at depth | MET | test | `history-service.test.ts` `analyze --top 2` over 3 sessions: `population.sessions==3`, `population.appliedTop==2`, `bySession` length 2. |
| R30 — forensics reports `top N of M`, not bounded length; no length as total | MET | test | `render-forensics.test.ts` pins ` |
| R31 — coverage renders freshness + error detail, truncation, warning detail | MET | test | `render-forensics.test.ts` truncation + warning-detail tests; widened table columns. |
| R32 — pre-addition artifact renders `not available`, never fabricates from length | MET | test | `render-forensics.test.ts` pre-addition test pins `not available` sessions + counts line; `narrow-artifact.test.ts` preserves absent population. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Final disposition: APPROVED** — implementation satisfies all six requirements; only a P3 advisory.

| Priority | Finding | Evidence |
| --- | --- | --- |
| P3 (advisory) | Sessions summary row semantics change from a plain count to a `top N of M` label when truncated; downstream markdown consumers (e.g. the daily history-anatomy report, feature I8) must expect the label. Intended truthfulness correction, propagated by design. | `packages/domain/src/analytics/render-forensics.ts:54` → `fmtTopOf` label |

No P1/P2 findings. No P4 documentation-only notes.

All six requirements MET with direct evidence in the blameable diff:

- R1 (record true population + applied depth): `packages/domain/src/analytics/artifact.ts:165`
  adds `SelectionPopulation`; `selectionPopulation` at
  `packages/domain/src/analytics/forensic-query.ts:464` returns unbounded distinct counts;
  `analyze()` writes `population` at `packages/app/src/services/history-service.ts:554`.
  Service-level test proves `analyze --top 2` over 3 sessions records `population.sessions == 3`.
- R2 (renderer reports true population, `top N of M`, no bounded length as total): Sessions
  metric and the Raw Data counts line route through `fmtTopOf`
  (`packages/domain/src/analytics/render-forensics.ts:422`). Grep confirmed no remaining
  `.length` used as a total.
- R3 (coverage freshness/error/detail): coverage table widened with `Last imported` /
  `Parse err` / `Validation err` (`render-forensics.ts:375`); truncation note at the
  `MAX_ERROR_SAMPLES` cap; warnings render per-warning `code — detail` lines. Tested.
- R4 (pre-addition artifact renders): `fmtTopOf` returns `not available` when `population` is
  undefined; never reconstructed from an array length. Tested.
- R5 (tests + no new verb/flag): domain + app tests added; no CLI surface change.
- R6 (T3 docs): `docs/04_DESIGN.md` records the additive fields + renderer in the same commit.

- Security: no new trust boundary; selectors stay on the existing parameterized path.
- Efficiency: two `COUNT(DISTINCT …)` queries added to the existing `Promise.all` batch, each
  `LIMIT ?`-bounded (R2 structural invariant green).
- Correctness: population derived from the selector (unbounded counts), never from bounded arrays
  (explicit anti-pattern honored); capability-gate waiver + caps raise were operator-authorized.
- Usability: truthful `top N of M` labels; `not available` on pre-HA-S1 artifacts.
- Architecture: additive-only, `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1; followed the
  `CacheWasteStat` precedent, no second shape invented.

None material. `population.loops` / `population.warnings` duplicate the array lengths (both are
full, unbounded sets) — kept for a uniform shape, harmless.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-25T05:10:29.129Z todo → wip (system)
- 2026-08-25T05:19:07.954Z wip → testing (system)
- 2026-08-25T05:19:53.922Z testing → done (system)
