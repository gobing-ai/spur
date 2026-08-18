---
template: feature-impl
schema_version: 1
name: "Make sp:spur-cli an executable surface SSOT — add missing task verbs, fix section set"
description: ""
status: done
type: task
profile: standard
feature_id: H5
parent_wbs: "0314"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-23T06:11:57.566Z"
updated_at: "2026-08-18T04:42:47.768Z"
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

1. `plugins/sp/skills/spur-cli/references/tasks/verbs.md:66-98,346-355` — Added full documentation sections and quick surface snippets for missing task verbs `deps`, `sections`, and `run-link`.
2. `plugins/sp/skills/spur-cli/references/tasks.md:28-37` — Added `deps`, `sections`, and `run-link` to the main task verb map table.
3. `plugins/sp/skills/spur-cli/references/tasks/section-editing.md:45-47` — Corrected the canonical section list to include `Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`, `Plan`, `Solution`, `Testing`, `Review`, `References`, `History`, `Notes` and universal sections (`History`, `References`, `Notes`).
4. `plugins/sp/skills/spur-cli/SKILL.md:32-47` — Updated noun routing table to distinguish Tier A (`task`, `feature`, `rule`, `workflow`), Tier B (`init`/`status` + long-tail router), and established the **Execute-First Contract**.
5. `AGENTS.md:61` — Updated non-negotiable rule 4 to direct agents to execute high-frequency Tier A verbs directly from `sp:spur-cli` references before resorting to `--help`.
6. `apps/cli/tests/spur-cli-parity.test.ts:1-118` — Created new reference↔live-CLI parity test suite asserting verb coverage and critical-flag presence across all Tier A nouns (`task`, `feature`, `rule`, `workflow`).
7. `CHANGELOG.md:15-16` — Added release changelog entry under `[0.3.21]`.

### Testing
**Verification verdict (independent re-audit + fix, 2026-07-23, `--force --fix all`): PASS after fix.**

**Findings — two PARTIALs, both repaired this turn.**

1. **R7 accuracy gap (P2).** The domain SSOT `TASK_CANONICAL_SECTIONS` (`packages/domain/src/planning/markdown-document.ts`) includes `Root Cause` (carried by the `issue` template that `dev-debug` creates), but the corrected `section-editing.md` and the new `sections` verb doc both **omitted** it. The implementer fixed the Requirements/Q&A/Design/Notes omission but missed `Root Cause`, so the "section contract matches the live matrix" AC was not fully met.
2. **R9 circular test (P2).** `spur-cli-parity.test.ts`'s section check hardcoded its own section list (also missing `Root Cause`) and asserted the doc contained those — it could only re-assert the same omission. False confidence: it passed while the contract was incomplete.

The verb docs were accurate — `deps` / `sections` / `run-link` ops, flags, and exit codes were cross-checked against live `--help` and match exactly (no invented flags). The verb-coverage tests (which spawn the live CLI) are genuinely non-circular.

**Fixes applied this turn (Step 12).**
- `references/tasks/section-editing.md` and `references/tasks/verbs.md` — added `Root Cause` to the canonical section enumeration (after `Solution`, matching domain order) with a note that it is the `issue`-variant section.
- `tests/spur-cli-parity.test.ts` — de-circularized the section check: it now derives the expected vocabulary from the domain SSOT (`markdown-document.ts` `TASK_CANONICAL_SECTIONS` ∪ `UNIVERSAL_SECTIONS`) instead of a hardcoded copy. Proven non-hollow: with `Root Cause` stripped the test fails (6 pass / 1 fail); restored it passes (7 / 0).

