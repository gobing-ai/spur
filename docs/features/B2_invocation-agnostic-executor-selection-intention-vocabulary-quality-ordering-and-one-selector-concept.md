---
schema_version: 1
id: "B2"
name: "Invocation-agnostic executor selection: intention vocabulary, quality ordering, and one selector concept"
status: done
priority: P2
tags: ["wayfinder-map"]
created_at: "2026-07-27T01:24:47.771Z"
updated_at: "2026-08-14T04:38:38.182Z"
---

# B2: Invocation-agnostic executor selection: intention vocabulary, quality ordering, and one selector concept

## Goal
**Destination.** Executor selection in Spur is declarative and config-owned, driven by a stable
*intention* vocabulary that resolves identically from every invocation path — slash command, bare
CLI, subagent, workflow step, or team spec — with one coherent user-facing selector concept.

### What reaching the end looks like

- A task's **intention** (what kind of work this is) is carried explicitly by whatever dispatches it,
  not inferred from the shape of a prompt string. `/sp:dev-verify`, `spur agent run "…"`, and a
  subagent doing verification all resolve to the same intention.
- The **intention → tier** matrix lives where the operator can edit it. Plugin `sp` knows intentions;
  it knows nothing about executors, models, or vendors. Every executor is declared by the operator in
  `.spur/config.yaml`.
- Executors are ordered by **quality**, not just cost, so two executors that both clear a capability
  floor are distinguishable and the better one is chosen deliberately rather than by YAML array order.
- One selector concept. `--agent` reaches one resolution funnel for all three input kinds it accepts
  — `auto`, an executor name, or a team spec id — and a spec **carries** its executor rather than
  being flattened to a bare binary.
- Nothing regresses for existing users: current `.spur/config.yaml` files and `--agent <binary>`
  invocations keep working through a recorded deprecation path.

### Where this stands (2026-08-13 — map retargeted to shippable)

**The decision half of this map is closed.** All six charting tickets resolved: 0343 (quality
ordering), 0344 (intention vocabulary + four dispatch paths — the contract), 0345 (merged into
0344), 0346 (selector namespace, shipped), 0347 (compatibility inventory), 0348 (registry fate).
0344 closes with *"Implementation decomposed separately once the wayfinder map clears; this section
is the contract, not the code."*

**None of the contract shipped.** Re-verified against the working tree 2026-08-13 — see
`### Verified terrain (2026-08-13)`. `plugins/sp/references/` does not exist, `extractPhase` is still
live, `spur agent run` has no `--intention` flag, and no workflow YAML declares one.

Meanwhile feature **G4** (inter-agent control plane) shipped on top of the un-migrated substrate and
introduced a third meaning for `--agent` (a team spec id under `--drain`) that silently discards the
executor's model and tier binding. That defect is now in scope here.

This map therefore stops charting and starts shipping: the remaining tickets are implementation, and
the map closes only on a clean `/sp:dev-verifyall --feature B2` reporting **Shippable: PASS**.
## Scope
- In:
    - The intention vocabulary: what the values are, who defines them, how a dispatcher carries one.
    - Executor quality ordering in `.spur/config.yaml` (`agent.executors[]`) — schema and tie-break rule.
    - The fate of `REGISTERED_CANONICAL_STAGES` and `extractPhase` prompt-regex phase detection.
    - Unifying the `--agent` selector namespace with `agent.executors` so both reach the same names.
    - The `agent:` config section shape, plus the migration and deprecation path for existing files.
    - An ADR amending or superseding ADR-033 once the mechanism is settled.
    - **Implementing the role model** (retargeted 2026-08-13): the Layer-1 role reference file, the
      `--agent <role>` selector, and the command/workflow migration that declares it.
    - **The public CLI surface changes the role model requires** (ADR-051 consent given 2026-08-13):
      `--agent`'s accepted values, the new `--spec` flag for occupant addressing, and redefining
      `agent.default` as the default role.
    - **Reconciling G4's team specs with the executor roster** — a spec carries its executor (and its
      role), rather than being flattened to a bare coding-agent kind.
    - **The transition-shim marker and its two-sided manifest gate**, so every compatibility path
      added here is countable and has a checkable removal condition.
    - **Repairing the authority and config surfaces the role model invalidates** — ADR-033,
      `docs/04_DESIGN.md`, `AGENTS.md`, `config/config.example.yaml`, and
      `apps/cli/schemas/spur-config.schema.json`. Done tasks (0343/0344/0348) get superseding notes,
      never rewrites: the record of what was decided when is the corpus's value.
