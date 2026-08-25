---
schema_version: 1
name: "Measured corpus sweep: report recovery, unblock features, and reconcile the baseline delta"
status: cancelled
template: feature-impl
created_at: 2026-08-25T18:05:19.670Z
updated_at: "2026-08-25T18:22:51.414Z"
feature_id: F93
priority: P2
dependencies: ["0671", "0672"]
---

## 0673. Measured corpus sweep: report recovery, unblock features, and reconcile the baseline delta

### Background

Third of three under F93. Depends on both prior tasks. Deliberately a separate task with a distinct review character: the first two are code, this one is measurement and corpus judgment, and its output is a number the operator has to accept rather than a green test.

The claim this feature exists to make — that verification evidence is durable — is only true if the sweep is run and reported. Baseline to beat, measured 2026-08-25 before any change: 313 of 627 done tasks with no artifact; 25 features in `verifying`, at least 8 blocked specifically by `L4.scenario-unverified`; 21 `scenario-unverified` entries already suppressed in `config/corpus-baseline.json`.

The honest framing matters here. The recovery count is an outcome to be reported, not a target to be hit — a sweep that recovers fewer tasks than hoped is a successful sweep if the parser stayed correct. Tuning tolerance upward to improve the number would invert the feature's purpose.

Constitution T10 applies: baselined `scenario-unverified` entries that stop reproducing must be removed in the same change, and any newly surfaced finding must be listed, so the sweep's two-sidedness survives. Out of scope: the unrelated 77-finding corpus-baseline backlog (task 0670) and re-verifying any task whose evidence cannot be recovered.

Rubric: E2 D1 L1 C1 R1 = 6 → decompose (force: parent R=high).

### Requirements

- [ ] R1. The fallback is run across all done tasks lacking a verdict artifact, and the change records how many became verified and how many remain in the unrecoverable-evidence state.
- [ ] R2. Both counts are reproducible: re-running the sweep on an unchanged tree yields the same numbers.
- [ ] R3. Features previously blocked only by `L4.scenario-unverified` whose covering tasks carry parseable tracked evidence no longer report those findings, and their remaining findings are unrelated to evidence durability.
- [ ] R4. The `config/corpus-baseline.json` delta is reconciled in the same change: no baseline entry names a finding that no longer reproduces, and no newly surfaced finding is left unlisted.
- [ ] R5. The sweep's two-sidedness is preserved — introducing a new unlisted finding still fails, and repairing a defect a baseline entry names still fails until that entry is removed.
- [ ] R6. The recovery count is reported as a measured outcome. Parser tolerance is not adjusted to improve it; if tolerance changes, the reason is a correctness defect and it is stated as such.
- [ ] R7. The final diff introduces no database migration, no new artifact directory, and no new spur CLI noun, verb or flag, and leaves what `spur task record` writes unchanged.

### Acceptance Criteria

```gherkin
Feature: Measured corpus sweep and baseline reconciliation

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

  @core
  Scenario: R10 — No new storage, schema, or public CLI surface
    Given the change is complete
    When the diff is inspected
    Then no database migration or schema change is present
    And "/.spur/run" remains gitignored and no second artifact directory is added
    And no new spur CLI noun, verb or flag is introduced
    And what "spur task record" writes is unchanged
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**WHAT.** Run the fallback across the corpus, report the recovery numbers, confirm the features it
unblocks, and reconcile the resulting `config/corpus-baseline.json` delta — all in one change, so
the claim "verification evidence is durable" is a measured statement rather than an assertion.

**WHY this is a task and not a step in 0672.** Its output is a number an operator has to accept,
not a green test. It carries a different review question — "is this recovery honest?" rather than
"is this code correct?" — and a different failure mode: a sweep that recovers too *many* tasks is
the bad outcome, not the good one.

**Frozen baseline to measure against (2026-08-25, pre-change).**

| Quantity | Value |
| --- | --- |
| `done` tasks | 627 |
| with a verdict artifact | 314 (50%) |
| without | 313 |
| of those: bare `## Testing` | 34 |
| of those: unstructured prose | 129 |
| features in `verifying` | 25 |
| baselined `L4.scenario-unverified` entries | 21 |

