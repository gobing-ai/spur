---
template: feature-impl
schema_version: 1
name: "Extract the flag glossary out of dev-operations.md into its own reference"
description: ""
status: todo
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["sp-plugin", "skills", "spur-dev", "refactor"]
dependencies: []
created_at: "2026-08-01T16:36:59.760Z"
updated_at: "2026-08-01T16:57:29.382Z"
---

## 0408. Extract the flag glossary out of dev-operations.md into its own reference

### Background

`plugins/sp/skills/spur-dev/references/dev-operations.md` is 750 lines, and measurement shows it is two documents fused rather than one long one:

| Section                                                         | Lines     | Reader              | Access pattern                                                             |
| --------------------------------------------------------------- | --------- | ------------------- | -------------------------------------------------------------------------- |
| Flag glossary + `--next` chain contract                         | 281 (37%) | command files       | 79 deep anchor links (`#flag-*`) — read one ~10-line entry, never linearly |
| Operation catalog (map, backing patterns, skill-backed, inline) | 450 (60%) | `sp:spur-dev` spine | 30 whole-file citations + 8 anchors — read as prose to drive an operation  |

The glossary only lives here because feature H8 (task 0399) put it here. Its reader is the command surface; the rest of the file's reader is the spine, which now pays 281 lines of flag-lookup data on every read.

Two alternatives were considered and rejected. **Compressing in place** does not address the mismatch — the glossary is 27 entries of necessary contract with no fat to remove. **Moving operation definitions back into the individual commands** would rebuild the exact defect H8 removed: before H8, `--next` carried four contradictory meanings precisely because each command defined its own, and `dev-operations.md` being the SSOT is what ended that (ADR-038, ADR-039).

This refactor has an unusual safety property worth exploiting: `command-flag-parity.test.ts` already asserts that every shared flag has exactly one glossary entry and that each declaring command links to it, so a missed or mistyped link fails the build loudly rather than rotting silently.

### Requirements

- R1. Move the `## Flag glossary` section (~238 lines, all `**Anchor:** #flag-<name>` entries plus the preamble stating the reference form and availability rule) and the `## `--next` chain contract` section (~43 lines) out of `dev-operations.md` into a new sibling reference under `plugins/sp/skills/spur-dev/references/`.
- R2. Keep the two moved sections together in the new file. They are one contract: the chain contract is the prose expansion of the `--next` glossary entry, and splitting them would put a definition and its explanation in different files.
- R3. Update all 79 `dev-operations.md#flag-*` anchor citations across `plugins/sp/commands/*.md` to the new path. Derive the list mechanically; do not hand-enumerate.
- R4. Leave the operation catalog (`## Operation map`, `## Two backing patterns`, `## Skill-backed operations`, `## Inline operations`) in `dev-operations.md`, whole and ungrouped. The 30 whole-file citations show it is read as a unit; grouping it would add navigation cost without reducing what a spine reader loads.
- R5. `command-flag-parity.test.ts` currently hardcodes a single `DEV_OPS_PATH` (`:29`) while doing two different jobs — parsing the numbered command table, and counting/locating glossary anchors. Split it into two path constants so each assertion reads the file that actually owns its data.
- R6. Update the pointers that name the glossary's location: ADR-039's **Detail** line, `spur-dev/SKILL.md`'s reference list, and any skill or command prose that cites the glossary by file rather than by anchor.
- R7. The content is moved verbatim. This is a relocation, not a rewrite — no entry is reworded, added, or dropped, so the diff is reviewable as a move.
- R8. Do not change the reference form itself (`[`--flag`](<path>#flag-name)`). The anchor scheme is a published contract that task 0399 defined and 0403 asserts; only the path component changes.

### Acceptance Criteria

```gherkin
Feature: flag glossary extraction

  Scenario: The glossary lives in its own reference
    Given the spur-dev references directory
    When the new glossary file is read
    Then it contains the flag glossary and the --next chain contract
    And dev-operations.md no longer contains either section

  Scenario: The operation catalog is left whole
    Given dev-operations.md after the extraction
    When its top-level sections are listed
    Then the operation map, backing patterns, skill-backed and inline operations all remain
    And none of them has been split into a separate file

  Scenario: Every command link resolves to the new location
    Given the command files that cite a glossary anchor
    When the parity gate runs
    Then every shared flag still has exactly one canonical glossary entry
    And every declaring command references that entry at its new path

  Scenario: The move is verbatim
    Given the glossary content before and after
    When the two are compared
    Then no entry has been reworded, added, or removed

  Scenario: Location pointers are updated
    Given ADR-039 and the spur-dev skill reference list
    When they are read after the extraction
    Then each names the new glossary file rather than dev-operations.md

  Scenario: The repository stays green
    Given the full verification gate
    When lint, test and build are run
    Then all three pass with no skipped tests introduced to reach green
```

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

#### Do the link rewrite mechanically, then let the gate prove it

The 79 citations are the bulk of the work and the only place a hand-edit could silently break something. Derive the set with a script (`grep -ro 'dev-operations\.md#flag-[a-z-]*'`), rewrite by path substitution, and rely on `command-flag-parity.test.ts` R2/R3 to catch anything missed — it asserts each declaring command carries a resolvable reference, so a stale path fails the build.

Run the gate **before** the change to record the baseline pass count, so "still passing" is a comparison rather than an assumption.

#### Naming

`flag-glossary.md` is the obvious name and matches the section heading it carries. Whatever is chosen becomes a published path in 79 links plus an ADR, so it should not need renaming later.

#### Why the chain contract travels with the glossary (R2)

The `--next` chain contract is the long-form expansion of one glossary entry — stop conditions, hop bound, reporting. Leaving it in `dev-operations.md` would separate a definition from its explanation across files and give the spine back a section it does not read. It is vocabulary, not operation behavior.

#### The one thing to resist

While moving 281 lines it will be tempting to improve wording. Do not — R7 makes this a pure relocation so the diff stays reviewable as a move. Improvements are a separate, later change against a stable baseline.

#### Deliberately out of scope

Splitting the operation catalog further (skill-backed 212 / inline 178) is the next natural seam if it keeps growing, but at 450 lines it is not warranted and the citation pattern argues against it. Revisit only if the catalog passes ~600 lines on its own.

### Plan

- [ ] Record the baseline: `bun test plugins/sp/tests/command-flag-parity.test.ts` pass count, and `wc -l dev-operations.md`.
- [ ] Create the new reference; move the two sections verbatim.
- [ ] Remove them from `dev-operations.md`; confirm the remaining top-level sections are exactly the four catalog sections.
- [ ] Rewrite the 79 anchor citations by script; confirm zero `dev-operations.md#flag-` references remain.
- [ ] Split `DEV_OPS_PATH` into two constants in the parity test.
- [ ] Update ADR-039 Detail, `spur-dev/SKILL.md`, and any file-level glossary citations.
- [ ] Verify the move was verbatim (diff the extracted text against the original section).
- [ ] Gate: parity test at or above baseline, `bun run lint`, `bun run test`, `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

H1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
