---
schema_version: 1
name: "Agent instance storage shapes, deterministic id composition, and role-addressed messaging"
status: done
template: feature-impl
created_at: 2026-08-26T20:00:46.323Z
updated_at: "2026-08-27T02:24:07.180Z"
---

## 0685. Agent instance storage shapes, deterministic id composition, and role-addressed messaging

### Background

**Provenance.** Operator design discussion 2026-08-26. Three linked questions arose while
reviewing `spur message send` addressing: (1) where should agent role + instance configuration
live, (2) how should composed agent ids be formed (executor name + disambiguator), and (3) does
ADR-075's "no role addressing" decision block making `spur message` more natural, and should it be
reopened. Operator rulings, recorded here as the agreed direction this task lands:

- **Storage:** the capability catalog (roles + executors) stays global; the declarative roster stays
  project-local; **materialized instances move to the DB**. In this task only the **shapes** are
  frozen — the migration itself is explicitly out of scope, so the shapes are right for a future UI.
- **Id composition:** deterministic disambiguation suffix for duplicate-executor members, stable and
  reproducible — never a per-run random.
- **ADR-075:** reopen with exact-one role/executor addressing on `spur message send` /
  `spur agent wait`, collapsing to the existing `{specId, runId, generation}` pin.

**Verified state on entry — re-verified against the tree on 2026-08-26 (refine `--depth ready`).**
Every line reference below was read in this tree; earlier drafts of this task carried stale line
numbers and two contradictions, both corrected here and in Design.

Storage taxonomy:

- `~/.config/spur/config.yaml` — global layer: `agent.roles` (SSOT per ADR-078; ADR-061 is the
  superseded predecessor), `agent.executors` (named profiles `name/agent/model/tier`),
  `agent.default`. Machine-wide capability catalog.
- `.spur/config.yaml` — project layer, merged over the global layer (ADR-082: loaded once at the
  composition root). It carries `agent.team` declarative rosters and executor/role overrides **by
  schema**; in *this* repo the whole `agent:` block is currently **commented out** (`.spur/config.yaml`
  — the `team: demo:` roster is commented), so the project runs on the global layer alone. This
  matters for R3's demonstration (see R3).
- `.spur/agents/<id>.yaml` — per-instance materialized specs. `TeamService` resolves them from
  `join(ctx.cwd, '.spur', 'agents')` (`packages/app/src/services/team-service.ts:297`); reads go
  through `TeamService.listAgentSpecs()` (`team-service.ts:576`) → `loadAgentSpecs`. **Currently
  git-tracked:** `git ls-files .spur/agents` lists `.gitkeep`, `demo-claude.yaml`,
  `demo-codex.yaml`, `demo-omp-zai.yaml` — and all three specs carry the `spur:generated` tag, i.e.
  **every tracked spec in this tree is generated**, orphaned from the commented-out roster. `spur
  team up` writes generated specs into the same tracked dir (`saveAgentSpec`, `team-service.ts:792-794`).
- `~/.config/spur/projects.json` — machine registry, `{name, path, port}` only
  (`packages/config/src/projects.ts:10-22`), `schema_version: 1`, runtime state (which project runs
  on which port), written under an advisory lock with port probing
  (`packages/app/src/services/project-registry.ts:156`).

Instance shape (the contract R2 must freeze around):

- `AgentSpec` is defined **outside this repo**, in `@gobing-ai/ts-ai-runner`
  (`~/xprojects/ts-libs/packages/ai-runner/src/agent-spec.ts:11-27`):
  `{ id, name, type, executor?, workspace, purpose, tags: string[], config: Record<string, unknown>, autoStart? }`.
- The Layer-1 **role is not a typed field** — `spur team up` writes it into the untyped
  `config.role` (`team-service.ts:766-768`); the resolved executor name is written to the top-level
  `executor` field (`team-service.ts:759`). Any `byRole` reader must narrow `config.role` itself.
- `validateAgentId` enforces `^[a-z][a-z0-9_-]{1,63}$` (`agent-spec.ts:37-42`).

Id composition:

- `memberLocalId` = `member.id ?? executor ?? <role>-<n>` (`packages/config/src/index.ts:339-354`).
  A member declaring neither role nor executor yields `''`; R4 validation rejects it before
  materialization (`index.ts:522-528`).
- A team member materializes to `${teamId}-${localId}` (`team-service.ts:703-705`), mirrored by the
  config-load check (`index.ts:530-538`).
- Duplicate local ids (e.g. two `executor: omp` members in one team) are a **hard config-load error**
  `Duplicate team member id` (`packages/config/src/index.ts:531-537`) — the operator must hand-write
  an explicit `id:` to disambiguate. `seenLocal`/`seenComposed` at config load are the only guard.
- Role-only members auto-number `<role>-<n>` with a declaration-order count (0543 R3). **Correction
  to the earlier draft:** that scheme is stable under *append* and under *re-materialization of an
  unchanged roster*; it is **not** stable under arbitrary reorder — `n` counts matching members from
  index 0 to the member's own index, so moving a member changes its `n` (`index.ts:347-353`).

Addressing:

- `message send --to <spec-id>` treats the id verbatim — format-only `validateAgentId`
  (`team-service.ts:312-313`), inbox keyed by the `to_id` string with no FK to specs
  (`packages/domain/src/migrations.ts:26-40`); recipient existence is deliberately not required.
- `--to` is today a **`requiredOption`** (`apps/cli/src/commands/message.ts:30`) and `agent wait`
  takes a **required positional** `.argument('<specId>')` (`apps/cli/src/commands/agent.ts:105-108`)
  — both must relax to optional before a mutually exclusive `--role` can exist.
- `--wait` snapshots the `{specId, runId, generation}` pin **before** enqueue
  (`message.ts:128-135`); `getOccupant({agentKind})` is rejected — spec-id lookup only
  (`packages/app/src/services/agent-service.ts:2012-2014`).
- **No `--role` flag exists anywhere in `apps/cli/src/commands/*.ts`** (grep: zero matches) — this
  is greenfield surface, as ADR-075 recorded.
- The `--agent <role|executor>` selector on `agent run` resolves through
  `AgentService.resolveExecutorSelector` (`agent-service.ts:1741-1790`) to an **executor profile**
  via the role→tier→cheapest ladder. It does **not** resolve a materialized instance, so it is the
  wrong seam for R6 (see Design anti-patterns).
