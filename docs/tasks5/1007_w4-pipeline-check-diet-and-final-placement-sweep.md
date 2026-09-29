---
schema_version: 1
name: W4 pipeline check diet and final placement sweep
status: todo
template: feature-impl
created_at: 2026-09-29T06:25:03.420Z
updated_at: "2026-09-29T06:58:18.611Z"
feature_id: A9
priority: P2
tags:
  - A9
  - script-placement

dependencies: ["1001", "1005", "1006", "1002", "1003", "1004"]
estimate_hours: 8
---

## 1007. W4 pipeline check diet and final placement sweep

### Background

Wave W4. Pipelines re-derive facts already recorded, re-resolve script paths per action, and the inline driver pays one process call per action for trace rows.

Implements: R8 — sp skills, commands and workflows track every CLI move; R9 — Pipeline checks keep only core gates strict

Source: ADR-130, harness-surface-governance §2, docs/plans/A9-script-placement-migration.md.

**Refine corrections (2026-09-28)**
- "52 / 60 actions, measured by `pipeline-budgets`" → `scripts/commands/pipeline-budgets.ts` measures model queries and wall clock, not action counts; parsed onEnter+onExit counts today are idea 34, task 56 → resolution: a new ratchet test counts actions; targets derive from the named cuts below.
- "idea ≤40, task ≤45" → after 1002 (−2 task), 1003 (−1 task), 1004 (−1 idea) the baseline is idea 33, task 53; this task's named cuts remove 3 idea and 5 task actions → resolution: targets idea ≤30, task ≤48.
- "one trace row per state" → conflicts with ADR-117 (one `action_runs` row per action, driver parity with the engine) → resolution: keep per-action rows, batch the delegate call: one `inline-run-setup --actions-file` call per state.
- "feature-check state re-runs the check" → already fixed (task 0769: it reads the recorded `idea-ac-check` status) → resolution: dropped.
- "one route-fact writer per boundary" → the only duplicate is `idea-pipeline.yaml` feature-check onEnter#1, byte-equal to ac-generate#5 (0945 R2 pin); its inputs (`design` var, needs-design JSON, recorded ac-check status) cannot change across `hitl.confirm` → resolution: delete it and update the 0945 pin.
- "slim pr-reviewing via lib helpers" → pr-reviewing (927 LOC) is sp-owned git/gh orchestration with no spur-domain logic; moving it to `plugins/sp/lib` only relocates LOC → resolution: keep a cited budget exemption; batch-preflight likewise.
- "remove repeated `plugin-scripts.json || superskill script path` probes" → `superskill script path` appears in 34 action shells across 6 workflows; only idea/task/feature-verification/wrapup run `script-root` at start, and nothing reads `.spur/run/<runId>-script-root.json` today → resolution: those 4 workflows read it; pr-review and history-anatomy are out of scope (no run-start resolver).

### Requirements

