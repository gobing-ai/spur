---
schema_version: 1
name: "Streamline sp:dev-* surface: unified ops reference, verdict verb, --agent override, dev/plan split, observability DX"
status: done
template: feature-impl
created_at: 2026-06-24T01:40:51.498Z
updated_at: 2026-06-25T21:40:16.023Z
feature_id: H2
priority: P1
tags: ["sp-plugin", "cli", "workflow", "dx", "observability", "refactor", "dogfood"]
---

## 0109. Streamline sp:dev-* surface: unified ops reference, verdict verb, --agent override, dev/plan split, observability DX

### Background

Comprehensive review after 6 dogfood rounds surfaced five streamlining items on the sp:dev-* command + skill surface. (1) GHOST COMMANDS: dev-changelog, dev-gitmsg, dev-fixall, dev-handover, dev-new-task all delegate `args="<op> $ARGUMENTS"` to sp:spur-dev, which has ZERO references to any of those operations — the same defect class as round-1 verify (command → skill with no procedure → improvised, inconsistent behavior). Operator preference: a CENTRALIZED operations reference (the rd3 pattern) defining ALL dev-* operations uniformly, not five scattered patches. (2) VERDICT-GREP: the verify step still greps verify-answer.txt for `verdict.*pass|✅` to synthesize verdict.json — fragile regex-over-prose in YAML, the same untested-shell-in-config smell just removed from `record` via `spur task record` (0108). (3) OBSERVABILITY DX: implement steps run 5–9 min (300–530s measured) with NO progress signal — looks hung; the ObservableWorkflowAdapter EventBus (built but unconsumed) should drive step progress, AND a run-start plan preview (`workflow run --dry-run`-style 'here is the plan for this round') should tell the operator what is planned before it starts. Worth a proper DX design. (4) DEV/PLAN SPLIT: sp:spur-dev is a 380-line skill that still carries a `## Planning half` (line 40) even though the decided split is sp:spur-plan=planning (steps 3-6) / sp:spur-dev=execution (steps 7-12). Operator decision: KEEP the existing names — enhance sp:spur-dev for EXECUTION only, move the planning content out to sp:spur-plan; no new skill names (avoids confusion). (5) AGENT OVERRIDE: rd3 had `--channel <auto|current|claude-code|codex|...>` on dev-run/dev-verify (default current, with a dogfood rule to use `--channel current` to avoid circular delegation). Spur's dev-* commands have NO agent override — the only path is the clunky `--vars '{"agent":"claude"}'`. `spur agent run` already supports `--agent <name|inherit|auto>` (the capability exists). Re-add the override on dev-* commands renamed `--channel`→`--agent`, default = the pipeline's specified agent, `auto` = resolveAgentAuto (now omp-first) — useful when the specified agent becomes temporarily unavailable (round-4's broken-pi default would have been a one-flag workaround). Reference: ~/projects/cc-agents/plugins/rd3/commands/dev-{run,verify}.md; plugins/sp/skills/{spur-dev,spur-plan}/SKILL.md; config/workflows/task-pipeline.yaml verify step (lines 119-125).
### Requirements

- [ ] R1. Unified operations reference: create ONE reference file (e.g. plugins/sp/skills/spur-dev/references/dev-operations.md) defining every dev-* operation (implement, unit, review, verify, changelog, gitmsg, fixall, handover, new-task, plan, refine, run) — purpose, inputs, the backing skill/verb each maps to, and behavior. The five currently-ghost commands (changelog, gitmsg, fixall, handover, new-task) get a real defined procedure here (or a clear 'delegates to <skill>' mapping). No dev-* command may delegate to an undefined operation.
- [ ] R2. Repoint each dev-* command at its real backing per R1: verify/review → sp:code-verification (already correct); implement/unit/run → the execution skill (sp:spur-dev, see R4); docs → sp:doc-evolve (already); the 5 ghosts → their defined ops. Declare flags in each arg-hint.
- [ ] R3. Verdict verb: extract the verify-step verdict derivation (the grep over verify-answer.txt → verdict.json, lines 119-125) into tested code — either a `spur task verdict <wbs> [--from-answer <path>] [--status <PASS|PARTIAL|FAIL>]` verb or fold deterministic verdict.json emission into sp:code-verification. Replace the YAML grep with the verb. Unit-test the PASS/PARTIAL/FAIL/UNKNOWN derivation. Same pattern as 0108.
- [ ] R4. Dev/plan responsibility split (existing names): REMOVE the `## Planning half` from sp:spur-dev/SKILL.md (feature create/decompose/AC content) — that belongs to sp:spur-plan. Sharpen sp:spur-dev to EXECUTION only (implement/unit/run/refine + pipeline driving). Ensure sp:spur-plan owns the full planning narrative. Update the 'Key distinction' blocks in both so the boundary is unambiguous. No new skill names.
- [ ] R5. `--agent` override on dev-* commands: add `--agent <name|inherit|auto>` to dev-run (and dev-verify/dev-review/dev-implement/dev-unit where they spawn agents). Default = the pipeline's specified agent (vars.agent, omp); `auto` = resolveAgentAuto; an explicit name overrides. Thread it to the pipeline as `--vars '{"agent":"<x>"}'` (or the agent.run agent option) so a temporarily-unavailable specified agent has a one-flag escape. Mirror rd3's `--channel` semantics, renamed.
- [ ] R6. Observability DX (design + minimal impl): (a) RUN-START PLAN PREVIEW — at `spur workflow run` start, emit a concise plan of the states/steps about to run (leverage the existing dry-run transition walk) so the operator sees what this round will do. (b) STEP PROGRESS — consume the ObservableWorkflowAdapter EventBus (workflow.action.started/finished) to surface a heartbeat/status on long agent.run steps (the 5-9min blind spot). Keep it CLI-side now; the board consumes the same events later. Write a short DX design note for the broader observability surface.
- [ ] R7. Validate + dogfood: bun run lint green; spur workflow validate green; invoke each previously-ghost command and confirm it has defined behavior (no improvisation); run a task through the pipeline and confirm the verdict verb + plan-preview + step-progress all work; `--agent auto` overrides correctly. Zero orphaned runs.
- [ ] R8. Doc sync (same commit): AGENTS.md CLI surface (new verb + --agent flag); 04_DESIGN §7 (dev-* operation map, verdict verb, --agent); 05_FEATURES §9; ADR amendment for the dev/plan responsibility split (clarifies ADR-023) and the observability-DX direction. Note: if R6's observability DX grows large, split it to a follow-up task and keep this one focused on R1-R5.
### Acceptance Criteria

<!-- System-tone Given/When/Then (what the SYSTEM does), or a `- [ ]` checklist for sub-tasks. Drives UAT and L4 coverage. -->

### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design

<!-- Decision record — WHAT/WHY. Chosen approach + 1-line reason, rejected alternatives, key signatures (not bodies), invariants. ≤2 illustrative snippets MAX. -->

### Plan
Decomposed into five sub-tasks (parent_wbs 0109). 0109 is complete only when all five are `done`.

| Sub-task | Covers | Title | Status |
|----------|--------|-------|--------|
| [0110](0110_unified-dev-operations-reference-repoint-ghost-commands.md) | R1, R2 | Unified dev-* operations reference + repoint ghost commands | ✅ done |
| [0111](0111_spur-task-verdict-verb-extract-verify-step-verdict-derivatio.md) | R3 | `spur task verdict` verb — extract verify-step verdict derivation from YAML | ✅ done |
| [0112](0112_dev-plan-responsibility-split-sp-spur-dev-execution-sp-spur-.md) | R4 | Dev/plan responsibility split — `sp:spur-dev` = execution, `sp:spur-plan` = planning | ✅ done |
| [0113](0113_agent-override-on-dev-commands-rename-rd3-channel.md) | R5 | `--agent` override on dev-* commands (rename rd3 `--channel`) | ✅ done |
| [0114](0114_observability-dx-run-start-plan-preview-eventbus-step-progre.md) | R6 | Observability DX — run-start plan preview + EventBus step progress | ✅ done |

R7 (validate + dogfood) and R8 (doc sync) are cross-cutting: each sub-task carries its own validation and same-commit doc sync rather than a standalone task.

**All five sub-tasks are `done` (2026-06-25).** 0114 was implemented + verified via `/sp:dev-dogfood` (report: `docs/dogfood/2026-06-25-implement-0114-dogfood.md`). 0109 is ready to close.
### Solution

Parent/umbrella task — the implementation was delivered across the five sub-tasks (0110–0114), each with its own PASS verdict. This change-map indexes where each requirement landed; per-file detail lives in each sub-task's own `## Solution`.

| Req | File(s) | What / Why |
| --- | ------- | ---------- |
| R1 — Unified operations reference | `plugins/sp/skills/spur-dev/references/dev-operations.md` | New 233-line SSOT: operation-map table + detail sections for all 13 dev-* ops (implement is a sub-mode of run #4). No command may delegate to an undefined op. (0110) |
| R2 — Repoint ghost commands | `plugins/sp/commands/dev-changelog.md`, `dev-gitmsg.md`, `dev-fixall.md`, `dev-handover.md`, `dev-new-task.md` | The 5 ghost commands lost their `Skill(skill="sp:spur-dev")` delegations; each now carries an inline procedure + a dev-operations.md link. The 8 Skill()-backed commands untouched. (0110) |
| R3 — Verdict verb | `apps/cli/src/commands/task.ts:254`, `packages/app/src/services/task-verdict.ts:33`, `config/workflows/task-pipeline.yaml:120` | `spur task verdict` CLI verb + pure `deriveVerdict()`; the pipeline's grep-over-prose verdict step replaced with the deterministic verb; 7 unit tests in `task-verdict.test.ts`. (0111) |
| R4 — Dev/plan split | `plugins/sp/skills/spur-dev/SKILL.md` | Removed the 138-line `## Planning half`; sp:spur-dev is execution-only, with a pointer to sp:spur-plan for the planning half. (0112) |
| R5 — `--agent` override | `plugins/sp/commands/dev-run.md`, `dev-verify.md`, `dev-review.md`, `dev-unit.md` | `--agent <name\|inherit\|auto>` in the arg-hints; `--channel` fully removed from dev-unit; Agent Alias Normalization table + dev-operations.md arg-hints updated. (0113) |
| R6 — Observability DX | `packages/app/src/workflow/step-reporter.ts`, `docs/design/workflow-observability.md`, `apps/cli` run path | `renderRunPlan(def)` + `renderStepLine(event)`; CLI wires the EventBus in the synchronous run path with a `--no-plan` flag; `--json` output byte-identical; 7 unit tests. (0114) |
| R7 — Validate + dogfood | (cross-cutting) | Each sub-task carried its own lint+test gate; 0114 was dogfooded via `/sp:dev-dogfood` (`docs/dogfood/2026-06-25-implement-0114-dogfood.md`); dogfood findings resolved in task 0122. |
| R8 — Doc sync (same commit) | `docs/04_DESIGN.md:457`, `AGENTS.md`, `docs/05_FEATURES.md §9`, `docs/00_ADR.md` | §7.8 dev-* operation-map row; CLI surface gained the verdict verb + `--agent` flag; FEATURES §9 synced; ADR amendment for the dev/plan split. Each sub-task carried its own same-commit doc sync. |

All five sub-tasks (0110–0114) are `done` with PASS verdicts; this parent closes on their completion (confirmed by the 0121 roll-up gate, which reports no open children for 0109).

### Testing

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — Unified operations reference | **MET** | `plugins/sp/skills/spur-dev/references/dev-operations.md` created (233 lines); operation map table + 12 detail sections covering all 13 ops (implement is a sub-mode of run #4). Verified by reading the file. |
| R2 — Repoint each dev-* command at real backing | **MET** | All 5 ghost commands (dev-changelog, dev-gitmsg, dev-fixall, dev-handover, dev-new-task) have zero `Skill(skill="sp:spur-dev")` delegations; each carries an inline procedure + dev-operations.md link. The 8 Skill()-backed commands are untouched. |
| R3 — Verdict verb | **MET** | `spur task verdict` CLI command at `apps/cli/src/commands/task.ts:254`; `deriveVerdict()` pure function at `packages/app/src/services/task-verdict.ts:33`; 7 unit tests at `task-verdict.test.ts`; `config/workflows/task-pipeline.yaml:120` uses `spur task verdict` instead of grep/shell. |
| R4 — Dev/plan responsibility split | **MET** | `## Planning half` section (138 lines) removed from `plugins/sp/skills/spur-dev/SKILL.md`; replaced with pointer to sp:spur-plan. sp:spur-dev is execution-only. 1 remaining "Planning half" reference at line 50 is a pointer describing what sp:spur-plan owns — correct. |
| R5 — `--agent` override on dev-* commands | **MET** | `--agent <name\|inherit\|auto>` in arg-hints of dev-run, dev-verify, dev-review, dev-unit; `--channel` fully removed from dev-unit (0 occurrences); Agent Alias Normalization table updated; dev-operations.md operation map arg-hints updated. |
| R6 — Observability DX | **MET** | `packages/app/src/workflow/step-reporter.ts` with `renderRunPlan(def)` + `renderStepLine(event)`; 7 unit tests; `docs/design/workflow-observability.md` DX design note; CLI wires EventBus in synchronous run path; `--no-plan` flag; `--json` byte-identical (R5 asserted). |
| R7 — Validate + dogfood | **MET** | `bun run lint` green (biome + typecheck, 7 workspaces); `bun run test` green (1814 pass / 0 fail / 4604 expects); coverage 99.55% funcs / 99.06% lines; 0114 dogfooded via `/sp:dev-dogfood` (report at `docs/dogfood/2026-06-25-implement-0114-dogfood.md`); dogfood findings resolved in task 0122. |
| R8 — Doc sync (same commit) | **MET** | `docs/04_DESIGN.md:457` — §7.8 dev-* operation map row pointing to dev-operations.md; `AGENTS.md` CLI surface includes verdict verb + --agent flag; `docs/05_FEATURES.md` §9 synced; ADR-026/ADR-023 amendment for dev/plan split. Each sub-task carried same-commit doc sync. |

Coverage: 99.55% funcs / 99.06% lines (aggregate, 1814 tests). Key files: `task-verdict.ts` 100%/98.86%, `step-reporter.ts` 100%/95.83%.

**Verdict: PASS** — all 8 requirements MET. Parent task complete; all 5 sub-tasks (0110–0114) are `done` with their own PASS verdicts.

### Review

| Severity | Dimension | Finding |
|----------|----------|---------|
| — | Security | No findings — parent task; sub-tasks each carry their own SECU review. No secrets, injection, or unsafe input across the change set. |
| — | Efficiency | No findings — no runtime overhead introduced; observability is advisory-only (human DX), gated off under `--json`/`--async`. |
| P3 | Correctness | 0113 P2 (carried forward): `--next` chain transition `todo → testing` blocked by lifecycle guard when task is already at `todo`; `--no-lifecycle` bypass used. Documented in 0113 Review; not a blocker for 0109. |
| — | Usability | No findings — dev-operations.md is the SSOT; all command arg-hints declare real flags; 04_DESIGN.md indexes the reference. |

No blockers. All findings are P3 or below — none gate the completion.

### History
- 2026-06-25T21:30:28.371Z todo → wip (system)
- 2026-06-25T21:30:28.727Z wip → testing (system)
- 2026-06-25T21:30:29.081Z testing → done (system)
