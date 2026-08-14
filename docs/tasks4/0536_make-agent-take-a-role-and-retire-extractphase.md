---
template: feature-impl
schema_version: 1
name: "Make --agent take a role and retire extractPhase"
description: ""
status: todo
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0535", "0541"]
ac_numbering: task-local
created_at: "2026-08-13T23:24:34.441Z"
updated_at: "2026-08-14T00:07:31.104Z"
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
- [ ] **R1.** `--agent` accepts a role from `plugins/sp/references/roles.md` (`scribe`, `coder`,
      `reviewer`, `planner`) plus `auto`. A role selects the starting tier for resolution instead of
      the prompt text. `auto` means "use the role the caller declared" (command frontmatter or
      workflow step, wired by 0538); with nothing declared it falls to the `agent.default` role
      (0542). Measurable: `spur agent run --agent reviewer --json` reports the resolved role, tier,
      and executor, and the tier matches the role's row in `roles.md`.
- [ ] **R2.** An explicit executor name remains accepted as a **permanent** pin, not a shim. This is
      a safety property, not compatibility: `config/workflows/task-pipeline.yaml:57-59` pins
      deliberately "so a broken/misconfigured agent on the box can't silently capture the run", and
      `:65` / `:158-160` let `agent` and `implementAgent` diverge with the precheck probing both. A
      pin beats role routing; the role is still recorded for attribution; the pin emits no
      deprecation warning. Measurable: a test asserts the pinned executor ran, the `--json` envelope
      carries both values, and stderr carries no deprecation line.
- [ ] **R3.** A value that is neither a role, a configured executor, nor `auto` is rejected at the
      flag boundary before any spawn. Bare coding-agent binary names (`codex`, `omp`, `claude` with
      no matching executor entry) are accepted for the transition under a shim registered per 0541,
      with removal condition "no bare-binary `--agent` value remains in `docs/`, `config/workflows/`,
      or `plugins/sp/`". Measurable: an unknown value exits non-zero naming both accepted sets and
      spawns nothing; a bare binary name warns once and runs.
- [ ] **R4.** Delete `extractPhase` (`packages/app/src/services/agent-service.ts:1511`) and its call
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
### Plan
- [ ] Parse the four role ids from `plugins/sp/references/roles.md` at the CLI boundary (R1)
- [ ] Extend `resolveExecutorSelector` with a role branch routing from the role's tier (R1)
- [ ] Emit resolved role, tier, and executor in the `--json` envelope (R1)
- [ ] Keep an explicit executor name as a permanent pin that beats role routing, with no warning (R2)
- [ ] Reject unknown values at the flag boundary before any spawn, naming both accepted sets (R3)
- [ ] Accept bare binary names with a one-time warning and register the shim in `config/transition-shims.json` (R3)
- [ ] Delete `extractPhase` and its call site at `agent-service.ts:1018` (R4)
- [ ] Update `docs/04_DESIGN.md` and the `sp:spur-cli` agent reference in the same commit; amend ADR-033 (R4)
- [ ] Run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
### History
