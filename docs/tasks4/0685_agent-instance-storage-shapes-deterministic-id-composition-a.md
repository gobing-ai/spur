---
schema_version: 1
name: "Agent instance storage shapes, deterministic id composition, and role-addressed messaging"
status: backlog
template: feature-impl
created_at: 2026-08-26T20:00:46.323Z
updated_at: "2026-08-26T20:03:12.735Z"
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
- **Id composition:** deterministic disambiguation suffix for duplicate-executor members (example
  outcome `team-1-omp-dsv4-flash-volc-23gd`), stable and reproducible — never a per-run random.
- **ADR-075:** reopen with exact-one role/executor addressing on `spur message send` /
  `spur agent wait`, collapsing to the existing `{specId, runId, generation}` pin.

**Verified state on entry (2026-08-26 tree).** Storage taxonomy, all verified:

- `~/.config/spur/config.yaml` — global layer: `agent.roles` (SSOT per ADR-078), `agent.executors`
  (named profiles `name/agent/model/tier`), `agent.default`. Machine-wide capability catalog.
- `.spur/config.yaml` — project layer, merged over the global layer (ADR-082: loaded once at the
  composition root): `agent.team` declarative rosters, executor/role overrides. ADR-078's own text
  keeps project-shaped keys in `.spur/config.yaml`.
- `.spur/agents/<id>.yaml` — per-instance materialized specs. `TeamService` resolves them from
  `join(ctx.cwd, '.spur', 'agents')` (`packages/app/src/services/team-service.ts:297`). **Currently
  git-tracked** (`git ls-files` lists `demo-*.yaml` committed); `spur team up` writes generated
  specs into the same tracked dir (`team-service.ts:793`), so every materialization dirties the tree.
- `~/.config/spur/projects.json` — machine registry, `{name, path, port}` only
  (`packages/config/src/projects.ts:19-22`), `schema_version: 1`, runtime state (which project runs
  on which port), written under an advisory lock with port probing (`project-registry.ts:156`).

Id composition, verified:

- `memberLocalId` = `member.id ?? executor ?? <role>-<n>` (`packages/config/src/index.ts:339-362`).
- A team member materializes to the composed id `${teamId}-${localId}` (`team-service.ts:704-705`).
- Duplicate local ids (e.g. two `executor: omp` members in one team) are a **hard config-load
  error** `Duplicate team member id` (`packages/config/src/index.ts:548-551`) — the operator must
  hand-write an explicit `id:` to disambiguate. There is no member-vs-member duplicate *guard*
  elsewhere; `seenLocal`/`seenComposed` at config load are the only protection.
- Role-only members auto-number `<role>-<n>` (frozen declaration-order index, 0543 R3).

Addressing, verified:

- `message send --to <spec-id>` treats the id verbatim — format-only `validateAgentId`, inbox keyed
  by the `to_id` string with no FK to specs (`team-service.ts:312-316`).
- `--wait` snapshots the `{specId, runId, generation}` pin **before** enqueue (`message.ts:128-136`);
  `getOccupant({specId})` rejects agent-kind lookup (`agent-service.ts:1896`).
- ADR-075 (2026-08-20, task 0609) closed "role addressing on wait/message" with a reasoned **no**
  and listed three concrete reopening conditions; the exact-one/no-fan-out preconditions it records
  are the contract any reopened design must meet.
- `coordination_runs` already persists occupant pins in the DB (`packages/domain/src/migrations.ts:116-130`)
  — the DB is already the home of runtime control-plane identity, which is why the operator chose it
  as the future home of materialized instances.

**Why this task exists.** The agreed direction (instances → DB, deterministic suffixes, role
addressing) is recorded nowhere. Storage is split across three project surfaces with generated and
hand-authored state mixed in a tracked directory; two same-executor members cannot be declared
without a hand-written `id:`; and ADR-075 forces `spur message` to address exact composed ids
(`team-1-omp-dsv4-flash-volc-23gd` is not human-typeable). This task lands the decisions with full
detail and freezes the instance shapes so a later DB-migration/UI task has a stable contract.

**Known risks.**

