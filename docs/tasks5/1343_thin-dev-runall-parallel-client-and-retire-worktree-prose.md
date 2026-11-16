---
schema_version: 1
name: Thin dev-runall parallel client and retire worktree prose
status: done
template: feature-impl
created_at: 2026-11-16T01:11:44.759Z
updated_at: "2026-11-16T03:08:22.617Z"
feature_id: G76

dependencies: ["1341", "1342"]
priority: P2
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
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

- [x] R1 — `--mode parallel` freezes the set, previews `spur task batch-plan order`, tags the set `fleet:auto`, and runs the fenced tick in a foreground loop when `spur serve` is absent (operator decision Q2).
- [x] R2 — The batch report is rendered from receipts and system events; no new public verb is added (operator decision Q5).
- [x] R3 — Without a declared, enabled fleet with at least one coder member, parallel mode refuses, naming the fix (`agent.fleet.members`, `maxWriters`) and suggesting `--mode sequential`; no ephemeral members.
- [x] R4 — `execution-worktree-setup.md`, `execution-worktree-landing.md` and `execution-parallel-isolation.md` are retired to one pointer and `execution-batch.md` keeps only the driver loop.

Out of scope: `--mode sequential` behaviour; a new public `spur` noun/verb; fleet-less parallel execution.

### Acceptance Criteria

- [x] AC1 — dev-runall parallel is a thin client

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

`--mode parallel` is now a client of the fleet kernel, and the worktree prose it duplicated is
retired. The batch client ticks the same fenced `StrategyRuntime` a fleet host ticks, and the report
is projected from the ledger instead of from terminal output — so parallel mode adds no second
implementation of lanes, landing or evidence, and no new public verb.

**Change map**

- **Client loop (new):** `packages/app/src/services/fleet-foreground-loop.ts`
  - `:61` `runForegroundTicks(projectPath, runtime, { signal, maxIdleTicks, maxTicks, ownerEpoch, orchestratorId, healthy })` — one tick per iteration, `observe` after each dispatch, and four ways to stop: an idle streak (`idle`), an abort (`aborted`), a fence that moved (`fence-lost`, checked *before* the tick so a replaced host never dispatches), or the hard tick bound (`bounded`).
  - `:12` `WORKING_HOLDS` — a dispatchless tick is idle **only** when nothing is still working; a busy member, a lane at the cap or a pending landing keep the client alive instead of ending the batch early.
  - `:107` `parallelRefusal(fleet)` — the fleet-less refusal: names `agent.fleet.enabled`/`members` (needs a coder), then `maxWriters`, and points at `--mode sequential`; no ephemeral members, no silent fallback.
  - `:139`/`:170` `fleetReportRows` + `renderFleetBatchReport` — the batch report as a projection of `fleet.lane.*` / `fleet.task.integrated` events, so a dispatch with no event cannot read as progress.
- **Barrel:** `packages/app/src/index.ts:379-386` exports the loop, its types, the refusal and the report seams.
- **Tests:** `packages/app/tests/services/fleet-foreground-loop.test.ts` — idle-budget stop, the working-holds exemption, the `maxTicks` bound, tick pacing, fence-loss stop before dispatch, abort, every refusal branch, and the ledger-to-report projection.
- **Prose retirement (R4):**
  - `plugins/sp/skills/spur-dev/references/execution-worktree.md` (481 lines) — the lifecycle **start** (WT-1…WT-3b, WT-6 `--continue`, WT-7 exclusions, corpus visibility) plus the new engine-owned parallel contract section.
  - `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md` (565 lines) — landing stays on demand (WT-4/WT-PR/WT-4r/WT-5).
  - Deleted: `execution-worktree-setup.md` (406 lines) and `execution-parallel-isolation.md` (133 lines) — their content moved (setup → `execution-worktree.md`, parallel isolation → the engine-owned section that names `worktree-lane-service.ts`, `fleet-integration-queue.ts` and `fleet-foreground-loop.ts`). `execution-batch.md` keeps the driver loop and a pointer (708 → 662 lines).
  - `plugins/sp/skills/spur-dev/SKILL.md:113-114` bootstrap reads: `--worktree` now loads `execution-batch.md` + `execution-worktree.md`; `--mode parallel` loads `execution-batch.md` + `execution-worktree.md` (the 133-line isolation file is gone). Measured bootstrap: `--worktree` and `--mode parallel` both 94,160 B against the 110,000 B budget (`plugins/sp/tests/bootstrap-budget.test.ts` passes unchanged).
  - Link hygiene: `flag-glossary.md:538`, `plugins/sp/commands/dev-run.md:77`, `plugins/sp/commands/dev-runall.md:50,68,80`, `plugins/sp/tests/helpers/runbook-parts.ts`, `plugins/sp/tests/commit-guard-docs.test.ts`.
  - Contract test rewritten with the prose: `plugins/sp/tests/parallel-isolation-contract.test.ts` now pins the engine owners, the surviving contracts (integrated-not-terminal eligibility, `--worktree` rejection, `--defer-gate`, conflict retention) and the **inversion** — no `git worktree`/`git merge` command survives in the parallel prose.

