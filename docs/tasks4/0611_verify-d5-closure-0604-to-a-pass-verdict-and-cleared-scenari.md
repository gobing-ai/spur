---
schema_version: 1
name: "Verify D5 closure — 0604 to a PASS verdict and cleared scenarios"
status: todo
template: feature-impl
created_at: "2026-08-20T07:40:00.000Z"
updated_at: "2026-08-20T07:40:00.000Z"
feature_id: D5
dependencies: ["0606"]
---

## 0611. Verify D5 closure — 0604 to a PASS verdict and cleared scenarios

### Background
Split out of task **0606** on 2026-08-20. 0606 delivered D5's substantive pipeline work; what remains
is **verification bookkeeping**, which is a different kind of job and was blocking 0606 from closing.

**Why the split.** 0606 carried six requirements. Four are delivered — the duplicate graph deleted
(R1), `eval-pipeline` demoted to a measurement tool (R2), the composition-baseline `invocation` blind
spot closed (R5), and ADR-072 accepted with `planning-pipeline.yaml` removed (R6). The two that
remain (0604 → PASS, D5's feature gate) are verification of already-landed work, not implementation.
Keeping them in 0606 also kept that task above the 5-R-item size cap, which blocks it from running on
a `standard`-tier executor (the 0487 size-vs-capability gate reads the `LARGE_TASK_REQS` constant, so
raising `maxImplementReqs` does not help). Two requirements here clears that cap.

**Entry state (verified 2026-08-20, this tree):**

- `config/workflows/task-pipeline2.yaml` is **deleted**; the composition baseline holds five workflows
  (`docs-pipeline`, `idea-pipeline`, `pr-review`, `task-pipeline`, `wrapup-pipeline`); all ten
  remaining definitions pass `spur workflow validate`; `bun run test` is 5965 pass / 0 fail.
- `.spur/run/0604-verdict.json` reads `"verdict": "PARTIAL"` with **R3** the sole non-MET row. R3's
  blocker was the D5-N promotion bar, which **no longer exists** (ADR-076) — 0604's R3 text has
  already been rewritten to drop it.
- `spur feature check D5` → `pass=true` with **6 × `L4.scenario-unverified` warnings** (R7–R12), each
  reading "covering task(s) 0604 have no PASS verdict with MET requirement".
- `bun run corpus-check` reports those 6 D5 rows plus pre-existing unrelated findings (5 × D6
  `scenario-unverified`, 2 × `prerequisite-not-done` on 0607/0608, and 1 error on task 0601's
  `SystemEventsTab.tsx:509` anchor — **not this task's to fix**).

### Requirements
- [ ] R1. Task 0604's verify verdict becomes PASS (feature R9). Re-verify 0604 now that its R3 no longer depends on a promotion bar, so `.spur/run/0604-verdict.json` reads `"verdict": "PASS"` with every requirement row MET. The verdict's acceptance-criteria rows are keyed to the **feature** scenario titles R7–R12 as well as the task's local R-numbers; the feature traceability layer resolves on the former, so a re-verify that drops that aliasing re-opens the six findings for a different reason. Preserve it. Verify: `jq -r .verdict .spur/run/0604-verdict.json` is `PASS`; all six scenario-titled AC rows still present; `spur task check 0604` clean.

- [ ] R2. D5's feature gate clears without suppression (feature R12). `spur feature check D5` reports **zero** `L4.scenario-unverified` findings, and `bun run corpus-check` no longer reports any D5 row. **No entry may be added to `config/corpus-baseline.json` for these six findings** — they must disappear because the condition is fixed, never because it was listed. The D6 rows, the 0607/0608 `prerequisite-not-done` rows, and the pre-existing task 0601 error are expected to remain and are out of scope. Verify: `git diff config/corpus-baseline.json` is empty; `spur feature check D5 --json` shows no `scenario-unverified`.

**Non-goals:** re-implementing anything 0606 delivered; reinstating the promotion bar (ADR-076); fixing task 0601's anchor or the D6 `scenario-unverified` rows; baselining any finding to make a gate green; changing feature D5's acceptance criteria.

### Acceptance Criteria
```gherkin
Feature: D5 closure verification

  Scenario: R12 — Every migration is independently verified and shipped surfaces stay synchronized
    Given D5's pipeline work has landed and only its verification bookkeeping remains
    When task 0604 is re-verified against its rewritten requirements
    Then its verdict artifact reads PASS with every requirement row MET
    And the acceptance-criteria rows keyed to feature scenario titles R7-R12 are preserved
    And spur feature check D5 reports zero scenario-unverified findings
    And no finding was added to the corpus baseline to achieve it
```

### Q&A
- **This is verification, not implementation.** The code and config work is already in the tree. If re-verifying 0604 surfaces a genuine gap, record it and stop — do not quietly implement new work under this task.
- **The AC aliasing is load-bearing.** 0604's verdict carries acceptance-criteria rows keyed to the *feature* scenario titles (R7–R12), not just local R-numbers. `rowMatchesScenario` resolves on those titles. Dropping them re-opens the six findings with a different message, which looks like a regression.
- **Suppression is the one unacceptable outcome.** If the six findings cannot be cleared honestly, leave them and report why. A `config/corpus-baseline.json` entry for them is explicitly forbidden by R2.
- **Do not re-derive ADR-076.** Its rationale and evidence are recorded in `docs/00_ADR.md`.

### Design
**WHAT.** Re-verify 0604, then confirm D5's feature gate and the corpus sweep agree.

**WHY.** 0604's verdict is PARTIAL for exactly one reason: R3 waited on the D5-N promotion bar. ADR-076 retired that bar and 0604's R3 has been rewritten accordingly, so the verdict is stale rather than wrong. Re-running verification against the current requirement text is the whole job.

**WHERE (frozen targets):**

- `docs/tasks4/0604_migrate-consolidate-and-integration-review-pipeline-workflow.md` — R3 already rewritten; the verdict must catch up.
- `.spur/run/0604-verify-answer.txt` → `.spur/run/0604-verdict.json` — the answer file is the source of truth; `spur task verdict --from-answer` re-derives the artifact and `spur task record` re-renders `## Testing` from it. Editing `## Testing` directly is futile.
- `docs/features/D5_*.md` — read-only here; its AC is not to be changed.
- `config/corpus-baseline.json` — must remain byte-identical.

**Method.** Re-run verification for 0604 with `--force` (it is `done`, so the terminal-status guard would otherwise skip it). Every `file:line` citation carried forward must be **re-read at the cited lines this run** before its row is marked MET — the deletion of `task-pipeline2.yaml` already invalidated six anchors in 0596/0604, which were converted to a non-anchor historical form; treat any remaining anchor with the same suspicion.

**Ordering.** R1 strictly before R2 — the feature gate reads 0604's verdict, so checking it first only measures the stale state.

**Rejected alternatives.**
- *`--force-done` on 0604.* Waives the verdict rather than earning it, and leaves the six findings unexplained.
- *Editing `## Testing` directly.* `record` re-transcribes from the verdict artifact; the edit would be silently overwritten.
- *Baselining the six findings.* Explicitly forbidden by R2 and by the constitution's two-sided baseline rule.

### Plan
1. **Re-verify 0604 (R1).** Re-run verification with `--force`, re-reading every cited anchor this run, preserving the R7–R12 scenario-title AC aliasing. Verify: `jq -r .verdict .spur/run/0604-verdict.json` → `PASS`; six scenario-titled AC rows present; `spur task check 0604` clean.
2. **Feature gate (R2).** Re-run `spur feature check D5 --json`. Verify: zero `L4.scenario-unverified`.
3. **Corpus sweep (R2).** Run `bun run corpus-check`. Verify: no D5 row; `git diff config/corpus-baseline.json` empty. D6 rows, 0607/0608 prerequisite rows, and the 0601 error are expected to remain.
4. **Gates.** `bun run lint` and `bun run test` green (both were green at entry — a break is this task's regression).

**Done when** 0604's verdict artifact reads PASS, D5 reports no unverified scenarios, and the corpus baseline is untouched.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent split: task `0606` (delivered D5's pipeline work; this task carries its remaining verification)
- Decision: `docs/00_ADR.md` — **ADR-076** (promotion bar retired, task-pipeline2 deleted)
- Task under verification: `0604`
- Feature: `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md` (scenarios R7–R12)
- Sibling deferred work: task `0610` (docs reconciliation, harness completion, nested-run safety)

### History
- 2026-08-20T07:40:00.000Z created as todo (split from 0606)