- Role addressing without exact-one resolution degenerates into broadcast, which ADR-057 rules out
  and D6 scope excludes. Any selector must resolve to exactly one instance and collapse to the
  existing pin, or it must not ship.
- Deterministic suffix ids must NOT shift across roster edits — 0543's inbox-addressing stability
  depends on it. A per-materialization random suffix is explicitly rejected.
- Freezing shapes without the migration would leave the future DB/UI task guessing the contract;
  conversely, performing the migration here would overrun scope. This task fixes the shapes only.

### Requirements
> **Outcome: the three operator rulings land as recorded decisions + working code where the DB is
> not required, and the materialized-instance DB shapes are frozen for a later migration task.**

- [ ] R1. **Storage architecture recorded as a dated ADR entry.** The capability catalog
  (`agent.roles`, `agent.executors`, `agent.default`) stays in the global `~/.config/spur/config.yaml`
  — ADR-078 SSOT unchanged, no relocation. The declarative roster stays project-local: extend the
  existing `agent.team` block in `.spur/config.yaml` (riding the ADR-082 merged loader); introduce a
  separate `.spur/agents.yaml` only if the roster outgrows the config file — and even then it is
  declarative-only, layered, and project-local, never a second loader. Materialized instances are
  owned by the DB, not by committed spec files. Write a new dated ADR entry (next free slot; assign
  at implementation) recording this taxonomy and why `~/.config/spur/projects.json` was **rejected**
  as the instance home: layer inversion (instances are project-shaped; the A4/A5 contract is
  global-defaults + project-override merged at the composition root), runtime-state-vs-config
  conflation (projects.json is `{name,path,port}` state under an advisory lock), and portability (a
  clone must carry its roster without a machine-global edit).

- [ ] R2. **Materialized-instance DB shapes frozen; migration out of scope.** Define (a) the table
  DDL for materialized agent instances, aligned with `packages/domain/src/migrations.ts` conventions
  (four-digit numeric prefix, `CREATE TABLE IF NOT EXISTS`, explicit indexes, `spur_cli` marker
  comment style), and (b) the TS types plus a **resolution interface** (`bySpecId`, `byRole`,
  `byExecutor`) so a future DB task and the UI consume a stable contract. The migration itself, the
  DB-backed writer/reader, and the instance→DB cutover are **explicitly out of scope** — this task
  only fixes the shapes (types + DDL draft in the design doc, or type definitions in
  `packages/domain` that compile).

- [ ] R3. **Generated instance specs leave the tracked tree.** `.spur/agents/*.yaml` written by
  `spur team up` (tag `spur:generated`) become gitignored; hand-authored specs (`spur agent add`)
  stay tracked. After this task, a `spur team up` run leaves `git status` clean of generated spec
  churn, and the committed tree carries only declarative roster intent (`.spur/config.yaml`
  `agent.team`) plus any hand-authored specs.

