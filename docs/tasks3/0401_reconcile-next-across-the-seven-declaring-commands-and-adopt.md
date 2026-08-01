---
template: feature-impl
schema_version: 1
name: "Reconcile --next across the seven declaring commands and adopt it on dev-runall"
description: ""
status: todo
type: task
profile: standard
feature_id: H8
parent_wbs: null
priority: P1
tags: ["sp-plugin", "commands", "breaking-change"]
dependencies: ["0399"]
created_at: "2026-08-01T05:05:18.245Z"
updated_at: "2026-08-01T05:27:19.349Z"
---

## 0401. Reconcile --next across the seven declaring commands and adopt it on dev-runall

### Background

The visible half of H8. Seven commands declare `--next` today with four incompatible meanings: chain-ish (`dev-verify`, `dev-verifyall`), a mode selector (`dev-run` — implement-only), a deprecated no-op (`dev-review`), and undocumented declarations that are never explained anywhere (`dev-refine`, `dev-refineall`, `dev-brainstorm`). `dev-runall` deliberately omits it.

`dev-run` is the only genuinely breaking case: its replacement spelling `--mode implement` already exists and is already what `routing-table.md` row A5 dispatches, which is evidence the overload was a mistake rather than a design choice. `dev-verify`/`dev-verifyall` are subsumed — their old transition becomes the chain's first hop, so existing invocations keep working and continue afterward.

### Requirements
Absorbs cancelled task 0402 (flag normalization). Both were one sweep of the same 28 files; running
them as separate tasks meant two passes over the same surface, two review contexts, and two sets of
gates for a diff a reviewer would read once.

#### Part A — `--next` reconciliation

R1. Every command declaring `--next` documents the single glossary meaning from task 0399 and references that glossary entry. None describes it as a mode selector, a status transition, or a no-op.
R2. `dev-run`: `--next` no longer selects implement-only. `--mode implement` is the documented spelling, and the command text instructs the agent to state the redefinition and name the replacement. Mark that warning for removal after one release — these are prompt files, so the "warning" is instruction text and becomes permanent noise if left.
R3. `dev-review`: remove the deprecated `--next` no-op rather than redefining it in place.
R4. `dev-refine`, `dev-refineall`, `dev-brainstorm`: these declared `--next` without ever defining it. Either give them the canonical meaning or drop the declaration — decide per command against whether chaining is meaningful there, and record the reason. `dev-refineall` currently warns "avoid `--next`" as a token bomb while declaring it; that self-contradiction must be resolved, not carried forward.
R5. `dev-runall` adopts `--next`: chain each task to terminal status, then run the wrap hop **once for the batch**, mirroring the batch-once shippable gate `dev-verifyall` already uses. `--wrap` remains "wrap without chaining".
R6. Replace the superseded no-`--next` rationale at `dev-runall.md:27-32` wholesale. It argues against the old meaning and does not carry; do not amend it.
R7. Each affected command records a one-line "was: …" note so an operator can see what changed.

#### Part B — `--json` / `--auto` normalization

R8. Apply the task 0399 availability rule across all 28 commands: `--json` where the command already produces a structured result a script could consume; `--auto` where it already has at least one HITL gate.
R9. The rule forces a declaration only where the underlying capability already exists. A command that meets the rule and omits the flag is a bug to fix here.
R10. A command that would meet the rule but lacks the underlying capability is recorded as a separate follow-up request — do **not** build the capability under the banner of consistency. This is the primary scope risk in this task.
R11. Every deliberate exception is recorded inline with its reason, so a future reader can tell a decision from an oversight.

#### Boundaries

R12. Do not add, remove, or alter `--agent` on any command — deferred to feature H9.
R13. Behavior lives in the router (task 0399 Part B). These files stay thin wrappers; no per-command chain logic.
R14. Build the capability inventory (structured result? HITL gate?) from the command bodies, not from the existing flag list — the flag list is the thing under audit.
### Acceptance Criteria
Covers feature scenarios R4, R5, R6, R7 and R9.

