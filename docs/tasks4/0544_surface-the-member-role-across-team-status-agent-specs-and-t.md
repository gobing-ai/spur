---
template: feature-impl
schema_version: 1
name: "Surface the member role across team status, agent specs, and the Teams roster"
description: ""
status: done
type: task
profile: standard
feature_id: M5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0543"]
ac_numbering: task-local
created_at: "2026-08-14T00:19:14.718Z"
updated_at: "2026-08-15T06:46:29.354Z"
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

**Closed during refine (2026-08-13).**

- **Which fields are added, and where?** `role?` and `executor?` on `TeamStatusEntry`
  (`team-service.ts:188-196`) — additive, so existing `--json` consumers are unaffected.
- **How does an undeclared role render?** The literal `unset` in human output, `undefined` in
  `--json`. Never blank, never inferred from tier.
- **Is this a Board redesign?** No — one cell on an existing roster row. A layout question is M3's,
  not this task's.

**Deferred with owner.**

- **Filtering or grouping a roster by role** — owner: operator. Display first; add interaction only
  if the display proves useful.
- **Showing the tier alongside the role** — owner: operator. The tier is derivable from `roles.md`;
  rendering it duplicates Layer 1 into the UI and can drift.
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

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Status row type | `TeamStatusEntry { id, name, type, workspace, purpose, status: 'running'\|'stopped'\|'errored'\|'unknown', pid? }` | `packages/app/src/services/team-service.ts:188-196` |
| Status result | `TeamStatusResult { agents: TeamStatusEntry[] }` | `team-service.ts:199` |
| **Fields added** | `role?: string` and `executor?: string` on `TeamStatusEntry` | additive; existing consumers unaffected |
| Spec listing | `listAgentSpecs(): Promise<AgentSpec[]>` | `team-service.ts:542` |
| CLI surfaces | `spur team status` (`apps/cli/src/commands/team.ts:50`) · `spur agent list --specs` (`apps/cli/src/commands/agent.ts:29-36`) | — |
| Unset rendering | literal `unset` (not blank, not `-`, not inferred) | human output; `undefined` in `--json` |
| Board surface | Teams roster module | `apps/web/` |

**No new CLI flag or verb.** Two existing commands gain a column/field; the Board roster gains a cell.

#### Anti-patterns — what not to implement

