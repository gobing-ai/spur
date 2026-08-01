---
template: feature-impl
schema_version: 1
name: "Extend command-flag-parity to anchor shared flags to one glossary entry"
description: ""
status: todo
type: task
profile: standard
feature_id: H8
parent_wbs: null
priority: P1
tags: ["sp-plugin", "tests", "gate"]
dependencies: ["0401"]
created_at: "2026-08-01T05:05:18.252Z"
updated_at: "2026-08-01T05:27:21.830Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

H8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
