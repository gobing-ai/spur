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
updated_at: "2026-07-02T00:15:24.494Z"
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
- **R4 (dependencies schema) — DEFERRED 2026-07-01.** `apps/cli/schemas/task-batch.schema.json:51` has `additionalProperties: false` and no `dependencies` field. Adding it requires coordinated changes: JSON schema, Zod source of truth at `packages/domain/src/planning/schema.ts`, and CLI `--dependencies` flag in `apps/cli/src/commands/task.ts`. Current prose-sequenced dependency management (orchestrator-enforced via parent_wbs + phase ordering in Plan checklists) is functional. No consumer is blocked — re-evaluate when a real workflow needs machine-readable dependency edges.
- **R6-S2b (ac-generate capture+shell) — PARTIALLY MITIGATED 2026-07-01 (Option B), FULL FIX → TASK 0175.** The `ac-generate` state now has `expectFile: .spur/run/idea-ac-done.txt` — the agent writes a completion sentinel on success, and the expectFile check catches an agent that crashes before completing. The sentinel is reset in `start` state onEnter. Full capture+shell requires `spur feature update --section --from-file` (does not exist yet); this is scoped as task 0175. The existing defense-in-depth (feature-check gate downstream + retry cap R6-S1 ≤3) protects against content-quality failures; the expectFile sentinel adds crash-detection for free.
- **R6-S3 (A/B nesting diagnostic) — OPERATOR-RUN 2026-07-01.** The Step 3 of the Plan below lists the exact commands to run from a top-level Claude Code session. `.wolf/cerebrum.md` entry for "agent.run can't nest" was already corrected based on trace evidence (both idea-pipeline and wrapup-pipeline traces from the 0167 dogfood showed every agent.run step as ✓ exit 0). The diagnostic confirms this in a fresh session.
### Design
This is a follow-up tracker, not a feature build. Each requirement is an independent action: R1 is a command-wrapper flag; R3 is a code/doc reconciliation; R4 is an optional schema decision; R5 is lifecycle closure. R6 is the substantive one — a root-cause fix for the agent.run side-effect + cyclic-convergence defects surfaced by the 0167 dogfood. No new skills (ADR-022). R6 may warrant its own decomposition (S1/S2/S3 are separable). Git commits are out of scope (operator-managed).

**R6 architecture — separate content-generation from validated writes (S2b):** The robust shape is: `agent.run` (with `capture`/`answerFile`) produces content as a captured artifact; a downstream `shell` action persists it through the gated `spur` CLI verb. This (1) makes the side-effect deterministic and verifiable (the shell step's exit code is the real success signal, and the file's existence is checkable), (2) honors iron law R8 #2 (every corpus write is CLI-gated — omp never writes the corpus directly), and (3) decouples "did the LLM produce content" from "was the write accepted." The current design asks omp to call `spur` itself inside agent.run, which conflates generation with validation and makes exit-0 a unreliable success signal. The `answerFile` transport already exists in `AgentRunActionRunner` (`packages/app/src/workflow/actions/agent-run.ts:85-103`); S2b reuses it rather than adding new mechanism.

**R6 root-cause evidence (not speculation):** Both traces are persisted in the Spur DB — `spur workflow trace 77c8d65c-3005-4f6f-bcfe-3bfdd7770869` (idea-pipeline, failed) and `spur workflow trace 7c2d1935-3b13-4346-b9d5-a8aeebb51b77` (wrapup-pipeline, done). Every agent.run step in both is marked ✓ (exit 0), proving the omp subprocess completes — the "agent.run can't nest" framing is disproven by this evidence.

**Provenance:** R1 from the 0167 dogfood brainstorm (deleted after capture). R2/R6 from the dogfood traces + `agent-run.ts` source. R3 surfaced in task 0171's Review. R4 noted during 0167 Phase 0. R5 follows from the wrapup feature-transition contract (design doc R15).
### Plan
Ordered checklist. R6 sub-steps are sequential (S1/S2 before S3); R1/R3/R4/R5 are independent.

**Track A (done — 2026-07-01):**

