---
schema_version: 1
name: "Streamline sp:dev-* surface: unified ops reference, verdict verb, --agent override, dev/plan split, observability DX"
status: todo
template: feature-impl
created_at: 2026-06-24T01:40:51.498Z
updated_at: 2026-06-25T21:02:56.142Z
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
### History