- Out:
    - Re-adding `agent.default-by-phase` (ruled out by the operator; retired 2026-07-26).
    - `@gobing-ai/ts-ai-runner` binary detection (`AgentDetector` / `DoctorRunner`).
    - Selecting models or vendors for the operator's roster.
    - Renaming `--agent` to `--executor`. Moot after 2026-08-13 — `--agent` is the role selector.
    - Declaring roles on executors. Ruled out 2026-08-13 — executors declare `tier` only.
    - Removing executor-name pinning. It is a safety property, not compatibility
      (`config/workflows/task-pipeline.yaml:57-59`), and stays permanently.
    - The broad `plugins/sp` + `.spur/workflows` defect audit — sibling feature I3, follow-up pass.
    - **Batch 2:** redefining Teams around roles, and role attribution over the event pub/sub plane.
## Acceptance Criteria

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0343 | Decide executor quality ordering: capable sub-tiers vs orthogonal tier+rank | done |
| 0344 | Decide who emits intention: skill declaration, inferred judge, or hybrid | done |
| 0345 | Decide where the intention vocabulary is defined, owned, and versioned | cancelled |
| 0346 | Unify the --agent selector namespace with agent.executors | done |
| 0347 | Inventory the backward-compatibility surface before any agent-config redesign | done |
| 0348 | Decide the fate of REGISTERED_CANONICAL_STAGES and prompt-regex phase detection | done |
| 0535 | Create plugins/sp/references/roles.md as the Layer-1 role-to-tier table | done |
| 0536 | Make --agent take a role and retire extractPhase | done |
| 0537 | Keep the executor binding through team spec materialization and drain | done |
| 0538 | Declare role across sp commands, workflow steps, and team members | done |
| 0541 | Establish the transition-shim marker and two-sided manifest gate | done |
| 0542 | Add --spec for occupant addressing and redefine agent.default as a role | done |
<!-- END AUTO-GENERATED -->

## Notes
### Verified terrain (2026-07-26)

Every claim below was checked against the working tree this session — re-verify before relying on a
line anchor, but the findings are evidence-backed, not recalled.

- **Stage detection is a prompt regex.** `extractPhase` (`packages/app/src/services/agent-service.ts`)
  matches only `/sp:`, `/skill:sp-`, `$sp-`, and the `rd3` equivalents. A bare
  `spur agent run "implement X"`, a subagent, or a workflow step produces **no** phase, so stage
  routing never engages and resolution falls through to `agent.default`. This is the operator's
  central objection and it is correct.
- **Registry coverage is partial even on the slash path.** `REGISTERED_CANONICAL_STAGES`
  (`packages/domain/src/stage-registry/schema.ts:655`) holds 10 records; **21** `sp` commands have no
  stage record (`dev-gitmsg`, `dev-runall`, `dev-fixall`, `dev-verifyall`, `dev-wrapall`, `dev-idea`,
  `dev-next`, `dev-arch`, `dev-debug`, `dev-simplify`, `dev-handover`, `dev-daily`, `dev-reverse`,
  `dev-parallel`, `dev-refresh`, and all `rule-*` / `workflow-*` / `spur-init`).
- **The registry is hardcoded with no config door.** It is a compiled `StageRecord[]`; there is no
  `stages.yaml`, no loader, and no stage key in `spurConfigSchema`. `validator.ts` validates the
  hardcoded array, not operator input.
- **`--agent` / executor namespace unified (0346, shipped).** Explicit `--agent <name>` reuses
  `resolveExecutorSelector` (executor-first-then-binary, source `explicit`) at
  `packages/app/src/services/agent-service.ts:615-624`. `--agent omp-zai` now resolves to the
  executor profile's agent + model; bare binary names still work when no executor matches.
  Collision precedence: executor wins. Documented in `docs/04_DESIGN.md`. Flag rename to
  `--executor` remains a follow-up (R4).
- **Tier is a 3-bucket cost axis with array-order tie-breaking.** `TIER_RANK` = cheap 1 / standard 2 /
  capable 3; `isTierEligible(candidate, min)` is `rank(candidate) >= rank(min)`; eligible executors
  sort by tier ascending and ties resolve by position in the `executors` array.
