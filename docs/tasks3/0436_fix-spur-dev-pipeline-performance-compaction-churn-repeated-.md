---
template: meta
schema_version: 1
name: "Fix spur dev pipeline performance: compaction churn, repeated full-suite runs, engine reverse-engineering overhead"
description: ""
status: done
type: meta
profile: standard
feature_id: H52
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-08-05T06:30:00.218Z"
updated_at: "2026-08-05T19:50:26.032Z"
---

## 0436. Fix spur dev pipeline performance: compaction churn, repeated full-suite runs, engine reverse-engineering overhead

### Background
Today's execution (2026-08-05, omp, spur-new project) ran three chained dev-run pipelines
(0431 → 0433 → 0434) end-to-end in a single session spanning 2.91 hours of wall time
(03:34 → 06:28 UTC). The operator flagged the run as "extremely slow." Forensic analysis of the
session JSONL identified avoidable cost drivers concentrated in three areas.

The session issued 432 tool executions: 129 reads, 174 bash commands (168 distinct), 50 edits,
33 greps, and 33 todo updates. Wall time was dominated by four context compactions, repeated
full-suite verification runs, and heavy reverse-engineering of installed engine internals.

Source confidence: High (OMP adapter, raw `custom` tool_execution_start events + message timestamps;
no tool_execution_end events exist, so command wall time is inferred from inter-tool gaps). This is a
single-session study of the spur-new repo's own dev loop; the three root causes are process-level and
recur on any long `--next` chain, not just this run.
### Requirements
- [x] R1. Long `--next` chains should avoid compaction churn: either run each task as its own session (separate `/sp-dev-run <wbs>` invocation) or have the next-router emit a compact per-task handoff. Target: `spur-dev` next-router / `cross-cutting.md` chaining guidance. Measurable: a three-task chain completes with ≤1 compaction instead of 4.
- [x] R2. Targeted-test-first discipline on the verification loop: run the narrow `bun test <file> --test-name-pattern <test>` before any full `spur-check`. Target: `sp-code-testing` / `code-testing` reference + the AGENTS.md verification-gate wording. Measurable: full `spur-check` runs ≤2 per task instead of 4 across a chain.
- [x] R3. Document the workflow engine's `resumeRun` vars-merge + shell-guard contract in-repo so agents stop reverse-engineering `node_modules`. Target: `docs/03_ARCHITECTURE.md` § workflow, or a `sp:spur-cli` reference note. Measurable: an agent resumes a paused workflow and guards evaluate correctly with zero `node_modules` reads.
- [x] R4. The record/lifecycle guard flow should not stall on bookkeeping: `spur task record` should auto-create the missing run-link and auto-walk `wip → testing → done` instead of surfacing a `GuardDeniedError` that requires the agent to re-issue `run-link` + intermediate status transitions. Target: `apps/cli` `task record` / lifecycle guard. Measurable: a completed task records + transitions to `done` in ≤1 attempt with zero `GuardDeniedError` retries.
### Acceptance Criteria
Feature: Spur dev-pipeline performance has bounded compaction and verification cost

  @core
  Scenario: R1 — chaining three tasks does not trigger compaction churn
    Given a `--next` chain of three dev-run tasks
    When the chain runs to completion
    Then the session performs at most one context compaction
    And no compaction is caused solely by accumulated cross-task context

  @core
  Scenario: R2 — targeted tests precede the full suite
    Given a task whose workflow-service tests fail
    When the agent iterates to green
    Then `bun test <file> --test-name-pattern <test>` runs before any full `spur-check`
    And the full `spur-check` runs at most twice per task

  @core
  Scenario: R3 — resume/guard behavior is discoverable without engine spelunking
    Given an agent resuming a paused workflow with an injected answer
    When it verifies guard evaluation
    Then it does not read `node_modules` to learn the `resumeRun` vars-merge contract
    And the in-repo reference names the merge-wins rule and the guard template path

  @core
  Scenario: R4 — recording a completed task does not stall on lifecycle bookkeeping
    Given a task whose pipeline run completed with a PASS verdict
    When the agent records and transitions it to done
    Then `spur task record` creates the run-link and walks `wip → testing → done` automatically
    And the agent issues zero `GuardDeniedError` retries for the transition
