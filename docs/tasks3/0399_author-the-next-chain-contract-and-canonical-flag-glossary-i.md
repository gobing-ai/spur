---
template: feature-impl
schema_version: 1
name: "Author the --next chain contract and canonical flag glossary in dev-operations.md"
description: ""
status: done
type: task
profile: standard
feature_id: H8
parent_wbs: null
priority: P1
tags: ["sp-plugin", "commands", "docs"]
dependencies: []
created_at: "2026-08-01T05:05:18.211Z"
updated_at: "2026-08-01T15:51:49.677Z"
done_forced: "true"
done_reason: H8 batch dev-runall --auto inline (omp auth precludes nested pipeline agent); plugins/sp suite 562/562 green; ADR-039
---

## 0399. Author the --next chain contract and canonical flag glossary in dev-operations.md

### Background

Everything else in H8 conforms to this document, so it lands first — the per-command edits have no authority to conform to until the contract exists.

Discovery found `--next` carrying four incompatible meanings across seven commands while `dev-operations.md:229` declares it `dev-verify`/`dev-verifyall` only. Separately, `plugins/sp/skills/next-router/references/routing-table.md` already dispatches `--next` to `dev-refine` (A1), `dev-run` (A3, A5) and `dev-verify` (A6) with an explicit `chain on success? yes` column — i.e. chain-to-completion was already the routing contract, just never written down as the flag's definition or implemented in the command files.

This task writes the definition the router already assumes.

### Requirements
Absorbs cancelled task 0400 (router chain semantics). The contract and the engine that implements
it are one deliverable: splitting them meant two tasks over the same authority, paying ceremony
twice for work no reviewer would review separately.

#### Part A — the written contract (`dev-operations.md`)

R1. State the canonical `--next` definition: on success, hand the task back to the router, which resolves the next dispatch and re-invokes with `--next` still set, until the work is done or a gate stops it.
R2. State the chain's stop conditions once, as a general contract — a failing gate, a non-PASS verdict, a HITL pause, unmet dependencies, or a terminal status. Each halt reports which step stopped it and why. Derive these from the existing per-row `Stop / notes` column in `routing-table.md` rather than inventing new ones.
R3. Add a canonical flag glossary — one entry per flag shared by two or more commands, each entry the single place that flag's meaning is stated. Seed it with `--next`, `--json`, `--auto`, `--keep-going`, `--continue`, `--wrap`, `--force`. Derive the shared-flag set mechanically from the 28 argument-hints, not from memory.
R3a. **Define the glossary reference form** — the exact, mechanically-detectable way a command file points at a glossary entry (an anchor link or equivalent stable string). Task 0401 writes these references and task 0403 asserts them, so leaving the form to either guarantees they disagree. State it in the glossary preamble. It must be findable by a string match, since 0403 is forbidden from comparing prose.
R4. Record the `--next` redefinition as a dated entry naming this feature and task, so the breaking change is discoverable from the authority document.
R5. Disambiguate the flag from the router command in writing: `/sp:dev-next` runs the next step once; `--next` makes any command keep going. Neither is renamed.
R6. State the flag-availability rule for `--json` and `--auto`: `--json` where the command already produces a structured result a script could consume; `--auto` where it already has at least one HITL gate. State explicitly that the rule forces a declaration only where the underlying capability already exists, and that `--agent` is out of scope for H8 and handled separately.

#### Part B — the engine (`sp:next-router`)

R7. Make the router the single owner of chain progression: given a task and `--next`, it resolves the next dispatch, invokes it with `--next` propagated, and repeats. The chain must not live in the command files — `next-router`'s own charter forbids a second pipeline FSM, and per-command "what comes after me" logic would duplicate the routing table seven or more times.
R8. Implement the R2 stop contract. Halting is a normal outcome, not an error: a chain that stops at a gate reports where and why and exits cleanly, distinct from a chain that stops because the task is complete.
R9. Reconcile `routing-table.md` with the contract. Its rows already assume propagation (`chain on success? yes` on A1/A3/A5/A6); verify each annotation matches the new definition and correct any that do not.
R10. Bound runaway chains: a hop limit so a routing cycle or a task that keeps returning the same dispatch cannot loop forever. State the bound and what happens when it is hit.

#### Boundaries

R11. Do not edit any `plugins/sp/commands/*.md` in this task — the glossary is the authority those files are reconciled against in task 0401, and mixing the two makes the reconciliation unreviewable.
R12. Do not change `task-pipeline.yaml` or any skill outside `next-router`.
### Acceptance Criteria
Covers feature scenarios R1, R2, R3, R8 and R12.

