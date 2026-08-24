---
schema_version: 1
name: "Config 1.2: ADR superseding ADR-061 and the role-tier SSOT inversion blast radius"
status: done
template: brainstorm
created_at: 2026-08-23T20:51:11.446Z
updated_at: "2026-08-24T18:16:42.426Z"
feature_id: A4
dependencies: ["0639"]
---

## 0642. Config 1.2: ADR superseding ADR-061 and the role-tier SSOT inversion blast radius

### Background
**Wayfinder ticket** (`wayfinder:research`) under map **[A4 Spur config 1.2: global + project
layered configuration](../features/A4_spur-config-1-2-global-project-layered-configuration.md)**.
**Blocked by 0639** — the `agent.roles` merge classification is an input.

ADR-061 (2026-08-16) decided the role→tier SSOT is `DEFAULT_AGENT_ROLES` in
`packages/config/src/index.ts:178`, with a closed-vocabulary `agent.roles` override
(`:221`) merged per-field on top. The operator ruled on 2026-08-23 to **overturn** it: the config
file becomes the SSOT and code keeps a minimal hardcoded fallback.

The reversal is defensible on a premise that did not hold when 061 was written — there was no
machine-wide config file, so "config-owned" meant "per-project duplicated". A4 supplies that file.
ADR-061's other reason still stands and constrains the design: a code default must exist for the
no-config-file case, because the CF-safe core must resolve roles with no filesystem at all.
### Requirements
- [x] R1. Draft the dated ADR superseding ADR-061, recording the operator's 2026-08-23 ruling, the
  premise change that justifies the reversal, and what ADR-061 reasoning survives.
- [x] R2. Inventory the reversal's blast radius with file:line evidence — at minimum
  `DEFAULT_AGENT_ROLES` (`packages/config/src/index.ts:178`), `AgentRoleSpec`/`AgentRoleConfigSchema`
  (`:158`, `:221`), the `agent.roles` key closure in `AgentConfigSchema`'s `superRefine`,
  `resolveAgentRoles` in `apps/cli/src/context.ts`, and the parity gate
  `plugins/sp/tests/roles.test.ts` (R4 tier-floor, R9 projection).
- [x] R3. Define the minimal hardcoded fallback: what it contains, and exactly when it applies versus
  when config is authoritative.
- [x] R4. State how `agent.roles` merges across the two layers, consistent with 0639's classification —
  the vocabulary is closed (four roles) and overrides are per-field.
- [x] R5. State the fate of `plugins/sp/references/roles.md` and its parity gate once config, not code,
  is the SSOT — what the gate compares against, or whether it retires.
- [x] R6. Confirm the role/executor/spec-id selector namespace disjointness guard still holds when the
  role table is config-sourced (`AgentConfigSchema` superRefine rejects executors named after roles).
### Acceptance Criteria
```gherkin
Feature: Role-tier SSOT inversion

  Scenario: The superseding ADR is drafted
    Given ADR-061 states the SSOT is code
    When the new ADR is drafted
    Then it is dated, names ADR-061 as superseded, and records the premise change
    And it states which ADR-061 reasoning still constrains the design

  Scenario: The blast radius is enumerated with evidence
    Given the reversal changes where the role table is read from
    When every consumer is traced
    Then each is listed with file:line and the change it requires

  Scenario: The no-config case is defined
    Given no config file exists on the machine or in the project
    When roles are resolved
    Then the minimal fallback applies and its contents are specified

  Scenario: The parity gate has a stated fate
    Given roles.md is a parity-gated projection of the code constant
    When config becomes the SSOT
    Then the gate either has a new comparison target or a recorded retirement
```
### Q&A
**Open (this ticket answers it, not the operator) — what does the minimal fallback contain?** R3.
The candidate range runs from "all four roles at their current tiers" (byte-identical to today, so
behavior is unchanged when config is silent) to "one role at `standard`". Recommend the former and
justify it in ADR-078: a fallback that differs from the shipped global default turns a missing config
file into a silent behavior change, which is exactly what ADR-061 was written to prevent.

