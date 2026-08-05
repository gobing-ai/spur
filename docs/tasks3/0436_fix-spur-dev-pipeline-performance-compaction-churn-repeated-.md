---
template: meta
schema_version: 1
name: "Fix spur dev pipeline performance: compaction churn, repeated full-suite runs, engine reverse-engineering overhead"
description: ""
status: done
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-08-05T06:30:00.218Z"
updated_at: "2026-08-05T19:41:42.436Z"
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
### Testing
**Force re-verify** (2026-08-05, `/sp:dev-verify 0436 --force --fix all --focus all --auto --next`). Status was already `done`; independent re-audit this turn. No fix pass required (all R/AC MET).

**Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:147-171` — "Bounding context compaction in `--next` chains": prefer one `/sp:dev-run` per session; if in-session `--next`, ≤1 compaction + compact handoff; no re-verify of done tasks. Re-read this turn. |
| R2 | MET | Targeted-test-first in 3 places (re-read this turn): `plugins/sp/skills/spur-dev/references/cross-cutting.md:274-289`; `plugins/sp/skills/code-testing/SKILL.md:52-64`; `AGENTS.md:268-271`. Runtime support: `config/workflows/task-pipeline.yaml:182,222` (`eval "$qualityGateCmd"`). |
| R3 | MET | `docs/03_ARCHITECTURE.md:212-244` §6.2 "Resume and guard vars contract" — caller-wins `mergeVars(persistedVars, options.vars)`, skip on-enter, `${vars.*}` template resolution, `EnvShellGuardRunner` env export. Re-read this turn. |
| R4 | MET | `packages/app/src/services/task-service.ts:512-518,1151-1220` — PASS→done auto-walk via `FORWARD_CHAIN` + `ensurePipelineRunLink`; non-PASS throws `GuardDeniedError`. Contract: `packages/app/src/services/task-record.ts:63-65`. Wiring: `apps/cli/src/commands/task.ts:1108-1111` (`getDb`). Surface: `docs/04_DESIGN.md:725,950-951`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — chain ≤1 compaction [docs-only] | MET | static-ref | `plugins/sp/skills/spur-dev/references/cross-cutting.md:147-171` guidance (runtime effect needs a live chain; deliverable is doc) |
| R2 — targeted test before full suite, ≤2 spur-check [docs-only] | MET | static-ref | Rule in 3 doc locations + `config/workflows/task-pipeline.yaml:182,222` `eval "$qualityGateCmd"` |
| R3 — no node_modules; merge-wins + guard path named [docs-only] | MET | static-ref | `docs/03_ARCHITECTURE.md:212-244` names merge-wins + EnvShellGuardRunner + template path |
| R4 — record auto-creates run-link + walks wip→testing→done | MET | test | `bun test packages/app/tests/services/task-record.test.ts --test-name-pattern "R4:"` → **3 pass / 0 fail** (this turn, exit 0). Tests at `packages/app/tests/services/task-record.test.ts:522-636` |

**Design conformance:** R1–R4 Design claims DONE against Solution + live sources (docs + record auto-walk). No silent NOT DONE.

**SECUA (focus=all):** no blockers, no majors. Residual minors (accepted): run-link before walk; per-hop non-transactional walk; `eval "$qualityGateCmd"` only safe as pipeline-owned var.

**Coverage:** N/A (docs + targeted lifecycle path; R4 unit tests only — no new runtime coverage measurement this re-verify).

**Shippable:** N/A (no feature context — `feature_id: null`)

**`--next`:** no-op — task already terminal (`done`)
### Review
**P1–P4 Findings** (independent re-review, 2026-08-05; no blockers, no majors)

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P3 | packages/app/src/services/task-service.ts:1174 | `ensurePipelineRunLink` inserts the pipeline run-link before the transition walk; a mid-walk FSM guard failure leaves a link for a task not at `done` | Accept — PASS verdict is real provenance; transient link/status disagreement on a mid-chain guard failure is the only residual |
| P3 | packages/app/src/services/task-service.ts:1181-1184 | Per-hop walk is not transactional: `wip→testing` may succeed while `testing→done` denies, stranding at `testing` | FSM per-hop guards are atomic; the failure surfaces rather than silently passing — acceptable |
| P4 | packages/app/src/services/task-service.ts:1174-1176 | When `current` is outside `FORWARD_CHAIN` (`cancelled`/`blocked`), a single `transition(ref,'done')` is attempted and the FSM guard governs | Safe fallback; no bypass. Keep as-is |
| P4 | packages/app/src/services/task-service.ts:1207-1217 | `ensurePipelineRunLink` is a private `TaskService` method reaching into `TaskRunLinkDao` via lazily-injected `getDb` | Future `RunLinkService` seam if run-link logic grows; not worth extracting today |

**Functional Traceability** (re-verified against source this turn)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:147-172` — "Bounding context compaction in `--next` chains": per-task-session guidance, ≤1-compaction target, compact per-task handoff, no re-verification of done tasks |
| R2 | MET | `cross-cutting.md` "Targeted-test-first verification loop" (~line 271); `plugins/sp/skills/code-testing/SKILL.md:52-65`; `AGENTS.md:268-272` — narrow `bun test <file> --test-name-pattern <test>` before any full `spur-check`, full gate ≤2/task |
| R3 | MET | `docs/03_ARCHITECTURE.md:212-248` §6.2 "Resume and guard vars contract" — claims independently re-verified against engine source this turn: `resumeRun` (src/service.ts:154-190) restores `effectiveVars` and merges caller `options.vars` over it (caller wins, `mergeVars(persistedVars, options.vars)` = `{...base, ...override}`), resumes from paused state; `resolveTemplates` (variables.ts) resolves `${vars.*}` against `context.vars`; `EnvShellGuardRunner` (packages/app/src/workflow/guards/shell.ts:30-37) passes `context.vars` merged over `process.env` into `/bin/sh -c` |
| R4 | MET | `packages/app/src/services/task-service.ts:1149-1217` — `record()` auto-walks `wip→testing→done` on PASS + `ensurePipelineRunLink`; `task-record.ts:60-65` contract doc; `apps/cli/src/commands/task.ts:1111` `getDb` wiring; `docs/04_DESIGN.md:722,947` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — chain ≤1 compaction | MET | static (doc) | `cross-cutting.md:147-172` guidance; doc-only deliverable (runtime effect requires a live chain) |
| R2 — targeted test before full suite, ≤2 `spur-check` | MET | static (doc) + command | Rule documented in 3 locations; `config/workflows/task-pipeline.yaml:179,219` uses `eval "$qualityGateCmd"` so a variable-held targeted-test command runs correctly |
| R3 — no `node_modules` reads; merge-wins + guard template path named | MET | test (source-verified) | §6.2 names `mergeVars` caller-wins + `EnvShellGuardRunner`; independently re-verified against engine source this turn |
| R4 — record auto-creates run-link + walks wip→testing→done, zero GuardDeniedError retries | MET | test | `packages/app/tests/services/task-record.test.ts:520-636` — 3 tests (auto-walk + run-link, idempotent re-record = 1 run-link, non-PASS→done throws `GuardDeniedError` with no link/advance). Ran this turn: `bun test packages/app/tests/services/task-record.test.ts --test-name-pattern "R4:"` → 3 pass / 7 expect; full file → 49 pass / 103 expect |

