---
schema_version: 1
name: "Testing-section coverage parser with proven record round-trip equivalence"
status: done
template: feature-impl
created_at: 2026-08-25T18:05:19.627Z
updated_at: "2026-08-25T20:51:00.984Z"
feature_id: F93
priority: P1
---

## 0671. Testing-section coverage parser with proven record round-trip equivalence

### Background

First of three under F93; nothing else in the feature can be trusted until this is right. Owns the single parser that maps a task's tracked `## Testing` section to the same coverage rows a verdict artifact carries, plus the round-trip test that makes the two sources provably one source.

The durable copy already exists: `spur task record` renders `## Testing` FROM the verdict artifact into the tracked task file. It emits a `Verdict:` line, a `| Requirement | Status | Evidence |` table, and an `| Acceptance Criteria | Status | Evidence Type | Evidence |` table whose rows are keyed by scenario title — the same key `rowMatchesScenario` (`packages/app/src/services/feature-check.ts`) already matches on.

Measured corpus shapes across the 313 artifact-less done tasks (2026-08-25): 129 prose claiming tests pass, 78 carrying a `Verdict:` line, 54 carrying a table without one, 34 bare, 18 other prose. Only 33 satisfy a strict verdict-line-AND-row-table test, so how much is recoverable is a function of this parser's tolerance — which is exactly why tolerance is pinned by tests over real corpus samples rather than chosen by feel.

The risk that sets this task's priority: a parser that is too tolerant reports unverified work as verified, at corpus scale. That is the precise dishonesty the completion gate exists to prevent. Prefer yielding no rows over guessing one.

Rubric: E2 D1 L1 C0 R2 = 6 → decompose (force: R=high).

### Requirements
- [x] R1. `parseTesting(markdown, wbs)` in `packages/app/src/services/task-record.ts` returns
      `ParseVerdictOutcome` (`verify-verdict.ts:74`) carrying the **canonical** `VerifyVerdict`
      (`verify-verdict.ts:60`) — not the legacy duplicate at `task-record.ts:27`.
- [x] R2. `renderTesting` is converged onto the canonical `VerifyVerdict` so the round-trip is
      type-exact. Its existing callers (`task-service.ts:1136`, the `packages/app/src/index.ts:391`
      re-export) stay green. No other `VerifyVerdict` consumer is migrated.
- [x] R3. Tolerance is explicit and bounded: `Requirement` / `Req` / `R#` header variants parse
      identically; rows keyed by scenario title yield the title as the row id; statuses match
      `ROW_STATUSES` case-insensitively; a missing `Verdict:` line does not discard parseable rows.
- [x] R4. Outcome kinds are honest: no recognisable rows → `invalid` with a reason; malformed or
      truncated markdown → `malformed` without throwing; no `## Testing` section → `missing`. A
      `valid` outcome never carries zero rows, and no status or verdict is ever defaulted or
      inferred from prose.
- [x] R5. Round-trip equivalence is proven by test: for a representative set of canonical verdicts,
      `parseTesting(renderTesting(v))` yields `valid` with the same aggregate verdict, the same
      requirement rows by id and status, and the same acceptance-criteria rows by id and status.
- [x] R6. Tolerance is pinned against real corpus sections — at least one per measured shape that is
      expected to parse — not synthetic fixtures alone.
- [x] R7. No schema change, no new CLI noun/verb/flag, and no change to what `renderTesting` emits
      into `## Testing`. The rendered output is the contract; this task adds its inverse.
### Acceptance Criteria

