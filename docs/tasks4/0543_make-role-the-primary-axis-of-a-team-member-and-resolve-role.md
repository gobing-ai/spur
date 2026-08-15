---
template: feature-impl
schema_version: 1
name: "Make role the primary axis of a team member and resolve role-only members"
description: ""
status: done
type: task
profile: standard
feature_id: M5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0538"]
ac_numbering: task-local
created_at: "2026-08-14T00:19:14.490Z"
updated_at: "2026-08-15T06:55:03.128Z"
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
- [x] **R1.** A member declaring `role` and no `executor` resolves to a concrete executor through the
      existing tier ladder — cheapest executor whose tier meets the role's tier from
      `plugins/sp/references/roles.md`. The materialized spec records **both** the role and the
      resolved executor name, so the resolution is inspectable rather than implicit. Measurable: a
      member declaring `role: reviewer` alone materializes a spec naming the role and a `capable-1`+
      executor.
- [x] **R2.** A member declaring both `role` and `executor` uses the pinned executor without tier
      resolution, and the spec records the role alongside it. Pin beats policy, consistent with
      `--agent` (feature B2 task 0536 R2). Measurable: a member pinning
      `omp-dsv4-flash-opencode` under `role: coder` materializes with that exact executor.
- [x] **R3.** `purpose` is demoted to human annotation. It is still accepted and carried through, but
      it is not the identity, not the routing signal, and not what a roster display reads. Local id
      derivation stays `member.id ?? executor` (0251) with a role-only member falling back to the
      role plus a disambiguating index when two members share it. Measurable: a member with a purpose
      and a role resolves identically to the same member without the purpose.
- [x] **R4.** A member declaring neither `role` nor `executor` fails config load, naming the team id
      and the member position, and stating that at least one is required. The bare-string shorthand
      (`- claude`) keeps meaning `{ executor: "claude" }` per `normalizeMember`
      (`packages/config/src/index.ts:268-269`). Measurable: the empty-member case fails with both
      identifiers in the message.
- [x] **R5.** A role outside the four in `plugins/sp/references/roles.md` fails config load, naming
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
- [x] Add `role` to the object arm of `TeamMemberConfigSchema` and to `NormalizedTeamMember` (R1, R3)
- [x] Add a `superRefine` requiring at least one of role or executor, naming team id and position (R4)
- [x] Validate `role` against the shared vocabulary source, not a local copy (R5)
- [x] Resolve a role-only member through the existing tier eligibility sort rather than a new selector (R1)
- [x] Record both role and resolved executor on the materialized spec (R1, R2)
- [x] Keep a pinned executor authoritative when both fields are present (R2)
- [x] Define and document local-id derivation when a role-only member repeats a role (R3)
- [x] Update `docs/04_DESIGN.md` and `config/config.example.yaml` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
**Change map (0543 — role is the primary axis of a team member):**

