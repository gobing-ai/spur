---
template: feature-impl
schema_version: 1
name: "Harden sp-dev-idea planning handoff from dogfood findings"
description: ""
status: done
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["dogfood", "planning-workflow", "plugins/sp"]
dependencies: ["0514"]
ac_numbering: task-local
created_at: "2026-08-11T20:43:29.598Z"
updated_at: "2026-08-12T01:33:08.488Z"
---

## 0515. Harden sp-dev-idea planning handoff from dogfood findings

### Background
Operational hardening for feature I2 scenario R14. This task owns only the first two dogfood findings: feature creation currently records an ID without an explicit Goal/Scope write contract, and design rejection currently has no persistent operator-feedback artifact for the revision pass. Task 0518 owns post-create ordering, roster refresh, and conditional handoff; 0519 owns regression coverage and the no-surface verification.

Current-tree premises verified during ready refinement: `config/workflows/idea-pipeline.yaml` has `feature-create`, `system-design`, and `design-approval` states; feature creation currently writes only `*-idea-feature-id.txt`; the design approval prompt has no feedback path; exits from system design do not re-run `spur feature check`. `spur feature update <id> --section <name> --from-file <path>` is the existing corpus write seam.

The change remains in the workflow/guidance layer and uses existing CLI verbs. It does not add a task-batch schema field, new CLI verb/flag, ordering logic, finalization state, or task execution.

Rubric: E3 D1 L1 C0 R0 = 5 → split; this guidance/reconciliation slice stays separate from 0518 finalization and 0519 tests.
### Requirements
- [ ] R1. In `feature-create`, produce run-scoped `*-idea-goal.md` and `*-idea-scope.md` bodies containing concise intent and explicit in/out boundaries, then persist both through `spur feature update --section ... --from-file`; decomposition/checklist output must never enter Goal.
- [ ] R2. Make `system-design` create/read `.spur/run/${vars.__runId}-idea-design-review.md` with `Proposed design`, `Operator feedback`, and `Reconciliation` sections. The rejection prompt directs the operator to record feedback there; a revision reads it, reconciles invalidated AC through `spur feature update`, and every accepted/auto-approved design exit runs `spur feature check <id>` before decomposition.

Non-goals: order sidecars, dependency application, roster refresh, handoff recommendation, task execution, task-batch schema changes, or new public CLI surface (0518/0519 own the remaining work).
### Acceptance Criteria
```gherkin
Feature: Safe idea-pipeline planning handoff

  Scenario: R1 — Idea handoff is safe to execute
    Given feature-create has selected or created a feature
    When Goal and Scope are written
    Then they contain concise intent and boundaries rather than task decomposition or checklists

  Scenario: R2 — Idea handoff is safe to execute
    Given the operator rejects a design after recording feedback in the run-scoped review artifact
    When system-design runs again
    Then it reads the feedback and reconciles invalidated feature AC through spur feature update
```
### Q&A
- **Goal/Scope artifacts:** `.spur/run/<runId>-idea-goal.md` and `-idea-scope.md`, body-only; the workflow persists them with `spur feature update` after selecting or creating the feature.
- **Design feedback transport:** one `.spur/run/<runId>-idea-design-review.md` artifact with fixed `Proposed design`, `Operator feedback`, and `Reconciliation` headings. Reject means edit `Operator feedback`; retry means read and reconcile it.
- **AC reconciliation:** system-design uses the existing feature section-update verb when feedback invalidates AC, and design exit is conditional on `spur feature check` passing.
- **Ownership:** 0518 alone owns order/finalization/handoff mechanics; 0519 owns regression tests. This task must not pre-implement either slice.
### Design
Modify the tracked workflow SSOT `config/workflows/idea-pipeline.yaml` and mirror its user-facing contract in `plugins/sp/skills/spur-dev/references/planning-workflow.md` plus `plugins/sp/commands/dev-idea.md` only where that wrapper describes outputs.