- [ ] R4. **Deterministic suffix id composition.** Enhance `memberLocalId`
  (`packages/config/src/index.ts:339`) so derived collisions disambiguate deterministically instead
  of hard-failing `Duplicate team member id`. An explicit duplicate `id:` **stays** a hard
  config-load error (operator mistake, not a collision). Properties the suffix must satisfy:
  deterministic (same roster → same ids, reproducible), stable across roster reorder/additions (an
  existing member's id never shifts), collision-free, and valid under `^[a-z][a-z0-9_-]{1,63}$`
  with the composed `teamId-...` ≤ 64 chars. Proposed algorithm: a short stable hash (4–6 hex) of a
  member identity key (`teamId:executor:purpose`), with a declaration-index tie-break only among
  members whose identity key is identical; **do not bake free-form model strings into the id** —
  the executor profile name is the stable binding, the model is a config value that must not churn
  addressing when re-pinned. Example outcome: `team-1-omp-dsv4-flash-volc-23gd`.

- [ ] R5. **ADR-075 reopened: exact-one role/executor selector.** Amend ADR-075's "no role
  addressing" clause (or supersede it with a new dated ADR entry) with an accepted decision that
  allows a selector resolving exactly one materialized instance, collapsing to the existing
  `{specId, runId, generation}` pin — ADR-057 stays authoritative. Resolution rules: zero matches →
  hard error naming the selector and `count=0`; more than one → hard error naming the selector,
  `count=N`, and the candidate spec ids; never first-match, never a silent pick. No broadcast or
  fan-out (D6 R3/R4). The reopening evidence-gate ADR-075 itself names is met: disambiguated
  instance ids make the concrete composed id effectively unknowable/untrypeable, so addressing "the
  coder" or "the omp instance" is the natural caller. Record ADR-051 operator consent for the
  public-surface change (granted in this discussion, 2026-08-26).

- [ ] R6. **Selector surface implemented on `message send` / `agent wait`.** Add `--role <name>` to
  `message send` (mutually exclusive with `--to <id>`; both supplied → exit 2 usage error) and to
  `agent wait` (mutually exclusive with the positional `<specId>`). Selector vocabulary: Layer-1
  roles from `AGENT_ROLE_NAMES` (scribe | coder | reviewer | planner) plus executor names from
  `agent.executors` — no second list. Resolution reads materialized instances through the R2
  interface (today the spec files; the interface is what the future DB swap re-points, so no
  call-site change then). The resolved instance's pin is snapshotted before wait/send exactly as
  the identity path does (`message.ts:128-136`). Tests must cover zero-match, multi-match,
  exact-one→pin, unknown role, mutual-exclusion conflict, and the absence of any fan-out path.

- [ ] R7. **T3 same-commit surface doc.** Update `docs/04_DESIGN.md` (message/agent surface
  sections) and `plugins/sp/skills/spur-cli/references/{message,agent}.md` for `--role` — the
  mutual-exclusion rule, the exact-one resolution rule, and the error codes. Same commit as R6.

**Non-goals (explicitly out of scope this task):** the materialized-instance **DB migration** and
the instance→DB cutover (R2 freezes shapes only; a separate future task owns the migration and the
UI it enables); building or enhancing any UI; broadcast or fan-out messaging (a selector reaches
exactly one recipient); relocating the role SSOT or the executor catalog (ADR-078 / ADR-077 hold);
changing `agent.run`'s existing role selection; a new `spur` noun or verb (`--role` is a flag on
existing verbs, ADR-051 noun-first).
### Acceptance Criteria

```gherkin
Feature: Agent instance storage architecture, deterministic id composition, and exact-one role addressing

  Scenario: R1/R2 — Storage taxonomy decided and instance shapes frozen
    Given the capability catalog lives in ~/.config/spur/config.yaml and the declarative roster in .spur/config.yaml
    When the storage decision is recorded and the materialized-instance shapes are defined
    Then a dated ADR entry records the taxonomy and the projects.json rejection rationale
    And the instance table DDL, the TS types, and the bySpecId/byRole/byExecutor resolution interface are frozen in the design doc (or as compiling types in packages/domain)
    And no DB migration and no instance→DB cutover are performed by this task

  Scenario: R3 — Generated instance specs leave the tracked tree
    Given spur team up writes .spur/agents/<id>.yaml tagged spur:generated
    When the gitignore split lands
    Then a fresh team up leaves git status clean of generated spec churn
    And hand-authored specs remain tracked

  Scenario: R4 — Duplicate-executor members disambiguate deterministically
    Given a team declares two members with the same executor and no explicit id
    When the roster is materialized
    Then each member receives a distinct deterministic id composed from the executor name plus a stable suffix
    And reordering the roster or adding another member does not shift existing derived ids
    And an explicit duplicate member id remains a hard config-load error
    And composed ids stay within ^[a-z][a-z0-9_-]{1,63}$ and ≤ 64 chars

  Scenario: R5/R6 — Role-addressed send/wait resolve exact-one and collapse to the pin
    Given a materialized instance declares a Layer-1 role
    When spur message send --role <role> or spur agent wait --role <role> is invoked
    Then the role resolves to exactly one instance whose {specId, runId, generation} pin is snapshotted before wait/send
    And zero matches or more than one match are hard errors naming the selector, the count, and the candidate spec ids
    And --role is mutually exclusive with --to / the positional spec id (exit 2 when both are supplied)
    And no broadcast or fan-out path exists

  Scenario: R7 — T3 surface doc ships with the surface
    Given the --role surface is added
    When docs/04_DESIGN.md and the spur-cli reference files are updated
    Then the surface change and its docs land in the same commit
```