```gherkin
Feature: Testing-section coverage parser

  @core
  Scenario: R3 — Round-trip equivalence makes the two sources one source
    Given any verdict artifact with a verdict, requirement rows and acceptance-criteria rows
    When "spur task record" renders it into "## Testing" and the fallback parses that section back
    Then the parsed verdict equals the artifact's verdict
    And the parsed requirement rows equal the artifact's requirement rows by id and status
    And the parsed acceptance-criteria rows equal the artifact's rows by id and status

  @core
  Scenario: R4 — The parser tolerates the shapes the corpus actually contains
    Given tracked "## Testing" sections drawn from the real corpus
    When each is parsed
    Then a section using "Requirement" or "Req" as the first column header parses identically
    And a section whose rows are keyed by scenario title parses those titles as row ids
    And MET, PARTIAL, UNMET and N/A are each recognised as a status
    And a section with no recognisable rows yields no rows rather than a fabricated one

  @edge
  Scenario: R6 — A malformed or truncated Testing section is a miss, not a crash
    Given a done task whose "## Testing" section contains a partial table or broken markdown
    When the fallback parses it
    Then parsing yields no rows and states why
    And the sweep continues to the next task without aborting
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**WHAT.** `parseTesting(markdown: string): ParseVerdictOutcome` in
`packages/app/src/services/task-record.ts`, directly beside the `renderTesting` it inverts, plus a
small type convergence that makes the round-trip checkable at all.

**Premise verification (2026-08-25) corrected two assumptions this design originally rested on.**
Both were checked against the current tree, not assumed:

| Assumption | Ground truth | Consequence |
| --- | --- | --- |
| "the `VerifyVerdict` shape" | Declared **twice**: `verify-verdict.ts:60` (canonical, task 0592/F92 — "previously lived across task-record, task-verdict, done-transition-guard") and `task-record.ts:27` (legacy leftover F92 did not finish consolidating) | The parser must name which one, or a downstream agent picks the wrong one |
| Parser returns `VerifyVerdict \| null` | `verify-verdict.ts:74` already defines `ParseVerdictOutcome` = `{missing} \| {malformed} \| {invalid} \| {valid}` | Reuse it; a bespoke `\| null` would fork the outcome vocabulary the gate already speaks |

**Frozen decisions.**

1. **Canonical types only.** `parseTesting` returns `ParseVerdictOutcome` carrying the canonical
   `VerifyVerdict` from `verify-verdict.ts`. `ROW_STATUSES` (`MET` / `PARTIAL` / `UNMET` / `N/A`)
   and `VerdictRowStatus` are already the canonical vocabulary — reference them; do not restate a
   second status list.
2. **Converge `renderTesting` onto the canonical type in this task.** It currently takes
   `task-record.ts:27`'s legacy `VerifyVerdict`. This is small — legacy `VerdictRequirement`
   is `{id, status, evidence}` and `VerdictAcceptanceCriteria` is `{id, status, evidenceType,
   evidence}`, both structurally assignable to canonical `VerdictCoverageRow` once `status`
   narrows from `string` to `VerdictRowStatus`. Without it, `parseTesting(renderTesting(v))`
   compares a legacy input to a canonical output and R5 cannot be stated as equality.
   **This is a convergence, not a refactor:** touch the type only, and only far enough to make the
   round-trip type-exact. Do not migrate unrelated consumers.
3. **Placement stays `task-record.ts`.** Producer and inverse parser in one file means the
   round-trip test sits between them and drift needs a single-file edit to go unnoticed. Callers to
   keep green: `task-service.ts:42,1136` and the `packages/app/src/index.ts:391` re-export.

```ts
/** Inverse of renderTesting over a task's tracked `## Testing` section. */
export function parseTesting(markdown: string, wbs: string): ParseVerdictOutcome;
```

**Frozen tolerance rules.** Decisions, not knobs — widening one later is a correctness argument:

| Input | Rule |
| --- | --- |
| First column header `Requirement` / `Req` / `R#` | parse identically |
| Row id keyed by scenario title | title text is the row id, verbatim |
| Status cell | matched against `ROW_STATUSES`, case-insensitively |
| Missing `Verdict:` line | rows still parse; aggregate derived by the canonical rule, never guessed |
| No recognisable rows | `{ kind: 'invalid', reason }` — never `valid` with empty arrays |
| Malformed / truncated markdown | `{ kind: 'malformed', message }`; never throws |
| Section absent entirely | `{ kind: 'missing' }` |

**Algorithm.** Locate `## Testing` / `### Testing`, slice to the next same-or-higher heading, read
the `Verdict:` line if present, parse the requirement and AC tables independently (either may be
absent), and reverse `escapeTablePipe` (`task-record.ts:20`) so escaped pipes return to literal.

