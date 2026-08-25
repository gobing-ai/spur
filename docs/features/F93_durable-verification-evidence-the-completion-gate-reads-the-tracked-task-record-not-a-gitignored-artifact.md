---
schema_version: 1
id: "F93"
name: "Durable verification evidence: the completion gate reads the tracked task record, not a gitignored artifact"
status: done
priority: P2
tags: []
created_at: "2026-08-25T18:02:33.790Z"
updated_at: "2026-08-25T22:38:26.224Z"
---

# F93: Durable verification evidence: the completion gate reads the tracked task record, not a gitignored artifact

## Goal
Make a task's completion evidence survive the thing that currently destroys it — a worktree run,
a clone, or a `.spur` cleanup — by having the completion gate read the tracked task record instead
of a gitignored artifact, so that "done" stays provable without re-verifying the work.
## Scope
### The measurement that motivates this (2026-08-25)

| Fact | Evidence |
| --- | --- |
| 313 of 627 `done` tasks (**50%**) have no verdict artifact | sweep over `docs/tasks{,2,3,4}` against `.spur/run/<wbs>-verdict.json` |
| The artifact directory is gitignored | `.gitignore:132` — `/.spur/run` |
| The gate reads only that artifact | `packages/app/src/services/feature-check.ts` `verifiedByAnyCoverer` → `<runDir>/<wbs>-verdict.json` |
| A durable copy already exists and is written FROM the artifact | `spur task record` renders `## Testing` into the tracked task file |
| 25 features are stuck in `verifying`; 8+ specifically on `L4.scenario-unverified` | `feature check` sweep over the verifying set |
| The corpus baseline already suppresses 21 `scenario-unverified` | `config/corpus-baseline.json` |
| Closing I8 required re-deriving five verdicts from scratch | this session; the artifacts had evaporated after a worktree run |

**The local database is not a durable alternative.** `.spur/spur.db` is equally local, so it does
not survive a clone either. The only thing that travels with the repository is a tracked file —
which is why the tracked `## Testing` section, not a new store, is the answer.

### What the durable copy actually contains

`record` emits a `Verdict:` line, a `| Requirement | Status | Evidence |` table, and an
`| Acceptance Criteria | Status | Evidence Type | Evidence |` table whose rows are keyed by
**scenario title** — exactly the key `rowMatchesScenario` already matches on. The information the
gate needs is present; only the reader is missing.

### Recoverability of the existing 313 (measured, and the reason scope is split)

| Shape of `## Testing` | Count |
| --- | --- |
| prose claiming tests pass (unstructured but substantive) | 129 |
| carries a `Verdict:` line | 78 |
| carries a table but no `Verdict:` line | 54 |
| bare or near-empty | 34 |
| other prose | 18 |

Only **33** satisfy the strict "verdict line AND a parseable row table" test today. How many of the
remaining 280 are recoverable is a **function of parser tolerance**, not a fixed number — which is
why the retroactive sweep is scoped as a measured outcome with an explicit disposition for what
cannot be recovered, rather than as a promised count.


In:

- A read-side fallback in the feature-check L4 traceability layer: when
  `<runDir>/<wbs>-verdict.json` is absent, derive the same coverage rows from the task's tracked
  `## Testing` section. The artifact stays authoritative whenever it exists.
- A single parser owning the `## Testing` → coverage-rows mapping, tolerant of the shapes the
  corpus actually contains (header-name variants, missing `Verdict:` line, `MET`/`PARTIAL`/`UNMET`/
  `N/A`), with its tolerance pinned by tests over real corpus samples.
- A provable-equivalence guarantee: a round-trip test asserting that for any verdict artifact,
  `record` → parse `## Testing` yields the same verdict, requirement rows, and AC rows the artifact
  carries. This is what makes the two sources one source.
- A measured retroactive sweep: run the fallback across the 313 artifact-less `done` tasks, report
  how many become verified, and record the residue.