### Q&A

- **Why not `~/.config/spur/projects.json` for instances?** Recorded rejection in R1. Three
  reasons: (1) layer inversion — ADR-078/082's contract is global-defaults + project-override merged
  at the composition root, and instances are project-shaped (their `workspace` is a project path);
  (2) projects.json is runtime state (`{name,path,port}`, `schema_version: 1`, advisory-locked,
  port-probing) not a config store — mixing declarative intent into it conflates categories the repo
  otherwise keeps separate; (3) portability — a clone must carry its roster without a machine-global
  edit.
- **Why the DB for materialized instances instead of gitignored files?** Operator preference: the DB
  enables the future UI (roster tabs, per-agent messages, activity) and already hosts the
  control-plane identity (`coordination_runs`). Files were rejected for the *materialized* layer
  because generated specs churn the tracked tree and mix with hand-authored ones. This task only
  freezes the shapes; the migration is a separate task.
- **Deterministic suffix vs random:** a per-materialization random suffix re-addresses every member
  on every `spur team up`, breaking the 0543 inbox-stability property. The suffix must be
  deterministic (hash of a stable member key) or persisted-once-and-reused; deterministic is
  preferred — idempotent, zero new state.
- **Does `--role` re-open the ADR-075 race?** No. The selector resolves exactly one instance, then
  the existing `{specId, runId, generation}` pin is written before wait/send; re-resolution on
  reconnect is banned, exactly as ADR-075/057 specified for any future role binding.
- **Executor vs role multiplicity:** both can be multi (two instances from one executor; two members
  share a role). The exact-one rule is uniform: zero/multi are hard errors naming the selector, the
  count, and the candidates. No silent first-match.
- **Why a flag, not `--to <role>`?** ADR-051's noun-first rule and ADR-075's own design: `--role`
  on existing verbs, mutually exclusive with the concrete addressee. A single `--to` that silently
  accepted either an id or a role would blur the namespace the 0537 R4 disjointness guard keeps
  separate.
- **What if the roster outgrows `.spur/config.yaml`?** Then a dedicated `.spur/agents.yaml`
  (declarative-only, layered, project-local) is acceptable — but the default is to extend
  `agent.team` in the existing config file and reuse the ADR-082 merged loader rather than build a
  second loader.
- **Does R4 change existing role-only numbering?** No. `<role>-<n>` stays; the deterministic suffix
  applies to *executor-derived* collisions, which today are undeclarable. Explicit duplicate `id:`
  stays an error.
- **Deferred with owner:** the DB migration + UI (future task); the role→tier SSOT and executor
  catalog (ADR-078 / ADR-077, untouched); the agent.default value domain (0542, untouched).

### Design

**WHAT.** Land the three operator rulings: (1) record the storage taxonomy and freeze the
materialized-instance DB shapes, (2) make composed ids deterministic-disambiguating for
duplicate-executor members, (3) reopen ADR-075 with exact-one role/executor addressing on
`message send` / `agent wait` — all as code where the DB is not required, plus the
ADR/consent/doc records.

**WHY.** The direction is agreed but unrecorded. The current storage mixes generated and
hand-authored state in a tracked directory; duplicate-executor members are undeclarable without a
hand-written `id:`; and ADR-075 forces `spur message` to address untypeable composed ids. Freezing
the shapes now makes the future DB/UI task a mechanical cutover instead of a contract-guessing
exercise.

**WHERE (frozen file targets).**

- `packages/config/src/index.ts:339` — `memberLocalId` (R4 deterministic suffix).
- `packages/config/src/index.ts:548-551` — duplicate-local-id guard (explicit dup stays an error;
  derived dup now suffixes instead of failing).
- `packages/app/src/services/team-service.ts:701-705` — composed-id materialization (consumes the
  enhanced `memberLocalId`; verify no other change needed).
- `apps/cli/src/commands/message.ts:98-136` — `runMessageSend` (R6 `--role` flag, mutual exclusion,
  resolution before pin snapshot).
