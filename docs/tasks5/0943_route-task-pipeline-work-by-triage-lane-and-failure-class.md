---
schema_version: 1
name: Route task-pipeline work by triage lane and failure class
status: todo
template: feature-impl
created_at: 2026-09-24T00:13:17.006Z
updated_at: "2026-09-24T00:27:33.452Z"
feature_id: D64
priority: P2
tags:
  - workflow
  - task-pipeline
  - promotion

dependencies: ["0938", "0940", "0941"]
estimate_hours: 8
---

## 0943. Route task-pipeline work by triage lane and failure class

### Background

Implements: R9 — Task pipeline routes work by triage lane and failure class; R4 — Workflow shape changes are accepted only on measured benefit. docs/design/workflow-catalogue-refactor.md §7. Uses the decide action and check receipts.

**Refine corrections (2026-09-23)**

1. *A review-bypass lane already exists.* `config/workflows/task-pipeline.yaml` already has proportional fast-path edges, `test → verify` and `test-recheck → verify`, guarded by `gate_status = PASS && mode = fast` (lines 656–708). Their safety twins go to `review`. The `mode` var (default `""`) has **no producer**: it is only settable by the caller. The `precheck` route-reason map (line 197) already names `fast | "" | unknown | conflict`. The "low lane" is therefore not a new skip edge. It is a deterministic plus `decide` **producer of `mode`**, feeding the existing edges.
2. *The approve pause is untouched.* Under `profile=auto`, `review` routes around `approve`. In interactive runs `approve` stays a `hitl.confirm` with `decision: {mode: never}` (line 455). Triage never touches it.
3. *Guards read JSON result files with `jq`.* This matches the existing `record`/`verify` shell guards. `file.read.into-var` projects raw trimmed content, which is not useful for a JSON result.
4. *Dependencies.* 0941 provides `decide`, and 0938 provides the baseline. 0940 is listed only because both edit `task-pipeline.yaml` (serialize the edits). The receipt from 0939 is used transitively through 0940.

### Requirements

- [ ] R1. A new deterministic state `triage` sits between a green gate and the review/verify fork. `test` (PASS) and `test-recheck` (PASS) route to `triage`, replacing their four PASS edges with two. `triage → verify` is guarded by `mode = fast`, and `triage → review` by `mode != fast`.
- [ ] R2. On entering `triage`:
  - (a) A deterministic producer writes `.spur/run/<wbs>-diffstat.json`: `{files, insertions, deletions, paths[], sensitive: boolean}`, from `git diff --numstat` against the run's base plus untracked files.
  - (b) If `mode` is already non-empty (caller-set), nothing is overridden.
  - (c) If `sensitive` is true (paths under `drizzle/`, `packages/config/`, `apps/server/src/**/auth*`, `**/*secret*`, `.github/`, `plugins/sp/hooks/`, or any `*.sql`), or the diff exceeds 400 changed lines, `mode` stays safety with a `triage: deterministic-high` reason. No `decide` call is made.
  - (d) Otherwise it runs `decide task-triage` (`method: choice`, choices `[low, standard, high]`, `default: standard`, evidence = diffstat plus the task Requirements). `low` sets `mode=fast`, and anything else leaves it empty.
- [ ] R3. On a FAIL at `test` or `test-recheck`, before `test-fix`, the `decide failure-class` action (`choices [retryable, fix, stop]`, `default: fix`, evidence = bounded `<wbs>-test-gate.findings`) routes:
  - `fix` → `test-fix`, as today;
  - `retryable` → `test-recheck` without fixall, still counting an attempt;
  - `stop` → `failed` with `terminalReason: failed-check`.
- [ ] R4. With `workflow.decideDecisionMaker` off, `decide` degrades to its defaults (`standard`, `fix`). The graph then behaves exactly as today, apart from the deterministic `triage` hop and diffstat file.
- [ ] R5. The `triage` route reason is appended to the existing `.spur/memory/task-pipeline-routes.log` line format.
- [ ] R6. A candidate record `task-pipeline-triage-lanes` is added to `config/workflow-candidates.json`, with 0938 `baselineAgentRunCount` and a deadline 60 days out. The verdict cites per-task `agent.run` count and `retry-exhausted` share. If it does not win, it is reverted.

### Acceptance Criteria

- [ ] AC1 — Task pipeline routes work by triage lane and failure class
- [ ] AC2 — Workflow shape changes are accepted only on measured benefit

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:58.178Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:27:33.224Z

**Refine decisions — 2026-09-23 (ready depth)**

- **Triage produces `mode` for the existing fast-path edges.** It adds no new skip edge. It reuses the 0587/proportional routing and its route-reason log.
- **Deterministic checks run before the model.** Sensitive paths and diffs over 400 lines are decided without `decide`.
- **Failure class `retryable` still counts an attempt.** The loop stays bounded by the existing cap.
- **Estimate: 8h** (plus shadow-run time).

### Design

**Approach.** One deterministic state (`triage`) and one pre-fix decision.
- The diffstat producer is a plugin script, `plugins/sp/scripts/task-diffstat.ts` (standalone, `node:*`/`bun:*` only), with the sensitive-path list as an exported constant.
- The `triage` onEnter sequence is `shell` (diffstat), then `decide`, then `shell` (project `mode` from the result file via `jq`, honoring a caller-set mode and `sensitive`), then `file.read.into-var` (`mode`).
- The failure-class `decide` runs inside the `test`/`test-recheck` onEnter after the gate, and only when the status is FAIL, using a `when`-style shell pre-check that skips writing on PASS. Alternatively it runs in a `test-fail-triage` deterministic state if onEnter conditionals are unavailable. The implementer picks the one the engine supports and records it in Solution.

**Frozen names:**
- state `triage`;
- decide ids `task-triage`, `failure-class`;
- files `<wbs>-diffstat.json`, `<wbs>-triage.decision`, `<wbs>-failure-class.decision`;
- candidate id `task-pipeline-triage-lanes`;
- script `task-diffstat.ts`.

**Invariants:**
- The full gate is always green before `verify` or `review`.
- The approve pause is unchanged.
- A caller-set `mode` wins.
- Sensitive paths never take the fast lane.
- The attempt cap still bounds `retryable`.

**Rejected alternatives:**
- A parallel `task-pipeline2.yaml` (retired pattern).
- Model-only risk judgment.
- Adding a new skip edge beside the existing fast-path edges.

**Anti-patterns:**
- Asking `decide` whether the gate passed.
- Letting `stop` bypass the `failed` state.

**Targets:**
- Inline parity check green.
- Composition baseline updated.
- Guard-parity fixture updated (`packages/app/tests/workflow/fixtures/guard-parity-baseline.json`).

### Plan

1. `plugins/sp/scripts/task-diffstat.ts`, with `plugins/sp/tests/task-diffstat.test.ts` (temp git repo covering sensitive and large diffs).
2. Candidate record, validated with `bun scripts/spur-dev.ts promotion`.
3. `task-pipeline.yaml`: the `triage` state and edges, plus failure-class routing with a `terminalReason` on the new `failed` edge (0937). Then update the guard-parity and composition baselines, run `bun run --filter @gobing-ai/spur build:bundle`, and run `inline-pipeline-parity-check`.
4. Workflow tests for routing: fast, safety, caller-mode, sensitive, degraded-default, and each of retryable/fix/stop.
5. Shadow runs on real tasks, then a verdict from the 0938 report.
6. Run `bun run spur-check` and `bun run plugin-smoke`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History
