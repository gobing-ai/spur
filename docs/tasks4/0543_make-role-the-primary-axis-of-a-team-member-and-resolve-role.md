---
template: feature-impl
schema_version: 1
name: "Make role the primary axis of a team member and resolve role-only members"
description: ""
status: todo
type: task
profile: standard
feature_id: M5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0538"]
ac_numbering: task-local
created_at: "2026-08-14T00:19:14.490Z"
updated_at: "2026-08-14T01:38:46.340Z"
---

## 0543. Make role the primary axis of a team member and resolve role-only members

### Background
A team member is `{ executor, purpose?, id? }` today
(`packages/config/src/index.ts:177-198`, `NormalizedTeamMember` at `:219-222`), where `purpose` is
free prose — this repo's own config says `purpose: "Lead — planning & review"`. Prose cannot be
routed on, validated, or displayed consistently, so the only machine-readable thing about a member is
which executor it pins.

Feature B2 task 0538 adds an optional `role` field so a materialized spec can carry it. That is
plumbing; this task makes the role the **primary axis**: a member may declare a role and let the
roster resolve an executor through the tier ladder, which is what turns a roster from a list of
executor names into a team with jobs.

The resolution machinery already exists — `resolveExecutor`
(`packages/config/src/index.ts:262-282`) and the tier eligibility sort used by
`agent-service`. This task points a role-only member at it instead of requiring an executor name.
### Requirements
- [ ] **R1.** A member declaring `role` and no `executor` resolves to a concrete executor through the
      existing tier ladder — cheapest executor whose tier meets the role's tier from
      `plugins/sp/references/roles.md`. The materialized spec records **both** the role and the
      resolved executor name, so the resolution is inspectable rather than implicit. Measurable: a
      member declaring `role: reviewer` alone materializes a spec naming the role and a `capable-1`+
      executor.
- [ ] **R2.** A member declaring both `role` and `executor` uses the pinned executor without tier
      resolution, and the spec records the role alongside it. Pin beats policy, consistent with
      `--agent` (feature B2 task 0536 R2). Measurable: a member pinning
      `omp-dsv4-flash-opencode` under `role: coder` materializes with that exact executor.
- [ ] **R3.** `purpose` is demoted to human annotation. It is still accepted and carried through, but
      it is not the identity, not the routing signal, and not what a roster display reads. Local id
      derivation stays `member.id ?? executor` (0251) with a role-only member falling back to the
      role plus a disambiguating index when two members share it. Measurable: a member with a purpose
      and a role resolves identically to the same member without the purpose.
- [ ] **R4.** A member declaring neither `role` nor `executor` fails config load, naming the team id
      and the member position, and stating that at least one is required. The bare-string shorthand
      (`- claude`) keeps meaning `{ executor: "claude" }` per `normalizeMember`
      (`packages/config/src/index.ts:236-237`). Measurable: the empty-member case fails with both
      identifiers in the message.
- [ ] **R5.** A role outside the four in `plugins/sp/references/roles.md` fails config load, naming
      the offending value and the accepted set. This is the same validation the `--agent` role branch
      applies, so the two must not drift — read the vocabulary from one place. Measurable: an unknown
      role fails at load; a valid one loads; both assertions run against the shared vocabulary source.
### Acceptance Criteria
Covers feature M5 scenarios:

- **R1 — A member declared by role alone resolves an executor**
- **R2 — A member may still pin an executor, with the role recorded**
- **R3 — purpose is annotation, not identity**
- **R4 — A member declaring neither role nor executor is rejected**
- **R5 — An unknown role is rejected at config load**