- **Undeclared tiers were being inferred by regex.** Before this session 0/10 executors declared
  `tier`, so `getExecutorTier` guessed from `name + model + agent`: `deepseek-v4-pro` matched
  `\bpro\b` and became the *only* `capable` executor, while `claude`/`codex`/`grok` fell to `standard`
  and were excluded from every capable-tier stage. All executors now declare `tier` explicitly.

### Verified terrain (2026-08-13)

Re-checked against the working tree when the map was retargeted to shippable. Line anchors are from
that session — re-verify before relying on one.

- **0344's contract is 0% implemented.** `plugins/sp/references/` does not exist, so there is no
  `intentions.md`. `extractPhase(prompt)` is still live and still called
  (`packages/app/src/services/agent-service.ts:1018`, defined `:1511`). `spur agent run` exposes
  `--agent --continue --model --mode --cwd --json --drain` and **no** `--intention`
  (`apps/cli/src/commands/agent.ts:52-58`). No `config/workflows/*.yaml` declares an `intention:`.
- **Layer-1 tier facts are hand-restated in plugin prose, with nothing keeping them in sync** with
  `packages/domain/src/stage-registry/schema.ts`: `plugins/sp/skills/spur-dev/references/dev-operations.md:256`
  ("Stage `plan` floors at `capable-2` (fallback `capable-3`)"), `plugins/sp/commands/dev-refine.md:37`
  ("Stage floor: `standard` (fallback `capable-2`)"), and the size→tier rule at
  `plugins/sp/skills/spur-dev/references/execution-workflow.md:301-310`. This is the workaround the
  operator remembers; it is Layer 1 leaking into prose because Layer 1 has no file to live in.
- **G4 flattens a team spec to a bare binary, losing model and tier — two lossy hops.**
  1. `TeamService` materialization (`packages/app/src/services/team-service.ts:674-680`) calls
     `resolveExecutor(member.executor, agentConfig)` and then writes `type: resolved.agent`,
     discarding `resolved.model` and the executor **name**. On-disk proof: `.spur/config.yaml` declares
     `- executor: codex-sol` (tier `capable-3`, model `gpt-5.6-sol`) and `.spur/agents/demo-codex.yaml`
     stores only `type: codex`.
  2. `drainIntoPrompt` (`apps/cli/src/commands/agent.ts:357-383`) maps `--agent <specId>` →
     `--agent spec.type`, i.e. the bare kind, while stashing `spec-id` for the occupant pin.

  Net effect: the operator configures a `capable-3` executor on a specific model, and the process
  that runs is bare `codex` on its default model, reading as tier `standard` because nothing
  declared otherwise. No error, no warning.
- **`--agent` means three things, disambiguated by an unrelated flag.** Without `--drain` it is an
  executor name or a binary name (`resolveExecutor`, executor-first). With `--drain` it is a team
  spec id. Nothing validates that a spec id and an executor name do not collide.

### The two-layer contract (operator ruling, 2026-07-26)

The shape that settles "where does the mapping live" and "how does `sp` stay executor-agnostic":

| Layer | Owns | Home | Knows about |
| --- | --- | --- | --- |
| 1 | intention → tier | shared reference file under `plugins/sp`, included by skills that need it | intentions and tier names only — never an executor, model, or vendor |
| 2 | tier → executor | operator's `.spur/config.yaml` (`agent.executors[]`) | the operator's actual roster |

`sp` therefore ships the intention vocabulary and its tier mapping; the operator owns every executor.
Neither layer needs to know the other's contents, which is exactly the separation the operator asked
for.

**Why a shared reference file and not per-skill declaration.** A per-skill declaration was the
earlier proposal and it does not survive contact with the spine: `plugins/sp/skills/spur-dev` carries
*multiple* intentions (refine, plan, implement, verify, wrap all flow through it), so a single
skill-level intention is unrepresentable. A reference file included by the skills that need it also
matches the existing `references/*.md` convention already used across the plugin.

**What "LLM-as-Judge" means here (clarified).** Not a separate judge call per dispatch. The executing
agent reads the intention→tier table from the reference file and picks which intention applies to the
operation it is currently performing; the tier→executor step is then a deterministic config lookup.
The only judgment is intention classification, which is bounded by a fixed vocabulary.

