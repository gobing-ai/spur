---
template: feature-impl
schema_version: 1
name: "Parity scope data: explicit exclusions and the ADR-054 ownership boundary"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "harness", "plugins/sp"]
dependencies: ["0512"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.816Z"
updated_at: "2026-08-11T23:00:17.903Z"
---

## 0516. Parity scope data: explicit exclusions and the ADR-054 ownership boundary

### Background
Split from task 0512 (feature I2, decomposition 2026-08-11). Task 0512 creates the source-local capture helper; this task makes the existing facade and spine scope tables mechanically consumable without copying them into a second fixture; 0517 wires the live parity assertions.

Current-tree premises verified during ready refinement: `plugins/sp/skills/spur-cli/SKILL.md` already owns a Tier C table with reasons for `history`, `migrate`, `projects`, and Commander's generated `help`; `plugins/sp/skills/spur-dev/SKILL.md` already owns the Step routing table, whose `CLI gate` cells distinguish backticked `spur <noun> <verb>` routes from prompt/schema/skill dispatch. ADR-054 keeps noun/verb/flag semantics, including status transitions, in the facade and multi-step orchestration in the spine.

Implements feature I2 scenarios R8, R11, and R12. Ordering: after 0512 because it extends that helper; before 0517 because the focused assertions consume these parsers.

Rubric: E3 D1 L1 C0 R0 = 5 → split from the original six-item harness task.
### Requirements
- [ ] R1. Extend `plugins/sp/tests/helpers/cli-surface.ts` to parse Tier C exclusions directly from `plugins/sp/skills/spur-cli/SKILL.md`; every excluded noun, including generated `help`, must retain a non-empty reason. Do not duplicate the table in a TypeScript allow-list.
- [ ] R2. Parse `plugins/sp/skills/spur-dev/SKILL.md` Step routing rows into explicit CLI and non-CLI records: only a backticked `spur <noun> <verb>` gate is a CLI route; prompt, schema, slash-command, inline, and skill dispatch rows are non-CLI records with their table text retained as the reason.
- [ ] R3. Expose the ADR-054 ownership markers from the two skill documents so 0517 can assert facade-owned CLI semantics (including status-transition verbs) and spine-owned orchestration without banning legitimate lifecycle verbs from the facade.

Non-goals: no second exclusion catalog, regex-based silent ignore list, public CLI/runtime change, or assertion of live parity (owned by 0517).
### Acceptance Criteria
```gherkin
Feature: Parity scope data
  Scenario: R1 — Explicit facade exclusions do not create false drift
    Given a noun is explicitly marked as outside the facade reference with a reason
    When the parity harness compares documented coverage
    Then that noun is not reported as missing facade documentation

  Scenario: R2 — Non-CLI spine routes do not create false drift
    Given a spine row targets a slash command or inline model-bearing step
    When CLI route parity is checked
    Then the row is excluded explicitly rather than treated as a missing CLI verb

  Scenario: R3 — Facade and spine ownership remain distinct
    Given the facade and spine state their ADR-054 ownership
    When the boundary assertion runs
    Then ownership inversion fails while facade-owned status-transition verbs remain valid
```
### Q&A
- **Exclusion owner:** the existing Tier C Markdown table remains the only noun-exclusion catalog; tests parse it instead of mirroring it.
- **Route classification:** a Step routing gate is CLI-routed only when its gate cell starts with a backticked `spur <noun> <verb>` command. Every other row is retained as an explicit non-CLI record rather than ignored by regex miss.
- **Boundary check:** 0516 freezes parsers and ownership markers; 0517 owns the live assertions. Status-transition verbs remain facade-owned under ADR-054.
- **Deferred:** arbitrary prose classification and semantic-duplication detection remain outside the mechanical parity gate.
### Design
Extend the single helper created by 0512; add no fixture module or new test file. Freeze these exports:

- `parseTierCExclusions(markdown): Array<{ noun: string; reason: string }>` reads only the `### Tier C exclusion reasons` table and fails on an empty reason or duplicate noun.
- `parseSpineRoutes(markdown): Array<{ step: string; kind: 'cli' | 'non-cli'; noun?: string; verb?: string; reason: string }>` reads only `## Step routing`; a backticked `spur <noun> <verb>` gate yields `kind: 'cli'`, while every other gate yields `kind: 'non-cli'` with the original gate text as `reason`.
- `parseOwnershipMarkers(facadeMarkdown, spineMarkdown)` returns the two documented ownership claims and fails if either ADR-054 phrase is absent or inverted.

Use section-heading boundaries plus Markdown table cells, not global regex suppression. Update `plugins/sp/skills/spur-cli/SKILL.md` or `plugins/sp/skills/spur-dev/SKILL.md` only if the current table/ownership wording cannot satisfy the parsers; the Markdown remains authoritative. 0517 imports these functions and compares only `kind: 'cli'` rows with live help. Do not touch `routing-table-parity.test.ts`, which owns the unrelated next-router Markdown/adapter contract.
### Plan
- [ ] Add the Tier C, Step routing, and ownership parsers to the 0512 helper (R1–R3).
- [ ] Normalize only the two owning skill tables/phrases if parsing proves them ambiguous; never create a copied exclusion list.
- [ ] Run a direct helper smoke import against both skill files and assert: four reasoned Tier C nouns; at least one CLI and one non-CLI route; facade/spine ownership markers present.
- [ ] Run `bun test plugins/sp/tests/skill-structure.test.ts plugins/sp/tests/routing-table-parity.test.ts` to preserve existing structure/routing contracts, then hand the parser API to 0517.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: I2, scenarios R8, R11, R12
- Design: `docs/design/plugin-surface-parity.md` §§4–5, 7–8
- Decision: ADR-054
- Dependency: 0512 (`plugins/sp/tests/helpers/cli-surface.ts`)
- Authoritative data: `plugins/sp/skills/spur-cli/SKILL.md` Tier C table; `plugins/sp/skills/spur-dev/SKILL.md` Step routing
- Dependent task: 0517
### History
