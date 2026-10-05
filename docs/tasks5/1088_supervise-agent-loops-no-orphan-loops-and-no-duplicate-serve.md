---
schema_version: 1
name: "Supervise agent loops: no orphan loops and no duplicate serves per project"
status: backlog
template: feature-impl
created_at: 2026-10-05T07:28:03.248Z
updated_at: "2026-10-05T13:50:54.500Z"
feature_id: G67

ac_altitude: task-local
---

## 1088. Supervise agent loops: no orphan loops and no duplicate serves per project

### Background

Observed on this host on 2026-10-04/05 while running the G71 batch (evidence from that session's tool
output; the loops and serves were stopped by hand).

- **Six `spur serve` instances for ONE project** (`serve --cwd /Users/robin/xprojects/spur-new` on ports
  3004–3011), each with its own `planner-1` / `spur-new-pi-k3` / `spur-new-reviewer-1` loops — 16 live
  `agent loop` processes, host load 30–45 for ~2.5 h, `bun run spur-check` 1135 s vs 264 s quiet, and
  four untrustworthy gate attempts in the G71 run log.
- **`spur agent status --json` reported all three specs `stopped`** while 15 loops ran, so
  `spur agent stop <spec>` could not reach them.

**Re-verification (2026-10-05, against `65d6b3d92`):**

- **Duplicate serves — already fixed, dropped from this task.** Task 1082 (on `main` since 2026-10-04
  18:23, `38babd30b`/`04b442f56`) added `acquireProjectServerOwner`
  (`packages/app/src/services/project-server-owner.ts:10`, exclusive `.spur/server-owner.lock` with a
  pid-liveness stale reap) and `assertProjectServerAvailable` (`packages/app/src/services/project-start.ts:221`),
  both called before boot at `apps/server/src/serve.ts:699-700`; 1087 lets desktop attach instead of
  spawning. A second serve now refuses with `Project already has a server owner (pid N)`. The six serves
  predate that guard (started before it landed and kept running).
- **"status says stopped" — root cause is the server URL, not the registry.** The supervisor already
  registers every spawn (`supervisor-service.ts` `start()` → `this.processes.set`). But
  `agent status|stop|start|list --specs` default `--server` to a hard-coded
  `http://localhost:3000/api` (`apps/cli/src/commands/agent.ts:77`), while serve listens on the
  configured/allocated port (3004–3011 here). The CLI therefore queried the wrong port — unreachable, or
  worse, another project's serve on 3000 — and reported every spec `stopped`.
- **Orphans on crash — still real.** Graceful shutdown already reaps loops
  (`apps/server/src/serve.ts:836` `supervisor().stopAll()`), but a SIGKILLed/crashed serve leaves its
  children running: `agent loop` (`apps/cli/src/commands/agent.ts:326`, loop at
  `packages/app/src/services/agent-loop-service.ts:504`) only exits on SIGTERM/SIGINT or lost orchestrator
  ownership, and nothing ties its lifetime to the parent.

### Requirements

- [ ] R1. `spur agent status|stop|start` and `agent list --specs` target THIS project's live serve by
      default: resolve the port from the project registry entry for the cwd (the port serve registers via
      `projectRegistry.setPort`), falling back to `http://localhost:3000/api` only when no live entry
      exists; an explicit `--server` still wins.
- [ ] R2. A supervisor-spawned `agent loop` exits when its parent serve is gone: it captures `process.ppid`
      at start and aborts its loop signal when the parent changes, so a crashed/SIGKILLed serve cannot leave
      orphan loops.

### Acceptance Criteria

- [ ] AC1 — `spur agent status` run in a project whose serve listens on a non-default port reports that serve's live loops with their pids, and `spur agent stop <spec>` terminates them
- [ ] AC2 — After the parent serve is SIGKILLed, its `agent loop` children exit within one poll interval

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-05T13:50:42.075Z

- **Q: Keep the original R1 (refuse a second serve per project)?** A: No — delivered by 1082
  (`project-server-owner.ts`, `assertProjectServerAvailable`), with tests in
  `packages/app/tests/services/project-server-owner.test.ts`. Re-adding a `.spur/serve.json` marker would
  duplicate `.spur/server-owner.lock`.
- **Q: Keep the stale-marker reclamation and the `agent doctor` orphan finding (original R3/R4)?** A: No.
  With R2 the loop reaps itself on parent death, so there is no orphan population to reclaim or report.
  Revisit only if a spec's custom `config.command` process (not a spur loop, so not covered by R2) is
  observed orphaned.
- **Q: Why `ppid` polling instead of a process group kill?** A: Group kill needs the serve to still be
  alive to send it; a SIGKILLed serve sends nothing. `process.ppid` is re-read live in Bun (verified:
  child saw `99191 -> 1` after the parent was SIGKILLed), so the child can detect it alone.

### Design

**Serve discovery (R1).** Replace the `DEFAULT_SERVER` constant's role as the default with a resolver:
`ProjectRegistry.getByPath(cwd)` → if `entry.port > 0` use `http://127.0.0.1:<port>/api`, else
`http://localhost:3000/api`. Commander keeps `--server` without a default so an explicit value is
distinguishable; the resolver runs only when it is absent. `isPortLive` (`project-start.ts`) is not needed
here — an unreachable server already produces the existing "Cannot reach server" warning, which should now
name the resolved URL.

**Parent watch (R2).** In the hidden `agent loop` action (`apps/cli/src/commands/agent.ts:326`), next to
the existing SIGTERM/SIGINT wiring: capture `const parent = process.ppid`, start an unref'd interval
(≈ the loop poll interval) that calls `controller.abort()` when `process.ppid !== parent`, and clear it in
the existing `finally`. The loop already honors that signal (`agent-loop-service.ts:504-511`) and runs its
normal shutdown (claim release, member session reset).

No new marker files, daemon, transport, CLI noun/verb/flag, or doctor finding.

### Plan

1. Failure list first: (a) `agent status` with a registry entry on port N≠3000 queries port N;
   (b) explicit `--server` overrides the registry; (c) no entry → 3000; (d) an `agent loop` child exits
   after its parent is SIGKILLed.
2. R1 resolver in `apps/cli/src/commands/agent.ts` (status/stop/start/list --specs).
3. R2 parent watch in the `agent loop` action.
4. Docs in the same commit: the `agent status|stop` rows in `docs/04_DESIGN.md`/`cli-contracts` (default
   server resolution) and the supervision paragraph in `docs/03_ARCHITECTURE.md` (loop lifetime bound to
   serve).
5. Gates: `(cd apps/cli && bun test tests/commands/agent*.test.ts)`, then `bun run spur-check`.
6. E2E receipt: start `spur serve --port 3011` with one autostart spec, run `spur agent status --json`
   (live pid), `kill -9` the serve, confirm the loop pid is gone within one poll; record the transcript.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
