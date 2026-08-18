---
template: feature-impl
schema_version: 1
name: "Repair historical anchor drift, then promote anchor-subject-mismatch to error"
description: ""
status: todo
type: task
profile: standard
feature_id: F61
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-18T05:05:25.709Z"
updated_at: "2026-08-18T05:12:36.495Z"
---

## 0586. Repair historical anchor drift, then promote anchor-subject-mismatch to error

### Background
Task 0583 shipped `L4.anchor-subject-mismatch` at warning severity and applied the qualification
pass (144 files rewritten, 3 skipped, idempotent). Its R6 originally promoted the code to error once
the residue was "reconciled into the warning baseline". That clause was **amended on 2026-08-18**
because reconciling does not reach the gate that matters.

**Measured, not assumed.** The promotion was applied via `tasks.severity` in `.spur/config.yaml`,
sampled, and reverted:

| | At error severity |
| --- | --- |
| Feature F91/K2's own tasks (0582/0583/0584/0585) | pass — their citations were repaired |
| Rest of the corpus | **332 of 586 tasks (57%) fail `spur task check <wbs> --strict-core`** |

`spur task check <wbs>` never reads `config/corpus-baseline.json` — the baseline is a **corpus-sweep**
input only. So a baselined finding still fails the per-task done-gate, and promoting would block
`testing → done` for 57% of the corpus until every historical citation was repaired.

The drift is real, not noise: spot-verified true positives include an import block cited for a
component's hooks and a severity-parsing block cited for `runL4Rollup`. Repairing it is the work
this task owns; promotion is its final step.

**Why repair is not mechanical.** The 0583 pass qualifies *paths* and deliberately never touches
line numbers (its R3) — a qualified path with a stale line is still stale. Content matching is what
catches that, and only a human or an agent reading the code can decide what the citation *should*
point at. Expect this to be a campaign, not a migration.
### Requirements
- [ ] **R1.** Every `L4.anchor-subject-mismatch` finding is resolved by repairing the citation — pointing it at the code that implements the row — or, where the evidence no longer exists, by rewriting the row to state that honestly. Measurable: the corpus sweep reports zero `L4.anchor-subject-mismatch` observations, not merely zero unbaselined ones.
- [ ] **R2.** No finding is cleared by weakening the matcher. Measurable: `packages/app/tests/services/task-check.test.ts`'s subject-matching tests still pass unchanged, including the case asserting a wrong-subject row **still** reports.
- [ ] **R3.** The 178-plus ambiguous citations the qualification pass reported (basename resolving to several tracked paths) are disambiguated by an author, not guessed. Measurable: `spur task migrate-anchors --dry-run` reports zero ambiguous entries.
- [ ] **R4.** The 3 files the pass skipped as unwritable (frontmatter predating the current schema) are either migrated to a valid schema or explicitly recorded as permanently legacy. Measurable: `spur task migrate-anchors --dry-run` reports zero skipped files, or each is named with a decision.
- [ ] **R5.** `L4.anchor-subject-mismatch` is promoted to **error** via `tasks.severity` in `.spur/config.yaml` only after R1–R4 hold. Measurable: with the promotion in place, `spur task check --corpus` is green **and** a sample of ten tasks across `docs/tasks{,2,3,4}` pass `--strict-core` with zero errors.
- [ ] **R6.** The baseline shrinks rather than migrates: entries removed by repair are deleted, not re-accepted at error severity. Measurable: the `L4.anchor-subject-mismatch` entry count in `config/corpus-baseline.json` reaches zero.

**Out of scope / non-goals:** the matcher itself (task 0583 — extending it to excuse a bad citation is explicitly forbidden by R2); the qualification pass (0583, applied and idempotent); the 80 legacy `L1.schema-validation` tasks beyond the 3 that block this pass.
### Acceptance Criteria
Graduates both of feature F61's scenarios; the Gherkin below carries their exact titles, and the
numbered rows under it are the measurable verify lens.

```gherkin
Scenario: R1 — Drift is repaired, not re-accepted
  Given the corpus after the repair campaign
  When spur task check --corpus runs
  Then it observes zero anchor-subject-mismatch findings
  And no baseline entry for that code remains

Scenario: R2 — The gate is closed for new work
  Given the finding promoted to error severity
  When a task cites lines that do not name its row's subject
  Then spur task check --strict-core fails for that task
  And the matcher is unchanged from the shape feature F91 shipped
```

**Verify lens**

- **AC1 (R1)** — Given the corpus after repair, when `spur task check --corpus` runs, then `L4.anchor-subject-mismatch` observations are **0** and no entry for that code remains in `config/corpus-baseline.json`.

