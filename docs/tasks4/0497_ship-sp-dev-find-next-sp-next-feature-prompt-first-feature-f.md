---
template: feature-impl
schema_version: 1
name: "Ship /sp:dev-find-next + sp:next-feature — prompt-first feature frontier prioritizer"
description: ""
status: done
type: task
profile: standard
feature_id: H12
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T04:26:18.025Z"
updated_at: "2026-08-10T05:09:52.586Z"
done_forced: "true"
done_reason: "Implement task executed inline (prompt-first markdown surface; no pipeline run). Evidence: plugins/sp suite 642 pass 0 fail; wrapper/index/design anchors verified; verdict .spur/run/0497-verdict.json PASS (R1-R6 MET). Structural gate PASS; Review L3 table populated. Provenance override recorded per CLI guidance."
---

## 0497. Ship /sp:dev-find-next + sp:next-feature — prompt-first feature frontier prioritizer

### Background
**Type:** implement (graduated from wayfinder map H12) · **Map:** H12 · **Depends:** 0493, 0494, 0495 (all done)

The three research tickets settled the design:

- **0493** (ranking spike): sync-first precondition; B3 actionability gate; tiered rubric over four surviving signals (AC coverage, churn exposure, dogfood proximity, authority pull); no numeric scores.
- **0494** (reuse inventory): capability ledger — compose `spur feature list/sync/check --json` + `spur task list --feature --json` + `git`/`rg` derivations; cite B3 at runtime, never restate; proposed file list for `plugins/sp/skills/next-feature/`.
- **0495** (defect contract): D1–D4 defect set, B4–B7 boundary, mapping-schema-conformant proposal artifact, featurechange-only mutation path, evidence bar with silence as valid outcome.