- Selector namespaces are already **pairwise disjoint** by a config-load guard
  (`packages/config/src/index.ts:556-590`, 0537 R4): a spec id can never equal a role name or an
  executor name. `--role` therefore cannot be ambiguous against `--to`.
- ADR-075 (2026-08-20, task 0609) closed "role addressing on wait/message" with a reasoned **no**
  and listed three reopening conditions; condition (2) — "a demonstrated multi-occupant team pattern
  where the operator needs one-role-one-recipient semantics and the concrete spec id is unknowable
  in advance" — is exactly what R4's disambiguated ids create, and it prescribes the reopen contract
  verbatim: exact-one resolution, zero/multi are hard errors naming the role and count, the pin is
  written before proceed, no fan-out.
- `coordination_runs` already persists occupant pins in the DB (`packages/domain/src/migrations.ts:117-145`)
  — the DB is already the home of runtime control-plane identity, which is why the operator chose it
  as the future home of materialized instances.

Numbering facts frozen for the implementer (verified 2026-08-26, no guessing at implement time):

- Highest ADR in `docs/00_ADR.md` is **ADR-083** → the new storage-taxonomy entry is **ADR-084**.
- Highest migration prefix in `packages/domain/src/migrations.ts` is **`0025_spur_cli_history_checkpoint_identity_mtime`**
  → the reserved (NOT registered) instance migration name is **`0026_spur_cli_agent_instances`**.

**Why this task exists.** The agreed direction (instances → DB, deterministic suffixes, role
addressing) is recorded nowhere. Storage is split across three project surfaces with generated
state committed to a tracked directory; two same-executor members cannot be declared without a
hand-written `id:`; and ADR-075 forces `spur message` to address exact composed ids, which
disambiguation makes untypeable. This task lands the decisions and freezes the instance shapes so a
later DB-migration/UI task has a stable contract.

**Known risks.**

- Role addressing without exact-one resolution degenerates into broadcast, which ADR-057 rules out
  and D6 scope excludes. Any selector must resolve to exactly one instance and collapse to the
  existing pin, or it must not ship.
- Suffix ids must not shift on re-materialization of an unchanged roster — 0543's inbox-addressing
  stability depends on it. A per-materialization random suffix is explicitly rejected. No cheap
  scheme is stable under arbitrary reorder; R4 states the property it actually guarantees rather
  than over-claiming.
- Freezing shapes without the migration would leave the future DB/UI task guessing the contract;
  performing the migration here would overrun scope. This task fixes the shapes only.

### Requirements
>
> **Outcome: the three operator rulings land as recorded decisions + working code where the DB is
> not required, and the materialized-instance DB shapes are frozen for a later migration task.**

- [x] R1. **Storage architecture recorded as ADR-084.** The capability catalog (`agent.roles`,
  `agent.executors`, `agent.default`) stays in the global `~/.config/spur/config.yaml` — ADR-078
  SSOT unchanged, no relocation. The declarative roster stays project-local: extend the existing
  `agent.team` block in `.spur/config.yaml` (riding the ADR-082 merged loader); a separate
  `.spur/agents.yaml` is acceptable only if the roster outgrows the config file, and even then it is
  declarative-only, layered, project-local, never a second loader. Materialized instances are owned
  by the DB, not by committed spec files. Write the entry as **ADR-084** (verified next free slot;
  do not re-derive) dated 2026-08-26, recording this taxonomy and why `~/.config/spur/projects.json`
  was **rejected** as the instance home: layer inversion (instances are project-shaped — their
  `workspace` is a project path; the merged-config contract is global-defaults + project-override at
  the composition root), runtime-state-vs-config conflation (`projects.json` is `{name,path,port}`
  state under an advisory lock with port probing), and portability (a clone must carry its roster
  without a machine-global edit).

- [x] R2. **Materialized-instance shapes frozen; migration out of scope.** Define (a) the table DDL
  for materialized agent instances, following `packages/domain/src/migrations.ts` conventions
  (four-digit numeric prefix, `CREATE TABLE IF NOT EXISTS`, explicit `CREATE INDEX IF NOT EXISTS`,
  `_spur_cli_` migration-id marker) under the **reserved** name `0026_spur_cli_agent_instances`
  — reserved, **not registered**: it must NOT be appended to the migration array, so `spur self
  migrate` is byte-unchanged by this task; and (b) the TS types plus an `AgentInstanceStore`
  resolution interface (`bySpecId`, `byRole`, `byExecutor`) in `packages/domain`, with a
  file-backed implementation over `TeamService.listAgentSpecs()` that R6 consumes. `AgentSpec`
  itself is external (`@gobing-ai/ts-ai-runner`) and is **not** modified — the role is read by
  narrowing the untyped `config.role`, in one Spur-local accessor, not by adding a typed field
  upstream. The DB-backed writer/reader and the instance→DB cutover are **explicitly out of scope**.

- [x] R3. **Generated instance specs leave the tracked tree.** Add a `.gitignore` rule excluding
  generated specs under `.spur/agents/` while keeping `.spur/agents/.gitkeep` tracked, and
  `git rm --cached` the three already-tracked generated specs (`demo-claude.yaml`,
  `demo-codex.yaml`, `demo-omp-zai.yaml` — all three carry `spur:generated`; a `.gitignore` rule
  alone does not untrack an already-tracked file). Hand-authored specs (`spur agent add`) stay
  trackable. **Demonstration:** the `demo` roster in `.spur/config.yaml` is currently commented out,
  so `spur team up demo` cannot run in this tree as-is; demonstrate R3 either by uncommenting the
  `agent.team.demo` roster (preferred — it restores the dogfood surface the specs came from) or in a
  scratch project, and record which was used. Evidence: a `spur team up` run followed by
  `git status --porcelain .spur/agents` showing no generated-spec churn.

