---
schema_version: 1
id: "H8"
name: "sp command surface coherence: --next as run-to-completion, flag vocabulary normalization, semantic parity gate"
status: backlog
priority: P1
tags: []
created_at: "2026-08-01T04:54:00.998Z"
updated_at: "2026-08-01T05:20:53.985Z"
---

# H8: sp command surface coherence: --next as run-to-completion, flag vocabulary normalization, semantic parity gate

## Goal
Make the 28 `/sp:dev-*` slash commands coherent as a single surface, so a flag means one thing
everywhere and the common operations are available everywhere they make sense.

Two concrete outcomes:

1. **`--next` means one thing: run to completion, propagating itself.** Today it carries four
   incompatible meanings across seven commands, and the canonical definition in
   `dev-operations.md:229` contradicts five of them. The operator's expectation — "finish the
   remaining work and carry the flag forward" — currently matches none of the four, and no
   run-to-completion affordance exists on the surface at all.

2. **Shared flags are consistently available.** `--json` appears on 8 of 28 commands, `--agent` on
   13, `--auto` on 14, with no stated rule for the gaps.

Plus the gate that should have prevented drift: `command-flag-parity.test.ts` asserts flag
*presence* parity only, never that a flag means the same thing across commands, so four
contradictory `--next` definitions pass green.

This is the command-surface counterpart to H6's agent-roster rescope — same method (audit, assign
one clear charter, gate the result), applied to flags rather than agents. It deliberately does
**not** rescope command charters or consolidate commands; that is a separate, larger question.

**This is a breaking change**, chosen deliberately over introducing a new flag: every current
`--next` call site changes meaning. Migration is in scope.
## Scope
### In scope

- **Redefine `--next`** on every command that declares it: chain to the next lifecycle step and
  propagate `--next` to that step, until the work is done or a gate stops it.
- **Retire the conflicting meanings**: `dev-run`'s `--next` = implement-only (route to the existing
  `--mode implement`), `dev-review`'s deprecated no-op, and the undocumented declarations on
  `dev-refine`, `dev-refineall`, and `dev-brainstorm`.
- **Adopt `--next` on `dev-runall`** (decided): chain each task to terminal status, then run the
  wrap hop **once for the batch**, mirroring the batch-once shippable gate `dev-verifyall` already
  established. `--wrap` remains "wrap without chaining". Batch-once is the point — per-task feature
  transition and branch cleanup across a batch is the risky shape, and this avoids it. The existing
  rationale at `dev-runall.md:27-32` is replaced, not amended: it argues against the *old* meaning.
- **Define stop conditions** for a propagating `--next`: what halts the chain (gate failure, HITL
  pause, non-PASS verdict, terminal status) and what it does on partial success.
- **Migration (time-boxed)**: a dated entry in `dev-operations.md` and a one-line "was: …" note in
  each affected command file. An agent-facing deprecation warning goes on **`dev-run` only** — the
  single genuinely breaking case — and is removed after one release. `dev-verify`/`dev-verifyall`
  get no warning: their old behavior is subsumed by the chain's first hop, so existing invocations
  keep working. Note these commands are markdown prompt files, not code: "warn" means instruction
  text the agent speaks, which is why it is scoped narrowly and time-boxed rather than applied
  across all seven.
- **Flag-vocabulary normalization** for `--json` and `--auto` across all 28 commands, under a
  stated rule: `--json` where the command already produces a structured result a script could
  consume; `--auto` where the command already has at least one HITL gate. **The rule forces a
  declaration only where the underlying capability already exists** — a command meeting the rule
  but omitting the flag is a bug to fix here; a command lacking the capability is a separate feature
  request to record, not to build under the banner of consistency.
- **Extend `command-flag-parity.test.ts`** to catch semantic drift, not just presence — a flag
  declared by multiple commands must resolve to one documented meaning.
- **Amend the decomposition granularity standard** to add a cohesion dimension (task 0404). H8's own
  first decomposition produced five hour-compliant tasks that the operator correctly rejected as
  over-split — three edited the same files. The standard measures hours and is silent on per-task
  ceremony cost. Housed here because H8's planning produced the evidence and the fix is one
  reference file; a separate feature for one doc change would be the ceremony this reduces.
- **Document** the `--next` (flag) vs `/sp:dev-next` (router command) relationship rather than
  renaming either: `/sp:dev-next` runs the next step once, `--next` makes any command keep going.
  Renaming the command breaks routing tables and references; renaming the flag defeats the
  operator's muscle memory. The collision is confusing only because that sentence is unwritten.

### Out of scope

- Rescoping command charters or consolidating the 28 commands into fewer — the H6-style role
  question. Larger, and independent of flag coherence.
- Changing the underlying skills, agents, or `task-pipeline.yaml` behavior. This feature changes the
  command surface and its gate only.