In `feature-create`, have the agent write three expected files: the existing feature-id file plus body-only Goal and Scope artifacts at `.spur/run/${vars.__runId}-idea-{goal,scope}.md`. Follow with shell actions that require both files to be non-empty and call `$spurBin feature update "$featureId" --section Goal|Scope --from-file ...`; failure stops the state. Goal is intent only; Scope has explicit in-scope/out-of-scope boundaries.

In `system-design`, require `.spur/run/${vars.__runId}-idea-design-review.md` with fixed headings `## Proposed design`, `## Operator feedback`, and `## Reconciliation`. On first pass, create it; on retry, read existing operator feedback, revise the design/ADR artifacts, document reconciliation, and update Acceptance Criteria through the existing CLI only when feedback invalidates a scenario. Change the design-approval prompt to tell the operator to edit `Operator feedback` before answering no. Add `$spurBin feature check "$featureId"` to both paths that leave design for `decompose` (auto-approved and interactive-approved), so stale/invalidated AC cannot proceed.

Do not add states, ordering artifacts, dependency logic, roster refresh, handoff report generation, schema fields, or public commands here. Existing workflow-definition tests must remain green; 0519 adds the focused regressions after 0518 lands.
### Plan
- [ ] Update `feature-create` to capture and persist run-scoped Goal/Scope bodies through `spur feature update` (R1).
- [ ] Add the fixed design-review artifact contract to `system-design` and the rejection prompt; make revision consume feedback and reconcile changed AC (R2).
- [ ] Require `spur feature check` on auto-approved and interactive-approved design exits before decomposition (R2).
- [ ] Sync only the affected planning-workflow/dev-idea guidance; do not implement 0518 finalization or 0519 tests.
- [ ] Run `bun run apps/cli/src/index.ts workflow validate config/workflows/idea-pipeline.yaml --json` and `bun test packages/app/tests/workflow/idea-pipeline-definition.test.ts plugins/sp/tests/skill-structure.test.ts`; verify no CLI/schema/dependency/persistence/transport diff.
### Solution
- `config/workflows/idea-pipeline.yaml:128-159` — R1: `feature-create` now instructs the agent to write body-only `.spur/run/${vars.__runId}-idea-goal.md` (concise Goal intent only; task breakdowns/checklists/how-to steps never enter Goal) and `-idea-scope.md` (explicit in-scope/out-of-scope boundary bullets) alongside the existing feature-id file (`:142`). Two new shell actions (`:152-159`) require each file non-empty (`test -s`) and persist via `$spurBin feature update "$featureId" --section Goal|Scope --from-file ...`; a missing/empty artifact stops the state (fail-closed, not retryable).
- `config/workflows/idea-pipeline.yaml:220-242` — R2: `system-design` gains the run-scoped design-review artifact `.spur/run/${vars.__runId}-idea-design-review.md` with fixed headings `## Proposed design` / `## Operator feedback` / `## Reconciliation`. A shell action (`:234-238`) creates the skeleton idempotently on first pass; the agent.run expects it (`expectFile`, `:242`) and, on retry with operator feedback present, revises design/ADR artifacts, documents reconciliation, and persists invalidated AC via `$spurBin feature update "$featureId" --section "Acceptance Criteria" --from-file <file>` (`:241`) — never direct feature-file edits.
- `config/workflows/idea-pipeline.yaml:245-269` — R2: `design-approval` prompt (`:269`) now directs the operator to record rejection feedback in the review artifact under `## Operator feedback` before answering `no`; the state description documents the contract (`:258-261`).
- `config/workflows/idea-pipeline.yaml:482-500` — R2: `$spurBin feature check $featureId` added to both design exits into `decompose` (`system-design -> decompose` auto-approved guard, `:487`; `design-approval -> decompose` yes guard, `:500`) so stale/invalidated AC cannot proceed.
- `plugins/sp/skills/spur-dev/references/planning-workflow.md:220-251` — new Step 5.6 "Idea pipeline (sp:dev-idea) — planning handoff contracts" mirrors the Goal/Scope intent contract (`:225-236`) and the design-review artifact contract — first pass / rejection / retry reconciliation / exit feature-check gate (`:238-250`). `plugins/sp/commands/dev-idea.md` unchanged — the wrapper describes flags and implementation, not outputs.
- `packages/app/tests/workflow/idea-pipeline-definition.test.ts:77-87` — auto-approve guard assertion updated to include the feature check; `:115-118` adds `idea-goal.md`, `idea-scope.md`, `idea-design-review.md` to the run-scoped stems list; `:154-193` and `:195-246` add 0515 R1 (Goal/Scope artifacts + CLI persistence) and 0515 R2 (review artifact contract, AC reconciliation, feature check on both design exits) describe blocks.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/idea-pipeline.yaml` feature-create: agent.run input requires body-only `.spur/run/${vars.__runId}-idea-goal.md` with "concise Goal intent only (a short statement of what the feature achieves; never task breakdowns, checklists, or how-to steps)" and `.spur/run/${vars.__runId}-idea-scope.md` with "explicit in-scope and out-of-scope boundary bullets"; then shell actions `test -s .spur/run/$__runId-idea-goal.md && $spurBin feature update "$featureId" --section Goal --from-file .spur/run/$__runId-idea-goal.md` (Scope identical) enforce non-empty and persist through the corpus CLI. Asserted by definition tests `idea-pipeline-definition.test.ts` R1 describe (agent prompt contract: "concise Goal intent only", "never task breakdowns, checklists, or how-to steps", "in-scope and out-of-scope boundary bullets"; persistence: `test -s` + `$spurBin feature update "$featureId" --section Goal |
| R2 | MET | `config/workflows/idea-pipeline.yaml` system-design: onEnter creates/expects `.spur/run/${vars.__runId}-idea-design-review.md` with fixed headings `## Proposed design` / `## Operator feedback` / `## Reconciliation`; agent input reads prior operator feedback on retry, revises design/ADR artifacts, documents reconciliation, and persists invalidated AC via `$spurBin feature update "$featureId" --section "Acceptance Criteria" --from-file <file>` (never direct corpus edits); post-agent shell fails closed if `## Proposed design` is unpopulated (P3-2 fix). design-approval prompt directs the operator to record feedback under `## Operator feedback` before answering no. Both design exits gate on `$spurBin feature check "$featureId"`: auto `system-design -> decompose` guard `test "$profile" = auto && test "$design_approved" = true && $spurBin feature check "$featureId"`; interactive `design-approval -> decompose` guard `test "$__hitlAnswer" = yes && $spurBin feature check "$featureId"`; P3-1 retry edge `design-approval -> feature-check` guard `test "$__hitlAnswer" = yes && ! $spurBin feature check "$featureId"`. Asserted by definition tests R2 describe (fixed headings, `feature update`/`Acceptance Criteria`/`--from-file` reconciliation, prompt feedback directive, both exits run feature check, retry-edge guard, non-vacuous section check). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict:** PASS — R1/R2 fully implemented, non-goal boundaries respected, quality gate green (workflow validates; definition tests 16 pass / 0 fail / 73 expects). No P1/P2. Two P3 robustness gaps (dead-end on interactive design-exit check failure; vacuous `expectFile` on the review artifact) and four P4 notes. Both P3s are fail-closed (requirement holds) but operator-hostile; recommend follow-up tasks, not a rework.


