---
template: feature-impl
schema_version: 1
name: "Make --agent inherit run in current session for inline /sp:dev-* commands; honest two-surface agent contract"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-06-26T21:36:27.166Z"
updated_at: 2026-06-26T21:37:44.578Z
---

## 0132. Make --agent inherit run in current session for inline /sp:dev-* commands; honest two-surface agent contract

### Background
**Trigger.** Running `/sp:dev-dogfood "/sp:dev-run 0129 --auto --next" --save --task` produced a new
task (0130) instead of implementing 0129; a second dogfood produced 0131. Investigation traced this
to the `--agent` resolution semantics, not the `--task` sink (the new tasks are `--task` filing
dogfood *findings* as review tasks — working as designed).

**Root cause.** The `--agent` flag documented three values across every `/sp:dev-*` command and
backing skill — `<name> | inherit | auto` — with `inherit` described as the default meaning
"the current agent". But:

1. `inherit` was **never a real token.** `spur agent run`'s resolver (`agent-service.ts`) only
   handled `auto`, `current`, and explicit names. `inherit` fell through to `resolveAgentExplicit`
   → `resolveAgentName('inherit')` → `undefined` → exit 2 ("Unknown agent: inherit").
2. The skill convention (`cross-cutting.md:24`) said `inherit` = "omit `--agent`, the CLI default" —
   but the CLI default for `spur agent run` is `auto`, which (after the phase-aware executor work,
   commit `c768085`) resolves to the **configured default executor `omp`**, not "the current agent".
   So "inherit = current agent" was a lie at every layer: omitting the flag spawned `omp`.
3. `current` (the only token that *tried* to mean "current agent") read `$SPUR_AGENT` — but
   **nothing in the codebase ever sets `$SPUR_AGENT`** (verified: read in one place, written in
   zero). It was dead since birth; it always exited 2 unless a user manually exported the var.

**Operator decision (2026-06-26): `inherit` shall mean "current agent", realized as a two-surface
contract** — because "current agent" is achievable on one surface and physically impossible on the
other:

| Surface | `inherit` (default) | explicit `--agent <name>` / `auto` |
|---|---|---|
| **Inline** (plan / refine / brainstorm / unit) | Run the model step **in the current session** — no `spur agent run`, no subprocess | Shell out to `spur agent run` (spawn) |
| **Pipeline** (run / review / verify) | Forward nothing → the spawned step uses the configured default executor (`omp`). *Current-agent is NOT expressible* — the FSM runs a subprocess. | Spawn that agent |

The inline commands are already LLM agents running in-session; the fix is to make them **do the
synthesis inline for the default case** instead of shelling to `spur agent run`. Only an explicit
`--agent` opts into a spawn. The pipeline commands must always spawn (the dual-workflow FSM cannot
block on the calling agent), so "current agent" is documented as impossible there.

**Already landed in this session (the seed for this task):**
- Removed the dead `current` token + `$SPUR_AGENT` path from `agent-service.ts` (resolver, source
  type, `resolveAgentCurrent`); `current` is now treated as an unknown explicit name (exit 2).
- `agent.ts`: `--agent` help → `'Agent name or auto'`; dropped `current` from the `--drain` guard.
- Dogfood command + skill docs: removed the phantom `inherit` default; documented "omit → forward
  nothing" and that current-agent is not expressible for the spawned path.
- Rewrote the two `current`/`$SPUR_AGENT` tests into a single regression guard (65/65 pass).

This task carries the rest: the **inline-skill behavioral change** + the **13-file `--agent`
convention rewrite** to the honest two-surface contract.
### Acceptance Criteria
```gherkin
Feature: --agent inherit means "current agent" via an honest two-surface contract

  Scenario: Inline command default runs in the current session
    Given an inline /sp:dev-* command (plan, refine, brainstorm, or unit)
    When it is invoked with no --agent (or --agent inherit)
    Then the model/synthesis step runs in the current session
    And no `spur agent run` subprocess is spawned for that step

  Scenario: Inline command with explicit agent spawns
    Given an inline /sp:dev-* command
    When it is invoked with --agent <name> or --agent auto
    Then the model step is delegated via `spur agent run`

  Scenario: Pipeline command default uses the configured executor
    Given a pipeline /sp:dev-* command (run, review, or verify)
    When it is invoked with no --agent (or --agent inherit)
    Then the spawned agent.run steps use the configured default executor (omp)
    And the docs state that current-agent execution is not expressible on this path

  Scenario: Dead tokens are gone
    Given `spur agent run`
    When it receives --agent current or --agent inherit
    Then it is treated as an unknown explicit agent name (exit 2)
    And no code path reads $SPUR_AGENT for agent selection
```

