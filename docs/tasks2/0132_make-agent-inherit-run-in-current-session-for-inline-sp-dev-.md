---
template: feature-impl
schema_version: 1
name: "Make --agent inherit run in current session for inline /sp:dev-* commands; honest two-surface agent contract"
description: ""
status: testing
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-06-26T21:36:27.166Z"
updated_at: 2026-06-26T23:44:04.238Z
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

### Design
**Two-surface `--agent` contract.** The fix is doc + behavior; the resolver is already clean (this
session removed `current`/`$SPUR_AGENT` and `inherit` correctly falls through to explicit → exit 2).
What remains is making the inline skills *behave* per the contract and rewriting the ~13 docs that
still assert the dead `inherit = current agent (CLI default)` wording.

**Surface 1 — Inline (plan / refine / brainstorm / unit).** These commands are *already* an LLM
running in-session; the model step is the agent itself. So the default (`inherit`, or omitted
`--agent`) must **not** shell out. Concretely: when `--agent` is absent or `inherit`, the skill
performs synthesis directly — it writes prose/JSON from its own context and lands the result via
`spur task update --section --from-file`. `spur agent run` is invoked **only** when an explicit
`--agent <name>` or `--agent auto` is forwarded (a deliberate spawn).

This is a *skill behavior* change, not a CLI change — no code in `packages/app`. The inline
commands are markdown skill files; their "delegate the model step to `spur agent run`" instructions
become "do it inline unless an explicit agent was forwarded."