### Where a role may be declared (operator ruling, 2026-08-13)

An extension of the two-layer contract, settled when G4's spec flattening surfaced. A role/intention
is declared on the thing being **addressed** or on the **invocation** — never on the executor.

| Addressed thing | Carries | Rationale |
| --- | --- | --- |
| Invocation (`/sp:dev-*`, `spur agent run`, workflow step) | `intention` | 0344 D3's four dispatch paths |
| Team spec (`agent.team[].members[]`) | `intention` + `executor` | a team member has a job and a tool |
| Executor (`agent.executors[]`) | `tier` only — **never** a role | tier already *is* the capability claim |

**Why not roles on executors** (the operator's first draft, evaluated and declined with reasons):

1. **N×M config.** Every executor would enumerate every role it can serve — 10 executors × 8
   intentions today, re-decided on every roster change. Role-on-spec is one role per addressable
   thing.
2. **It re-couples Layer 2 to Layer 1.** The roster would have to know sp's intention vocabulary,
   which is precisely the separation the 2026-07-26 ruling established.
3. **`tier` already answers it.** "Can this executor plan?" is `tier >= capable-2`, declared once.
   A `roles:` list either duplicates that or contradicts it — and there is no tiebreak rule for the
   contradiction. New failure mode, no gain.
4. **Specs must stay addressable.** G4 exists so one agent can durably address `reviewer`. Removing
   spec ids from `--agent` only moves the ambiguity to a new flag.
5. **The config already exists.** `agent.team[].members[].executor` is already declared and correct;
   the bug is that materialization drops it.

### The role vocabulary (operator ruling, 2026-08-13, amends the above)

The role/intention layer is **four roles, one per tier**. 0344 proposed eight intentions; checked
against the stage registry those eight carry only four distinct floors (`plan` capable-2 at
schema.ts:757; `verify` and `dogfood` capable-1 at :827/:896; `changelog` cheap at :938; all others
standard), so four of the eight names carried no routing consequence.

| Role | Tier | Folds |
| --- | --- | --- |
| `scribe` | cheap | gitmsg, handover, daily, changelog, refresh, rule-add, rule-refine, workflow-add, workflow-refine, spur-init |
| `coder` | standard | run, unit, debug, simplify, fixall, reverse, wrap, wrapall |
| `reviewer` | capable-1 | verify, verifyall, review, dogfood, rule-scan |
| `planner` | capable-2 | plan, refine, brainstorm, idea, runall, parallel, next, arch |

**The one-role-per-tier property is the invariant**, not a coincidence: two roles sharing a tier
resolve to the same eligible executor set and are one role with two names. A proposed fifth role must
bring a fifth tier.

Evaluated and folded: **`tester` → `coder`** (stage `test` :809 and stage `implement` :780 are both
`standard`; the test-writer-vs-implementer difference is a *prompting* difference carried by the
skill, not a selection difference). Renamed: **`utility` → `scribe`** (the other three name people,
and the work is dominated by writing derived text). Placed deliberately: **`rule-scan` under
`reviewer`**, not `scribe` — it analyses for anti-patterns rather than transcribing.

Three of the four names already existed in this plugin as the `sp:super-planner` / `sp:super-coder` /
`sp:super-reviewer` subagent roster. The vocabulary was not invented; it was the naming the project
had already converged on.

**`--agent` after the ruling** — four input kinds, one resolution funnel:

| Form | Status |
| --- | --- |
| `<role>` | the primary vocabulary |
| `<executor-name>` | **permanent** escape hatch — pin beats policy |
| `<binary-name>` | legacy → registered transition shim, removed |
| `<spec-id>` | moves to `--spec` → registered transition shim, removed from `--agent` |

The executor pin is **not** compatibility. `config/workflows/task-pipeline.yaml:57-59` pins
deliberately "so a broken/misconfigured agent on the box can't silently capture the run", and
`:65` / `:158-160` let `agent` and `implementAgent` diverge with the precheck probing both. It stays.

`--intention` is **not** added. The original 0344 D3 plan introduced it; the role ruling makes it
unnecessary because `--agent` becomes the role selector. Net deletion from the surface.

**`agent.default` is redefined**, not dropped: its value domain changes from executor name to role
name (recommended `coder`), which makes every existing config's value wrong and therefore requires a
loud three-way migration rather than a silent reinterpretation.

The residual ambiguity the operator correctly identified — one flag accepting several namespaces —
is closed deterministically by a **collision guard** at config load requiring role names, executor
names, and spec ids to be pairwise disjoint, not by splitting `--agent` per concept.

**ADR-051 consent.** Changing `--agent`'s accepted values, adding `--spec`, and redefining
`agent.default` are public CLI surface changes. The operator authorized them in this ruling.

### Standing feedback on the operator's proposal

Recorded so later sessions do not relitigate.

1. **Quality ordering — settled, see Decisions so far.** The counter-proposal (orthogonal `tier` +
   `rank`) was raised and declined with reason. Do not reopen.
2. **`--agent`/executor unification — shipped in 0346.** Explicit `--agent` now shares
   `resolveExecutorSelector` with `agent.default` (executor-first, collision: executor wins).
   Naming follow-up (`--executor` vs `--agent`) remains open for a later ergonomics pass; 0346 kept
   the flag name and only unified the namespace (R4).
3. **Roles on executors — raised 2026-08-13 and declined with reasons.** See
   `### Where a role may be declared`. The operator's underlying goal (one selector concept, roles
   made explicit) is met by role-on-spec plus the collision guard. Do not reopen without a concrete
   case where two executors at the same tier must be role-distinguished.

