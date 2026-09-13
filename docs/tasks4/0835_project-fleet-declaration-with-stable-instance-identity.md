---
schema_version: 1
name: Project fleet declaration with stable instance identity
status: done
template: feature-impl
created_at: 2026-09-12T04:53:38.720Z
updated_at: "2026-09-13T07:27:52.897Z"
feature_id: G62
priority: P1
tags:
  - g6-program

---

## 0835. Project fleet declaration with stable instance identity

### Background

The fleet today is `agent.team.<id>`: members declared by role/executor, materialized into generated
specs `<teamId>-<localId>` by `TeamService.materializeTeam`
(`packages/app/src/services/team-service.ts:687`). A project has no fleet of its own — Workspace shows
only teams flagged `isCurrentProject` (`apps/web/src/modules/workspace/WorkspaceShell.tsx:16-19`), so a
registered project without a team opens empty.

Two constraints from the G6 inventory bound this work. A spec id **is** the mailbox identity and the
occupant address; renaming one orphans inbox and coordination rows
(`docs/reports/g6-runtime-inventory.md` §4). And the `<role>-<n>` suffix is derived from frozen roster
order, so reordering members silently reallocates identities.

**Premise check — what already exists and must be reused.**

- `memberLocalId(member, roster, index)` at `packages/config/src/index.ts:452-480` is the single
  frozen-index allocator: an explicit `member.id` wins outright; otherwise duplicate executors
  disambiguate by position and role-only members derive `<role>-<n>` over their role-only peers. R3 is
  satisfied by **calling this function**, not by reimplementing the rule.
- `NormalizedTeamMember` (`packages/config/src/index.ts:417-433`) already carries
  `executor?, id?, role?, purpose?, workspace?, model?, autonomy?, systemPrompt?, command?, autostart?`.
  `AgentSpecInput` (`packages/app/src/services/team-service.ts:269-278`) carries the projection side.
  The declaration does not need new member fields — it needs a new *home* and an `enabled` flag.
- Agent specs already live **project-locally** in `.spur/agents/` (`team-service.ts:288`). A
  project-local fleet declaration belongs beside them, not in the global registry.
- `ProjectRegistry` (`packages/app/src/services/project-registry.ts:147`) owns
  `~/.config/spur/projects.json` with `ProjectEntry { name, path, port }` and an advisory `withLock`.
  Project identity is the **normalized path** (`normalizeProjectPath`, `:11`) — reuse it; do not add a
  project id.
- **Capability evidence already exists.** Task 0706 shipped closed capability axes
  `['fsRead','fsWrite','networkEgress','processSpawn','externalMutationApproval']` with states
  `['enforced','available','unavailable','unknown']` and provenance
  `['native-known','operator-configured','unattested']`
  (`packages/config/src/index.ts:209-265`), plus `RequiresCapabilities` on `agent.run` (`:280-288`).
  R4 is satisfied by reading the `fsWrite` axis — **no new capability vocabulary**.
- `spur projects` exists with `add`, `remove`, `list`, `start`, `stop`
  (`apps/cli/src/commands/projects.ts:13-188`). Any new verb needs operator consent
  (`docs/design/harness-surface-governance.md`).

### Requirements

- **R1** — One project-local declaration of desired fleet members: instance id, role, executor,
  `enabled` flag. This is the authoring surface; converting `agent.team.<id>` is G64's work (0847).
- **R2** — Generated specs in `.spur/agents/` remain a projection of that declaration, never a second
  editable roster. Hand-authored specs are preserved untouched.
- **R3** — Instance ids survive executor replacement and roster reorder, by delegating derivation to
  the existing `memberLocalId` allocator rather than re-deriving it.
- **R4** — Write capability is read from the executor's `fsWrite` capability attestation, never from
  the role name. Missing data resolves to `unknown`, which grants nothing.
- **R5** — Declared desired state stays separate from observed liveness: the declaration never carries
  process state, and liveness is read from the occupant/supervisor surfaces that already own it.
- **R6** — Registration and launch validate the actual cwd and storage root against the project's
  normalized path; `SPUR_*` environment strings are context, not proof.
- **R7** — A project with no declaration resolves cleanly to an empty fleet and says so.

### Acceptance Criteria

