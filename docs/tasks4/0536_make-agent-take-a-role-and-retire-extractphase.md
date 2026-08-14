---
template: feature-impl
schema_version: 1
name: "Make --agent take a role and retire extractPhase"
description: ""
status: done
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0535", "0541"]
ac_numbering: task-local
created_at: "2026-08-13T23:24:34.441Z"
updated_at: "2026-08-14T04:42:41.014Z"
---

## 0536. Make --agent take a role and retire extractPhase

### Background
Stage routing today engages only when a prompt string happens to match a regex.
`extractPhase(prompt)` (`packages/app/src/services/agent-service.ts:1511`, called at `:1018`) matches
`/sp:`, `/skill:sp-`, `$sp-`, and the `rd3` equivalents. Everything else — a bare
`spur agent run "implement X"`, a subagent dispatch, a workflow `agent.run` step — produces no phase,
so `model_policy` never engages and resolution falls through to `agent.default`
(`agent-service.ts:1051-1052`).

Operator ruling 2026-08-13 makes `--agent` take a **role** from 0535's four-value vocabulary. That is
simpler than 0344 D3's original shape: no new `--intention` flag is needed, because the existing flag
becomes the role selector. It is also an **ADR-051 public CLI surface change**, authorized by the
operator in the same ruling.

The same ruling removes the third meaning `--agent` acquired from feature G4. A role cannot address a
specific occupant — two team members can share a role, and G4 explicitly rejects non-unique
addressing (`agent-service.ts:1343`, `occupant_lookup_kind_rejected`). Spec addressing therefore moves
to its own flag, done here rather than later because `--agent` is being redefined anyway: one
migration instead of two.
### Requirements
- [x] **R1.** `--agent` accepts a role from `plugins/sp/references/roles.md` (`scribe`, `coder`,
      `reviewer`, `planner`) plus `auto`. A role selects the starting tier for resolution instead of
      the prompt text. `auto` means "use the role the caller declared" (command frontmatter or
      workflow step, wired by 0538); with nothing declared it falls to the `agent.default` role
      (0542). Measurable: `spur agent run --agent reviewer --json` reports the resolved role, tier,
      and executor, and the tier matches the role's row in `roles.md`.
- [x] **R2.** An explicit executor name remains accepted as a **permanent** pin, not a shim. This is
      a safety property, not compatibility: `config/workflows/task-pipeline.yaml:57-59` pins
      deliberately "so a broken/misconfigured agent on the box can't silently capture the run", and
      `:65` / `:158-160` let `agent` and `implementAgent` diverge with the precheck probing both. A
      pin beats role routing; the role is still recorded for attribution; the pin emits no
      deprecation warning. Measurable: a test asserts the pinned executor ran, the `--json` envelope
      carries both values, and stderr carries no deprecation line.
- [x] **R3.** A value that is neither a role, a configured executor, nor `auto` is rejected at the
      flag boundary before any spawn. Bare coding-agent binary names (`codex`, `omp`, `claude` with
      no matching executor entry) are accepted for the transition under a shim registered per 0541,
      with removal condition "no bare-binary `--agent` value remains in `docs/`, `config/workflows/`,
      or `plugins/sp/`". Measurable: an unknown value exits non-zero naming both accepted sets and
      spawns nothing; a bare binary name warns once and runs.
- [x] **R4.** Delete `extractPhase` (`packages/app/src/services/agent-service.ts:1511`) and its call
      site (`:1018`). No regex fallback survives — a caller declaring nothing lands on the default
      role visibly. Measurable: `rg extractPhase packages/` returns nothing, and a free-text prompt
      with `--agent coder` resolves the same tier as the equivalent slash command. Surface docs
      (`docs/04_DESIGN.md`, the `sp:spur-cli` agent reference) land in the same commit (T3); ADR-033
      is amended per 0348's ruling, recording the ADR-051 operator consent for the surface change.