- `apps/cli/src/commands/agent.ts:96,639-734` — `agent wait` (R6 `--role` flag).
- `packages/app/src/services/agent-service.ts:1895` — `getOccupant` (resolution helper reads
  instances via the R2 interface; the `agentKind` lookup rejection stays unchanged).
- `packages/domain/src/migrations.ts` — instance DDL **draft only** (R2 shapes; do NOT wire the
  migration or register a prefix that claims it is live).
- `docs/00_ADR.md` — new dated ADR entry (storage taxonomy, R1) + ADR-075 amendment record (role
  addressing, R5).
- `.gitignore` — generated-spec exclusion (R3).
- `docs/04_DESIGN.md` + `plugins/sp/skills/spur-cli/references/{message,agent}.md` — T3 surface doc
  (R7).

**Frozen names — new public surface.** `--role <name>` on the existing `message send` and
`agent wait` verbs — **no new noun, no new verb** (ADR-051 noun-first). Mutually exclusive with
`--to <id>` / the positional `<specId>`; both supplied → exit 2 usage error. Selector vocabulary =
`AGENT_ROLE_NAMES` (scribe | coder | reviewer | planner) ∪ configured executor names. No second role
list.

**Algorithm — selector resolution (R6).**

1. Resolve `--role` / the selector against materialized instances in the current project scope via
   the R2 resolution interface (today = spec files; future = DB).
2. **Zero matches → error** naming the selector and `count=0`. **More than one → error** naming the
   selector, `count=N`, and the candidate spec ids. Never first-match, never a silent pick.
3. On exactly one, snapshot the same `{ specId, runId, generation }` pin the identity path writes
   (`message.ts:128-136`), **before** the wait or send proceeds.
4. Everything downstream is unchanged — the pin, not the selector, is what the wait/send binds to;
   a reconnect resumes against the pin.

**Algorithm — deterministic suffix (R4).**

- Explicit `id:` → unchanged; duplicate explicit ids remain a hard error.
- Executor-derived (`memberLocalId` = executor): if unique, unchanged; on collision, append
  `-<suffix>`.
- Role-only (`<role>-<n>`): keep the existing frozen numbered scheme.
- Suffix derivation: short stable hash (4–6 hex) of a member identity key `teamId:executor:purpose`,
  with a declaration-index tie-break only among members whose identity key is identical.
  Deterministic, idempotent, reorder-stable; never a per-run random. Model strings never enter the
  id — the executor profile name is the stable binding.

**R2 instance shapes (contract for the future DB task / UI).** Draft DDL follows the
`migrations.ts` conventions (numeric prefix `00NN_`, `CREATE TABLE IF NOT EXISTS`, explicit indexes,
`_spur_cli_`-style marker in the embedded schema). The shape must carry, at minimum: `spec_id`
(PK, the composed id), `team_id` (nullable), `member_key` (stable member identity), `executor`
(profile name), `role` (nullable Layer-1 role), `workspace`, `status` (stopped|running|exited|
errored), `pid` (nullable), `tags` (JSON), `config` (JSON), `created_at` / `updated_at`. The
resolution interface (`bySpecId`, `byRole`, `byExecutor`) is the seam the current file-based reader
and the future DB reader both satisfy — R6 and the future UI consume the interface, never the store
directly. The migration, writer/reader, and cutover are NOT implemented by this task.

**Anti-patterns (do not implement).**

- Broadcast or fan-out; a selector reaches exactly one recipient.
- First-match / "pick the newest" resolution. Ambiguity is an error, not a heuristic.
- Per-materialization random suffixes (breaks 0543 inbox stability).
- Baking free-form model strings into ids (re-pinning the model would churn addressing).
- The DB migration, instance→DB cutover, or UI work (out of scope by operator ruling).
- A second role list, or relocating the role/executor catalog (ADR-078 / ADR-077 hold).
- A new `spur` noun or verb.
- Replacing ADR-057's identity pin — the selector sits above the pin, never instead of it.

