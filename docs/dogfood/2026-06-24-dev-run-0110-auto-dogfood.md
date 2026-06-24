# Dogfood Report: `/sp:dev-run 0110 --auto`

**Date:** 2026-06-24  
**Run by:** `/sp:dev-dogfood "/sp:dev-run 0110 --auto" --save --task`  
**max-retry:** 2 (default)

---

## 1. Testee

| Field | Value |
|-------|-------|
| **Testee** | `/sp:dev-run 0110 --auto` |
| **Classification** | Slash command (`/sp:...`) |
| **Exact invocation** | `Skill(skill="sp:spur-dev", args="run 0110 --auto")` → `spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0110","profile":"auto"}'` |
| **Task** | 0110 — "Unified dev-* operations reference + repoint ghost commands" (status: todo → wip) |

The testee is a slash command that delegates to the `sp:spur-dev` skill's execution half, which runs task 0110 through the `task-pipeline.yaml` state-machine workflow with the HITL approval gate skipped (`profile=auto`).

---

## 2. Execution Summary

| Metric | Value |
|--------|-------|
| **Overall result** | **PARTIAL** |
| **Wall-clock time** | ~22 min |
| **~estimated token cost** | ~25k tokens (estimate — derived from 10 tool calls + transcript size + wall-clock; labeled `~estimate`) |
| **Total steps** | 10 (precheck → implement → test → review → approve → verify → record → done + cleanup) |
| **Steps reached** | 4 of 10 (precheck, pipeline-validate, pipeline-start, implement-partial) |
| **Steps not reached** | 5 (test, review, approve-skipped, verify, record, done) — pipeline interrupted |
| **Total fix attempts** | 2 (dev-dogfood `$ARGUMENTS` placement + `--section "Review Findings"` spec bug) |

---

## 3. What We Did

### Pre-dogfood: dev-dogfood argument parsing fix

Before running the testee, we identified and fixed an argument-parsing defect in the `/sp:dev-dogfood` command itself. The `$ARGUMENTS` template variable appeared **only** in the Platform Notes (a documentation section), not in the Implementation section where the agent consumes it. When Claude Code substitutes `$ARGUMENTS`, the arguments landed in a nonsensical documentation context, and there was no explicit parsing instruction. Fixed by moving `$ARGUMENTS` to the Implementation section with explicit parsing rules, and removing it from Platform Notes.

### Step 1: Precheck

Ran `spur task check 0110 --json`. Result: **PASS** (`"pass": true`). Eight L4 warnings about AC scenarios not matching parent feature H2's AC (DD-09 subset rule) — advisory, not blocking. The task's required sections are all present.

### Step 2: Pipeline validation

Ran `spur workflow validate config/workflows/task-pipeline.yaml --json`. Result: **VALID**. The state-machine workflow has 8 states (precheck, implement, test, review, approve, verify, record, done, failed) and 11 transitions.

### Step 3: Pipeline start

Ran `spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0110","profile":"auto"}' --json` with a 180s timeout. The pipeline:

1. Entered `precheck` state — ran `spur task check 0110` guard → passed.
2. Transitioned to `implement` state — ran `spur task update 0110 wip` (task moved to `wip`; this also triggered a secondary `task-lifecycle` workflow run).
3. Started `agent.run` action — spawned omp agent: `omp --no-session -p /skill:sp-dev-implement 0110 --auto --mode text`.

The 180s external bash timeout killed the parent `spur workflow run` process while the omp agent was still implementing. **The spawned omp subprocess (PID 93029) was NOT killed** — it became orphaned and continued running for ~13 minutes before manual termination.

### Step 4: Implement (agent.run) — partial

The omp agent ran `/sp:dev-implement 0110 --auto` and made real code changes before being killed:

| File | Change |
|------|--------|
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | **Created** (238 lines) — unified dev-* operations reference |
| `plugins/sp/commands/dev-changelog.md` | Repointed from ghost delegation to inline procedure |
| `plugins/sp/commands/dev-fixall.md` | Repointed |
| `plugins/sp/commands/dev-gitmsg.md` | Repointed |
| `plugins/sp/commands/dev-handover.md` | Repointed |
| `plugins/sp/commands/dev-new-task.md` | Repointed |
| `docs/04_DESIGN.md` | Added dev-* operation map row |
| `docs/tasks/0110_*.md` | Updated task file (+111 lines) |

