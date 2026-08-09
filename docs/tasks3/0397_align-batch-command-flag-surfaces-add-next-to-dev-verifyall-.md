---
template: feature-impl
schema_version: 1
name: "Align batch command flag surfaces: add --next to dev-verifyall and reconcile dev-runall flags"
description: ""
status: done
type: task
profile: standard
feature_id: H6
parent_wbs: null
priority: P2
tags: ["sp-plugin", "commands", "docs", "tests"]
dependencies: ["0392", "0396"]
created_at: "2026-07-30T23:16:14.651Z"
updated_at: "2026-07-31T03:47:19.071Z"
done_forced: "true"
done_reason: "Flag surfaces aligned (R1-R7); command-flag-parity.test.ts gate extended (R8/R9) — 38 tests, fires on injected drift; lint clean; 465/465 plugin tests pass."
---

## 0397. Align batch command flag surfaces: add --next to dev-verifyall and reconcile dev-runall flags

### Background

Operator review of the batch slash commands surfaced three flag-surface defects, all the same class of failure H6 exists to close: a declared surface and its SSOT disagreeing with nothing to catch it.

**1. `dev-verifyall` is missing `--next`, but the SSOT already assumes it exists.** `dev-operations.md:120` — inside the verifyall section — reads "prefer step-split when dogfooding verifyall with `--fix all` and/or `--next` ... then `--next` only if status transitions are still needed." Yet the verifyall Inputs line (`dev-operations.md:114`) omits `--next`, and `dev-verifyall.md:3` omits it from the argument-hint. One half of the SSOT documents composition guidance for a flag the other half never declares.

The single-task semantic is unambiguous and generalizes cleanly (`dev-operations.md:106`): on the post-`--fix` PASS verdict, transition `testing → done` through the FSM with the `--strict-core` guard honored; on PARTIAL/FAIL or guard failure, stop as review-pending.

**2. `dev-runall`'s flag surface disagrees across three declarations.** `--continue` appears in `dev-runall.md:3` and the `dev-operations.md:70` command table, but not in the runall Inputs prose at `dev-operations.md:224`. `--mode <sequential|parallel>` appears only in `dev-runall.md:3` — absent from both `dev-operations.md` entries — though the flag is real and specified at `execution-batch.md:343`.

**3. `dev-runall.md` is 19 lines with zero flag explanation**, which is how the drift went unnoticed. It restates the argument-hint as Usage and delegates, with no meaning attached to any flag.

Operator questions that motivated this task also establish what must be _documented_, not just fixed: `--keep-going` (batch failure policy — `execution-batch.md:265` §4.2), `--continue` (resume-from-checkpoint — `cross-cutting.md:343`, `execution-workflow.md:260`), and `--next` (per-task lifecycle chaining) sit on three orthogonal axes and are currently easy to confuse. `routing-table.md:128` offers `--continue` and implement `--next` as competing options for the same situation, which is the clearest evidence they are distinct.

### Requirements

R1. Add `--next` to `dev-verifyall`: declare it in `dev-verifyall.md`'s argument-hint and Usage, and document it in the verifyall Inputs line of `dev-operations.md`.
R2. Define `--next` batch semantics: per task, a PASS verdict transitions `testing → done` through the FSM with guards honored; PARTIAL/FAIL does not transition. One task's non-PASS must not block another task's transition.
R3. Order `--next` transitions before the batch-once shippable gate, so `spur feature check` observes final statuses.
R4. Do **not** add `--next` to `dev-runall`. Record the reason in `dev-operations.md` so the asymmetry with `dev-run` reads as deliberate rather than as an oversight.
R5. Reconcile the `dev-runall` flag surface so `dev-runall.md`, the `dev-operations.md:70` command table, and the `dev-operations.md:224` Inputs line declare the same set — including `--continue` and `--mode <sequential|parallel>`.
R6. Expand `dev-runall.md` to state the meaning of each flag it declares, matching the depth of `dev-refineall.md`.
R7. Document the three orthogonal axes — `--keep-going` (batch failure policy), `--continue` (resume from checkpoint), `--next` (per-task lifecycle chaining) — in one place the batch commands cite, so the distinction is stated rather than inferred.
R8. Extend the parity gate from task 0396 to the slash-command layer: assert every flag in a command's `argument-hint` appears in that command's `dev-operations.md` entry, and vice versa.
R9. The command parity check carries a named ignore-list for deprecated flags, with the reason stated — `dev-operations.md:98` already documents `--fix` and `--next` as deprecated no-ops on `dev-review`.