**Reproducibility contract.** "Reproducible" means: running the sweep twice on an unchanged tree
yields identical counts. The sweep therefore reads only tracked files and the run directory — no
timestamps, no ordering-dependent aggregation, no network. Record the counts and the command that
produced them in the task's Testing evidence so a reviewer can re-run it.

**The number is an outcome, not a target.** If the recovery count disappoints, that is a finding
about how much evidence was historically written, not a defect in the parser. Tolerance is adjusted
**only** when a specific parse is demonstrably wrong — and then the justification is the wrong
parse, cited, never the count. Any tolerance change in this task must state which section parsed
incorrectly and why. This is the single most important constraint on the task: the incentive to
tune upward is real, and yielding to it would invert the feature.

**Baseline reconciliation procedure (T10).**

1. Run `spur task check --corpus`; capture NEW and STALE entries.
2. Remove every baseline entry that no longer reproduces — chiefly `L4.scenario-unverified` on
   tasks the fallback recovered.
3. Add any newly surfaced finding this change caused, and only those.
4. Attribute before editing: a finding on a task or file this change did not touch belongs to the
   77-finding backlog (task 0670), not here. Do not fold that backlog in.
5. Prove two-sidedness survives: an unlisted finding still fails, and a repaired defect whose
   entry remains still fails.

**Anti-patterns — do not implement.**

- Do **not** add a `spur` noun, verb, or flag to run the sweep. A test or a one-off script under
  `scripts/` is the surface; ADR-051 gates the public CLI and this needs none of it.
- Do **not** re-verify, re-run, or re-open any task the sweep cannot recover. Deciding their
  disposition is this feature's job; performing re-verification is separate work.
- Do **not** bulk-edit `config/corpus-baseline.json` beyond this change's own delta. That is
  exactly how the file becomes the silent suppression list T10 forbids.
- Do **not** report a recovery percentage without the denominator and the date. "Recovered 41%" is
  unfalsifiable; "recovered 128 of 313, measured 2026-08-25" can be re-run.
### Plan
- [ ] 1. Re-measure the pre-change baseline on the current tree and record it with the command that
      produced it: done-task count, artifact-present/absent split, `verifying` feature count,
      baselined `L4.scenario-unverified` count. Do not reuse the Design's 2026-08-25 figures if the
      tree has moved. (R1, R2)
- [ ] 2. Run the sweep across every done task lacking an artifact; record how many resolve to
      verified and how many land in `evidence-not-recoverable`. (R1)
- [ ] 3. Re-run the sweep on the unchanged tree and assert identical counts — no timestamps, no
      ordering-dependent aggregation, no network. (R2)
- [ ] 4. Re-check the features previously blocked only by `L4.scenario-unverified`; record which
      cleared and confirm any remaining findings are unrelated to evidence durability. (R3)
- [ ] 5. Run `spur task check --corpus`; capture NEW and STALE. **Attribute before editing** — a
      finding on a task or file this feature did not touch belongs to the 77-finding backlog
      (task 0670), not here. (R4)
- [ ] 6. Reconcile only this change's delta in `config/corpus-baseline.json`: remove entries that
      stopped reproducing, add newly surfaced ones. (R4)
- [ ] 7. Prove two-sidedness survives: an unlisted finding still fails, and a repaired defect whose
      entry remains still fails. (R5)
- [ ] 8. Write the results into Testing as reproducible numbers with denominators and the date —
      never a bare percentage. If parser tolerance changed during this task, state which section
      parsed incorrectly and why; never "to improve the count". (R1, R6)
- [ ] 9. Final boundary sweep over the whole feature diff: no migration, no new artifact directory,
      no new CLI noun/verb/flag, `renderTesting` output unchanged. (R7)
- [ ] 10. Gate: `bun run lint`, `bun run spur-check`, then `bun run corpus-check` for the delta.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-25T18:22:51.414Z todo → cancelled (system)