```gherkin
Scenario: R1 — A member declared by role alone resolves an executor
  Given a team member declares role reviewer and no executor
  When the roster is materialized
  Then an executor eligible for that role's tier is selected through the existing ladder
  And the materialized spec records both the role and the resolved executor name

Scenario: R2 — A member may still pin an executor, with the role recorded
  Given a team member declares both role coder and executor omp-dsv4-flash-opencode
  When the roster is materialized
  Then the pinned executor is used without tier resolution
  And the spec records the role alongside it

Scenario: R3 — purpose is annotation, not identity
  Given a member declares a purpose string and a role
  When the member is normalized
  Then the role is the field routing and display read
  And purpose is carried through as human annotation without affecting resolution

Scenario: R4 — A member declaring neither role nor executor is rejected
  Given a member with neither field
  When config is loaded
  Then loading fails naming the team id and the member position
  And the message states that at least one of role or executor is required

Scenario: R5 — An unknown role is rejected at config load
  Given a member declares a role outside the four in the sp role reference
  When config is loaded
  Then loading fails naming the offending value and the accepted set
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Does `role` get added here?** No — task 0538 (batch 1) adds the optional field. This task makes it
  the primary axis and relaxes `executor` from required to optional.
- **What is a role-only member's local id?** `member.id ?? member.executor ?? <role>`, disambiguated
  as `<role>-<n>` by declaration order when a role repeats. Frozen above, because a shifting id breaks
  inbox addressing.
- **Does the bare-string shorthand still mean `executor`?** Yes. `- claude` stays
  `{ executor: "claude" }`; it is not reinterpreted as a role. Roles and executor names are disjoint
  by the 0537 collision guard, so there is no ambiguity to resolve.

**Deferred with owner.**

- **Auto-composing a roster from a workload** ("give me a team for feature X") — owner: operator,
  feature M5 § Deferred to batch 3. Wait until role-declared rosters have been used in anger.
- **Role-aware supervision policy** (restart a failing `reviewer` differently from a `coder`) —
  owner: operator; unexamined.
### Design
**Extend the union, do not fork it.** `TeamMemberConfigSchema`
(`packages/config/src/index.ts:182-197`) is already a union of a bare string and an object. Add
`role` to the object arm and a `superRefine` requiring at least one of role/executor (R4). The bare
string keeps meaning `{ executor }` — it is shorthand used in the wild and there is no reason to
break it.

**Reuse the eligibility sort (R1).** Do not write a second selector. The role → tier → cheapest
eligible path is the same one `--agent <role>` uses after feature B2 task 0536; call it, do not
reimplement it. If the shape it exposes is awkward to call from the config/team layer, fix the shape
rather than duplicating the logic — two selectors that can disagree is exactly the class of defect
feature B2 exists to remove.

**Record the resolution, do not hide it (R1).** A role-only member is resolved at materialization
time, and the spec must show what it resolved to. A roster that says "reviewer" but not which
executor is serving it recreates, at the Teams layer, the exact opacity task 0537 fixed at the drain
layer.

**One vocabulary source (R5).** Both this validation and `--agent`'s role branch must read
`plugins/sp/references/roles.md`. Two hardcoded copies of a four-value list is how the tier prose
drifted in the first place.

**Local id when a role repeats (R3).** Two `coder` members need distinct ids. Keep
`member.id ?? executor`; when a role-only member has no executor at declaration time, derive from the
role plus an index, and document the rule — an id that shifts when the roster is reordered would
break inbox addressing.

**Not in scope:** addressing a member by role (multiplicity — feature M5 § Notes), and any Teams
Board layout work (task 0544 only adds the field to what is already rendered).

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Member schema (object arm) | `TeamMemberConfigSchema` — `executor` (currently **required**), `id?`, `purpose?`, `workspace?`, `model?`, `autonomy?`, `systemPrompt?`, `command?`, `autostart?` | `packages/config/src/index.ts:182-196` |
| Field added by 0538 | `role?: string` | same schema |
| **This task's change** | `executor` becomes optional; `superRefine` requires **at least one** of `role` / `executor` | `packages/config/src/index.ts:182-196`, guard in `AgentConfigSchema.superRefine` `:317-345` |
| Normalized form | `NormalizedTeamMember` — same field set | `packages/config/src/index.ts:219-230` |
| Shorthand (must keep working) | bare string `- claude` → `{ executor: "claude" }` | `normalizeMember`, `:236-237` |
| Local id rule (extend) | `member.id ?? member.executor` | `packages/app/src/services/team-service.ts:666` |
| Role vocabulary source | `roles[].id` / `roles[].tier` | `plugins/sp/references/roles.md` |
| Tier eligibility (reuse) | `isTierEligible(candidate, min)` | `packages/domain/src/stage-registry/schema.ts:425-427` |
| Spec write site | member → `AgentSpecInput { id, name?, type, workspace?, purpose?, tags?, config?, autoStart? }` | `team-service.ts:666-680`, `:237-246` |

**Local-id rule when `executor` is absent:** `member.id ?? member.executor ?? <role>` , and when two
role-only members share a role, `<role>-<n>` by declaration order. Freeze the ordering rule — an id
that shifts when the roster is reordered breaks inbox addressing.

#### Anti-patterns — what not to implement

- Do **not** write a second selector. Role → tier → cheapest eligible is the funnel task 0536 built;
  call it. Two selectors that can disagree is exactly what feature B2 closed.
- Do **not** drop the bare-string shorthand — `normalizeMember` is its contract and it is in use.
- Do **not** delete `purpose`. It stays as human annotation (R3); only its *role* as the routing
  signal is removed.
- Do **not** derive a member's role from its executor's tier. That invents a declaration the operator
  never made — the same inference failure that misclassified the whole roster before tiers were
  declared (feature B2 § Verified terrain).
- Do **not** make `role` required. At least one of role/executor is the rule (R4).

#### Cross-task contract

**Assumes from 0538 (batch 1):** `role?` already exists on `TeamMemberConfigSchema` and
`NormalizedTeamMember`, and is carried onto the materialized spec. This task promotes it to the
primary axis and relaxes `executor`; it does not add the field.

**Assumes from 0537 (batch 1):** materialization already carries the resolved `executor` name onto the
spec, so a role-only member's resolution is recordable (R1).

**Leaves for dependents:** task **0544** renders the role on three surfaces and assumes this task
records both the declared role and the resolved executor on the spec. It renders; it does not resolve.
### Plan
- [ ] Add `role` to the object arm of `TeamMemberConfigSchema` and to `NormalizedTeamMember` (R1, R3)
- [ ] Add a `superRefine` requiring at least one of role or executor, naming team id and position (R4)
- [ ] Validate `role` against the shared vocabulary source, not a local copy (R5)
- [ ] Resolve a role-only member through the existing tier eligibility sort rather than a new selector (R1)
- [ ] Record both role and resolved executor on the materialized spec (R1, R2)
- [ ] Keep a pinned executor authoritative when both fields are present (R2)
- [ ] Define and document local-id derivation when a role-only member repeats a role (R3)
- [ ] Update `docs/04_DESIGN.md` and `config/config.example.yaml` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **R1/R2 targets:** `packages/config/src/index.ts:177-198` (`TeamMemberConfigSchema`,
  `NormalizedTeamMember`), `:236-237` (`normalizeMember`), `:262-282` (`resolveExecutor`),
  `packages/app/src/services/team-service.ts:666-680` (member → spec materialization)
- **Eligibility sort to reuse:** `packages/domain/src/stage-registry/schema.ts:425-427`
  (`isTierEligible`); the role branch added by feature B2 task 0536
- **R3 target:** `packages/app/src/services/team-service.ts:666` (`member.id ?? member.executor`, 0251)
- **R5 vocabulary source:** `plugins/sp/references/roles.md` (feature B2 task 0535)
- **Upstream dependency:** feature B2 task 0538 (adds the optional `role` field this task promotes)
- **Live roster under migration:** `.spur/config.yaml` `agent.team.demo.members[]` (three members,
  all with prose `purpose`)
- **Prior decisions:** task 0250 (team config model), task 0251 (member identity unification),
  feature M5 § Notes (why role is not an address)
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`, `config/config.example.yaml`
### History