### Q&A
**Q1: Is compaction really the dominant cost?** The session logged 4 compactions in 2.9h. Each is a context rebuild the model must re-ingest and re-reason over; early compactions clustered ~20 min apart (03:45, 04:04, 04:23, 04:52) as the `--next` chain accumulated cross-task context. For a single-session multi-task run this is the structural driver of perceived slowness, not tool latency.

**Q2: Why split chains into per-task sessions instead of fixing compaction itself?** Compaction is an LLM-window mechanism, not a harness bug. The cheapest reliable lever is to not grow one session across multiple tasks — separate `/sp-dev-run` invocations each start a fresh window. A per-task compact handoff (R1) is the alternative that keeps `--next` ergonomics while bounding context.

**Q3: Hook or guidance for the test-loop fix?** Guidance first. The repeated `spur-check`/`bun test` runs stem from the verification gate wording not emphasizing targeted-first. A documentation change to `sp-code-testing` and the AGENTS.md gate is lower blast radius than a PreToolUse hook; only codify as a hook if guidance proves insufficient.

**Q4: What is the estimated saving?** R1 removes ~3 of 4 compactions (≈7–15 min of rebuild + re-exploration). R2 removes ~2 of 4 full `spur-check` runs and several redundant `bun test` runs (≈15–25 min). R3 removes ~39 node_modules investigation commands (≈10–15 min). Combined ≈ 30–55 min on a ~3h chain — a 20–30% wall-time reduction.

**Q5: Which task files / features are affected?** None functional — the fixes target dev-process guidance and in-repo documentation. They reduce latency on future `--next` chains (features D3/H82 workflows already landed).

**Q6: Why not auto-split `--next` now?** The next-router drives chaining; making it session-aware is a behavior change with its own risk (loses in-session continuity for later gates). Documented operator guidance (run each task as its own session) is the v1, testable change; auto-split is a possible follow-up.
### Design
## R1 — Bounded compaction for chained tasks

**Evidence:** 4 compaction events in one session at 03:45, 04:04, 04:23, 04:52 — clustering ~20–30 min apart during the `--next` chain. Each follows a full-turn context rebuild. The chain ran 0431→0433→0434 with no context reset between tasks.

**Fix:** Documented operator guidance in `cross-cutting.md` (or `spur-dev` next-router reference): for a multi-task chain, prefer one `/sp-dev-run <wbs>` per session, or expect/accept one compaction per long session. Emit a compact per-task handoff (goal + done set) if `--next` chaining is required to stay in-session.

**Target:** `plugins/sp/skills/spur-dev/references/cross-cutting.md` (Status transitions section) + `spur-dev` next-router reference.
**Expected saving:** ~7–15 min per chain (3 compactions avoided).

## R2 — Targeted-test-first verification loop

**Evidence:** 12 `bun test` runs (8 on `workflow-service.test.ts`), 4 full `spur-check` runs, 6 lint/autofix/typecheck runs. Repeated full-suite runs while iterating on the 0433 brace + guard-syntax fixes.

**Fix:** `sp-code-testing` reference + AGENTS.md verification gate: run the narrow `bun test <file> --test-name-pattern <test>` loop to green, then a single full `spur-check` as the final gate. Do not re-run the full suite on every iteration.

**Target:** `plugins/sp/skills/spur-dev/references/cross-cutting.md` / `sp-code-testing`; `AGENTS.md` Verification gate.
**Expected saving:** ~15–25 min per chain (avoided full-suite + redundant test runs).

## R3 — In-repo engine contract documentation

**Evidence:** 39 bash commands targeting `node_modules` (`cat`/`grep`/`sed` on `ts-dual-workflow-engine` `resumeRun`, `firstPassingTransition`, `hitl-confirm`) plus heavy reads — the agent reverse-engineered `mergeVars(persistedVars, options.vars)` and guard template resolution because they are not documented in-repo.

**Fix:** Add a short architecture/reference note documenting: `resumeRun` merges caller `options.vars` over the persisted `effectiveVars` snapshot (caller wins); shell guards resolve `\${vars.*}` templates before execution (and spur guards export vars into the subprocess env); resume skips state onEnter. This is the exact contract 0433/0434 relied on.

**Target:** `docs/03_ARCHITECTURE.md` § workflow (or a `sp:spur-cli` `workflows.md` reference note).
**Expected saving:** ~10–15 min per workflow-engineering task.

