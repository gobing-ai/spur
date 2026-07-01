---
template: feature-impl
schema_version: 1
name: "0167 follow-ups — post-implementation actions"
description: ""
status: todo
type: task
profile: standard
feature_id: I
parent_wbs: "0167"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-01T22:05:29.538Z"
updated_at: "2026-07-01T22:09:16.328Z"
---

## 0174. 0167 follow-ups — post-implementation actions

### Background
Task 0167 (feature I) implementation is complete: 6 child tasks (0168–0173) done, full verification gate green (`bun run lint` clean, 2031 tests pass, R30–R35 structural tests pass with R29 unchanged, both new workflows `idea-pipeline.yaml` and `wrapup-pipeline.yaml` validate against the state-machine schema), `plugin.json` bumped 0.2.3 → 0.3.0. This task captures residual follow-up actions discovered during implementation and dogfood that need separate handling. Git commit operations are explicitly excluded — the operator manages those manually.
### Requirements
R1. (dogfood finding) Add `--dry-run` flag pass-through to `/sp:dev-wrap` and `/sp:dev-wrapall`. The underlying `spur workflow run` already supports `--dry-run` — it validates and walks transitions without executing `agent.run`/`shell`/`hitl.confirm` actions (`apps/cli/src/commands/workflow.ts:106`; the workflow service stamps `dryRun: true` into run metadata at `packages/app/src/services/workflow-service.ts:367-369`). The gap is purely at the command-wrapper layer: `plugins/sp/commands/dev-wrap.md` and `plugins/sp/commands/dev-wrapall.md` do not recognize or pass through `--dry-run`. Source: the 0167 dogfood brainstorm at `docs/plans/2026-07-01-dev-wrap-dry-run-brainstorm.md` (deleted after this task captures its content).

R2. (verification gap) Live end-to-end dogfood of the two new pipelines from a real operator session. The 0167 batch's dogfood (task 0173 steps 25–26) only proved structural state traversal, because `agent.run` steps cannot execute nested inside a subagent context. Concretely: AC3 (idea-pipeline) reached `ac-generate` then hit the transition cap at 16 transitions — `handoff` was not reached; AC4 (wrapup-pipeline) reached `done` but did not write `.spur/memory/learnings.md` or `.spur/memory/wrapup-metrics.jsonl`. A real operator running `/sp:dev-idea "<idea>" --auto` and `/sp:dev-wrapall --feature <id> --auto` from their own session must complete these to satisfy AC3/AC4 fully. The pipeline YAMLs validate and traverse correctly — this is a live-execution verification gap, not a code defect.

