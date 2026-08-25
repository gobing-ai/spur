---
schema_version: 1
name: "Wire the fallback into the completion gate with artifact precedence and an unrecoverable-evidence state"
status: todo
template: feature-impl
created_at: 2026-08-25T18:05:19.652Z
updated_at: "2026-08-25T18:06:54.946Z"
feature_id: F93
priority: P1
dependencies: ["0671"]
---

## 0672. Wire the fallback into the completion gate with artifact precedence and an unrecoverable-evidence state

### Background

Second of three under F93. Depends on the parser task landing first — this task consumes it and adds no parsing of its own.

Today `verifiedByAnyCoverer` in `packages/app/src/services/feature-check.ts` resolves coverage from `<runDir>/<wbs>-verdict.json` only. `.gitignore:132` excludes `/.spur/run`, so 313 of 627 done tasks (50%, measured 2026-08-25) have no artifact and their scenarios read `L4.scenario-unverified` regardless of whether the work was actually verified. Closing feature I8 required re-deriving five verdicts from scratch for exactly this reason.

Two things must stay true and are easy to get wrong together. The artifact remains authoritative wherever it exists — the fallback is a fallback, never a merge, and never a tiebreak. And a task whose evidence was never durably written must land in a named state that reads as neither verified nor failed: 34 of the 313 have a bare `## Testing` and 129 carry only unstructured prose, so this state is not an edge case, it is a large and permanent population that the corpus must describe honestly.

Rubric: E1 D1 L1 C1 R2 = 6 → decompose (force: R=high).

### Requirements

- [ ] R1. When a task's verdict artifact is absent, the L4 traceability layer resolves coverage from the task's tracked `## Testing` section via the parser, and a feature scenario matched by a MET row is reported verified.
- [ ] R2. When the artifact exists it is used and the `## Testing` section is not consulted, even when the two disagree. Precedence is unconditional, not a merge and not a tiebreak.
- [ ] R3. A done task with neither an artifact nor parseable tracked rows is reported in a named unrecoverable-evidence state that never counts as a PASS for any feature scenario and is distinguishable from a task that was verified and failed.
- [ ] R4. The unrecoverable-evidence finding names the task and states that its evidence predates durable recording, so an operator can tell 'never recorded' from 'recorded and failed' without opening the file.
- [ ] R5. A missing artifact is no longer an error path: resolution completes without throwing and without emitting a malformed-artifact diagnostic for simple absence.
- [ ] R6. No database or schema change, `/.spur/run` stays gitignored, no second artifact directory is added, and no new spur CLI noun, verb or flag is introduced.
- [ ] R7. `docs/04_DESIGN.md` records the resolution order — artifact, then tracked section, then unrecoverable — in the same commit (T3).

### Acceptance Criteria

```gherkin
Feature: Completion gate fallback with artifact precedence

  @core
  Scenario: R1 — An absent artifact falls back to the tracked task record
    Given a done task whose "## Testing" section carries a verdict and coverage rows
    And no "<wbs>-verdict.json" exists in the run directory
    When the feature-check traceability layer resolves that task's coverage
    Then it derives the verdict and coverage rows from the tracked "## Testing" section
    And a feature scenario covered by a MET row in that section is reported verified
    And the run does not error on the missing artifact

  @core
  Scenario: R2 — The artifact stays authoritative whenever it exists
    Given a done task that has both a verdict artifact and a "## Testing" section
    And the two disagree about a requirement's status
    When coverage is resolved for that task
    Then the artifact's rows are used
    And the "## Testing" section is not consulted

  @core
  Scenario: R5 — Evidence that was never durably written is neither verified nor silently failed
    Given a done task whose "## Testing" section is bare, or is prose with no parseable rows
    And no verdict artifact exists
    When coverage is resolved for that task
    Then the task is reported in a named unrecoverable-evidence state
    And that state does not count as a PASS verdict for any feature scenario
    And the finding names the task and states that its evidence predates durable recording
    And it is distinguishable from a task that was verified and failed
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**WHAT.** Extend the verdict-artifact cache in `packages/app/src/services/feature-check.ts` so a
task with no `<wbs>-verdict.json` resolves its coverage rows from `parseTesting` (0671) over the
task's tracked `## Testing`. Add one finding code for evidence that was never durably written.

**WHY the cache layer, not `verifiedByAnyCoverer`.** The artifact cache is already built once per
run and consulted per scenario; `verifiedByAnyCoverer` reads that cache. Putting the fallback in
the cache builder means one lookup per task instead of one per scenario, and `verifiedByAnyCoverer`
needs no change at all — it keeps asking "does this coverer have a PASS verdict with a MET row?"
and stops caring where the answer came from.

**Frozen resolution order.**

```
artifact present            -> use it, unconditionally
artifact absent, rows parse -> use the tracked ## Testing rows
artifact absent, no rows    -> unrecoverable-evidence; never a PASS
```

**Precedence is not a merge.** When both exist and disagree, the artifact wins and the section is
not read. No union, no tiebreak, no "prefer the more complete one". A merge would make the gate's
answer depend on which source happened to be richer, which is unpredictable in exactly the cases
that matter.

**Frozen finding code.** `L4.evidence-not-recoverable` — severity `warning` (elevated by
`--strict`, like its siblings). Message names the WBS and states the evidence predates durable
recording. It must be a **distinct code**, not a reuse of `L4.scenario-unverified`: those two
describe different worlds — "we looked and it was not verified" versus "we cannot tell, and no
amount of re-reading this repository will answer it". Collapsing them destroys the only signal that
tells an operator whether re-verification would help.

**Not an error path.** A missing artifact is an expected state for half the corpus, so it must not
emit `L4.malformed-verdict-artifact`. That code stays reserved for an artifact that exists and is
broken. Simple absence is silent until the fallback also fails.

**WHERE.**

| File | Change |
| --- | --- |
| `packages/app/src/services/feature-check.ts` | artifact-cache builder gains the fallback branch; new finding emitted where the cache records a task with no usable rows |
| `packages/config/src/finding-codes.ts` | register `L4.evidence-not-recoverable` |
| `docs/04_DESIGN.md` | record the resolution order, same commit (T3) |

**Anti-patterns — do not implement.**

- Do **not** write the parsed rows back out as a synthesized `<wbs>-verdict.json`. That would
  fabricate an artifact whose provenance is a markdown table, and the next run could not tell it
  from a real one.
- Do **not** un-gitignore `/.spur/run` or add a second tracked artifact directory. Neither
  recovers a single one of the 313 existing tasks.
- Do **not** let the fallback mark a scenario verified from a `PARTIAL` or `UNMET` row. The MET
  requirement is unchanged; only the source of the row moved.
- Do **not** add a CLI flag to toggle the fallback. It is the gate's behaviour, not an option.
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
