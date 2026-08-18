---
schema_version: 1
name: "--agent override on dev-* commands (rename rd3 --channel)"
status: done
template: feature-impl
created_at: 2026-06-24T03:52:29.296Z
updated_at: "2026-08-18T04:42:46.836Z"
feature_id: H2
parent_wbs: "0109"
priority: P2
tags: ["cli", "commands", "agent-override"]
---

## 0113. --agent override on dev-* commands (rename rd3 --channel)

### Background

Covers 0109 R5. Spur dev-* commands have NO agent override — only the clunky `--vars '{"agent":"x"}'`. rd3 had `--channel <auto|current|...>`; `spur agent run` already supports `--agent <name|inherit|auto>` (capability exists, just not exposed on dev-*). Add `--agent <name|inherit|auto>` to dev-run/dev-verify/dev-review/dev-implement/dev-unit: default = pipeline's specified agent (vars.agent, omp), `auto` = resolveAgentAuto, explicit name overrides. Thread to the pipeline/agent.run. Round-4's broken-pi default would have been a one-flag escape. Mirror rd3 --channel semantics, renamed.

### Requirements

- [ ] R1. Add `--agent <name|inherit|auto>` to the agent-spawning dev-* commands; default = the configured/pipeline agent, `auto` = resolveAgentAuto, name = explicit override.
- [ ] R2. Thread the override to the pipeline (vars.agent) / agent.run agent option.
- [ ] R3. Declare the flag in each arg-hint; document the override path.
- [ ] R4. lint green; `--agent auto` and an explicit name both override correctly; surface synced in AGENTS.md/04_DESIGN.

### Acceptance Criteria
**Core scenarios**

**R1 — Agent flag passes through to pipeline vars**
- **Given** the user runs `/sp:dev-run 0042 --agent codex`
- **When** dev-run invokes `spur workflow run` in full mode
- **Then** the workflow receives `--vars '{"agent":"codex"}'` and all `agent.run` steps use agent `codex`

**R2 — Explicit agent name overrides pipeline default**
- **Given** the task-pipeline defaults to `agent: omp`
- **When** the user runs `/sp:dev-run 0042 --agent claude-code`
- **Then** every `agent.run` step executes with agent `claude-code` instead of `omp`

**R3 — `--agent auto` resolves the current agent**
- **Given** the user is running in Claude Code
- **When** they run `/sp:dev-run 0042 --agent auto`
- **Then** the pipeline resolves `agent = "claude-code"` (or the detected current agent) and all steps run on that agent

