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
dependencies: ["0512"]
ac_numbering: task-local
created_at: "2026-08-11T20:41:23.659Z"
updated_at: "2026-08-11T21:23:30.651Z"
---

## 0513. Fix spur-cli/spur-dev drift exposed by the parity harness

### Background
Phase 1b of feature I2. Evidence-driven corrections for every finding the extended parity harness reports — facade per-noun verb/flag inventories, spine step-routing rows, Tier C exclusion reasons, the AGENTS.md noun table, and any exposed index/link staleness. Implements: R3 — Exposed drift is fixed before the pass is green; R10 — Refinement changes no runtime surface.

Runs after the parity-harness task and is blocked by it: fixes are driven by that harness's output, and the definition of done is the focused parity suite green with no outstanding findings. The spine/facade ownership boundary is asserted, not redesigned (ADR-054) — corrections preserve the facade-owns-CLI-semantics / spine-owns-orchestration split. The change set adds no runtime behavior, public CLI surface, dependency, schema, persistence, or transport — surfaces touched are skill markdown and AGENTS.md only. If a check exposes a stale noun whose only correct fix is a CLI change, that is out of scope; record it and defer.

Ordering: second task — blocked by the harness task; precedes the content pass so the review settles an already-green surface. Rubric: E3 D1 L2 C0 R0 = 6 → task (evidence-driven fixes spanning facade + spine + AGENTS.md doc surfaces, with a review gate distinct from the harness test code).
### Requirements
- [ ] R1. Correct every facade noun/verb/flag inventory reported by 0512 in either parity direction; leave no harness finding unresolved.
- [ ] R2. Correct CLI-routed spine rows that name an absent noun or verb, or mark genuine slash-command/inline routes with an explicit reason.
- [ ] R3. Sync the AGENTS.md public noun table with the live CLI; if it changes, keep `config/templates/AGENTS.md` aligned with the portable contract.
- [ ] R4. Reconcile Tier C exclusion reasons and any index/link drift exposed by the focused harness without duplicating structured catalogs.
- [ ] R5. Keep the change documentation-only: no runtime behavior, public CLI surface, dependency, schema, persistence, or transport. Record and defer any finding whose only valid fix violates this boundary.

Non-goals: speculative cleanup, prose rewriting not named by a harness finding, and CLI changes.
### Acceptance Criteria
```gherkin
Feature: Evidence-driven plugin drift correction

  Scenario: R1 — Exposed drift is fixed before the pass is green
    Given task 0512 reports facade or noun-table drift
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
- **Authority:** 0512 test output is the edit list; no finding means no edit.
- **Portable AGENTS contract:** root and `config/templates/AGENTS.md` move together only when the shared noun-table contract changes.
- **Runtime-only finding:** defer with evidence; do not widen this documentation task.
- **Catalog ownership:** correct the owning surface and link dependents to it rather than copying lists.
### Design
Consume the exact machine/test findings emitted by 0512. Changes are limited to
`plugins/sp/skills/spur-cli/**`, `plugins/sp/skills/spur-dev/**`, `AGENTS.md`, and
`config/templates/AGENTS.md` when a reported contract requires them. Do not preselect files inside
those trees: the harness output is the authoritative allow-list.

For a documented-but-absent item, remove or correct the stale inventory entry. For a
live-but-undocumented item, add it to the facade owner or an explicit Tier C/long-tail exclusion
with a reason. For a spine route, either name the real CLI noun/verb or mark the existing
slash-command/inline route explicitly. Preserve ADR-054 ownership and the source-local provenance
rule. Task 0514 starts only after the focused suite is green.
### Plan
- [ ] Run the 0512 focused parity suite and capture its complete finding set.
- [ ] Correct facade inventories and explicit exclusions named by the findings.
- [ ] Correct or classify reported spine routes.
- [ ] Sync the AGENTS noun table and portable template when required.
- [ ] Record any runtime-only finding as deferred without changing code or public surface.
- [ ] Re-run the focused suite to zero findings, then hand off to 0514.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: I2
- Design: `docs/design/plugin-surface-parity.md` §§3–5, 8
- Decisions: ADR-053, ADR-054
- Dependency: 0512 (parity helper and finding set)
- Dependent task: 0514
### History
