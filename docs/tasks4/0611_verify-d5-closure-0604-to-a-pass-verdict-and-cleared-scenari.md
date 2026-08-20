---
schema_version: 1
name: "Verify D5 closure — 0604 to a PASS verdict and cleared scenarios"
status: done
template: feature-impl
created_at: "2026-08-20T07:40:00.000Z"
updated_at: "2026-08-20T17:14:05.979Z"
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
  a pre-existing anchor finding on task 0601 anchor — **not this task's to fix**).

### Requirements
- [x] R1. Task 0604's verify verdict becomes PASS (feature R9). Re-verify 0604 now that its R3 no longer depends on a promotion bar, so `.spur/run/0604-verdict.json` reads `"verdict": "PASS"` with every requirement row MET. The verdict's acceptance-criteria rows are keyed to the **feature** scenario titles R7–R12 as well as the task's local R-numbers; the feature traceability layer resolves on the former, so a re-verify that drops that aliasing re-opens the six findings for a different reason. Preserve it. Verify: `jq -r .verdict .spur/run/0604-verdict.json` is `PASS`; all six scenario-titled AC rows still present; `spur task check 0604` clean.

- [x] R2. D5's feature gate clears without suppression (feature R12). `spur feature check D5` reports **zero** `L4.scenario-unverified` findings, and `bun run corpus-check` no longer reports any D5 row. **No entry may be added to `config/corpus-baseline.json` for these six findings** — they must disappear because the condition is fixed, never because it was listed. The D6 rows, the 0607/0608 `prerequisite-not-done` rows, and the pre-existing task 0601 error are expected to remain and are out of scope. Verify: `git diff config/corpus-baseline.json` is empty; `spur feature check D5 --json` shows no `scenario-unverified`.

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
Both requirements satisfied — but **not** by this task doing the work. A `--force` re-verify of 0604
(driven by `/sp:dev-run 0611`) found a genuine unmet requirement rather than the expected bookkeeping
pass, so this task halted at implement per its own Q&A, the gap was closed by task **0612**, and 0604
then reached PASS.

#### What halted the first attempt

0604's R3 carries three clauses. Two held; the middle one did not:

- *"quality, review, and verify evidence name one unchanged `ProofInputFingerprint` digest"* — **unmet**.
  `computeProofInputFingerprint` had **zero runtime call sites** and `task-pipeline.yaml` had zero
  digest references. ADR-071's invariant was documented and capable, but not enforced.

This task's Q&A says: *"If re-verifying 0604 surfaces a genuine gap, record it and stop — do not
quietly implement new work under this task."* So it stopped. 0604 kept its honest PARTIAL; nothing was
forced and no acceptance criterion was weakened to make a gate green.

#### R1 — 0604's verdict is PASS

Task **0612** wired the digest (`proof.fingerprint` built-in; capture at `verify:onEnter:4`, stamp into
the verdict artifact at `:5`, compare at `record:onEnter:0`). With R3's last clause satisfied, 0604
re-verified to **PASS — 6/6 requirements MET, 12/12 acceptance-criteria rows MET**.

The R7–R12 feature-scenario aliasing is preserved: the answer file was rebuilt **from the existing
verdict artifact** rather than re-authored, so every row id survives byte-for-byte. Three task-local
`Scenario: Rn` rows that duplicate the feature aliases were carrying `static-ref` and were downgraded
by the evidence rule; they now inherit their alias twin's executable evidence (`R7`/`R9`/`R10`), which
is the same claim already backed by tests rather than a weakening.

#### R2 — D5's feature gate is clear, with no suppression

`spur feature check D5` → **pass=true, 0 findings, zero `L4.scenario-unverified`** (was 6 at task
entry: R7, R8, R10, R11 plus R9/R12 which 0606 and 0610 had already cleared).

`bun run corpus-check` reports **no D5 row**. `git diff config/corpus-baseline.json` is **empty** — not
one of the six findings was baselined away. They disappeared because the condition was fixed.

#### T10 fallout reconciled

Wiring the digest shifted line numbers in `task-pipeline.yaml`, `builtins.ts`,
`proof-input-fingerprint.ts`, `workflow.ts`, and `03_ARCHITECTURE.md`, breaking `file:line` citations
in tasks 0511, 0587, 0600, 0601, and 0603. All were relocated **by content**, not by guessing — each
cited block was located in the pre-change revision and matched to its new position, so the historical
claims are unchanged and only the coordinates moved. One inverted range my own repointer produced
(`257-255`) was caught by the checker and repaired.

Remaining corpus findings are out of scope and pre-existing or expected: 5 × D6 `scenario-unverified`
(tasks 0607/0608 not yet run) and 1 × a pre-existing anchor finding on task 0601, in a file this work never
touched.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Task 0604's verify verdict is **PASS**. `jq -r .verdict .spur/run/0604-verdict.json` → `PASS`, with 6/6 requirement rows MET and 12/12 acceptance-criteria rows MET. R3 — the sole non-MET row at entry — is now MET because task 0612 wired the `ProofInputFingerprint` digest into the canonical proof chain, satisfying its last open clause. The R7–R12 feature-scenario aliasing is preserved: the answer file was rebuilt programmatically **from the existing verdict artifact**, so all 12 row ids survive unchanged (6 task-local `Scenario: Rn` + 6 feature-alias `Rn — …`). `spur task check 0604` → pass, 0 findings. |
| R2 | MET | D5's feature gate clears without suppression. `spur feature check D5 --json` → `pass=true`, **0 findings**, zero `L4.scenario-unverified` (6 at task entry). `bun run corpus-check` reports **no D5 row**. `git diff config/corpus-baseline.json` is **empty** — no entry was added for any of the six findings, so they disappeared because the condition was fixed rather than listed. The remaining sweep findings are explicitly out of scope per this task's non-goals: 5 × D6 `scenario-unverified` (tasks 0607/0608 unstarted) and 1 × pre-existing anchor finding on task 0601, in a web module this work never touched. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R12 — Every migration is independently verified and shipped surfaces stay synchronized | MET | test | 0604 re-verified against its rewritten requirements reads `verdict=PASS` with every requirement row MET; the acceptance-criteria rows keyed to feature scenario titles R7–R12 are preserved (12/12 present and MET); `spur feature check D5` reports zero scenario-unverified findings; and no finding was added to the corpus baseline to achieve it (`git diff config/corpus-baseline.json` empty). Executable proof across the surfaces touched while closing the gap: full `bun run test` → exit 0, 5981 pass / 0 fail; `spur workflow validate` → 10/10; `bun test packages/app/tests/workflow/composition-baseline.test.ts` → 18 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- Parent split: task `0606` (delivered D5's pipeline work; this task carries its remaining verification)
- Decision: `docs/00_ADR.md` — **ADR-076** (promotion bar retired, task-pipeline2 deleted)
- Task under verification: `0604`
- Feature: `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md` (scenarios R7–R12)
- Sibling deferred work: task `0610` (docs reconciliation, harness completion, nested-run safety)

### History
- 2026-08-20T07:40:00.000Z created as todo (split from 0606)
- 2026-08-20T17:12:48.062Z todo → wip (system)
- 2026-08-20T17:13:21.087Z wip → testing (system)
- 2026-08-20T17:13:21.566Z testing → done (system)
