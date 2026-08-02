---
template: feature-impl
schema_version: 1
name: "Extract the flag glossary out of dev-operations.md into its own reference"
description: ""
status: done
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["sp-plugin", "skills", "spur-dev", "refactor"]
dependencies: []
created_at: "2026-08-01T16:36:59.760Z"
updated_at: "2026-08-02T00:05:43.221Z"
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
- [x] Record the baseline: `bun test plugins/sp/tests/command-flag-parity.test.ts` pass count, and `wc -l dev-operations.md`.
- [x] Create the new reference; move the two sections verbatim.
- [x] Remove them from `dev-operations.md`; confirm the remaining top-level sections are exactly the four catalog sections.
- [x] Rewrite the anchor citations mechanically; confirm zero `dev-operations.md#flag-` references remain.
- [x] Split `DEV_OPS_PATH` into two constants in the parity test.
- [x] Update ADR-039 Detail, `spur-dev/SKILL.md`, and file-level glossary citations.
- [x] Verify the move was verbatim against the pre-change section.
- [x] Gate: parity test at or above baseline, `bun run lint`, `bun run test`, `bun run test-cf`, and `bun run build`.
### Solution
| File | Change |
| --- | --- |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md:1` | Adds the reference wrapper around the verbatim glossary and `--next` chain sections. |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:14` | Leaves the four operation-catalog sections together and removes glossary-only content. |
| `plugins/sp/commands/*.md` | Mechanically repoints all 134 command flag anchors to `flag-glossary.md` without changing anchor names. |
| `plugins/sp/tests/command-flag-parity.test.ts:29` | Separates operation-table and glossary paths; parity assertions read the owning reference. |
| `docs/00_ADR.md:937` | Repoints ADR-039's canonical glossary location. |
| `plugins/sp/skills/spur-dev/SKILL.md:175` | Adds the extracted reference to the spine's reference map. |
| `plugins/sp/README.md:221` and affected plugin fixtures | Updates the documented reference inventory and path-sensitive contract fixtures. |

The task's cited count of 79 links was stale at implementation time: the mechanical HEAD baseline and working-tree result are both 134, with zero old-path command links remaining.
### Testing
Verdict: **PASS**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/skills/spur-dev/references/flag-glossary.md:16`, `plugins/sp/skills/spur-dev/references/flag-glossary.md:282`; old sections absent from `plugins/sp/skills/spur-dev/references/dev-operations.md` |
| R2 | MET | Both sections remain together in `plugins/sp/skills/spur-dev/references/flag-glossary.md:16` and `:282` |
| R3 | MET | Mechanical count: HEAD had 134 `dev-operations.md#flag-*` links; working tree has 134 `flag-glossary.md#flag-*` links and zero old-path command links |
| R4 | MET | `plugins/sp/skills/spur-dev/references/dev-operations.md:14`, `:52`, `:76`, `:289` retain the four catalog sections in one file |
| R5 | MET | `plugins/sp/tests/command-flag-parity.test.ts:29-30`, `:174` split operation-table and glossary ownership |
| R6 | MET | `docs/00_ADR.md:937-962`; `plugins/sp/skills/spur-dev/SKILL.md:175-178` |
| R7 | MET | `diff` of HEAD's extracted sections against the new file found no content changes (only the final blank line at the file boundary) |
| R8 | MET | `bun test plugins/sp/tests/command-flag-parity.test.ts`: 166 pass, 0 fail; 134 command anchor targets preserve `#flag-*` |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: The glossary lives in its own reference | MET | command | Top-level heading scan shows glossary + chain only in `flag-glossary.md`; absent from `dev-operations.md` |
| Scenario: The operation catalog is left whole | MET | command | Heading scan shows all four required sections remain in `dev-operations.md` |
| Scenario: Every command link resolves to the new location | MET | test | `bun test plugins/sp/tests/command-flag-parity.test.ts`: 166 pass, 0 fail |
| Scenario: The move is verbatim | MET | command | Baseline-vs-working-tree section diff had no content delta |
| Scenario: Location pointers are updated | MET | static-ref | `docs/00_ADR.md:937-962`; `plugins/sp/skills/spur-dev/SKILL.md:175-178` |
| Scenario: The repository stays green | MET | command | `bun run autofix && bun run spur-check`, `bun run lint`, `bun run test-cf`, and `bun run build` exited 0; no skipped-test rule violations |

Checks: parity 166/166; recommended Spur rules 42/42; lint/typecheck PASS; full test chain PASS; Cloudflare test 1/1; build PASS.

Coverage: N/A (documentation/reference relocation; no runtime code path added).
### Review
| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | None | No security or data-loss risk; documentation/reference-only relocation. |
| P2 | None | All 134 baseline command anchors resolve through the parity gate. |
| P3 | None | Operation catalog remains cohesive; glossary and chain contract remain together. |
| P4 | None | No advisory cleanup required before commit. |

Residual risk: future manual command links remain guarded by `command-flag-parity.test.ts`.

Disposition: PASS.
### References

H1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-02T00:04:58.088Z todo → wip (system)
- 2026-08-02T00:05:13.747Z wip → testing (system)
- 2026-08-02T00:05:43.221Z testing → done (system)
