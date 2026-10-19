---
schema_version: 1
name: Finalize lifecycle run rows left running by a manual transition
status: todo
template: issue
created_at: 2026-10-18T19:33:17.580Z
updated_at: "2026-10-19T02:41:28.906Z"

feature_id: D3
---

## 1257. Finalize lifecycle run rows left running by a manual transition

### Background

After task 1246 reached `done` through `spur task record --transition testing` + `spur task update 1246 done` and `spur feature sync D66`, the project DB held a lifecycle run that nothing ever finalized:

```
id                                       workflow_name      status   external_key  started_at
run_524dae91-f944-40e6-855b-b382ac852773  feature-lifecycle  running  feature:D66   2026-10-18T06:45:10.245Z
```

`metadata_json` is `{}`, `completed_at` is null, and no later call closes it — it survived the rest of the batch (10+ hours) and every subsequent `spur agent status` / Board read renders it as a live run.

**Mechanism (partly traced).** `packages/app/src/workflow/lifecycle-adapter.ts:71-72` opens a `feature-lifecycle` run for a feature transition (`linkKind`/`workflowName`), and `requestTransition` drives it one transition per `(from, to)` pair. The manual path (`spur task update <wbs> <status>` → feature sync → `requestTransition`) creates the row but the caller does not finalize it when the transition completes outside a pipeline run. The exact owner of the close is unconfirmed — confirm with a log at the adapter's transition completion and at `spur feature sync`'s exit path.

**Impact.** A phantom `running` row: `spur agent status` and the Board show an active run that no process owns; a future `project_claims`-style exclusivity check keyed on "there is a running lifecycle run" would refuse work; and an operator reading the runs table cannot tell a crashed session from a live one.

### Requirements

- [ ] R1. A lifecycle run opened by a feature transition reaches a terminal state (`done` on success, `failed` on a denied/errored guard) before `requestTransition` returns, including the manual `spur task update` → `feature sync` path.
- [ ] R2. When the caller abandons the transition (exception, early return, process exit), the row is finalized `interrupted` — never left `running`.
- [ ] R3. An ops verb can list run rows whose owning process is gone (no live pid/lease) and sweep them to `interrupted`, so a crash is recoverable without SQL.
- [ ] R4. `spur agent status`, the Board feed and `spur history analyze` exclude or label swept rows so a phantom is never rendered as live.
- [ ] R5. A regression test drives one manual transition and asserts no `running` lifecycle row remains afterwards.

### Acceptance Criteria

- [ ] AC1 — A feature transition leaves no `running` lifecycle row, on the pipeline path and the manual `task update` path (req: R1, R2, R5)
- [ ] AC2 — A crashed session's row is sweepable to `interrupted` without SQL (req: R3)
- [ ] AC3 — Reads never render a swept row as live (req: R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Chosen: finalize at the owner, sweep as the backstop.**
1. Make the adapter's transition completion finalize the row it opened (R1), in a `try/finally` so an exception or early return closes it `interrupted` (R2) — the same shape `feature-verification-run.ts` already uses for the verification pass (open → finalize `done`/`failed`), which is the precedent to copy.
2. Add the sweep as a narrow ops surface (R3): list `runs` where `status='running'` and the run's owning pid/lease is dead, then finalize `interrupted` with a reason carrying the sweep's evidence. Prefer extending an existing ops noun over a new one.
3. Reads (R4): a swept row is `interrupted`, which the existing status vocabulary already renders as not-live; add it to whatever "active run" filter the Board/agent status uses.

**Rejected.**
- Deleting the row: provenance is the point of the runs table.
- A cron sweeper only: it hides the missing finalize and leaves a window where the phantom is live.
- Refusing new transitions while a `running` lifecycle row exists: that turns the defect into an outage.

**Frozen names.** `interrupted` (existing status) with a `swept` marker in `terminal_reason`; no new status value.

**File targets.** `packages/app/src/workflow/lifecycle-adapter.ts:60-120,330-360`; `packages/app/src/services/planning-write-service.ts:471` (`requestTransition` call site); `packages/app/src/services/feature-service.ts` (sync path); `apps/cli/src/commands/agent/*` or `apps/cli/src/commands/workflow/*` for the sweep verb; tests `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts`, `packages/app/tests/services/feature-service.test.ts`.

**Anti-patterns.** No second "lifecycle run" concept; do not reuse the feature's verification run row for a transition; do not let a sweep finalize a row whose owner is still alive (check the pid/lease first).

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
