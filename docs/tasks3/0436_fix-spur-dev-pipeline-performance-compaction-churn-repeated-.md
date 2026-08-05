---
template: meta
schema_version: 1
name: "Fix spur dev pipeline performance: compaction churn, repeated full-suite runs, engine reverse-engineering overhead"
description: ""
status: backlog
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-08-05T06:30:00.218Z"
updated_at: "2026-08-05T07:10:36.422Z"
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
- [ ] R1. Long `--next` chains should avoid compaction churn: either run each task as its own session (separate `/sp-dev-run <wbs>` invocation) or have the next-router emit a compact per-task handoff. Target: `spur-dev` next-router / `cross-cutting.md` chaining guidance. Measurable: a three-task chain completes with ≤1 compaction instead of 4.
- [ ] R2. Targeted-test-first discipline on the verification loop: run the narrow `bun test <file> --test-name-pattern <test>` before any full `spur-check`. Target: `sp-code-testing` / `code-testing` reference + the AGENTS.md verification-gate wording. Measurable: full `spur-check` runs ≤2 per task instead of 4 across a chain.
- [ ] R3. Document the workflow engine's `resumeRun` vars-merge + shell-guard contract in-repo so agents stop reverse-engineering `node_modules`. Target: `docs/03_ARCHITECTURE.md` § workflow, or a `sp:spur-cli` reference note. Measurable: an agent resumes a paused workflow and guards evaluate correctly with zero `node_modules` reads.
- [ ] R4. The record/lifecycle guard flow should not stall on bookkeeping: `spur task record` should auto-create the missing run-link and auto-walk `wip → testing → done` instead of surfacing a `GuardDeniedError` that requires the agent to re-issue `run-link` + intermediate status transitions. Target: `apps/cli` `task record` / lifecycle guard. Measurable: a completed task records + transitions to `done` in ≤1 attempt with zero `GuardDeniedError` retries.
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
- [ ] R1: Add compaction-bounding guidance (per-task sessions or compact handoff) to cross-cutting / next-router reference.
- [ ] R2: Add targeted-test-first rule to the verification gate + `sp-code-testing` reference.
- [ ] R3: Document the engine `resumeRun` vars-merge + shell-guard contract in-repo.
- [ ] R4: Make `spur task record` auto-create the run-link and auto-walk `wip → testing → done`.
- [ ] Gate: `bun run lint` + `bun run test` green; verify R1–R4 against a fresh short chain.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Session JSONL: `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-05T03-34-24-170Z_019fcffc-92aa-7000-ad5f-d05c194e1229.jsonl` (+ `*.bash.log` subagent tool logs in its dir)
- Source/agent: omp (High fidelity)
- Tasks executed in-session: 0431, 0433, 0434 (all PASS) — `docs/tasks3/`
- Engine internals reverse-engineered: `@gobing-ai/ts-dual-workflow-engine` `resumeRun` (service.js ~127 `mergeVars`), `firstPassingTransition` (state-machine.js), `hitl-confirm` (`packages/app/src/workflow/actions/hitl-confirm.ts`)
- Relevant docs: `plugins/sp/skills/spur-dev/references/cross-cutting.md`, `docs/03_ARCHITECTURE.md` § workflow
### History
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
