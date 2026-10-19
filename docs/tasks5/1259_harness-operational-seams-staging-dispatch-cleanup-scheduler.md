---
schema_version: 1
name: "Harness operational seams: staging, dispatch, cleanup, scheduler and CLI parity"
status: todo
template: issue
created_at: 2026-10-19T02:36:33.290Z
updated_at: "2026-10-19T02:41:29.658Z"

feature_id: D3
---

## 1259. Harness operational seams: staging, dispatch, cleanup, scheduler and CLI parity

### Background

Six independent seams failed during the D66 batch (2026-10-18) that do not belong to the answer-contract (1254), executor-resolution (1255), terminal-reason (1256), phantom-row (1257) or retention (1258) tasks. Each is small, local, and evidenced; each cost an operator workaround during the batch. Kept as one task because they share the same fix shape — a harness seam that must report its own failure instead of degrading silently — and because none is large enough to justify its own pipeline run.

**1. `commit-guard stage` cannot stage a change set that contains a deletion.** `packages/app/src/workflow/commit-guard.ts:206-232`: `staged = paths.filter(p => written.has(p))` never includes a deleted path, and the surviving `git add -- <paths>` fails on the deleted member (`pathspec did not match`), so the whole stage reports `git add failed — nothing staged`. Observed on 1246 and 1251, both of which delete a workflow YAML; the driver fell back to plain `git add`, i.e. bypassed the guard that exists to prevent foreign writes (a94f9f431, 36f274590).

**2. `workflow run --async` reports a phantom failure while the run exists.** `apps/cli/src/commands/workflow/run.ts:589-608`: when the spawn "succeeds" but `waitForRunRegistration` misses its timeout, the CLI prints `async worker failed to start or register the run` with no cause and skips the synchronous fallback — yet the row *was* created (`a8348757-…`, later `failed-timeout`). Two batch attempts stalled this way; a synchronous run then worked. The sync fallback at `:576-589` only covers a failed spawn, not a missed registration.

**3. Feature derivation turns an effectively-complete feature into `blocked`.** `packages/app/src/services/feature-service.ts:539-609` (`deriveFeatureStatus`): with 7 linked tasks `done` and the deferred 1253 `blocked`, `spur feature sync D66` proposed `active → blocked` ("All non-terminal linked tasks are blocked"). Closing the feature then required cancelling 1253 and a manual `spur feature update D66 active`.

**4. `git worktree remove --force` leaves the tree behind.** It unregistered the worktree (`git worktree list` showed only the main tree) and then failed `Directory not empty`, leaving the directory, its `.spur/` evidence and the merged branch. The WT-4 close-out cannot complete unattended and the leftover is silent.

**5. A saturated scheduler wedges async dispatch.** `queue_jobs` held 8 failed `scheduler.custom` rows (`history-refresh` killed at 600 s, see 1258) and one stuck `processing` row while `--async` refused to start; nothing in the `--async` failure message mentions the queue.

**6. `spur feature verify` has no `--json`.** `apps/cli/src/commands/feature/verify.ts:32-33` declares only `--run-id` and `--cmd`, while `feature check` and `feature sync` both emit JSON. A scripted close has to parse a sentence. **Public-surface change — requires operator consent before implementation** (AGENTS: adding/changing a public verb needs explicit consent).

### Requirements

