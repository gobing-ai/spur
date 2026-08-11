---
template: feature-impl
schema_version: 1
name: "Fix spur-cli/spur-dev drift exposed by the parity harness"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "drift-fix", "plugins/sp"]
dependencies: ["0517"]
ac_numbering: task-local
created_at: "2026-08-11T20:41:23.659Z"
updated_at: "2026-08-11T23:02:26.320Z"
---

## 0513. Fix spur-cli/spur-dev drift exposed by the parity harness

### Background
Phase 1b of feature I2. This task consumes the complete sorted finding set emitted by 0517 and makes only the evidence-driven documentation corrections required to return the focused parity suite to green. It implements feature scenarios R2, R3, R4, R10, and R11.

Current dependency chain is 0512 (capture) → 0516 (scope parsing) → 0517 (live assertions) → 0513 (correction). The authoritative edit list is therefore 0517's failing assertion output, not 0512. Expected targets are the owning facade references, spine routing table, Tier C reasons, and root AGENTS noun table; task 0514 separately owns README/link/catalog discoverability.

The ADR-054 boundary is preserved: the facade owns CLI noun/verb/flag semantics, including status transitions; the spine owns multi-step orchestration. If a finding can only be resolved by changing runtime or the public CLI surface, record it as deferred evidence and leave the focused suite non-green rather than widening this task silently.

Rubric: E3 D1 L2 C0 R0 = 6 → task; corrections span multiple documentation owners but remain finding-bounded.
### Requirements
- [ ] R1. Correct every facade noun/verb/flag inventory named by 0517's `documented-not-on-CLI` or `on-CLI-not-documented` findings; leave no documentation-fixable finding unresolved.
- [ ] R2. Correct every reported CLI-classified spine route or reclassify it as non-CLI with an explicit reason in the authoritative Step routing table; never add a silent test exclusion.
- [ ] R3. Sync `AGENTS.md` § Spur CLI surface with source-local root help; update `config/templates/AGENTS.md` only if the changed contract is present in that portable template.
- [ ] R4. Reconcile every reported Tier C reason in the facade owner without creating another noun/verb/flag catalog. README/link/catalog discovery findings remain owned by 0514.
- [ ] R5. Keep corrections documentation-only: no runtime behavior, public CLI command/flag, dependency, schema, persistence, or transport change. Record any runtime-only finding with exact evidence and defer it.

Non-goals: speculative prose cleanup, README/link crawling, CLI changes, or edits not named by the 0517 finding set.
### Acceptance Criteria
```gherkin
Feature: Evidence-driven plugin drift correction

  Scenario: R1 — Exposed drift is fixed before the pass is green
    Given the parity harness reports facade or noun-table drift
    When each reported documentation surface is corrected
    Then the focused parity suite passes with no outstanding finding

  Scenario: R2 — CLI-routed spine rows reference real verbs
    Given a reported spine row names an absent CLI noun or verb
    When the row is corrected or explicitly classified as non-CLI
    Then the routing parity check passes without silent exclusion

  Scenario: R3 — AGENTS.md noun inventory matches the CLI
    Given root help exposes the public noun set
    When AGENTS.md and its portable template are checked
    Then the documented noun table matches the live set and the portable contract remains aligned

  Scenario: R4 — Explicit facade exclusions do not create false drift
    Given an excluded noun is intentionally outside facade coverage
    When its Tier C entry is reconciled
    Then the entry carries a current reason and produces no false finding

  Scenario: R5 — Refinement changes no runtime surface
    Given a finding would require a runtime or public CLI change
    When task 0513 is implemented
    Then the finding is recorded and deferred rather than changing that surface
```
### Q&A
- **Authority:** 0517's sorted test failure arrays are the edit list; a surface absent from those findings is out of scope.
- **Portable AGENTS contract:** root and `config/templates/AGENTS.md` move together only when both contain the affected noun-table contract.
- **Runtime-only finding:** preserve the failing evidence and defer; do not change the CLI to make a documentation task green.
- **Catalog ownership:** edit the facade/spine/AGENTS owner and link dependents; do not copy inventories.
- **Handoff:** 0514 starts only after the full focused parity suite has zero outstanding findings.
### Design
Start by running `bun test plugins/sp/tests/cli-surface-parity.test.ts` from the repository root and capture its complete sorted findings. Treat those arrays as the allow-list for edits.

Allowed owners, only when named by a finding:

- `plugins/sp/skills/spur-cli/SKILL.md` for noun routing, Tier C exclusions, and facade ownership wording.
- `plugins/sp/skills/spur-cli/references/*.md` for per-noun verb/flag maps.
- `plugins/sp/skills/spur-dev/SKILL.md` for CLI/non-CLI Step routing and spine ownership wording.
- `AGENTS.md`, plus `config/templates/AGENTS.md` only when the affected portable contract exists there.
- `docs/design/plugin-surface-parity.md` only if the correction changes the documented parity shape rather than inventory data.

For documented-only entries, correct/remove the stale owner row. For live-only entries, add the real verb/flag to its facade owner or a reasoned Tier C row when the noun is intentionally outside coverage. For a spine finding, either name the real CLI noun/verb or make the non-CLI reason explicit in the same Step routing row. Re-run the focused test after each owner group; finish with all parity tests green. Do not touch `apps/cli`, package manifests, schemas, persistence, transport, README, or unrelated prose.
### Plan
- [ ] Run 0517's focused test and preserve all sorted bidirectional findings (R1–R4).
- [ ] Correct only the named facade verb/flag and Tier C owner rows; rerun the focused test (R1/R4).
- [ ] Correct or explicitly classify only named spine Step routing rows; rerun the focused test (R2).
- [ ] Sync the root noun table, and the portable template only if it owns the same changed contract (R3).
- [ ] Record any runtime-only finding as deferred and confirm the implementation diff excludes runtime/public surfaces (R5).
- [ ] Run `bun test plugins/sp/tests/cli-surface-parity.test.ts plugins/sp/tests/command-flag-parity.test.ts plugins/sp/tests/flag-contract-parity.test.ts plugins/sp/tests/routing-table-parity.test.ts plugins/sp/tests/skill-structure.test.ts`; hand off the zero-finding surface to 0514.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: I2, scenarios R2–R4, R10, R11
- Design: `docs/design/plugin-surface-parity.md` §§3–5, 8
- Decisions: ADR-053, ADR-054
- Dependency: 0517 (complete live parity finding set; transitively 0512/0516)
- Owning surfaces: `plugins/sp/skills/spur-cli/**`; `plugins/sp/skills/spur-dev/SKILL.md`; `AGENTS.md`
- Dependent task: 0514
### History
