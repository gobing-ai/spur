---
template: feature-impl
schema_version: 1
name: "Make sp:spur-cli an executable surface SSOT — add missing task verbs, fix section set"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: "0314"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-23T06:11:57.566Z"
updated_at: "2026-07-23T06:18:39.959Z"
---

## 0317. Make sp:spur-cli an executable surface SSOT — add missing task verbs, fix section set

### Background
Decomposed from parent **0314** (feature O) — read 0314 for the full audit and cross-cutting rationale. This subtask owns **`sp:spur-cli` only**. It is independent of the command wrappers (0315/0316): it touches `skills/spur-cli/` plus AGENTS/skill wording, not `commands/`.

Verified gaps against the current tree:

- `references/tasks/verbs.md` has no entries for `deps`, `sections`, or `run-link`, though all three verbs ship in `apps/cli/src/commands/task.ts`.
- `references/tasks/section-editing.md` lists the canonical set as `Background, Acceptance Criteria, Plan, Solution, Testing, Review, References, History` and **omits** `Requirements`, `Q&A`, `Design`, and the universal `Notes` (the live matrix has `UNIVERSAL_SECTIONS = ['History','References','Notes']` — `packages/domain/src/planning/markdown-document.ts`).
- Because the reference is incomplete/stale, agents fall back to `spur --help` / per-verb help, which burns tokens, drifts across sessions, and invites invented flags.

Scope is the **evidenced delta, not a full CLI mirror**.
### Requirements
- R7. Close the evidenced `sp:spur-cli` gaps and make the four high-frequency nouns executable from the reference alone — not a thin pointer that forces `spur --help`. Scope is the evidenced delta, not a full CLI mirror.
  - **Tier A — executable without `--help`:** `task`, `feature`, `rule`, `workflow`. For `task`, add the missing `deps`, `sections`, `run-link` verbs and correct the canonical section set (add `Requirements`, `Q&A`, `Design`, universal `Notes`). Each shipped verb gets a copy-pasteable invocation, key flags, `--json` shape where it emits JSON, exit codes, and the CLI-gated write contract. Document from `apps/cli/src/commands/*.ts` / live `--help`; do not invent flags.
  - **Tier B — light index:** `status` and `init` (flags + when-to-use) plus a one-line router for the remaining top-level nouns (`agent`, `history`, `message`, `team`, `migrate`, `serve`) pointing to `--help` for deep flags.
  - **Tier C — last-resort `--help`:** deep long-tail for the Tier B nouns; no raw full-tree help dumps in any reference.
  - **Layering:** `SKILL.md` stays a lean noun router; catalogs live under `references/`. Update `tasks.md`, `tasks/verbs.md`, `tasks/section-editing.md`, and peer noun references only as the delta requires.

- R9 (slice). Add a reference↔live-CLI parity assertion for the Tier A verb set: verb names documented in references must be a subset of live CLI help, and critically-missing verbs fail loud. Full flag-matrix generation is optional; verb presence + a critical-flag smoke is enough.

- R11 (slice). Update AGENTS / skill wording so agents treat `sp:spur-cli` as the execute-from-reference path and `--help` as last-resort (not the default per-turn lookup); add a changelog entry.

- R12 (slice). Cold-agent dogfood: a fresh session runs at least one each of `task`/`feature`/`rule`/`workflow` Tier A recipes using only the skill references (no `--help`). Fix bounded findings; run the full quality gate.
### Acceptance Criteria
```gherkin
Feature: sp:spur-cli as an executable surface SSOT

  Scenario: R7 - Tier A nouns are executable without --help
    Given the monorepo spur CLI verbs for task, feature, rule, and workflow
    When an agent loads sp:spur-cli references without running spur --help
    Then high-frequency verbs (including task deps, sections, and run-link) have copy-pasteable recipes, key flags, --json shapes, and exit codes
    And the canonical task section contract matches the live matrix (including Requirements, Q&A, Design, and universal Notes/References/History)
    And SKILL.md stays a lean router while references hold the catalogs
    And long-tail nouns are lightly indexed or last-resort --help only — not a raw full-tree help dump

  Scenario: R9 - Reference parity fails loud on drift
    Given the Tier A verb references and the live CLI help
    When the parity assertion runs
    Then every documented Tier A verb name is a subset of live CLI help
    And a critically-missing verb fails the assertion loudly

  Scenario: R11/R12 - Execute-first contract is documented and dogfooded
    Given the updated AGENTS/skill wording
    Then prose directs agents to execute from the skill first and use --help only for skew or unlisted long-tail
    And a cold session runs at least one each of task/feature/rule/workflow Tier A recipes from references alone
    And the full quality gate exits zero
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
`sp:spur-cli` becomes the **execute-from-reference** path for the useful `spur` CLI surface. Design constraints:

1. **Layering stays:** `SKILL.md` = noun router + conventions; `references/<noun>.md` + `references/<noun>/*` = verb catalogs with recipes, flags, `--json` shapes, exit codes. No full catalogs in the skill body.
2. **Coverage tiers:** Tier A (`task`/`feature`/`rule`/`workflow`, executable without `--help`, includes the missing task `deps`/`sections`/`run-link` and the corrected section matrix); Tier B (`status`/`init` + short top-level map); Tier C (deep long-tail, last-resort `--help`).
3. **Evidence-backed, curated:** document from monorepo CLI source / `--help`; prefer worked examples over help-transcript dumps; never invent flags.
4. **Parity where cheap:** a small check that Tier A verb names in references ⊆ live CLI help, with critical missing verbs failing loud. Full flag-matrix generation is optional.
5. **Agent contract:** AGENTS / skill prose say load `sp:spur-cli` and execute; use `spur … --help` only for version skew, unlisted long-tail, or a failing parity assertion.

Independent of 0315/0316 — but 0315's R4 handover-reference wording should cite the corrected section set this task lands.
### Plan
1. Inventory live monorepo verbs for Tier A nouns (`task`/`feature`/`rule`/`workflow`) and Tier B light-index (`status`/`init` + top-level map) from `apps/cli/src/commands/*.ts` and `--help`.
2. Update task references: add `deps`, `sections`, `run-link`; correct the canonical section set (add `Requirements`, `Q&A`, `Design`, universal `Notes`); add `--json` shapes and exit codes; fix the obsolete section-name list in `tasks/section-editing.md`.
3. Refresh peer noun references (`feature`/`rule`/`workflow`) so their high-frequency recipes are complete enough to execute without `--help`.
4. Keep `SKILL.md` lean routing; add the explicit "execute from skill; `--help` last-resort" contract.
5. Add the Tier A reference↔CLI parity assertion (verb coverage + critical-flag smoke).
6. Update AGENTS / skill execute-first wording; add a changelog entry; cold-session dogfood the Tier A recipes; run the full gate.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent **0314** and sibling **0315** (R4 handover-reference wording cites this task's corrected section set)
- `plugins/sp/skills/spur-cli/SKILL.md`, `references/tasks.md`, `references/tasks/{verbs,section-editing}.md`
- Peer noun references under `plugins/sp/skills/spur-cli/references/`
- `apps/cli/src/commands/task.ts` (deps/sections/run-link + verb source of truth)
- `packages/domain/src/planning/markdown-document.ts` (`UNIVERSAL_SECTIONS`) and `packages/app/src/services/planning-write-service.ts`
- `CLAUDE.md` / AGENTS spur-cli routing (execute-first wording)
### History
