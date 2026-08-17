---
template: feature-impl
schema_version: 1
name: "Pairings report mode: ranked table + ladder-diff recommendations"
description: ""
status: done
type: task
profile: standard
feature_id: J8
parent_wbs: null
priority: P2
tags: ["history", "report", "pairings"]
dependencies: ["0573"]
ac_numbering: task-local
created_at: "2026-08-16T18:47:41.965Z"
updated_at: "2026-08-17T05:16:00.414Z"
done_forced: "true"
done_reason: "Operator-accepted 2026-08-16: verify verdict PARTIAL solely because AC R5 (real-data escalation dogfood) is environment-blocked (0 agent.invoke.escalated events in any reachable DB). R1-R3 + AC R2/R3/R6 MET; dispatch mechanism proven against real data. R5 accepted as blocked-pending-data."
---

## 0574. Pairings report mode: ranked table + ladder-diff recommendations

### Background
Feature J8 Layer 2 — the operator-facing half. Adds the `pairings` report mode to `spur history report`. Premise-verified 2026-08-16: the mode registry is `REPORT_MODES` in `packages/domain/src/analytics/report-modes.ts` — pure `HistoryArtifact → string` renderers, no I/O, no DbAdapter, unknown names throw `UnknownReportModeError` naming the registered set (0555 R1). Therefore the ladder comparison data must arrive INSIDE the artifact: 0573 (dependency, wired via `dependencies: [0573]`) adds `pairings?: PairingStat[]` and `ladderSnapshot?: LadderEntry[]` as optional additive fields — this task consumes exactly that shape and nothing else. Old artifacts simply lack the fields; absence-as-unknown is the established degradation pattern (`SessionStat.sessionState` in artifact.ts).
### Requirements
- [ ] R1. Add `renderPairings(artifact)` in `packages/domain/src/analytics/render-pairings.ts` and register `pairings` in `REPORT_MODES` (report-modes.ts): a pure function rendering the pairing table ranked within each role by the documented precedence — success rate desc, total escalations asc, mean cost asc. Unknown mode names keep failing loudly (existing registry behavior, cover with a test). (feature J8 R2)
- [ ] R2. Render the ladder-diff section from `ladderSnapshot`: per tier, compare measured pairing order vs snapshotted `order`; print promote/demote suggestions citing dispatches/rates/cost. A rung whose pairings total fewer than `MIN_PAIRING_DISPATCHES = 5` dispatches is marked insufficient-evidence and never suggested. (feature J8 R3)
- [ ] R3. Absence degradation: when the artifact lacks `pairings` or `ladderSnapshot`, render an explicit "section unavailable (artifact predates the pairings field; re-run spur history analyze)" notice in place of that section — never fail, never fabricate. (feature J8 R6)
- [ ] R4. Coverage + dogfood: fixture-artifact unit tests in `packages/domain/tests/analytics/render-pairings.test.ts` (ranking, ladder-diff, insufficient-evidence floor, old-artifact notice, unknown-mode throw); then a real-data dogfood via `bun run apps/cli/src/index.ts history analyze` + `history report --mode pairings` (real-data contract — never a bare global spur) confirming codex-sol's 2026-08 resource-exhaustion events appear in its escalation counts; `docs/04_DESIGN.md` surface note for the new mode in the same commit (T3). (feature J8 R2, R3, R5)
### Acceptance Criteria
```gherkin
Scenario: R2 — The pairings report mode renders the ranked table without the database
  Given an analyze artifact containing a pairings section
  When `spur history report --mode pairings` runs against it
  Then it renders pairings ranked per role by the documented ordering (success rate, then escalation rate, then cost)
  And it never opens the database (pure renderer of the artifact)
  And an unknown mode name still fails loudly (registry-resolved)

Scenario: R3 — The ladder diff proposes concrete reorderings with evidence
  Given an analyze artifact carrying a ladder snapshot embedded from the project config
  When the pairings report renders
  Then a ladder-diff section names each rung whose measured ranking disagrees with its snapshotted position
  And each suggestion cites the underlying numbers (dispatch count, rates, cost)
  And a rung with fewer than the documented minimum dispatches is marked insufficient-evidence, never suggested

Scenario: R6 — The pairings section is additive and old artifacts degrade gracefully
  Given the artifact contract is additive-only (HISTORY_ARTIFACT_SCHEMA_VERSION stays 1)
  When the pairing aggregation lands
  Then `pairings` and `ladderSnapshot` are optional additive fields and the version is unchanged
  And a pre-pairings artifact renders an explicit "section unavailable" notice (absence-as-unknown, the SessionStat.sessionState precedent) instead of failing or fabricating rows

Scenario: R5 — Real-data dogfood on this monorepo
  Given the real history DB (post-0567 import surface)
  When analyze and the pairings report run end to end
  Then the report reflects the known ground truth (e.g. codex-sol's 2026-08 resource-exhaustion events visible in its escalation rate)
```
### Q&A
**Closed during --depth ready refinement (2026-08-16, premise-verified).** Ladder source: renderers are pure, so the diff reads the artifact's embedded `ladderSnapshot` (0573), never `.spur/config.yaml` at render time — the batch-create requirement "loads the project's .spur/config.yaml" was physically impossible under the registry contract and is corrected. Versioning: no version compare anywhere — absence of the optional fields is the degradation signal (additive-only artifact contract, artifact.ts:66; feature R4 deprecated → R6). Dispatch floor frozen at 5 as a named constant — deliberately not a config knob.