| Severity | Location | Finding | Recommendation |
|---|---|---|---|
| P1 | — | None | — |
| P2 | — | None | — |
| P3 | `config/workflows/idea-pipeline.yaml:500` (`design-approval -> decompose` guard) | Interactive approve with a failing `spur feature check` is a dead-end: the `yes && check` edge fails, and the remaining edges (`no`, `failed` cap, `cancelled`) do not match `__hitlAnswer=yes`, so the engine fails the run with the generic `no-passing-transition` (state-machine.js:104-105) — no route back to the ac-generate/feature-check retry loop, no message naming the stale AC. The auto path (`:487`) falls through to design-approval on failure, but approving there hits the same dead-end and rejecting routes to system-design (design revise), never to AC fix. Fail-closed (requirement R2 met) but inconsistent with the ac-generate capped-retry pattern this task otherwise mirrors. | Add a dedicated failure edge, e.g. `design-approval -> feature-check` guarded by `test "$__hitlAnswer" = yes && ! $spurBin feature check $featureId` (feature-check already routes failures to ac-generate, capped at 3); or at minimum document the failure mode in the transition description so an operator who hits it knows why the run died. |
| P3 | `config/workflows/idea-pipeline.yaml:234-242` | `system-design`'s `expectFile` on `...-idea-design-review.md` is vacuous: the onEnter shell pre-creates the skeleton before the agent runs, so `expectFile` passes even if the agent no-ops and never fills `## Proposed design`. On the auto path (`design_approved=true` bypasses design-approval) an unpopulated design can reach decompose with no downstream check of design content. Interactive mode is covered by the human taste gate; the auto path is not. | Have the agent write a completion sentinel (e.g. `.spur/run/$__runId-idea-design-done.txt`) and `expectFile` that; or add a post-agent shell action asserting a non-empty `## Proposed design` section (mirrors the `test -s` fail-closed pattern feature-create uses at `:152-159`). |
| P4 | `config/workflows/idea-pipeline.yaml:152-159` | Empty/missing goal or scope artifact stops the state, but under the engine's default `fail` onError policy that kills the entire run on a single agent slip — no retry edge. Documented and deliberate ("fail-closed, not retryable") and loud, so acceptable; note ac-generate (`:180-193`) deliberately routes empty content through guards for capped retry instead. | If dogfood shows churn, add a capped retry edge from feature-create (mirror the ac-generate retry pattern). Not needed now. |
| P4 | `config/workflows/idea-pipeline.yaml:487,500` | New guard commands use unquoted `$featureId` (`$spurBin feature check $featureId`). EnvShellGuardRunner passes vars as env (0435: values are data, never re-parsed), and feature ids are CLI-generated hex slugs, so no practical injection — consistent with pre-existing unquoted usage in the feature-check guards. | Quote as `"$featureId"` for defense-in-depth consistency with the quoted form used in the new feature-create shell actions. |
| P4 | `config/workflows/idea-pipeline.yaml:225-231,241,269` + `planning-workflow.md:220-251` + tests | The review-artifact contract text (three fixed headings, rejection→feedback→reconciliation flow) is duplicated across five surfaces: state description, agent input, design-approval prompt, guidance Step 5.6, and definition tests. Drift risk when the contract changes. | Mitigated by the definition tests asserting the key phrases; acceptable. Revisit if the contract grows beyond three headings. |
| P4 | `packages/app/tests/workflow/idea-pipeline-definition.test.ts:152-246` | 104 lines of definition tests added in 0515 are static contract assertions (YAML-surface regressions), which is in scope for this task's verification step; 0519 owns pipeline-execution regression coverage. Minor boundary ambiguity with 0519's "regression tests" ownership. | Flag to 0519 so it does not duplicate the static assertions and focuses on execution-level coverage. |


