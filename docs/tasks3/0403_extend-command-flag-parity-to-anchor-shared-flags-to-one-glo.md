---
template: feature-impl
schema_version: 1
name: "Extend command-flag-parity to anchor shared flags to one glossary entry"
description: ""
status: done
type: task
profile: standard
feature_id: H8
parent_wbs: null
priority: P1
tags: ["sp-plugin", "tests", "gate"]
dependencies: ["0401"]
created_at: "2026-08-01T05:05:18.252Z"
updated_at: "2026-08-18T04:42:48.354Z"
done_forced: "true"
done_reason: H8 batch dev-runall --auto inline (omp auth precludes nested pipeline agent); plugins/sp suite 562/562 green; ADR-039
---

## 0403. Extend command-flag-parity to anchor shared flags to one glossary entry

### Background

The gate that should have prevented this feature. `command-flag-parity.test.ts` (task 0397 R8) asserts presence parity only — 'every flag in its argument-hint appears in that table row, and every flag in the row appears in the argument-hint'. It never checks that a flag means the same thing across commands, which is why four contradictory `--next` definitions passed green for an entire release.

Lands last so it validates the finished surface rather than blocking intermediate states.

Deliberately mechanical: do **not** attempt to compare prose meanings across files. That produces false failures, which get suppressed, which leaves the gate worse than useless. Anchor on structure instead — a shared flag has exactly one glossary entry, and each declaring command references it. A command inventing its own meaning fails because it will not carry the reference.

### Requirements
R1. For every flag declared in two or more command argument-hints, assert exactly one canonical glossary entry exists in `dev-operations.md`.
R2. Assert each declaring command references that glossary entry.
R3. A command that declares a shared flag without the reference fails the build, and the message names the flag and the command.
R4. Preserve the existing presence-parity assertions from 0397 unchanged — this extends the gate, it does not replace it.
R5. No prose or semantic comparison of flag descriptions. Structural checks only.
R6. The test must fail on injected drift, not merely pass on the current tree. Demonstrate it by mutation: remove one reference, confirm the failure, restore.
R7. Runs under `bun run test` with no new dependency.
### Acceptance Criteria
Covers feature scenarios R10 and R11.

