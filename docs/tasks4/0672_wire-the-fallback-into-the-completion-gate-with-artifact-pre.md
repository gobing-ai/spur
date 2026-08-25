---
schema_version: 1
name: "Wire the fallback into the completion gate with artifact precedence and an unrecoverable-evidence state"
status: todo
template: feature-impl
created_at: 2026-08-25T18:05:19.652Z
updated_at: "2026-08-25T18:12:57.138Z"
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
**WHAT.** Extend feature-check's per-run verdict-artifact cache so a done task with no
`<wbs>-verdict.json` resolves coverage rows from its tracked `## Testing` via `parseTesting`
(0671), and register one finding code for evidence that was never durably written.

**Premise verification (2026-08-25) — every location below was read in the current tree.**

| Fact | Location |
| --- | --- |
| Cache loop the fallback belongs in | `feature-check.ts:650-652` — `for (const wbs of doneWbs) { const artifact = await this.readVerdictArtifact(runDir, wbs); artifacts.set(wbs, artifact); }` |
| Absence sentinel | `readVerdictArtifact` sets `diagnostics.artifactError === 'artifact is missing'` |
| Local row type the cache stores | `VerdictRow { id, status }` (`:826`) inside `ParsedVerdictArtifact` (`:832`) |
| The task markdown is **already in hand** | `:454-455` parses each task into a `MarkdownDocument`; `:468` already calls `taskDoc.getSection('Solution')` |
| Linked-task record to extend | `linkedTaskRecords: Array<{ wbs; status; ac }>` (`:447`), pushed at `:469` |
| Finding-code registry + pattern | `packages/config/src/finding-codes.ts:133-134` |

**Zero extra I/O — this is why the fallback is cheap.** The `## Testing` section comes from
`taskDoc.getSection('Testing')` on a document already parsed for `ac` and `Solution`. Extend
`linkedTaskRecords` to `{ wbs, status, ac, testing }` and thread it through. Do **not** re-read task
files inside the cache loop: that would be a second full pass over the corpus for data already read.

**Frozen resolution order.**

```
artifact present            -> use it, unconditionally
artifact absent, parseTesting -> 'valid'   -> use those rows
artifact absent, otherwise             -> evidence-not-recoverable; never a PASS
```

**Precedence is not a merge.** When both exist and disagree, the artifact wins and the section is
not consulted. No union, no tiebreak, no "prefer the richer one" — a merge makes the gate's answer
depend on which source happened to be fuller, which is unpredictable in exactly the cases that
matter.

**This supersedes a recorded decision — say so in the code.** The comment at `:653-656`
(task 0451 R7, "option B") states that a missing artifact is treated as *unverified for this
coverer only*. That stays true as the final outcome, but the path changes: missing now consults the
tracked section first. Update that comment to name 0451 and this task, so the next reader sees a
superseded decision rather than a contradiction.

**Frozen finding code.** `L4.evidence-not-recoverable`, severity `warning` (elevated by `--strict`,
like its siblings). It MUST be distinct from `L4.scenario-unverified`: those describe different
worlds — "we looked and it was not verified" versus "we cannot tell, and no amount of re-reading
this repository will answer it". Collapsing them destroys the only signal telling an operator
whether re-verification would help. It must also stay distinct from
`L4.malformed-verdict-artifact`, which remains reserved for an artifact that exists and is corrupt.

**Row mapping.** `parseTesting` yields canonical `VerdictCoverageRow { id, status, evidenceType,
evidence }`; the cache stores local `VerdictRow { id, status }`. Map by dropping evidence fields —
`verifiedByAnyCoverer` reads only `id` and `status`, so nothing downstream needs them.

**WHERE.**

| File | Change |
| --- | --- |
| `packages/app/src/services/feature-check.ts` | `linkedTaskRecords` gains `testing`; cache loop gains the fallback branch; new finding emitted where no usable rows result; `:653-656` comment updated |
| `packages/config/src/finding-codes.ts` | register `L4_EVIDENCE_NOT_RECOVERABLE` |
| `docs/04_DESIGN.md` | resolution order recorded, same commit (T3) |

**Anti-patterns — do not implement.**

- Do **not** write parsed rows back out as a synthesized `<wbs>-verdict.json`. That fabricates an
  artifact whose provenance is a markdown table, and the next run cannot tell it from a real one.
- Do **not** re-read task files in the cache loop (see zero-extra-I/O above).
- Do **not** un-gitignore `/.spur/run` or add a second tracked artifact directory — neither
  recovers one of the 313 existing tasks.
- Do **not** let a `PARTIAL` or `UNMET` row verify a scenario. Only the row's *source* moved; the
  MET requirement is unchanged.
- Do **not** add a CLI flag to toggle the fallback. It is the gate's behaviour, not an option.
- Do **not** emit `L4.malformed-verdict-artifact` for simple absence — that regression is what
  0451 R7 explicitly fixed.

**Assumes from 0671 / leaves for 0673.** Consumes `parseTesting` and adds no parsing of its own;
the `ParseVerdictOutcome` kinds are the contract. Running the sweep, reporting recovery counts, and
reconciling the baseline delta belong to 0673 — this task changes behaviour, it does not measure it.
### Plan
- [ ] 1. Re-read `feature-check.ts:440-470` (task scan) and `:645-690` (cache loop + diagnostics),
      and confirm the absence sentinel is still `artifactError === 'artifact is missing'` before
      branching on it. (R1, R5)
- [ ] 2. Extend `linkedTaskRecords` to `{ wbs, status, ac, testing }`, populating `testing` from
      `taskDoc.getSection('Testing') ?? ''` at `:469` — the same already-parsed document that
      supplies `ac` and `Solution`. Thread the field into the classify method's parameter type at
      `:603`. (R1)
- [ ] 3. In the cache loop, when the artifact is missing, call `parseTesting(testing, wbs)` and on
      `valid` map canonical `VerdictCoverageRow` → local `VerdictRow { id, status }`. Leave the
      artifact-present path untouched. (R1, R2)
- [ ] 4. Register `L4_EVIDENCE_NOT_RECOVERABLE: 'L4.evidence-not-recoverable'` in
      `packages/config/src/finding-codes.ts` beside its siblings. (R3)
- [ ] 5. Emit the finding when neither source yields usable rows: name the WBS, state the evidence
      predates durable recording, and keep it distinct from both `scenario-unverified` and
      `malformed-verdict-artifact`. (R3, R4)
- [ ] 6. Update the `:653-656` comment to record that 0451 R7's missing-artifact path is superseded
      by this task — outcome unchanged, path now consults the tracked section first. (R5)
- [ ] 7. Tests in `packages/app/tests/services/feature-check.test.ts`:
      artifact-absent + parseable Testing → scenario verified;
      artifact-present + conflicting Testing → artifact wins, Testing not consulted;
      artifact-absent + bare Testing → `evidence-not-recoverable`, never PASS;
      artifact-absent + PARTIAL row → not verified;
      simple absence → no `malformed-verdict-artifact`. (R1–R5)
- [ ] 8. Record the resolution order in `docs/04_DESIGN.md` in this commit (T3). (R7)
- [ ] 9. Confirm the boundaries hold: no migration, `/.spur/run` still gitignored, no second
      artifact directory, no new CLI noun/verb/flag. (R6)
- [ ] 10. Gate: targeted `bun test packages/app/tests/services/feature-check.test.ts` first, then
      `bun run lint` and full `bun run spur-check`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