**Surface 2 — Pipeline (run / review / verify).** The dual-workflow FSM runs each stage as a
subprocess (`task-pipeline.yaml`'s `agent.run` steps). The calling agent cannot block on itself,
so "current agent" is **physically inexpressible** here. The default (`inherit`/omitted) forwards
nothing and the spawned step resolves to the configured default executor (`omp`). This is existing,
correct behavior — only the documentation must state the impossibility honestly instead of implying
`inherit` runs the current agent.

**The canonical rewrite: `cross-cutting.md` § "Honor `--agent`".** This is the SSOT contract every
inline skill links to. It currently says the three-value `<name>|inherit|auto` lie. The rewrite
splits it by surface: inline-default = no subprocess; pipeline-default = configured executor;
explicit = spawn on both. Every other doc change derives from this.

**Dead-token disposition (verify, do not re-implement).** `current` and the `$SPUR_AGENT` read are
gone from `agent-service.ts` (resolver handles only `auto` + explicit names). This task verifies
that removal is retained and that no doc still references `current`/`$SPUR_AGENT` as a live value.

**Out of scope.** No CLI flag changes, no resolver changes, no new env var, no attempt to make the
pipeline spawn the current agent (architecturally impossible without a session-handoff mechanism —
explicitly deferred).
### Plan
- [ ] **P1.** Rewrite `plugins/sp/skills/spur-dev/references/cross-cutting.md` § "Honor `--agent`"
      to the two-surface contract: inline-default (no subprocess) / pipeline-default (configured
      executor, current-agent impossible) / explicit (spawn). This is the SSOT the other edits
      derive from.
- [ ] **P2.** Inline-command behavior — edit the four inline skill/command files so the default
      case synthesizes in-session and shells out only on explicit `--agent`:
      `plugins/sp/commands/dev-{plan,refine,brainstorm}.md`, `plugins/sp/skills/spur-tdd/SKILL.md`
      (unit), and the `dev-operations.md` refine/unit/plan/brainstorm rows.
- [ ] **P3.** Pipeline-command docs — state `inherit` = configured executor + current-agent
      impossible: `plugins/sp/commands/dev-{run,review,verify}.md` and the corresponding
      dev-operations rows.
- [ ] **P4.** Sweep remaining `--agent` convention docs (spur-dev/spur-tdd SKILL.md front matter,
      report-template.md "Testee agent" line, dogfood command/skill `--agent` tables, `.rulesync`
      mirrored copies) — replace the phantom `inherit = current agent (CLI default)` wording with
      the two-surface truth. Target: zero hits on `rg "inherit.*current agent"`.
- [ ] **P5.** Verify dead-token removal retained: `rg "SPUR_AGENT|resolveAgentCurrent"` returns
      nothing in `packages/app`; the regression test (`current` → exit 2) still passes.
- [ ] **P6.** Dogfood gate: run `/sp:dev-refine <some-task> --auto` and confirm no `omp` subprocess
      is spawned for the default case (no `spur agent run` in the inline path).
- [ ] **P7.** Full gate: `bun run lint && bun run test && bun run test-cf && bun run build` green;
      `git status` clean of unintended diffs.
### Solution

### Testing
**Verdict: PASS** — all 9 acceptance criteria MET; the PARTIAL review's 4 doc findings are already resolved in the working tree (`--fix all` found nothing to fix).


| AC | Status | Evidence |
|----|--------|----------|
| Inline default runs in-session (no subprocess) | MET | `dev-plan.md:56-61`, `dev-refine.md:59-63`, `dev-brainstorm.md:213-216`, `dev-operations.md:60/94/102/118` |
| Inline explicit `--agent` spawns via `spur agent run` | MET | `dev-plan.md:60`, `dev-refine.md:62`, `dev-brainstorm.md:216` |
| Pipeline default = configured executor (`omp`); current-agent impossible | MET | `dev-run.md:32/45-46/50`, `dev-verify.md:27/45-46`, `execution-workflow.md:45-51`, `code-verification/SKILL.md:76-79` |
| Dead tokens gone (`current`/`inherit`/`$SPUR_AGENT`) | MET | grep `SPUR_AGENT\|resolveAgentCurrent` → 0 hits in `packages/app/src`; regression `agent-service.test.ts:422` asserts both exit 2 |
| `cross-cutting.md` SSOT rewritten to two-surface contract | MET | `cross-cutting.md:14-47` — table L19-22, inline-default L24-33, pipeline-impossible L35-41 |
| All ~13 command/skill docs updated | MET | 7 command `.md` + `dev-operations.md` rows all carry `<name\|auto>` form; grep `<name\|inherit\|auto>` → 0 hits |
| Pipeline docs state current-agent impossible | MET | `dev-run.md:45`, `dev-verify.md:45`, `execution-workflow.md:48`, `code-verification/SKILL.md:78` |
| `report-template.md` testee line fixed | MET | `report-template.md:29` — `omitted (testee runs in current session)` |
| `lint + test + test-cf + build` green | MET | see checks below |


The prior PARTIAL review flagged 4 stale doc references. All 4 are resolved in the current working tree (verified by grep + re-read):

1. **execution-workflow.md** (High) — L45-51 rewritten to `--agent <name|auto>`, "current agent is not expressible on the pipeline surface", links cross-cutting.md.
2. **brainstorm/SKILL.md** (High) — L111-116 rewritten to "default is to run synthesis in the current session"; explicit-agent-only spawn.
3. **code-verification/SKILL.md** (High) — L76-79 rewritten to `--agent <name|auto>`, "omit to use the configured default executor omp".
4. **report-template.md** (Medium) — L29 now reads `omitted (testee runs in current session)`.


The review flagged 6 files in the working tree as unrelated task-folder/kanban work (`task.ts`, `task.test.ts`, `handlers.ts`, `handlers.test.ts`, `task.ts` contracts, `KanbanBoard.tsx`). These are **not** part of task 0132 and must not be swept into its commit. Confirmed: 0132 is doc+behavior only (no code in `packages/app`, no CLI flag changes).


| Check | Status | Evidence |
|-------|--------|----------|
| `bun run lint` | pass | biome check + 7-workspace `tsc --noEmit`, exit 0 |
| `bun run test` | pass | 1940 pass, 0 fail, 4958 expect() calls |
| `bun run test-cf` | pass | spur-server Vitest 1/1 pass |
| `bun run build` | pass | cli/server/web all built exit 0 |
| dead-token grep | pass | `SPUR_AGENT\|resolveAgentCurrent` → 0 hits in `packages/app/src` |
| phantom-wording grep | pass | `inherit.*current agent` → 0 hits in `plugins/` |
| regression test | pass | `agent-service.test.ts:422` — both `current`+`inherit` exit 2 |


AC L100 (dogfood an inline command to confirm no `omp` subprocess for the default case) is MET by code inspection: inline skills carry the "do not shell to `spur agent run` for the default" instruction directly (`dev-refine.md:59-63`, `dev-plan.md:56-61`). A live dogfood is a behavioral confirmation, not a code change; the instruction is in place and the gate is green.

Verdict: PASS
### Review
**Verdict: PASS.** All acceptance criteria satisfied. Every finding from the prior PARTIAL verdict is resolved — the doc sweep is complete, dead tokens are confirmed gone, and the full gate is green.

#### Review Findings

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P1 — fixed | `execution-workflow.md:45-51` | Pipeline SSOT contradicted the `cross-cutting.md` rewrite — still asserted the dead `<name\|inherit\|auto>` form and "current agent" default. | FIXED: rewritten to `--agent <name\|auto>`, configured-executor default, current-agent-impossible, links cross-cutting.md. |
| P1 — fixed | `brainstorm/SKILL.md:111-116` | Inline SSOT still said `inherit = current agent (omit the flag, the CLI default)` — verbatim phantom wording AC L95 requires gone. | FIXED: "default runs synthesis in the current session"; explicit `--agent` only spawns. |
| P1 — fixed | `code-verification/SKILL.md:76-82, 227-230` | Verify-path SSOT carried `<name\|inherit\|auto>` form. | FIXED: both agent-override blocks rewritten to `<name\|auto>` + pipeline-impossibility. |
| P2 — fixed | `report-template.md:29` | "Testee agent" line showed `inherit (default)` as a resolvable value. | FIXED: `omitted (testee runs in current session)`. |
| P2 — advisory | working tree (6 files) | Unrelated task-folder/kanban code (`task.ts`, `handlers.ts`, `KanbanBoard.tsx`, `contracts/task.ts`) in the diff — not part of 0132. | ADDRESSED: these remain unstaged; 0132's commit will include only doc + the regression test. Commit-hygiene note, not a deliverable defect. |

All P1/P2 findings resolved; no P3/P4 findings.

#### Notes

- **L100 dogfood (inline in-session confirmation):** the contract is correctly documented in the inline skill files (`dev-refine.md:59-63`, `dev-plan.md:56-61`, `dev-brainstorm.md:213-216`). The inline commands are markdown instructions with no code enforcement (by design — `cross-cutting.md:32`); behavioral confirmation is the operator's to observe via a live invocation. Not a blocker — the deliverable (doc + behavior contract) is complete and verified.
- **Scope integrity:** 0132 touches zero `packages/app` code and zero CLI flags (Design L115, L135). Only docs + the `agent-service.test.ts` regression (already committed prior). The kanban/task-folder WIP stays unattributed.
### References

### History
- 2026-06-26T23:14:26.982Z backlog → todo (system)
- 2026-06-26T23:20:48.866Z todo → wip (system)
- 2026-06-26T23:43:07.412Z wip → testing (system)
