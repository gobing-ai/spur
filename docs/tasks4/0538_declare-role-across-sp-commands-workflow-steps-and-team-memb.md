---
template: feature-impl
schema_version: 1
name: "Declare role across sp commands, workflow steps, and team members"
description: ""
status: done
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0535", "0536", "0537", "0542"]
ac_numbering: task-local
created_at: "2026-08-13T23:24:34.865Z"
updated_at: "2026-08-14T04:42:42.299Z"
---

## 0538. Declare role across sp commands, workflow steps, and team members

### Background
0535 builds the Layer-1 intention table and 0536 builds the `--intention` dispatch surface. Neither
is worth anything until the call sites actually declare an intention — 0344 D3's four dispatch paths
are what make routing engage on every invocation instead of on the ones whose prompt matched a regex.

This task migrates the declaration sites and then deletes what they replace. The tier facts currently
hand-restated in plugin prose (`dev-operations.md:256`, `dev-refine.md:37`,
`execution-workflow.md:301-310`) exist only because Layer 1 had no file; once it does, they are
duplicate sources that can drift. Removing them is the point of the exercise, not a tidy-up.

Scope ruling (operator, 2026-08-13): this pass is **migration-scoped**. It touches what the intention
layer forces and nothing else. The broad `plugins/sp` + `.spur/workflows` defect audit is a sibling
feature, sequenced after this task so it is informed by what the migration exposes.
### Requirements
- [x] **R1.** Every file under `plugins/sp/commands/` declares exactly one `role:` in its YAML
      frontmatter, taken from its row in `plugins/sp/references/roles.md`, and the command dispatcher
      threads it into `--agent`. Do not invent the mapping — a command with no row is a bug in 0535.
      Measurable: every command file has the key, each value is one of the four roles, and each
      matches its roles.md row.
- [x] **R2.** Every `agent.run` step across `config/workflows/*.yaml` declares a `role:` alongside
      its `agent:` pin, `AgentRunActionRunner` threads it onto the underlying `spur agent run`, and
      the workflow schema fails validation on a missing or unknown step role. Existing `agent:` pins
      stay — a pin beats role routing permanently (0536 R2) — so this declares the *reason* without
      changing which executor runs today. Measurable: `spur workflow validate` rejects a step with no
      role; a dry-run shows the role on the composed command.
- [x] **R3.** `agent.team[].members[]` accepts an optional `role` from the vocabulary, carried onto
      the materialized spec. A member's `purpose` prose stays as documentation; `role` is the typed
      field routing reads. Measurable: a member declaring `role: reviewer` produces a spec recording
      it; a member declaring none still materializes.
- [x] **R4.** No file in `plugins/sp` restates a tier value outside a pointer to `roles.md`. Delete
      the duplicated prose at `skills/spur-dev/references/dev-operations.md:256`,
      `commands/dev-refine.md:37`, and `skills/spur-dev/references/execution-workflow.md:301-310`,
      re-expressing the size→tier rule so it reads its floor from Layer 1 rather than naming
      `capable-1` inline. Reconcile `plugins/sp/scripts/stage-registry-adapter.ts` against Layer 1
      (0348 Follow-up C). Measurable: a grep for tier literals across `plugins/sp` returns only
      pointers.
- [x] **R5.** The migration is enforced, not conventional, and its shims are registered. Extend
      `plugins/sp/tests/roles.test.ts` (0535) to fail on a command with no `role:` and on any
      surviving tier literal in plugin prose; register any command or workflow step still lacking a
      role under 0541's manifest with a removal condition. Measurable: adding a command without a
      `role:` fails the suite naming the file. `docs/04_DESIGN.md` records the frontmatter, workflow
      step, and member fields in the same commit (T3).