**Open (this ticket answers it) — does the `roles.md` parity gate retarget or retire?** R5. Once
config is the SSOT, `plugins/sp/tests/roles.test.ts:310` (R9) compares the markdown projection
against a constant that is no longer authoritative. Either it retargets to `config/config.global.yaml`
or it retires with a recorded reason. Both are acceptable; leaving it pointed at the fallback is not.

**Deferred to the implementation ticket.** Whether `resolveAgentRoles` (`apps/cli/src/context.ts:52`)
keeps its signature. It currently takes `agentConfig?: AgentConfig` and returns a `Map`; the inversion
changes what it merges, not necessarily what it accepts. R2 records the constraint; the rewrite decides.

**Closed.** ADR-061 is overturned — operator ruling, 2026-08-23, recorded in the A4 map's Decisions
so far. This ticket writes the ADR that records it; it does not re-open the decision.
### Design
**WHAT.** A dated ADR superseding ADR-061, plus the blast-radius inventory the inversion will need.
The ADR and the table are the deliverables; the code change is not in this task.

**WHY.** ADR-061 (`docs/00_ADR.md:698`, 2026-08-16) put the role→tier SSOT in code because the
alternative at the time was per-project duplication — there was no machine-wide config file. A4
supplies one, which retires that reason. ADR-061's *other* reason does not retire and constrains the
design: the CF-safe core must resolve roles with no filesystem at all, so a code default must survive
as a fallback.

**WHERE.** Appends to `docs/00_ADR.md`. Reads `packages/config/src/index.ts` (`AgentRoleSpec:158`,
`DEFAULT_AGENT_ROLES:173`, `AgentRoleOverride:187`, `AgentRoleConfigSchema:221`, and the
`agent.roles` key-closure `superRefine` on `AgentConfigSchema`), `apps/cli/src/context.ts:52`
(`resolveAgentRoles`), and the parity gates in `plugins/sp/tests/roles.test.ts` — `:123` (0537 R4,
`AGENT_ROLE_NAMES` parity), `:193` (R4, tiers agree with the stage registry), `:272` (R7, no tier
literal in plugin prose), `:292` (R8, stage-registry-adapter floors read Layer 1), `:310` (R9,
`roles.md` is a projection of `DEFAULT_AGENT_ROLES`).

**Frozen names.**
- The new ADR is **ADR-078**. `docs/00_ADR.md` currently tops out at ADR-077; take the next number,
  do not renumber anything.
- The role vocabulary stays closed at four: `scribe`, `coder`, `reviewer`, `planner`
  (`AGENT_ROLE_NAMES:152`, task 0536). The inversion changes *where the table is read from*, never
  *how many roles exist*.
- The config key stays `agent.roles`. No new key, no rename.
- `DEFAULT_AGENT_ROLES` keeps its name in its reduced fallback role.

**Precedence after inversion.** `config agent.roles` is authoritative per role, per field. A role
absent from config falls back to `DEFAULT_AGENT_ROLES`; a field absent within a present role falls
back per-field. This is the same per-field merge ADR-061 already specified — what changes is which
side is called the SSOT and which the fallback.

**Anti-patterns — do not.**
- Do not implement the inversion. This ticket produces ADR-078 and the inventory; the code change
  lands after 0640, because a config-owned SSOT is meaningless until the global layer merges.
- Do not delete `DEFAULT_AGENT_ROLES`. ADR-061's surviving constraint requires a code fallback for
  the no-config-file case; R3 specifies its reduced contents, it does not remove it.
- Do not widen the role vocabulary. Re-tier and re-stage only (task 0536).
- Do not silently drop a `roles.test.ts` gate. R5 must state, per gate, whether it retargets or
  retires — a gate that simply stops being mentioned is how drift returns.
- Do not weaken the selector-namespace disjointness guard. `AgentConfigSchema`'s `superRefine`
  rejects an executor named after a role; a config-sourced role table must still feed it (R6).

