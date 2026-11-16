---
schema_version: 1
name: Thin dev-runall parallel client and retire worktree prose
status: todo
template: feature-impl
created_at: 2026-11-16T01:11:44.759Z
updated_at: "2026-11-16T01:21:04.696Z"
feature_id: G76

dependencies: ["1341", "1342"]
priority: P2
estimate_hours: 6
---

## 1343. Thin dev-runall parallel client and retire worktree prose

### Background

Implements: R7 — dev-runall parallel is a thin client.

Makes `/sp:dev-runall --mode parallel` a client of the fleet kernel and deletes the LLM-executed worktree lifecycle prose once parity is proven (operator decision Q3).

Contract: `docs/design/fleet-orchestration-lanes.md` (ADR-149); plan: `docs/plans/2026-11-15-multi-agent-task-orchestration.md` (failure catalogue §4.7).

**Refine corrections (2026-11-15)**

- R3 "ephemeral subprocess members without a declared fleet" → no such mechanism exists in `packages/app/src/services`; building one would add a second member lifecycle beside `agent.fleet` (ADR-149) → R3 rewritten to a refusal with the fix (see Q&A).
- "`spur task batch-plan order` preview" → the verb takes `--tasks <file>` only (no `--feature`/`--json`) → the Design names the file form.

### Requirements

- [ ] R1 — `--mode parallel` freezes the set, previews `spur task batch-plan order`, tags the set `fleet:auto`, and runs the fenced tick in a foreground loop when `spur serve` is absent (operator decision Q2).
- [ ] R2 — The batch report is rendered from receipts and system events; no new public verb is added (operator decision Q5).
- [ ] R3 — Without a declared, enabled fleet with at least one coder member, parallel mode refuses, naming the fix (`agent.fleet.members`, `maxWriters`) and suggesting `--mode sequential`; no ephemeral members.
- [ ] R4 — `execution-worktree-setup.md`, `execution-worktree-landing.md` and `execution-parallel-isolation.md` are retired to one pointer and `execution-batch.md` keeps only the driver loop.

Out of scope: `--mode sequential` behaviour; a new public `spur` noun/verb; fleet-less parallel execution.

### Acceptance Criteria

- [ ] AC1 — dev-runall parallel is a thin client

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T01:20:48.349Z

- **Q: Ephemeral subprocess members without a declared fleet (R3)?** CLOSED (refine 2026-11-15): dropped. Parallel mode requires a declared fleet and otherwise refuses with the fix. Why: ephemeral members would be a second member lifecycle beside `agent.fleet`, against ADR-149's one-kernel decision. Fleet-less parallel users lose the prose path when it retires; that is accepted under operator Q3 (retire after parity, measured on fleet projects). Reopen only if the operator wants a fleet-less parallel mode.
- **Q: Foreground loop vs serve?** CLOSED (operator Q2): the foreground loop runs only when serve does not hold the orchestrator claim. A second host loses the fence and exits.

### Design

**WHAT.** `/sp:dev-runall --mode parallel` becomes a client of the fleet kernel (1341/1342), and the LLM-executed worktree lifecycle prose is deleted.

**WHY.** ADR-149: one orchestration kernel. The prose duplicates lane, landing and evidence logic in an LLM driver (plan H1/H2).

**WHERE / frozen names.**
- **Client loop:** new `packages/app/src/services/fleet-foreground-loop.ts`, `runForegroundTicks(projectPath, { signal, maxIdleTicks }): AsyncIterable<TickReport>`. It acquires the orchestrator claim through the existing 0836 path. When `spur serve` already holds it, the loop does not tick and only observes events. Losing the fence ends the loop with a one-line reason.
- **Entry:** internal self-development entrypoints stay internal. The skill calls an **existing** verb chain. No new public noun or verb (operator Q5). If an entry command is unavoidable, it goes under `scripts/commands` (ADR-130), not `spur`.
- **Tagging:** the frozen set is tagged `fleet:auto` through `spur task update <wbs> --tags` (existing).
- **Preview:** `spur task batch-plan order --tasks <file>` (existing; `--tasks` file input, no `--json`/`--feature` flags).
- **Report:** rendered from `fleet.lane.*`, `fleet.task.integrated` and dispatch receipts.
- **Skill references:** `execution-worktree-setup.md`, `execution-worktree-landing.md`, `execution-parallel-isolation.md` → one pointer file each, or deleted with a pointer in `execution-batch.md`. Update `plugins/sp/tests/bootstrap-budget.test.ts` and SKILL.md "Bootstrap reads".

**Fleet-less projects.** Without an enabled fleet that has at least one coder member, `--mode parallel` refuses, naming the fix (declare `agent.fleet.members`, set `maxWriters`) and suggesting `--mode sequential`. It does not fall back silently.

**Anti-patterns.**
- No second tick implementation.
- No terminal scraping.
- No skill-side git worktree commands left in references.
- Do not change `--mode sequential`.

**Handoff.** 1346 measures this loop against the serial fleet.

### Plan

1. E2E first: run the 1342 fixture through `/sp:dev-runall --mode parallel` with serve off. Assert the report matches the receipts and events, and that a second host loses the fence (R1, R2).
2. `runForegroundTicks` plus fence-loss exit (R1).
3. Fleet-less refusal message (R3).
4. Rewrite `execution-batch.md` to the driver loop and retire the three references to pointers. Update `bootstrap-budget.test.ts` and SKILL.md bootstrap reads, and record the line delta in Solution (R4).
5. `bun run spur-check`, then `bun run plugin-smoke`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T01:21:04.696Z backlog → todo (system)