### Acceptance Criteria
```gherkin
Scenario: R1 — Every sp command declares its intention
  Given the intention vocabulary from plugins/sp/references/intentions.md
  When any file under plugins/sp/commands/ is read
  Then its YAML frontmatter declares exactly one intention from that vocabulary
  And the declared intention matches the command's row in intentions.md

Scenario: R2 — Workflow agent.run steps declare their intention
  Given a workflow step of kind agent.run
  When the workflow YAML is validated
  Then the step declares an intention
  And the runner threads it through as --intention on the underlying spur agent run

Scenario: R3 — Team members declare a role
  Given a team member in agent.team[].members[]
  When config is loaded
  Then the member may declare an intention from the vocabulary
  And a declared intention is carried onto the materialized spec

Scenario: R4 — Duplicated tier prose is gone from the plugin
  Given Layer 1 now lives in intentions.md
  When plugins/sp is searched for hardcoded tier names
  Then no command or reference file restates a stage floor or fallback tier
  And any remaining tier mention points at intentions.md rather than naming a value

Scenario: R5 — A command missing its intention fails the check
  Given a command file with no intention in its frontmatter
  When the plugin test suite runs
  Then it fails naming the command file
  And adding a command without an intention cannot pass CI
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **How many commands need a `role:`?** 37, not the 31 the charting session assumed. Task 0535
  reconciled the decided table against the live directory and placed the six extras; its `commands`
  lists are authoritative.
- **Do workflow steps lose their `agent:` pin?** No. `role:` is added *beside* it. Pins beat role
  routing permanently, so today's routing is unchanged — the declaration exists so removing a pin
  later routes correctly instead of falling to the default role.
- **New test file or extend?** Extend `plugins/sp/tests/roles.test.ts`, landed by 0535.
- **Does `purpose` go away on team members?** No. `role` is the typed routing field; `purpose`
  remains human annotation. Feature M5 (batch 2) demotes it further, not this task.

**Deferred with owner.**

- **Making `role` required on team members** — owner: feature M5 task 0543, which decides the
  role-versus-executor requirement rule (at least one of the two).
- **Whether every workflow step must declare a role, or only `agent.run` steps** — scoped here to
  `agent.run` steps only; broadening is owner: operator, and only if a non-`agent.run` step ever
  dispatches a model.
### Design
**Four declaration sites, one vocabulary:**

| Site | Carries | Threading |
| --- | --- | --- |
| Command `.md` | `role:` in YAML frontmatter | dispatcher passes `--agent <role>` |
| `spur agent run` | `--agent <role>` | task 0536, already built |
| Workflow `agent.run` step | `role:` alongside `agent:` | `AgentRunActionRunner` threads it |
| Team member | `role:` in `agent.team[].members[]` | carried onto the materialized spec |

**Do not invent the mapping.** Every command's role is assigned by 0535's table. Read the row; write
the frontmatter. A command whose row is missing is a bug in 0535, not a judgment call here.

**Workflow steps keep their `agent:` pin.** `config/workflows/task-pipeline.yaml:59` pins
`vars.agent: "omp"` deliberately, and a pin beats role routing permanently (0536 R2). Adding `role:`
alongside changes nothing about which executor runs today; it declares the *reason*, so removing a
pin later routes correctly instead of falling to the default role. Both facts stay true.

**Deletion is the deliverable (R4).** After migration `plugins/sp` must not name a tier value outside
a pointer to `roles.md`. The size→tier rule at `execution-workflow.md:301-310` is the subtle one: it
encodes a real behaviour (a large task on a sub-`capable-1` executor burns budget without failing
fast) and must survive as a rule that *reads* its floor from Layer 1 rather than restating
`capable-1` inline.

**Enforcement, not convention (R5).** Extend `plugins/sp/tests/roles.test.ts` (0535). Without the test
this migration rots on the next command added.

**Size note.** This task is at the Plan-item threshold in
`plugins/sp/skills/spur-dev/references/execution-workflow.md:301-310`. Run it on a `capable-1`+
executor rather than splitting: the deletion half (R4) is how you verify the declaration half (R1-R3)
is complete, so splitting them would leave the delete-side unable to tell whether coverage was total.

#### Frozen names

Verified against the current tree 2026-08-13, **after** task 0535 landed `roles.md`.

| Frozen | Value | Location |
| --- | --- | --- |
| Frontmatter key | `role: <scribe\|coder\|reviewer\|planner>` | every file under `plugins/sp/commands/` |
| Workflow step key | `role: <id>` beside the existing `agent:` | `config/workflows/*.yaml`, `kind: agent.run` steps |
| Config field | `role?: string` on `TeamMemberConfigSchema` object arm + `NormalizedTeamMember` | `packages/config/src/index.ts:182-196`, `:219-230` |
| Mapping source (do not re-derive) | `roles[].commands` in the YAML block | `plugins/sp/references/roles.md` § The table |
| Test to **extend** (already exists) | `plugins/sp/tests/roles.test.ts` | landed by 0535 |
| Workflow action runner | `AgentRunActionRunner` | `packages/app/src/workflow/actions/` |
| Prose to delete | `dev-operations.md:256` · `dev-refine.md:37` · `execution-workflow.md:301-310` | `plugins/sp/…` |
| Adapter to reconcile | `plugins/sp/scripts/stage-registry-adapter.ts` | 0348 Follow-up C |

**Command count is 37, not 31.** Task 0535 found the live `plugins/sp/commands/` directory holds 37
files and placed the six the decided table omitted: `dev-refineall`, `dev-find-next`,
`dev-featurechange` → `planner`; `dev-gtd` → `coder`; `dev-find-conflict`, `dev-find-issue` →
`reviewer`. Read the shipped table, not the charting-era count.

#### Anti-patterns — what not to implement

- Do **not** re-derive any command's role. `roles.md`'s `commands` list is the mapping; a command
  missing from it is a 0535 defect to route back, not a judgement call here.
- Do **not** remove the `agent:` pin from workflow steps. A pin beats role routing permanently
  (0536 R2), and `config/workflows/task-pipeline.yaml:57-59` pins deliberately so a misconfigured box
  cannot capture the run. `role:` declares the *reason*, changing nothing about today's routing.
- Do **not** create a new test file. `plugins/sp/tests/roles.test.ts` exists; extend it.
- Do **not** delete `purpose` from team members — `role` is the typed routing field, `purpose` stays
  as human annotation.
- Do **not** leave a tier literal anywhere in `plugins/sp` outside a pointer to `roles.md` (R4),
  including in the re-expressed size→tier rule.

#### Cross-task contract

**Assumes from 0535:** `roles.md` with the closed `commands` mapping over all 37 command files, and
`plugins/sp/tests/roles.test.ts` to extend. **Landed.**

**Assumes from 0536:** `--agent <role>` accepts the four ids, so a declared `role:` has somewhere to
go. **Assumes from 0537:** the materialization site already carries `executor` onto the spec — this
task adds `role` alongside it, on the same code path (`team-service.ts:666-680`), so the two must not
run concurrently in one tree.

**Leaves for dependents:**

- Task **0539** (feature I3, batch 3) audits `plugins/sp` and `config/workflows` against the live CLI
  and is sequenced *after* this task precisely so it inventories the post-migration tree.
- Task **0543** (feature M5, batch 2) promotes the `role` field this task adds to the primary axis of
  a roster. This task adds the optional field; 0543 makes `executor` optional when `role` is given.
### Plan
- [x] Add `role:` frontmatter to every command from its roles.md row and thread it into `--agent` (R1)
- [x] Add `role:` to `agent.run` steps across `config/workflows/*.yaml` and thread it through `AgentRunActionRunner` (R2)
- [x] Extend the workflow schema so a missing or unknown step role fails `spur workflow validate` (R2)
- [x] Add optional `role` to `agent.team[].members[]` and carry it onto the materialized spec (R3)
- [x] Delete the tier prose at dev-operations.md:256, dev-refine.md:37, execution-workflow.md:301-310 (R4)
- [x] Re-express the size→tier rule to read its floor from Layer 1 instead of naming `capable-1` (R4)
- [x] Reconcile `plugins/sp/scripts/stage-registry-adapter.ts` against Layer 1 (0348 Follow-up C) (R4)
- [x] Extend the plugin test to fail on a missing role or a surviving tier literal; register any residual shim (R5)
- [x] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
- **R1 — command `role:` frontmatter.** All 37 `plugins/sp/commands/*.md` declare exactly one `role:` matching their `plugins/sp/references/roles.md` row (values: scribe/coder/reviewer/planner); the invocation role is threaded into `--agent` resolution (`packages/app/src/services/agent-service.ts` — declared-role branch reads the command's role before resolution). Enforced by `plugins/sp/tests/roles.test.ts` (0538 R5 extension: a command with no `role:` fails naming the file).
- **R2 — workflow step `role:`.** Every `kind: agent.run` step across `config/workflows/*.yaml` declares a `role:` beside its `agent:` pin (0 steps missing); `packages/app/src/services/workflow-service.ts:470-477` rejects a workflow whose agent.run step has a missing/unknown role at validate time; `packages/app/src/workflow/actions/agent-run.ts` threads the step role onto the composed `spur agent run` and the step reporter surfaces it.
- **R3 — team member `role:`.** `agent.team[].members[].role` is an optional Layer-1 role (config schema `packages/config/src/index.ts`); the materializer carries it onto the spec (`team-service.ts`, `packages/app/src/services/team-service.ts:693`). A member without `role` still materializes. Team-config tests cover the typed field and the selector-namespace collision guard.
- **R4 — tier prose removed.** Deleted the duplicated tier prose at `skills/spur-dev/references/dev-operations.md`, `commands/dev-refine.md`, and `skills/spur-dev/references/execution-workflow.md` (re-expressed as pointers to Layer 1); `plugins/sp/scripts/stage-registry-adapter.ts` reconciled against Layer 1. `roles.test.ts` asserts `capable-N` literals appear only in `roles.md` + tests across `plugins/sp`.
- **R5 — enforced, not conventional.** `plugins/sp/tests/roles.test.ts` extended (17 tests): command-without-role fails naming the file; tier-literal scan; stage min_tier parity. No shim registration was needed — every command and workflow step declares a role (the shim path stays for the transition period per 0541).
- **Docs (T3).** `docs/04_DESIGN.md` records the command frontmatter, workflow step, and member `role:` fields.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | 37/37 plugins/sp/commands/*.md declare role: matching roles.md; roles.test.ts asserts presence + row match, naming the file on failure |
| R2 | MET | workflow-service.ts role validation (agent.run steps must declare a Layer-1 role); 0 steps missing; agent-run action threads role onto the composed command |
| R3 | MET | team-service.ts:693 carries member.role onto the materialized spec; member without role still materializes; team-config tests green |
| R4 | MET | tier-literal prose in plugins/sp replaced with roles.md pointers; stage-registry-adapter reconciled; roles.test.ts tier-literal scan passes |
| R5 | MET | roles.test.ts 17/17 — command-without-role fails naming the file; no shim registration needed (all declare roles) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — every command file declares role: matching its row | MET | test | roles.test.ts 'every command file declares role: matching its roles.md row, naming the file' passes; 37/37 commands |
| R2 — workflow validate rejects a step with no role | MET | test | workflow-service.test.ts role-validation block passes; agent-run step role threaded (agent-run.ts) |
| R3 — member role carried onto the materialized spec | MET | test | team-config.test.ts + team-service.test.ts member-role tests pass |
| R4 — no tier restatement outside pointers | MET | command | rg for capable-[123] across plugins/sp markdown returns only roles.md + tests; stage-registry-adapter reconciled |
| R5 — adding a command without role: fails the suite naming the file | MET | test | roles.test.ts presence test names the offending file; shim registration unnecessary (all commands/steps declare roles) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Functional traceability** — all requirements MET:

| Req | Status | Evidence |
| --- | --- | --- |
| R1 command role frontmatter | MET | 37/37 `plugins/sp/commands/*.md` declare `role:` matching roles.md rows; roles.test.ts asserts presence + row match, naming the file on failure |
| R2 workflow step role | MET | 0 agent.run steps missing `role:` across `config/workflows/*.yaml`; workflow-service.ts:470-477 rejects missing/unknown step role at validate; agent-run action threads it |
| R3 team member role | MET | `packages/config/src/index.ts:691-693` carries member.role onto the spec; member without role still materializes; team-config tests green |
| R4 tier prose removed | MET | tier literals in plugins/sp prose → roles.md pointers only; stage-registry-adapter reconciled; roles.test.ts asserts the invariant |
| R5 enforced + shims | MET | roles.test.ts 17/17 (command-no-role fails, tier-literal scan); no shim registration needed — all commands/steps declare roles |

**Priority findings** (no P1/P2):

| # | Severity | File | Finding |
| --- | --- | --- | --- |
| 1 | P4 | `plugins/sp/tests/roles.test.ts` | The tier-literal scan excludes the test file itself by design; a future test that names a tier literal inline must keep that carve-out explicit. Acceptable. |
| 2 | P4 | `config/workflows/*.yaml` | Step roles are declared today; nothing re-validates them on workflow YAML edits until `spur workflow validate` runs — the precheck/CI gate covers this. Acceptable. |

**Residual risk** — implement completed inline after a 30-min subprocess timeout (same as 0542; omp-deepseek exhausts the budget on multi-surface tasks). Full gate PASS (5042 tests, 0 fail); shim gate PASS 4/4.
### References
- **Vocabulary source:** `plugins/sp/references/roles.md` (task 0535); test to extend:
  `plugins/sp/tests/roles.test.ts`
- **R1 targets:** every file under `plugins/sp/commands/` (37 commands — 0535 reconciled the decided 31 against the live directory); dispatcher wiring per 0536
- **R2 targets:** `config/workflows/*.yaml` (10 definitions; `agent.run` steps in
  `task-pipeline.yaml`, `wrapup-pipeline.yaml`, `wayfinder-resolution.yaml`), `AgentRunActionRunner`
  (workflow `agent.run` action), workflow step schema
- **R3 targets:** `packages/config/src/index.ts:299-345` (`agent` section schema),
  `packages/app/src/services/team-service.ts:666-680` (member → spec materialization)
- **R4 deletion targets:** `plugins/sp/skills/spur-dev/references/dev-operations.md:256`,
  `plugins/sp/commands/dev-refine.md:37`,
  `plugins/sp/skills/spur-dev/references/execution-workflow.md:301-310`,
  `plugins/sp/scripts/stage-registry-adapter.ts` (0348 Follow-up C)
- **Pin that must survive:** `config/workflows/task-pipeline.yaml:56-65`
- **Prior decisions:** task 0344 § Solution D3, task 0348 (Follow-up C), feature B2 § *The role vocabulary*
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
- 2026-08-14T04:08:40.724Z todo → wip (system)
- 2026-08-14T04:10:25.195Z wip → testing (system)
- 2026-08-14T04:10:25.933Z testing → done (system)
