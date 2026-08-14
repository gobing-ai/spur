---
template: feature-impl
schema_version: 1
name: "Declare role across sp commands, workflow steps, and team members"
description: ""
status: todo
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0535", "0536", "0537", "0542"]
ac_numbering: task-local
created_at: "2026-08-13T23:24:34.865Z"
updated_at: "2026-08-14T00:07:39.446Z"
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
- [ ] **R1.** Every file under `plugins/sp/commands/` declares exactly one `role:` in its YAML
      frontmatter, taken from its row in `plugins/sp/references/roles.md`, and the command dispatcher
      threads it into `--agent`. Do not invent the mapping — a command with no row is a bug in 0535.
      Measurable: every command file has the key, each value is one of the four roles, and each
      matches its roles.md row.
- [ ] **R2.** Every `agent.run` step across `config/workflows/*.yaml` declares a `role:` alongside
      its `agent:` pin, `AgentRunActionRunner` threads it onto the underlying `spur agent run`, and
      the workflow schema fails validation on a missing or unknown step role. Existing `agent:` pins
      stay — a pin beats role routing permanently (0536 R2) — so this declares the *reason* without
      changing which executor runs today. Measurable: `spur workflow validate` rejects a step with no
      role; a dry-run shows the role on the composed command.
- [ ] **R3.** `agent.team[].members[]` accepts an optional `role` from the vocabulary, carried onto
      the materialized spec. A member's `purpose` prose stays as documentation; `role` is the typed
      field routing reads. Measurable: a member declaring `role: reviewer` produces a spec recording
      it; a member declaring none still materializes.
- [ ] **R4.** No file in `plugins/sp` restates a tier value outside a pointer to `roles.md`. Delete
      the duplicated prose at `skills/spur-dev/references/dev-operations.md:256`,
      `commands/dev-refine.md:37`, and `skills/spur-dev/references/execution-workflow.md:301-310`,
      re-expressing the size→tier rule so it reads its floor from Layer 1 rather than naming
      `capable-1` inline. Reconcile `plugins/sp/scripts/stage-registry-adapter.ts` against Layer 1
      (0348 Follow-up C). Measurable: a grep for tier literals across `plugins/sp` returns only
      pointers.
- [ ] **R5.** The migration is enforced, not conventional, and its shims are registered. Extend
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
### Plan
- [ ] Add `role:` frontmatter to every command from its roles.md row and thread it into `--agent` (R1)
- [ ] Add `role:` to `agent.run` steps across `config/workflows/*.yaml` and thread it through `AgentRunActionRunner` (R2)
- [ ] Extend the workflow schema so a missing or unknown step role fails `spur workflow validate` (R2)
- [ ] Add optional `role` to `agent.team[].members[]` and carry it onto the materialized spec (R3)
- [ ] Delete the tier prose at dev-operations.md:256, dev-refine.md:37, execution-workflow.md:301-310 (R4)
- [ ] Re-express the size→tier rule to read its floor from Layer 1 instead of naming `capable-1` (R4)
- [ ] Reconcile `plugins/sp/scripts/stage-registry-adapter.ts` against Layer 1 (0348 Follow-up C) (R4)
- [ ] Extend the plugin test to fail on a missing role or a surviving tier literal; register any residual shim (R5)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Vocabulary source:** `plugins/sp/references/roles.md` (task 0535); test to extend:
  `plugins/sp/tests/roles.test.ts`
- **R1 targets:** every file under `plugins/sp/commands/` (31 commands); dispatcher wiring per 0536
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
