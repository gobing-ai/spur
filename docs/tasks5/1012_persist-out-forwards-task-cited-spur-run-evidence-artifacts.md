---
schema_version: 1
name: persist-out forwards task-cited .spur/run evidence artifacts
status: backlog
template: feature-impl
created_at: 2026-09-29T18:18:18.307Z
updated_at: "2026-09-29T19:53:34.865Z"
feature_id: A9

ac_altitude: task-local
---

## 1012. persist-out forwards task-cited .spur/run evidence artifacts

### Background

Observed during run 785c3ca9-fa8e-4ea8-b75e-81ccac2db600 (task 1008, single-task `--worktree` WT-4 finish per 0975 R1, `--task-file` per 0984 R2): persist-out copied the run record (`<runId>.state.json` + `<runId>.md`) and nothing else; `1008-verdict.json`, `1008-test-gate.log/.status`, `1008-precheck-*.status`, `1008-residuals.json`, `1008-diffstat.json`, `<runId>-*.status/.txt/.digest` were hand-copied before `git worktree remove`.

**Verification (2026-09-29) — the original diagnosis was wrong.** Task-cited evidence forwarding already shipped in 0984 (2026-09-27, commits 9e131b141 / a77b28028 / fd0a81872): `persistWorktreeRuns` (`packages/app/src/services/inline-run-setup.ts:252+`) scans each `--task-file` for literal `.spur/run/<file>` citations and copies/verifies them, fail-closed. It did not fire because the 1008 task file cites exactly one run path (`.spur/run/785c3ca9-…-review-answer.txt`); its Testing section says "Verdict: PASS (from verdict artifact)" with no path. The real gap: **run-owned evidence that the task file does not cite by path dies with the worktree.** The docs already promise otherwise — `plugins/sp/skills/spur-dev/references/execution-batch.md:1117` says "WT-4a persists [`<wbs>-verdict.json`] into the invoking tree", which is only true when the verdict happens to be cited. The batch-level verdict copy (`execution-batch.md:484`) does not cover single-task `/sp:dev-run --worktree`.

The original R1 (citation scan + `--evidence` flag in the script) duplicates 0984, and the original R2 (conflict → report and continue; missing → warning) would regress 0984 R1/R4 fail-closed guarantees. Both are replaced below. (Task name predates this correction; scope is "run-owned", not "task-cited".)

### Requirements