### Acceptance Criteria

```gherkin
Feature: Batch command flag surface alignment

  Scenario: dev-verifyall accepts --next like dev-verify
    Given dev-operations.md already referenced --next in verifyall dogfood guidance
    When the flag is declared
    Then dev-verifyall.md advertises --next in its argument-hint
    And the verifyall Inputs line in dev-operations.md documents it
    And a task with a PASS verdict transitions testing to done through the FSM
    And a task with a PARTIAL or FAIL verdict does not transition

  Scenario: Transitions land before the shippable gate
    Given the shippable gate runs spur feature check once after the batch
    When --next transitions tasks to done
    Then the gate observes the final statuses

  Scenario: dev-runall keeps no --next flag
    Given dev-runall drives the complete task pipeline for every task
    When the command surface is reviewed
    Then dev-runall declares no --next flag
    And the reason is recorded so the asymmetry with dev-run reads as deliberate

  Scenario: The dev-runall flag surface agrees across all three declarations
    Given --continue and --mode disagreed between dev-runall.md and dev-operations.md
    When the reconciliation lands
    Then dev-runall.md, the dev-operations.md command table, and the runall Inputs line declare the same flags
    And each flag has a stated meaning

  Scenario: The three orthogonal axes are documented
    Given --keep-going, --continue, and --next are easily confused
    When an operator reads the batch command documentation
    Then --keep-going is stated as the batch failure policy
    And --continue is stated as resume from checkpoint
    And --next is stated as per-task lifecycle chaining

  Scenario: Command flag drift fails the build
    Given a slash command declares flags in its argument-hint
    When the command parity check runs
    Then every declared flag appears in that command's dev-operations.md entry
    And a flag present in one and absent from the other fails the test

  Scenario: Deprecated flags are excluded explicitly
    Given dev-review declares --fix and --next as deprecated no-ops
    When the command parity check runs
    Then those flags are skipped via a named ignore-list
    And the ignore-list states the deprecation reason
```

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

R4 is a deliberate non-change and needs its rationale recorded, because "add `--next` for symmetry with `dev-run`" is the obvious-looking move and will be re-proposed otherwise. `--next` on `dev-run` is meaningful only because dev-run has two modes: `dev-operations.md:129` states that under `--next` the mode resolves to `implement`, "full mode runs every stage itself, so there is nothing to advance to." `dev-runall` has one mode — it drives the complete `task-pipeline.yaml` per task, so every step `--next` could chain to is already inside the pipeline. Adding it would be a no-op, or a redefinition into implement-only-then-chain, which is what `/sp:dev-refineall --next` already does and what `dev-operations.md:179` warns is a token bomb.

`dev-verifyall` is the opposite case and that asymmetry is the point: `dev-verify --next` is not a mode switch but a status transition on a verdict, so it generalizes to a batch without reinterpretation. Per-task independence (R2) follows the existing per-task verdict model — verifyall already treats each task's verdict as its own, and the deterministic rollup at `spur task verifyall-aggregate` is a report-level concern, not a gate on individual transitions.

R3 exists because the shippable gate runs `spur feature check` once after all per-task legs. If transitions landed after it, the gate would evaluate a feature whose tasks are still `testing` and report not-ready for a batch that had in fact just completed — a false negative on the ship decision.

