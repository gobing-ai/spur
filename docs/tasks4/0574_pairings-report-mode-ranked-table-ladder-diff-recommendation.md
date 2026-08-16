---
template: feature-impl
schema_version: 1
name: "Pairings report mode: ranked table + ladder-diff recommendations"
description: ""
status: todo
type: task
profile: standard
feature_id: J8
parent_wbs: null
priority: P2
tags: ["history", "report", "pairings"]
dependencies: ["0573"]
ac_numbering: task-local
created_at: "2026-08-16T18:47:41.965Z"
updated_at: "2026-08-16T18:55:34.701Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