- `packages/config/src/index.ts:197-213` — `TeamMemberConfigSchema` object arm: `executor` now **optional**
  (was required); `role` keeps the `z.enum(AGENT_ROLE_NAMES)` vocabulary with a custom error naming
  the offending value **and** the accepted set (R5 — zod's default enum error omits the value).
  `NormalizedTeamMember.executor` → optional (`packages/config/src/index.ts:219-233`). New exported
  `memberLocalId(member, roster, index)` (`packages/config/src/index.ts:281-303`): `id ?? executor`,
  and for a role-only member `<role>-<n>` — n = 1-based declaration-order index among role-only
  members sharing the role (frozen; a shifting id would break inbox addressing, R3).
  `AgentConfigSchema` superRefine team walk (`packages/config/src/index.ts:449-454`): precomputed
  normalized roster; **R4** — a member declaring neither role nor executor fails load naming the
  team id, the member index, and the at-least-one rule; local-id derivation delegates to
  `memberLocalId` (config-load ids now match materialization ids exactly).
- `packages/app/src/services/agent-service.ts:2073-2085` — extracted the role → tier → cheapest-eligible
  funnel from `resolveRole` into exported `cheapestEligibleExecutors(executors, minTier)`; `resolveRole`
  now calls it (`packages/app/src/services/agent-service.ts:1606`). **One selector, never two** (R1 Design — the exact defect
  feature B2 exists to remove).
- `packages/app/src/services/team-service.ts:37-71` — `TeamServiceContext.roles` (Layer-1 role → tier
  map, same one AgentService receives). `materializeTeam` (`packages/app/src/services/team-service.ts:683-735`): local id via
  `memberLocalId`; **R1** — a role-only member resolves through `cheapestEligibleExecutors` (cheapest
  executor eligible for the role's tier) and the spec records **both** the role (`config.role`) and
  the resolved executor (`executor`, 0537 R1 binding); **R2** — a pinned executor branch runs first,
  pin beats policy; defensive throw for neither-role-nor-executor; loud error when `roles` is absent
  (server path) or no executor is configured for the role's tier. `resolveAutostartSet` local ids via
  `memberLocalId` (`packages/app/src/services/team-service.ts:1002`).
- `apps/cli/src/commands/team.ts:359` — `makeTeamServiceWithLedger` threads `roles: context.agentRoles`
  (the CLI-boundary roles.md parse, 0536 R1) so `spur team up` resolves role-only members.
- `apps/cli/schemas/spur-config.schema.json:160-180` — member object mirror: `executor` no longer
  required; description records the role-or-executor rule.
- Tests: `packages/config/tests/team-config.test.ts` (R4/R5/memberLocalId; role-only accepted at
  schema level, rejected at config level when neither field); `packages/app/tests/services/team-service.test.ts`
  (R1 ladder resolution + both recorded, R2 pin beats policy, R3 purpose-annotation invariance,
  role-only ids `-1`/`-2`, no-roles loud failure); `packages/app/tests/services/team-service-0258.test.ts`
  (autostart ids for role-only members).
- Docs (T3): `docs/04_DESIGN.md` (role as primary axis, resolved-executor recording, local-id rule),
  `config/config.example.yaml` (role-only member example).

**Key decisions.** Executor pin branch runs first — R2 "pin beats policy" mirrors `--agent` 0536 R2.
Role validation reads the parity-asserted `AGENT_ROLE_NAMES` (roles.test.ts asserts it equals the
`roles.md` ids), so member validation and the `--agent` role branch share one vocabulary (R5).
Bare-string shorthand unchanged (`normalizeMember`). `purpose` stays carried, never identity (R3).
### Testing
**Re-verify 2026-08-14** (`/sp-dev-verifyall --feature M5 --force --fix all`). Prior Testing cited a stale pin-branch range (the loop + `memberLocalId` comment rather than the pin at `packages/app/src/services/team-service.ts:713-715`). Line anchors re-read this run.

**Targeted tests this run (19 pass / 0 fail):** `bun test packages/config/tests/team-config.test.ts packages/app/tests/services/team-service.test.ts packages/app/tests/services/team-service-0258.test.ts --test-name-pattern "0543|role-only|neither role nor executor|unknown role|memberLocalId|purpose is annotation|pinned executor|role-only member"`

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Shared funnel `packages/app/src/services/agent-service.ts:2073-2080` (`cheapestEligibleExecutors`); `resolveRole` calls it at `:1606`. Role-only branch `packages/app/src/services/team-service.ts:716-739`; spec records `executor` + `config.role` at `:753` and `:762`. Test `packages/app/tests/services/team-service.test.ts` "0543 R1: a role-only member resolves through the tier ladder" (this run). |
| R2 | MET | Pin branch runs first `packages/app/src/services/team-service.ts:713-715` before the role-only else. Test "0543 R2: a pinned executor beats role tier resolution" (this run). |
| R3 | MET | `memberLocalId` `packages/config/src/index.ts:281-296` (`id ?? executor ?? <role>-<n>`); purpose never read. Tests: config `memberLocalId` block + team-service "0543 R3: purpose is annotation" + autostart ids `packages/app/tests/services/team-service-0258.test.ts` (this run). |
| R4 | MET | `AgentConfigSchema` superRefine `packages/config/src/index.ts:446-451` names team id, member index, and the at-least-one rule. Test "a member declaring neither role nor executor fails" (this run). |
| R5 | MET | Enum error `packages/config/src/index.ts:207-211` names offending value + accepted set (`AGENT_ROLE_NAMES` `:151`). Tests at schema and config level (this run). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — A member declared by role alone resolves an executor | MET | test | `packages/app/tests/services/team-service.test.ts` "0543 R1: a role-only member resolves through the tier ladder" (this run) |
| Scenario: R2 — A member may still pin an executor, with the role recorded | MET | test | `packages/app/tests/services/team-service.test.ts` "0543 R2: a pinned executor beats role tier resolution" (this run) |
| Scenario: R3 — purpose is annotation, not identity | MET | test | `packages/app/tests/services/team-service.test.ts` "0543 R3: purpose is annotation" + `packages/config/tests/team-config.test.ts` memberLocalId purpose-invariance (this run) |
| Scenario: R4 — A member declaring neither role nor executor is rejected | MET | test | `packages/config/tests/team-config.test.ts` "a member declaring neither role nor executor fails" (this run) |
| Scenario: R5 — An unknown role is rejected at config load | MET | test | `packages/config/tests/team-config.test.ts` "rejects an unknown role" + AgentConfigSchema unknown-role load test (this run) |

**Design conformance:** 5/5 claims DONE (union+superRefine; shared `cheapestEligibleExecutors`; record role+resolved executor; one `AGENT_ROLE_NAMES` vocabulary; `<role>-<n>` local id). No silent deviation.

**Coverage:** N/A (config validation + materialization; no new runtime path that the per-file coverage gate owns).

**Fix-pass artifacts:** `.spur/run/0543-verdict.json` and `.spur/run/0543-verify-answer.txt` written this run (were missing; feature check L4.scenario-unverified).
### Review
**Three-dimensional review (0543) — verdict PASS.** Re-verified 2026-08-14 under `/sp-dev-verifyall --feature M5 --force --fix all`. Added the required P1–P4 table (L3.review-priority-table was failing `--strict-core`).

**Functional traceability:**
- R1 MET — `cheapestEligibleExecutors` shared funnel (`packages/app/src/services/agent-service.ts:2073-2080`); `resolveRole` (`:1606`) and `materializeTeam` (`:731`) both call it — one selector, never two. Role-only branch `:716-739`; spec records role + resolved executor (`:753`, `:762`).
- R2 MET — pin branch runs first (`packages/app/src/services/team-service.ts:713-715`); test asserts a pin below the role tier still wins.
- R3 MET — `memberLocalId` (`packages/config/src/index.ts:281-296`): `id ?? executor ?? <role>-<n>`; purpose never enters derivation.
- R4 MET — `AgentConfigSchema` superRefine (`packages/config/src/index.ts:446-451`) rejects neither-role-nor-executor naming team id, member index, and the rule.
- R5 MET — enum error (`packages/config/src/index.ts:207-211`) names the offending value AND the accepted set; vocabulary is `AGENT_ROLE_NAMES`.

**SECUA:**
- Security: no new untrusted input; error messages interpolate config values only.
- Efficiency: materialization is config-time; `memberLocalId` is O(n) on single-digit rosters.
- Correctness: no-executor-for-tier, missing-role-table, and neither-field all throw loud.
- Usability: R4/R5 errors name the team, the position, the offending value, and the accepted set.
- Architecture: one shared funnel; `memberLocalId` in the CF-safe config core keeps load-time and materialization-time derivation identical.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Architecture | `packages/app/src/services/team-service.ts:72-78` | Server/Board `teamService()` has no `roles` map — a role-only member materialized via the Board throws a loud error instead of resolving. `spur team up` (CLI) is the supported surface. Accepted residual. |
| P3 | Correctness | `packages/config/src/index.ts:281-296` | Role-only ids follow declaration order — reordering the roster reassigns `<role>-<n>`. Frozen rule for determinism; rostered configs are static. Accepted residual. |
| P4 | — | — | No P1–P2 findings; verify verdict PASS |

**Disposition:** PASS — all requirements MET with re-read evidence this run; no blockers.
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
- 2026-08-15T06:33:42.796Z todo → wip (system)
- 2026-08-15T06:36:58.984Z wip → testing (system)
- 2026-08-15T06:37:31.631Z testing → done (system)
