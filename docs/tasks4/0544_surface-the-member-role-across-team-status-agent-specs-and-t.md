---
template: feature-impl
schema_version: 1
name: "Surface the member role across team status, agent specs, and the Teams roster"
description: ""
status: todo
type: task
profile: standard
feature_id: M5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0543"]
ac_numbering: task-local
created_at: "2026-08-14T00:19:14.718Z"
updated_at: "2026-08-14T00:21:34.001Z"
---

## 0544. Surface the member role across team status, agent specs, and the Teams roster

### Background
Once a member declares a role (task 0543), the role has to be visible wherever a roster is already
shown — otherwise the operator declares a role and then cannot see whether it took effect.

Three surfaces already render member rosters: `spur team status`, `spur agent list --specs`
(`apps/cli/src/commands/agent.ts`), and the Teams Board roster. All three currently show the
coding-agent kind or the prose `purpose`, neither of which is the routing signal.

This task adds the field to those surfaces. It is deliberately additive — features M3 and J4 own
Teams and Board layout, and this task must not redesign either.
### Requirements
- [ ] **R1.** `spur team status` shows each member's role, and `--json` carries it as a field.
      Measurable: a roster with mixed role-declared and executor-only members renders both correctly
      in human and `--json` output.
- [ ] **R2.** `spur agent list --specs` shows the role recorded on each materialized spec, alongside
      the executor it resolved to. Measurable: the spec listing shows role and executor as distinct
      columns/fields, not a merged string.
- [ ] **R3.** The Teams Board roster shows the role. Additive only — no layout redesign, no new
      interaction; features M3 and J4 own those. Measurable: the roster row includes the role and the
      existing Teams board tests still pass.
- [ ] **R4.** A member with no declared role reads as explicitly unset, never blank and never
      inferred. Inferring a role from the executor's tier would invent information the operator did
      not declare, which is the failure mode the whole role model exists to remove. Measurable: a
      roster mixing declared and undeclared members shows the undeclared one as unset in all three
      surfaces.
### Acceptance Criteria
Covers feature M5 scenario:

- **R6 — Rosters show the role wherever they already show the member**

```gherkin
Scenario: R6 — Rosters show the role wherever they already show the member
  Given a materialized roster
  When spur team status, spur agent list --specs, and the Teams Board roster are read
  Then each shows the member's role
  And a member with no declared role is shown as unset rather than blank or invented
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Additive only.** Three surfaces, one new field each. If adding a column forces a layout decision,
that is a signal to stop and route the question to feature M3 (Teams board UX) rather than to make
the call here.

**Unset is a value (R4).** A member with no role must render as unset — not blank, and above all not
back-derived from the executor's tier. Inferring `capable-3 executor → planner` would manufacture a
declaration the operator never made; the entire point of the role model is that capability is
declared rather than guessed. This mirrors the `tier` lesson recorded in feature B2's terrain notes,
where regex inference over executor names silently misclassified the whole roster.

**`--json` before human output.** The machine field is what other tooling and the Board consume; get
it right first and let the human rendering follow it.

**Not in scope:** Teams Board layout or interaction changes (M3), Board observability surfaces (J4),
and any role-based filtering or grouping — display only.
### Plan
- [ ] Add the role to `spur team status` human output and its `--json` field set (R1)
- [ ] Add role and resolved executor as distinct fields to `spur agent list --specs` (R2)
- [ ] Add the role to the Teams Board roster row without changing layout (R3)
- [ ] Render an undeclared role as explicitly unset in all three surfaces, never inferred (R4)
- [ ] Add tests covering a roster mixing declared and undeclared members across all three surfaces (R1-R4)
- [ ] Confirm existing Teams board tests still pass (R3)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **R1 target:** `spur team status` in `apps/cli/src/commands/` (team noun) and `TeamService`
  (`packages/app/src/services/team-service.ts`)
- **R2 target:** `apps/cli/src/commands/agent.ts` (`agent list --specs`),
  `team-service.ts:450-465` (spec listing shape), `:191-193` (`AgentSpec`)
- **R3 target:** Teams Board roster module in `apps/web/`; existing Teams board tests
- **Upstream dependency:** task 0543 (the `role` field this surfaces)
- **Boundary features (do not redesign):** M3 (Teams board continuous UX fine-tune, verifying),
  J4 (Board observability and Teams supervisor surfaces, done)
- **Inference anti-pattern to avoid (R4):** feature B2 § *Verified terrain (2026-07-26)* — regex
  inference over executor names misclassified the entire roster before tiers were declared
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