**9 files changed, +459/-63 lines.** The agent did not finish writing the `## Solution` section before termination.

### Steps 5–10: Not reached

The pipeline was interrupted (parent process killed by external timeout). Steps test → review → approve(skipped by --auto) → verify → record → done were not reached. The orphaned workflow runs were cleaned up with `spur workflow clean --older-than 1`.

### Cleanup

- Killed orphaned omp subprocess (PID 93029).
- Ran `spur workflow clean --older-than 1 --json` — finalized 2 orphaned runs:
  - `ee6c3954-...` (task-pipeline, started 16:15:18)
  - `run_2db0c963-...` (task-lifecycle, started 16:15:18)
- Also cleaned an older orphaned run from 05:40 (`run_93788b3a-...`).

---

## 4. Issues

### Fixed

| # | Issue | Root cause | Fix applied |
|---|-------|------------|-------------|
| F1 | **dev-dogfood `$ARGUMENTS` not consumed** — the template variable appeared only in Platform Notes (documentation), not in the Implementation section where the agent should parse it. When substituted, arguments landed in a nonsensical documentation context with no parsing instructions. | `$ARGUMENTS` was placed in Platform Notes as a generic documentation reference, not as a consumption point. Other commands (e.g. `dev-run.md`) correctly place `$ARGUMENTS` in their Implementation section. | `plugins/sp/commands/dev-dogfood.md` lines 119–141: moved `$ARGUMENTS` to Implementation section with explicit parsing instructions (testee extraction, flag parsing, quote stripping). Removed `$ARGUMENTS` from Platform Notes — replaced with literal "argument substitution" text. |
| F2 | **dev-dogfood `--task` sink references non-existent section** — the spec said `spur task update <wbs> --section "Review Findings"` but `#### Review Findings` is a sub-heading within `### Background`, not a canonical section. The CLI rejected it with "Unknown section." | The dev-dogfood spec assumed `#### Review Findings` was a top-level section, but the canonical sections are: Background, Requirements, AC, Q&A, Design, Plan, Solution, Root Cause, Testing, Review, References, History. | `plugins/sp/commands/dev-dogfood.md` Sinks section: changed `--section "Review Findings"` to `--section "Background"` with a note that the `#### Review Findings` sub-heading is part of the Background body. |

### Unresolved

| # | Issue | Diagnosis | Everything tried | Why it still fails |
|---|-------|-----------|-------------------|---------------------|
| U1 | **Orphaned agent subprocess when `spur workflow run` is killed externally** — the spawned omp agent (PID 93029) was NOT killed when the parent `spur workflow run` process was terminated by the 180s bash timeout. | The `spur workflow run` command spawns the omp agent as a child process but does not set up a process group or signal forwarding. The pipeline's `stepTimeoutMs` (600000ms = 10min) only fires if the pipeline engine process is alive to enforce it. When the parent is killed externally (timeout, Ctrl-C, terminal close), the child is orphaned. | 1. Killed the orphaned process manually (`kill 93029`). 2. Cleaned up orphaned workflow runs with `spur workflow clean`. 3. Verified the issue is not covered by task 0107 (which addresses the pipeline's *internal* step-level timeout, not external process termination). | The fix requires the CLI to set up process groups (`setpgid`) or install signal handlers that forward SIGTERM/SIGKILL to child processes. This is a change to the `ts-ai-runner` or `ts-dual-workflow-engine` package — an external dependency, not fixable within the dev-dogfood retry budget. |
| U2 | **Pipeline interruption leaves task in `wip`** — the pipeline failed (orphaned) but task 0110 remains in `wip` status. There is no automatic rollback of the task status when the pipeline fails. | By design: the `failed` terminal state in the pipeline YAML does not revert the task status. The task status reflects the actual state of work (which has real changes), not the pipeline state. | Verified this is by design — the pipeline's `done` state runs `spur task update 0110 done` and the `failed` state does nothing to the task. | Not a bug — the task genuinely has partial implementation (9 files changed). Leaving it as `wip` is accurate. The user can continue or revert manually. |

---

## 5. Findings