```gherkin
Feature: Project fleet declaration with stable instance identity

  @core
  Scenario: R1 — A project declares its fleet and one orchestrator
    Given a project with a declared fleet and a bound orchestrator member
    When the runtime resolves the project
    Then each member has a stable instance id, role, executor, and capabilities
    And exactly one member is the project's orchestrator

  @core
  Scenario: Identity survives executor replacement and reorder
    Given an existing member addressed by inbox and coordination rows
    When its executor is replaced and the roster is reordered
    Then its instance id is unchanged and no row is orphaned

  @core
  Scenario: Read-only is proven, not assumed
    Given a member whose role is reviewer but which declares write capability
    When a read-only assignment is considered
    Then the member is not treated as read-only on the strength of its role name

  @core
  Scenario: Launch validates its own ground truth
    Given a member launched with a project context in its environment
    When it registers
    Then the actual cwd and storage root are validated against the project rather than trusted from the environment
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:14:57.433Z

- **Declaration home — CLOSED: `<projectPath>/.spur/fleet.json`.** Specs already live in
  `.spur/agents/`, project identity is already the worktree path, and a per-worktree file makes G64's
  conversion a file transform with a trivial rollback. A new `agent.fleet.<path>` config block would
  key worktree-scoped data by a global map.
- **Capability vocabulary — CLOSED: reuse 0706's `fsWrite` axis.** Closed axes, states, and provenance
  already ship in `packages/config/src/index.ts:209-265`. A second `capabilities: ['write']` list on the
  member would be a parallel truth with no attestation behind it.
- **Id derivation — CLOSED: call `memberLocalId`.** It is the same allocator config-load uses, so a
  converted roster produces byte-identical ids and existing mailboxes survive (R3, and G64 0847's whole
  premise).
- **`enabled` vs deleting the member — CLOSED: keep `enabled`.** Deleting a member frees its
  `<role>-<n>` index and silently reallocates ids for later members. `enabled: false` preserves the
  index.
- **Deferred (owner: 0847).** Converting `agent.team.<id>` blocks into `fleet.json`. This task only
  defines the target format and reads it.
- **Deferred (owner: 0836).** The `orchestrator` field on this file.

### Design

**WHAT.** A project-local `.spur/fleet.json` holding desired members, and a resolver that projects it
through the existing materialization path.

**WHY a new file rather than a new config block.** `agent.team.<id>` is keyed by team id inside the
merged global config; a project fleet is keyed by worktree and must travel with the worktree. Specs
already live in the worktree's `.spur/agents/`, so the declaration belongs at `.spur/fleet.json`.
That also makes G64's conversion (0847) a file-to-file transform with an obvious rollback.

**WHERE.**

| Layer | Change |
| --- | --- |
| `packages/config/src/index.ts` | `FleetDeclarationSchema`, `FleetMemberSchema` beside the team schemas |
| `packages/app/src/services/fleet-service.ts` (new) | load / resolve / materialize |
| `packages/app/src/services/team-service.ts:687` | `materializeTeam` gains a fleet-sourced sibling; the roster loop is shared |
| `apps/cli/src/commands/projects.ts` | `spur projects list --fleet` (flag, not a new verb) |

**Frozen names.**

```ts
// packages/config/src/index.ts
interface FleetMember {
    id?: string;                 // explicit stable id; wins in memberLocalId
    role?: AgentRoleName;        // closed set — scribe | coder | reviewer | planner
    executor?: string;
    purpose?: string;
    enabled?: boolean;           // default true
}
interface FleetDeclaration {
    version: 1;
    members: FleetMember[];      // may be empty (R7)
}
```

- File: `<projectPath>/.spur/fleet.json`, schema `FleetDeclarationSchema` (`version: z.literal(1)`).
- `FleetService` in `packages/app/src/services/fleet-service.ts`:
  - `load(projectPath): Promise<FleetDeclaration | null>` — `null` means no declaration (R7).
  - `resolve(projectPath): Promise<ResolvedFleet>`.
  - `materialize(projectPath, opts?: { check?: boolean }): Promise<MaterializeResult>`.
- `ResolvedFleetMember { instanceId, role?, executor, enabled, writeCapable: boolean, capabilityState: ExecutionCapabilityState }`
- `ResolvedFleet { projectPath, members: ResolvedFleetMember[], missing: string[] }` —
  `missing` names what a caller must fix (`'no-declaration'`, `'no-enabled-members'`), so R7 is a value,
  not an exception.

**Instance id (R3).** `instanceId = memberLocalId(member, members, index)`, prefixed exactly as today:
`` `${projectSlug}-${localId}` `` where `projectSlug` is the existing team id for a converted project
and the registry entry `name` for a new one. **Import the allocator from `@gobing-ai/spur-config`; do
not re-derive.** A member that declares `id` keeps it verbatim through executor replacement and
reorder — which is how existing mailbox identities survive (R3).

**Write capability (R4).** `writeCapable` is true iff the resolved executor's `fsWrite` attestation is
`'enforced'` or `'available'`. `'unavailable'`, `'unknown'`, and an absent axis all yield false —
missing data never grants. The role name is never consulted. This reuses the 0706 vocabulary as-is.

**Ground-truth validation (R6).** `FleetService` compares `process.cwd()` and the resolved storage root
(`.spur/` parent) against `normalizeProjectPath(projectPath)` from `project-registry.ts:11`. A mismatch
is a loud error naming both paths. `SPUR_SPEC_ID` / `SPUR_TEAM_ID` / `SPUR_RUN_ID`
(`supervisor-service.ts:207-220`) are read as context only.

**Desired vs observed (R5).** `ResolvedFleet` carries no process state. Liveness comes from the
occupant records (`CoordinationRunDao`) and `SupervisorService`; a caller joins them. Keeping the two
apart is what lets a member be declared-enabled but observed-blocked without a contradictory field.

**Anti-patterns — do not implement.**

- Do not add a role value (`orchestrator` or otherwise) — the vocabulary is closed at
  `packages/config/src/index.ts:153` and widening it needs operator consent.
- Do not invent a capability vocabulary; `fsWrite` already exists (0706).
- Do not reimplement `<role>-<n>` derivation — call `memberLocalId`.
- Do not write process/liveness fields into `fleet.json`.
- Do not touch or rewrite hand-authored specs (those without the `spur:generated` tag) — the existing
  skip at `team-service.ts:718` is the contract.
- Do not add a `spur fleet` noun; `spur projects list --fleet` reads it under an existing verb.
- Do not trust `SPUR_*` env values as proof of project ownership.

**Handoff.** 0836 adds the `orchestrator` binding field to this same file; 0837 reads `writeCapable`
to decide who may take the write slot; 0838 selects among enabled members; 0847 (G64) converts
`agent.team.<id>` into this file.

### Plan

1. Add `FleetMemberSchema` / `FleetDeclarationSchema` and their inferred types to
   `packages/config/src/index.ts`, beside `TeamConfigSchema`. (R1)
2. Add `packages/app/src/services/fleet-service.ts` with `load`, `resolve`, `materialize`, delegating
   id derivation to `memberLocalId` and executor resolution to the existing tier ladder. (R1, R2, R3)
3. Compute `writeCapable` / `capabilityState` from the resolved executor's `fsWrite` attestation;
   default every unknown to non-writing. (R4)
4. Validate `process.cwd()` and the storage root against `normalizeProjectPath` at load and at
   materialize; fail loudly naming both paths. (R6)
5. Return `missing: ['no-declaration']` / `['no-enabled-members']` instead of throwing for an empty or
   absent declaration. (R7)
6. Tests in `packages/app/tests/services/fleet-service.test.ts`: id stability across executor
   replacement and roster reorder; a reviewer-role member with `fsWrite: available` is write-capable
   and a coder with `unknown` is not; hand-authored specs untouched; cwd mismatch errors; empty
   declaration resolves with `missing`. (R2, R3, R4, R6, R7)
7. Add `--fleet` to `spur projects list` and update the projects reference under
   `plugins/sp/skills/spur-cli/references/`. (R1)
8. `cd packages/app && bun test tests/services/fleet-service.test.ts`, then `bun run spur-check`.

### Solution

## Change map

| Requirement | Implementation |
| --- | --- |
| R1 declaration schema | `packages/config/src/index.ts:509` `FleetMemberSchema`, `packages/config/src/index.ts:535` `FleetDeclarationSchema` (version 1, members with optional id/role/executor/purpose/enabled, `enabled` default true; superRefine requires role-or-executor per member). `.spur/fleet.json` is the sole authoring surface. |
| R3 stable instance ids | ids are `<projectSlug>-<memberLocalId>` over the FULL roster (disabled included), allocator shared with teams: `packages/app/src/services/team-service.ts:392` (`materializeRoster` → `memberLocalId` at `:406`) and `packages/app/src/services/fleet-service.ts:8` — frozen-index, stable across roster reorder and executor replacement. |
| R4 write capability | `packages/app/src/services/fleet-service.ts:170-184`: `writeCapable` reads the resolved executor's `fsWrite` axis (`enforced`/`available` grant); missing executor data is `unknown` and never grants; role is never consulted. |
| Shared roster loop | `packages/app/src/services/team-service.ts:318` `resolveMemberExecutor` (pinned-executor-or-tier-ladder funnel) and `:398` `materializeRoster` are module-level exports; `materializeTeam` (`:924`) and `FleetService.materialize` both route through them — one projection loop, no second convention. |
| Load/resolve/materialize | `packages/app/src/services/fleet-service.ts:83` `FleetService`; `load` (`:101`, null when absent, loud on malformed JSON/schema violation), `resolve` (`:134`, pure desired state R5 — no liveness fields), `materialize` (`:203`, projection into `.spur/agents/`, `--check` diff mode, prunes only `team:<slug>` + `spur:generated` tagged specs not desired — hand-authored specs are never touched, R2). |
| Launch ground truth (R6) | `packages/app/src/services/fleet-service.ts:316` `assertLaunchGroundTruth` — cwd and `normalizeProjectPath` of the resolved project root must both match the declaration's project path; loud error names both paths; SPUR_* env is not accepted as proof. Scoped to `materialize` (the launch boundary); `load`/`resolve` normalize paths only so the CLI can list foreign projects. |
| CLI surface | `apps/cli/src/commands/projects.ts:100` `spur projects list --fleet` (existing verb, no new noun): per-project config re-layering, per-project error isolation (`fleet: unavailable (<reason>)` for a broken declaration), text and JSON output (`fleet` / `fleetError` fields). Public help rows: `docs/help/cmd_projects.md:55` and skill reference `plugins/sp/skills/spur-cli/references/projects.md:22,39`. |
| Slug choice | Project slug = registry entry `name` when the project is registered, else path basename; feeds both instance ids and the `team:<slug>` prune tag. |

## Notes

- `FleetServiceContext` takes an injected `fs: FileSystem` port (no-direct-fs-io boundary rule) and optional `registry` so tests avoid touching the machine registry.
- Missing declaration / all-disabled resolve cleanly (`missing: ['no-declaration']` / `['no-enabled-members']`) rather than erroring — R7.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/services/fleet-service.test.ts:147` — declaration resolves stable member identity and capability state; `bun run spur-check` (exit 0). |
| R2 | MET | `packages/app/tests/services/fleet-service.test.ts:352` — hand-authored specs survive projection; generated specs are pruned separately; `bun run spur-check` (exit 0). |
| R3 | MET | `packages/app/tests/services/fleet-service.test.ts:183` — explicit member identity survives executor replacement and reorder through the shared allocator; `bun run spur-check` (exit 0). |
| R4 | MET | `packages/app/tests/services/fleet-service.test.ts:234` — capability comes from executor attestation, never role; `bun run spur-check` (exit 0). |
| R5 | MET | `packages/app/tests/services/fleet-service.test.ts:147` — resolved fleet contains desired member state; liveness is a separate claim projection; `bun run spur-check` (exit 0). |
| R6 | PARTIAL | `packages/app/tests/services/fleet-service.test.ts:337` — materialization rejects cwd/storage mismatches; `bun run spur-check` (exit 0). Actual managed registration/launch does not route through this materialization guard; `packages/app/src/services/fleet-service.ts:440` and `apps/cli/src/commands/agent.ts:1006`. |
| R7 | MET | `packages/app/tests/services/fleet-service.test.ts:262` — absent declaration resolves an empty fleet with a named missing condition; `bun run spur-check` (exit 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — A project declares its fleet and one orchestrator | MET | test | `packages/app/tests/services/fleet-service.test.ts:147` — declaration resolves stable member identity and capability state; `bun run spur-check` (exit 0). `packages/app/tests/services/fleet-service.test.ts:702` — declared orchestrator resolves through the binding service; `bun run spur-check` (exit 0). |
| Identity survives executor replacement and reorder | MET | test | `packages/app/tests/services/fleet-service.test.ts:183` — explicit member identity survives executor replacement and reorder through the shared allocator; `bun run spur-check` (exit 0). |
| Read-only is proven, not assumed | MET | test | `packages/app/tests/services/fleet-service.test.ts:234` — capability comes from executor attestation, never role; `bun run spur-check` (exit 0). |
| Launch validates its own ground truth | PARTIAL | test | `packages/app/tests/services/fleet-service.test.ts:337` — materialization rejects cwd/storage mismatches; `bun run spur-check` (exit 0). Actual managed registration/launch does not route through this materialization guard; `packages/app/src/services/fleet-service.ts:440` and `apps/cli/src/commands/agent.ts:1006`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review fixes applied (post-review pass, bounded to the review findings)

| Finding | Fix | Evidence |
| --- | --- | --- |
| P2 prune-namespace collision | Fleet specs are now written with tags `fleet:<slug>`, `spur:generated`, `fleet:generated` (never `team:<slug>` — the group tag was the collision vector, required so the mandated collision test can hold), and `FleetService.materialize` prunes ONLY specs carrying BOTH `spur:generated` + `fleet:generated` that are not desired. `packages/app/src/services/fleet-service.ts:253-267`. TeamService prune untouched. | Collision test: registry name `shared` == `agent.team.shared`; both materializations run over one spec dir; re-running either side reports `orphaned: []` and both specs survive (`fleet-service.test.ts` namespace-disjoint test). |
| P3 ENOENT masking | `load` rethrows when the readFile error code is not `ENOENT` — EACCES/EISDIR are environment failures, not absence. `packages/app/src/services/fleet-service.ts:105-114`. | EACCES test: stubbed `fs.readFile` rejects with `code: 'EACCES'`; `load` rejects with /EACCES/ instead of returning null. |
| P3 disabled-member executor resolution | Guard in the shared `materializeRoster` loop: `enabled === false` members keep their frozen-index id in the desired set but are never sent through `resolveMemberExecutor` (team configs have no `enabled` field, so the guard is fleet-only in effect). `packages/app/src/services/team-service.ts:448-455`. | Test: disabled member pinning executor `nonexistent` does not block materialization; only the enabled member is upserted and the disabled member's stale generated spec is pruned (`fleet-service.test.ts` review-P3 test). |
| P4 disabled-pin error wording | Restored verbatim pre-extraction wording `member "${localId}"` — `resolveMemberExecutor` now takes the optional roster and re-derives the frozen-index local id for the error text (falls back to `member.id ?? member.executor` when no roster is threaded). `packages/app/src/services/team-service.ts:330-337`. | Existing team-service disabled-pin test still passes unchanged. |
| P4 storage-root leg no-op | `assertLaunchGroundTruth` now derives the actual storage root (`join(cwd, '.spur')`) and compares it against `join(projectPath, '.spur')` instead of a `join(cwd,'.spur','..')` cwd identity. `packages/app/src/services/fleet-service.ts:352-364`. | Existing R6 mismatch test passes against the new derivation. |
| P6 non-strict schema unknown keys | Accepted as-is (forward compatibility) — no change. | — |

Post-fix gate: `bun run spur-check` rc=0, **8091 pass / 0 fail** (`.spur/run/0835-test-gate.log` / `.status`). Proof re-bound: `bun .spur/host/host-proof-fingerprint.ts 0835 .spur/run/proofDigest` → `sha256:7ff0e7af696205ca1899acb50b4dbadca2b01ce933a09633e826a8706e0c023b`.

### References

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Identity and vocabulary"
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §4 preserve/convert matrix, §5 absent primitives
- Code: `packages/app/src/services/team-service.ts:687-727`, `:745-790`; `apps/web/src/modules/workspace/WorkspaceShell.tsx:18`
- Preserved owner: G4 (occupant identity) — reuse, do not fork

### History

- 2026-09-12T15:18:22.029Z todo → wip (system)
- 2026-09-12T16:41:46.638Z wip → testing (system)
- 2026-09-12T16:42:40.866Z testing → done (system)