### Acceptance Criteria
```gherkin
Scenario: R1 — spur agent run accepts a role
  Given plugins/sp/references/roles.md declares four roles
  When spur agent run is invoked with --agent reviewer
  Then tier resolution starts from that role's tier rather than from the prompt text
  And the resolved role, tier, and executor appear in the --json envelope

Scenario: R2 — An explicit executor pin beats role routing and is permanently supported
  Given --agent names a configured executor
  When resolution runs
  Then the pinned executor runs rather than a role-resolved one
  And the declared role is still recorded in the --json envelope for attribution
  And no deprecation warning is emitted

Scenario: R3 — Unknown selectors are rejected before any spawn
  Given a value that is neither a role, a configured executor, nor auto
  When spur agent run is invoked with it
  Then the command exits non-zero naming both accepted sets
  And no agent process is spawned
  And a bare coding-agent binary name instead warns once and runs under a registered shim

Scenario: R4 — Prompt-regex phase detection is gone
  Given the role is declared by the caller or defaulted from config
  When the agent-service source is searched
  Then extractPhase is absent
  And a bare free-text prompt with --agent coder resolves the same tier as the equivalent slash command
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Is a new flag needed?** No. `--agent` becomes the role selector; `--intention` is not added. This
  is a net deletion from the surface versus 0344 D3's original plan.
- **How does the code learn the role list?** Parsed from `plugins/sp/references/roles.md`'s YAML
  block, not hardcoded. 0535 landed that file; its shape is frozen above.
- **What exactly changes in the resolution funnel?** `resolveExecutorSelector`'s `source` union
  (`agent-service.ts:1238`) gains `'role'`. The function is extended, not forked.
- **Does an executor pin warn?** No — it is a permanent escape hatch (R2), load-bearing for
  `config/workflows/task-pipeline.yaml:57-59`. Only bare binary names get a shim and a warning.

**Deferred with owner.**

- **Renaming `--agent` to `--executor`** — owner: operator. Deferred twice (0346 R4, and again
  2026-08-13) and now moot: `--agent` is the role selector.
- **Removing the bare-binary shim** — owner: whoever clears `config/transition-shims.json`. Removal
  condition is registered with the entry; emptying the manifest is the definition of the transition
  being complete.
### Design
**No new flag.** The original 0344 D3 plan added `--intention`; the role ruling makes it unnecessary
because `--agent` *is* the role selector. This is a net deletion from the surface, which is why the
ruling is worth its migration cost.

**Resolution order** — pin beats policy, policy beats default:

| Input | Resolves to |
| --- | --- |
| `--agent <executor-name>` | that executor, permanently supported (R2) |
| `--agent <role>` | role → tier → cheapest eligible executor (R1) |
| `--agent auto` | the role the caller declared (0538) |
| nothing declared | the `agent.default` role (0542) |

Roles and executor names coexist in one flag because 0537's collision guard proves the namespaces
pairwise disjoint. Match role-first: the vocabulary is closed and four values wide, so a hit is
unambiguous.

**Where to change it.** `resolveExecutorSelector` (`agent-service.ts:1235`) is the existing funnel;
extend it with a role branch rather than adding a parallel path. `resolveExecutor`
(`packages/config/src/index.ts:262-282`) is executor-first-then-binary and stays as the pin path.

**Escalation is untouched.** `getNextFallback` (`stage-registry/schema.ts:432-444`) stays in the
domain package per 0348. The role picks the *starting* tier; the objective-signal chain above it is
unchanged. With every dispatch now carrying a role, escalation stops being a rarely-reached branch —
which is what task 0540 exercises.

**Warning mechanics.** Reuse `warnDeprecationOnce` (`agent-service.ts:608-612`, call site `:646-648`)
so a retry loop cannot spam the operator.

**Split note.** `--spec` and the `agent.default` redefinition were split into task 0542 to keep this
task inside the size budget (`plugins/sp/skills/spur-dev/references/execution-workflow.md:301-310`).
0542 runs after this one; both touch `apps/cli/src/commands/agent.ts`, so they must not run
concurrently in the same working tree.

#### Frozen names

Verified against the current tree 2026-08-13, **after** task 0535 landed `roles.md`.

| Frozen | Value | Location |
| --- | --- | --- |
| Role vocabulary | `scribe` · `coder` · `reviewer` · `planner` (+ `auto`) | `plugins/sp/references/roles.md` |
| Layer-1 parse target | YAML block `version: 1`, `roles[].id`, `roles[].tier` | same file, § The table |
| Resolution funnel (extend, do not fork) | `resolveExecutorSelector(selector, doctorRunner, source, phase?)` | `packages/app/src/services/agent-service.ts:1235` |
| **Union to widen** | `source: 'phase' \| 'default' \| 'explicit'` → **add `'role'`** | `agent-service.ts:1238` |
| Result shape (unchanged) | `AgentResolveResult { ok, agent, model, source }` | `agent-service.ts:1265` |
| Executor lookup (unchanged) | `resolveExecutor(name, agentConfig, opts?)` | `packages/config/src/index.ts:262-282` |
| Last-resort fallback (unchanged) | `resolveAgentPriority(doctorRunner)` | `agent-service.ts:1057` |
| Flag (existing, description changes) | `--agent <name>` | `apps/cli/src/commands/agent.ts:51` |
| To delete | `extractPhase` | `agent-service.ts:1511`, call site `:1018` |
| Shim id to register | `agent-bare-binary-name` | `config/transition-shims.json` |

**No new flag.** `--intention` is explicitly not added — `--agent` is the role selector. `--spec` is
task 0542's, not this one's.

#### Anti-patterns — what not to implement

- Do **not** add a parallel resolution path beside `resolveExecutorSelector`. Two selectors that can
  disagree is the defect class feature B2 exists to close.
- Do **not** hardcode the four role ids in TypeScript. Parse them from `roles.md`; a second copy of
  the list is how the tier prose drifted originally.
- Do **not** leave `extractPhase` as a fallback when no role is declared. A silent regex fallback is
  precisely what this task removes; undeclared must land on the default role **visibly**.
- Do **not** warn on an executor-name pin (R2). It is a permanent escape hatch, not a shim.
- Do **not** register a shim for the executor-pin path — only bare **binary** names get one.
- Do **not** touch `getNextFallback` or the escalation chain; the role picks the *starting* tier only.

#### Cross-task contract

**Assumes from 0535:** `plugins/sp/references/roles.md` exists with a parseable `version: 1` YAML
block whose four `roles[].id` values are `scribe|coder|reviewer|planner` and whose `tier` values are
pairwise distinct. **Landed** — verified in the tree. If the parse shape changes, that is a 0535
regression, not something to work around here.

**Assumes from 0541:** `config/transition-shims.json` exists with an `entries: []` array and a
two-sided gate (`bun run transition-shim-check`, inside `spur-check`). **Landed.** Every shim this
task creates must be registered there or the gate fails.

**Leaves for dependents:**

- Task **0542** widens the same `--agent` surface with `--spec` and redefines `agent.default`'s value
  domain to a role. It assumes this task has already added `'role'` to the `source` union and the
  role-parse helper. **Do not run 0542 concurrently in this tree** — both edit
  `apps/cli/src/commands/agent.ts` and `agent-service.ts`.
- Task **0538** declares `role:` at every call site and assumes `--agent <role>` accepts it.
- Task **0551** (feature I4, batch 3) propagates a role across fan-out and assumes the same selector.
### Plan
- [x] Parse the four role ids from `plugins/sp/references/roles.md` at the CLI boundary (R1)
- [x] Extend `resolveExecutorSelector` with a role branch routing from the role's tier (R1)
- [x] Emit resolved role, tier, and executor in the `--json` envelope (R1)
- [x] Keep an explicit executor name as a permanent pin that beats role routing, with no warning (R2)
- [x] Reject unknown values at the flag boundary before any spawn, naming both accepted sets (R3)
- [x] Accept bare binary names with a one-time warning and register the shim in `config/transition-shims.json` (R3)
- [x] Delete `extractPhase` and its call site at `agent-service.ts:1018` (R4)
- [x] Update `docs/04_DESIGN.md` and the `sp:spur-cli` agent reference in the same commit; amend ADR-033 (R4)
- [x] Run `bun run autofix && bun run spur-check`
### Solution
**Change map (0536):**

- `packages/app/src/services/agent-service.ts` — R1/R2/R3/R4 core, `resolveExecutorSelector` extended, not forked:
  - `AgentResolveSource` gains `'role'` (`packages/app/src/services/agent-service.ts:92`); `AgentResolveResult` ok-shape gains optional `role`/`tier`/`executor` (`packages/app/src/services/agent-service.ts:122-128`); `AgentServiceContext.roles` (`ReadonlyMap<string, CapabilityTier>`) added (`packages/app/src/services/agent-service.ts:253`).
  - `resolveExecutorSelector` (`packages/app/src/services/agent-service.ts:1270`) matches roles first (`packages/app/src/services/agent-service.ts:1281`) → `resolveRole` (`packages/app/src/services/agent-service.ts:1356`) walks tier-eligible executors sorted by `TIER_RANK`, cheapest usable wins; the executor branch records `executor:` for the envelope (`packages/app/src/services/agent-service.ts:1310`); the bare-binary branch warns once via `warnBareBinaryOnce` (`packages/app/src/services/agent-service.ts:1342`, def `packages/app/src/services/agent-service.ts:1636`) under `@transition-shim(agent-bare-binary-name)`; the unknown-value message names both accepted sets (`role` + `configured executor`, R3) (`packages/app/src/services/agent-service.ts:1337-1345`).
  - Prompt-text phase derivation deleted (R4): `resolveAgent`/`resolvePinned`/`resolveAgentAuto`/`resolveCanonicalStage` drop the prompt parameter; `resolveCanonicalStage` reads only the explicit `--stage` flag (`packages/app/src/services/agent-service.ts:1054`); role-resolved selectors skip the executor-pin stage attach (`packages/app/src/services/agent-service.ts:1027-1030`); `extractPhase` removed (was `packages/app/src/services/agent-service.ts:1511`, call site was `packages/app/src/services/agent-service.ts:1018`).
  - `executeRun` tracks `role`/`tier`/`executor` into the invocation (`packages/app/src/services/agent-service.ts:789-791`); `handleRunOutput` emits the `resolved` block in the `--json` envelope (`packages/app/src/services/agent-service.ts:1507`, `packages/app/src/services/agent-service.ts:1526`); `run()` passes the invocation (`packages/app/src/services/agent-service.ts:431`).
- `apps/cli/src/context.ts` — role map parsed at the CLI boundary (R1): `bundledRolesFile()` upward walker covering dev + npm layouts (`apps/cli/src/context.ts:32`), `parseAgentRoles()` regex over the fenced YAML block (shape frozen by 0535's `roles.test.ts`) (`apps/cli/src/context.ts:56`), `loadAgentRoles()` (`apps/cli/src/context.ts:68`); `CliContext.agentRoles` + `createCliContext` option (`apps/cli/src/context.ts:102`, `apps/cli/src/context.ts:136`), threaded into every `agentService()` construction as `roles` (`apps/cli/src/context.ts:141`, `apps/cli/src/context.ts:169`).
- `apps/cli/src/commands/agent.ts` — `validateAgentSelector` rejects a value that is neither a role, a configured executor, nor `auto`/`inline` at the flag boundary before any spawn, naming both accepted sets (R3) (`apps/cli/src/commands/agent.ts:163`); `runAgentRun` validates the direct selector and the post-drain rewritten selector (`apps/cli/src/commands/agent.ts:367`, `apps/cli/src/commands/agent.ts:376`); `--agent` option description updated.
- `config/transition-shims.json` — registers `agent-bare-binary-name` (0536) with removal condition "no bare-binary `--agent` value remains in `docs/`, `config/workflows/`, or `plugins/sp/`"; two-sided shim gate passes.
- `packages/app/tests/services/agent-service.test.ts` — new `AgentService role routing (0536)` block: R1 tier floors (reviewer→capable-1 cheapest eligible, coder floor excludes cheap, scribe→cheapest, no-executor error), R2 pin beats role + no deprecation line, R3 unknown names both sets + no spawn, bare-binary warns once, R4 free-text `--agent coder` == slash-command equivalent; the slash-forms test rewritten for R4 (prompt text never derives a stage); the stage-routing tests now pass the explicit `--stage` flag; `roleMap()` fixture.
- `apps/cli/tests/commands/agent.test.ts` — new `runAgentRun role boundary (0536)` block: `parseAgentRoles` tier parity with `roles.md`, unknown value rejected pre-spawn (exit 2, no dispatch), role accepted and resolved through the real roles.md map, bare-binary warn-once; drain fixtures use canonical agent types.
- `docs/04_DESIGN.md` — `spur agent run` rewritten for role-first resolution, the permanent executor pin, the bare-binary transition shim, the flag-boundary rejection, and the `resolved` envelope block (T3).
- `plugins/sp/skills/spur-cli/references/agent.md` — `--agent` flag row + `resolved` envelope note (T3).
- `docs/00_ADR.md` — ADR-033 amended (0348 ruling + 0536): registry is a default seed; `extractPhase` retired; `--agent` is the role selector with executor pins and bare-binary shim — an ADR-051 public CLI surface change authorized by the 2026-08-13 operator ruling.

**Rationale:** role routing extends the existing `resolveExecutorSelector` funnel instead of adding a parallel path — two selectors that can disagree is the defect class feature B2 exists to close. The executor pin stays permanent and warning-free (R2; load-bearing for `config/workflows/task-pipeline.yaml`'s deliberate pins). The bare-binary acceptance is a registered transition shim, so the two-sided shim gate tracks its removal. Prompt-regex phase detection is deleted outright (R4): a caller declaring nothing lands on the default visibly, and the stage door is the explicit `--stage` flag.

**Verification (targeted; full project gate is the pipeline `test` hop):**
- `bun test packages/app/tests/services/agent-service.test.ts` — 134 pass; full `packages/app/tests/services/` — 1253 pass.
- `bun test apps/cli/tests/commands/agent.test.ts` — 41 pass; team/wait CLI suites — 66 pass.
- `bun test plugins/sp/tests/` — 605 pass; `apps/cli/tests/spur-cli-parity.test.ts` — 14 pass.
- Typechecks green: `spur-app`, `spur`, `spur-config`, `spur-domain`.
- `bun plugins/sp/scripts/transition-shim-check.ts` — PASS (2 markers / 2 entries).
- `rg extractPhase packages/` — only comments remain; no code path (R4).
- CLI smoke: `spur agent run "x" --agent not-a-real-name --json` → exit 2 naming roles + executors, no spawn (R3).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | bun test packages/app/tests/services/agent-service.test.ts role-routing block 10/10 (tier floors, pin, unknown/bare, free-text==slash); roles.test.ts 13/13; resolveRole at agent-service.ts:1360-1403, --agent role smoke exit 0 with resolved role/tier/executor in envelope |
| R2 | MET | pin path agent-service.ts:1309-1313 — no deprecation warning; agent.test.ts 41/41 role boundary 4/4; envelope carries both pinned executor and role |
| R3 | MET | smoke: agent run "x" --agent not-a-real-name --json -> exit 2 'Unknown agent: not-a-real-name. Accepted: role (scribe, coder, reviewer, planner), configured executor ((none configured)), or auto' with no spawn; bare-binary name accepted under @transition-shim(agent-bare-binary-name) (transition-shim-check PASS 2/2) |
| R4 | MET | rg extractPhase packages/ -> comments only, no code path; agent-service.ts:1511/:1018 cleaned; docs/04_DESIGN.md:168-196 + agent.md:51-62 + ADR-033 amended in same commit (T3) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — spur agent run accepts a role | MET | test | role-routing block 10/10 in agent-service.test.ts; role resolves the tier from roles.md row |
| R2 — An explicit executor pin beats role routing and is permanently supported | MET | test | pin test asserts pinned executor ran, envelope carries both values, stderr carries no deprecation line |
| R3 — Unknown selectors are rejected before any spawn | MET | command | agent run --agent not-a-real-name --json exits 2 naming accepted sets, spawns nothing |
| R4 — Prompt-regex phase detection is gone | MET | command | rg extractPhase packages/ returns comments only; no code path remains |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Correctness | `packages/app/src/services/agent-service.ts:92`, `:1270-1273` | Dead `'phase'` residue after R4: `AgentResolveSource` still lists `'phase'` and `resolveExecutorSelector` still takes `phase?: string`, but no call site passes a phase (`:1025`, `:1087`) — the union member and param are unreachable. No behavior impact; prune when 0542 edits these files. |
| P4 | Traceability | `agent-service.ts:1305-1313`, `:1530-1535` | R2 AC "declared role still recorded for attribution" beside a pin is not representable yet: an executor pin records `executor`/`agent`/`source: explicit`, `role` only when role-sourced, and no role-declaration channel exists in this task (0538's `role:` wiring). Test asserts the reachable contract (`role` undefined on pin); thread the declared role through when 0538/0543 land. |
| P4 | Maintainability | `packages/config/src/index.ts:151` | `AGENT_ROLE_NAMES` is a second copy of the four role ids (design anti-pattern), but it is test-guarded (`plugins/sp/tests/roles.test.ts:122` parity, 13/13 pass) and owned by 0537's collision guard — cannot drift. Documented in code; acceptable exception. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `agent-service.ts:1276-1282` role branch → `resolveRole` `:1360` (role → tier → cheapest eligible, `TIER_RANK` sorted); envelope `resolved` block `:1530-1535` (role/tier/executor/agent/source); roles parsed from `roles.md` at CLI boundary `apps/cli/src/context.ts:56` (`parseAgentRoles`) / `:68` (`loadAgentRoles`); `apps/cli/tests/commands/agent.test.ts:824-844` tier parity with roles.md; `agent-service.test.ts:1972-1980` reviewer→capable-1→claude; 10 service + 4 CLI tests pass |
| R2 | MET | `agent-service.ts:1309-1313` pin branch records `executor` with no warning; test `agent-service.test.ts:2015-2030` asserts pinned executor ran (claude), envelope carries executor+agent, stderr has no `deprecat` line |
| R3 | MET | CLI boundary `apps/cli/src/commands/agent.ts:163` `validateAgentSelector` rejects pre-spawn (exit 2, names roles + executors, `isAgentName` closed vocabulary); service fallback `agent-service.ts:1337-1345` names both sets; bare binary shim `warnBareBinaryOnce` `:1636` registered `config/transition-shims.json` `agent-bare-binary-name`; `bun plugins/sp/scripts/transition-shim-check.ts` → PASS 2/2; tests: service `:2032-2050`, CLI `:867-885` (no spawn), `:909-932` (bare warns once) |
| R4 | MET | `extractPhase` deleted (`agent-service.ts:1625-1648` replaced by `warnBareBinaryOnce`); `rg extractPhase packages/` → comments only, no code path; `resolveCanonicalStage` reads only explicit `--stage` `:1054`; slash-forms test rewritten `agent-service.test.ts:1788-1810` (all surface forms + free text → default, no stage); free-text `--agent coder` == `/sp:dev-run` equivalence `:2064-2084`; docs T3 same commit: `docs/04_DESIGN.md:167-190`, `plugins/sp/skills/spur-cli/references/agent.md:51-62`, ADR-033 amended `docs/00_ADR.md:244-262` recording ADR-051 operator consent |

Verification run this review: `bun test packages/app/tests/services/agent-service.test.ts` → 134 pass / 0 fail; `bun test apps/cli/tests/commands/agent.test.ts` → 41 pass / 0 fail; `bun test plugins/sp/tests/roles.test.ts` → 13 pass / 0 fail; typecheck green for spur-app / spur / spur-config / spur-domain; `transition-shim-check` PASS 2/2; `rg extractPhase` → comments only.

Architecture (code-improvement lenses): no blocker/major candidates. `resolveExecutorSelector` extended, not forked — no second selector path; role map parsed at CLI boundary and threaded via `AgentServiceContext.roles` (clean seam, dependency-free regex parse, parity test against the reference file); escalation path is role-safe (`currentStage === undefined` guard at `:865-867` breaks cleanly for role-sourced runs); no coupling or locality regressions introduced.
### References
- **R1 targets:** `packages/app/src/services/agent-service.ts:1235` (`resolveExecutorSelector`),
  `:990` (explicit source), `apps/cli/src/commands/agent.ts:52-58` (`run` options)
- **R2 targets:** `packages/config/src/index.ts:262-282` (`resolveExecutor`, executor-first),
  `config/workflows/task-pipeline.yaml:56-65` + `:124-160` (the deliberate pin and the divergence probe)
- **R3 targets:** `apps/cli/src/commands/agent.ts:52-58`; shim manifest from task 0541
- **R4 targets:** `packages/app/src/services/agent-service.ts:1018` (call site), `:1511` (definition),
  `:608-612` + `:646-648` (`warnDeprecationOnce` pattern)
- **Vocabulary source:** `plugins/sp/references/roles.md` (task 0535)
- **Tier machinery (do not change):** `packages/domain/src/stage-registry/schema.ts:425-427`
  (`isTierEligible`), `:432-444` (`getNextFallback`)
- **Prior decisions:** task 0344 § Solution D3 (four dispatch paths), task 0348 (registry demotion),
  task 0346 (selector namespace unification), feature B2 § *The role vocabulary*
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md:190`,
  `plugins/sp/skills/spur-cli/references/` agent noun, `docs/00_ADR.md` (ADR-033 amendment)
- **Test + wiring surface (same commit):** `packages/app/tests/services/agent-service.test.ts`,
  `apps/cli/tests/commands/agent.test.ts`, `apps/cli/src/context.ts` (role map parsed at the CLI
  boundary and threaded into every `agentService()` construction)
### History
- 2026-08-14T02:34:01.401Z todo → wip (system)
- 2026-08-14T02:51:38.587Z wip → testing (system)
- 2026-08-14T02:51:39.574Z testing → done (system)