**Depends on 0573** (wired via `dependencies: [0573]`): the artifact field names are the input contract; a rename there re-touches this task's references in the same commit.
### Design
**WHAT.** One pure renderer + one registry line. The entire task is ~150 LOC in the domain analytics layer plus tests.

**WHY pure.** `ReportRenderer = (artifact: HistoryArtifact) => string` (report-modes.ts) — no I/O, no DbAdapter, no template engine (operator ruling 2026-08-09 embedded in that file's header). Purity is what makes old-artifact degradation testable as a function call.

**Frozen names.**

- `packages/domain/src/analytics/render-pairings.ts` — `export function renderPairings(artifact: HistoryArtifact): string`.
- `report-modes.ts` — `REPORT_MODES` gains exactly one entry: `pairings: renderPairings`.
- `export const MIN_PAIRING_DISPATCHES = 5` in render-pairings.ts (the insufficient-evidence floor; named constant, not a config knob — a value that never changes is a constant).
- Consumes ONLY `artifact.pairings` / `artifact.ladderSnapshot` from 0573 (types `PairingStat` / `LadderEntry`). If 0573 renames a field, this task's references change in the same commit — the handoff is the artifact type, nothing else.

**Output shape (two sections).**

1. `## Pairings` — per role, a table: executor | agent | model | dispatches | success% | escalations (per-trigger breakdown) | cost | mean duration. Row order: successRate desc → total escalations asc → meanCostUsd asc (documented in the feature R2 Then).
2. `## Ladder diff` — per tier present in `ladderSnapshot`: configured order vs measured order; each disagreement prints `suggest: promote <executor> above <executor> (dispatches=N, success=X% vs Y%, cost=$a vs $b)`. Any pairing with `dispatches < MIN_PAIRING_DISPATCHES` prints `insufficient-evidence (N<5)` and produces no suggestion. Missing `pairings` or `ladderSnapshot` → the literal notice `section unavailable (artifact predates the pairings field; re-run spur history analyze)` in place of that section.

**Anti-patterns — do NOT:**

- Do not open the database, read `.spur/config.yaml`, or take any parameter beyond the artifact (registry purity).
- Do not bump or compare schema versions (additive contract; absence is the degradation signal).
- Do not suggest reorderings below the dispatch floor, and do not fabricate zero-rows for missing pairings.
- Do not touch `render-report.ts` / `render-forensics.ts` — the new mode is additive; `default` output stays byte-identical (0555 R1).
- Do not auto-apply suggestions or offer a `--fix` — recommendation only (J8 scope).

**Dependencies (0573).** Assumes: `pairings`/`ladderSnapshot` on the artifact with the frozen field names. Leaves for dependents: none (J8's leaf task).
### Plan
- [ ] Write `render-pairings.ts` with the two-section output and the MIN_PAIRING_DISPATCHES floor (R1, R2, R3)
- [ ] Register `pairings: renderPairings` in REPORT_MODES (R1)
- [ ] Write `render-pairings.test.ts` fixtures: ranking order, ladder-diff suggestion, insufficient-evidence floor, old-artifact notice, unknown-mode throw (R4)
- [ ] Real-data dogfood: `bun run apps/cli/src/index.ts history analyze` then `history report --mode pairings`, confirm codex-sol escalation counts reflect the 2026-08 quota events; record the provenance header in the transcript (R4)
- [ ] `docs/04_DESIGN.md` surface note for the new mode, same commit (T3); verify `bun test packages/domain` + `bun run lint` green (R4)
### Solution

**`packages/domain/src/analytics/render-pairings.ts` (new)** — the `pairings` report mode renderer.

- `renderPairings(artifact)` at `packages/domain/src/analytics/render-pairings.ts:34` — pure `HistoryArtifact → string`, no I/O, no `DbAdapter`, no config read, no schema-version compare. Composes two sections.
- `## Pairings` table at `packages/domain/src/analytics/render-pairings.ts:52` — one ranked table per role, ordered by the shared precedence `comparePairings` at `packages/domain/src/analytics/render-pairings.ts:46`: successRate desc → total escalations asc → totalCostUsd asc. Columns: executor | agent | model | dispatches | success% | escalations (per-trigger breakdown) | cost | mean dur. Escalations render `N (trigger:count, …)` or `0` when none; mean duration renders `n/a` when unmeasured (reuses `fmtDur` from render-report).
- `## Ladder diff` at `packages/domain/src/analytics/render-pairings.ts:133` — per tier present in `ladderSnapshot`, prints `configured:` vs `measured:` order, then a `suggest: promote <below> above <above> (dispatches=N, success=X% vs Y%, cost=$a vs $b)` line for each adjacent inversion in the configured order. An executor's measured standing aggregates all its pairings across roles (dispatch-weighted success), so the diff ranks executors, not executor+role pairs.
- `MIN_PAIRING_DISPATCHES = 5` at `packages/domain/src/analytics/render-pairings.ts:10` — the frozen insufficient-evidence floor (named constant, not a config knob). A rung totalling < 5 dispatches is marked `insufficient-evidence (N=<n><5)` and never suggested; a pair involving a below-floor rung never emits a suggestion.
- `SECTION_UNAVAILABLE` at `packages/domain/src/analytics/render-pairings.ts:13` — the literal absence notice, rendered in place of either section when the artifact lacks `pairings` or `ladderSnapshot` (additive contract; never a throw, never a fabricated row).

**`packages/domain/src/analytics/report-modes.ts`** — exactly one registry entry `pairings: renderPairings` at `packages/domain/src/analytics/report-modes.ts:30`. Unknown mode names keep failing via `UnknownReportModeError` naming the registered set. `render-report.ts` / `render-forensics.ts` untouched; `default` output stays byte-identical.

**`packages/domain/src/analytics/index.ts`** — barrel export `MIN_PAIRING_DISPATCHES, renderPairings` at `packages/domain/src/analytics/index.ts:65`, matching the existing renderer export pattern.

**`docs/04_DESIGN.md`** — `**Pairings renderer (task 0574, feature J8 R2/R3)**` surface note at `docs/04_DESIGN.md:715` after the forensics-renderer paragraph, mirroring how the other report modes are documented.


**`packages/domain/tests/analytics/render-pairings.test.ts` (new)** at `packages/domain/tests/analytics/render-pairings.test.ts:74` — 11 tests: registry registration + frozen floor constant, per-role ranking precedence (success → escalations → cost), per-role table grouping, escalation breakdown + `n/a` duration, ladder-diff suggestion format citing dispatches/rates/cost, cross-role executor aggregation, insufficient-evidence floor (marked and never suggested), old-artifact absence notice, present-but-empty pairings/ladder honest notes, and unknown-mode throw. `render-pairings.ts` at 100% func / 100% line coverage.


- The design prose said the cost tiebreak is "mean cost"; the 0573 `PairingStat` carries only `totalCostUsd` (the fold is a whole-session total, not a per-dispatch mean — per its docstring), and this task consumes exactly the 0573 artifact shape, so the cost dimension uses `totalCostUsd`. No mean cost is derived (renderers read fields, never compute metrics).
- The ladder diff is recommendation-only: adjacent-inversion scan over the configured order, never auto-applied, never a `--fix`. The dispatch floor blocks any suggestion involving a below-floor rung, so unreliable data can never drive a reorder.
### Testing
**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/analytics/render-pairings.ts:34` — renderPairings(); `:46` — comparePairings (success desc → total escalations asc → cost asc); `:52` — per-role ranked table; `packages/domain/src/analytics/report-modes.ts:30` — registry entry; unknown-mode throw verified live (`Unknown report mode 'bogus'. Registered modes: default, forensics, pairings`) + test at render-pairings.test.ts:218. render-pairings.ts 100% func/100% line (test-gate.log:290); 22 tests pass (render-pairings + pairings, rerun this turn). |
| R2 | MET | `packages/domain/src/analytics/render-pairings.ts:133` — renderLadderDiffSection (adjacent-inversion scan); `:10` — MIN_PAIRING_DISPATCHES=5; `:165` — below-floor rung never suggested. Real dogfood verified: codex-sol (N=2<5) and minimax (N=4<5) marked insufficient-evidence, no suggestions emitted. |
| R3 | MET | `packages/domain/src/analytics/render-pairings.ts:13` — SECTION_UNAVAILABLE in place of either missing section; verified live against pre-pairings artifact → both sections render the literal notice; never throws, never fabricates rows. `artifact.ts:13` — schema version stays 1. |
| R4 | PARTIAL | Fixture tests MET (render-pairings.test.ts — 11 tests, 100% func/100% line) + `docs/04_DESIGN.md:715` T3 note MET. Real-data dogfood ATTEMPTED and dispatch mechanism PROVEN: analyze against main tree DB (session-scoped, sidestepping full-history SQLite expression-depth) → real artifact with 5 pairings; report dispatch counts match raw system_events ground truth exactly. Escalation-count sub-condition BLOCKED: 0 `agent.invoke.escalated` events in ANY reachable DB. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R2 — The pairings report mode renders the ranked table without the database | MET | test+live | render-pairings.test.ts:81 (ranking precedence), :104 (per-role grouping); real dogfood report shows per-role ranked tables; never opens DB (report is a pure renderer of the artifact path); unknown mode fails loudly (verified live). |
| Scenario: R3 — The ladder diff proposes concrete reorderings with evidence | MET | test+live | render-pairings.test.ts:136 (suggest format citing dispatches/rates/cost), :150 (cross-role aggregation), :173 (below-floor marked, never suggested); real dogfood shows codex-sol N=2<5 and minimax N=4<5 marked insufficient-evidence, zero suggestions. |
| Scenario: R6 — The pairings section is additive and old artifacts degrade gracefully | MET | test+live | artifact.ts:13 version stays 1; pairings?/ladderSnapshot? optional (0573); render-pairings.test.ts:193 (absence notice), :202/:208 (present-but-empty honest notes); live: pre-pairings artifact renders `section unavailable (artifact predates the pairings field; re-run spur history analyze)` for both sections. |
| Scenario: R5 — Real-data dogfood on this monorepo | PARTIAL | live | Data-bearing DB reachable (main tree: 144 agent.invoke.start, 140 exit, 0 escalated). Real analyze + report ran end-to-end; dispatch counts match ground truth exactly (codex-sol=2, grok=5, minimax=4, omp=3, omp-deepseek=3). codex-sol's 2026-08 resource-exhaustion escalation counts CANNOT be confirmed: 0 agent.invoke.escalated events in ANY reachable DB — escalation rate honestly 0, environment-blocked. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | usability | `apps/cli/src/commands/history.ts:175` | Stale `--mode` help text lists only `default \| forensics`, not the newly registered `pairings` (works via registry; follow-up outside 0574's diff) |
| P4 | correctness | `packages/domain/src/analytics/render-pairings.ts:168` | `suggest:` line cites dispatches/success/cost but not escalations; when the escalation tiebreak decides an inversion the deciding factor isn't exposed (advisory — matches the approved frozen format) |
| P4 | verify-time | `.spur/run/0574-verdict.json` | AC R5 real-data escalation dogfood environment-blocked: 0 `agent.invoke.escalated` events in any reachable DB |

**Verdict: PASS** (review) → verify PARTIAL (R5 only).

**Operator disposition (2026-08-16, accepted):** Verify verdict PARTIAL was driven solely by AC R5 (real-data escalation dogfood) being environment-blocked — 0 `agent.invoke.escalated` events exist in any reachable DB, so codex-sol's 2026-08 resource-exhaustion escalation counts cannot be confirmed. This is a data-availability constraint, not a code defect: the pairings renderer's dispatch mechanism was proven against real data (main-tree DB, 144 dispatch starts, counts match ground truth exactly). Operator accepted R5 as blocked-pending-data and authorized marking task done. R1-R3 + AC R2/R3/R6 remain MET.
### References

J8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-17T04:08:20.912Z todo → wip (system)
- 2026-08-17T05:05:52.069Z wip → testing (system)
- 2026-08-17T05:16:00.406Z testing → done (system)
