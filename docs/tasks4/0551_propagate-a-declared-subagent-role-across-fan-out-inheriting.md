---
template: feature-impl
schema_version: 1
name: "Propagate a declared subagent role across fan-out, inheriting when absent"
description: ""
status: todo
type: task
profile: standard
feature_id: I4
parent_wbs: null
priority: P2
tags: []
dependencies: ["0536"]
ac_numbering: task-local
created_at: "2026-08-14T00:48:41.204Z"
updated_at: "2026-08-14T01:38:49.818Z"
---

## 0551. Propagate a declared subagent role across fan-out, inheriting when absent

### Background
Feature B2's fog names this as unexplored: *"`sp:parallel-execution` dispatches several subagents at
once. Whether each carries its own intention, or inherits the parent's, is unexplored."*

Once `--agent <role>` ships (batch 1, task 0536) and role attribution is recorded (batch 2, task
0545), leaving this unanswered has a concrete cost. A `planner`-role agent fanning out four
implementation subagents either routes all four through the `capable-2` tier — paying planning rates
for coder work, the exact waste tiers exist to prevent — or attributes their consumption to the wrong
role, corrupting the very data feature J6 exists to produce.

The rule is settled by feature I4 § Notes: **a dispatched subagent declares its own role; absent a
declaration it inherits the dispatcher's.** This task wires it.
### Requirements
- [ ] **R1.** A subagent dispatched during fan-out that declares its own role resolves through that
      role's tier, not the dispatching agent's. Measurable: a `planner`-role dispatcher fanning out
      subagents declaring `coder` produces four `coder`-tier resolutions, and none at `capable-2`.
- [ ] **R2.** A dispatched subagent declaring no role inherits the dispatching agent's, and the
      inheritance is **recorded** rather than merely implied. Measurable: the subagent's effective
      role equals the dispatcher's, and the record distinguishes it from a declared one.
- [ ] **R3.** The effective role and its origin (declared or inherited) are visible per dispatched
      subagent, so a wrong inheritance is observable without reading the dispatcher's source.
      Measurable: inspecting a mixed fan-out shows each subagent's effective role and origin.
- [ ] **R4.** The rule applies to every fan-out path that shells out to `spur agent run`, not only to
      `sp:parallel-execution`'s documented surface. Measurable: an inventory of dispatch paths is
      recorded, and each either applies the rule or is documented as out of scope with a reason.
### Acceptance Criteria
Covers feature I4 scenarios:

- **R1 — A dispatched subagent declaring a role uses its own**
- **R2 — A subagent declaring no role inherits the dispatcher's**
- **R3 — The effective role is visible per subagent**