R3. (pre-existing discrepancy, surfaced by 0167's design doc) Reconcile `planning-pipeline.yaml`'s `design-approval` behavior with the design doc's HITL taxonomy. `config/workflows/planning-pipeline.yaml:15,81-82,140-143` auto-skips the `design-approval` state entirely under `profile=auto` (design-gen routes straight to handoff, never entering design-approval whose `onEnter hitl.confirm` would block). But `docs/design/e2e-workflow-for-system-development.md:118,312` classifies `design-approval` as a taste/architecture gate that should pause under auto mode unless an explicit prior approval is represented. The new `idea-pipeline.yaml` (task 0170) handles this correctly per R6/AC-P3.4 (pauses unless `vars.design_approved=true`); the existing `planning-pipeline.yaml` diverges. Decide: either make `planning-pipeline.yaml` pause on `design-approval` under auto (matching the design doc + idea-pipeline), or amend the design doc to document planning-pipeline's auto-skip as an intentional exception. Pre-existing — not introduced by 0168–0173 (Phase 4 only added checkpoint write actions to planning-pipeline) — but 0167's design doc encodes the contract that exposes the contradiction.

R4. (optional CLI enhancement) Add structured `dependencies` support to the task corpus. `apps/cli/schemas/task-batch.schema.json` has no `dependencies` field (`additionalProperties: false`), and `spur task update` exposes no `--dependencies` flag (`apps/cli/src/commands/task.ts:136-149`). In 0167's decomposition, phase sequencing (0168→0169→0170→0171→0172→0173) is encoded in each child's Background prose and enforced by the orchestrator at runtime, not in frontmatter `dependencies[]`. If structured dependency edges are wanted, this is a separate schema + CLI task. Optional — current prose-based sequencing is functional.

R5. (lifecycle closure) Advance feature I and parent task 0167 through legal lifecycle edges now that all 6 children are done. Feature I: `backlog → active → verifying → done` via `spur feature update` with `spur feature check I --strict` guards (per design doc R15 / wrapup-pipeline feature-transition contract — no direct `backlog|active → done`). Parent task 0167: transition to `done`. May be done via `/sp:dev-wrapall --feature I --auto` once R2's live run is validated, or manually via `spur feature update` / `spur task update`.
### Acceptance Criteria
AC1. `plugins/sp/commands/dev-wrap.md` and `plugins/sp/commands/dev-wrapall.md` document and pass through `--dry-run` to `spur workflow run`; a dry-run wrap-up validates transitions without writing corpus or memory artifacts.

AC2. A real operator run of `/sp:dev-idea "<idea>" --auto` reaches `handoff` (creates/selects feature, writes AC, creates validated task batch) and `/sp:dev-wrapall --feature <id> --auto` writes `.spur/memory/learnings.md` + `.spur/memory/wrapup-metrics.jsonl` and reaches `done` without mutating task status.

AC3. `planning-pipeline.yaml` `design-approval` behavior matches the design doc's HITL taxonomy — either the code is fixed to pause on `design-approval` under auto unless prior approval is represented, or the design doc is amended with a documented exception. No contradiction remains between `config/workflows/planning-pipeline.yaml` and `docs/design/e2e-workflow-for-system-development.md`.

AC4. (If pursued) `spur task batch-create` accepts a `dependencies` field and `spur task update --dependencies` sets it; OR a deferral decision is recorded in this task's Q&A.

AC5. Feature I is `done` (`spur feature check I --strict` passes); parent task 0167 is `done`.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
This is a follow-up tracker, not a feature build. Each requirement is an independent action: R1 and R3 are code/doc edits, R2 is operator verification, R4 is an optional schema decision, R5 is lifecycle closure. No new skills (ADR-022). R1 and R3 may each warrant their own task decomposition if non-trivial; captured here first per operator direction. Git commits are out of scope (operator-managed).

**Provenance:** R1 is extracted from the 0167 dogfood brainstorm (`docs/plans/2026-07-01-dev-wrap-dry-run-brainstorm.md`) before that throwaway artifact is deleted. R2 and R3 were surfaced honestly in task 0173's / 0171's Review sections as residual risk. R4 was noted during 0167 Phase 0 decomposition. R5 follows from the wrapup-pipeline feature-transition contract (design doc R15).
### Plan
Ordered checklist. Each item is independent; sequence is advisory.

- [ ] R1: Add `--dry-run` to `plugins/sp/commands/dev-wrap.md` + `plugins/sp/commands/dev-wrapall.md` (pass through to `spur workflow run --dry-run`). Verify: `grep --dry-run` in both; a dry-run wrap-up produces no corpus/memory writes.
- [ ] R2: Live operator dogfood of `/sp:dev-idea` and `/sp:dev-wrapall`. Verify: idea-pipeline reaches `handoff`; wrapup-pipeline writes `learnings.md` + `wrapup-metrics.jsonl` and reaches `done`.
- [ ] R3: Investigate + reconcile `planning-pipeline.yaml` design-approval vs design doc HITL taxonomy. Verify: no contradiction between code and doc.
- [ ] R4: (optional) Add `dependencies` to batch schema + `--dependencies` to `spur task update`, OR record deferral in Q&A.
- [ ] R5: Advance feature I → `done` (strict check); parent 0167 → `done`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent: `docs/tasks2/0167_*.md` (feature I)
- Children: `docs/tasks2/0168-0173_*.md`
- Design: `docs/design/e2e-workflow-for-system-development.md`
- Dogfood artifacts (delete after this task captures content): `docs/features/I1_dev-wrap-dry-run-flag.md`, `docs/plans/2026-07-01-dev-wrap-dry-run-brainstorm.md`, `.spur/memory/sessions/wrapup-checkpoint.md`
- Code refs: `apps/cli/src/commands/workflow.ts:106` (--dry-run), `packages/app/src/services/workflow-service.ts:367-369` (dryRun stamp), `apps/cli/schemas/task-batch.schema.json` (no dependencies field), `apps/cli/src/commands/task.ts:136-149` (no --dependencies), `config/workflows/planning-pipeline.yaml:15,81-82,140-143` (design-approval auto-skip)
### History
