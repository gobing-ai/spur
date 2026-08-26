---
schema_version: 1
name: "Measured corpus sweep: report recovery, unblock features, and reconcile the baseline delta"
status: done
template: feature-impl
created_at: 2026-08-25T18:05:19.670Z
updated_at: "2026-08-25T23:08:32.356Z"
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
- [x] R1. The fallback is run across all done tasks lacking a verdict artifact, and the change records how many became verified and how many remain in the unrecoverable-evidence state.
- [x] R2. Both counts are reproducible: re-running the sweep on an unchanged tree yields the same numbers.
- [x] R3. Features previously blocked only by `L4.scenario-unverified` whose covering tasks carry parseable tracked evidence no longer report those findings, and their remaining findings are unrelated to evidence durability.
- [x] R4. The `config/corpus-baseline.json` delta is reconciled in the same change: no baseline entry names a finding that no longer reproduces, and no newly surfaced finding is left unlisted.
- [x] R5. The sweep's two-sidedness is preserved — introducing a new unlisted finding still fails, and repairing a defect a baseline entry names still fails until that entry is removed.
- [x] R6. The recovery count is reported as a measured outcome. Parser tolerance is not adjusted to improve it; if tolerance changes, the reason is a correctness defect and it is stated as such.
- [x] R7. The final diff introduces no database migration, no new artifact directory, and no new spur CLI noun, verb or flag, and leaves what `spur task record` writes unchanged.
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
"is this code correct?" — and a different failure mode: a sweep that recovers too _many_ tasks is
the bad outcome, not the good one.

**Frozen baseline to measure against (2026-08-25, pre-change).**

| Quantity                                   | Value     |
| ------------------------------------------ | --------- |
| `done` tasks                               | 627       |
| with a verdict artifact                    | 314 (50%) |
| without                                    | 313       |
| of those: bare `## Testing`                | 34        |
| of those: unstructured prose               | 129       |
| features in `verifying`                    | 25        |
| baselined `L4.scenario-unverified` entries | 21        |

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
- [x] 1. Re-measure the pre-change baseline on the current tree and record it with the command that
     produced it: done-task count, artifact-present/absent split, `verifying` feature count,
     baselined `L4.scenario-unverified` count. Do not reuse the Design's 2026-08-25 figures if the
     tree has moved. (R1, R2)
- [x] 2. Run the sweep across every done task lacking an artifact; record how many resolve to
     verified and how many land in `evidence-not-recoverable`. (R1)
- [x] 3. Re-run the sweep on the unchanged tree and assert identical counts — no timestamps, no
     ordering-dependent aggregation, no network. (R2)
- [x] 4. Re-check the features previously blocked only by `L4.scenario-unverified`; record which
     cleared and confirm any remaining findings are unrelated to evidence durability. (R3)
- [x] 5. Run `spur task check --corpus`; capture NEW and STALE. **Attribute before editing** — a
     finding on a task or file this feature did not touch belongs to the 77-finding backlog
     (task 0670), not here. (R4)
- [x] 6. Reconcile only this change's delta in `config/corpus-baseline.json`: remove entries that
     stopped reproducing, add newly surfaced ones. (R4)
- [x] 7. Prove two-sidedness survives: an unlisted finding still fails, and a repaired defect whose
     entry remains still fails. (R5)
- [x] 8. Write the results into Testing as reproducible numbers with denominators and the date —
     never a bare percentage. If parser tolerance changed during this task, state which section
     parsed incorrectly and why; never "to improve the count". (R1, R6)
- [x] 9. Final boundary sweep over the whole feature diff: no migration, no new artifact directory,
     no new CLI noun/verb/flag, `renderTesting` output unchanged. (R7)
- [x] 10. Gate: `bun run lint`, `bun run spur-check`, then `bun run corpus-check` for the delta.
### Solution
Change-map (task 0673 — measured corpus sweep + baseline reconciliation):

- `runCorpusSweep` — `packages/app/src/services/corpus-sweep.ts:85-127` — sweeps every configured task folder, selects each `done` task without a verdict artifact, and classifies its tracked Testing evidence through the canonical fallback. Unreadable configured folders now fail loudly instead of yielding incomplete counts (R1/R2/R6).
- `classifyFallback` — `packages/app/src/services/corpus-sweep.ts:68-82` — mirrors completion-gate consistency: stored PASS, recomputed PASS, and at least one MET row are all required for the verified bucket (R1/R6).
- Sweep tests — `packages/app/tests/services/corpus-sweep.test.ts:141-169` — prove all three buckets, artifact exclusion, stable ordering, repeated-run equality, and fail-loud behavior for an unreadable configured corpus (R1/R2/R6).
- `config/corpus-baseline.json:14959-15070` — adds the 14 `L4.evidence-not-recoverable` entries surfaced by F93 (R4).
- `git diff -- config/corpus-baseline.json` — confirms the same delta removes only the 3 stale `L4.scenario-unverified` entries for E6, E9, and M3; the separate task-0670 baseline backlog remains out of scope (R3/R4/R5).