### Skills every session should consult

`sp:sys-architecture` (this map's decisions are architecture calls and several warrant an ADR that
amends or supersedes **ADR-033**), `sp:spur-cli` for corpus verbs, `sp:source-driven-development`
before asserting any framework or CLI behavior.

### Open questions

None open. The operator's 2026-08-13 ruling closed the last one (where a role may be declared). New
questions arising during implementation go here first — never into a task file.

### Decisions so far
- **Four-role vocabulary, one role per tier (operator ruling, 2026-08-13).** 0344's eight intentions
  collapse to `scribe` / `coder` / `reviewer` / `planner` because the eight carried only four distinct
  tier floors. `--agent` becomes the role selector, so no `--intention` flag is added; `--spec` takes
  over occupant addressing; `agent.default` is redefined as the default *role*. Executor-name pinning
  is permanent (a safety property, not compatibility); binary names and spec-ids-on-`--agent` are
  transition shims with registered removal conditions. ADR-051 consent given in the same ruling. Full
  rationale in `### The role vocabulary`.

- **Transition shims must be marked and countable (operator ruling, 2026-08-13).** Compatibility is
  accepted for the transition, but every shim carries a `@transition-shim(<id>)` marker and a
  `config/transition-shims.json` entry, gated two-sided like `config/corpus-baseline.json` — an
  unregistered marker fails, and a stale entry fails. Task 0541 builds the gate before the shims it
  governs. Emptying the manifest is the definition of the transition being complete.

- **Retarget to shippable + role-on-spec (operator ruling, 2026-08-13).** The decision half of this
  map is closed; remaining tickets are implementation. A role/intention is declared on the
  invocation or on the team spec, never on the executor — full rationale in
  `### Where a role may be declared`. `--agent` keeps its name and gains a spec-id/executor-name
  collision guard. G4's spec→bare-kind flattening is a defect in scope here. The broad `plugins/sp` +
  `.spur/workflows` audit is a sibling feature, sequenced after the migration.

- [0348 Decide the fate of REGISTERED_CANONICAL_STAGES](../tasks2/0348_decide-the-fate-of-registered-canonical-stages-and-prompt-re.md) —
  **Demote to overridable default; AMEND ADR-033.** Registry stays as `model_policy` seed; config gains per-stage deep-replace override (Follow-up A). Escalation stays in domain (`getNextFallback`). Validator DAG retired (Follow-up B). `extractPhase` owned by 0344. Adapter reconcile is Follow-up C.

- [0347 Inventory the backward-compatibility surface](../tasks2/0347_inventory-the-backward-compatibility-surface-before-any-agen.md) —
  **Complete.** Citeable inventory at `docs/tasks2/0347-inventory.md` (~16 operator-visible contracts, dual stage registries, four-source schema stack, deprecated-but-authoritative `default-by-phase`). No redesign proposed (R5); 0348 amends ADR-033 against this surface.