- An explicit, honest disposition for tasks whose evidence was never durably written (the bare
  and unstructured ones): a named state that does not silently read as verified and does not
  silently read as failed.
- Reconciling the resulting `config/corpus-baseline.json` delta in the same change (T10), including
  removing `scenario-unverified` entries that stop reproducing.

Out:

- Any database or schema change. `.spur/spur.db` is local and solves nothing for durability.
- Un-gitignoring `.spur/run`, or adding a second tracked artifact directory. That would not
  recover a single one of the 313 existing tasks and adds a file per task forever.
- A new `spur` CLI noun, verb, or flag. ADR-051 gates the public surface and this needs none —
  the change is behind an existing gate.
- Re-verifying, re-running, or re-opening any task whose evidence cannot be recovered. Deciding
  what happens to those is this feature's job; doing the re-verification is not.
- The wider `corpus-check` calibration backlog (77 unrelated unbaselined findings) — task 0670.
- Changing what `record` writes. The renderer is the producer and already emits enough; this
  feature adds a reader.
## Acceptance Criteria
```gherkin
Feature: Durable verification evidence — the completion gate reads the tracked task record

  # --- The fallback itself ---

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

  # --- Honesty about what cannot be recovered ---

  @core
  Scenario: R5 — Evidence that was never durably written is neither verified nor silently failed
    Given a done task whose "## Testing" section is bare, or is prose with no parseable rows
    And no verdict artifact exists
    When coverage is resolved for that task
    Then the task is reported in a named unrecoverable-evidence state
    And that state does not count as a PASS verdict for any feature scenario
    And the finding names the task and states that its evidence predates durable recording
    And it is distinguishable from a task that was verified and failed

  @edge
  Scenario: R6 — A malformed or truncated Testing section is a miss, not a crash
    Given a done task whose "## Testing" section contains a partial table or broken markdown
    When the fallback parses it
    Then parsing yields no rows and states why
    And the sweep continues to the next task without aborting

  # --- The measured outcome ---

  @core
  Scenario: R7 — The retroactive sweep reports a measured result, not a promised one
    Given the 313 done tasks that currently have no verdict artifact
    When the fallback is applied across the corpus
    Then the change records how many became verified
    And it records how many remain in the unrecoverable-evidence state
    And both counts are reproducible by re-running the sweep

  @core
  Scenario: R8 — Features unblocked by the fallback stop reporting scenario-unverified
    Given a feature in "verifying" blocked only by L4.scenario-unverified findings
    And its covering tasks carry parseable tracked evidence with MET rows
    When "spur feature check" runs after the change
    Then those scenario-unverified findings are gone
    And the feature's remaining findings are unrelated to evidence durability

  @core
  Scenario: R9 — The corpus baseline delta is reconciled in the same change
    Given baselined "L4.scenario-unverified" entries that stop reproducing
    When "spur task check --corpus" runs after the change
    Then no baseline entry names a finding that no longer reproduces
    And no newly surfaced finding is left unlisted
    And the sweep's two-sidedness is preserved

  # --- Boundaries ---

  @core
  Scenario: R10 — No new storage, schema, or public CLI surface
    Given the change is complete
    When the diff is inspected
    Then no database migration or schema change is present
    And "/.spur/run" remains gitignored and no second artifact directory is added
    And no new spur CLI noun, verb or flag is introduced
    And what "spur task record" writes is unchanged
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0671 | Testing-section coverage parser with proven record round-trip equivalence | done |
| 0672 | Wire the fallback into the completion gate with artifact precedence and an unrecoverable-evidence state | done |
| 0673 | Measured corpus sweep: report recovery, unblock features, and reconcile the baseline delta | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-25T19:30:34.261Z backlog → active (system)
- 2026-08-25T19:30:34.611Z active → verifying (system)
- 2026-08-25T22:35:09.289Z verifying → active (system)
- 2026-08-25T22:38:25.855Z active → verifying (system)
- 2026-08-25T22:38:26.224Z verifying → done (system)
