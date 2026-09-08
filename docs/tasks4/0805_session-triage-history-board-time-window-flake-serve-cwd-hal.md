---
schema_version: 1
name: "Session triage: history-board time-window flake, serve --cwd half-scoping, startup drain gap"
status: todo
template: issue
created_at: 2026-09-08T05:46:02.113Z
updated_at: "2026-09-08T05:52:50.155Z"

---

## 0805. Session triage: history-board time-window flake, serve --cwd half-scoping, startup drain gap

### Background

Findings triaged from the B5 batch + merge session (2026-09-07/08), consolidated so they are not re-discovered later. What direct fixes already resolved is NOT repeated here: the serve.ts quota-consumer comment that overpromised synchronous startup drain was corrected in-commit (now cites dogfood 54D294E4D301 F1 and the 30s poll cadence). The items below remain open and actionable.

1. **Flaky time-window test — `packages/app/tests/services/history-board-service.test.ts:293`** (`rtcSummary.kpis.sessionsCount` expects 1, gets 0). Fails deterministically in full-suite runs executed between ~05:04–05:13 UTC on 2026-09-08 (3/3 failures: two `bun run spur-check`, one `bun run test`), passes the identical command at 05:32 UTC (7796/0) and in all 8 prefix/subset combinations (apps/cli, apps/server, apps/web, packages, and pairs). Neither merge side touched history-board code (git log on both sides of merge-base `5d435e63a` returned empty for the file). Hypothesis: UTC clock-boundary math in the 4h rollup window (`refreshHistoryRollups` / `LiveHistoryBoardService.getSummary`); the seeded row uses `Date.now() - 30min` with imported_at fixed at '2026-08-31T00:00:00Z'. Confirmation needed: reproduce with a frozen/mocked clock at the failing window, or read the window math in the rollup service. Suggested fix direction: make the window math testable (inject clock) or correct the boundary condition; the test itself is the victim, do not just weaken it.

2. **`serve --cwd` half-scoping** (`apps/cli/src/commands/serve.ts:11` `resolveServeDbUrl(cwd, env, configuredUrl)` scopes ONLY dbUrl; `projectRoot`/`loadSpurConfig` derive from `process.cwd()` throughout serve.ts — :49, :434, :459, :462, :631). Cross-tree launch (config from tree A, DB from tree B) silently half-scopes and produced a whole dogfood diagnosis cycle during B5 (S3/S5 were drive bugs caused by exactly this). Fix is a public-surface decision (make `--cwd` fully scope, or fail loudly when `--cwd` != process.cwd()) and requires operator design consent per harness-surface governance. Evidence: dogfood report `docs/dogfood/2026-09-07-B5-executor-quota-dogfood.md` finding F2; consumer logic itself verified sound via direct `drainPendingAgentQuotaUpdates` call ({applied:1}, row acked).

3. **No immediate startup drain in the quota consumer** (behavioral, optional): consumer start only subscribes; first drain is the 30s `setInterval` poll, so an autostarted agent can select a to-be-disabled executor within the first poll interval. Observe-only dogfood finding F1; AC letter was met (subscriptions precede autostart). If the product wants at-launch application, add a synchronous first drain at consumer start (drain path already verified: shutdown final drain applies cleanly).

### Requirements

<!-- R-numbered expectations for the fix. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

- AC1: Failing time window reproduced or root cause proven for history-board rollup flake (test file + window math identified; failing assertion named); fix keeps the existing test semantics (no weakening) and full suite is green at the previously failing UTC time window (05:04-05:13 UTC) via mocked clock if needed.
- AC2: serve --cwd behavior decision recorded (full scoping or loud failure on cwd mismatch) with design context for public-surface consent; chosen behavior implemented behind targeted tests.
- AC3: If at-launch quota application is wanted: synchronous first drain at consumer start with targeted test proving an autostart-spawned agent observes the disabled executor selection before first poll tick; otherwise record explicit not-wanted decision in this task.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

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