```gherkin
Scenario: R1 — A dispatched subagent declaring a role uses its own
  Given a planner-role agent fans out subagents for implementation work
  When each subagent declares role coder
  Then each resolves through the coder tier
  And none inherits the dispatching agent's planner tier

Scenario: R2 — A subagent declaring no role inherits the dispatcher's
  Given a dispatching agent with a known role
  When it dispatches a subagent that declares none
  Then the subagent resolves through the dispatcher's role
  And the inheritance is recorded rather than implied

Scenario: R3 — The effective role is visible per subagent
  Given a fan-out of several subagents with mixed declarations
  When the dispatch is inspected
  Then each subagent's effective role and whether it was declared or inherited is visible
  And a wrong inheritance is observable without reading the dispatcher's source
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Declared or inherited by default?** Declared wins; absent inherits. Recorded in feature I4 §
  Notes with the reasoning — the alternative runs implementation work at planning rates.
- **Why not fail when undeclared?** Consistent with task 0536 R3's treatment of an unmapped role: a
  missing declaration is a plausible authoring omission, and refusing to run is disproportionate.
  Visibility (R3) is the safeguard.
- **Does nested fan-out need special handling?** No — the rule applies recursively by construction.
- **Is a new flag needed?** No; the role travels on `--agent`.

**Deferred with owner.**

- **Tightening to warn-on-inherit or hard-require** — owner: operator, and only after R3's visibility
  shows whether inheritance masks real mistakes. Reversible by design.
- **Whether `roleOrigin` appears in J6's attribution payload** — owner: task 0545. This task exposes
  it; the payload decision is J6's.
### Design
**Declared wins; absent inherits.** The rule is already decided (feature I4 § Notes) — implement it,
do not relitigate it. The rationale is recorded there: the alternative fails in the expensive
direction, running implementation work at planning rates.

**Inherit rather than refuse (R2).** Consistent with feature B2 task 0536's treatment of an unmapped
role: a missing declaration is a plausible authoring omission, and refusing to run is
disproportionate. What makes inheritance safe is that it is *recorded and visible* (R3), not silent.

**Record the origin, not just the value (R2/R3).** "This subagent ran as `coder`" and "this subagent
ran as `coder` because nobody said otherwise" are different facts. Feature J6's attribution will
aggregate over these, and an inherited role that should have been declared is exactly the kind of
mistake the aggregate should be able to surface.

**Inventory the dispatch paths (R4).** `sp:parallel-execution`'s
`references/dispatch-surface.md` is the documented surface, but any path that shells out to
`spur agent run` propagates or drops the role. Enumerate them and apply the rule or record why not —
a path that silently drops the role reintroduces the defect this task closes.

**Nested fan-out needs no special handling.** If a dispatched subagent itself fans out, the same rule
applies recursively by construction. Do not add depth tracking until a case demands it.

**Not in scope:** the role vocabulary and `--agent` (feature B2), recording or aggregating
attribution (feature J6), and how fan-out chooses concurrency.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Rule | declared role wins; absent inherits the dispatcher's | feature I4 § Notes |
| Role vocabulary | `scribe` · `coder` · `reviewer` · `planner` | `plugins/sp/references/roles.md` |
| Selector it passes through | `--agent <role>` | task 0536 |
| Origin marker | `roleOrigin: 'declared' \| 'inherited'` | new, recorded per dispatched subagent |
| Documented dispatch surface | `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` | § *Composition with ADR-033* |
| Precedent for inherit-not-refuse | unmapped role warns and defaults | task 0536 R3 |

**No new CLI flag.** The role travels on the existing `--agent`.

#### Anti-patterns — what not to implement

- Do **not** make a subagent inherit when it declared its own role — declared always wins (R1).
- Do **not** refuse to run when no role is declared. Inheritance is the chosen default; visibility
  (R3) is what keeps it safe.
- Do **not** record only the effective role. Origin (`declared` vs `inherited`) is a separate fact, and
  feature J6's aggregate is what would surface a wrong inheritance.
- Do **not** add depth tracking for nested fan-out. The rule applies recursively by construction.
- Do **not** leave a dispatch path silently dropping the role (R4) — that reintroduces the defect.

#### Cross-task contract

**Assumes from 0536 (batch 1):** `--agent <role>` accepts the four ids, so a propagated role resolves.

**Leaves for dependents:** feature J6 task **0545** records whatever role a dispatch resolved. This
task makes that value *correct* for fanned-out subagents; it does not record it. If `roleOrigin` is to
appear in attribution, that is 0545's payload decision, and this task must expose it.
### Plan
- [ ] Inventory every fan-out path that shells out to `spur agent run` (R4)
- [ ] Apply declared-wins-over-inherited on each, or record why a path is out of scope (R1, R4)
- [ ] Pass a declared subagent role through to `--agent` so it resolves at its own tier (R1)
- [ ] Inherit the dispatcher's role when a subagent declares none (R2)
- [ ] Record the origin — declared or inherited — alongside the effective role (R2, R3)
- [ ] Make effective role and origin visible per dispatched subagent (R3)
- [ ] Add tests: declared overrides, absent inherits, mixed fan-out visibility, per-path coverage (R1-R4)
- [ ] Update `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` and `docs/04_DESIGN.md` (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Documented dispatch surface (R4):**
  `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:40-80` (§ *Composition with
  ADR-033*, § *The sandbox reliability tax on `spur agent run`*)
- **Role selector this propagates:** feature B2 task 0536 (`--agent <role>`); vocabulary in
  `plugins/sp/references/roles.md` (task 0535)
- **Precedent for inherit-and-warn over refuse:** feature B2 task 0536 R3 (unmapped role warns and
  defaults rather than failing)
- **Consumer of the value this corrects:** feature J6 task 0545 (records role attribution)
- **Open question this closes:** feature B2 § *Not yet specified* — "Parallel fan-out … whether each
  carries its own intention, or inherits the parent's, is unexplored"
- **Surface docs (T3, same commit):**
  `plugins/sp/skills/parallel-execution/references/dispatch-surface.md`, `docs/04_DESIGN.md`
### History
