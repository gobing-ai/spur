---
schema_version: 1
name: "Supervise agent loops: no orphan loops and no duplicate serves per project"
status: backlog
template: feature-impl
created_at: 2026-10-05T07:28:03.248Z
updated_at: "2026-10-05T07:28:29.902Z"
feature_id: G67

---

## 1088. Supervise agent loops: no orphan loops and no duplicate serves per project

### Background

Observed on this host on 2026-10-04/05 while running the G71 batch (evidence below is from that session's
tool output; the loops and serves were stopped by hand).

- **Six `spur serve` instances for ONE project.** `ps` showed `serve --cwd /Users/robin/xprojects/spur-new`
  on ports 3004, 3005, 3007, 3009, 3010 and 3011 at the same time, each having spawned its own
  `planner-1`, `spur-new-pi-k3` and `spur-new-reviewer-1` loops — 16 live `agent loop` processes.
- **The loops were unsupervised.** `spur agent status --json` reported all three specs as `stopped`
  while 15 loops were running, so `spur agent stop <spec>` could not reach them; only a manual `pkill`
  plus stopping the duplicate serves cleared them.
- **They cost ~5 hours of a batch.** The host sat at load 30–45 for two and a half hours;
  `bun run spur-check` took 1135 s against 264 s on a quiet host, and spawn-heavy tests failed at 5 s,
  15 s, 30 s and even 120 s per-test budgets. Four gate attempts could not produce a trustworthy verdict
  (the G71 run log records each attempt and its failing tests).
- **Nothing detects them.** The supervisor registry is per serve process, so a crashed or replaced serve
  leaves its children running with no owner; no command reports a loop whose parent is gone.

Owner surfaces: `packages/app/src/services/supervisor-service.ts` (registry, frames, spawn),
`apps/cli/src/commands/serve.ts` and `apps/server/src/serve.ts` (start + shutdown),
`apps/cli/src/commands/agent.ts` (`start` / `stop` / `status` / `doctor`).

### Requirements

- [ ] R1. A second `spur serve` for a project that already has a live serve REFUSES with the live
      instance named, instead of starting a second supervisor for the same project.
- [ ] R2. Every `agent loop` the supervisor spawns is registered under its spec, so `spur agent status`
      reports its pid and live status and `spur agent stop <spec>` terminates it.
- [ ] R3. Serve shutdown (SIGTERM/SIGINT) reaps its spawned loops and clears its ownership marker; a
      serve that starts over a stale marker reclaims the orphans it names instead of ignoring them.
- [ ] R4. A deterministic orphan check names a loop whose registered parent is gone or whose pid is
      alive with no registry row, and is reachable from `spur agent doctor`.

### Acceptance Criteria

- [ ] AC1 — A duplicate serve for the same project is refused, naming the live supervisor
- [ ] AC2 — `spur agent status` lists every live loop and `spur agent stop` terminates it
- [ ] AC3 — After a serve restart, no loop from the previous instance is left running
- [ ] AC4 — The orphan check names a synthetic orphan in a fixture

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Ownership marker.** A per-project `.spur/serve.json` (pid, port, startedAt, instanceId) written at
serve start and cleared on shutdown. Start reads it first: an alive pid refuses with
`project <p> already has a live supervisor (pid <n>, port <n>) — stop it or attach with --serve-attach`;
a dead pid is a stale marker whose recorded loop pids are reclaimed. Reuses the pid-liveness check
`spur agent status` already performs for supervised entries.

**Registry completeness.** Every spawn path records `{specId, pid, startedAt}` in the process registry.
`agent status` merges registry rows with a liveness probe over the recorded pids, so a live loop is
never reported `stopped`; `agent stop` resolves the registry row by spec and signals that pid, falling
back to the spec-scoped search the loop's own shutdown path already supports.

**Shutdown and reclamation.** Serve shutdown signals its children and waits a bounded interval, then
clears the marker. The stale path lists the marker's loop pids, reports them, and signals them before
removing the marker, so a crash/restart cycle cannot accumulate loops.

**Orphan check.** `spur agent doctor` gains one deterministic finding per orphan: a registered pid whose
parent is no longer the serve instance, or a live `agent loop` process for this project with no registry
row. Findings are named (`orphan-loop <spec> pid <n>`), never auto-killed.

Keep the change inside the existing supervisor/serve/agent surfaces: no new daemon, no new transport,
no change to how a loop is spawned.

### Plan

1. Failure list first as tests: a second serve starts (fixture marker + alive pid), `agent status`
   omits a live unregistered loop, `agent stop` cannot reach it, a restart leaves the previous loop
   running, and `agent doctor` stays silent on a synthetic orphan.
2. Marker write/read + the duplicate-serve refusal with its `--serve-attach` escape hatch.
3. Registry row per spawned loop; liveness merge in `agent status`; `agent stop` by spec.
4. Shutdown reap + marker clear; stale-marker reclamation on start.
5. The orphan finding in `spur agent doctor`.
6. Docs in the same commit: the serve/agent rows in `docs/04_DESIGN.md` and the supervision paragraph
   in `docs/03_ARCHITECTURE.md`.
7. Gates: `(cd apps/cli && bun test tests/commands/agent*.test.ts)`,
   `(cd apps/server && bun test tests/)`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