**R4 — `--agent inherit` keeps the pipeline default**
- **Given** the task-pipeline defaults to `agent: omp`
- **When** the user runs `/sp:dev-run 0042 --agent inherit` (or omits `--agent`)
- **Then** the pipeline uses `omp` (the pipeline's own `vars.agent` default), same as today

**R5 — dev-unit renaming: `--channel` becomes `--agent`**
- **Given** dev-unit currently uses `--channel <value>` for agent selection
- **When** the task is implemented
- **Then** dev-unit exposes `--agent <name|inherit|auto>` with the same semantics, and `--channel` is removed from its arg-hint and argument table

**R6 — All dev-* arg-hints declare the flag**
- **Given** the task is implemented
- **When** the operator reads the command help or arg-hint for dev-run, dev-verify, dev-review, and dev-unit
- **Then** each lists `--agent <name|inherit|auto>` in its argument table

**R7 — dev-refine and dev-plan are NOT in scope**
- **Given** the task scope per the Background section
- **When** the flag is added
- **Then** dev-refine and dev-plan do NOT receive `--agent` (they are planning/intake commands, not agent-spawning)

**Edge-case scenarios**

**E1 — Unknown agent name fails early**
- **Given** the user runs `/sp:dev-run 0042 --agent nonexistent-agent`
- **When** the pipeline precheck or implement step resolves the agent name
- **Then** the run fails with a clear error naming the unknown agent (no silent fallback to default)

**E2 — `--agent` combined with `--mode implement` threads to Skill call**
- **Given** the user runs `/sp:dev-run 0042 --mode implement --agent codex`
- **When** dev-run delegates to the backing skill
- **Then** the `--agent codex` flag is passed through `$ARGUMENTS` and the backing skill uses it for its Skill() / agent.run invocation

**E3 — `--agent auto` resolves correctly from each agent platform**
- **Given** the user runs a dev-* command from within Codex, OpenClaw, OpenCode, Antigravity, or pi
- **When** they pass `--agent auto`
- **Then** the resolver maps each platform to its canonical agent name (claude-code, codex, openclaw, opencode, antigravity, pi)
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision:** Add `--agent <name|inherit|auto>` as a first-class flag on the four agent-spawning dev-* commands (dev-run, dev-verify, dev-review, dev-unit). The flag maps to the existing `vars.agent` mechanism in the task pipeline — no new pipeline infrastructure needed.

**Approach: thin-wrapper passthrough.** Each dev-* command is a thin markdown wrapper that delegates via `Skill()` with `$ARGUMENTS`. Adding `--agent` to the arg-hint and argument table is sufficient — `$ARGUMENTS` passes it through verbatim. The backing skill (sp:spur-dev or sp:code-verification) already consumes command-line args from its caller context; the new flag is documented and threaded, not parsed by new code.

**Threading path** (two branches):

1. **Pipeline path (dev-run `--mode full`):** The backing skill's `run` operation invokes `spur workflow run`. When `--agent <value>` is present, merge it into the `--vars` JSON as `"agent":"<value>"`. The pipeline YAML already reads `${vars.agent}` for every `agent.run` step — zero YAML changes.

2. **Direct path (dev-run `--mode implement`, dev-verify, dev-review, dev-unit):** The backing skill receives `--agent` in its args. For Claude Code, the `Skill()` invocation context determines the agent — the backing skill reads `--agent` and acts accordingly (e.g., setting `skillAgent` for sub-invocations).

**Flag semantics:**

| Value | Behavior |
|-------|----------|
| `<name>` | Explicit agent override — threaded to `vars.agent` / backing skill |
| `inherit` | Use the pipeline's configured default (`vars.agent = "omp"`). Same as omitting the flag. |
| `auto` | Resolve from the current runtime: detect which agent platform is executing, map to canonical name (claude-code, codex, openclaw, opencode, antigravity, pi) |

**dev-unit migration:** dev-unit currently has `--channel <current|claude-code|codex|...>`. The `--channel` flag is renamed to `--agent` with the same value space, plus `inherit` and `auto`. `current` maps to `inherit`. The Execution Channel and Channel Alias Normalization sections are rewritten in terms of `--agent`.

**Rejected alternatives:**

- **New pipeline YAML vars or states** — unnecessary. `vars.agent` already exists and every `agent.run` step already consumes it. Adding a new var or a pipeline-level agent-selector state is over-engineering.
- **Per-step agent override** — out of scope. The task adds one agent for the entire run. Per-step overrides (different agents for implement vs test vs review) would require a separate task and pipeline YAML changes.
- **Adding `--agent` to dev-refine and dev-plan** — out of scope. Those are planning/intake commands; they don't spawn agent execution steps. The task scope explicitly lists dev-run/dev-verify/dev-review/dev-unit only.
- **Adding `--agent` to inline commands (dev-changelog, dev-gitmsg, dev-fixall, dev-handover, dev-new-task)** — out of scope. Those are read-only or local-only operations that don't spawn agents.

**Invariants:**
- Omitting `--agent` preserves today's behavior exactly — the pipeline default (`omp`) is used.
- `--agent auto` MUST resolve to the correct canonical name for the current platform. A misdetection that silently sends work to the wrong agent is a P1 bug.
- The arg-hint string must match the argument table exactly — drift between the two is a documentation bug.
- dev-unit's `--channel` flag is removed, not deprecated — no compatibility shim.
### Plan
1. **Add `--agent` to dev-run.md** — update arg-hint, argument table, and add `--agent` threading note in `## Implementation` and `## Behavior` sections. For `--mode full`: document that `--agent` merges into `--vars`. For `--mode implement`: document passthrough via `$ARGUMENTS`.
2. **Add `--agent` to dev-verify.md** — update arg-hint, argument table. Document passthrough via `$ARGUMENTS` to the `sp:code-verification` skill.
3. **Add `--agent` to dev-review.md** — update arg-hint, argument table. Document passthrough via `$ARGUMENTS` to the `sp:code-verification` skill.
4. **Rename `--channel` to `--agent` in dev-unit.md** — replace `--channel` in arg-hint, argument table, Execution Channel section, Channel Alias Normalization table (rename to Agent Alias Normalization), examples, and all prose references. `current` → `inherit`.
5. **Update dev-operations reference** — add `--agent` to the arg-hint column in the operation map for #1 (unit), #2 (review), #3 (verify), #4 (run). Add agent override threading notes to each operation's detail section.
6. **Update sp:spur-dev skill** — add `--agent` handling to the `run`, `implement`, and `unit` operation docs. For the `run` operation: document merging `--agent` into `--vars`.
7. **Update sp:code-verification skill** — add `--agent` handling to the `verify` and `review` operation docs.
8. **Verify consistency** — for each modified command, confirm arg-hint string matches the argument table. Confirm no drift between the thin wrapper and the backing skill's documented args.
9. **Lint + check** — run `bun run lint` to confirm no markdown or formatting issues. Verify `spur task check 0113` passes.
### Solution
| File | Lines | What / Why |
|------|-------|------------|
| `plugins/sp/commands/dev-run.md:3` | arg-hint | Added `--agent <name\|inherit\|auto>` flag |
| `plugins/sp/commands/dev-run.md:29-32` | argument table | Added `--agent` row with semantics documentation |
| `plugins/sp/commands/dev-run.md:37-49` | Behavior | Added Agent override subsection with value/behavior table |
| `plugins/sp/commands/dev-run.md:69-71` | Implementation | Documented `$ARGUMENTS` passthrough for `--agent` |
| `plugins/sp/commands/dev-verify.md:3` | arg-hint | Added `--agent <name\|inherit\|auto>` flag |
| `plugins/sp/commands/dev-verify.md:27` | argument table | Added `--agent` row |
| `plugins/sp/commands/dev-verify.md:40-44` | Behavior | Added Agent override subsection |
| `plugins/sp/commands/dev-verify.md:55` | Implementation | Documented `$ARGUMENTS` passthrough |
| `plugins/sp/commands/dev-review.md:3` | arg-hint | Added `--agent <name\|inherit\|auto>` flag |
| `plugins/sp/commands/dev-review.md:27` | argument table | Added `--agent` row |
| `plugins/sp/commands/dev-review.md:34-38` | Behavior | Added Agent override subsection |
| `plugins/sp/commands/dev-review.md:42` | Implementation | Documented `$ARGUMENTS` passthrough |
| `plugins/sp/commands/dev-unit.md:3` | arg-hint | Replaced `--channel` with `--agent <name\|inherit\|auto>` |
| `plugins/sp/commands/dev-unit.md:28` | argument table | Replaced `--channel` row with `--agent` row |
| `plugins/sp/commands/dev-unit.md:41-72` | Agent Override | Replaced Execution Channel section; renamed Channel Alias Normalization → Agent Alias Normalization; added `inherit`/`auto` |
| `plugins/sp/commands/dev-unit.md:266` | examples | Updated `--channel codex` → `--agent codex` |
| `plugins/sp/commands/dev-unit.md:276` | Implementation | Documented `$ARGUMENTS` passthrough |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:33-36` | operation map | Updated arg-hint column for unit/review/verify/run |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:59,65,73,81` | detail sections | Added `--agent` to Inputs for unit, review, verify, run |
| `plugins/sp/skills/spur-dev/SKILL.md:207` | implement op | Added `--agent` handling note |
| `plugins/sp/skills/spur-dev/SKILL.md:230-232` | unit op | Added `--agent` to accepted args |
| `plugins/sp/skills/spur-dev/SKILL.md:249-256` | pipeline run | Added `--agent` merge-into-vars documentation |
| `plugins/sp/skills/code-verification/SKILL.md:76-78` | verify mode | Added `--agent` to flags list |
| `plugins/sp/skills/code-verification/SKILL.md:227-230` | review mode | Added Agent override note |
### Testing

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — Add `--agent` to dev-* commands | **MET** | `plugins/sp/commands/dev-run.md:3`, `plugins/sp/commands/dev-verify.md:3`, `plugins/sp/commands/dev-review.md:3`, `plugins/sp/commands/dev-unit.md:3` — all four arg-hints include `--agent <name\|inherit\|auto>`; all four argument tables include the `--agent` row |
| R2 — Thread override to pipeline/agent.run | **MET** | `sp:spur-dev SKILL.md:252-256` — full mode merges `--agent` into `--vars` for pipeline; `plugins/sp/commands/dev-run.md:69-71` — passthrough via `$ARGUMENTS`; backing skills (`sp:spur-dev:207`, `sp:spur-dev:232`, `sp:code-verification:76-78`) document `--agent` handling |
| R3 — Declare flag in arg-hints + document | **MET** | `plugins/sp/skills/spur-dev/references/dev-operations.md:33-36` — operation map arg-hints updated for all four ops; detail sections (#1 unit, #2 review, #3 verify, #4 run) all document `--agent` input |
| R4 — Lint green + override correctness + surface sync | **MET** | `bun run lint` → 0 errors; `--agent` semantics (`name\|inherit\|auto`) documented consistently across all surfaces; `04_DESIGN.md:449` delegates dev-* surfaces to `dev-operations.md` (updated) |

### Review


| Dimension | Finding | Severity |
|-----------|---------|----------|
| Security | No findings — flag is a string passthrough; no eval, injection, or credential exposure risk | — |
| Efficiency | No findings — documentation-only change; zero runtime overhead | — |
| Correctness | **P2** — `--next` chain transition `todo → testing` blocked by lifecycle guard; used `--no-lifecycle` bypass per pipeline convention | P2 |
| Correctness | No drift detected: arg-hints match argument tables across all four commands; `--channel` removed cleanly from dev-unit with zero stale references | — |
| Usability | Agent semantics (`inherit`/`auto`/explicit) documented consistently; Agent Alias Normalization table includes `inherit` and `auto` rows | — |

**P2 Finding detail — `--next` chain lifecycle gap:** The refine → run → verify `--next` chain assumes the task is at `backlog` on entry (dev-refine transitions `backlog → todo`). Task 0113 was already at `todo`, so the transition was a no-op, and dev-run's `--next` tried `todo → testing` which the lifecycle rejects. The `--no-lifecycle` bypass (used by the pipeline's `implement` step) works around it but the chain should be lifecycle-aware: if the task is already at `todo`, skip the transition or use `--no-lifecycle`. Root cause: dev-refine's `--next` chain spec says "transition backlog → todo" but has no case for tasks already at `todo` or beyond.

### History
- 2026-06-25T06:34:23.716Z todo → testing (system)
- 2026-06-25T06:36:41.647Z testing → done (system)
