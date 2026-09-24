---
schema_version: 1
name: Skip clean model passes in wrapup doc-sync and history-anatomy
status: todo
template: feature-impl
created_at: 2026-09-24T00:13:17.006Z
updated_at: "2026-09-24T00:28:27.289Z"
feature_id: D64
priority: P3
tags:
  - workflow
  - promotion

dependencies: ["0938"]
estimate_hours: 5
---

## 0944. Skip clean model passes in wrapup doc-sync and history-anatomy

### Background

Implements: R4 — Workflow shape changes are accepted only on measured benefit. docs/design/workflow-catalogue-refactor.md §7 (wrapup doc-sync, history-anatomy candidates).

**Refine corrections (2026-09-23)**

1. *The wrapup skip edge already exists.* `config/workflows/wrapup-pipeline.yaml` already routes `task-resolve → metrics-record` when `mode = fast` (the proportional fast path, around line 389), and to `doc-sync` otherwise. Like task-pipeline, `mode` (default `""`) has **no producer**: `/sp:dev-wrap` and `/sp:dev-wrapall` build `--vars` without `mode` (`dev-operations.md:366`, `:382`). The work is a deterministic drift probe that **produces `mode`**. No new edge is needed.
2. *doc-sync also captures learnings.* The `doc-sync` `agent.run` both repairs doc drift **and** captures learnings, merged in 0607 R2. It writes `.spur/run/<runId>-wrapup-learnings.md`, which `learnings-append` consumes. The existing fast path therefore also skips learnings capture. The candidate verdict must weigh that loss; it is not free.
3. *There is no doc-drift probe today.* `plugins/sp/scripts/surface-drift-inventory.ts` checks CLI-surface claims against live `--help`, not doc ownership. A new probe is needed.
4. *history-anatomy already has a cache branch.* `config/workflows/history-anatomy.yaml` already runs analyze → `cache-probe` (hit skips enrichment; ADR-079, 0659), with a deterministic structure gate and bounded correction. ADR-069 forbids inline shell for its deterministic work, which goes through the helper script. Original R2 ("enrich only over the deterministic diff") is therefore **measurement-only** here: cache-hit rate and failure/terminal-reason mix from 0938. Any graph fix is decided in 0946.
5. *The title is stale but kept.* `spur task update` has no rename flag, so the history-anatomy half now means "measure" (this correction).

### Requirements

- [ ] R1. A deterministic probe `plugins/sp/scripts/wrapup-drift-probe.ts` (plugin standalone) reads the normalized task list `.spur/run/<runId>-wrapup-tasks.json`. For each task it collects changed paths from the `## Solution` file:line map (via `spur task show <wbs> --json`). It writes `.spur/run/<runId>-drift-probe.json` as `{clean: boolean, reasons[], paths[]}`.
- [ ] R2. `clean` is false when any changed path matches a doc-owned surface:
  - `packages/contracts/**`
  - `apps/cli/src/commands/**`
  - `packages/config/src/**`
  - `drizzle/*.sql`
  - `config/workflows/**`
  - `plugins/sp/{commands,skills,hooks}/**`
  - root `package.json` scripts
  - `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md` or `docs/design/**`
  - a new top-level workspace directory

  It is also false when any task's Solution is empty or unparseable (fail safe).
- [ ] R3. `task-resolve` runs the probe only when `mode` is empty. A clean probe sets `mode=fast`, and the route reason becomes `fast:drift-probe-clean`. A caller-set `mode` is never overridden. The route-reason map gains `"safety": "safety:operator-forced doc-sync"`, so `--vars '{"mode":"safety"}'` forces doc-sync.
- [ ] R4. The candidate record `wrapup-drift-probe` has 0938 `baselineAgentRunCount` and a deadline 60 days out. Its verdict cites doc-sync `agent.run` count per wrap, plus the count of wraps whose learnings were skipped. If it does not win, it is reverted.
- [ ] R5. history-anatomy is measurement only. The 0938 report's per-state view for `history-anatomy` (cache-probe hit/miss via `cache-disposition`, enrich/validate/correction visits and terminal-reason mix) is pinned in the 0938 baseline and cited by 0946. This task makes no history-anatomy YAML change.

### Acceptance Criteria

- [ ] AC1 — Workflow shape changes are accepted only on measured benefit

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:58.569Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:28:27.100Z

**Refine decisions — 2026-09-23 (ready depth)**

- **The probe produces `mode` for the existing fast-path edge.** No new edge is added.
- **Skipping doc-sync also skips learnings capture.** This is accepted as a measured tradeoff in the candidate verdict. If learnings loss is material, the verdict is `retire` or a follow-up to split learnings into a deterministic or cheap capture.
- **history-anatomy is measurement only.** It already has a cache branch, and its graph decision moves to 0946.
- **The title is kept.** There is no CLI rename, and the Background correction records the narrowed scope.
- **Estimate: 5h** (plus shadow-run time).

### Design

**Approach.**
- A deterministic probe script and a `task-resolve` onEnter hook. The probe runs before the existing route-reason writer, so the reason reflects the projected `mode`. It projects `mode` via `shell` (writing a file), then `file.read.into-var`.
- The doc-owned path list is one exported constant in the probe. It is derived from the AGENTS.md doc map and `docs/99_PROJECT_CONSTITUTION.md` ownership table, with a comment citing both.

**Frozen names:**
- the script `wrapup-drift-probe.ts` and file `<runId>-drift-probe.json`;
- route reason `fast:drift-probe-clean`;
- mode value `safety`;
- candidate id `wrapup-drift-probe`.

**Invariants:**
- Fail safe: any doubt means not clean.
- Caller mode wins.
- The ADR-118 `repair` edge is unchanged.
- The branch-cleanup HITL is unchanged.
- No history-anatomy YAML change.

**Rejected alternatives:**
- A model classifying drift, which breaks deterministic-before-model.
- Splitting doc-sync back into two `agent.run` hops, which reverses 0607 R2.
- A git-log-based diff. Commit messages don't reliably carry the WBS, while Solution maps are the implement-stage evidence.

**Anti-patterns:**
- Probing `docs/tasks*` or feature corpus paths as drift.
- Running the probe when `mode` is set.

**Targets:**
- Probe unit tests cover each surface glob, an empty Solution, and the clean case.
- Parity and composition baselines updated.

### Plan

1. `plugins/sp/scripts/wrapup-drift-probe.ts`, with `plugins/sp/tests/wrapup-drift-probe.test.ts`, using a fake `spur` bin for `task show`.
2. `wrapup-pipeline.yaml` `task-resolve` onEnter: probe, then project `mode`, with the route-reason map gaining `safety`. Update the composition and guard-parity baselines, then run `bun run --filter @gobing-ai/spur build:bundle`.
3. Workflow routing tests: clean → metrics-record; dirty → doc-sync; caller `mode=safety` → doc-sync; empty Solution → doc-sync.
4. Candidate record, validated with `bun scripts/spur-dev.ts promotion`.
5. Confirm the history-anatomy per-state rows appear in the 0938 baseline. Cite them in the candidate rationale for 0946.
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
