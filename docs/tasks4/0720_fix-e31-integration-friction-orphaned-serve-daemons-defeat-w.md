---
schema_version: 1
name: "Fix E31 integration friction: orphaned serve daemons defeat worktree removal; corpus gate runs full test suite; R2d replay discards verdicts"
status: todo
template: issue
created_at: 2026-08-30T02:21:06.464Z
updated_at: "2026-08-30T02:24:26.557Z"
feature_id: A6
---

## 0720. Fix E31 integration friction: orphaned serve daemons defeat worktree removal; corpus gate runs full test suite; R2d replay discards verdicts

### Background
Session 2026-08-29/30 — E31 dev-runall batch (0716, 0717) + bf8c worktree integration onto main. The batch itself was clean (2×PASS, 3 commits, gate green in worktree); the integration step consumed ~2h20m, dominated by avoidable workflow friction. This task captures the three systemic findings so the next integration doesn't repeat them. Direct doc fixes already applied in c25f0c141 (WT-4 daemon-kill guard + R2d replay-order note in execution-batch.md) are excluded here.
### Requirements
R1. Worktree cleanup after a `--worktree` batch must detect and terminate processes still holding the worktree directory as CWD before `git worktree remove`, and fail with a named PID/port hint when a process cannot be killed — no silent partial deregistration.
R2. A corpus-only gate path (no full test suite) must exist for post-merge baseline acceptance; `spur-check-new` remains the full pre-push gate.
R3. The R2d lifecycle-DB disposition must be a single deterministic contract: either `task record --verdict-file` in the invoking tree persists `task_run_links` rows, or the replay step is removed from execution-batch.md in favor of batch-report-as-truth. No middle ground that writes `updated_at` churn while discarding verdict evidence.
### Acceptance Criteria
```gherkin
Scenario: R1 — daemon-holding worktree is removed cleanly
  Given a batch whose proof steps spawned `serve` daemons with --cwd inside the worktree
  When the create-mode success path runs worktree cleanup
  Then processes holding the worktree directory are terminated before git worktree remove
  And git worktree remove succeeds without manual lsof intervention
  And an unkillable process produces a halt report naming the PID and port

Scenario: R2 — corpus-only change has a fast gate
  Given a change touching only config/corpus-baseline.json or docs/tasks*/ docs/features* corpus files
  When the operator runs the corpus-only gate
  Then it completes in under 60 seconds
  And it catches corpus regressions (new findings outside baseline)
  And the gate is documented in AGENTS.md build/verification

Scenario: R3 — R2d disposition is deterministic
  Given a green worktree batch merged onto the base ref
  When the operator follows the documented R2d disposition in execution-batch.md
  Then the outcome leaves no updated_at-only churn in task files
  And the disposition states exactly where verdict evidence durably lives (DB rows or batch report)
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause
- R1 (P2, workflow): Orphaned `serve` proof daemons (PPID 1, ports 3000/3005) kept the removed worktree as CWD; `git worktree remove` failed ENOTEMPTY, `rm -rf` failed os error 66, while `git worktree prune` had already deregistered the tree — three confusing partial states before lsof revealed the daemons.
- R2 (P2, workflow): The post-merge gate `bun run spur-check-new` runs the full 6766-test suite (~126s) plus corpus sweep; rerunning it after a baseline-only JSON fix re-runs everything because no split/affected-target surface exists.
- R3 (P3, workflow): R2d lifecycle replay (`task record` after files already merged as done) wrote `updated_at`-only churn and never persisted the copied verdicts as `task_run_links`; verdict JSONs under worktree `.spur/run/` are effectively discarded on worktree removal (only survived because manually copied first).
### Solution
#### R1 — kill orphaned daemons in worktree cleanup

**Evidence:** `ps -p 58932,99623` showed two `spur … serve --cwd <worktree> --port 3000/3005` processes, PPID 1, started at batch proof-run times (17:53/18:27). After `kill 58932 99623`, `rm -rf` + `git branch -d` succeeded immediately.

**Fix direction:** In the worktree-removal path (apps/cli batch driver or the skill's WT-4 create-mode block — doc side already updated in c25f0c141), before `git worktree remove`: enumerate PIDs holding the worktree dir (`lsof -t <dir>` or `fuser -k`), kill them, then remove. Prefer failing the removal with a named hint ("worktree in use by PID …") over silent partial deregistration. Consider a `serve` daemon shutdown at proof-run teardown (the process-spawn test helper should reap children). Code side of execution-batch.md:676.

**AC:** A batch whose proof steps spawn `serve` daemons completes `git worktree remove` without manual lsof intervention; a daemon that refuses to die produces a halt report naming the PID/port.

#### R2 — cheap post-merge corpus gate

**Evidence:** `bun run spur-check-new` output: `Ran 6766 tests across 357 files. [125.95s]` then `corpus-check FAILED … 1 new` (A31, other actor's scenario-first commit). After regenerating the baseline (JSON-only change), recheck `task check --corpus` alone took ~36s and passed; full re-run would cost another ~3min for zero new signal.

**Fix direction:** Add a `spur-check-corpus` script (lint + typecheck + `task check --corpus`, no tests) for post-merge corpus acceptance; keep `spur-check-new` as the full pre-push gate. Alternatively a bun `--affected` filter keyed on changed workspaces; split point is package.json:81. Ponytail floor: a 3-line package.json script aliasing the existing commands.

**AC:** After a corpus-only change (baseline regen, task-file edit), a gate path exists that finishes in <60s and catches corpus regressions; documented in AGENTS.md build/verification block.

#### R3 — R2d replay should persist or explicitly discard verdicts

**Evidence:** `task record 0716/0717 --json` returned `{testingWritten: true, reviewWritten: false}` and only bumped `updated_at` (restored via git checkout); `task_run_links` in main DB stayed empty while worktree DB had 4 rows (2 pipeline + 2 lifecycle). The R2d doc offers "replay transitions OR treat batch report as truth" but the replay path silently does neither fully.

**Fix direction:** Decide one contract: (a) `task record --verdict-file` in the invoking tree creates the `task_run_links` rows (import verdict provenance), or (b) R2d drops the replay step entirely — batch report + committed files are the record, delete the replay sentence from execution-batch.md:723. Current middle ground wastes ~10 min per integration and discards evidence.

**AC:** Integration doc states one deterministic disposition; following it leaves no `updated_at` churn and no ambiguity about where verdict evidence lives.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- package.json:81 (`spur-check-new` composition — R2 split point)
- plugins/sp/skills/spur-dev/references/execution-batch.md:676 (WT-4 daemon-kill guard, doc side done in c25f0c141)
- plugins/sp/skills/spur-dev/references/execution-batch.md:723 (R2d replay sentence — R3 decision point)
### History