- **R1 — Goal/Scope intent contract:** fully implemented. `feature-create` (`idea-pipeline.yaml:128-159`) instructs body-only `.spur/run/${vars.__runId}-idea-goal.md` (concise intent only; "never task breakdowns, checklists, or how-to steps") and `-idea-scope.md` (in/out boundary bullets), then two shell actions require both files non-empty (`test -s`) and persist via `$spurBin feature update "$featureId" --section Goal|Scope --from-file ...` (fail-closed on empty). Guidance mirrors at `planning-workflow.md:225-236`. Tests assert the prompt contract, the non-empty guard, and the CLI persistence commands (`test:154-193`).
- **R2 — Design-review feedback + reconciliation:** fully implemented. `system-design` (`:220-242`) creates/expects `.spur/run/${vars.__runId}-idea-design-review.md` with fixed `## Proposed design` / `## Operator feedback` / `## Reconciliation` headings; the agent input reads prior feedback on retry, revises design/ADR artifacts, documents reconciliation, and persists invalidated AC via `$spurBin feature update "$featureId" --section "Acceptance Criteria" --from-file <file>` — never direct corpus edits. `design-approval` prompt (`:269`) directs the operator to record feedback under `## Operator feedback` before answering `no`. Both design exits into decompose run `$spurBin feature check $featureId` (`:487` auto, `:500` interactive). Tests assert all of it (`test:195-246`).
- **AC scenarios R1/R2:** satisfied at the prompt+guard level. Content semantics ("intent vs decomposition") are LLM-prompt-enforced — inherent to agent workflows; the machine enforces non-empty artifacts and the feature-check gate. Non-goals (order sidecars, dependency logic, roster refresh, finalization, task-batch schema, new CLI surface) untouched; 0518/0519 boundaries respected — no finalization code, no execution-level regressions here.