- **AC2 (R2)** — Given the repaired corpus, when `bun test packages/app/tests/services/task-check.test.ts` runs, then every subject-matching test passes unchanged — including "a row naming an identifier absent from the cited lines still reports". A repair campaign must not become a matcher-loosening campaign.

- **AC3 (R3, R4)** — Given the repaired corpus, when `spur task migrate-anchors --dry-run` runs, then it reports **0 ambiguous** and **0 skipped**, or each remaining entry is named with a recorded decision.

- **AC4 (R5)** — Given `L4.anchor-subject-mismatch: error` in `tasks.severity`, when `spur task check --corpus` runs, then it is green; and when ten sampled tasks across all four task folders are checked with `--strict-core`, then each reports zero errors.

- **AC5 (R5)** — Given the promotion is live, when a task is written with a citation whose lines do not name its row's subject, then `spur task check <wbs> --strict-core` **fails** — proving the ratchet is closed for new work, which is the entire point of the promotion.

- **AC6** — `bun run lint` clean, `bun run test` green, `bun run build` green, `spur task check --corpus` green.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Frozen by 0583's landing; nothing here is open.** The mechanism exists — this task is a repair
campaign plus one config flip.

#### Frozen names

```yaml
# .spur/config.yaml — the promotion, and the ONLY code change this task makes
tasks:
  severity:
    L4.anchor-subject-mismatch: error
```

No source change is expected. The matcher (`extractSubjectTokens` / `citedLinesNameSubject`,
`packages/app/src/services/task-check.ts:310` and `:371`) is 0583's and is frozen here by R2.

#### How to repair a citation

For each finding the checker names the expected subject tokens and the anchor. Read the cited
lines, then:

1. The code moved → re-point the anchor at the current location.
2. The code was deleted or replaced → rewrite the evidence row to say what is true now; do not
   re-point at the nearest surviving line.
3. The row's subject was never in that file → the citation was wrong when written; fix the row.

#### Ordering

Repair (R1) before promotion (R5), and disambiguate (R3/R4) before the final `--dry-run` assertion.
Promotion last: it is the gate that proves the campaign finished, so flipping it early only produces
a red gate that tells you nothing new.

#### A trap this campaign will hit

**Editing a cited file invalidates the citations describing it.** During 0583's verify this
happened three times in one session: correcting `task-check.ts` shifted the very lines that 0583's
own Testing and Solution cited. Repair a file's citations *after* its code has settled, and re-run
`spur task check <wbs>` on the citing task — not just the edited file's own task.

#### Anti-patterns — do not implement

- Do not relax the matcher to clear a finding (R2 exists for this).
- Do not re-baseline `L4.anchor-subject-mismatch` at error severity — that migrates the debt instead
  of paying it, and R6 measures the entry count reaching zero.
- Do not guess an ambiguous basename; the pass already reports candidates.
- Do not promote before R1–R4 hold: 332 of 586 tasks currently fail `--strict-code` at error
  severity, and the corpus baseline cannot rescue a per-task check.

#### File targets

`config/corpus-baseline.json` (entries removed as repairs land), `.spur/config.yaml` (the promotion),
and the task corpus itself across `docs/tasks{,2,3,4}`.

#### Cross-task

**Assumes from 0583:** the matcher, the qualification pass (applied, idempotent), and the warning
baseline. **Leaves for dependents:** none — this closes feature F91.
### Plan
- [ ] Inventory the findings by task and by cause (moved / deleted / never-there) from the corpus sweep (R1)
- [ ] Repair citations in the active folder first, re-running `spur task check <wbs>` per task (R1)
- [ ] Repair the legacy folders, deleting each baseline entry as its finding clears (R1, R6)
- [ ] Disambiguate the ambiguous basenames the pass reported (R3)
- [ ] Resolve the 3 unwritable legacy files — migrate the frontmatter or record them as permanently legacy (R4)
- [ ] Confirm the matcher tests still pass unchanged, including the wrong-subject case (R2)
- [ ] Flip `tasks.severity` to error; confirm `--corpus` green and ten sampled tasks pass `--strict-core` (R5)
- [ ] Confirm a deliberately bad citation now fails `--strict-core`; run lint / test / build (AC5, AC6)
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Task 0583** — shipped the matcher, the qualification pass, and the warning baseline; its R6 was amended on 2026-08-18 to defer promotion here.
- **ADR-062** — Corpus Gates Verify Evidence Content, and Every Severity Is Ratcheted.
- **Feature F91** — this task is its last open item; F91 ships when this closes.
- **Measurement (2026-08-18)** — promotion applied via `tasks.severity`, sampled, reverted: 332 of 586 tasks fail `--strict-core` at error severity; F91/K2's own four tasks pass.
- **`spur task check <wbs>` does not read `config/corpus-baseline.json`** — the baseline is a corpus-sweep input only. This is the fact the original R6 clause missed.
### History