- [ ] R1. `commit-guard stage` stages deletions correctly: a path the run removed is staged as a deletion (`git add -A -- <path>` semantics for removed paths) and never poisons the batch; a genuinely foreign path is still refused with its reason.
- [ ] R2. `workflow run --async` distinguishes "spawn failed" from "registration missed its deadline": it prints the cause, states whether the worker may still be starting, and — when registration is confirmed absent — falls back to the synchronous run exactly as the spawn-failure path does.
- [ ] R3. Feature derivation distinguishes "every remaining linked task is blocked" (blocked) from "the feature's live scope is complete and only deferred work remains" (verifying), and the message names the tasks that produced the verdict.
- [ ] R4. Worktree close-out verifies the removal and reports a residual tree with the reason and the exact commands to finish it; the driver never reports a clean landing while the tree still exists.
- [ ] R5. The `--async` failure path reports the queue state (processing row age, recent failures for the same job type) so a saturated scheduler is named as the cause.
- [ ] R6. `spur feature verify --json` emits `{status, receiptPath, runId, logPath}` like its siblings — gated on operator consent for the public-surface change.
- [ ] R7. Each of R1-R5 has a regression test that fails on the current behaviour; R6 is covered by the CLI parity test.

### Acceptance Criteria

- [ ] AC1 — A change set containing deletions stages through the commit guard without a fallback to plain `git add` (req: R1, R7)
- [ ] AC2 — An async start that misses its registration deadline reports the cause and falls back synchronously, naming queue saturation when present (req: R2, R5)
- [ ] AC3 — Feature derivation keeps a complete-scope feature out of `blocked`, and close-out reports any residual worktree (req: R3, R4)
- [ ] AC4 — `feature verify` emits JSON like its siblings, with its design doc updated in the same commit (req: R6)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Chosen: each seam reports its own failure; no silent degradation.**
1. **commit-guard (R1):** split the path list before staging — existing paths go through `git add --`, removed paths through `git add -A --` (or `git rm --cached` for a staged delete) — then verify with `git diff --cached --name-status` that every requested path landed with the expected status. Refuse only what the fingerprint says the run did not write.
2. **async registration (R2):** re-read the run row after the timeout; if it exists, report `started (registration late)` with the run id instead of a phantom failure; if it does not exist, run synchronously (reuse the existing fallback block) and say so.
3. **derivation (R3):** add the "live scope complete" predicate to `deriveFeatureStatus` — non-terminal tasks that are all `blocked` **and** a task the feature explicitly records as deferred → `verifying`; otherwise keep `blocked`. Needs a design decision on how deferral is recorded (a `deferred` tag on the task is the cheapest honest marker) — ask the operator before implementing.
4. **worktree close-out (R4):** after `git worktree remove`, assert `! -e "$WT"`; on failure print the residual path, the reason, and `git worktree prune` + `rm -rf` as the operator step. Prefer a small `spur workflow worktree remove` verb so every driver shares one implementation.
5. **queue visibility (R5):** on the async-start failure, query `queue_jobs` for `status='processing'` older than the lease and the last N failures for the same `type`, and include a one-line summary.
6. **CLI parity (R6):** add `--json` to `feature verify`, emitting the same envelope as `feature sync`; update `docs/04_DESIGN.md` and the spur-cli reference in the same commit (T3).

**Rejected.** Retrying `git add` blindly (R1); a longer async timeout alone (R2 — hides the cause); deriving `verifying` whenever no task is runnable (R3 — would close features with real blocked work); silencing the worktree failure (R4); adding `--json` without consent (R6).

**Frozen names.** `stage-deletion` status in the guard report; `started-registration-late` outcome; `deferred` task tag; `spur workflow worktree remove`.

**File targets.** `packages/app/src/workflow/commit-guard.ts:206-232` · `apps/cli/src/commands/workflow/run.ts:576-608` + `waitForRunRegistration` · `packages/app/src/services/feature-service.ts:539-609` · worktree close-out in `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md` + a CLI verb · `apps/cli/src/commands/feature/verify.ts:32-33` · tests `packages/app/tests/workflow/commit-guard*.test.ts`, `apps/cli/tests/commands/workflow/run*.test.ts`, `packages/app/tests/services/feature-service.test.ts`, `apps/cli/tests/commands/feature/verify.test.ts`.

**Anti-patterns.** No `git add -A` at repo root in the guard; no silent retry loops on async start; no derivation change without the deferral marker; never bypass the guard in a driver — fix the guard.

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