- **Prompt-injection surface:** no new untrusted-content execution. New agent-input interpolations are engine-controlled vars (`${vars.featureId}`, `${vars.__runId}`); shell actions and guards receive vars as env (EnvShellGuardRunner, task 0435) so values are never re-parsed as shell code; the operator-edited review artifact is a trusted party by design.
- **Fail-closed semantics:** empty Goal/Scope stops the state; both design exits gate on `spur feature check`, so stale/invalidated AC cannot reach decompose on either path — requirement R2 holds even where the failure UX is rough (P3-1).
- **Write safety:** all corpus mutations go through the existing CLI seam; `spur feature update --section Goal|Scope --from-file` verified supported (`apps/cli/src/commands/feature.ts:72-103`, `feature-service.ts:227-239`, section availability asserted at `feature-service.test.ts:136-162`). No direct feature-file edits introduced.
- **Errors:** the two P3s above are the error-handling gaps; neither corrupts data or violates the contract.


- `bun run apps/cli/src/index.ts workflow validate config/workflows/idea-pipeline.yaml --json` — passes.
- `bun test packages/app/tests/workflow/idea-pipeline-definition.test.ts` — 16 pass / 0 fail / 73 expects.
- Engine guard semantics confirmed at `node_modules/.bun/@gobing-ai/ts-dual-workflow-engine@0.4.27/.../dist/state-machine.js:94-105` (first passing guard wins; no match → `fail('no-passing-transition')`).
- Diff reviewed: `config/workflows/idea-pipeline.yaml` (+43/−10), `planning-workflow.md` (+33), `idea-pipeline-definition.test.ts` (+104/−3), task file (+14/−4).


- P3-1/P3-2 failure UX: an operator can hit a dead run (stale AC at design exit) or a silent no-op (auto path, unpopulated design review). Both fail closed; follow-ups recommended.
- Contract duplication drift (P4-3) is the only long-term maintainability risk, mitigated by tests.
### References
- Feature: I2, scenario R14
- Design: `docs/design/plugin-surface-parity.md` §9
- Workflow SSOT: `config/workflows/idea-pipeline.yaml`
- Guidance: `plugins/sp/skills/spur-dev/references/planning-workflow.md`; `plugins/sp/commands/dev-idea.md`
- CLI seams: `spur feature update`; `spur feature check`
- Dependency: 0514
- Dependents: 0518 (post-create finalization), 0519 (regression/no-surface verification)
### History
- 2026-08-12T01:18:42.568Z todo → wip (system)
- 2026-08-12T01:33:07.399Z wip → testing (system)
- 2026-08-12T01:33:08.488Z testing → done (system)
