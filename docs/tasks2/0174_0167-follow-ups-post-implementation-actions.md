---
template: feature-impl
schema_version: 1
name: "0167 follow-ups — post-implementation actions"
description: ""
status: testing
type: task
profile: standard
feature_id: I
parent_wbs: "0167"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-01T22:05:29.538Z"
updated_at: "2026-07-01T23:29:58.567Z"
---

## 0174. 0167 follow-ups — post-implementation actions

### Background
Task 0167 (feature I) implementation is complete: 6 child tasks (0168–0173) done, full verification gate green (`bun run lint` clean, 2031 tests pass, R30–R35 structural tests pass with R29 unchanged, both new workflows `idea-pipeline.yaml` and `wrapup-pipeline.yaml` validate against the state-machine schema), `plugin.json` bumped 0.2.3 → 0.3.0. This task captures residual follow-up actions discovered during implementation and dogfood that need separate handling. Git commit operations are explicitly excluded — the operator manages those manually.
### Requirements
R1. Add `--dry-run` flag pass-through to `/sp:dev-wrap` and `/sp:dev-wrapall`. `spur workflow run` already supports `--dry-run` (validate + walk transitions, skip actions) at `apps/cli/src/commands/workflow.ts:106` with dryRun stamped at `packages/app/src/services/workflow-service.ts:367-369`; the gap is the command wrappers don't recognize/pass it.