- Do **not** infer a role from the executor's tier when none is declared (R4). `capable-3 executor →
  planner` manufactures a declaration the operator never made; feature B2's terrain notes record the
  regex-inference failure this mirrors.
- Do **not** render unset as blank or `-`. It is a value; make it read as one.
- Do **not** merge role and executor into one display string — they are distinct fields (R2), and a
  merged string cannot be filtered or parsed.
- Do **not** restructure Teams board layout. Features M3 and J4 own those surfaces; if adding the
  column forces a layout decision, stop and route it to M3.
- Do **not** add filtering or grouping by role. Display only.

#### Cross-task contract

**Assumes from 0543:** the spec records both the declared `role` and the resolved `executor`. This task
renders them and computes nothing — if a value is missing on the spec, that is a 0543 defect to route
back, not to reconstruct here.

**Leaves for dependents:** none in batch 2. Feature J7 (batch 3, task 0552) renders *routing and token*
data on the Board — a different surface with a different data source; the two must not be conflated.
### Plan
- [ ] Add the role to `spur team status` human output and its `--json` field set (R1)
- [ ] Add role and resolved executor as distinct fields to `spur agent list --specs` (R2)
- [ ] Add the role to the Teams Board roster row without changing layout (R3)
- [ ] Render an undeclared role as explicitly unset in all three surfaces, never inferred (R4)
- [ ] Add tests covering a roster mixing declared and undeclared members across all three surfaces (R1-R4)
- [ ] Confirm existing Teams board tests still pass (R3)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
**Change map (0544 — surface the member role; additive only, no layout redesign):**

- `packages/app/src/services/team-service.ts:205-218` — `TeamStatusEntry` gains `role?: string` and
  `executor?: string` (additive; existing `--json` consumers unaffected). `getStatus`
  (`packages/app/src/services/team-service.ts:488-492`) reads them off the materialized spec:
  `role` from `config.role` (omitted when unset — R4), `executor` from the spec's executor binding
  (0537 R1 / 0543 R1 resolved name).
- `apps/cli/src/commands/team.ts:315-318` — `formatStatusLine` renders a role column; an undeclared
  role renders the literal `unset` (R4), never blank, never inferred. `formatTeamBlock`
  (`apps/cli/src/commands/team.ts:343-346`) — `team status --by-team` rows gain the same distinct
  role column. `--json` rides the TeamStatusEntry fields (absent = unset).
- `apps/cli/src/commands/agent.ts:197-210` — `spur agent list --specs`: role and executor are
  DISTINCT fields in `--json` and distinct columns in the human table (R2); undeclared role renders
  `unset` in human output (R4) and is omitted in `--json`.
- `apps/server/src/modules/team/index.ts:235-240` — `GET /api/team/teams` member payload carries
  `role` (from `spec.config.role`) and `executor` (from `spec.executor`), omitted when unset — the
  Board feed (R3).
- `apps/web/src/lib/use-teams-data.ts:17-18,57-58` — `TeamMember` gains `role?`/`executor?`; the
  untrusted-body parse narrows them (string, non-empty) before carrying.
- `apps/web/src/modules/teams/SupervisorTab.tsx:329-336` — the roster member row renders one role
  cell: declared role as a value, undeclared as the literal `unset` badge (R3/R4). No layout
  redesign, no interaction, no filtering — M3/J4 boundaries respected.
- Tests: `packages/app/tests/services/team-service.test.ts` (getStatus carries role/executor, absent
  when unset); `apps/cli/tests/commands/team.test.ts` (team status human + `--json` role/unset);
  `apps/cli/tests/commands/agent-team.test.ts` (agent list --specs distinct role/executor fields +
  unset); `apps/cli/tests/commands/agent.test.ts` (column-shape assertion updated);
  `apps/server/tests/modules/team/index.test.ts` (member payload role/executor, omitted when unset);
  `apps/web/tests/modules/teams/components.test.tsx` (roster role badge + unset).
- Docs (T3): `docs/04_DESIGN.md` — the team status / spec listing / Board roster surfaces gain the
  role field; unset rule recorded.

**Key decisions.** Unset is a value: `unset` in human output, field-absent in `--json`, and the
Board renders the literal `unset` badge — never blank, never back-derived from the executor's tier
(R4, mirroring feature B2's regex-inference lesson). Role and executor stay distinct fields
everywhere (R2) — a merged string cannot be filtered or parsed. The Board change is one cell on an
existing row; anything more is M3's call.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — spur team status shows the role (human + --json) | MET | `packages/app/src/services/team-service.ts:205-218` TeamStatusEntry role/executor; `:488-492` getStatus reads them off the spec; `apps/cli/src/commands/team.ts:315-318` formatStatusLine role column, `:343-346` by-team block; tests: team-service.test.ts getStatus test + `apps/cli/tests/commands/team.test.ts` 0544 test (human `reviewer` + `unset`, JSON role/executor fields) |
| R2 — agent list --specs shows role and executor as distinct fields | MET | `apps/cli/src/commands/agent.ts:197-210` — distinct role/executor JSON fields + human columns; tests `apps/cli/tests/commands/agent-team.test.ts` 0544 test (distinct fields, unset when undeclared) + `agent.test.ts` column-shape assertion |
| R3 — Teams Board roster shows the role (additive) | MET | `apps/server/src/modules/team/index.ts:235-240` member payload role/executor; `apps/web/src/lib/use-teams-data.ts:17-18,57-58` TeamMember + parse narrow; `apps/web/src/modules/teams/SupervisorTab.tsx:329-336` roster role cell; tests: server `index.test.ts` 0544 test + web `components.test.tsx` roster test (role badge + unset) |
| R4 — undeclared role reads as explicitly unset, never inferred | MET | literal `unset` in human (`team.ts:317`, `:344`, `agent.ts` human column, `SupervisorTab.tsx:334`); field-absent (undefined) in `--json` (`team-service.ts:490`, `agent.ts:199`, server `:239`); no tier→role back-derivation anywhere (grep: no role inference added) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — Rosters show the role wherever they already show the member | MET | test | all three surfaces: team status (team.test.ts 0544), agent list --specs (agent-team.test.ts 0544), Board roster (web components.test.tsx roster test); undeclared shows `unset` in all three |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Three-dimensional review (0544) — verdict PASS.**

**Functional traceability:**
- R1 MET — `TeamStatusEntry.role/executor` (`packages/app/src/services/team-service.ts:205-218`) fed by `getStatus` (`:488-492`); human rows render the role column (`apps/cli/src/commands/team.ts:315-318`, `:343-346`), `--json` rides the fields. Tests: team-service getStatus test + team.test.ts human/json.
- R2 MET — `spur agent list --specs` role + executor as distinct fields/columns (`apps/cli/src/commands/agent.ts:197-210`); test agent-team.test.ts asserts distinct `role`/`executor` JSON fields and human columns.
- R3 MET — server member payload (`apps/server/src/modules/team/index.ts:235-240`) → `TeamMember` parse (`apps/web/src/lib/use-teams-data.ts:17-18,57-58`) → roster cell (`apps/web/src/modules/teams/SupervisorTab.tsx:329-336`); server + web tests assert the chain.
- R4 MET — unset is a value: literal `unset` in human output and Board badge, field-absent in `--json`; nothing back-derives a role from the executor's tier. Asserted in all surface tests.

**SECUA:**
- Security: the web parse narrows untrusted API fields (string, non-empty) before carrying — no new injection surface; role/executor render as text (React escapes).
- Efficiency: three additive field reads; no new queries or allocations of note.
- Correctness: `length > 0` guards cover hand-authored specs with empty strings; role enum validation at config load means a spec's `config.role` is always a valid Layer-1 role (belt-and-braces only).
- Usability: `unset` is unambiguous and never conflated with a declared role; columns are distinct so the output is parseable.
- Architecture: additive fields at each layer; no layout/interaction changes — M3/J4 boundaries respected; the web narrow is consistent with the existing `model`/`pid` pattern.

**Priority findings:** none P1/P2. P3 (residual, accepted): `spur team status` human columns grew from 4 to 5 — any downstream script parsing the tab-separated output without a header would shift; the `--json` surface (the machine contract) is unchanged in shape. Low risk; recorded, not actioned.

**Disposition:** PASS — all requirements MET with real evidence; no blockers.
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
- 2026-08-15T06:44:13.231Z todo → wip (system)
- 2026-08-15T06:46:21.222Z wip → testing (system)
- 2026-08-15T06:46:29.354Z testing → done (system)