```gherkin
Feature: command surface reconciliation

  Scenario: --next resolves to one documented meaning everywhere
    Given the set of commands whose argument-hint declares --next
    When each command's documentation is read
    Then every one describes --next as chain-to-completion with propagation
    And no command describes it as a mode selector, a status transition, or a no-op

  Scenario: The one genuinely breaking case warns, time-boxed
    Given dev-run whose --next previously selected implement-only mode
    When dev-run is invoked with --next
    Then the command text instructs the agent to state that --next has been redefined
    And it names --mode implement as the replacement
    And the warning is marked for removal after one release

  Scenario: dev-run implement-only has a non-overloaded spelling
    Given an operator who wants only the implement step
    When they consult dev-run's documentation
    Then --mode implement is the documented way to do it
    And --next no longer selects that mode

  Scenario: dev-runall accepts --next with batch-once wrap
    Given a batch of tasks run through dev-runall with --next
    When every task reaches terminal status
    Then the wrap hop runs once for the batch rather than once per task
    And the superseded rationale in dev-runall.md is replaced

  Scenario: Previously undefined declarations are resolved
    Given dev-refine, dev-refineall and dev-brainstorm declared --next without defining it
    When each is reviewed
    Then it either documents the canonical meaning or drops the declaration
    And the reason is recorded

  Scenario: --json and --auto follow the stated availability rule
    Given the flags --json and --auto and the availability rule from task 0399
    When the 28 commands are reviewed against it
    Then each command that already has the underlying capability declares the flag
    And each deliberate exception records its reason

  Scenario: Missing capability is recorded rather than built
    Given a command that would meet the rule but lacks the underlying capability
    When the rule is applied
    Then a follow-up request is recorded
    And the capability is not built in this task

  Scenario: --agent coverage is untouched
    Given --agent is handled separately in feature H9
    When the diff for this task is reviewed
    Then no command's --agent declaration is added, removed, or altered
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Decide the per-command disposition before editing anything

The seven declaring commands do not all get the same treatment, and deciding case-by-case while
editing produces an inconsistent surface. Settle the table first:

| Command | Disposition | Basis |
|---|---|---|
| `dev-verify`, `dev-verifyall` | keep, redocument | old behavior is subsumed — the transition becomes the chain's first hop, so existing invocations still work |
| `dev-run` | keep flag, remove mode overload | `--mode implement` already exists and `routing-table.md` A5 already dispatches it alongside `--next`, which is evidence the overload was accidental |
| `dev-review` | drop | already a deprecated no-op; redefining a flag nobody should pass is churn |
| `dev-runall` | adopt | R5 — chain per task, wrap once for the batch |
| `dev-refine`, `dev-refineall`, `dev-brainstorm` | **open — decide per command** | declared but never defined; see below |

For the three undefined ones the question is whether chaining is meaningful. `dev-refine` and
`dev-refineall` sit in the planning half, and `routing-table.md` A1 already dispatches
`/sp:dev-refine <wbs> --auto --next` expecting it to chain into run → verify — so refine almost
certainly keeps it. `dev-refineall`'s existing "avoid `--next`, token bomb" warning is a real
concern about batch scale, not an argument against the semantics; resolve it by keeping the flag and
keeping the warning as guidance, or by dropping the flag at the batch level and pointing at
`dev-runall`. `dev-brainstorm` has the weakest case — it produces options, not a task in a
lifecycle, so there may be no next step to chain to.

Whatever is chosen, R4 requires the reason recorded per command.

#### Sequencing within the task

`--next` reconciliation first, `--json`/`--auto` normalization second, in two passes over the same
files. They were merged from separate tasks for ceremony reasons, not because the edits interleave —
doing them as one pass invites conflating "this flag changed meaning" with "this flag was added",
which makes the diff hard to review and the "was: …" notes (R7) hard to place.

#### The scope trap in Part B

R10 is the requirement most likely to be violated under time pressure: a command that *should* emit
`--json` but has no structured output tempts you to add the output "while you're in there". That is
feature work wearing a consistency costume, and it will not be reviewed as feature work. Record it,
move on.

Practical test for R9 versus R10: if declaring the flag requires touching only the argument-hint and
the flag table, it is a bug to fix here. If it requires changing what the command *produces*, it is a
follow-up.

#### Boundary to guard

R13 — no chain logic in the command files. The temptation is a line like "after this, run X" in each
command. That is the routing table, duplicated seven times, which is the exact defect this feature
exists to remove. Commands reference the glossary and the router; they do not describe successors.
### Plan
- [ ] Enumerate the declaring commands mechanically from argument-hints; do not trust this list to have stayed current.
- [ ] Per command, apply the glossary meaning or drop the flag, recording the reason.
- [ ] `dev-run`: remove the mode overload, add the time-boxed warning, point at `--mode implement`.
- [ ] `dev-review`: delete the deprecated no-op.
- [ ] Resolve `dev-refineall`'s self-contradicting 'avoid --next' warning.
- [ ] `dev-runall`: adopt `--next` with batch-once wrap; replace the old rationale wholesale.
- [ ] Add 'was: …' notes.
- [ ] Verify no chain logic leaked into a command file.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

H8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