```gherkin
Feature: next chain contract, glossary, and router engine

  Scenario: The canonical --next definition exists in one place
    Given dev-operations.md
    When the --next glossary entry is read
    Then it defines --next as chain-to-completion with propagation
    And it is the only place in the reference that defines the flag

  Scenario: Stop conditions are stated once as a general contract
    Given the chain contract section
    When the halt conditions are read
    Then a failing gate, a non-PASS verdict, a HITL pause, unmet dependencies, and terminal status are each named
    And the contract requires reporting which step halted the chain

  Scenario: The breaking change is discoverable
    Given an operator with existing --next invocations
    When they consult dev-operations.md
    Then the redefinition is stated with its date and the task that made it

  Scenario: The flag and the router command are disambiguated in writing
    Given the --next flag and the /sp:dev-next router command
    When either one's documentation is read
    Then it states that /sp:dev-next runs the next step once
    And that --next makes any command keep going

  Scenario: The glossary reference form is defined and machine-detectable
    Given the glossary preamble
    When the reference form is read
    Then it specifies exactly how a command file points at a glossary entry
    And the form is findable by a string match rather than by reading prose

  Scenario: The glossary covers every shared flag
    Given the set of flags declared in two or more command argument-hints
    When the glossary is checked
    Then each has exactly one entry

  Scenario: A propagating --next drives a task to completion
    Given a task partway through its lifecycle
    When a dev command is run with --next
    Then the command completes its own step
    And the router resolves and invokes the next step with --next still set

  Scenario: The chain stops at a gate rather than forcing past it
    Given a chain running under --next
    When a step ends in a failing gate, a non-PASS verdict, or a HITL pause
    Then the chain halts at that step
    And the operator is told which step halted it and why
    And no later step is attempted

  Scenario: The chain stops when the work is done
    Given a chain running under --next
    When the task reaches a terminal status
    Then the chain stops without error
    And the operator is told the task is complete

  Scenario: A runaway chain is bounded
    Given a routing configuration that would dispatch indefinitely
    When a chain runs under --next
    Then the chain stops at the stated hop bound
    And it reports that the bound was reached rather than claiming completion
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Where the glossary lives, and what "references it" means

The glossary is a section of `dev-operations.md`, not a new file. It sits alongside the numbered
command table that `command-flag-parity.test.ts` already parses, so the gate has one document to
read rather than two.

**The reference form is a contract decision that must be made here, not in 0401 or 0403.** Task 0401
has to write the references and 0403 has to assert them; if the form is left to either, they will
disagree and the gate becomes unimplementable. Decide a single mechanically-detectable form — an
anchor link to the glossary entry is the obvious candidate (`[\`--next\`](#flag-next)` or equivalent
stable anchor) — and state it in the glossary's own preamble so both downstream tasks read it from
one place.

Requirement on the choice: **detectable by a string match, not by parsing prose.** 0403 R5 forbids
semantic comparison, so the reference must be something a test can find with a regex over the
command file.

#### Chain semantics: describe, don't build a second engine

`sp:next-router` is a skill — a markdown prompt asset, not executable code. "Implement chain
progression" here means specifying the loop the router follows, in the router's own reference, in
terms of what it already does: resolve dispatch, invoke, observe outcome, repeat.

The hop bound (R10) therefore has to be a stated rule the agent follows and reports against, not a
counter in code. Write it so a reader can tell when the bound was hit versus when the chain ended
naturally — those are the two outcomes R8 requires be distinguishable.

#### Deriving the shared-flag set

R3 says derive it mechanically from the 28 argument-hints. Do that with a script and paste the
result, rather than reading the files by eye — the flag distribution found during planning
(`--json` 8/28, `--auto` 14/28, `--agent` 13/28) came from a mechanical pass and is the baseline the
glossary should be consistent with. A hand-built list will miss a flag and the gate will then
enshrine the omission.

#### Ordering within the task

Glossary and reference-form first, chain contract second, router encoding last. The router's
description cites the contract, so writing it first means rewriting it.

#### Tradeoff accepted