No parser tolerance changed. The measurement remains an app-local executable module because that is the smallest surface that directly reuses `parseTesting`; no database migration, schema change, artifact directory, public CLI noun/verb/flag, or `spur task record` output changed (R6/R7).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/corpus-sweep.ts:85-127` sweeps every configured folder and every done task without an artifact; fresh command: `bun run packages/app/src/services/corpus-sweep.ts --json` → 78 verified, 2 recovered-not-pass, 235 evidence-not-recoverable of 315 without artifacts. @spur-run `.spur/run/0673-verify-answer.txt` lines 1-38 records the post-fix verification. |
| R2 | MET | `packages/app/tests/services/corpus-sweep.test.ts:156-159` asserts repeat equality; two fresh live runs returned byte-identical JSON with 632/317/315/78/2/235 counts. |
| R3 | MET | Fresh source-local `feature check --json`: E6 and E9 have zero findings; M3 has only `L4.uncovered-feature-scenario`, unrelated to evidence durability. |
| R4 | MET | `config/corpus-baseline.json:14959-15070` contains the 14 F93 unrecoverable-evidence entries; `git diff -- config/corpus-baseline.json` removes only stale E6/E9/M3 scenario entries. Fresh corpus sweep has no new/stale F93, E6, E9, M3, 0673, or `L4.evidence-not-recoverable` item; its residual 44 errors, 90 warnings, and 2 stale entries are the explicitly excluded task-0670/current-corpus backlog. |
| R5 | MET | `bun test packages/app/tests/services/corpus-check.test.ts --test-name-pattern 'returns new findings and stale baseline entries as failures'` → 1 pass, 0 fail; both unlisted and stale-baseline directions remain enforced. |
| R6 | MET | Measured 2026-08-25: 78 verified, 2 recovered-not-pass, 235 unrecoverable of 315; two live runs byte-identical. `git diff -- packages/app/src/services/task-record.ts packages/app/src/services/verify-verdict.ts` is empty, so parser tolerance did not change. |
| R7 | MET | Task-scope boundary diff contains only the app-local sweep, its test, baseline/task/feature records, and derived index status; no migration, schema, artifact directory, public CLI noun/verb/flag, or `task-record.ts` change. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R7 — The retroactive sweep reports a measured result, not a promised one | MET | command | Two fresh `bun run packages/app/src/services/corpus-sweep.ts --json` runs were byte-identical: 78 verified / 2 recovered-not-pass / 235 unrecoverable of 315 without artifacts, measured 2026-08-25. |
| Scenario: R8 — Features unblocked by the fallback stop reporting scenario-unverified | MET | command | Source-local feature checks: E6 PASS with zero findings; E9 PASS with zero findings; M3 PASS with only unrelated uncovered-scenario warning. |
| Scenario: R9 — The corpus baseline delta is reconciled in the same change | MET | command | Scoped corpus result has zero F93/evidence-durability NEW or STALE entries; focused two-sidedness test passes both unexpected-finding and stale-entry assertions. |
| Scenario: R10 — No new storage, schema, or public CLI surface | MET | command | Task-scope `git diff --name-only` plus empty diffs for `drizzle`, CLI commands, `.gitignore`, and `task-record.ts` confirm the boundary. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Coordinated review** (`/sp:dev-review 0673 --focus all`)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | Correctness | `packages/app/src/services/corpus-sweep.ts:98-107` | No open finding. Configured-folder, task-file, and task-document read failures now propagate, so the measurement cannot silently publish partial counts; `packages/app/tests/services/corpus-sweep.test.ts:162-169` pins the fail-loud path. |
| P4 | Architecture | `packages/app/src/services/corpus-sweep.ts:136-154` | The testable output seam plus `import.meta.main` is the deliberately app-local one-off measurement surface required by R7. It adds no public CLI or storage seam, and extracting another wrapper would only add indirection. |

**Functional traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/corpus-sweep.ts:85-129` classifies every done task without an artifact; fresh live sweep measured 78 verified, 2 recovered-not-pass, and 235 evidence-not-recoverable of 315. |
| R2 | MET | `packages/app/src/services/corpus-sweep.ts:98-127` uses deterministic traversal and sorted outcomes; `packages/app/tests/services/corpus-sweep.test.ts:156-159` asserts repeat equality, and two fresh live runs were byte-identical. |
| R3 | MET | Fresh source-local feature checks returned E6 PASS with no findings, E9 PASS with no findings, and M3 PASS with only `L4.uncovered-feature-scenario`, unrelated to evidence durability. |
| R4 | MET | `config/corpus-baseline.json:14959-15070` records the F93 delta; the remaining corpus backlog is explicitly owned by 0670 and contains no F93 evidence-durability residue. |
| R5 | MET | `packages/app/tests/services/corpus-check.test.ts:22` exercises both unlisted-finding and stale-baseline failure directions. |
| R6 | MET | Fresh reproducible outcome: 78 verified / 2 recovered-not-pass / 235 unrecoverable of 315, measured 2026-08-25; `packages/app/src/services/task-record.ts:185-188` remains the unchanged parser boundary. |
| R7 | MET | `packages/app/src/services/corpus-sweep.ts:20-23,150-154` keeps the measurement app-local; the task diff adds no migration, artifact directory, public CLI surface, or `renderTesting` change. |

**SECUA:** no security, authorization, network, database, or command-injection surface. The sweep is linear in corpus size, fail-closed on evidence consistency, and fail-loud on unreadable configured inputs. No blocker, major, or minor finding remains.

**Architecture:** `runCorpusSweep` reuses the canonical task parser and verdict aggregator through the existing app boundary. The module is directly testable and has no speculative interface, adapter, dependency, or persistent store. No deepening candidate remains.

**Residual risk:** reproducibility is intentionally scoped to an unchanged tracked corpus and unchanged `.spur/run` state. Any mutation between runs legitimately changes the measurement.

**Disposition:** approve. No blockers; Review is current after the fail-loud repair.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-25T18:22:51.414Z todo → cancelled (system)
- 2026-08-25T21:48:08.471Z todo → wip (system)
- 2026-08-25T22:34:29.942Z wip → testing (system)
- 2026-08-25T22:37:47.813Z testing → done (system)