- **R1 (run-owned evidence)** — when `--task-file` is given, `persistWorktreeRuns` additionally treats as copy obligations the worktree's `.spur/run/` direct-child regular files whose name starts with `<wbs>-` (WBS = leading four digits of each forwarded task file's basename) or `<runId>-` (each safe run id in the worktree DB's `runs` rows). These join the cited set and go through the identical 0984 pipeline: absent target → copy; byte-identical → no-op; divergent → fail closed (throw, no overwrite, worktree retained via WT-5); non-regular file → `cited-<kind>` skip. Owned names are enumerated from the source directory, so they never trigger missing-in-both. The 64-file cap (`MAX_CITED_RUN_FILES`) applies to the union.
- **R2 (zero-write validation preserved)** — owned-set enumeration (directory listing + source DB run-id read) happens before any target write, keeping 0984's "unresolved/unsafe/over-cap fails with zero side effects" guarantee. Without `--task-file`, behavior is byte-identical to today.
- **R3 (docs match behavior)** — `execution-batch.md` "Cited evidence rides the same call" paragraph (:506-515) documents the owned-evidence rule; :1117 becomes true as written.

### Acceptance Criteria

- [ ] AC1 — `packages/app/tests/services/persist-worktree-runs.test.ts`: fixture worktree with a task file `1234_x.md` that cites no run paths, plus `.spur/run/1234-verdict.json`, `.spur/run/<runId>-route-reason.txt` and an unrelated `.spur/run/9999-verdict.json` → after persist-out the first two exist in the target `.spur/run/` and `9999-verdict.json` does not (req: R1)
- [ ] AC2 — Re-running over the same fixture is a no-op (identical bytes, exit ok); a divergent pre-existing target `1234-verdict.json` throws, leaves the target bytes unchanged and performs zero writes (req: R1, R2)
- [ ] AC3 — Without `--task-file`/`taskFiles`, no owned evidence is copied (existing tests stay green unchanged) (req: R2)
- [ ] AC4 — `execution-batch.md` describes the owned-evidence rule (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T19:53:34.329Z

- **Q: Keep, drop or rewrite?** Closed 2026-09-29: rewrite. The observed loss is real; the proposed mechanism already exists (0984) and the proposed conflict semantics would weaken it.
- **Q: Ownership rule?** Closed: filename prefix `<wbs>-` / `<runId>-`. It matches every artifact the pipeline writes (`<wbs>-verdict.json`, `<wbs>-test-gate.*`, `<runId>-*.status`), is deterministic, and stays bounded — no whole-directory copy.
- **Q: Divergent owned file in the target (e.g. a stale `<wbs>-verdict.json` from an earlier non-worktree run)?** Closed: fail closed, same as 0984 R4. Consequence: the operator reconciles by hand and the worktree is retained — accepted, because "a green run can never destroy its own evidence" outranks convenience. Revisit only if this proves frequent.
- **Q: `--evidence <path>` flag?** Closed: dropped (YAGNI; ownership rule + citations cover it; also avoids a script-surface change).
- **Q: Implement in the script?** Closed: no — the script owns no persistence policy (`inline-run-setup.ts` header); the change lives in the app service, and the generated bundle is rebuilt.

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

1. `packages/app/src/services/inline-run-setup.ts:252+` — before the cited-name loop: derive WBS prefixes from `basename(taskFile).match(/^(\d{4})_/)`; read source run ids (open the source DB read-only earlier, reuse `listRunIdRows`, keep the `SAFE_RUN_ID_RE` rejection before any target write); `readdir(fromRunDir)` and add each name starting with a WBS or run-id prefix plus `-` to `citedNames` (same cap check). Skip the `<runId>.md` / `.state.json` record files — they are handled by the record copy. Everything downstream is unchanged.
2. Update the function JSDoc (cited + owned evidence).
3. `packages/app/tests/services/persist-worktree-runs.test.ts` — AC1–AC3 fixtures using the file's existing temp-tree helpers.
4. `bun run build:plugin-lib` → commit the regenerated `plugins/sp/lib/inline-run.generated.mjs` (+ `.d.mts` if changed); `bun run plugin-smoke`.
5. `plugins/sp/skills/spur-dev/references/execution-batch.md:506-515` — owned-evidence sentence.

Constraints (anti-drift):

- No change to `plugins/sp/scripts/inline-run-setup.ts` flags or usage; no new flags.
- Do NOT relax 0984 semantics (divergent → throw; zero-write validation; cap).
- Do NOT copy the whole `.spur/run/`; ownership prefix only.
- No run-record format or `--close` changes. `ac_altitude: task-local` stays.

Verify: `(cd packages/app && bun test tests/services/persist-worktree-runs.test.ts)`; `bun run plugin-smoke`; `bun run spur-check`.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Tasks: 0975 R1 (persist-out), 0984 R1–R5 (cited evidence, fail-closed) · 1008 (run 785c3ca9 provenance) · Feature: A9
- Code: `packages/app/src/services/inline-run-setup.ts:189-330` (`MAX_CITED_RUN_FILES`, `RUN_CITATION_RE`, `persistWorktreeRuns`) · `plugins/sp/scripts/inline-run-setup.ts:55-66,596-625` (delegating script) · `packages/app/tests/services/persist-worktree-runs.test.ts`
- Docs: `plugins/sp/skills/spur-dev/references/execution-batch.md:478-530, 1117`

### History