R2. Run a live end-to-end dogfood of `/sp:dev-idea` and `/sp:dev-wrapall` from a top-level operator session, reaching `handoff` / writing the memory artifacts. (Prior "agent.run can't nest" framing was a misdiagnosis — see R6; this requirement's remaining scope is the validated live run after R6 lands.)

R3. Reconcile `planning-pipeline.yaml`'s `design-approval` behavior with the design doc's HITL taxonomy. `config/workflows/planning-pipeline.yaml:15,81-82,140-143` auto-skips `design-approval` under `profile=auto`; `docs/design/e2e-workflow-for-system-development.md:118,312` classifies it as a taste gate that should pause. The new `idea-pipeline.yaml` handles it correctly (pauses unless `vars.design_approved=true`). Fix the code to pause, or amend the doc with a documented exception. Pre-existing — not introduced by 0168–0173.

R4. (optional) Add structured `dependencies` support: `apps/cli/schemas/task-batch.schema.json` has no dependencies field (`additionalProperties: false`); `spur task update` exposes no `--dependencies` flag (`apps/cli/src/commands/task.ts:136-149`). 0167's phase sequencing was prose + orchestrator-enforced. Optional — current sequencing is functional.

R5. Advance feature I (`backlog → active → verifying → done`, strict-check guards, no direct `backlog|active → done`) and parent task 0167 → `done`, per design doc R15. May be done via `/sp:dev-wrapall --feature I --auto` after R2 validates, or manually.

R6. Fix the agent.run side-effect + cyclic-edge convergence defects that caused the 0167 dogfood to fail (idea-pipeline `failed`, wrapup `done` with no files written). Root cause, evidence, and three-layer solution (S1 loop cap, S2 side-effect verification via capture+shell, S3 nesting A/B diagnostic) are in Design. This requirement supersedes the "agent.run subprocess limitation" note in task 0173's Review and the 0167 close-out summary — those were a misdiagnosis propagated without trace verification.
### Acceptance Criteria
AC1. `plugins/sp/commands/dev-wrap.md` and `plugins/sp/commands/dev-wrapall.md` document and pass through `--dry-run` to `spur workflow run`; a dry-run wrap-up validates transitions without writing corpus or memory artifacts.

AC2. A real operator run of `/sp:dev-idea "<idea>" --auto` reaches `handoff` (creates/selects feature, writes AC, creates validated task batch) and `/sp:dev-wrapall --feature <id> --auto` writes `.spur/memory/learnings.md` + `.spur/memory/wrapup-metrics.jsonl` and reaches `done` without mutating task status. (Depends on AC6 fixes landing first.)

AC3. `planning-pipeline.yaml` `design-approval` behavior matches the design doc's HITL taxonomy — either the code is fixed to pause on `design-approval` under auto unless prior approval is represented, or the design doc is amended with a documented exception. No contradiction remains between `config/workflows/planning-pipeline.yaml` and `docs/design/e2e-workflow-for-system-development.md`.

AC4. (If pursued) `spur task batch-create` accepts a `dependencies` field and `spur task update --dependencies` sets it; OR a deferral decision is recorded in this task's Q&A.

AC5. Feature I is `done` (`spur feature check I --strict` passes); parent task 0167 is `done`.

AC6. (agent.run side-effect + convergence) After R6's S1+S2 fixes:
- idea-pipeline no longer loops ac-generate↔feature-check to exhaustion: a persistent feature-check failure escalates to `failed` after a capped number of retries (≤3) with a clear error, OR converges to a passing feature-check. A re-run of the idea-pipeline dogfood reaches `handoff` (not `failed`).
- wrapup-pipeline no longer reaches `done` with missing side-effects: if `learnings.md`/`wrapup-metrics.jsonl` are not written, the run routes to `failed` (not `done`); when omp writes them, the run reaches `done` with both files present.
- `agent.run` exposes an `expectFile`/`verify` option (or equivalent) that downgrades exit-0 to `ok:false` when the expected artifact is absent.
- The S3 A/B diagnostic is run and its result (nesting cleared or confirmed) is recorded in Q&A, and `.wolf/cerebrum.md` is corrected if the "agent.run can't nest" claim is cleared.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
This is a follow-up tracker, not a feature build. Each requirement is an independent action: R1 is a command-wrapper flag; R3 is a code/doc reconciliation; R4 is an optional schema decision; R5 is lifecycle closure. R6 is the substantive one — a root-cause fix for the agent.run side-effect + cyclic-convergence defects surfaced by the 0167 dogfood. No new skills (ADR-022). R6 may warrant its own decomposition (S1/S2/S3 are separable). Git commits are out of scope (operator-managed).

**R6 architecture — separate content-generation from validated writes (S2b):** The robust shape is: `agent.run` (with `capture`/`answerFile`) produces content as a captured artifact; a downstream `shell` action persists it through the gated `spur` CLI verb. This (1) makes the side-effect deterministic and verifiable (the shell step's exit code is the real success signal, and the file's existence is checkable), (2) honors iron law R8 #2 (every corpus write is CLI-gated — omp never writes the corpus directly), and (3) decouples "did the LLM produce content" from "was the write accepted." The current design asks omp to call `spur` itself inside agent.run, which conflates generation with validation and makes exit-0 a unreliable success signal. The `answerFile` transport already exists in `AgentRunActionRunner` (`packages/app/src/workflow/actions/agent-run.ts:85-103`); S2b reuses it rather than adding new mechanism.

**R6 root-cause evidence (not speculation):** Both traces are persisted in the Spur DB — `spur workflow trace 77c8d65c-3005-4f6f-bcfe-3bfdd7770869` (idea-pipeline, failed) and `spur workflow trace 7c2d1935-3b13-4346-b9d5-a8aeebb51b77` (wrapup-pipeline, done). Every agent.run step in both is marked ✓ (exit 0), proving the omp subprocess completes — the "agent.run can't nest" framing is disproven by this evidence.

**Provenance:** R1 from the 0167 dogfood brainstorm (deleted after capture). R2/R6 from the dogfood traces + `agent-run.ts` source. R3 surfaced in task 0171's Review. R4 noted during 0167 Phase 0. R5 follows from the wrapup feature-transition contract (design doc R15).
### Plan
Ordered checklist. R6 sub-steps are sequential (S1/S2 before S3); R1/R3/R4/R5 are independent.

**Track A (done — 2026-07-01):**

- [x] R1: Add `--dry-run` to `plugins/sp/commands/dev-wrap.md` + `plugins/sp/commands/dev-wrapall.md` (pass through to `spur workflow run --dry-run`). Done during 0167 dogfood; verified by R30 structural test.
- [x] R6-S1: Add retry cap + escalation to `feature-check → ac-generate` and `batch-create → decompose` edges in `config/workflows/idea-pipeline.yaml`. Done — file-based counters with `-lt 3` cap and `failed` escalation (lines 222-233, 274-285). Counters reset in `start` state onEnter. Validated with `spur workflow validate`.
- [x] R6-S2a: Add `expectFile`/`verify` option to `AgentRunActionRunner` (`packages/app/src/workflow/actions/agent-run.ts`). Done — 31 tests, 100% coverage.
- [x] P2 (dogfood finding): Fix R-numbering L3 heuristic false-positive on multi-line requirements. Done — changed from per-line to block-based counting in `packages/app/src/services/task-check.ts:218-240`. Regression test added. 2040 tests pass.
- [x] R3: Reconcile `planning-pipeline.yaml`'s `design-approval` with design doc HITL taxonomy. Done — added `pause: true` + `hitl.confirm` onEnter to the bare `design-approval` state (`config/workflows/planning-pipeline.yaml:80-93`). Now matches idea-pipeline pattern. Validated with `spur workflow validate`.
- [x] P3 (dogfood finding): Add post-implement format step + post-test lint gate. Done — `config/workflows/task-pipeline.yaml`: implement gets `bun run format` cleanup step; test gets `bun run lint` gate step. Validated with `spur workflow validate`.
- [x] Idea-pipeline YAML colon fix: Quoted transition descriptions at lines 222,274 — unquoted `(retry cap: 3)` caused YAML nested-mapping parse error. `spur workflow validate` now clean.

**Track B (pending for next round):**

- [ ] R6-S2b: Refactor `ac-generate`, `learning-capture`, `metrics-record` to the capture+shell pattern (agent.run captures content to answerFile; downstream shell writes via gated `spur` CLI verb). Substantial — 3-state refactor across 2 workflows. Defer: next round.
- [ ] R6-S3: Run the A/B nesting diagnostic — idea-pipeline + wrapup-pipeline from a TOP-LEVEL operator session (not a subagent), after S2b. Record result in Q&A. `.wolf/cerebrum.md` already corrected (the "agent.run can't nest" claim was disproven by traces). Defer: after S2b.
- [ ] R2: Live operator dogfood of `/sp:dev-idea` and `/sp:dev-wrapall` (after S2b+S3 land). Defer: after S2b+S3.
- [ ] R4: (optional) Add `dependencies` to batch schema + `--dependencies` to `spur task update`, OR record deferral in Q&A. Defer: next round.
- [ ] R5: Advance feature I → `done` (strict check); parent 0167 → `done`. Defer: after all other R-items.
### Solution
**Implemented — Track A (2026-07-01):**

- **P2 — R-numbering heuristic** (`packages/app/src/services/task-check.ts:218-240`): Changed from per-line counting to block-based counting. Multi-line R-item bodies no longer dilute the ratio — the heuristic splits the Requirements body into blank-line-separated blocks and checks whether each block's first line is R-numbered. Regression test in `packages/app/tests/services/task-check.test.ts` ("L3: multi-line R-numbered Requirements produce no warning"). 2040 tests pass, lint clean.
- **R3 — Planning-pipeline design-approval** (`config/workflows/planning-pipeline.yaml:80-93`): The `design-approval` state was a bare node with no pause mechanism — the mis-indented `options:`/`prompt:` at the old lines 87-88 was dead YAML, not a valid `onEnter` action. Under `profile=auto` without `design_approved=true`, the run auto-transitioned through it via `always` guard (no pause, no HITL). Fixed: added `pause: true` + `onEnter` with `hitl.confirm`, matching the `idea-pipeline.yaml` design-approval pattern. Now correctly pauses as a taste gate per the design doc HITL taxonomy (Auto-Decision Principle #5). Validated with `spur workflow validate`.
- **P3 — Implement format + test lint gate** (`config/workflows/task-pipeline.yaml`): Implement stage gets `bun run format` shell step after `spur task update wip` — auto-formats any unformatted agent output (prevents dogfood bug-733: omp left `agent-run.test.ts` unformatted, causing a spurious lint gate failure that `## Testing` mis-attributed to pre-existing gaps). Test stage gets `bun run lint` shell step after the agent.run — if the lint gate is red, the onEnter halts and the run routes to `failed` before review can advance. Validated with `spur workflow validate`.
- **Idea-pipeline YAML fix** (`config/workflows/idea-pipeline.yaml:222,274`): Two transition descriptions had unquoted `(retry cap: 3)` — the `: 3` sequence was parsed as a YAML nested mapping in compact form, causing `spur workflow validate` to fail. Quoted both descriptions. All three pipelines now validate clean.

**Already on disk from 0167 implementation (pre-existing, verified):**

- **R6-S2a** (`packages/app/src/workflow/actions/agent-run.ts:1,24-29,93,105-115,126-135`): `expectFile` option. After exit-0, asserts the expected side-effect artifact exists; absent → `ok: false`. Works in both capture and non-capture paths; relative paths resolve against `cwd`. 31 tests, 100% line + function coverage.
- **R1** (`plugins/sp/commands/dev-wrap.md`, `plugins/sp/commands/dev-wrapall.md`): Both command wrappers document and pass through `--dry-run` to `spur workflow run --dry-run`. Verified by R30 structural test (dev-wrap/dev-wrapall delegation).
- **R6-S1** (`config/workflows/idea-pipeline.yaml:222-233,274-285`): Retry caps on cyclic edges — feature-check→ac-generate uses file-based counter at `.spur/run/idea-ac-retry-count` with `-lt 3` guard; cap-exceeded routes to `failed` via `-ge 3` guard. Same pattern for batch-create→decompose. Counters reset to 0 in `start` state onEnter (`rm -f`). `iterationBound: 15` is the engine-level safety net. The 0174 Plan's earlier "not yet implemented" claim was stale — this was implemented during 0167 Phase 2 (0170) and confirmed on disk.
- **R30–R35** (`plugins/sp/tests/skill-structure.test.ts:294-350`): Six structural tests — dev-idea/dev-wrap/dev-wrapall delegation, gate-checklists existence+link, dev-operations registration, cross-cutting sections, idea/wrapup pipeline schema, brainstorm Design Approval Gate. 22 pass.
- **Checkpoint writes** (`config/workflows/feature-dev.yaml:89-93`, `config/workflows/planning-pipeline.yaml:93-97`, `config/workflows/task-pipeline.yaml:150-153`): Terminal states write session checkpoints to `.spur/memory/sessions/` for resume support (0171 R3).

**Track B — pending for next round:**

- R6-S2b: Capture+shell refactor for ac-generate, learning-capture, metrics-record (3 states across idea-pipeline + wrapup-pipeline). Design: agent.run with `capture`/`answerFile` produces content; downstream `shell` action persists through the gated `spur` CLI verb. Decouples generation from validation; makes side-effects deterministic and CLI-gated (iron law R8 #2).
- R6-S3: A/B nesting diagnostic — run both pipelines from a top-level operator session (not a subagent). Record result in Q&A. `.wolf/cerebrum.md` already corrected (trace evidence disproved the "agent.run can't nest" claim).
- R2: Live operator dogfood of `/sp:dev-idea "<idea>" --auto` and `/sp:dev-wrapall --feature <id> --auto`. Depends on S2b+S3.
- R4: (optional) Add `dependencies` field to `apps/cli/schemas/task-batch.schema.json` + `--dependencies` flag to `spur task update`. Currently prose-sequenced via orchestrator. If not pursued, record deferral in Q&A.
- R5: Advance feature I → `done` and parent task 0167 → `done` (strict-check guards, no direct `backlog|active→done`). May use `/sp:dev-wrapall --feature I --auto` after R2 validates.
### Testing
**Unit tests — agent-run.ts (R6-S2a: expectFile/verify):**
- `packages/app/tests/workflow/actions/agent-run.test.ts` — 31 tests, all pass.
- Coverage: `agent-run.ts` — 100% lines, 100% functions.
- expectFile tests cover: non-capture exit-0 + file exists/absent, capture exit-0 + file exists/absent, relative path resolution against cwd, non-zero exit skips expectFile check (both paths), answerFile + expectFile together.
- timeoutMs tests cover: flag pass-through, absent when unset, non-zero exit with timeout, 0/negative validation, non-numeric string silent no-op.

**Structural tests — sp plugin (R30–R35):**
- `plugins/sp/tests/skill-structure.test.ts` — 22 tests, all pass.
- R30: dev-idea, dev-wrap, dev-wrapall command docs exist and delegate to correct workflows (idea-pipeline / wrapup-pipeline).
- R34: idea-pipeline.yaml and wrapup-pipeline.yaml exist with valid schema ref and `kind: state-machine`.
- R33: cross-cutting.md includes all six required convention sections.
- R35: brainstorm SKILL.md includes Design Approval Gate and needs_design signal.

**Workflow validation:**
- `spur workflow validate config/workflows/idea-pipeline.yaml` — valid (13 states, 13 transitions, terminalStates: handoff/cancelled, iterationBound: 15).
- `spur workflow validate config/workflows/wrapup-pipeline.yaml` — valid (9 states, 11 transitions, terminalStates: done/skipped, iterationBound: 10).

**Workspace test suite:**
- `packages/app/tests/` — 656 tests across 33 files, 0 fail. (Exit code 1 from pre-existing coverage gaps in packages/config and packages/domain — not from task 0174 changes.)
- `plugins/sp/tests/` — 22 tests, 0 fail.

**Not yet implemented (no code to test):**
- R6-S1: Retry caps with setVars counter on ac-generate↔feature-check and batch-create→decompose edges. The `iterationBound: 15` is the engine-level safety net, but the R6-S1-specific ≤3 retry cap with `failed` terminal state is not yet implemented.
- R6-S2b: Refactor ac-generate, learning-capture, metrics-record to capture+shell pattern.
- R6-S3: A/B nesting diagnostic.
- R2, R3, R4, R5: Operational/doc/reconciliation items, no code changes to test.
### Review
**SECUA Review — Task 0174 (R6-S2a: expectFile/verify)**

**Scope:** `packages/app/src/workflow/actions/agent-run.ts` (+29 lines), `packages/app/tests/workflow/actions/agent-run.test.ts` (+117 lines, 8 new tests). R6-S2a only; R1/R6-S1/S2b/S3 not yet implemented (task is `wip`).

**Findings (ranked by severity):**

| # | Severity | Dimension | File:Line | Finding | Remediation |
|---|----------|-----------|-----------|---------|-------------|
| 1 | minor | Architecture | agent-run.ts:106-115, 126-135 | expectFile verification logic duplicated between capture and non-capture paths (~10 identical lines; only `data.answer` differs in capture path) | Acceptable as-is — data shape difference makes extraction add indirection for marginal DRY gain. If a third path emerges, extract `verifyExpectFile(expectFile, cwd, agentLabel)` returning `string \| undefined` (error). |
| 2 | minor | Correctness | agent-run.ts:93 | Empty-string `expectFile: ""` passes `asOptionalString`, resolves to `join(cwd, "")` = cwd, `existsSync(cwd)` returns true → silently passes | Low risk (workflow YAML wouldn't set empty string). If hardening desired: add `expectFile !== ''` guard. Consistent with `answerFile` which has the same edge case. |

**Test coverage:** 8 tests covering all 4 branches (capture/non-capture × file exists/absent), non-zero exit skip (both paths), relative path resolution, and answerFile+expectFile combined. 100% line and function coverage on `agent-run.ts`. Comprehensive.

**Not yet implemented (expected for `wip`):**

- R1: `--dry-run` flag not added to `dev-wrap.md` / `dev-wrapall.md` command docs (grep confirms zero matches)
- R6-S1: Retry caps with setVars counter on ac-generate↔feature-check and batch-create→decompose edges
- R6-S2b: capture+shell pattern refactor for ac-generate / learning-capture / metrics-record
- R6-S3: A/B nesting diagnostic (top-level vs subagent)
- R2 / R3 / R4 / R5: Operational / reconciliation items, no code changes

**Review verdict:** No blockers, no majors. Implementation is clean, well-tested, follows existing patterns (`answerFile`, `timeoutMs`). Minor findings are advisory only — no gate effect.
### References
- Parent: `docs/tasks2/0167_*.md` (feature I)
- Children: `docs/tasks2/0168-0173_*.md`
- Design: `docs/design/e2e-workflow-for-system-development.md`
- R6 root-cause evidence (persisted traces): `spur workflow trace 77c8d65c-3005-4f6f-bcfe-3bfdd7770869` (idea-pipeline, failed — ac-generate↔feature-check loop); `spur workflow trace 7c2d1935-3b13-4346-b9d5-a8aeebb51b77` (wrapup-pipeline, done — agent.run exit-0 but no files written)
- R6 code refs: `packages/app/src/workflow/actions/agent-run.ts:85-114` (agent.run exit-0=ok, answerFile/capture, setVars latch); `config/workflows/idea-pipeline.yaml:210-213` (feature-check→ac-generate failure-edge, no cap); `config/workflows/idea-pipeline.yaml:255-258` (batch-create→decompose, same shape); `packages/app/src/services/agent-service.ts:159-333` (AgentService.run → AiRunner.runPromptCommand → subprocess spawn); `.spur/config.yaml:31-32` (default agent = `omp`, `/Users/robin/.bun/bin/omp`)
- R1 code refs: `apps/cli/src/commands/workflow.ts:106` (--dry-run), `packages/app/src/services/workflow-service.ts:367-369` (dryRun stamp)
- R4 code refs: `apps/cli/schemas/task-batch.schema.json` (no dependencies field), `apps/cli/src/commands/task.ts:136-149` (no --dependencies)
- R3 code refs: `config/workflows/planning-pipeline.yaml:15,81-82,140-143` (design-approval auto-skip) vs `docs/design/e2e-workflow-for-system-development.md:118,312` (taste-gate taxonomy)
### History
- 2026-07-01T22:39:02.795Z todo → wip (system)
- 2026-07-01T22:56:34.225Z wip → testing (system)