**Cross-task contract.** No `dependencies[]`. Consumes as given: ADR-057 (occupant pin),
ADR-075 (reopening evidence + exact-one preconditions), ADR-077 (pin beats role), ADR-078
(role/executor SSOT in config), ADR-082 (merged config at composition root), 0537 R4
(selector-namespace disjointness), 0543 (id stability). Leaves for the future DB task: the
migration, the DB-backed instance reader/writer, and the UI. The R2 resolution interface is the
hand-off contract.

### Plan

1. **Record decisions (R1, R5).** Draft the new dated ADR entry (storage taxonomy + the
   projects.json rejection rationale) and the ADR-075 amendment record (exact-one selector, consent
   record 2026-08-26). Verify: both entries exist and cite the verified-state facts from Background.
2. **Freeze instance shapes (R2).** Define the instance table DDL (aligned with `migrations.ts`
   conventions), the TS types, and the `bySpecId/byRole/byExecutor` resolution interface in the
   design doc (and/or as compiling types in `packages/domain`). Verify: no migration wired; any
   types added to code typecheck.
3. **Gitignore split (R3).** Ignore generated (`spur:generated`) specs; confirm hand-authored specs
   stay tracked. Verify: `spur team up` leaves `git status` clean of generated spec churn.
4. **Deterministic suffix (R4).** Enhance `memberLocalId`; keep the explicit-dup error; add the
   suffix rule. Verify: unit tests for duplicate-executor members, roster-reorder stability,
   identical-member tie-break, and format bounds (≤ 64 chars, regex).
5. **Selector surface (R6).** Add `--role` to `message send` / `agent wait` with mutual exclusion
   and exact-one resolution against the R2 interface. Verify: tests for zero-match, multi-match,
   exact-one→pin, unknown role, mutual-exclusion conflict, and no-fan-out; targeted tests green.
6. **T3 surface doc (R7).** Update `docs/04_DESIGN.md` and the spur-cli reference files in the same
   commit as step 5.
7. **Gates.** `bun run lint`, targeted tests, `bun run spur-check`, then `bun run corpus-check`
   (a public surface changed).

**Done when** the storage taxonomy is recorded, the instance shapes are frozen, generated specs are
out of the tracked tree, duplicate-executor members materialize with deterministic stable ids,
`--role` resolves exact-one and collapses to the pin on both verbs, and the T3 doc ships with the
surface — with no DB migration and no UI work performed.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Decisions: `docs/00_ADR.md` — ADR-051 (public-surface consent, noun-first), ADR-057 (inter-agent
  control plane; identity-pinned occupant semantics), **ADR-075** (wait/message stay identity-pinned
  — to be amended), ADR-077 (pin beats role), **ADR-078** (role→tier SSOT in the config layer),
  ADR-082 (merged config loads once at the composition root).
- Storage: `~/.config/spur/config.yaml` (global capability catalog), `.spur/config.yaml` (project
  layer, `agent.team` roster), `packages/config/src/projects.ts:19-22` (`projects.json` schema),
  `packages/app/src/services/project-registry.ts:156` (advisory lock), `packages/domain/src/migrations.ts`
  (`inbox_messages` DDL :25-38, `coordination_runs` DDL :116-130 — the DB-convention and
  control-plane precedent).
- Id composition: `packages/config/src/index.ts:339-362` (`memberLocalId`), `:548-551` (duplicate
  local-id guard), `packages/app/src/services/team-service.ts:701-705` (composed-id materialization).
- Addressing: `apps/cli/src/commands/message.ts:98-136` (`runMessageSend` pin capture),
  `apps/cli/src/commands/agent.ts:96,639-734` (`agent wait`), `packages/app/src/services/agent-service.ts:1895`
  (`getOccupant`), `docs/design/inter-agent-control-plane.md`.
- Prior decision task: `docs/tasks4/0609_resolve-role-addressed-coordination-for-agent-wait-and-messa.md`
  (ADR-075's author; its reopen-evidence clause is this task's R5 mandate).
- Selector-namespace disjointness (0537 R4): `packages/config/src/index.ts:484-595`.
- CLI reference for the surfaces: `plugins/sp/skills/spur-cli/references/agent.md`,
  `plugins/sp/skills/spur-cli/references/message.md`.

### History