**Verification**

- `(cd packages/app && bun test tests/services/fleet-foreground-loop.test.ts)`: 8 pass; file coverage `funcs 100.00 lines 97.62`.
- `(cd plugins/sp && bun test tests/parallel-isolation-contract.test.ts tests/bootstrap-budget.test.ts tests/commit-guard-docs.test.ts)`: 17 pass; `tests/skill-structure.test.ts` (link resolution, WT-heading uniqueness, bootstrap manifest): 96 pass.
- `(cd packages/app && bun run typecheck)`: clean; `bunx biome check` on every changed file: clean.
- probe: n/a for a public surface — no noun, verb or flag was added; the parallel entry is the existing `/sp:dev-runall --mode parallel`.

**Deviation recorded:** R4 said "one pointer file". Two files remain (`execution-worktree.md` and its landing half) because the landing half is a batch-end read, and folding it into the pre-dispatch bootstrap would break the 110 KB budget the same task keeps green. The setup file *is* retired into the pointer file; the parallel-isolation file is retired into the engine-owned section.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `--mode parallel` freezes the set, previews `spur task batch-plan order`, tags the set `fleet:auto`, and runs the fenced tick in a foreground loop when `spur serve` is absent | MET | `packages/app/src/services/fleet-foreground-loop.ts:61-99` (`runForegroundTicks` ticks the fenced runtime, `observe`s each dispatch, checks the fence before every tick); tagging and preview stay on the existing verbs (`spur task update --tags`, `spur task batch-plan order`), documented in `plugins/sp/commands/dev-runall.md:50`; test `packages/app/tests/services/fleet-foreground-loop.test.ts` "a moved fence ends the loop before the next dispatch" |
| R2 — the batch report is rendered from receipts and system events; no new public verb | MET | `fleet-foreground-loop.ts:139,170` (`fleetReportRows` / `renderFleetBatchReport` project the `fleet.*` ledger); no CLI noun/verb/flag added — the only entry is the existing `/sp:dev-runall --mode parallel` |
| R3 — without a declared, enabled fleet with ≥1 coder member, parallel mode refuses and names the fix, suggesting `--mode sequential`; no ephemeral members | MET | `fleet-foreground-loop.ts:107-133` (`parallelRefusal`, one message per missing piece, each ending in `or run --mode sequential`); test "names the missing fleet, coder member and maxWriters, never a silent fallback" |
| R4 — the three worktree references are retired to a pointer and `execution-batch.md` keeps only the driver loop | MET | `plugins/sp/skills/spur-dev/references/execution-worktree.md` (481 lines: WT-1…WT-3b, WT-6, WT-7 + the engine-owned parallel contract); `execution-worktree-landing.md` (565) keeps the batch-end landing; `execution-worktree-setup.md` and `execution-parallel-isolation.md` deleted; `execution-batch.md` 708 → 662 lines with the pointer at `:584-591` and `:642-647`; `SKILL.md:113-114` bootstrap reads updated; bootstrap 94,160 B against the 110,000 B budget |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — dev-runall parallel is a thin client | MET | test | `packages/app/tests/services/fleet-foreground-loop.test.ts` (8 pass, funcs 100.00 / lines 97.62); `plugins/sp/tests/parallel-isolation-contract.test.ts` proves the parallel prose carries no `git worktree`/`git merge` command and names the three engine owners |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T01:21:04.696Z backlog → todo (system)
- 2026-11-16T02:45:41.412Z todo → wip (system)
- 2026-11-16T03:08:21.011Z wip → testing (system)
- 2026-11-16T03:08:22.612Z testing → done (system)