**Anti-patterns — do not implement.**

- Do **not** infer status from prose. 129 corpus sections are prose claiming tests pass; reading
  those as MET would mark unverified work verified at scale — the exact failure this feature exists
  to prevent.
- Do **not** default a missing status to MET or a missing verdict to PASS.
- Do **not** return `valid` with zero rows. "Parsed nothing" and "verified nothing" are different
  facts to the gate.
- Do **not** re-implement scenario-title matching; `rowMatchesScenario` owns it. This parser emits
  row ids and stops.
- Do **not** migrate every `VerifyVerdict` consumer onto the canonical type. Finishing F92's
  consolidation is separate work; this task converges exactly one producer.

**Handoff to 0672.** 0672 consumes `parseTesting` and adds no parsing. The `ParseVerdictOutcome`
kinds are the contract between them: `valid` feeds coverage rows, and `missing` / `malformed` /
`invalid` all mean "no usable rows" — 0672 decides what the gate does with that, this task does not.
### Plan
- [x] 1. Read `verify-verdict.ts` end to end — `VerifyVerdict`, `VerdictCoverageRow`,
      `ROW_STATUSES`, `VerdictAggregate`, `ParseVerdictOutcome` — and `renderTesting` /
      `escapeTablePipe` in `task-record.ts`. Confirm the two `VerifyVerdict` declarations still
      differ as recorded in Design before changing anything. (R1, R2)
- [x] 2. Converge `renderTesting` onto the canonical `VerifyVerdict`; narrow row `status` to
      `VerdictRowStatus`. Fix `task-service.ts:1136` and the `index.ts:391` re-export. Run
      `bun run lint` — typecheck is the real gate for this step. (R2)
- [x] 3. Implement `parseTesting`: section slice → `Verdict:` line → requirement table → AC table →
      unescape pipes. Return `missing` / `malformed` / `invalid` / `valid` per the Design table.
      (R1, R3, R4)
- [x] 4. Round-trip test in `packages/app/tests/services/task-record.test.ts`: build canonical
      verdicts (PASS/PARTIAL/FAIL, with and without AC rows, evidence containing escaped pipes),
      assert `parseTesting(renderTesting(v))` is `valid` and equal on verdict + row ids + statuses.
      (R5)
- [x] 5. Tolerance tests over **real** corpus sections. Harvest them from `docs/tasks*` rather than
      hand-writing fixtures: one `Requirement`-header section, one `Req`-header section, one keyed
      by scenario title, one with a table but no `Verdict:` line. (R3, R6)
- [x] 6. Negative tests: bare section → `invalid`; prose claiming tests pass → `invalid` (never
      MET); truncated table → `malformed`, no throw; absent section → `missing`. (R4)
- [x] 7. Confirm no new CLI surface and no change to `renderTesting`'s output: diff the rendered
      string for an unchanged verdict before/after. (R7)
- [x] 8. Gate: targeted `bun test packages/app/tests/services/task-record.test.ts` first, then
      `bun run lint` and the full `bun run spur-check`.
### Solution
Change-map:

- `parseVerdict` — `packages/app/src/services/task-record.ts:99` — delegates artifact decoding to the canonical runtime parser; invalid row statuses now degrade to UNKNOWN instead of entering the canonical type through a cast (R1/R2).
- `renderTesting` — `packages/app/src/services/task-record.ts:131` — remains on canonical `VerifyVerdict` and retains the existing emitted Testing format (R2/R7).
- `parseTesting` / `extractTestingSection` — `packages/app/src/services/task-record.ts:185,197` — distinguish absent Testing from a section body and return the canonical discriminated outcome (R1/R4).
- `parseCoverageTable` / `parseRowStatus` — `packages/app/src/services/task-record.ts:278,348` — recognize the frozen header/status set, reject truncated or invalid rows as malformed, and reconstruct pipe-bearing row IDs without changing the renderer (R3–R5).
- `splitTableRow` / `unescapeTablePipe` — `packages/app/src/services/task-record.ts:358,375` — preserve escaped pipes and remove exactly the renderer's escape layer (R5).
- parser and record tests — `packages/app/tests/services/task-record.test.ts:69-530` — cover canonical artifact validation, real-corpus tolerance, missing/malformed honesty, escaped evidence, pipe-bearing IDs, and malformed siblings that previously allowed false PASS (R3–R6).