- [x] R4. **Deterministic suffix id composition.** Enhance `memberLocalId`
  (`packages/config/src/index.ts:339`) so *derived* collisions disambiguate deterministically instead
  of hard-failing `Duplicate team member id`. An explicit duplicate `id:` **stays** a hard
  config-load error (operator mistake, not a collision). Properties the suffix must satisfy, stated
  as what is actually guaranteed:
  - **deterministic and idempotent** — the same roster always yields the same ids; re-running
    `spur team up` on an unchanged roster re-addresses nothing;
  - **backward compatible** — a roster with no duplicate-executor members produces byte-identical
    ids to today, so no existing spec is re-addressed;
  - **append-stable** — adding a member at the end never shifts an existing member's id. Arbitrary
    reorder is *not* claimed stable: the already-frozen `<role>-<n>` scheme does not have that
    property either (Background), and no cheap scheme does. Do not write an AC asserting it.
  - **collision-free**, and valid under `^[a-z][a-z0-9_-]{1,63}$` with the composed `teamId-…`
    ≤ 64 chars.
  Algorithm is frozen in Design (declaration-index suffix, first occurrence unsuffixed). Free-form
  strings — model ids **and** `purpose` text — must never enter the id.

- [x] R5. **ADR-075 reopened by in-place amendment.** Append a dated **Amendment (2026-08-26)** block
  to the existing ADR-075 entry (in-place amendment, following the ADR-051 amendment precedent — do
  **not** allocate a second new ADR number) recording an accepted decision that allows a selector
  resolving exactly one materialized instance, collapsing to the existing `{specId, runId,
  generation}` pin; ADR-057 stays authoritative. Resolution rules: zero matches → hard error naming
  the selector and `count=0`; more than one → hard error naming the selector, `count=N`, and the
  candidate spec ids; never first-match, never a silent pick. No broadcast or fan-out (D6 R3/R4).
  Cite the reopening evidence ADR-075 itself names — **condition (2)**, a multi-occupant pattern
  where the concrete spec id is unknowable in advance, which R4's disambiguated ids create — and
  record ADR-051 operator consent for the public-surface change (granted in this discussion,
  2026-08-26).

- [x] R6. **Selector surface implemented on `message send` / `agent wait`.** Add `--role <name>` to
  `message send` (relaxing `--to` from `requiredOption` to `option`; exactly one of `--to` / `--role`
  required — zero or both → exit 2 usage error) and to `agent wait` (relaxing the positional to
  `[specId]`; same exactly-one rule). Selector vocabulary: Layer-1 roles from `AGENT_ROLE_NAMES`
  (scribe | coder | reviewer | planner) plus executor names from `agent.executors` — no second list;
  an unknown selector is a hard error naming the accepted vocabulary. Resolution reads materialized
  instances through the R2 `AgentInstanceStore` interface (today file-backed; the interface is what a
  future DB swap re-points, so no call-site change then) — **not** through
  `AgentService.resolveExecutorSelector`, which selects an executor profile, not an instance. The
  resolved instance's pin is snapshotted before wait/send exactly as the identity path does
  (`message.ts:128-135`). Tests must cover zero-match, multi-match, exact-one→pin, unknown selector,
  neither-supplied, both-supplied, and the absence of any fan-out path.

- [x] R7. **T3 same-commit surface doc.** Update `docs/04_DESIGN.md` (message/agent surface sections)
  and `plugins/sp/skills/spur-cli/references/{message,agent}.md` for `--role` — the exactly-one rule,
  the exact-one resolution rule, and the error codes. Same commit as R6. Note that both reference
  files today carry illustrative `--to reviewer` / `agent wait reviewer` examples that ADR-075
  explicitly documented as *spec ids that happen to share role names*; with `--role` shipping, those
  examples must be disambiguated so the two namespaces do not read as one.

**Non-goals (explicitly out of scope this task):** the materialized-instance **DB migration** and
the instance→DB cutover (R2 freezes shapes only; `0026_spur_cli_agent_instances` is reserved, not
registered); building or enhancing any UI; broadcast or fan-out messaging (a selector reaches
exactly one recipient); modifying `AgentSpec` in `@gobing-ai/ts-ai-runner`; relocating the role SSOT
or the executor catalog (ADR-078 / ADR-077 hold); changing `agent.run`'s existing `--agent` role
selection or `resolveExecutorSelector`; a new `spur` noun or verb (`--role` is a flag on existing
verbs, ADR-051 noun-first).

### Acceptance Criteria

```gherkin
Feature: Agent instance storage architecture, deterministic id composition, and exact-one role addressing

  Scenario: R1/R2 — Storage taxonomy decided and instance shapes frozen
    Given the capability catalog lives in ~/.config/spur/config.yaml and the declarative roster in .spur/config.yaml
    When the storage decision is recorded and the materialized-instance shapes are defined
    Then ADR-084 records the taxonomy and the projects.json rejection rationale
    And the AgentInstance type, the bySpecId/byRole/byExecutor AgentInstanceStore interface, and a file-backed implementation compile in packages/domain
    And the 0026_spur_cli_agent_instances DDL exists only as a draft and is absent from the migration array
    And no DB migration and no instance→DB cutover are performed by this task

  Scenario: R3 — Generated instance specs leave the tracked tree
    Given three .spur/agents/demo-*.yaml specs tagged spur:generated are currently git-tracked
    When the gitignore rule lands and the tracked generated specs are removed from the index
    Then a spur team up run leaves git status clean of generated spec churn
    And git ls-files .spur/agents lists only .gitkeep
    And hand-authored specs remain trackable

  Scenario: R4 — Duplicate-executor members disambiguate deterministically
    Given a team declares two members with the same executor and no explicit id
    When the roster is materialized
    Then the first member keeps the unsuffixed executor-derived id and the second receives that id plus a "-2" declaration-index suffix
    And a roster with no duplicate-executor members produces ids byte-identical to the previous behavior
    And appending another member does not shift any existing derived id
    And an explicit duplicate member id remains a hard config-load error
    And composed ids stay within ^[a-z][a-z0-9_-]{1,63}$ and ≤ 64 chars

  Scenario: R5/R6 — Role-addressed send/wait resolve exact-one and collapse to the pin
    Given a materialized instance declares a Layer-1 role
    When spur message send --role <role> or spur agent wait --role <role> is invoked
    Then the role resolves to exactly one instance whose {specId, runId, generation} pin is snapshotted before wait/send
    And zero matches or more than one match are hard errors naming the selector, the count, and the candidate spec ids
    And supplying neither --role nor --to/<specId>, or supplying both, exits 2 with a usage error
    And an unknown selector is a hard error naming the accepted role and executor vocabulary
    And ADR-075 carries a dated amendment recording the exact-one decision and the ADR-051 consent
    And no broadcast or fan-out path exists

  Scenario: R7 — T3 surface doc ships with the surface
    Given the --role surface is added
    When docs/04_DESIGN.md and the spur-cli message and agent reference files are updated
    Then the surface change and its docs land in the same commit
    And the pre-existing --to reviewer examples are disambiguated from the new role namespace
```