**Cross-task.** Assumes from 0639: the `agent.roles` row of the merge table — specifically that a
project's per-role override merges per-field over the global layer before either reaches the code
fallback, which makes the resolution three-deep (`code default ← global config ← project config`).
State that chain explicitly in ADR-078. Leaves for the implementation ticket: the `resolveAgentRoles`
rewrite and the parity-gate retarget.
### Plan
- [x] Draft the superseding ADR with the premise change and surviving constraints (R1)
- [x] Trace and tabulate every role-table consumer with file:line (R2)
- [x] Specify the minimal fallback and its activation condition (R3)
- [x] State the two-layer merge for agent.roles against the 0639 table (R4)
- [x] Rule on the roles.md parity gate's fate (R5)
- [x] Confirm the selector-namespace disjointness guard still holds (R6)
### Solution
# Solution — 0642: ADR-078 superseding ADR-061 + role-tier SSOT inversion blast radius

Documents + ADR task (per Design: the ADR and the blast-radius table are the deliverables; no
code change). **ADR-078 is appended to `docs/00_ADR.md`** (dated 2026-08-23, supersedes ADR-061,
records the operator ruling, the premise change — no machine-wide config existed on 2026-08-16, A4
supplies it — and the surviving ADR-061 constraints: no-filesystem fallback requirement, closed
four-role vocabulary, per-field override semantics, `roles.md` stays a non-runtime projection).

## R2 — Blast radius inventory (file:line, verified this session)