- [ ] R1. Add `packages/app/tests/workflow/pipeline-action-budget.test.ts`: parse `config/workflows/{idea,task}-pipeline.yaml` and assert total onEnter+onExit actions idea ≤30, task ≤48 (constants `IDEA_ACTION_BUDGET = 30`, `TASK_ACTION_BUDGET = 48`).
- [ ] R2. idea-pipeline cuts: merge feature-create's Goal and Scope `feature update` shells into one; delete feature-check onEnter route writer (update the 0945 byte-equal pin in `packages/app/tests/workflow/idea-pipeline-routing.test.ts` to assert the single writer); delete the handoff `note` (the `run.artifact` carries the handoff).
- [ ] R3. task-pipeline cuts: drop precheck `note`; merge precheck base-sha write into the dirty-tree warning shell; merge test-fix's two log-append shells; merge triage's mode-fallback shell into the following memory-append shell; drop done `note`. Each merged shell keeps the original commands in order and `exit 0` semantics.
- [ ] R4. In idea, task, feature-verification and wrapup pipelines, every plugin-script action after the `script-root` action resolves its script from `.spur/run/$__runId-script-root.json` (`mode` `source-repo` → `$dir/<name>.ts` with bun; `installed` → `$dir/<name>.mjs` with node; `unresolved`/missing → the action's existing fail-closed branch). No action repeats `config/plugin-scripts.json` / `superskill script path` probing. The `script-root` action itself keeps its probe.
- [ ] R5. `plugins/sp/scripts/inline-run-setup.ts` accepts `--actions-file <path>`: a JSON array of `{node, kind, status, ok, durationMs}` recorded in order through the same writer as `--action` (one `action_runs` row each); invalid JSON exits 1 without partial writes. `inline-pipeline-driver.md` § Structured trace emission switches to one call per state; `--action` stays for single actions.
- [ ] R6. Advisory-only: composition, drift and BDD-warning findings never fail a state or trigger retry; each removed/merged check and its replacement or rationale is listed in the Solution section.
- [ ] R7. Final sweep: `config/script-placement-baseline.json` holds only cited exemptions (ADR-129 context hooks, batch-preflight, pr-reviewing, wrapup-steps, wrapup-drift-probe, feature-verification-steps, task-diffstat); `rg` for every script deleted in 1001–1006 over `plugins/sp config/workflows` returns nothing; `spur rule run --rule sp-script-placement` passes.
- [ ] R8. (refactor RF-architect-003) `config/workflows/pr-review.yaml` and `config/workflows/history-anatomy.yaml` gain the run-start `script-root` onEnter action in their initial state (command identical to `feature-verification.yaml` state `verify` first action), and every later plugin-script action in both resolves through the R4 snippet; no action in either repeats `superskill script path` / `config/plugin-scripts.json` probing except `script-root` itself.
- [ ] R9. (refactor RF-architect-001) Add `plugins/sp/lib/spur-bin.ts` exporting `spurCommand(spurBin)` (whitespace split → `{cmd, prefix}`) and `defaultSpurBin()` (`SPUR_BIN` > monorepo-local `apps/cli/src/index.ts` via bun > `spur`), moved verbatim from `wrapup-steps.ts:68` and `workflow-step-profile.ts:324`. Every surviving plugin script imports it; `rg -n 'function (spurCommand|defaultSpurBin)' plugins/sp/scripts` returns nothing. Behavior identical (existing script tests stay green unchanged).

### Acceptance Criteria

- [ ] AC1 — sp skills, commands and workflows track every CLI move (req: R4, R5, R7, R8, R9)
- [ ] AC2 — Pipeline checks keep only core gates strict (req: R1, R2, R3, R6)

Task-local observability: AC2 by `pipeline-action-budget.test.ts` green at ≤30/≤48 plus existing pipeline/routing/resilience tests; AC1 by the empty-except-exemptions baseline, the rule run, the `rg` sweep, a driver test covering `--actions-file`, and `bun run plugin-smoke`.

### Q&A

- **Q: Hit the old ≤26/≤42 targets?** A: No; they had no named cuts behind them. Targets are the result of the listed cuts (≤30/≤48); further cuts need behavior changes and are new work. Closed.
- **Q: Collapse trace rows to one per state?** A: No — ADR-117 row granularity stays; only the process call is batched. Closed.
- **Q: Slim pr-reviewing?** A: Exempt with a cited reason; no spur-domain logic to move. Re-evaluate if it grows. Closed.
- **Q: Fix probes in pr-review / history-anatomy too?** A: Yes (architect refactor RF-architect-003) — R8 adds the `script-root` action to both, then R4's snippet applies. Closed.
- **Q: Is `--actions-file` new `spur` CLI surface?** A: No — it is a plugin-script argument (ADR-130 glue), not a `spur` verb/flag. Closed.
- **Q: Where does the shared spur-invocation helper live?** A: `plugins/sp/lib/spur-bin.ts` (R9). Plugin-local utility, imported by relative path like `lib/env.ts`, so the standalone contract holds; not an app bundle because it has no Spur-domain logic. Closed.
- **Q: Replace the one-line `superskill script path` examples in skill/command docs with a shared reference?** A: No — each is one line an agent runs as-is; a link adds a hop without removing logic (RF-architect-004, KEEP). Closed.

### Design

**What.** Mechanical pipeline diet plus the final placement sweep. Core strict gates unchanged: `feature check`/`task check` errors, `spur-check` tests, verify verdict, plugin standalone + smoke.

**Frozen names.** `packages/app/tests/workflow/pipeline-action-budget.test.ts` with `IDEA_ACTION_BUDGET = 30`, `TASK_ACTION_BUDGET = 48`. `inline-run-setup --actions-file <path>`, entries `{node, kind, status, ok, durationMs}`. Script resolution snippet (verbatim in each action):

```sh
R=".spur/run/$__runId-script-root.json"; D="$(jq -r '.dir // empty' "$R" 2>/dev/null)"; case "$(jq -r '.mode // empty' "$R" 2>/dev/null)" in source-repo) S="$D/<name>.ts"; RUNNER=bun ;; installed) S="$D/<name>.mjs"; RUNNER=node ;; *) S="" ;; esac
```

**Why.** Cut duplicated per-action probing and redundant actions without weakening strict gates (R9).

**Where.** `config/workflows/{idea,task}-pipeline.yaml`, `feature-verification.yaml`, `wrapup-pipeline.yaml`, `pr-review.yaml`, `history-anatomy.yaml`; new `plugins/sp/lib/spur-bin.ts` (R9); `plugins/sp/scripts/inline-run-setup.ts` (+ app service from 1006) and twin; `inline-pipeline-driver.md`; tests; baseline. Rebuild `apps/cli/config/` via `build:bundle`.

**Anti-patterns.** No engine or schema change. No public `spur` surface. Do not touch `hitl.*`, `command.gate`, `agent.run`, `decide` or guard semantics. Do not rewrite shells beyond the listed merges.

**Dependencies.** Lands after 1002–1006 (their action removals are in the baseline).

### Plan

1. Add the budget test (red at 33/53).
2. Apply R2/R3 cuts; update the 0945 pin; green.
3. R4 script-root reads in 4 workflows; update `task-pipeline-resilience` resolution assertions.
4. R8 script-root action + snippet reads in pr-review and history-anatomy; R9 `lib/spur-bin.ts` and import swaps.
5. R5 `--actions-file` + test; update driver reference.
6. R7 sweep; `build:bundle`; `bun run spur-check`, `bun run plugin-smoke`, rule run.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