- [ ] Inline skills (spur-dev refine/plan, brainstorm, spur-tdd/unit) run the default (inherit) model step **in-session**; `spur agent run` is invoked only for explicit `--agent <name>`/`auto`
- [ ] `cross-cutting.md` (the canonical `spur agent run` contract) rewritten: inherit = current session (no CLI call), `<name>`/`auto` = spawn
- [ ] All ~13 `/sp:dev-*` command + skill docs updated to the two-surface contract; the phantom "inherit = current agent (CLI default)" wording removed everywhere
- [ ] Pipeline command docs (dev-run/review/verify) state inherit = configured default (omp) and that current-agent is impossible (subprocess FSM)
- [ ] Dead `current`/`inherit`/`$SPUR_AGENT` resolution removed from `spur agent run` (DONE this session — verify retained)
- [ ] `report-template.md` "Testee agent" line no longer shows `inherit (default)` as a resolvable value
- [ ] `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build` green
- [ ] A dogfood of an inline command (e.g. `/sp:dev-refine`) confirms the synthesis ran in-session (no `omp` subprocess) for the default case
```
### Design

### Plan

- [ ] Implementation step

### Solution

### Testing

### Review

### References

### History
### References

**Canonical contract (the keystone — edit first):**
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:14-26` — the single `spur agent run`
  invocation contract every inline model call references. Currently: `inherit` = "omit --agent, CLI
  default" (the lie). Rewrite to: inherit = in-session, no CLI call.

**Inline commands + skills (behavioral change — default runs in-session):**
- `plugins/sp/commands/dev-plan.md` (:3,30,59), `dev-refine.md` (:3,29,62),
  `dev-brainstorm.md` (:3,32,216), `dev-unit.md` (:3,31,48)
- `plugins/sp/skills/brainstorm/SKILL.md:113` (+ examples/references that call `spur agent run`)
- `plugins/sp/skills/spur-tdd/SKILL.md`
- `plugins/sp/skills/spur-dev/references/dev-operations.md` (rows 1/5/6/12 + the per-op Inputs)

**Pipeline commands + skills (doc-only — inherit = omp, current-agent impossible):**
- `plugins/sp/commands/dev-run.md` (:3,32,48), `dev-review.md` (:3,27,39), `dev-verify.md` (:3,27,44)
- `plugins/sp/skills/spur-dev/references/execution-workflow.md:45-46,90`
- `plugins/sp/skills/code-verification/SKILL.md:76,226-227`

**Already edited this session (seed — verify, don't redo):**
- `packages/app/src/services/agent-service.ts` — removed `current`/`$SPUR_AGENT`/resolveAgentCurrent
- `apps/cli/src/commands/agent.ts` — `--agent` help + `--drain` guard
- `packages/app/tests/services/agent-service.test.ts` — `current`-is-unknown regression guard
- `plugins/sp/commands/dev-dogfood.md`, `plugins/sp/skills/dogfood-testing/SKILL.md`
- `plugins/sp/skills/dogfood-testing/references/report-template.md:29` — still shows `inherit (default)`

**Design doc:**
- `docs/design/dev-agent-flag-and-dogfood-skill.md:25` — the original `--agent` rollout design;
  update to record the two-surface contract supersedes the flat `<name|inherit|auto>` model.

**Constraint:** pipeline `agent.run` (`packages/app/src/workflow/actions/agent-run.ts`) ALWAYS
spawns a subprocess — that is correct and intended; do not try to make it run "in current agent".