This ticket ships the command + skill as prompt-first markdown. No TypeScript, no schema changes, no new spur verbs (map substrate decision).
### Requirements
- R1 — Ship `plugins/sp/commands/dev-find-next.md` + `plugins/sp/skills/next-feature/` so the command answers *which feature*, returning a ranked frontier where each candidate carries the evidence that placed it; `/sp:dev-next` remains the surface for advancing a chosen target.
- R2 — Every ranking signal derives from existing corpus, git, or authority-doc evidence; no feature frontmatter field, domain schema, or spur CLI verb is added; the `priority` field is not used as the ordering.
- R3 — Unactionable features are gated, not ranked: a feature whose child tasks have unmet dependencies (or no open tasks) is excluded with the reason reported.
- R4 — Structure-defect detection emits proposals conforming to the `docs/plans/feature-tree-restructure-map.md` schema; the command performs no `spur feature move` and routes all application through `/sp:dev-featurechange`.
- R5 — The command is a thin wrapper forwarding `$ARGUMENTS` to the skill; the skill carries protocol + references as SSOT; `docs/04_DESIGN.md` records the surface in the same commit.
- R6 — After this task verifies, `/sp:dev-verifyall --feature H12` reports `Shippable: PASS`; the map's `### Not yet specified` entries resolved here are struck or consciously deferred.
### Acceptance Criteria
```gherkin
Feature: 0497 ship dev-find-next

  Scenario: R1 — the command answers which feature, not which step
    Given the shipped command and skill
    When the operator runs /sp:dev-find-next
    Then a ranked frontier of candidate features is returned
    And each candidate carries the evidence that placed it at its rank
    And /sp:dev-next remains the surface for advancing an already-chosen target

  Scenario: R2 — ranking derives from the corpus as it stands
    Given the shipped skill
    When its signal-derivation protocol is inspected
    Then every signal cites an existing corpus, git, or authority-doc derivation
    And no frontmatter field, schema, or spur verb was added
    And the priority field is excluded as an ordering signal

  Scenario: R3 — unactionable features are gated, not ranked
    Given the shipped skill
    When a feature has no open unblocked child task
    Then the protocol excludes it from the ranked frontier
    And the gating reason is reported

  Scenario: R4 — structure defects are proposed, never applied
    Given the shipped skill
    When a rank-distorting tree defect is detected
    Then the emitted proposal conforms to the restructure mapping-file schema
    And the only mutation path is /sp:dev-featurechange with its confirm step

  Scenario: R5 — the surface mirrors the established prompt-first pattern
    Given plugins/sp/commands/dev-find-conflict.md as the template
    When the command and skill ship
    Then plugins/sp/commands/dev-find-next.md forwards $ARGUMENTS to the skill
    And the skill carries its protocol and references as the SSOT
    And docs/04_DESIGN.md records the command surface in the same commit

  Scenario: R6 — the map closes only on shipped code
    Given every investigation ticket under H12 is done
    When this implement task is verified
    Then /sp:dev-verifyall --feature H12 reports Shippable: PASS
    And "### Not yet specified" entries resolved by this task are struck or consciously deferred
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**WHAT** — Six markdown files: the thin command `plugins/sp/commands/dev-find-next.md` and the skill tree `plugins/sp/skills/next-feature/` (`SKILL.md` + `references/{signal-derivation,ranking-rubric,proposal-contract,handoff-routing}.md`), plus index entries (`plugins/sp/README.md`, `docs/04_DESIGN.md`).

**WHY this shape** — 0494's ledger: compose existing `spur … --json` verbs + `git`/`rg` derivations; cite B3 at runtime; never restate. 0495's contract: D1–D4 only, mapping-schema proposals, featurechange-only mutation, silence valid.

**KEY DECISIONS**

- **Report-only (OQ1 deferred).** The command prints the ranked frontier + defect proposals and stops. No `--next` dispatch into `/sp:dev-next` until the operator rules OQ1. The handoff reference documents the conditional dispatch row without implementing it.
- **Skill name kept: `next-feature`** (OQ2 deferred; rename is find-and-replace).
- **Sync-first precondition** (0493's headline finding): step zero is `spur feature sync --all --dry-run --json`; if drift is material, the report leads with "sync first" before any ranking.
- **Tiers, not scores.** Ordinal tiers (work-now / unblock-first / specify-first / stale-done) with per-candidate evidence; no WSJF/RICE arithmetic.
- **No new code.** Prompt-first markdown only (map substrate decision); verification is evidential (file existence, wrapper forward, anchor checks).

**WHERE** — writes: `plugins/sp/commands/dev-find-next.md`, `plugins/sp/skills/next-feature/**`, `plugins/sp/README.md` (index row), `docs/04_DESIGN.md` (surface entry, T3 same commit), map H12 `### Not yet specified` strike-throughs, this task's sections.
### Plan
- [x] Author `plugins/sp/skills/next-feature/SKILL.md` (protocol: sync-first → gate → derive signals → tier → report + defect pass)
- [x] Author `references/signal-derivation.md` (per-signal commands; B3 runtime citation; degenerate-spread rejection)
- [x] Author `references/ranking-rubric.md` (tiers + tie-breaks + evidence-per-candidate contract)
- [x] Author `references/proposal-contract.md` (D1–D4, evidence bar, silence valid, mapping schema conformance)
- [x] Author `references/handoff-routing.md` (featurechange handoff, next-router seam, OQ1 conditional dispatch)
- [x] Author `plugins/sp/commands/dev-find-next.md` (thin wrapper, flag table)
- [x] Index entries: `plugins/sp/README.md` + `docs/04_DESIGN.md`
- [x] Strike resolved entries in H12 `### Not yet specified`
- [x] Verify: files exist, wrapper forwards, anchors resolve; write Testing + verdict artifact
### Solution
**Shipped 2026-08-10** — prompt-first markdown surface, no TypeScript, per the map substrate decision and 0494's reuse ledger.

**Files:**

- `plugins/sp/commands/dev-find-next.md` — thin wrapper; forwards `$ARGUMENTS` to the skill in a single `Skill()` call (mirrors `dev-find-conflict.md`).
- `plugins/sp/skills/next-feature/SKILL.md` — the protocol spine: sync-first precondition → candidate set → B3 actionability gate (cited at runtime from routing-table.md row B3, never restated) → derive four measured signals → tiered ranking with per-candidate evidence → D1–D4 defect pass → report and stop.
- `plugins/sp/skills/next-feature/references/signal-derivation.md` — §0 sync precondition, §1 gate inputs, §2 per-signal derivation commands + degenerate-spread rejection, §3 signal→tree-property keying for the defect pass.
- `references/ranking-rubric.md` — tiers T1 work-now / T2 unblock-first / T3 specify-first / T4 stale-done; ordered tie-breaks (churn → AC coverage → authority → closure pressure → id); evidence-per-row output contract; the empty-frontier honest report.
- `references/proposal-contract.md` — D1–D4 defect set with corrupted-signal + direction; evidence bar mirroring finding-contract (`false_positive_check`, two opposing anchors); conformance to `docs/plans/feature-tree-restructure-map.md` schema; rejected-merges suppression; silence as valid outcome.
- `references/handoff-routing.md` — next-router seam (`/sp:dev-next <id>` handoff line), the 5-step featurechange boundary (sole writer = apply step), OQ1 conditional dispatch documented but not built.
- Index/design entries: `plugins/sp/README.md` (command row, skill row, tree block) and `docs/04_DESIGN.md` §1.3.2 (same commit, T3).

**Deviations from Design:** none. OQ1 shipped report-only as designed; OQ2 kept `next-feature`.

**Map updates:** H12 `### Not yet specified` — three entries struck (file layout, implement tickets, output shape), four consciously deferred; decision line appended for OQ1/OQ2 disposition. `spur feature refresh` rebuilt the Tasks table.

**Test impact:** three parity-test constants updated for corpus growth (37 commands, 21 `--agent` commands, aggregate description budget 7600→7950 per the test's documented scaling rule). Plugin suite: 642 pass, 0 fail.

**Key anchors:** wrapper forward `plugins/sp/commands/dev-find-next.md:46`; protocol step 0 (sync-first) `plugins/sp/skills/next-feature/SKILL.md:57`; design surface entry `docs/04_DESIGN.md:599` (§1.3.2); README index rows `plugins/sp/README.md:132` and `:239`.
### Testing
**Evidential verification — prompt-first markdown surface; no runtime code path added.** All commands run 2026-08-10, branch `wayfind/0495-structure-defect`.

| AC | Check | Evidence |
|---|---|---|
| R1 | Command + skill exist; skill returns ranked frontier with per-candidate evidence; `/sp:dev-next` seam stated | `plugins/sp/commands/dev-find-next.md`, `plugins/sp/skills/next-feature/SKILL.md` (protocol steps 0–6), `references/handoff-routing.md` seam section |
| R2 | Every signal cites an existing derivation; nothing added | `references/signal-derivation.md` §2 table (spur verbs / git / rg only); `git status` — diff contains no `packages/**`, no frontmatter/schema/CLI changes |
| R3 | Gate-before-rank protocol | SKILL.md step 2 + signal-derivation §1 (B3 runtime citation; gated-not-ranked; reason recorded) |
| R4 | Proposals conform to existing schema; no mutation path | `references/proposal-contract.md` (schema conformance, suppression list, silence); `grep 'spur feature move'` across the shipped surface → prohibition/handoff mentions only, zero invocations |
| R5 | Thin wrapper + SSOT skill + same-commit design entry | `grep -c 'Skill(skill="sp:next-feature", args="$ARGUMENTS")' dev-find-next.md` → 1; `grep -c dev-find-next` README → 3, 04_DESIGN → 2 (§1.3.2) |
| R6 | verifyall Shippable | this verdict + `spur feature check H12` re-run below |

**Plugin contract suite:** `bun test` in `plugins/sp` → **642 pass, 0 fail** (19 files). Includes command-contract validator (37 commands, zero violations), R42 skill description budgets (aggregate cap scaled 7600→7950 for the 28th skill per the test's own scaling rule; next-feature desc = 346 ≤ 350 per-skill cap), R5 `--agent` parity (20→21), R43 README index coverage.

**Test constant updates (corpus growth, not logic):** `command-contract.test.ts` 36→37 command files; `command-flag-parity.test.ts` 20→21 mode-aware commands; `skill-structure.test.ts` aggregate budget 7600→7950 with updated skill-count comment.

Coverage: N/A (prompt-first markdown surface; no runtime code path added — the 642-test plugin suite is the executable gate for the command/skill contract).

**Re-audit (`/sp:dev-verifyall --feature H12 --auto --next --force --focus all --fix all`, 2026-08-10).** Plugin contract suite re-run: **642 pass, 0 fail** (19 files, 2605 `expect()` calls). All six surface files present; `dev-find-next.md` forwards `$ARGUMENTS` to `sp:next-feature` in a single `Skill()` call; `SKILL.md` protocol step 0 (sync-first) intact; `docs/04_DESIGN.md §1.3.2` and README index rows resolve. R4 re-checked: `rg 'spur feature move'` across the shipped surface → 4 hits, all prohibition or handoff prose, **zero invocations**. R6 shippable: `spur feature check H12` → `pass: true`, 0 findings, all 4 linked tasks `done`. **Under `--fix all`:** the `### Review` P2 major (protocol unexecuted at implement time) is discharged by `docs/dogfood/2026-08-10-H12-dev-find-next-dogfood.md` (result **PASS**, six protocol steps over the live corpus).
### Review
| Priority | Severity | File | Finding | Recommendation |
|---|---|---|---|---|
| P2 | major (**resolved 2026-08-10**) | `plugins/sp/skills/next-feature/SKILL.md` | Prompt-first protocol was unexecuted at implement time — rubric output quality validated only by file existence, not by a live run. | **Discharged:** dogfooded inline the same day — `docs/dogfood/2026-08-10-H12-dev-find-next-dogfood.md` (run `2026-08-10-H12-dev-find-next`, result **PASS**): all six protocol steps executed over the live corpus, sync-first precondition fired (26 proposals), B3 gate read at runtime from `routing-table.md:83`, D1/D3/D4 defect pass reproduced. Residual: tier tie-breaks remain untuned against operator preference — revisit only if a future run's ordering is disputed. |
| P3 | minor | `plugins/sp/skills/next-feature/references/handoff-routing.md` | OQ1 deferred: report-only v1. If the operator wants dispatch, `--next` chain semantics must come from next-router, not be hand-rolled here. | Operator decision; extension point documented. |
| P4 | advisory | `plugins/sp/tests/skill-structure.test.ts` | Aggregate description budget bumped 7600→7950 for the 28th skill. The cap is a bloat guard; per-skill caps unchanged. | Keep scaling by +350/non-router skill, or the cap silently blocks legitimate additions. |
### References

H12

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-10T04:27:20.072Z todo → wip (system)
- 2026-08-10T04:35:59.921Z wip → testing (system)
- 2026-08-10T04:36:47.201Z testing → done (system)