| # | Severity | Effort | Finding | File / Area |
|---|----------|--------|---------|-------------|
| P1 | P1 | S | **dev-dogfood `$ARGUMENTS` placement** — all slash commands should have `$ARGUMENTS` in their Implementation/consumption section, not just in documentation sections. Audit other `plugins/sp/commands/*.md` files for the same pattern. | `plugins/sp/commands/dev-dogfood.md` (fixed); audit `plugins/sp/commands/*.md` |
| P2-1 | P2 | M | **Orphaned agent subprocess on external kill** — `spur workflow run` should forward signals (SIGTERM/SIGKILL) to spawned agent subprocesses or use process groups so they die with the parent. | `packages/app` (WorkflowService) or `@gobing-ai/ts-ai-runner` (AiRunner) |
| P2-2 | P2 | M | **`spur workflow run` is synchronous** — blocks during agent.run steps (up to 10min each). Consider an `--async` mode that starts the pipeline and returns the run ID for monitoring via `spur workflow trace`. | `apps/cli` (workflow run command) |
| P2-3 | P2 | S | **`spur workflow clean` default threshold (30min) too long for interactive use** — consider adding a `--force` flag or lowering the default for interactive sessions. | `apps/cli` (workflow clean command) |
| P2-4 | P2 | S | **Secondary `task-lifecycle` workflow orphaned** — the pipeline's `implement` step runs `spur task update 0110 wip`, which triggers a secondary `task-lifecycle` workflow run. This secondary run also becomes orphaned when the parent is killed. The pipeline should be aware of this side effect. | `config/workflows/task-pipeline.yaml` (implement state) |
| P2-5 | P2 | S | **dev-dogfood should document the `--max-retry 0` observe-only path more prominently** — for testing commands that mutate the repo (like `/sp:dev-run`), observe-only mode is the safe default. The current documentation mentions it but doesn't warn about repo mutation in non-observe mode. | `plugins/sp/commands/dev-dogfood.md` |
| P2-6 | P2 | S | **dev-dogfood `--task` sink section name wrong** — spec referenced `--section "Review Findings"` which is a `####` sub-heading, not a canonical section. FIXED. Audit other commands that reference section names for the same pattern. | `plugins/sp/commands/dev-dogfood.md` (fixed) |

---

## Monitor Ledger

| step | attempts | outcome | fix applied | finding | ~tokens | wall-clock |
|------|----------|---------|-------------|---------|---------|------------|
| (dev-dogfood) $ARGUMENTS placement | 1 | FIXED | dev-dogfood.md L119-141: moved $ARGUMENTS to Implementation, removed from Platform Notes, added parsing instructions | $ARGUMENTS only in Platform Notes, not consumed | ~3k | ~3m |
| (dev-dogfood) `--section` spec bug | 1 | FIXED | dev-dogfood.md Sinks: `--section "Review Findings"` → `--section "Background"` | `#### Review Findings` is a sub-heading, not a canonical section | ~1k | ~2m |
| 1. Precheck | 1 | PASS | — | 8 L4 warnings (AC↔feature H2 subset rule) — advisory | ~1k | <1m |
| 2. Pipeline validation | 1 | PASS | — | — | ~2k | <1m |
| 3. Pipeline start | 1 | PASS (partial) | — | Pipeline started, precheck guard passed, task→wip, agent.run spawned omp. 180s external timeout killed parent; orphaned omp subprocess killed manually. | ~5k | ~4m |
| 4. Implement (agent.run) | 1 | PARTIAL | — | omp agent made real changes (9 files, +459/-63 lines). Killed mid-run before completing Solution section. | ~8k | ~13m |
| 5. Test | 0 | NOT REACHED | — | Pipeline interrupted | — | — |
| 6. Review | 0 | NOT REACHED | — | Pipeline interrupted | — | — |
| 7. Approve (HITL) | 0 | SKIPPED | — | profile=auto (by design) | — | — |
| 8. Verify | 0 | NOT REACHED | — | Pipeline interrupted | — | — |
| 9. Record | 0 | NOT REACHED | — | Pipeline interrupted | — | — |
| 10. Done | 0 | NOT REACHED | — | Pipeline interrupted | — | — |
| Cleanup | 1 | PASS | — | `spur workflow clean --older-than 1` finalized 2 orphaned runs | ~1k | <1m |

**Totals:** 10 steps, 4 reached (1 partial), 2 fix attempts, ~25 min wall-clock, ~28k tokens (~estimate).
