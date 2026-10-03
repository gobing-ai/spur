---
run_id: 20261002-runall-d3
status: complete
testee: "/skill:sp-dev-runall --feature D3 --auto --next --agent inline --worktree --wrap + feature-verification.yaml"
classification: slash-command
mode: fix
max_retry: 3
testee_agent: inline
started_at: "2026-10-02T18:30:00Z"
finished_at: "2026-10-03T07:56:00Z"
live_path: .spur/run/ (per-task run artifacts + verdicts)
report_path: docs/dogfood/2026-10-02-D3-runall-batch-landing-dogfood.md
protocol: sp:dogfood-testing@1.2
---

## Dogfood Report — `/skill:sp-dev-runall --feature D3 --auto --next --agent inline --worktree --wrap` (batch-drivers feature D3)

### 1. Testee

- **Command:** `/sp:dev-runall --feature D3 --auto --next --agent inline --worktree --wrap` — host-session inline batch driver over D3's remaining tasks, plus the WT-4 landing protocol it lands (E71 persist-out enforcement, task 1067).
- **Classification:** slash command + the WT-4/WT-5 worktree-landing protocol under `plugins/sp/skills/spur-dev/references/execution-batch.md`.
- **Batch:** tasks 1065, 1067 (4 A8 tasks skipped per frozen plan: 0901, 0902, 0980, 1064) — managed worktree `spur-new-runall-d3-82ca7e3c` (branch `sp/runall-d3-82ca7e3c`, base `781a2789`), one fresh `task-pipeline.yaml` run per task.
- **Terminal evidence:** `.spur/run/106{5,7}-verdict.json`; batch report `.spur/run/runall-d3-82ca7e3c-batch-report.md` (PASS 2/2); landing gate re-run on the rebased tip: 9849 tests / 572 files PASS.

### 2. Execution Summary

All 2 tasks reached terminal `done` with per-task structural gates. `main` advanced past the batch base mid-run (task 1066 landed); the batch branch was rebased in the worktree, the full gate re-run on the rebased tip, then landed FF-only (`b16f8a1da → 3f9b0fd9c`). The wrap hop completed after satisfying the feature-level L4 gates.

| Task | Deliverable | Gate at done | Key E2E evidence |
| --- | --- | --- | --- |
| 1065 | residual-scan fold freshness-aware across run/durable planes (strictly-newer durable copy wins) | 9840/9840 → 9849/9849 | 8 behavioral tests (`packages/app/tests/services/residual-scan.test.ts`), coverage 90/90 per-file; fold verified against live run rows |
| 1067 | E71 persist-out enforcement (persist-out-check.ts) + task-diffstat stdout-redirect guard | 9849/9849 | 11 script tests (coverage persist-out-check 100/93.75, task-diffstat 100/95.35); proof `sha256:314b06…a19a3` |

### 3. Feature-surface exercises observed in production

- **E71 persist-out enforcement (1067's own surface)** — `persist-out-check.ts` ran against the live worktree three times across the landing and progressed exactly as the R1 contract predicts: BLOCKED 40 missing (exit 1, `--task-file` omitted by the operator) → BLOCKED 12 missing (batch-runId-scoped driver markers not enumerated by persist-out ownership) → **ok, 40 evidence files persisted, exit 0**. The guard refused worktree removal until the evidence set was complete — it did its job against its own author.
- **Worktree isolation under main drift** — base `781a2789` vs landing-time main `b16f8a1da` (1066 landed mid-batch, zero file overlap): rebase inside the worktree, one append-append conflict in `.spur/context/learnings.md` (both sides kept), full gate re-run on the rebased tip before FF-only merge.
- **ADR-119 done-gate** — `feature update D3 done` denied with `L4.dogfood-missing` + `L4.feature-receipt-stale` (tree digest drifted after the batch). Both cleared by this report and a fresh `feature-verification.yaml` pass — a feature is not done until it passes; enforced, not prose.

### 4. Findings

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | P2 | Cross-plane citation gap in `persistWorktreeRuns`: when the worktree scratch copy is absent the resolver probes only the target durable plane (`toRecordsDir`), never the invoking tree's scratch (`toRunDir`) — a citation resolving in main's `.spur/run/` alone is refused as "missing in both" (`packages/app/src/services/inline-run-setup.ts:439-443`). | Out-of-batch scope; recorded in learnings. Workaround: seed the cited file into worktree scratch. Upgrade: probe the invoking scratch before declaring failure. |
| F2 | P2 | Batch-runId-scoped driver markers (`<runId>-<wbs>-*.status/.digest`, batch-report, env.sh) have no DB run row, so persist-out's ownership enumeration (1012 R1/R2: `<wbs>-*` + DB run ids) never copies them — the driver must copy that family itself before teardown. | Out-of-batch scope; `persist-out-check --run-id <batchId>` catches the gap (proved live). Upgrade: enumerate batch-driver runId files as a third ownership class. |
| F3 | P3 | persist-out must run with cwd = invoking tree: citation resolution reads the invoking tree's planes; running it from the worktree fails 0984 R1 on citations whose only copy is main scratch. | Runbook semantics confirmed live; documented in learnings (WT-4 assertion contract). |
| F4 | P3 | Parallel feature-lifecycle rows for one external key (worktree `running` vs main `interrupted`) block persist-out with `external-key-conflict` (1049 fail-closed). | Reconciled per 1049's own instruction: worktree duplicate row + `__reseed__` children deleted (zero unique provenance); main's row untouched. |
| F5 | P4 | Rebase landing leaves the feature-scoped verification receipt stale by construction (tree digest drift). | Expected; refreshed by the post-landing `feature-verification.yaml` pass. Upgrade path: none needed — the staleness is the truthful claim. |

### 5. Verdict

**complete.** The batch driver executed its full lifecycle end-to-end — bootstrap, per-task pipelines to terminal `done`, terminal inspection, batch report, rebase-under-drift landing, FF merge, wrap — and the new E71 guard demonstrably prevented evidence-abandoning teardown in production (three live BLOCKED states, each with a correct remediation path). All findings were recorded in `.spur/context/learnings.md` and cross-referenced here; F1/F2 are filed as upgrade candidates for the persist-out ownership model.