### Q&A

- **Why not `~/.config/spur/projects.json` for instances?** Recorded rejection in R1. Three reasons:
  (1) layer inversion — the merged-config contract (ADR-078/082) is global-defaults + project-override
  at the composition root, and instances are project-shaped (their `workspace` is a project path);
  (2) `projects.json` is runtime state (`{name,path,port}`, `schema_version: 1`, advisory-locked,
  port-probing) not a config store — mixing declarative intent into it conflates categories the repo
  otherwise keeps separate; (3) portability — a clone must carry its roster without a machine-global
  edit.
- **Why the DB for materialized instances instead of gitignored files?** Operator preference: the DB
  enables the future UI (roster tabs, per-agent messages, activity) and already hosts the
  control-plane identity (`coordination_runs`). Files were rejected for the *materialized* layer
  because generated specs churn the tracked tree and mix with hand-authored ones. This task only
  freezes the shapes; the migration is a separate task.
- **Why a declaration-index suffix rather than the illustrated hash?** Closed in Design ("Rejected —
  a hash suffix"). Short version: a hash keyed on `teamId:executor:purpose` re-addresses a member
  when its free-form `purpose` text is edited — the same churn R4 rejects for model strings; drop
  `purpose` and the key is identical for the colliding members, so a declaration-index tie-break is
  needed anyway. The index gives every property R4 claims, reuses the frozen 0543 `<role>-<n>`
  shape, and keeps ids short. Swapping in the hashed form is a one-line change to Design step 3 if
  the operator prefers the literal example; nothing else moves.
- **Why is "reorder-stable" no longer claimed?** Premise correction from this refine. The existing
  `<role>-<n>` derivation counts matching members from index 0 to the member's own index
  (`packages/config/src/index.ts:347-353`), so moving a member *does* shift its `n` — the property
  the earlier draft asserted was already false in shipped code. What 0543's inbox stability actually
  needs, and what R4 guarantees, is idempotence on an unchanged roster plus append-stability.
- **Deterministic vs random suffix:** a per-materialization random suffix re-addresses every member
  on every `spur team up`, breaking idempotence. Rejected outright.
- **Does `--role` re-open the ADR-075 race?** No. The selector resolves exactly one instance, then
  the existing `{specId, runId, generation}` pin is written before wait/send; re-resolution on
  reconnect is banned, exactly as ADR-075/057 specified for any future role binding.
- **Could `--role` and `--to` ever be ambiguous?** No — config load already enforces pairwise
  disjointness of spec ids, role names, and executor names (`packages/config/src/index.ts:556-590`,
  0537 R4). The separate flag is for clarity of intent, not tie-breaking.
- **Why not reuse `agent run`'s `--agent <role>` resolution?** `AgentService.resolveExecutorSelector`
  (`agent-service.ts:1741`) resolves role→tier→cheapest *executor profile* for dispatch. It has no
  notion of a materialized instance or an occupant, so it would return a profile with nothing to
  address. Design lists it as an anti-pattern.
- **Where does the role actually live on a spec?** In the untyped `config.role`
  (`team-service.ts:766-768`), not as a typed `AgentSpec` field — `AgentSpec` is external
  (`@gobing-ai/ts-ai-runner`). R2 reads it through one Spur-local narrowing accessor; changing the
  upstream type is out of scope (release-coupled).
- **Executor vs role multiplicity:** both can be multi (two instances from one executor; two members
  share a role). The exact-one rule is uniform: zero/multi are hard errors naming the selector, the
  count, and the candidates. No silent first-match. `AgentInstanceStore.byRole/byExecutor` return
  arrays so a future roster UI can list many; exact-one is enforced by the CLI caller.
- **Why a flag, not `--to <role>`?** ADR-051's noun-first rule and ADR-075's own design: `--role` on
  existing verbs, mutually exclusive with the concrete addressee. A single `--to` that silently
  accepted either would blur the namespace the 0537 R4 disjointness guard keeps separate.
- **What if the roster outgrows `.spur/config.yaml`?** Then a dedicated `.spur/agents.yaml`
  (declarative-only, layered, project-local) is acceptable — but the default is to extend
  `agent.team` in the existing config file and reuse the ADR-082 merged loader rather than build a
  second loader.
- **Does R4 change existing role-only numbering?** No. `<role>-<n>` stays; the suffix applies to
  *executor-derived* collisions, which today are undeclarable. Explicit duplicate `id:` stays an
  error, and a roster with no derived collisions produces byte-identical ids.
- **Why does R3 need `git rm --cached`?** All three tracked `.spur/agents/demo-*.yaml` carry the
  `spur:generated` tag, and a `.gitignore` rule does not untrack an already-tracked file (the same
  situation `.spur/tmp/` is in today). The AC asserts `git ls-files .spur/agents` lists only
  `.gitkeep` so the untracking is actually proven.
- **Why does R3 mention uncommenting the roster?** The whole `agent:` block in `.spur/config.yaml`
  — including `team.demo` — is commented out in this tree, so `spur team up demo` has nothing to
  materialize. Without restoring it (or using a scratch project), R3's AC is not executable.
- **Deferred with owner:** the DB migration (`0026_spur_cli_agent_instances`) + UI — future task,
  contract is `AgentInstanceStore`; a typed `role` field on `AgentSpec` — ts-ai-runner, if ever;
  the role→tier SSOT and executor catalog — ADR-078 / ADR-077, untouched; the `agent.default` value
  domain — 0542, untouched.

### Design

**WHAT.** Land the three operator rulings: (1) record the storage taxonomy as ADR-084 and freeze the
materialized-instance shapes behind an `AgentInstanceStore` interface, (2) make derived member ids
deterministic-disambiguating for duplicate-executor members, (3) reopen ADR-075 by in-place
amendment with exact-one role/executor addressing on `message send` / `agent wait` — all as code
where the DB is not required, plus the ADR/consent/doc records.

**WHY.** The direction is agreed but unrecorded. Generated specs are committed to a tracked
directory; duplicate-executor members are undeclarable without a hand-written `id:`; and ADR-075
forces `spur message` to address composed ids that disambiguation makes untypeable. Freezing the
shapes now makes the future DB/UI task a mechanical cutover instead of a contract-guessing exercise.

**WHERE (frozen file targets — line numbers verified 2026-08-26).**

| Target | What changes |
| --- | --- |
| `packages/config/src/index.ts:339-354` | `memberLocalId` — R4 declaration-index suffix |
| `packages/config/src/index.ts:530-538` | duplicate-local-id guard — explicit dup stays an error; derived dup now suffixes instead of failing |
| `packages/app/src/services/team-service.ts:703-705` | composed-id materialization — consumes the enhanced `memberLocalId`; verify no other change needed |
| `packages/domain/src/` (new module) | R2 `AgentInstance` types + `AgentInstanceStore` interface + file-backed impl; DDL draft in a comment/doc block |
| `apps/cli/src/commands/message.ts:30` | `--to` `requiredOption` → `option`; add `--role` |
| `apps/cli/src/commands/message.ts:99-135` | `runMessageSend` — exactly-one check, resolution before pin snapshot |
| `apps/cli/src/commands/agent.ts:105-114` | `agent wait` — `.argument('<specId>')` → `[specId]`; add `--role` |
| `apps/cli/src/commands/agent.ts:655` | `runAgentWait` — exactly-one check + resolution |
| `docs/00_ADR.md` | new **ADR-084** (storage taxonomy, R1) + in-place **Amendment (2026-08-26)** block on ADR-075 (R5) |
| `.gitignore` + `git rm --cached` | generated-spec exclusion + untracking the three tracked `demo-*.yaml` (R3) |
| `.spur/config.yaml` | uncomment `agent.team.demo` if that path is chosen for the R3 demonstration |
| `docs/04_DESIGN.md` + `plugins/sp/skills/spur-cli/references/{message,agent}.md` | T3 surface doc (R7) |

Explicitly **not** touched: `packages/app/src/services/agent-service.ts` (`getOccupant` at :2012 and
`resolveExecutorSelector` at :1741 both stay as-is), `~/xprojects/ts-libs/.../agent-spec.ts`, the
migration array in `packages/domain/src/migrations.ts`.

**Frozen names — new public surface.** `--role <name>` on the existing `message send` and
`agent wait` verbs — **no new noun, no new verb** (ADR-051 noun-first). Exactly one of `--role` and
`--to` / `<specId>`; zero or both → **exit 2** usage error. Selector vocabulary =
`AGENT_ROLE_NAMES` (scribe | coder | reviewer | planner) ∪ configured `agent.executors` names. No
second role list. Because config load already enforces pairwise disjointness of spec ids, role
names, and executor names (`packages/config/src/index.ts:556-590`, 0537 R4), a value can never mean
both a role and a spec id — the flag split is for *clarity of intent*, not to break a tie.

**Algorithm — deterministic suffix (R4).**

1. Explicit `id:` → returned unchanged; duplicate explicit ids remain a hard config-load error.
2. Role-only member → the existing `<role>-<n>` scheme is unchanged (0543 R3).
3. Executor-derived member → base = the executor name. Count how many *earlier* members
   (declaration indices `0..index-1`) derive the same base; if the count is `0`, return the base
   unchanged; otherwise return `` `${base}-${count + 1}` ``.

So two `omp-dsv4-flash-volc` members in team `team-1` materialize to
`team-1-omp-dsv4-flash-volc` and `team-1-omp-dsv4-flash-volc-2`. This is the same shape the role
scheme already uses, satisfies every property R4 claims (deterministic, idempotent, backward
compatible, append-stable, collision-free, short), and adds no new state.

**Rejected — a hash suffix (e.g. `…-23gd`).** The operator's illustrative example
`team-1-omp-dsv4-flash-volc-23gd` implies a hash of a member identity key such as
`teamId:executor:purpose`. Rejected because `purpose` is free-form operator text: editing a
purpose string would churn the member's id and re-address its inbox — precisely the failure mode
R4 rejects for model strings. Dropping `purpose` from the key leaves `teamId:executor`, which is
identical for the colliding members and still needs a declaration-index tie-break — so the hash
adds five characters and a new derivation for no property the index does not already give. If the
operator wants the literal hashed form, say so and it becomes a one-line swap in step 3; the
resolution rules and every other requirement are unaffected.

**Algorithm — selector resolution (R6).**

1. Enforce exactly one of `--role` / `--to` (or `[specId]`). Zero or both → exit 2 with a usage
   message naming both forms.
2. If `--to` / `<specId>`: unchanged path, byte-for-byte.
3. If `--role`: validate the value against `AGENT_ROLE_NAMES` ∪ executor names; unknown → hard
   error naming the accepted vocabulary.
4. Resolve through the R2 `AgentInstanceStore` — `byRole(name)` (matching the narrowed
   `spec.config.role`) or `byExecutor(name)` (matching the top-level `spec.executor`), scoped to the
   current project. A role name and an executor name are disjoint (step 3's vocabulary is a union of
   two disjoint sets), so the selector picks exactly one lookup, never both.
5. **Zero matches → error** naming the selector and `count=0`. **More than one → error** naming the
   selector, `count=N`, and the candidate spec ids, so the operator can re-issue with `--to`. Never
   first-match, never a silent pick.
6. On exactly one, snapshot the same `{ specId, runId, generation }` pin the identity path writes
   (`message.ts:128-135`), **before** the wait or send proceeds.
7. Everything downstream is unchanged — the pin, not the selector, is what the wait/send binds to;
   a reconnect resumes against the pin and never re-resolves the selector.

**R2 instance shapes (contract for the future DB task / UI).** Draft DDL under the reserved,
unregistered id `0026_spur_cli_agent_instances`, following `migrations.ts` conventions
(`CREATE TABLE IF NOT EXISTS`, explicit `CREATE INDEX IF NOT EXISTS`, `_spur_cli_` marker). Columns,
at minimum: `spec_id TEXT PRIMARY KEY` (the composed id), `team_id TEXT` (nullable), `member_key
TEXT` (stable member identity), `executor TEXT` (profile name), `role TEXT` (nullable Layer-1 role),
`workspace TEXT NOT NULL`, `status TEXT NOT NULL` (`stopped|running|exited|errored`), `pid INTEGER`
(nullable), `tags TEXT NOT NULL` (JSON), `config TEXT NOT NULL` (JSON), `created_at INTEGER NOT
NULL`, `updated_at INTEGER NOT NULL`; indexes on `(role)`, `(executor)`, and `(team_id)` — the three
resolution paths. The TS `AgentInstance` type mirrors those columns.

`AgentInstanceStore` is the seam both the current file-backed reader and the future DB reader
satisfy:

```ts
interface AgentInstanceStore {
    bySpecId(specId: string): Promise<AgentInstance | null>;
    byRole(role: string): Promise<AgentInstance[]>;
    byExecutor(executor: string): Promise<AgentInstance[]>;
}
```

`byRole` / `byExecutor` return an array *by design* — exact-one is the **caller's** rule (R6 step 5),
not the store's, so the store stays reusable by a future roster UI that legitimately lists many.
R6 and the future UI consume the interface, never the store implementation directly. The migration,
the DB writer/reader, and the cutover are NOT implemented by this task.

**Anti-patterns (do not implement).**

- Broadcast or fan-out; a selector reaches exactly one recipient.
- First-match / "pick the newest" / "pick the running one" resolution. Ambiguity is an error, not a
  heuristic.
- Reusing `AgentService.resolveExecutorSelector` (`agent-service.ts:1741`) for `--role`. It resolves
  role→tier→cheapest **executor profile** for `agent run` dispatch; it knows nothing about
  materialized instances and would silently return a profile with no occupant.
- Adding a typed `role` field to `AgentSpec` in `@gobing-ai/ts-ai-runner`. Read `config.role`
  through one Spur-local narrowing accessor instead; an upstream type change is a separate
  release-coupled decision.
- Per-materialization random suffixes (breaks 0543 inbox stability), or any suffix derived from
  free-form text (`purpose`) or a model id (re-pinning the model would churn addressing).
- Registering `0026_spur_cli_agent_instances` in the migration array, writing a `drizzle/*.sql` for
  it, or any instance→DB cutover or UI work (out of scope by operator ruling).
- A second role list, or relocating the role/executor catalog (ADR-078 / ADR-077 hold).
- A new `spur` noun or verb.
- Replacing ADR-057's identity pin — the selector sits above the pin, never instead of it, and is
  never re-resolved on reconnect.
- Claiming reorder-stability for derived ids in code comments, docs, or AC. The guarantee is
  idempotence + append-stability (see R4).

**Cross-task contract.** No `dependencies[]`. Consumes as given: ADR-057 (occupant pin), ADR-075
(reopening evidence + exact-one preconditions), ADR-077 (pin beats role), ADR-078 (role/executor
SSOT in config; ADR-061 superseded), ADR-082 (merged config at composition root), 0537 R4
(selector-namespace disjointness), 0543 R1/R3 (role/executor recorded on the spec; id stability).
Leaves for the future DB task: the `0026_spur_cli_agent_instances` migration, the DB-backed
instance reader/writer, and the UI. `AgentInstanceStore` is the hand-off contract.

### Plan

1. **Record decisions (R1, R5).** Write **ADR-084** (storage taxonomy + the `projects.json`
   rejection rationale, dated 2026-08-26) and append a dated **Amendment (2026-08-26)** block to the
   existing ADR-075 entry (exact-one selector; ADR-051 consent record). Verify: both entries exist,
   ADR-084 is the next free number, ADR-075 keeps its number, and both cite the Background
   verified-state facts.
2. **Freeze instance shapes (R2).** Add the `AgentInstance` type, the `AgentInstanceStore` interface,
   and a file-backed implementation over `TeamService.listAgentSpecs()` in `packages/domain`,
   including the one narrowing accessor for `config.role`. Carry the `0026_spur_cli_agent_instances`
   DDL as a draft (doc block / comment) — **not** appended to the migration array. Verify:
   `bun run lint` typechecks; `grep 0026_spur_cli_agent_instances packages/domain/src/migrations.ts`
   finds no array entry; a unit test covers `bySpecId` / `byRole` / `byExecutor` against seeded specs.
3. **Gitignore split (R3).** Add the generated-spec `.gitignore` rule, keep `.spur/agents/.gitkeep`
   tracked, `git rm --cached` the three tracked `demo-*.yaml`, and restore the `agent.team.demo`
   roster in `.spur/config.yaml` (or use a scratch project — record which). Verify: `spur team up demo`
   then `git status --porcelain .spur/agents` shows no generated-spec churn; `git ls-files .spur/agents`
   lists only `.gitkeep`.
4. **Deterministic suffix (R4).** Enhance `memberLocalId` with the declaration-index suffix; keep the
   explicit-dup error; keep `<role>-<n>` and the `''` neither-role-nor-executor return unchanged.
   Verify: unit tests for two same-executor members (`omp`, `omp-2`), three same-executor members,
   a roster with no duplicates producing byte-identical ids to today (backward compatibility),
   append-stability, explicit-duplicate still erroring, and the composed id staying within
   `^[a-z][a-z0-9_-]{1,63}$` and ≤ 64 chars.
5. **Selector surface (R6).** Relax `--to` to an optional flag and `agent wait`'s positional to
   `[specId]`; add `--role` to both with the exactly-one check, vocabulary validation, and exact-one
   resolution against `AgentInstanceStore`. Verify: tests for zero-match, multi-match (error names
   the count and candidates), exact-one→pin, unknown selector, neither-supplied (exit 2),
   both-supplied (exit 2), and no fan-out path; targeted tests green before any full-suite run.
6. **T3 surface doc (R7).** Update `docs/04_DESIGN.md` and
   `plugins/sp/skills/spur-cli/references/{message,agent}.md` in the same commit as step 5, including
   disambiguating the existing `--to reviewer` / `agent wait reviewer` examples.
7. **Gates.** `bun run lint`, targeted tests, `bun run spur-check`, then `bun run corpus-check`
   (a public surface changed → ADR-051 consent is recorded in step 1).

**Done when** ADR-084 records the storage taxonomy, ADR-075 carries the dated amendment, the
instance shapes are frozen behind `AgentInstanceStore` with the migration reserved but unregistered,
generated specs are out of the tracked tree, duplicate-executor members materialize with
deterministic append-stable ids, `--role` resolves exact-one and collapses to the pin on both verbs,
and the T3 doc ships with the surface — with no DB migration, no `AgentSpec` change, and no UI work
performed.

### Solution
Task 0685 landed in commit `66e43cee83e9cf0c97c4c3b4529b9d08c33139d1`; the standalone verification correction is the current working-tree diff.

| Req | Implementation | Anchor |
| --- | --- | --- |
| R1 | `ADR-086` records the three-layer storage taxonomy and projects-registry rejection; its append-only correction preserves the global capability catalog. | `docs/00_ADR.md:1393-1428` |
| R2 | `AgentInstance` mirrors the reserved database shape. | `packages/domain/src/agent-instance.ts:15-44` |
| R2 | `AgentInstanceStore` exposes only `bySpecId`, `byRole`, and `byExecutor`. | `packages/domain/src/agent-instance.ts:51-62` |
| R2 | `AGENT_INSTANCES_DDL_DRAFT` freezes the complete unregistered `0026_spur_cli_agent_instances` DDL and indexes beside the registered migration catalog. | `packages/domain/src/migrations.ts:641-667` |
| R2 | `createFileAgentInstanceStore` projects current specs onto the frozen read shape. | `packages/app/src/services/agent-instance-store.ts:23-57` |
| R3 | `.spur/agents` generated materializations are ignored while `.gitkeep` remains tracked; hand-authored specs are force-trackable because gitignore cannot inspect YAML tags. | `.gitignore:134-140` |
| R3 | `agent:` owns the active project-local `team.demo` roster used by the materialization proof. | `.spur/config.yaml:45-55` |
| R4 | `memberLocalId` allocates deterministic, append-stable executor suffixes without colliding with an existing derived base. | `packages/config/src/index.ts:332-380` |
| R5 | `--role` reopens ADR-075 only as exact-one resolution above the existing identity pin. | `docs/00_ADR.md:1072-1085` |
| R6 | `resolveRoleTarget` validates the shared vocabulary and rejects zero/multiple matches with explicit counts and candidates. | `packages/app/src/services/agent-instance-store.ts:83-124` |
| R6 | `message send` resolves exactly one selector before `runMessageSend`, which snapshots the occupant before a wait-bearing send. | `apps/cli/src/commands/message.ts:28-77` |
| R6 | `agent wait` resolves exactly one selector before snapshotting `{specId, runId, generation}` once. | `apps/cli/src/commands/agent.ts:105-150` |
| R7 | `--role` signatures, exact-one semantics, exit codes, and pin behavior are documented with the public surface. | `docs/04_DESIGN.md:463-480` |

No database migration, instance cutover, UI, `AgentSpec` change, fan-out path, new noun, or new verb was added.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Storage taxonomy and projects.json rejection are recorded at docs/00_ADR.md:1393-1428; the append-only correction preserves the global catalog. Fix-pass artifacts: .spur/run/0685-solution.md:1-19 (CLI-submitted Solution), .spur/run/0685-review.md:1-29 (combined review), and .spur/run/0685-verdict.json:1-138 (final standalone verdict). |
| R2 | MET | packages/domain/src/agent-instance.ts:15-62 freezes AgentInstance and the exact three-method AgentInstanceStore; packages/domain/src/migrations.ts:641-667 carries the complete reserved DDL outside CLI_MIGRATIONS; packages/app/src/services/agent-instance-store.ts:23-57 is the file reader. |
| R3 | MET | Source-local team up demo exited 0; git status --porcelain .spur/agents produced no output; git ls-files .spur/agents lists only .gitkeep; git add -f --dry-run proves a hand-authored spec remains explicitly trackable. |
| R4 | MET | packages/config/src/index.ts:332-380 allocates deterministic collision-free suffixes; packages/config/tests/team-config.test.ts:121-249 covers -2/-3, suffix/base collision, append stability, explicit duplicate rejection, compatibility, and schema bounds. |
| R5 | MET | docs/00_ADR.md:1072-1085 amends ADR-075 in place: exact-one resolution, explicit count/candidates failures, no fan-out, and the unchanged identity pin. |
| R6 | MET | packages/app/src/services/agent-instance-store.ts:59-124 centralizes selector resolution; message/agent CLI tests cover neither, both, unknown, zero, multi, and exact-one pin paths. Real golden path exited 0: message send --role planner --from verifier --json returned toId demo-claude and status queued. |
| R7 | MET | git show 66e43cee... confirms both command modules, docs/04_DESIGN.md, and both spur-cli references landed in the same implementation commit; doc-evolve sync-check confirms docs/00, docs/03, docs/04, and AGENTS.md are present in the correction diff. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1/R2 — Storage taxonomy decided and instance shapes frozen | MET | command | bun run spur-check exited 0: all seven workspaces typechecked and the coverage-enforced repository suite passed with 6,540 tests, 0 failures, 99.19% functions, and 99.04% lines. |
| Scenario: R3 — Generated instance specs leave the tracked tree | MET | command | team up demo exited 0; git status --porcelain .spur/agents was empty; git ls-files .spur/agents returned only .spur/agents/.gitkeep; git add -f --dry-run identified a spec as addable. |
| Scenario: R4 — Duplicate-executor members disambiguate deterministically | MET | test | The clean 6,540-test repository run includes team-config.test.ts cases for duplicate executors, suffix/base collision, append stability, explicit duplicates, regex, and length bounds. |
| Scenario: R5/R6 — Role-addressed send/wait resolve exact-one and collapse to the pin | MET | test | The clean repository run includes message.test.ts and agent-wait.test.ts exact-one pin, zero/multi, unknown, neither/both, and no-fan-out assertions; the real --json message golden path also exited 0. |
| Scenario: R7 — T3 surface doc ships with the surface | MET | command | git show --name-only 66e43cee... exited 0 and listed agent.ts, message.ts, docs/04_DESIGN.md, references/agent.md, and references/message.md in one commit. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Functional / SECUA / Architecture | Task 0685 | No P1-P3 findings. R1-R7 are traced and met; no architecture-deepening candidate remains. |

#### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/00_ADR.md:1393-1428` records the global catalog, project-local roster, DB-owned instances, and rejection of `projects.json`. |
| R2 | MET | `packages/domain/src/agent-instance.ts:15-62` freezes the type and exact three-method read seam; `packages/domain/src/migrations.ts:641-667` freezes complete DDL outside `CLI_MIGRATIONS`; `packages/app/src/services/agent-instance-store.ts:23-57` supplies the file-backed reader. |
| R3 | MET | `.gitignore:134-140` excludes generated specs while preserving `.gitkeep`; the recorded source-local `team up demo` proof produced no `.spur/agents` churn. |
| R4 | MET | `packages/config/src/index.ts:338-380` allocates deterministic append-stable executor suffixes; `packages/config/tests/team-config.test.ts:121-149` covers duplicates, base/suffix collisions, and append stability. |
| R5 | MET | `docs/00_ADR.md:1072-1085` amends ADR-075 in place with exact-one resolution, count/candidate errors, no fan-out, and the unchanged pin. |
| R6 | MET | `packages/app/src/services/agent-instance-store.ts:64-124` validates and resolves the shared vocabulary; `apps/cli/src/commands/message.ts:28-77` and `apps/cli/src/commands/agent.ts:105-150` enforce mutually exclusive identity/role inputs before the existing pinned paths. Exact-one send/wait tests pass. |
| R7 | MET | `docs/04_DESIGN.md:463-483` and both `plugins/sp/skills/spur-cli/references/{message,agent}.md` references document signatures, exact-one semantics, exit codes, and pin behavior. |

#### SECUA

- Security/correctness: selectors are allow-listed, zero/multiple matches fail with explicit counts, and resolution yields one spec id before entering the existing identity-pinned path; there is no broadcast branch.
- Usability/maintainability: usage errors distinguish missing, conflicting, unknown, unmatched, and ambiguous inputs; the shared resolver keeps both CLI call sites consistent.
- Efficiency: the file reader scans the project-local materialized specs once per selector lookup; this is bounded by roster size and adds no polling or network path.

#### Architecture

The three-method `AgentInstanceStore` is the explicit file-to-DB cutover seam required by R2, not speculative layering. The reserved DDL is colocated with migration ownership but absent from `CLI_MIGRATIONS`, so this task introduces no schema/runtime blast radius. No deepening candidate is justified.

#### Verification

`bun run spur-check` passes: 6,540 tests, 0 failures, 99.19% functions, and 99.04% lines.
### References

- Decisions: `docs/00_ADR.md` — ADR-051:456 (public-surface consent, noun-first; amendment
  precedent), ADR-057:642 (inter-agent control plane; identity-pinned occupant semantics),
  ADR-061:708 (superseded role→tier SSOT — lineage only), **ADR-075:1027** (wait/message stay
  identity-pinned — to be amended in place; its "Evidence that would reopen this" clause is R5's
  mandate), ADR-077:1120 (pin beats role), **ADR-078:1138** (role→tier SSOT in the config layer),
  ADR-082:1262 (merged config loads once at the composition root). Highest existing entry is
  ADR-083:1284 → the new entry is **ADR-084**.
- Storage: `~/.config/spur/config.yaml` (global capability catalog), `.spur/config.yaml` (project
  layer; `agent.team` roster currently commented out), `packages/config/src/projects.ts:10-22`
  (`projects.json` schema), `packages/app/src/services/project-registry.ts:156` (advisory lock),
  `packages/domain/src/migrations.ts:26-40` (`inbox_messages` DDL), `:117-145` (`coordination_runs`
  DDL — the DB-convention and control-plane precedent), `:642-720` (migration array; highest id is
  `0025_spur_cli_history_checkpoint_identity_mtime` → reserved name `0026_spur_cli_agent_instances`).
- Instance shape: `~/xprojects/ts-libs/packages/ai-runner/src/agent-spec.ts:11-27` (`AgentSpec`,
  external — not modified), `:37-42` (`validateAgentId` regex),
  `packages/app/src/services/team-service.ts:297` (spec dir), `:576` (`listAgentSpecs`),
  `:749-773` (spec construction — `executor` at :759, `config.role` at :766-768),
  `:792-794` (generated-spec write).
- Id composition: `packages/config/src/index.ts:339-354` (`memberLocalId`), `:522-528` (R4
  neither-role-nor-executor rejection), `:530-538` (duplicate local-id guard), `:540-554` (regex +
  cross-team composed-id guard), `packages/app/src/services/team-service.ts:703-705` (composed-id
  materialization).
- Addressing: `apps/cli/src/commands/message.ts:30` (`--to` requiredOption), `:99-135`
  (`runMessageSend` pin capture at :128-135), `apps/cli/src/commands/agent.ts:105-114` (`agent wait`
  command definition), `:655` (`runAgentWait`),
  `packages/app/src/services/agent-service.ts:2012-2014` (`getOccupant`, agentKind rejected),
  `:1741-1790` (`resolveExecutorSelector` — executor profiles, NOT instances; anti-pattern for R6),
  `packages/app/src/services/team-service.ts:312-313` (`sendMessage`, format-only validation),
  `docs/design/inter-agent-control-plane.md`.
- Selector-namespace disjointness (0537 R4): `packages/config/src/index.ts:556-590`.
- Role vocabulary: `packages/config/src/index.ts:153` (`AGENT_ROLE_NAMES`),
  `plugins/sp/references/roles.md` (parity-gated projection, not a config key).
- Prior decision task: `docs/tasks4/0609_resolve-role-addressed-coordination-for-agent-wait-and-messa.md`
  (ADR-075's author; its reopen-evidence clause is this task's R5 mandate).
- CLI reference for the surfaces (T3 targets): `plugins/sp/skills/spur-cli/references/agent.md`,
  `plugins/sp/skills/spur-cli/references/message.md`.

### History

- 2026-08-27T00:21:52.360Z backlog → wip (system)
- 2026-08-27T00:35:23.904Z wip → testing (system)
- 2026-08-27T00:35:48.873Z testing → done (system)