- The `sp:spur-cli` CLI-noun surface (`spur task`, `spur feature`, …). H6 already covered it; this
  is the slash-command layer.
- **`--agent` / executor work — moved to feature H9.** Naming (`--agent` vs `--executor`), `--inline`
  as the new default, and tier-based fallback are runtime TypeScript against `agent-service` and the
  stage registry, not command-surface markdown, and carry a different risk profile. `--json` and
  `--auto` proceed here; `--agent` stays at its current 13/28 coverage and must not be touched by
  this feature.
- Retrofitting `--next` onto commands where chaining is meaningless (`dev-changelog`, `dev-daily`,
  `dev-gitmsg`, …). Normalization means a stated rule, not universal application.
## Acceptance Criteria
```gherkin
Feature: sp command surface coherence

  Scenario: R1 — A propagating --next drives a task to completion
    Given a task partway through its lifecycle
    When the operator runs a dev command with --next
    Then the command completes its own step
    And it chains to the next lifecycle step for that task
    And it passes --next to that step so the chain continues

  Scenario: R2 — The chain stops at a gate rather than forcing past it
    Given a chain running under --next
    When a step ends in a failing gate, a non-PASS verdict, or a HITL pause
    Then the chain halts at that step
    And the operator is told which step halted it and why
    And no later step is attempted

  Scenario: R3 — The chain stops when the work is done
    Given a chain running under --next
    When the task reaches a terminal status
    Then the chain stops without error
    And the operator is told the task is complete

  Scenario: R4 — --next resolves to one documented meaning everywhere
    Given the set of commands whose argument-hint declares --next
    When each command's documentation is read
    Then every one describes --next as chain-to-completion with propagation
    And no command describes it as a mode selector, a status transition, or a no-op

  Scenario: R5 — The one genuinely breaking case warns, time-boxed
    Given dev-run whose --next previously selected implement-only mode
    When the operator invokes dev-run with --next
    Then the command text instructs the agent to state that --next has been redefined
    And it names --mode implement as the replacement
    And the warning is marked for removal after one release

  Scenario: R6 — dev-run implement-only has a non-overloaded spelling
    Given the operator wants to run only the implement step
    When they consult dev-run's documentation
    Then --mode implement is the documented way to do it
    And --next no longer selects that mode

  Scenario: R7 — dev-runall accepts --next with batch-once wrap
    Given a batch of tasks run through dev-runall with --next
    When every task reaches terminal status
    Then the wrap hop runs once for the batch rather than once per task
    And the superseded no---next rationale is replaced in dev-runall.md

  Scenario: R8 — The breaking change is discoverable
    Given an operator with existing --next invocations
    When they consult dev-operations.md and the affected command files
    Then the redefinition is stated with its date and the task that made it
    And each affected command records what its --next used to mean

  Scenario: R9 — --json and --auto follow a stated availability rule
    Given the flags --json and --auto and the stated availability rule
    When the 28 commands are reviewed against it
    Then each command that already has the underlying capability declares the flag
    And each command lacking the capability is recorded as a separate request rather than built
    And --agent coverage is left untouched by this feature

  Scenario: R10 — The parity gate anchors shared flags to one glossary entry
    Given a flag declared in the argument-hint of more than one command
    When the parity test runs
    Then it asserts the flag has exactly one canonical glossary entry in dev-operations.md
    And it asserts each declaring command references that entry
    And a command that omits the reference fails the build

  Scenario: R11 — The parity gate still catches presence drift
    Given the existing presence-parity assertions from task 0397
    When a flag is added to an argument-hint without a dev-operations.md entry
    Then the parity test still fails as it did before

  Scenario: R12 — The flag and the router command are disambiguated in writing
    Given the --next flag and the /sp:dev-next router command
    When an operator reads either one's documentation
    Then it states that /sp:dev-next runs the next step once
    And that --next makes any command keep going
    And neither the flag nor the command is renamed

  Scenario: R13 — The repository stays green
    Given the full verification gate
    When lint, test, and build are run
    Then all three pass with no skipped tests introduced to reach green
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0399 | Author the --next chain contract and canonical flag glossary in dev-operations.md | todo |
| 0400 | Encode chain-to-completion semantics in the sp:next-router skill | cancelled |
| 0401 | Reconcile --next across the seven declaring commands and adopt it on dev-runall | todo |
| 0402 | Normalize --json and --auto availability across the 28 dev commands | cancelled |
| 0403 | Extend command-flag-parity to anchor shared flags to one glossary entry | todo |
| 0404 | Add a cohesion dimension to the decomposition granularity standard | todo |
<!-- END AUTO-GENERATED -->

## Notes
### Reframing — this is reconciliation, not redesign

Discovery found that `plugins/sp/skills/next-router/references/routing-table.md` **already defines
`--next` as chain-to-completion with propagation**. Its TABLE A rows dispatch
`/sp:dev-refine <wbs> --auto --next` (A1), `/sp:dev-run <wbs> --auto --next` (A3),
`/sp:dev-run <wbs> --mode implement --auto --next` (A5), and `/sp:dev-verify <wbs> --auto --next`
(A6), each annotated *"chain on success? **yes**"* with the downstream hop named.

So the operator's expectation is not a new requirement — it is the **existing routing contract**,
which the command files never implemented. Two consequences that shape the whole feature:

- The semantics are already specified and reviewed; this feature makes the surface honor them
  rather than inventing behavior.
- `dev-run`'s `--next` = implement-only is provably the anomaly, not a design choice: A5 spells
  implement-only as `--mode implement` *and* passes `--next` alongside it, so the two were always
  meant to be different axes.

This lowers the risk of the breaking change considerably: we are aligning the surface to its own
documented router, not overturning a settled decision.

### Where the chain logic lives

**In `sp:next-router`, not in the 28 command files.** The commands stay thin wrappers.

`--next` on any command means: *when this command's step succeeds, hand the task back to the
router, which looks up the next dispatch and re-invokes with `--next` still set.* The router
already owns TABLE A/B/C and already stops with exact `dev-next:` messages.

Rejected alternative: per-command "what comes after me" logic. That would duplicate the routing
table 7+ times and guarantee drift — the same class of defect this feature exists to fix. The
router's own charter forbids it too: *"Never a second pipeline FSM."*

### Stop conditions — already enumerated, needs surfacing

The routing table's *"Stop / notes"* column already defines them per row: unmet dependencies stop
with the blocking WBS list (A2); a failed refine guard stops review-pending (A1); PARTIAL/FAIL
verdict stops without forcing done (A6). The work is to state them once as a general contract and
make each command's `--next` documentation point at it, rather than restating per command.

The general rule to document: a chain advances only on unambiguous success, and halts on a failing
gate, a non-PASS verdict, a HITL pause, unmet dependencies, or a terminal status — reporting which
step halted it and why.

### Migration

Breaking by operator decision. The old meanings and their replacements:

| Command | Old `--next` | Replacement |
|---|---|---|
| `dev-run` | implement-only mode | `--mode implement` (already exists, already used by A5) |
| `dev-verify` / `dev-verifyall` | PASS → transition `testing → done` | subsumed: the transition is simply the first hop of the chain |
| `dev-review` | deprecated no-op | already deprecated; remove |
| `dev-refine`, `dev-refineall`, `dev-brainstorm` | declared, never defined | no replacement needed — they gain the real meaning |

`dev-verify`'s case is the mildest: chain-to-completion *includes* the transition it used to do, so
existing invocations still transition; they just continue afterward. `dev-run` is the only genuinely
breaking one, and its replacement spelling already exists.

Migration surface: a deprecation note where `--next` is documented, a dated entry in
`dev-operations.md`, and per-command records of what the flag used to mean.

### `dev-runall`'s asymmetry

Its written rationale (`dev-runall.md:27-32`) argues that `--next` is a no-op there because the full
pipeline already contains every step `--next` could chain to. That reasoning is sound for the *old*
meaning and does not survive the new one: under chain-to-completion, a batch could chain each task
past pipeline-end into wrap. The rationale must be re-derived or the flag adopted — the feature
requires a decision either way (R7), not a particular outcome.

### Flag-vocabulary normalization

Needs a **stated rule** before any edits, or normalization becomes taste. Proposed:

- `--json` — every command that returns a structured result a script could consume.
- `--agent` — every command that dispatches an `agent.run`.
- `--auto` — every command with at least one HITL gate.

Apply the rule, then record deliberate exceptions inline. A command that meets the rule but omits
the flag is a bug; one that omits it with a stated reason is a decision.

### Parity gate extension

`command-flag-parity.test.ts` asserts presence parity only (`:8-10`) — *"every flag in its
argument-hint appears in that table row, and every flag in the row appears in the argument-hint"*.
Four contradictory `--next` definitions pass green today.

Add a semantic-coherence assertion: for any flag declared by more than one command, the documented
meanings must agree. The cheapest workable form is a canonical flag glossary in `dev-operations.md`
that each command's flag documentation must not contradict — checked by the test. Exact matching
strategy is an implementation decision for the task; the requirement is that disagreement fails the
build.

### Sequencing

The glossary and the chain contract must land before the per-command edits, or the edits have no
authority to conform to. Rough order: contract + glossary → router chain semantics → per-command
`--next` reconciliation → flag normalization → gate extension. The gate lands last so it validates
the finished surface rather than blocking intermediate states.
## History