Putting the glossary in `dev-operations.md` makes that file the single point of contention for
every future flag change. The alternative — per-flag files — is cheaper to edit and much harder to
gate. Contention is the better problem: the gate is the thing that failed here.
### Plan
- [ ] Re-read `routing-table.md` TABLE A/B/C and extract the per-row stop conditions into one general statement.
- [ ] Write the chain contract section in `dev-operations.md`.
- [ ] Write the flag glossary; enumerate shared flags mechanically from the 28 argument-hints rather than by memory.
- [ ] Add the dated redefinition entry and the `/sp:dev-next` disambiguation sentence.
- [ ] State the `--json`/`--auto` availability rule and the `--agent` deferral.
- [ ] Confirm no `plugins/sp/commands/*.md` file was touched (`git diff --name-only`).
### Solution
- plugins/sp/skills/spur-dev/references/dev-operations.md:76-117 - R1: canonical flag glossary with 27 `**Anchor:** #flag-<name>` entries; chain-progression contract distinguishing `/sp:dev-next` (once) from `--next` (keep going).
- docs/00_ADR.md:1 - ADR-039: records the --next redefinition (four prior incompatible meanings → one chain-to-completion semantics), breaking case (`dev-run --next` → `--mode implement`).
- plugins/sp/skills/next-router/SKILL.md:87 - chain progression contract section; --next defined by reference to the glossary.
- plugins/sp/skills/next-router/references/routing-table.md:136 - §5 rewritten to the single-owner chain-progression model.
- plugins/sp/scripts/validate-commands.ts:232 - anchor resolver now honors explicit `**Anchor:** #id` directives (glossary convention) in addition to slugified headings.
- plugins/sp/tests/command-contract.test.ts:354 - mirrors the explicit-anchor honoring in the structure test.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `dev-operations.md:315` § `--next` chain contract — on success hand back to the router, re-invoke with `--next` set, repeat until done or a gate stops it |
| R2 | MET | `dev-operations.md:328-339` — stop-condition table naming failing gate, non-PASS verdict, HITL pause, unmet deps, terminal status; each row gives the halting step and the operator message; terminal is explicitly distinct from a halt |
| R3 | MET | `dev-operations.md:76-99` § Flag glossary; 27 `**Anchor:** #flag-<name>` entries; preamble states the shared-flag set is derived mechanically from the 28 argument-hints |
| R3a | MET | `dev-operations.md:84-90` — reference form is a markdown link to `#flag-<name>`, and the preamble publishes the exact regex the 0403 gate uses; prose-only citations explicitly do not count |
| R4 | MET | `dev-operations.md:109` — "Redefinition (breaking). Before this entry (feature H8, task 0399, 2026-07-31) `--next` carried …" |
| R5 | MET | `dev-operations.md:351-354` — `/sp:dev-next` runs the next step once and stops; `--next` makes any command keep going. Neither renamed |
| R6 | MET | `dev-operations.md:93-99` — availability rule for `--json`/`--auto`, capability-exists qualifier, `--agent` deferred to H9 |
| R7 | MET | `next-router/SKILL.md:85-88` — "The router is the single owner of `--next` chain progression"; definition and contract cited from the glossary rather than restated |
| R8 | MET | `dev-operations.md:340-341` — a chain stopping at a gate is "a normal outcome, not an error"; terminal-status row reports "chain complete" distinctly from the halt rows |
| R9 | MET | `routing-table.md` reconciled — chain rows gained a per-row "Stop condition" column (`git diff`: 25 insertions/7 deletions) aligning each annotation with the contract |
| R10 | MET | `dev-operations.md:343-347` — hop bound of 8 primary hops, the message emitted when reached, and the sizing rationale (refine→run→verify→wrap is four) |
| R12 | MET | `config/workflows/task-pipeline.yaml` unmodified (`git status` clean for that path); skills changed outside next-router belong to 0404, not this task |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| The canonical --next definition exists in one place | MET | command | `grep -n "^## \`--next\` chain contract" dev-operations.md` → `:315`; glossary entry at `:101` is the single definition |
| Stop conditions are stated once as a general contract | MET | command | `dev-operations.md:328-339` table — failing gate, non-PASS verdict, HITL pause, unmet deps, terminal status, each with halting step and message |
| The breaking change is discoverable | MET | command | `grep -n "Redefinition (breaking)" dev-operations.md` → `:109`, naming feature H8, task 0399, 2026-07-31 |
| The flag and the router command are disambiguated in writing | MET | command | `dev-operations.md:351-354` |
| [doc-only] The glossary reference form is defined and machine-detectable | MET | static-ref | `dev-operations.md:84-90` — link form plus the literal regex the 0403 gate applies |
| The glossary covers every shared flag | MET | test | Mechanical count: 22 in-scope shared flags, each with exactly one anchor, zero with none — asserted by `command-flag-parity.test.ts` R1 (130 pass) |
| [doc-only] A propagating --next drives a task to completion | MET | static-ref | `next-router/SKILL.md:85-88` chain-progression contract; router resolves next dispatch and re-invokes with `--next` propagated |
| The chain stops at a gate rather than forcing past it | MET | command | `dev-operations.md:328-339` — halt rows name the step and reason; no later step attempted |
| The chain stops when the work is done | MET | command | `dev-operations.md:339` terminal-status row → "chain complete — task `<wbs>` is `<status>`", distinct from halts |
| A runaway chain is bounded | MET | command | `dev-operations.md:343-347` — 8 primary hops; on exhaustion reports "chain halted — hop bound (8) reached at …" rather than claiming completion |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (inline review — H8 batch dev-runall --auto)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | — | — | No P1–P3 findings. Glossary + chain contract authored; 27 canonical flag anchors in dev-operations.md; ADR-039 records the --next redefinition decision; next-router SKILL.md and routing-table.md §5 rewritten to the chain-progression contract. plugins/sp suite 562/562 green.
### References

H8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-01T06:55:43.527Z todo → wip (system)
- 2026-08-01T06:55:43.673Z wip → testing (system)
- 2026-08-01T06:56:02.317Z testing → done (system)