| Consumer | Site | Change required |
| --- | --- | --- |
| `AGENT_ROLE_NAMES` (closed vocabulary) | `packages/config/src/index.ts:153` | Unchanged — vocabulary stays closed at four (0536); inversion never changes role count |
| `AgentRoleSpec` (row shape) | `packages/config/src/index.ts:159` | Unchanged — tier + folded stages stays the row shape |
| `DEFAULT_AGENT_ROLES` | `packages/config/src/index.ts:178` | Demote SSOT → minimal hardcoded fallback, **byte-identical** to the shipped global default (all four roles, current tiers/stages) |
| `AgentRoleOverride` | `packages/config/src/index.ts:192` | Unchanged semantics — per-field replace over the base, now config-sourced base |
| `AgentRoleConfigSchema` | `packages/config/src/index.ts:226` | Unchanged — still shapes `agent.roles.<roleId>` values |
| `agent.roles` key-closure `superRefine` | `packages/config/src/index.ts:445–457` (`AgentConfigSchema`) | Unchanged code; now validates the merged object whatever its provenance (0640 single merged validation) |
| Executor/role namespace disjointness guard | same `superRefine` (`:456+`, executor-name loop) | Unchanged — R6 confirmed: rejects executors named after roles at schema load; provenance-independent |
| `resolveAgentRoles` | `apps/cli/src/context.ts:52` | Merges config-sourced base (global file's `agent.roles` table) with project overrides instead of starting from the constant; signature fate deferred to implementation ticket (Q&A) |
| Parity gate R1 (`AGENT_ROLE_NAMES` parity) | `plugins/sp/tests/roles.test.ts:123` | Unchanged — vocabulary constant stays authoritative |
| Parity gate R4 (tier floors) | `plugins/sp/tests/roles.test.ts:193` | Unchanged — floor invariant (tier ≥ highest stage `min_tier`) applies to the merged table |
| Parity gate R7 (no tier literal in plugin prose) | `plugins/sp/tests/roles.test.ts:272` | Unchanged |
| Parity gate R8 (adapter floors read Layer 1) | `plugins/sp/tests/roles.test.ts:292` | Unchanged |
| Parity gate R9 (`roles.md` projection) | `plugins/sp/tests/roles.test.ts:310` | **Retarget, not retire**: three-way parity `roles.md` ≡ `config/config.global.yaml` table ≡ fallback constant. Pointed only at the demoted constant it would stop guarding the real SSOT (Q&A answered) |
| `roles.md` | `plugins/sp/references/roles.md` | Stays an agent/human-facing projection; command→role half stays plugin-owned (ADR-061 wording survives) |

## R3 — Minimal hardcoded fallback (Q&A answer, justified in ADR-078)

Contains **all four roles at their current tiers and stage sets** — byte-identical to today's
`DEFAULT_AGENT_ROLES` values and to the shipped `config.global.yaml` table. Applies **only** when
the merged config supplies no `agent.roles` table at all (no global file, no project file): the
CF-safe core must resolve roles with no filesystem access. Byte-identity is the requirement: a
fallback that differed from the shipped default turns a missing config file into a silent behavior
change — exactly what ADR-061 was written to prevent. When any config layer provides the table,
config is authoritative and the fallback is inert.

## R4 — `agent.roles` layer merge (inherits 0639's classification)

`agent.roles` = object-deep-merge across layers; `<role>.tier` = scalar-replace; `<role>.stages` =
array-replace (whole-set semantics — concat builds hybrid stage lists that misroute). Resolution
order: global base table → project per-field overrides → validated once on the merged object
(0640). The vocabulary stays closed: the superRefine key closure rejects unknown role ids at load,
naming the accepted four.

## R5 — `roles.md` + parity gate fate (Q&A answer)

Retarget, not retire. `plugins/sp/tests/roles.test.ts:310` (R9) becomes a three-way parity gate:
`roles.md` ≡ `config/config.global.yaml` role table ≡ `DEFAULT_AGENT_ROLES` fallback. Retirement
was rejected because `roles.md` remains an agent/human-facing projection whose drift is still
worth catching; the gate's comparison target simply gains the real SSOT. The command→role half of
`roles.md` stays plugin-owned (command frontmatter is its SSOT — ADR-061 wording that survives).

## R6 — Namespace disjointness under config-sourced roles

Holds. The guard lives in `AgentConfigSchema`'s `superRefine` (`packages/config/src/index.ts:458+`
executor loop), which validates the **merged object** (0640: single merged validation,
provenance-labeled). Whether the role table came from the fallback constant, the global file, or
the project file is invisible to the guard: an executor named after a closed-vocabulary role id is
rejected at config load. No new guard is needed; no hole opens because role ids themselves remain
the fixed `AGENT_ROLE_NAMES` four (closure enforced by the adjacent key-closure refine).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/00_ADR.md contains dated ADR-078, explicitly superseding ADR-061 and recording the changed premise and surviving constraints. |
| R2 | MET | The Solution blast-radius table covers the required config, CLI context, role projection, and parity-gate consumers with change dispositions. |
| R3 | MET | The minimal fallback is the byte-identical four-role table and applies only when no config layer supplies agent.roles. |
| R4 | MET | The documented merge is object-deep-merge for agent.roles, scalar replacement for tier, and whole-array replacement for stages. |
| R5 | MET | The ADR and Solution retain roles.md as a projection and retarget R9 to three-way parity. |
| R6 | MET | The namespace-disjointness argument is tied to AgentConfigSchema validation of the merged object. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: The superseding ADR is drafted | MET | command | Fresh ADR audit found ADR-078 with the date, supersession, premise change, and surviving constraints. |
| Scenario: The blast radius is enumerated with evidence | MET | command | Fresh document audit confirmed the consumer/change table and required components. |
| Scenario: The no-config case is defined | MET | command | Fresh document audit found the byte-identical fallback contents and activation condition. |
| Scenario: The parity gate has a stated fate | MET | command | Fresh document audit found the three-way parity decision; the 22-test role gate passes. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECUA review (docs + ADR task):**

- **Security:** no code, no secrets. n/a.
- **Efficiency:** n/a (documents).
- **Correctness:** every blast-radius row carries a file:line verified this session; both ticket Q&As answered with justification recorded in the ADR itself (fallback = byte-identical four-role table; parity gate retargets to three-way). The deferred-to-implementation constraint (resolveAgentRoles signature) is recorded in the R2 row, per the ticket's Q&A. ADR numbering follows the frozen-names rule (078, nothing renumbered). No blocking findings.
- **Usability:** the R2 table is the implementation ticket's checklist. No blocking findings.
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-08-23T22:59:17.855Z todo → wip (system)
- 2026-08-23T23:03:16.887Z wip → done (system)
