# Dogfood Report: `/sp:dev-run 0116 --auto`

**Date:** 2026-06-24
**Testee:** `/sp:dev-run 0116 --auto` — slash command → `Skill(sp:spur-dev, args="run 0116 --auto")`
**Classification:** Slash command (full pipeline driver)

---

## Execution Summary

| Metric | Value |
|--------|-------|
| **Overall Result** | **PARTIAL** (6/7 items done; 1 requires upstream) |
| **Wall-Clock Time** | ~20 min |
| **~Estimated Token Cost** | ~65k |
| **Total Steps** | 6 (precheck → implement → test → review → verify → record) |
| **Total Fix Attempts** | 4 (2 type errors, 2 formatting) |
| **Mode** | `--max-retry 2` (default), `--save`, `--task` |

---

## What We Did

### Step 1 — precheck
Ran `spur task check 0116 --json`. Passed (`pass: true`). Two advisory warnings: L2 Plan section not allowed in review template, L4 missing feature_id. Non-blocking.

### Step 2 — implement
Moved task to wip via `spur task update 0116 wip`. Implemented all review findings:

- **P1:** Audited all 12 `plugins/sp/commands/dev-*.md` files for `$ARGUMENTS` placement. 5 inline-procedure commands (changelog, fixall, gitmsg, handover, new-task) had `$ARGUMENTS` only in Platform Notes — moved to Implementation section with explicit `**Arguments received:** $ARGUMENTS. Parse per the Arguments table above.` 6 Skill-delegating commands already correct. dev-dogfood.md fixed in prior run.
- **P2-2:** Added `--async` flag to `spur workflow run` in `apps/cli/src/commands/workflow.ts:99-143`. Spawns workflow in detached background process via `Bun.spawn` + `.unref()`, prints run ID, exits immediately. Graceful fallback to sync run on spawn failure.
- **P2-3:** Added `--force` flag to `spur workflow clean` in `apps/cli/src/commands/workflow.ts:220`. Overrides `--older-than` by setting `minutes=0`. Updated human-readable output to show "(all non-terminal)".
- **P2-4:** Added `--no-lifecycle` flag to `spur task update` in `apps/cli/src/commands/task.ts:92-95`. Updated pipeline YAML (`config/workflows/task-pipeline.yaml:66,147`) to pass `--no-lifecycle` on both `spur task update wip` and `spur task update done` shell commands.
- **P2-5:** Added prominent observe-only mode warning to `plugins/sp/commands/dev-dogfood.md:29-37` as a blockquote callout before the Arguments table. Updated `--max-retry` description with "Recommended for first runs against unfamiliar testees."

Fix attempts during implement: 2 type errors (Commander `--no-` flag naming, `Bun.spawn` type assertion) + 2 Biome formatting fixes. All resolved within budget.

### Step 3 — test
Ran `bun run test`. 1761 tests pass, 0 failures. Existing test suite provides regression protection for CLI command changes.

### Step 4 — review
Conducted SECU review of the full diff. No blockers found. All changes are minimal, correctly scoped, with appropriate error handling. The `--async` implementation correctly uses `.unref()` for process detachment and includes a sync fallback.

### Step 5 — verify
Requirements traceability: 6 of 7 plan items verified PASS. P2-1 (process-group signal forwarding) requires upstream changes in `@gobing-ai/ts-runtime` and `@gobing-ai/ts-ai-runner` before Spur can wire it. Verdict: **PARTIAL**.

### Step 6 — record
Wrote Solution, Testing, and Review sections via `spur task update --section`. Ran `spur task record 0116 --solution-from-diff --transition testing`. Moved task to done via `spur task update 0116 done`.

---

## Issues

### Fixed

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| `$ARGUMENTS` only in Platform Notes for 5 inline-procedure commands | Inconsistent pattern — `$ARGUMENTS` was documented but not in the Implementation section where agents consume it | Added `**Arguments received:** $ARGUMENTS. Parse per the Arguments table above.` to Implementation section; removed `$ARGUMENTS` mention from Platform Notes |
| No observe-only mode warning in dev-dogfood | Missing UX — users could accidentally mutate the repo on first run | Added blockquote warning before Arguments table + updated `--max-retry` description |
| Orphaned lifecycle runs from pipeline status transitions | Pipeline's `spur task update wip`/`done` commands created secondary lifecycle workflow runs | Added `--no-lifecycle` flag; updated pipeline YAML |
| No `--async` mode for `spur workflow run` | Workflow run was always synchronous — no way to start and detach | Added `--async` flag using `Bun.spawn` with `.unref()` |
| No `--force` for `spur workflow clean` | Default 30min threshold too long for interactive cleanup | Added `--force` flag (minutes=0) with updated UX |

### Unresolved

| Issue | Diagnosis | Why Still Fails |
|-------|----------|-----------------|
| P2-1: Process-group signal forwarding for spawned agent subprocesses | The fix requires adding `signal?: AbortSignal` support to `ProcessExecutor` in `@gobing-ai/ts-runtime`, then threading it through `AiRunner.runPromptCommand()` in `@gobing-ai/ts-ai-runner`. Only after both upstream packages ship can Spur wire process signal handlers in `AgentService` + `AgentRunActionRunner`. | Requires changes in two external packages (`~/xprojects/ts-libs/`). No Spur-side workaround possible without the upstream plumbing. |

---

## Findings

| Severity | Finding | Recommendation | Effort |
|----------|---------|---------------|--------|
| P2 | `ProcessExecutor` in `@gobing-ai/ts-runtime` lacks `AbortSignal` support — agent subprocesses become orphaned when the parent spur process is killed | Add `signal?: AbortSignal` to `ProcessOptions`, forward to execa as `cancelSignal`. Then thread through `@gobing-ai/ts-ai-runner`'s `AiRunner.runPromptCommand`. Wire in Spur via `process.on('SIGTERM/SIGINT')` → `AbortController.abort()`. | M |

---

## Gate Results

| Gate | Result |
|------|--------|
| `bun run lint` | ✅ Clean |
| `bun run test` | ✅ 1761 pass, 0 fail |
| `bun run build` | ✅ Passes |
| `git status` | ✅ 9 modified files (all intentional) |