Why: the fallback is a verification trust boundary. Invalid rows must poison the recognized table rather than disappear behind a surviving MET row, while the inverse must recover IDs emitted verbatim by the frozen renderer. No schema, migration, dependency, or public CLI surface changed.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-record.ts:185` — parseTesting returns the canonical ParseVerdictOutcome; parseVerdict at line 99 delegates runtime artifact validation to parseVerifyVerdict. |
| R2 | MET | `packages/app/src/services/task-record.ts:131` — renderTesting accepts CanonicalVerifyVerdict; lint/typecheck and the record integration test pass. |
| R3 | MET | `packages/app/src/services/task-record.ts:283` — headerRe recognizes the frozen variants and parseRowStatus accepts only canonical ROW_STATUSES case-insensitively. |
| R4 | MET | `packages/app/src/services/task-record.ts:335` — an empty id or noncanonical status returns malformed instead of disappearing behind a surviving MET row. |
| R5 | MET | `packages/app/tests/services/task-record.test.ts:329` — the inverse round-trips pipe-bearing requirement and AC IDs; adjacent tests cover aggregates and escaped evidence. |
| R6 | MET | `packages/app/tests/services/task-record.test.ts:347` — real Requirement-header and Req-header corpus samples remain executable tolerance fixtures. |
| R7 | MET | `packages/app/src/services/task-record.ts:131` — renderTesting's emitted table format is unchanged; no schema, migration, dependency, or CLI surface changed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R3 — Round-trip equivalence makes the two sources one source | MET | test | `packages/app/tests/services/task-record.test.ts:329` — requirement and acceptance-criteria IDs containing pipes round-trip exactly; adjacent tests cover aggregates and escaped evidence. |
| Scenario: R4 — The parser tolerates the shapes the corpus actually contains | MET | test | `packages/app/tests/services/task-record.test.ts:347` — real corpus headers, scenario-title IDs, canonical statuses, missing Verdict derivation, and no-row honesty pass. |
| Scenario: R6 — A malformed or truncated Testing section is a miss, not a crash | MET | test | `packages/app/tests/services/task-record.test.ts:459` — truncated rows/separators and malformed siblings return malformed without throwing. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (review coordinator — `/sp:dev-review 0671 --auto`)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | Correctness | `packages/app/src/services/task-record.ts:99,278-350` | Review found and closed three false-trust gaps: noncanonical artifact statuses, malformed rows dropped behind MET, and pipe-bearing IDs failing round-trip. Focused regressions cover each path; no remaining P1–P3 finding. |
| P4 | Architecture | `packages/app/src/services/task-record.ts:99,185` | The repair reuses the canonical verdict parser/types and keeps the inverse beside `renderTesting`; no parallel decoder or abstraction was added. |

**Functional traceability (R1–R7):** all MET — canonical outcome/type and record-reader validation (R1/R2); bounded header/status tolerance (R3); honest missing/invalid/malformed results with no dropped invalid rows (R4); exact representative round-trip including escaped evidence and pipe-bearing IDs (R5); real corpus samples remain pinned (R6); renderer output and public/storage surfaces remain unchanged (R7).

**SECUA:** no security surface. Correctness is fail-closed at the markdown/artifact trust boundary; parsing remains linear in section size. No remaining blocker, major, or minor finding.

**Architecture:** one producer/inverse pair in `task-record.ts`, one canonical runtime artifact parser in `verify-verdict.ts`, and no new dependency or storage seam.

**Residual risk:** tolerance intentionally rejects prose and noncanonical statuses. That lowers recovery rather than fabricating evidence; the corpus measurement/reconciliation remains task 0673 by design.

**Disposition:** approve. No blockers.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-25T18:39:16.763Z todo → wip (system)
- 2026-08-25T18:54:27.768Z wip → testing (system)
- 2026-08-25T18:55:46.315Z testing → done (system)