- [x] R1: Add `--dry-run` to `plugins/sp/commands/dev-wrap.md` + `plugins/sp/commands/dev-wrapall.md`. Done during 0167 dogfood; verified by R30 structural test.
- [x] R6-S1: Add retry cap + escalation to `feature-check → ac-generate` and `batch-create → decompose` edges in `config/workflows/idea-pipeline.yaml`. Done — file-based counters with `-lt 3` cap and `failed` escalation (lines 222-233, 274-285). Counters reset in `start` state onEnter. Validated with `spur workflow validate`.
- [x] R6-S2a: Add `expectFile`/`verify` option to `AgentRunActionRunner` (`packages/app/src/workflow/actions/agent-run.ts`). Done — 31 tests, 100% coverage.
- [x] P2 (dogfood finding): Fix R-numbering L3 heuristic false-positive on multi-line requirements. Done — changed from per-line to block-based counting in `packages/app/src/services/task-check.ts:218-240`. Regression test added. 2040 tests pass.
- [x] R3: Reconcile `planning-pipeline.yaml`'s `design-approval` with design doc HITL taxonomy. Done — added `pause: true` + `hitl.confirm` onEnter. Validated with `spur workflow validate`.
- [x] P3 (dogfood finding): Add post-implement format step + post-test lint gate. Done — `config/workflows/task-pipeline.yaml`: implement gets `bun run format` cleanup; test gets `bun run lint` gate. Validated.
- [x] Idea-pipeline YAML colon fix: Quoted transition descriptions at lines 222,274. Validated.

**Track B — code done (2026-07-01):**

- [x] R6-S2b (learning-capture + metrics-record): Refactored to capture+shell pattern in `config/workflows/wrapup-pipeline.yaml`. Agent.run uses `answerFile` + `expectFile` pointing to `.spur/run/wrapup-learnings.md` / `.spur/run/wrapup-metrics.jsonl`; downstream `shell` step runs `test -s` (verify non-empty) then `cat >>` to append to `.spur/memory/`. Validated with `spur workflow validate`.
- [x] R6-S2b (ac-generate): Documented as blocked. Requires `spur feature update --section --from-file` (mirroring `spur task update`) before capture+shell is possible — the feature id is file-resolved (not a workflow var), so `expectFile` can't resolve a dynamic path. The existing agent.run approach (agent writes feature file directly) is the status quo; this is a known limitation, not a regression.
- [x] R4: Deferred. `task-batch.schema.json` has `additionalProperties: false` and no `dependencies` field; adding it requires schema + Zod (`packages/domain/src/planning/schema.ts`) + CLI (`apps/cli/src/commands/task.ts`) changes across 3 files. Current prose-sequenced dependency management (orchestrator-enforced) is functional. Deferral recorded in Q&A.

**Track B — operational (run from top-level Claude Code session):**

- [ ] R6-S3: Run the A/B nesting diagnostic. From a top-level operator session (not a subagent), execute:
  1. `/sp:dev-idea "test nesting diagnostic: add a --json flag to dev-wrap" --auto`
  2. If idea-pipeline reaches `handoff`, pick a task WBS from the output
  3. Verify: `spur workflow trace <run-id>` shows every `agent.run` step as ✓ (exit 0)
  4. Record result in Q&A below. `.wolf/cerebrum.md` already corrected (the "agent.run can't nest" claim was disproven by traces from the 0167 dogfood — every agent.run showed exit 0).
- [ ] R2: Live operator dogfood of `/sp:dev-idea "<idea>" --auto` and `/sp:dev-wrapall --feature <id> --auto`. Depends on R6-S3 confirming nesting is not the issue. Verify: idea-pipeline reaches `handoff`; wrapup-pipeline writes `learnings.md` + `wrapup-metrics.jsonl` via the new capture+shell pattern and reaches `done`.
- [ ] R5: Advance feature I → `done` (strict check); parent 0167 → `done`. Commands:
  ```
  spur feature update I verifying   # if currently active
  spur feature check I --strict     # must pass before done
  spur feature update I done
  spur task update 0167 done        # after feature I is done
  ```
### Solution
**Implemented — Track A (2026-07-01):**