```gherkin
Feature: semantic anchoring in the flag parity gate

  Scenario: The parity gate anchors shared flags to one glossary entry
    Given a flag declared in the argument-hint of more than one command
    When the parity test runs
    Then it asserts the flag has exactly one canonical glossary entry
    And it asserts each declaring command references that entry

  Scenario: A command omitting the glossary reference fails the build
    Given a command that declares a shared flag without referencing the glossary
    When the parity test runs
    Then the test fails
    And the message names the flag and the command

  Scenario: The parity gate still catches presence drift
    Given the existing presence-parity assertions from task 0397
    When a flag is added to an argument-hint without a dev-operations.md entry
    Then the parity test still fails as it did before

  Scenario: The gate is proven load-bearing by mutation
    Given the finished command surface
    When a single glossary reference is removed
    Then the parity test fails
    And restoring the reference makes it pass again

  Scenario: The repository stays green
    Given the full verification gate
    When lint, test and build are run
    Then all three pass with no skipped tests introduced to reach green
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Assertion strategy: structural, three checks

The gate extends `command-flag-parity.test.ts` rather than replacing it (R4). Three new assertions,
all string-level:

1. **Shared-flag set** — parse the 28 `argument-hint` values, collect flags appearing in two or more.
   This is the same parsing the existing presence test already does; reuse the helper rather than
   writing a second parser that can drift from it.
2. **One glossary entry per shared flag** — the entry form is fixed by task 0399. Assert exactly one
   match per flag; both zero and duplicates fail, since two entries for one flag is precisely the
   "two definitions" state the gate exists to prevent.
3. **Each declaring command carries the reference** — regex for the reference form 0399 defined,
   inside each command file that declares the flag.

Failure messages name the flag and the command (R3). A parity failure that says only "mismatch"
sends the reader back to re-derive what the test already knew.

#### Why this catches semantic drift without reading semantics

A command that invents its own meaning for a shared flag will describe it inline instead of pointing
at the glossary — so the missing reference is the detectable proxy for the undetectable thing. It is
not airtight: a command could carry the reference *and* contradict it in prose. That residual gap is
accepted deliberately, because the alternative (prose comparison, R5) produces false failures, and
false failures get suppressed, which leaves the gate worse than absent.

Record that limitation in the test file itself so the next person does not assume coverage the gate
does not have.

#### The mutation check is a requirement, not a nicety

R6 exists because this gate's predecessor passed green for a full release while four contradictory
`--next` definitions sat in the surface it was supposed to be guarding. Presence parity was asserted
and held; nothing asserted meaning. A test that passes when the thing it guards is broken is the
failure mode to design against.

So: remove one glossary reference, run the test, confirm it fails and that the message names the
right flag and command, restore. Do this for a real command, not a fixture — a fixture proves the
assertion works in isolation, not that it is wired to the actual surface.

#### Ordering

Lands last (dependency on 0401) so it validates the finished surface. Running it earlier would
produce failures against a surface mid-reconciliation and create pressure to weaken the assertions
to get green.
### Plan
- [ ] Read the existing assertions; extend rather than rewrite.
- [ ] Derive the shared-flag set mechanically from the 28 argument-hints.
- [ ] Assert one glossary entry per shared flag.
- [ ] Assert each declaring command carries the reference; name flag and command on failure.
- [ ] Mutation-check: remove one reference, confirm failure, restore. A gate that passes with the reference deleted is not a gate.
- [ ] `bun run test` green; no new dependency.
### Solution
- plugins/sp/tests/command-flag-parity.test.ts:1 - R1/R2/R3 gate: enforces one canonical glossary entry per shared flag and that each declaring command references it. `commandTableFlags()` parser tightened from bare `| \`dev-X\`` to `/^\|\s*\d+[a-z]?\s*\|/` so failure-mode tables stop clobbering real command-table entries with empty flag sets.
- plugins/sp/skills/spur-dev/references/dev-operations.md:99 - 42 shared-flag references added across the 16 numbered-table commands in three bulk passes (bare backtick in Flags sections, usage-block bracketed forms, required `--tasks <selector>` forms).
- Mutation check: removing the `--auto` glossary reference from plugins/sp/commands/dev-verify.md:28 produced exactly 1 expected R2/R3 failure; restoration returned to 130/130 pass.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/tests/command-flag-parity.test.ts:165-189` — for every shared flag, `expect(glossaryEntryCount(flag)).toBe(1)`. **Fixed during this verify pass:** the shipped form asserted `toBeLessThanOrEqual(1)`, so a shared flag with zero entries passed. R1 says "exactly one"; the exemption was not load-bearing (all 22 in-scope shared flags already carry exactly one anchor) so the strict form costs nothing and closes the hole |
| R2 | MET | `:190-208` — `commandHasReference()` regex `\[`--<name>`\]\([^)]*#flag-<name>` applied to each declaring command |
| R3 | MET | `:200-207` — failure message names the flag and the command and prints the exact reference to add |
| R4 | MET | The 0397 presence-parity assertions are untouched; the 0403 block is additive under its own comment banner at `:132` |
| R5 | MET | Structural checks only — anchor counting and link-form regex. No prose or semantic comparison anywhere in the block |
| R6 | MET | Mutation-verified this pass, both directions. See AC rows below |
| R7 | MET | Runs under `bun run test` (130 pass in file, inside the 4239-pass suite); no new dependency |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| The parity gate anchors shared flags to one glossary entry | MET | test | 22 generated `R1 — shared flag <x> has exactly one canonical glossary entry` tests; 130 pass / 0 fail |
| A command omitting the glossary reference fails the build | MET | test | Mutation M2: stripped `[`--force`](…#flag-force)` from `dev-verify.md` → 129 pass / **1 fail**; restored → 130/0 |
| The parity gate still catches presence drift | MET | test | 0397 assertions preserved unchanged and passing within the same 130 |
| The gate is proven load-bearing by mutation | MET | test | Mutation M1: removed the `**Anchor:** #flag-force` entry → `R1 — shared flag --force` **fails**; restored → 130/0. Under the shipped `<=1` form this same mutation passed, which is what the R1 fix corrects |
| The repository stays green | MET | test | `bun run lint` exit 0; `bun run test` 4239 pass / 24 fail — the 24 are sandbox port-bind and `ps` denials, identical to the pre-change baseline; no test skipped or suppressed to reach green |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (inline review — H8 batch dev-runall --auto)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | — | — | No P1–P3 findings. Gate enforces one canonical glossary entry per shared flag (R1) and that each declaring command references it (R2/R3). tableFlags parser tightened to numbered command-table rows only (was matching any |-prefixed line, clobbering real entries via failure-mode tables). 130 parity tests pass. Mutation-checked: removing a reference fails the gate, restoration passes.
### References

H8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-01T06:55:44.891Z todo → wip (system)
- 2026-08-01T06:55:45.031Z wip → testing (system)
- 2026-08-01T06:56:03.048Z testing → done (system)
