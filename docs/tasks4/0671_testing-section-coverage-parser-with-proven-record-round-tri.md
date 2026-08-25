---
schema_version: 1
name: "Testing-section coverage parser with proven record round-trip equivalence"
status: todo
template: feature-impl
created_at: 2026-08-25T18:05:19.627Z
updated_at: "2026-08-25T18:06:34.583Z"
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

- [ ] R1. A single exported parser maps a `## Testing` section to `{ verdict, requirements[], acceptanceCriteria[] }` using the same row shape the verdict artifact uses (`id`, `status`, and for AC rows `evidenceType`).
- [ ] R2. Tolerance is explicit and bounded: `Requirement` / `Req` / `R#` first-column header variants parse identically; rows keyed by scenario title parse the title as the row id; `MET` / `PARTIAL` / `UNMET` / `N/A` are each recognised; a missing `Verdict:` line does not discard otherwise-parseable rows.
- [ ] R3. A section with no recognisable rows yields zero rows and a stated reason. The parser never infers, defaults, or fabricates a status — absence is reported as absence.
- [ ] R4. Malformed, truncated, or partially-tabular markdown yields zero rows without throwing, so a corpus sweep cannot be aborted by one bad file.
- [ ] R5. Round-trip equivalence is proven by test: for a representative set of verdict artifacts, `record` → parse yields the same verdict, the same requirement rows by id and status, and the same acceptance-criteria rows by id and status.
- [ ] R6. Tolerance is pinned against real corpus samples, not synthetic fixtures only — including at least one section from each measured shape that is expected to parse.
- [ ] R7. No schema change, no new CLI surface, and no change to what `spur task record` writes. This task adds a reader.

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
**WHAT.** `parseTesting(markdown: string): VerifyVerdict | null` in
`packages/app/src/services/task-record.ts`, directly beside the `renderTesting(v: VerifyVerdict)`
it inverts. Returns the same `VerifyVerdict` shape the artifact carries, or `null` when nothing
parseable is present.

**WHY here and nowhere else.** `task-record.ts` already owns both directions of the answer-file
format (`parseVerdict` at `:89`, `renderTesting` at `:181`). Putting the inverse parser anywhere
else — `packages/domain/src/bdd/`, a new module, feature-check itself — separates a renderer from
its parser across a package boundary, and the round-trip guarantee stops being locally checkable.
Co-located, `renderTesting` and `parseTesting` drift only if someone edits one and not the other in
the same file, and the round-trip test sits between them.

**Frozen signature and contract.**

```ts
/** Inverse of renderTesting. Null when the section carries nothing parseable. */
export function parseTesting(markdown: string): VerifyVerdict | null;
```

**Frozen tolerance rules.** These are decisions, not preferences — widening them later is a
correctness change that must be argued, not a tuning knob:

| Input | Rule |
| --- | --- |
| First column header `Requirement` / `Req` / `R#` | all parse identically |
| Row id keyed by scenario title | the title text is the row id, verbatim |
| `MET` / `PARTIAL` / `UNMET` / `N/A` | recognised, case-insensitively |
| Missing `Verdict:` line | rows still parse; verdict derived by the artifact's own aggregation rule, never guessed |
| No recognisable rows | return `null` with a stated reason — never `[]` presented as "verified nothing" |
| Malformed / truncated markdown | return `null`; never throw |

**Precedence / algorithm.**

1. Locate `## Testing` (or `### Testing`) and slice to the next same-or-higher heading.
2. Read the `Verdict:` line if present.
3. Parse the requirement table and the acceptance-criteria table independently — one may be absent.
4. Escaped pipes written by `escapeTablePipe` (`:20`) must round-trip back to literal `|`.
5. If neither table yields a row, return `null`.

**Anti-patterns — do not implement.**

- Do **not** infer a status from prose ("tests pass", "verified", a green checkmark). 129 corpus
  sections are exactly that prose; treating them as MET would mark unverified work verified at
  scale, which is the failure this whole feature exists to prevent.
- Do **not** default a missing status to MET, or a missing verdict to PASS.
- Do **not** return `[]` where `null` is meant. Empty-and-parseable and nothing-parseable are
  different facts to the caller.
- Do **not** re-implement scenario-title matching. `rowMatchesScenario` already owns it; this
  parser produces row ids and stops.
- Do **not** change `renderTesting`. The producer is correct; this task adds the inverse.

**Test shape.** The round-trip test is property-style over a set of representative verdicts:
`parseTesting(renderTesting(v))` must equal `v` on verdict, requirement ids+statuses, and AC
ids+statuses. Tolerance tests read real corpus sections (at least one per measured shape).
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