R8 extends 0396's mechanism to a second artifact pair rather than inventing one. The CLI gate parses `apps/cli/src/commands/*.ts` against `spur-cli` references; this parses command frontmatter against `dev-operations.md` rows. Same bidirectional shape, same failure-message contract, different sources — which is why this task depends on 0396 and reuses its harness instead of standing up a parallel checker.

R9 is required for R8 to be implementable at all: `dev-review` intentionally declares `--fix` and `--next` as deprecated no-ops, so a naive bidirectional check would fail on a correct state. The ignore-list makes deprecation explicit rather than letting it look like drift.

### Plan

- [ ] Document the three-axis distinction (`--keep-going` / `--continue` / `--next`) in the shared location the batch commands cite
- [ ] Add `--next` to `dev-verifyall.md` argument-hint and Usage
- [ ] Document `--next` in the verifyall Inputs line of `dev-operations.md`, with per-task PASS-only transition semantics
- [ ] Specify the `--next`-before-shippable-gate ordering
- [ ] Record in `dev-operations.md` why `dev-runall` has no `--next`
- [ ] Reconcile `--continue` and `--mode` across `dev-runall.md`, the command table, and the runall Inputs line
- [ ] Expand `dev-runall.md` with per-flag meanings to `dev-refineall.md` depth
- [ ] Extend the 0396 parity harness to the command layer with the deprecated-flag ignore-list
- [ ] Verify the gate fires: add a throwaway flag to one command, confirm failure, remove it
- [ ] Run `bun run test` and confirm green

### Solution

Aligned the batch command flag surfaces and extended the parity gate to the slash-command layer.

- `plugins/sp/commands/dev-verifyall.md:3` — added `--next` to argument-hint + Usage; documented per-task lifecycle-chaining semantics (PASS → testing→done via FSM with `--strict-core`; PARTIAL/FAIL does not transition; transitions run before the shippable gate). (R1, R2, R3)
- `plugins/sp/commands/dev-runall.md:3,12-28` — rewrote from 19-line stub to refineall depth: per-flag meanings, explicit "no `--next`" rationale (R4), and the three-axis distinction (`--keep-going`/`--continue`/`--next`). (R6, R7)
- `plugins/sp/skills/spur-dev/references/dev-operations.md`:
  - Command table rows reconciled with arg-hints (R5): `dev-operations.md:57-73` — added `--next` to dev-verify/dev-verifyall/dev-run rows; `--mode` to dev-runall row (`:70`); `--max-retry`/positional to dev-fixall (`:67`); `--wayfind`/`<topic>` to dev-brainstorm (`:69`); `--dry-run` to dev-wrap/dev-wrapall (`:72-73`); removed stale `--auto` from dev-review row (`:57`).
  - verifyall Inputs line: documented `--next` with per-task PASS-only transition + before-shippable-gate ordering (`:114`). (R1)
  - runall Inputs line: added `--mode <sequential|parallel>`, `--continue`, and the three-axis distinction (`:224`). (R5, R7)
- `plugins/sp/tests/command-flag-parity.test.ts:1-136` — NEW (R8/R9). Bidirectional parity: for every command WITH a numbered dev-operations.md table entry, every argument-hint flag appears in the table row and vice versa. Deprecated-flag ignore-list (`dev-review` `--fix`/`--next`) with stated reasons. Plus a regression test pinning the three drift defects 0397 closes (dev-verifyall `--next`, dev-runall `--mode`/`--continue`, dev-runall no `--next`). 38 tests, 194 assertions.

R8 extends 0396's mechanism to the command layer: 0396 parses CLI source ↔ spur-cli references; this parses command frontmatter ↔ dev-operations.md table rows. Same bidirectional shape, different sources.

### Testing

**Commands run:**

```
cd plugins/sp && bun test tests/command-flag-parity.test.ts   # 38 pass, 0 fail, 194 assertions
cd plugins/sp && bun test                                      # 465 pass, 0 fail, 2234 assertions
bun run lint                                                   # biome clean + 7/7 workspaces typecheck exit 0
```