- [0346 Unify the --agent selector namespace with agent.executors](../tasks2/0346_unify-the-agent-selector-namespace-with-agent-executors.md) —
  **Shipped.** Explicit `--agent <name>` reuses executor-first-then-binary lookup; bare binaries still
  work; ship-ahead of the rest of the map. `--executor` rename deferred.


- [0343 Decide executor quality ordering](../tasks2/0343_decide-executor-quality-ordering-capable-sub-tiers-vs-orthog.md) —
  **`capable` splits into `capable-1/2/3` (1 = low, 3 = high output quality); `cheap` and `standard`
  stay single.** Operator reaffirmed after the `tier`+`rank` counter-proposal: granularity is only
  warranted where several models genuinely compete on quality, and sub-tiering `cheap`/`standard`
  would be complexity without a use. Open implementation detail carried into 0348: what `min_tier:
  capable` means once sub-tiers exist.
- [0345 Decide where the intention vocabulary lives](../tasks2/0345_decide-where-the-intention-vocabulary-is-defined-owned-and-v.md) —
  **merged into 0344.** The operator's two-layer ruling (above) answered ownership directly, leaving
  only vocabulary definition, which 0344 now covers.

### Not yet specified

- **Telemetry and cost attribution — batch 2.** Nothing currently records which executor served which
  role. Without it the operator cannot tell whether routing is actually saving money, the stated
  motivation for tiers. The operator's 2026-08-13 suggestion is to carry this on the existing
  event pub/sub plane (EventBus / `system_events` / the v2 envelope) rather than a new channel, which
  is the right substrate — but the role model does not need it to function, so it graduates in
  **batch 2** alongside the Teams redefinition, per the operator's own batch-1 discipline.
- **Board surface.** Whether executor routing becomes visible in the web UI.
- **Parallel fan-out.** `sp:parallel-execution` dispatches several subagents at once. Whether each
  carries its own intention, or inherits the parent's, is unexplored — and the answer depends on how
  the subagent dispatch path (0344 D3 path 3) behaves once it ships.
- **The `spur` package is published.** Changing `tier` or the config shape affects installs outside
  this monorepo; the migration story is sensed but not specified.

### Out of scope

- Re-adding `agent.default-by-phase` — the operator has ruled this out twice; retired 2026-07-26.
- Changing the agent-binary detection layer (`@gobing-ai/ts-ai-runner` `AgentDetector` / `DoctorRunner`).
  Which binaries exist and whether they are usable is a solved, separate concern.
- Choosing specific models or vendors for the operator's roster. The whole point is that executors are
  operator-owned config; this map fixes the mechanism, never the roster.
- Sub-tiering `cheap` and `standard`. Considered and declined (see Decisions so far) — reopening needs
  a concrete case where two cheap or two standard executors must be ranked.
- Declaring roles on `agent.executors[]`. Raised and declined 2026-08-13 — see
  `### Where a role may be declared`. Executors declare `tier` only.
- Renaming `--agent` to `--executor`. Deferred twice and now moot: `--agent` is the role selector and
  the collision guard closes the ambiguity. (Splitting `--spec` out is **in** scope, decided
  2026-08-13, because `--agent` is being redefined anyway — one migration instead of two.)
- **Batch 2 — redefining the Teams concept around roles.** Chartered 2026-08-13 as feature **M5**
  (*Teams declared by role: a member is a role plus an executor*), tasks 0543/0544, blocked on 0538.
- **Batch 2 — role attribution over the event pub/sub plane.** Chartered 2026-08-13 as feature **J6**
  (*Role routing attribution*), tasks 0545/0546, blocked on 0536. Consumes J5's envelope; adds no
  table, column, or CLI noun. Dollar-cost attribution deferred to batch 3 — it needs token counts and
  per-model pricing from the history plane (feature E1), and routing correctness is answerable
  without a single price.
- Adding a fifth role. The four-roles-four-tiers invariant means a fifth role needs a fifth tier;
  without one it is a synonym. Reopen only with a concrete case.
- The broad `plugins/sp` + `.spur/workflows` defect audit and tier-fallback exhaustion hardening.
  Real work, but wider than executor selection — sibling feature, sequenced after this map's
  migration ticket so the audit is informed by what the migration exposes.
## History
- 2026-08-14T00:37:34.394Z backlog → active (system)
- 2026-08-14T04:37:03.765Z active → verifying (system)
- 2026-08-14T04:38:38.182Z verifying → done (system)