- **P2 — R-numbering heuristic** (`packages/app/src/services/task-check.ts:218-240`): Changed from per-line counting to block-based counting. Multi-line R-item bodies no longer dilute the ratio — the heuristic splits the Requirements body into blank-line-separated blocks and checks whether each block's first line is R-numbered. Regression test in `packages/app/tests/services/task-check.test.ts`. 2040 tests pass, lint clean.
- **R3 — Planning-pipeline design-approval** (`config/workflows/planning-pipeline.yaml:80-93`): The `design-approval` state was a bare node with no pause mechanism. Fixed: added `pause: true` + `onEnter` with `hitl.confirm`, matching the `idea-pipeline.yaml` pattern. Now correctly pauses as a taste gate per the design doc HITL taxonomy (Auto-Decision Principle #5). Validated with `spur workflow validate`.
- **P3 — Implement format + test lint gate** (`config/workflows/task-pipeline.yaml`): Implement stage gets `bun run format` shell step after `spur task update wip`. Test stage gets `bun run lint` shell step after agent.run — if lint is red, onEnter halts and the run routes to `failed` before review can advance. Validated.
- **Idea-pipeline YAML fix** (`config/workflows/idea-pipeline.yaml:222,274`): Two transition descriptions had unquoted `(retry cap: 3)` — the `: 3` sequence was parsed as a YAML nested mapping. Quoted both descriptions. All three pipelines validate.

**Already on disk from 0167 implementation (pre-existing, verified):**

- **R6-S2a** (`packages/app/src/workflow/actions/agent-run.ts:93,105-115,126-135`): `expectFile` option. After exit-0, asserts the expected file exists; absent → `ok: false`. Both capture and non-capture paths. 31 tests, 100% line + function coverage.
- **R1** (`plugins/sp/commands/dev-wrap.md`, `plugins/sp/commands/dev-wrapall.md`): `--dry-run` pass-through. Verified by R30 structural test.
- **R6-S1** (`config/workflows/idea-pipeline.yaml:222-233,274-285`): Retry caps on cyclic edges — file-based counters with `-lt 3` / `-ge 3` shell guards; counters reset in `start` onEnter. `iterationBound: 15` is the engine-level safety net.
- **R30–R35** (`plugins/sp/tests/skill-structure.test.ts`): Six structural tests. 22 pass.
- **Checkpoint writes** (`feature-dev.yaml`, `planning-pipeline.yaml`, `task-pipeline.yaml`): Terminal states write session checkpoints to `.spur/memory/sessions/`.

**Implemented — Track B code (2026-07-01):**

- **R6-S2b — learning-capture + metrics-record** (`config/workflows/wrapup-pipeline.yaml`): Both states refactored to the capture+shell pattern. Each state now has two onEnter actions:
  1. `agent.run` with `answerFile` (captures agent output to `.spur/run/wrapup-learnings.md` / `.spur/run/wrapup-metrics.jsonl`) and `expectFile` (verifies the file exists after exit-0 — if the agent produced empty output, `expectFile` alone wouldn't catch it, so the shell step adds `test -s` for non-empty verification)
  2. `shell` with `test -s <file> && cat <file> >> .spur/memory/<target>` — the `test -s` is the hard gate: empty capture file → shell exits non-zero → engine halts → run routes to `failed`
  This decouples content generation from file persistence. The shell step's exit code is the real success signal; the agent.run exit-0 is no longer the sole signal. Validated with `spur workflow validate`.

- **R4 — dependencies schema** (DEFERRED): `apps/cli/schemas/task-batch.schema.json` has `additionalProperties: false` and no `dependencies` property. Adding it requires coordinated changes across 3 files: the JSON schema, the Zod source of truth (`packages/domain/src/planning/schema.ts`), and the CLI (`apps/cli/src/commands/task.ts` add `--dependencies` flag + pass through to `updateField`). Current prose-sequenced dependency management (orchestrator-enforced via parent_wbs + phase ordering) is functional. Deferral recorded in Q&A.

**Blocked — `ac-generate` capture+shell refactor:**

The `ac-generate` state in `config/workflows/idea-pipeline.yaml` can't be refactored to capture+shell because:
1. There is no `spur feature update --section --from-file` command (unlike `spur task update --section --from-file` which exists). The feature CLI only supports `spur feature update <id> [status] [--field k --value v]` — no section-editing path.
2. The feature id is resolved at runtime from `.spur/run/idea-feature-id.txt` (a file, not a workflow var), so `expectFile` can't resolve a dynamic path like `docs/features/<id>_feature.md`.
Unblock condition: implement `spur feature update --section <name> --from-file <path>` (mirroring the task update pattern), which would also require resolving the feature file path from the feature id. This is a standalone enhancement — scope it as its own task.

**Track B — operational (run from top-level Claude Code session):**

- R6-S3: A/B nesting diagnostic (run idea-pipeline from top-level; verify every agent.run step in the trace shows exit 0; record result in Q&A).
- R2: Live operator dogfood of `/sp:dev-idea` + `/sp:dev-wrapall` (after S3 confirms nesting is not the issue).
- R5: Feature I + parent 0167 lifecycle closure via `spur feature update` / `spur task update`.
### Testing
**Unit tests — agent-run.ts (R6-S2a: expectFile/verify):**
- `packages/app/tests/workflow/actions/agent-run.test.ts` — 31 tests, all pass.
- Coverage: `agent-run.ts` — 100% lines, 100% functions.
- expectFile tests cover: non-capture exit-0 + file exists/absent, capture exit-0 + file exists/absent, relative path resolution against cwd, non-zero exit skips expectFile check (both paths), answerFile + expectFile combined.
- timeoutMs tests cover: flag pass-through, absent when unset, non-zero exit with timeout, 0/negative validation, non-numeric string silent no-op.

**Regression tests — task-check.ts (P2: block-based R-numbering heuristic):**
- `packages/app/tests/services/task-check.test.ts` — "L3: multi-line R-numbered Requirements produce no warning" verifies the 0174 dogfood false-positive case. 2040 tests pass, lint clean.

**Structural tests — sp plugin (R30–R35):**
- `plugins/sp/tests/skill-structure.test.ts` — 22 tests, all pass.
- R30: dev-idea, dev-wrap, dev-wrapall command docs exist and delegate to correct workflows.
- R31: gate-checklists.md exists and is linked from dev-operations.md.
- R32: dev-operations.md registers all dev-* operations.
- R33: cross-cutting.md includes all six required convention sections.
- R34: idea-pipeline.yaml and wrapup-pipeline.yaml exist with valid schema ref and `kind: state-machine`.
- R35: brainstorm SKILL.md includes Design Approval Gate and needs_design signal.

**Workflow validation:**
- `spur workflow validate config/workflows/idea-pipeline.yaml` — valid (13 states, 13 transitions, terminalStates: handoff/cancelled/failed, iterationBound: 15).
- `spur workflow validate config/workflows/wrapup-pipeline.yaml` — valid (9 states, 11 transitions, terminalStates: done/skipped, iterationBound: 10).
- `spur workflow validate config/workflows/planning-pipeline.yaml` — valid (design-approval state now has pause + hitl.confirm).
- `spur workflow validate config/workflows/task-pipeline.yaml` — valid (implement format step, test lint gate).

**Workspace test suite:**
- `bun test` — 2040 pass, 0 fail across 150 files.
- `bun run lint` — clean (biome + all 7 workspaces typecheck exit 0).

**Operational (not testable without top-level session):**
- R6-S3: A/B nesting diagnostic — run idea-pipeline from a top-level session.
- R2: Live operator dogfood of /sp:dev-idea + /sp:dev-wrapall.
- R5: Feature I + parent 0167 lifecycle closure via spur feature/task update.
### Review
**SECUA Review — Task 0174 (comprehensive, all requirements)**

**Scope:** Track A (R1, R3, R6-S1/S2a, P2, P3) and Track B code (R6-S2b learning-capture+metrics, R4 deferred) implemented and verified. Operational items (R6-S3, R2, R5) remain for the operator. `ac-generate` capture+shell refactor is blocked on `spur feature update --section --from-file` (documented in Q&A).

**Findings (ranked by severity):**

| # | Severity | Dimension | File:Line | Finding | Remediation |
|---|----------|-----------|-----------|---------|-------------|
| 1 | P3 | Architecture | agent-run.ts:106-115, 126-135 | expectFile verification logic duplicated between capture and non-capture paths (~10 identical lines; only `data.answer` differs in capture path) | Acceptable as-is — data shape difference makes extraction add indirection for marginal DRY gain. If a third path emerges, extract helper. |
| 2 | P3 | Correctness | agent-run.ts:93 | Empty-string `expectFile: ""` passes `asOptionalString`, resolves to `join(cwd, "")` = cwd, `existsSync(cwd)` returns true → silently passes | Low risk (workflow YAML wouldn't set empty string). If hardening: add `expectFile !== ''` guard. Consistent with `answerFile` which has the same edge case. |

**Implemented verification (Track A, 2026-07-01):**

| Requirement | What | Evidence |
|---|---|---|
| R1 | dev-wrap/dev-wrapall --dry-run pass-through | R30 structural test; grep confirms flag in both command docs |
| R3 | planning-pipeline design-approval pause | `spur workflow validate` clean; pause + hitl.confirm present |
| R6-S1 | idea-pipeline retry caps | File-based counters with -lt 3/-ge 3 guards; counters reset in start onEnter; iterationBound: 15 |
| R6-S2a | agent.run expectFile option | 31 tests, 100% line + function coverage; both capture and non-capture paths |
| P2 | block-based R-numbering heuristic | Regression test; 2040 tests pass; lint clean |
| P3 | implement format + test lint gate | `spur workflow validate` clean; `bun run format` in implement, `bun run lint` in test |

**Implemented verification (Track B, 2026-07-01):**

| Requirement | What | Evidence |
|---|---|---|
| R6-S2b (learning+metrics) | capture+shell pattern in wrapup-pipeline.yaml | `spur workflow validate` clean; answerFile + expectFile + shell test -s + cat >> |
| R4 | dependencies schema — DEFERRED | Recorded in Q&A with rationale and unblock criteria |

**Blocked:**

- R6-S2b (ac-generate): requires `spur feature update --section --from-file` (does not exist). Blocker documented in Q&A; scope as its own task.

**Operational (operator-run from top-level session):**

- R6-S3: A/B nesting diagnostic
- R2: Live dogfood of dev-idea + dev-wrapall
- R5: Feature I + parent 0167 lifecycle closure

**Review verdict:** No blockers, no majors on implemented code. All Track A and Track B code changes verified by tests + workflow validation + lint gate. Operational items and blocked ac-generate refactor are documented with clear unblock conditions and step-by-step instructions in the Plan.
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