## R4 — Remove record/lifecycle bookkeeping stalls

**Evidence:** 10 `GuardDeniedError` mentions; 7 `task record` + 5 `task run-link` + 11 status updates across 3 tasks. `spur task record --transition done` denied `wip→done` ("No pipeline run recorded" / "No transition from wip to done"), forcing the agent to re-issue `run-link` then `wip→testing→done`. Recurred on every task (0431, 0433, 0434).

**Fix:** `spur task record` should auto-create the run-link when absent (it already knows the pipeline provenance from the run) and auto-walk `wip → testing → done` through the FSM when the verdict is PASS — surfacing a single clear error only when the verdict is not PASS. Keeps the guard on the verdict, not on bookkeeping.

**Target:** `apps/cli` `task record` (lifecycle guard integration).
**Expected saving:** ~3–5 min per task (avoided 3+ retries); removes the most recurring mechanical friction.
### Plan
- [x] R1: Add compaction-bounding guidance (per-task sessions or compact handoff) to cross-cutting / next-router reference.
- [x] R2: Add targeted-test-first rule to the verification gate + `sp-code-testing` reference.
- [x] R3: Document the engine `resumeRun` vars-merge + shell-guard contract in-repo.
- [x] R4: Make `spur task record` auto-create the run-link and auto-walk `wip → testing → done`.
- [x] Gate: `bun run lint` + `bun run test` green; verify R1–R4 against a fresh short chain.
### Solution
**R1 — bounded compaction for chained tasks**

- `plugins/sp/skills/spur-dev/references/cross-cutting.md:147-166` — new "Bounding context compaction in `--next` chains": prefer one `/sp:dev-run <wbs>` per session; when `--next` stays in-session, accept ≤1 compaction per long session and emit a compact per-task handoff (goal + done-set); don't re-run full verification for done tasks. Bounds the 4-compaction churn that dominated the 2.9h chain (target ≤1).

**R2 — targeted-test-first verification loop**

- `plugins/sp/skills/spur-dev/references/cross-cutting.md:274-287` — "Targeted-test-first verification loop": `bun test <file> --test-name-pattern <test>` to green before any full `spur-check`; full gate ≤2 per task.
- `plugins/sp/skills/code-testing/SKILL.md:52-65` — same rule in the test competency.
- `AGENTS.md:268-270` — verification-gate wording: targeted test first; full `spur-check` ≤2 per task.

**R3 — in-repo engine contract documentation**

- `docs/03_ARCHITECTURE.md:212-240` — §6.2 "Resume and guard vars contract": `resumeRun` restores persisted `effectiveVars` and merges caller `options.vars` over it (caller wins), resumes from the paused state skipping on-enter; shell guards resolve `${vars.*}` templates against `workflow.vars` (engine `resolveTemplates`) and spur's `EnvShellGuardRunner` passes `context.vars` merged over `process.env` into the subprocess (values are data, never re-parsed as code). Removes the 39-command `node_modules` reverse-engineering loop.

**R4 — remove record/lifecycle bookkeeping stalls**

- `packages/app/src/services/task-service.ts:1148-1217` — `record()` `--transition done` with a PASS verdict auto-walks the forward FSM chain (`wip → testing → done`) via per-hop `writeService.transition`, auto-creates the `pipeline` run-link (`ensurePipelineRunLink`, line 1202), is idempotent when already at target, and throws a single clear `GuardDeniedError` when the verdict is not PASS.
- `packages/app/src/services/task-record.ts:64-65` — updated `RecordOptions.transition` contract doc (was "never to done").
- `apps/cli/src/commands/task.ts:1111` — `makeService` passes `getDb` into `TaskServiceContext`.
- `docs/04_DESIGN.md:722,947` — `spur task record` surface documents the auto-walk/auto-run-link; the `task_run_links` R4 follow-up note is marked resolved.
- `packages/app/tests/services/task-record.test.ts:522-636` — 3 R4 tests: PASS→done walks wip→testing→done + creates a pipeline run-link; re-record is idempotent (one run-link); non-PASS→done throws `GuardDeniedError` without creating a link or advancing status.