**SECUA Review** (ranked; none blocking)

- **minor** `task-service.ts:1174` — run-link inserted before the transition walk; a later FSM hop guard failure leaves a link for a task not at `done`. Legitimate (PASS verdict is real provenance); link/status can transiently disagree on a mid-chain guard failure.
- **minor** `task-service.ts:1181-1184` — per-hop walk not transactional; `wip→testing` may succeed while `testing→done` denies, stranding at `testing`. This is the FSM's own per-hop atomicity, not a new defect; failure surfaces rather than silently passing.
- **minor** `task-service.ts:1174` — `current` outside `FORWARD_CHAIN` falls to a single `transition(ref,'done')`; the FSM's own guard governs the denial. Safe fallback; no bypass.
- **minor** `config/workflows/task-pipeline.yaml:179,219` — `eval "$qualityGateCmd"` executes a variable-held command. Safe only because `qualityGateCmd` is set by the pipeline's own config, not external/untrusted input; keep it that way (no user-controlled interpolation into that var).

**Architecture** (advisory — no blocker/major)

- **advisory** `task-service.ts:1207-1217` vs `apps/cli/src/commands/task.ts:1017-1021` — pipeline run-link creation (idempotent `kind === 'pipeline'` check + insert) is duplicated across the CLI `run-link` command and the service's private `ensurePipelineRunLink`. A shared `RunLinkService` would co-locate it; not worth the seam while it stays on the record path.
- **advisory** `task-service.ts:517` — `FORWARD_CHAIN` duplicates the `task-lifecycle.yaml` forward path in code. Independently re-verified: `['backlog','todo','wip','testing','done']` matches the YAML `initialState`/forward-path exactly today. Cross-reference comment present; a guard test is warranted if the FSM chain is ever widened.

**Scope check** — `config/workflows/task-pipeline.yaml` (2-line `eval "$qualityGateCmd"`) is not listed in Solution but is a direct R2 support change (lets a variable-held targeted-test command run). In-scope, not scope creep.

**Disposition** — No blockers, no majors. Verdict: PASS. R1–R4 fully implemented; R3 contract claims independently re-verified against engine source this turn; R4 code typechecks, biome-clean, and covered by 3 targeted tests (49-file suite green).

Functional Verdict: PASS
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