**R8 negative test (gate proven to fire):** temporarily appended `--zzz-phantom` to `dev-wrap.md`'s argument-hint → the forward-parity test failed with `dev-wrap argument-hint declares --zzz-phantom but its dev-operations.md table row omits it`. Restored, retested green.

**Drifts the gate surfaced and fixed** (pre-existing, closed by this task):

- dev-verify/dev-verifyall: `--next` in arg-hint, missing from table row → added.
- dev-run: `--next`/`--wrap`/`--continue` in arg-hint, missing from table row → added.
- dev-runall: `--mode`/`--continue` in arg-hint, missing from table row + Inputs → added.
- dev-wrap/dev-wrapall: `--dry-run` in arg-hint, missing from table row → added.
- dev-fixall: `--max-retry`/positional in arg-hint, missing from table row → added.
- dev-brainstorm: `--wayfind`/`<topic>` in arg-hint, missing from table row → added.
- dev-review: stale `--auto` in table row, absent from arg-hint + Inputs → removed.

**Coverage:** test + documentation task. The parity test is the coverage instrument. No implementation code.

### Review

Three-dimensional review for the batch command flag-surface alignment. Documentation + test task; the command-flag-parity gate is the coverage instrument.

**Scope:** `plugins/sp/commands/dev-verifyall.md`, `plugins/sp/commands/dev-runall.md`, `plugins/sp/skills/spur-dev/references/dev-operations.md` (table + 3 Inputs sections), `plugins/sp/tests/command-flag-parity.test.ts` (new).

**Functional Verdict: PASS** - all R1–R9 MET; the gate fires on injected drift; the three pre-existing drift defects (dev-verifyall `--next`, dev-runall `--mode`/`--continue`, dev-runall no-`--next`) are closed and pinned by a regression assertion.

**P1–P4 findings**

| Priority | Finding                                                                                                                                                                                                                                                                                                                                                   | Location                                                       | Remediation                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| P4       | The parity gate only covers commands WITH a numbered dev-operations.md table entry. Commands documented only in prose notes (dev-find-issue, dev-next, dev-parallel, rule-_, workflow-_, spur-init) are out of scope — they have no SSOT row to check against. Documented limitation, not a defect; those commands' flags live in their .md + prose only. | `plugins/sp/tests/command-flag-parity.test.ts` § scope comment | If those commands need parity, give them numbered table entries first |
| P4       | `--skip-shipable` (misspelled alias) appears in dev-verify/dev-verifyall arg-hints as an accepted alias; the parity test treats `--skip-shippable` as the canonical token. The alias is intentional (typo-tolerance) and documented.                                                                                                                      | `plugins/sp/commands/dev-verifyall.md`                         | None — intentional alias                                              |

No P1 (blocker), P2 (major), or P3 (minor) findings. No security findings (docs + test). No correctness contradictions — `--next` asymmetry (verifyall yes, runall no) is deliberate and recorded (R4).

**Architecture Review**

The gate extends 0396's parity mechanism to a second artifact pair (command frontmatter ↔ dev-operations.md rows), reusing the same bidirectional shape and failure-message contract. R9's deprecated-flag ignore-list makes the `dev-review` `--fix`/`--next` deprecation executable rather than implicit. The three-axis distinction (`--keep-going`/`--continue`/`--next`) is now stated in two places the batch commands cite, closing the confusion vector.

No deepening or friction introduced. The gate reduces drift recurrence (the same failure class H6 exists to close).

**Verdict: PASS** - functional traceability complete (9/9 R MET), SECUA clean (no P1–P3; two P4 advisory, both bounded), architecture clean (gate reuses 0396's mechanism). Ready for `done`.

### References

H6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-07-31T03:46:45.495Z todo → wip (system)
- 2026-07-31T03:46:46.834Z wip → testing (system)
- 2026-07-31T03:47:19.060Z testing → done (system)