Verified: `bun run lint` clean, `bun run test` 4534 pass / 0 fail, `bun run build` green; task-service.ts 96% line / 99.66% function coverage. Smoke: `spur task record --transition done` on a scratch PASS task auto-created the `pipeline` run-link (`run_id: record:<wbs>:…`, kind `pipeline`) and began the FSM walk.

**Residual fix pass (same task, post-verify)**

- `packages/app/src/services/pipeline-run-link.ts` — shared `ensurePipelineRunLink` + `TASK_FORWARD_CHAIN` (CLI `run-link` + `record` single owner).
- `task-service.ts` record walk — create pipeline run-link only immediately before hop to `done`; hop failures rethrow with status-reached context.
- `config/workflows/task-pipeline.yaml` — `eval` → `sh -c "$qualityGateCmd"`; trusted-config-only comments.
- Feature **H52** + dogfood `docs/dogfood/2026-08-05-H52-0436-dev-pipeline-performance-dogfood.md`.
- Tests: `pipeline-run-link.test.ts` (parity + idempotent ensure); residual deferred-link test in `task-record.test.ts`.
### Testing
**Force re-verify + residual fix pass** (2026-08-05). Status `done`; feature **H52**.

**Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:147-171` — Bounding context compaction in `--next` chains |
| R2 | MET | Targeted-test-first: `plugins/sp/skills/spur-dev/references/cross-cutting.md:274-289`; `plugins/sp/skills/code-testing/SKILL.md:52-64`; `AGENTS.md:268-271`. Runtime: `config/workflows/task-pipeline.yaml` uses `( sh -c "$qualityGateCmd" )` (trusted config only) |
| R3 | MET | `docs/03_ARCHITECTURE.md:212-244` §6.2 Resume and guard vars contract |
| R4 | MET | `packages/app/src/services/task-service.ts` record auto-walk; `packages/app/src/services/pipeline-run-link.ts` shared `ensurePipelineRunLink` (deferred until hop to `done`); CLI `run-link` reuses helper |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — chaining three tasks does not trigger compaction churn | MET | static-ref | `plugins/sp/skills/spur-dev/references/cross-cutting.md:147-171` [docs-only] |
| R2 — targeted tests precede the full suite | MET | static-ref | `plugins/sp/skills/spur-dev/references/cross-cutting.md:274-289`; `plugins/sp/skills/code-testing/SKILL.md:52-64`; `AGENTS.md:268-271`; `config/workflows/task-pipeline.yaml` `sh -c` [docs-only] |
| R3 — resume/guard behavior is discoverable without engine spelunking | MET | static-ref | `docs/03_ARCHITECTURE.md:212-244` [docs-only] |
| R4 — recording a completed task does not stall on lifecycle bookkeeping | MET | test | `bun test packages/app/tests/services/task-record.test.ts packages/app/tests/services/pipeline-run-link.test.ts` → 53 pass / 0 fail this turn |

**Residuals fixed this pass**

| Residual | Fix |
|----------|-----|
| L4.missing-feature-id | Linked to **H52**; feature AC matches task scenarios; dogfood artifact present |
| Run-link before whole walk | `ensurePipelineRunLink` only immediately before hop to `done` |
| Non-transactional walk opacity | Hop failures rethrow `GuardDeniedError` with status-reached + failed hop |
| Duplicated run-link CLI/service | Shared `pipeline-run-link.ts`; exported from `@gobing-ai/spur-app` |
| FORWARD_CHAIN vs lifecycle YAML | `TASK_FORWARD_CHAIN` + parity unit test |
| `eval "$qualityGateCmd"` | `sh -c` + trusted-config-only comments |

**Coverage:** N/A for docs paths; R4 unit coverage via task-record + pipeline-run-link tests.

**Shippable:** PASS — Feature H52 done; `spur feature check H52` pass:true findings:[]

**`--next`:** no-op — task already terminal (`done`)
### Review
**Residuals cleared** (2026-08-05 residual-fix pass). No open SECUA issues.

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P1 | — | None | — |
| P2 | — | None | — |
| P3 | packages/app/src/services/task-service.ts (record walk) | ~~Run-link before walk / opaque mid-walk failure~~ **Fixed** | Deferred `ensurePipelineRunLink` to hop-to-`done`; hop failures rethrow with status-reached context |
| P4 | packages/app/src/services/pipeline-run-link.ts | ~~CLI/service run-link duplication + FORWARD_CHAIN drift~~ **Fixed** | Shared helper + lifecycle YAML parity test |

**Prior residual disposition**

| Residual | Disposition |
|----------|-------------|
| Run-link before whole walk | **Fixed** — deferred to hop-to-`done`; regression test in `task-record.test.ts` |
| Per-hop non-transactional walk | **Mitigated** — explicit `GuardDeniedError` with reached status + failed hop |
| Outside FORWARD_CHAIN single hop | Intentional FSM-governed fallback; no bypass |
| CLI/service run-link duplication | **Fixed** — `ensurePipelineRunLink` shared |
| FORWARD_CHAIN vs lifecycle YAML | **Fixed** — parity unit test |
| `eval qualityGateCmd` | **Fixed** — `sh -c` + trusted-config-only |
| L4.missing-feature-id | **Fixed** — feature **H52** (done) + dogfood artifact |

**Functional Verdict:** PASS — R1–R4 MET; strict-core findings empty after residual pass.
### References
- Session JSONL: `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-05T03-34-24-170Z_019fcffc-92aa-7000-ad5f-d05c194e1229.jsonl` (+ `*.bash.log` subagent tool logs in its dir)
- Source/agent: omp (High fidelity)
- Tasks executed in-session: 0431, 0433, 0434 (all PASS) — `docs/tasks3/`
- Engine internals reverse-engineered: `@gobing-ai/ts-dual-workflow-engine` `resumeRun` (service.js ~127 `mergeVars`), `firstPassingTransition` (state-machine.js), `hitl-confirm` (`packages/app/src/workflow/actions/hitl-confirm.ts`)
- Relevant docs: `plugins/sp/skills/spur-dev/references/cross-cutting.md`, `docs/03_ARCHITECTURE.md` § workflow
### History
- 2026-08-05T17:44:56.391Z backlog → wip (system)
- 2026-08-05T18:48:16.494Z wip → testing (system)
- 2026-08-05T18:48:42.326Z testing → wip (system)
- 2026-08-05T18:57:26.893Z wip → testing (system)
- 2026-08-05T18:57:27.505Z testing → done (system)
### Notes
**Per-task execution summary (evidence — session `2026-08-05T03-34-24-170Z_*.jsonl`).** Tokens/cost from
per-message `message.usage` (input additive; input includes context re-send; `cost` = authoritative USD).

| Task | Wall (min) | Tools | Input tok | Output tok | Cost | % wall | % cost |
|------|-----------|-------|-----------|------------|------|--------|--------|
| 0431 · workflow run schema | 24 | 118 | 153k | 17k | $2.73 | 14% | 25% |
| 0433 · HITL `--answer` | 114 | 220 | 10.6M | 57k | $5.25 | 65% | 47% |
| 0434 · inline surface (ADR-046) | 22 | 75 | 16.1M | 32k | $2.26 | 13% | 20% |
| findissue + gitmsg | 15 | 24 | 6.4M | 12k | $0.89 | 8% | 8% |
| **TOTAL** | **175** | **437** | **33.2M** | **117k** | **$11.13** | 100% | 100% |

0433 dominates (65% wall, 47% cost, 50% tools) — the compaction churn + repeated test iteration +
engine reverse-engineering concentrate there. Avg cost ≈ $0.064/min.

**Repeated issues (cost time + tokens; all recur):**
- **RC1/RC2 (compaction churn, verification loop)** — as before; 4 compactions, 4 full `spur-check`, 12 `bun test`.
- **RC4 · lifecycle/record guard friction** — 10 `GuardDeniedError` mentions; 7 `task record` + 5 `task run-link` + 11 status updates across 3 tasks. `record --transition done` denies `wip→done`; requires a run-link + intermediate `testing`. Recurred on every task.
- **RC5 · carried-over test-file defect + guard-syntax** — 8 `bun test workflow-service.test.ts` runs: a pre-existing broken brace insertion (prior session) caused a syntax error, and `$__hitlAnswer` (env) vs `\${vars.__hitlAnswer}` (template) guard syntax failed under the test executor. Fold guard-template documentation into RC3/R3.
- **RC3 · engine reverse-engineering** — 39 `node_modules` reads; fixed by R3 in-repo docs.

**What worked (preserve):** task 0431 and 0434 were efficient; targeted `--test-name-pattern` runs used once added; CLI/service test isolation effective.