**Re-verified after fix (all run this turn).**
- `bun test plugins/sp/spur-cli-parity`: 7 pass / 0 fail; `bun test plugins/sp/`: 379 pass / 0 fail; `bun run lint`: biome + tsc exit 0.
- Cold-agent dogfood of one Tier A recipe per noun, from references only (no `--help`): task `sections 0317 list --json` → returns the matrix; feature `show O --json` → id O; rule `list --json` → exit 0; workflow `list --json` → exit 0. (Completes R12 — the implementer had dogfooded only rule + workflow.)

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R7 | MET (fixed) | `deps`/`sections`/`run-link` docs match live `--help`; section set corrected to add `Root Cause`; SKILL.md Tier A/B/C + Execute-First Contract; feature/rule/workflow verb coverage confirmed by parity + dogfood |
| R9 | MET (fixed) | parity test de-circularized (derives from domain SSOT); non-hollow proof (fails on `Root Cause` removal); verb tests cross-check live CLI |
| R11 | MET | `AGENTS.md` rule 4 execute-first (last-resort `--help`); SKILL.md Execute-First Contract; `CHANGELOG.md` [0.3.21] |
| R12 | MET (completed) | all four Tier A nouns cold-dogfooded from references this turn |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R7 — Tier A executable without `--help` | MET | command+file | verb docs vs live help; section matrix complete incl. `Root Cause` |
| R9 — parity fails loud on drift | MET | test | proven: 6 pass/1 fail when `Root Cause` stripped, 7/0 restored |
| R11/R12 — execute-first documented + dogfooded | MET | command | AGENTS rule 4; all 4 nouns dogfooded; gates exit 0 |

**SECUA review.** No blocker/major beyond the two fixed doc/test defects. Advisory (P4): `spur task sections list --json` output shows a trailing comma before `}` (looks like invalid JSON) — out of 0317's scope (CLI formatter, not spur-cli refs); flag for a CLI-output follow-up, verify it is not a display artifact first.

**Fix-pass disclosure.** Mutated `references/tasks/section-editing.md`, `references/tasks/verbs.md`, `tests/spur-cli-parity.test.ts` (all tracked).

**Coverage:** N/A for runtime app code (reference-doc + test change); the corrected test lands in the plugin suite (379 pass).

Verdict: PASS
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P2 | plugins/sp/skills/spur-cli/references/tasks/section-editing.md, tasks/verbs.md | The corrected canonical section set omitted `Root Cause` (a real `TASK_CANONICAL_SECTIONS` entry carried by the `issue` variant) — the reference did not fully match the live matrix. | FIXED during review: added `Root Cause` to both references. |
| P2 | plugins/sp/tests/spur-cli-parity.test.ts | The section-parity test hardcoded its expected list (also missing `Root Cause`) — circular; it could only re-assert the same omission (false confidence). | FIXED during review: test now derives the vocabulary from the domain SSOT; proven non-hollow (fails when `Root Cause` removed). |

**Residual risk:** Low post-fix. `deps`/`sections`/`run-link` docs match live CLI `--help`; all four Tier A nouns cold-dogfooded from references.

**Disposition:** Approved after fix. All 4 requirements MET (independent verify PASS, 2026-07-23).
### References
- Parent **0314** and sibling **0315** (R4 handover-reference wording cites this task's corrected section set)
- `plugins/sp/skills/spur-cli/SKILL.md`, `references/tasks.md`, `references/tasks/{verbs,section-editing}.md`
- Peer noun references under `plugins/sp/skills/spur-cli/references/`
- `apps/cli/src/commands/task.ts` (deps/sections/run-link + verb source of truth)
- `packages/domain/src/planning/markdown-document.ts` (`UNIVERSAL_SECTIONS`) and `packages/app/src/services/planning-write-service.ts`
- `CLAUDE.md` / AGENTS spur-cli routing (execute-first wording)
### History
### Notes

**P4 advisory resolved (2026-07-23).** The verify Testing section flagged `spur task sections list --json` as possibly emitting a trailing comma (invalid JSON). Investigated: raw stdout is **valid JSON** — `JSON.parse` accepts it and there is no banner pollution (first byte is `{`). The apparent trailing comma was a display artifact of a banner-stripping `grep` used during the audit, and the earlier `python json.load` failure was a piping quirk, not malformed output. No CLI defect; no follow-up task warranted. `feature show --json` also parses clean.

