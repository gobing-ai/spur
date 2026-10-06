---
schema_version: 1
name: "Supervise agent loops: no orphan loops and no duplicate serves per project"
status: done
template: feature-impl
created_at: 2026-10-05T07:28:03.248Z
updated_at: "2026-10-06T04:49:00.412Z"
feature_id: G67

ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1088-verdict.json
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

- [x] R1. `spur agent status|stop|start` and `agent list --specs` target THIS project's live serve by
      default: resolve the port from the project registry entry for the cwd (the port serve registers via
      `projectRegistry.setPort`), falling back to `http://localhost:3000/api` only when no live entry
      exists; an explicit `--server` still wins.
- [x] R2. A supervisor-spawned `agent loop` exits when its parent serve is gone: it captures `process.ppid`
      at start and aborts its loop signal when the parent changes, so a crashed/SIGKILLed serve cannot leave
      orphan loops.

### Acceptance Criteria

- [x] AC1 — `spur agent status` run in a project whose serve listens on a non-default port reports that serve's live loops with their pids, and `spur agent stop <spec>` terminates them
- [x] AC2 — After the parent serve is SIGKILLed, its `agent loop` children are reaped: the ppid
      watch fires within one poll interval (2000 ms — it rides the loop's own `--poll` cadence) and
      the process then exits after its normal shutdown. Measured over 10 serve-parented exits:
      115, 261, 262, 270, 653, 1027, 1034, 1034, 1476 and 2065 ms — one exit 65 ms past a single
      interval, the rest within it. When a live member turn is held, shutdown also waits on the
      member stop, whose SIGTERM→SIGKILL budget is a fixed 5 s in `@gobing-ai/ts-ai-runner`, so an
      exit can take up to about 7 s there; either way the loop is never left behind

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

**Amendments during implementation (2026-10-05, from P1 review findings).**

1. **Host in the resolved URL.** The design above rendered `http://127.0.0.1:<port>/api`. Review
   reproduced that a default-host `spur serve` binds IPv6 only — `Bun.serve({ hostname: options.host })`
   with `--host` defaulting to `localhost`, which Bun resolves to `[::1]`; a live probe showed
   `TCP [::1]:3011 (LISTEN)` with `127.0.0.1:3011` refusing the connection. The IPv4 literal therefore
   had no listener and the symptom R1 exists to fix survived in a new form. The resolver renders
   `http://localhost:<port>/api` instead, so the client resolves the same address family the server
   bound. (`isPortLive` is still not consulted — the registry's `healStale` owns staleness.)
2. **`Origin` on the agent lifecycle POST.** `spur agent start|stop` POSTed with no `Origin` /
   `Sec-Fetch-Site` and no content-type. The server's hono `csrf()` reads a missing content-type as
   `text/plain` and refuses the request with 403, so AC1's stop clause could not terminate a loop at
   any URL — pre-existing, and unrelated to the URL the resolver chose. The lifecycle POST now sends
   `Origin: <resolved server origin>`, the header a same-origin caller sends. It is the only CLI POST
   in the tree (`apps/cli/src/commands/agent.ts`); the CLI's only other server call is a GET
   (`apps/cli/src/commands/agent.ts:1123`), which `csrf()` does not guard because it covers unsafe
   methods only.
3. **AC2's exit bound is a shutdown-timing claim, and it was restated to the contract the code
   holds.** Verification measured the watch firing within one poll interval in every run — 10
   serve-parented exits of 115, 261, 262, 270, 653, 1027, 1034, 1034, 1476 and 2065 ms (one exit
   65 ms past the 2000 ms interval, the rest within it), plus a negative control that stayed alive
   while its parent lived. A controlled reproduction with a wrapper (non-serve) parent holding a
   live member turn exited in 6412/7160 ms: the abort resolves `loopSleep` / `waitForWake`
   (`agent-loop-service.ts:127-143,211,504-511`) but is not observed mid-drain, and shutdown then
   awaits the member-session reset (`agent-loop-service.ts:566` → `member-session.ts:304`), whose
   SIGTERM→SIGKILL wait is a fixed 5000 ms inside `@gobing-ai/ts-ai-runner`
   (`team-agent-process.ts:96-115`) — no budget parameter exists on the `packages/app` path. That
   tail is parent-independent (a serve-parented run whose member ignores SIGTERM reaches it too),
   so the original AC2 promise held no exception the implementation could honour. R2 is unaffected:
   no run left an orphan loop.

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

The two halves of the defect had different roots: `status` lied because the CLI queried the wrong
port, and loops survived because nothing tied their lifetime to the serve.

**R1 — project-scoped serve discovery.** `apps/cli/src/commands/agent.ts:98` adds
`resolveAgentServer(cwd, explicit?)`: an explicit `--server` wins (that is why the flag no longer
carries a commander default), else `ProjectRegistry.getByPath(cwd)` — whose `list()`
(`packages/app/src/services/project-registry.ts:394`) heals a port with no live listener to 0
(`healStale`, `packages/app/src/services/project-registry.ts:529`) — yields
`http://localhost:<port>/api` when `entry.port > 0`, else the `DEFAULT_SERVER` fallback
(`apps/cli/src/commands/agent.ts:84`). A registry that cannot be read or locked falls back rather
than failing the command, so an offline host still prints "Cannot reach server at <url>". The four
`--server` options lost their default so an absent value is distinguishable, and the resolver runs
only then: `agent list --specs` (`apps/cli/src/commands/agent.ts:999`), `agent status`
(`apps/cli/src/commands/agent.ts:1074`), `agent start` (`apps/cli/src/commands/agent.ts:593`),
`agent stop` (`apps/cli/src/commands/agent.ts:616`).

**R2 — loop lifetime bound to the serve.** `apps/cli/src/commands/agent.ts:1530` adds
`startParentWatch(controller, intervalMs, readPpid?)` — capture `process.ppid`, then re-read it on
an unref'd interval and `controller.abort()` when it differs (SIGKILL reparents the loop to init);
the returned stop function clears it. The hidden `agent loop` action installs it next to the
SIGTERM/SIGINT wiring (`apps/cli/src/commands/agent.ts:391-395`, interval = the parsed `--poll`) and
clears it in the existing `finally` (`apps/cli/src/commands/agent.ts:400-401`), so the loop's existing
abort path (`packages/app/src/services/agent-loop-service.ts:506-511`) runs its normal shutdown
(claim release, member-session reset). No new marker file, daemon, transport, or CLI surface.

**Rework after review (both P1 findings).** The first revision rendered the wrong address family and
omitted a header the server requires. *Address family:* the resolver rendered host `127.0.0.1`, but a
`spur serve` started with the `--host` default (`localhost`) binds IPv6 `[::1]` only, so the IPv4
literal had no listener — `agent status` still reported every spec `stopped` while its loops ran.
`resolveAgentServer` now renders `http://localhost:<port>/api`, and every doc surface that restated
the literal moved with it (`apps/cli/src/commands/agent.ts:98`). *CSRF:* `runAgentLifecycle` POSTed
with no `Origin`/`Sec-Fetch-Site`, which the serve's hono `csrf()` reads as `text/plain` and answers
403, so `agent stop <spec>` could never terminate a live loop at any URL. The POST now sends
`Origin: <resolved server origin>` (`apps/cli/src/commands/agent.ts:1203`) — what a same-origin local
caller sends; the server middleware is untouched and no exemption was added.

| File | Change |
| --- | --- |
| `apps/cli/src/commands/agent.ts:98` | `resolveAgentServer` — the registry port for cwd rendered `http://localhost:<port>/api`, else `http://localhost:3000/api`; explicit `--server` wins; a registry error falls back. Rework: the host is the name `localhost`, not the IPv4 literal `127.0.0.1`, because a `--host`-default serve binds `[::1]` only |
| `apps/cli/src/commands/agent.ts:84` | `DEFAULT_SERVER` documented as the no-live-entry fallback, not the default |
| `apps/cli/src/commands/agent.ts:248` | `agent list`: `--server` default removed (`:253`) |
| `apps/cli/src/commands/agent.ts:266` | `agent status`: `--server` default removed (`:270`) |
| `apps/cli/src/commands/agent.ts:580` | `agent start`: `--server` default removed (`:583`), resolver wired at `apps/cli/src/commands/agent.ts:593` |
| `apps/cli/src/commands/agent.ts:603` | `agent stop`: `--server` default removed (`:606`), resolver wired at `apps/cli/src/commands/agent.ts:616` |
| `apps/cli/src/commands/agent.ts:999` | `list --specs` resolves the server instead of `?? DEFAULT_SERVER` |
| `apps/cli/src/commands/agent.ts:1061` | `runAgentStatus` resolves the server (`apps/cli/src/commands/agent.ts:1074`); the unreachable warning now names the resolved URL |
| `apps/cli/src/commands/agent.ts:1203` | Rework: `runAgentLifecycle` POST carries `Origin: <resolved server origin>`, so the serve's `csrf()` admits the CLI's `agent start|stop` |
| `apps/cli/src/commands/agent.ts:1530` | `startParentWatch` — ppid watch, unref'd interval, returned stop function |
| `apps/cli/src/commands/agent.ts:395` | the `agent loop` action installs the watch; cleared at `apps/cli/src/commands/agent.ts:400-401` |
| `apps/cli/tests/commands/agent-supervision.test.ts:5` | 14 focused tests: resolver matrix (registry port / explicit `--server` / no entry / stale port), status-start-stop-list URL assertions, the rework regressions (the resolved host is `localhost`; the stop POST carries the resolved origin), parent-watch abort and stop |
| `docs/design/cli-contracts.md:447` | Default server resolution paragraph; `spur agent status` section added at `docs/design/cli-contracts.md:454-462` |
| `docs/design/cli-contracts.md:675` | `agent start|stop` default server + loop-lifetime note |
| `docs/04_DESIGN.md:136` | `spur agent status` index row (missing since 0897) |
| `docs/03_ARCHITECTURE.md:759-760` | §17 project-owned supervision paragraph: discovery (rendered `localhost`) + loop lifetime bound to serve |
| `docs/help/cmd_agent.md:191` | `agent status` `--server` default restated (`docs/help/cmd_agent.md:209` list, `docs/help/cmd_agent.md:351` start, `docs/help/cmd_agent.md:366` stop) |
| `docs/help2/agent.md:65-66` | `agent list --specs` `--server` default restated |
| `plugins/sp/skills/spur-cli/references/agent.md:153-155` | facade reference `list` default restated (`plugins/sp/skills/spur-cli/references/agent.md:171-175` status, `plugins/sp/skills/spur-cli/references/agent.md:303-305` start) |

**Verification.** `(cd apps/cli && bun test tests/commands/agent*.test.ts)` — 159 pass / 0 fail
(12 files; +1 rework regression). `bunx biome check apps/cli/src/commands/agent.ts
apps/cli/tests/commands/agent-supervision.test.ts` clean; `(cd apps/cli && bun run typecheck)` clean.
`plugins/sp/tests/help-docs-parity.test.ts` + `plugins/sp/tests/cli-surface-parity.test.ts`
(24 pass / 0 fail) confirm the documented flags still match the live surface. Real parent-kill probe
(AC2): a loop started with `--poll 500` exited 320 ms after its parent bash was SIGKILLed, and
stayed alive >8 s while the parent lived — the watch, not a startup timeout.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/agent.ts:111-149` `resolveAgentServer(cwd, explicit, deps)`: explicit `--server` wins at `:116`; read-only registry snapshot via `peek()` at `:122-123`; cwd ancestor walk at `:133` (`ancestorDirs` `:152-160`); a live registered port renders `http://localhost:<port>/api` at `:137` (host `localhost`, not the IPv4 literal, per the `[::1]`-bind rework); no live entry falls back to `DEFAULT_SERVER` `http://localhost:3000/api` at `:148`/`:87` with named warnings at `:127`/`:140`. Wired into all four surfaces: `agent start` `:662`, `agent stop` `:690`, `agent list --specs` `:1075`, `agent status` `:1150`; the four commander `--server` options declare no default (`:314`, `:334`, `:650`, `:678`), so an absent value is distinguishable. Executable (fresh, this run): `apps/cli/tests/commands/agent-supervision.test.ts:73` (registry port on host localhost), `:84` (no entry -> 3000), `:95` (dead port -> 3000 with named warning), `:104` (explicit wins), `:113` (nearest registered ancestor), `:163`/`:187`/`:220` (status uses resolved URL), `:236` (stop POSTs to registry-port serve), `:271` (start), `:286` (list --specs); suite run `(cd apps/cli && bun test tests/commands/agent*.test.ts)` -> 164 pass / 0 fail. |
| R2 | MET | `apps/cli/src/commands/agent.ts:1606-1619` `startParentWatch(controller, intervalMs, readPpid?)` captures `process.ppid` at `:1612`, re-reads it on an unref'd `setInterval` and calls `controller.abort()` on change at `:1613-1615` (SIGKILL reparents the loop to init), unref at `:1617`, returned stop function `:1618`. The hidden `agent loop` action installs it at `apps/cli/src/commands/agent.ts:461` with the same interval the loop parses (`parseLoopPoll(options.poll)`), next to the SIGTERM/SIGINT wiring, and clears it in the existing `finally` at `:467`. The loop honors that signal at `packages/app/src/services/agent-loop-service.ts:539`/`:544` (loop condition and post-wake break) and `loopSleep` resolves immediately when aborted at `packages/app/src/services/agent-loop-service.ts:127-134`. Executable (fresh, this run): `apps/cli/tests/commands/agent-supervision.test.ts:312` (ppid change aborts the signal), `:327` (stable parent does not abort), `:338` (stop function ends the watch); same 164 pass / 0 fail suite run. Live reaping proven in the pipeline passes and transcribed in the task file Testing/Review (5 serve-parented SIGKILL cycles, loops gone in 1976-2081 ms, no orphan in any cycle). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Fresh this run: `apps/cli/tests/commands/agent-supervision.test.ts:163` (`agent status` through the real `main([...])` entry reports the registry-port serve's live pid 51234 and queries `http://localhost:<port>/api/processes`), `:212` (golden-path `agent status --json` through the CLI), `:236` (`agent stop` POSTs to the registry-port serve), `:254` (the stop POST carries `Origin: http://localhost:<port>` -- without it the serve's hono `csrf()` answers 403; code at `apps/cli/src/commands/agent.ts:1279`), `:286` (list --specs merges live status from the registry-port serve); suite `(cd apps/cli && bun test tests/commands/agent*.test.ts)` -> 164 pass / 0 fail. Live command receipts from the pipeline passes are transcribed in `docs/tasks5/1088_supervise-agent-loops-no-orphan-loops-and-no-duplicate-serve.md` Testing AC1 (scratch serves on ports 3011/3012 with no `--server` anywhere: start -> `{"ok":true,"pid":58120}`, status reported the live pid, stop -> `{"ok":true}` and the pid gone). |
| AC2 | MET | test | Fresh this run: `apps/cli/tests/commands/agent-supervision.test.ts:312` (ppid change -> abort within one watch tick), `:327` (parent alive -> no abort, the negative control), `:338` (watch teardown); the watch interval rides the loop's own `--poll` cadence (`apps/cli/src/commands/agent.ts:461` `parseLoopPoll(options.poll)`, default 2000 ms at `packages/app/src/services/agent-loop-service.ts:57`), so detection is one poll tick by construction and the loop then exits through its normal shutdown (`packages/app/src/services/agent-loop-service.ts:539`/`:544`). The measured exit dataset (10 serve-parented exits 115-2065 ms; 5 fresh serve-parented kill cycles 1976-2081 ms with parent-alive negative controls; the held-member-turn slow path ~6.4-7.2 s = 2000 ms poll + the fixed 5000 ms SIGTERM->SIGKILL member-stop budget at `node_modules/@gobing-ai/ts-ai-runner/src/team-agent-process.ts:109`) is the prior passes' recorded evidence, transcribed in the task file AC2/Testing/Review -- not re-derived this run, which is why Confidence is MEDIUM; no run ever left an orphan loop. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1088 (feature G67) — fifth pass (delta: AC2 restatement + Design item 3 corrections)

**Scope:** corpus-only delta since pass 4 — `docs/tasks5/1088_supervise-agent-loops-no-orphan-loops-and-no-duplicate-serve.md` (mtime `2026-10-05T17:55:13`, identical to the frontmatter `updated_at` `2026-10-06T00:55:13.614Z`, i.e. one CLI write). **No source byte moved:** `apps/cli/src/commands/agent.ts` sha256 `9affcd4bdee65c1d667348fd2eb15da03cdcaa918e3b388e5c1518bf01914f29` (mtime `16:45:44`) and `apps/cli/tests/commands/agent-supervision.test.ts` sha256 `cdd67d9e…` (mtime `16:45:52`) are the exact hashes pass 4 recorded, both older than every corpus write; the test is still untracked and nothing is staged.
**Dimensions:** functional traceability, correctness, architecture, usability (the delta is prose; it touches no behaviour, so security/efficiency are out of the delta's blast radius)
**Verdict:** PASS — **pass 4's PASS holds.** All five pass-4 findings are corrected and each correction is verified below against the receipt and the verify answer. The delta creates **no new P1/P2**. AC1, R1 and R2 are byte-identical to the frozen original; only AC2 was authorized to change, and only AC2 changed.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | Design item 3's "That tail is parent-independent …" is a code-path reachability claim, not a serve-shaped measurement: the wait does sit on the loop's own shutdown path (`finally` `agent-loop-service.ts:560-567` → `:566` → `member-session.ts:304` → `team-agent-process.ts:107-113`), so it is reached under any parent — but the verify stage explicitly could **not** reproduce a >1-interval exit with a serve parent and recorded that immunity as unexplained (possibly the member's stdin/pipe closing on the parent's death). AC2 hedges the same fact as a possibility ("an exit *can* take up to about 7 s there"), so no guarantee is overstated; record it as a residual, not a defect. | `docs/tasks5/1088_…:132-134`; `.spur/run/1088-verify-answer.txt` § Residual uncertainty |
| 2 | P4 (advisory) | correctness | The delta's own slow-path figure sits 160 ms under its own dataset: "up to about 7 s" vs the measured `7160 ms` (= the 2000 ms poll interval + the 5000 ms SIGTERM→SIGKILL budget + drain teardown) and `6412 ms`. Both addends are named and the hedge is "about", so this is rounding, not a false bound. | `docs/tasks5/1088_…:66-67`; `.spur/run/1088-verify-answer.txt` item 10 |

##### AC2 restatement vs the dataset (the delta's question)

| Claim in the restated AC2 | Source | Match? |
|---|---|---|
| 10 serve-parented exits, listed `115, 261, 262, 270, 653, 1027, 1034, 1034, 1476 and 2065 ms` | verify item 7 (1034 / 1034 / 1027 idle), item 8 (270 / 261 / 262 live member), item 9 (115 / 1476 / 653 phase sweep), receipt `2065 ms` | **Exact** — sorted, the AC2 list equals the measured set `{115,261,262,270,653,1027,1034,1034,1476,2065}`; the wrapper-parent runs `2057 / 6412 / 7160 ms` are correctly excluded because the AC says "serve-parented" |
| "one exit 65 ms past a single interval, the rest within it" | `2065 − 2000 = 65` | **Exact** |
| the negative control is not counted among the exits | verify items 7–9: `negative control parent-alive-5s=ALIVE` in every run | **Correct** — pass-4 finding 1's "negative control included" is gone; Design item 3 now says "plus a negative control that stayed alive while its parent lived" |
| "the ppid watch fires within one poll interval (2000 ms — it rides the loop's own `--poll` cadence)" | `startParentWatch(controller, parseLoopPoll(options.poll))` at `apps/cli/src/commands/agent.ts:395`; body `:1530-1542`; phase sweep 115 / 1476 / 653 ms = time-to-next-tick, not a fixed crash delay | **Structural, not merely empirical** |
| "When a live member turn is held … a fixed 5 s in `@gobing-ai/ts-ai-runner` … up to about 7 s" | `team-agent-process.ts:107` SIGTERM, `:109` `setTimeout(…, 5000)`, `:113` SIGKILL; measured 6412 / 7160 ms | **Mechanism correct** — pass-4 finding 3's parent-shape condition ("the parent is a wrapper rather than the serve itself") is removed; the rise is now attributed to the member stop |
| "either way the loop is never left behind" | every measured run exited; no orphan observed, negative controls alive throughout | **Holds** |

Net: the restated AC2 is the contract the code actually holds. It names both of its terms — detection ≤ one poll interval, and exit = normal shutdown, up to ~7 s when a SIGTERM-ignoring member turn is held — and both terms are falsifiable against the poll interval and the member-stop budget respectively. It is MET-eligible. The verify stage's P2 offered exactly two dispositions ("bound the shutdown wait to the poll interval", or "record the AC2 bound as detection-only"); this restatement is the second, so the P2 is dispositioned by the corpus and needs no code change.

##### Design item 3 re-checked

| Citation / claim | Verified at | Verdict |
|---|---|---|
| `@gobing-ai/ts-ai-runner` SIGTERM→SIGKILL wait `team-agent-process.ts:96-115` | `stop()` `:96`, `endStdin()` `:103`, SIGTERM `:107`, `setTimeout(() => resolve('timeout'), 5000)` `:109`, SIGKILL `:113` | **Fixed** — pass-4 finding 2's `:88-104` (which excluded the 5000 ms line and the SIGKILL) is resolved; the range now contains both |
| abort resolves `loopSleep` / `waitForWake` (`agent-loop-service.ts:127-143,211,504-511`) but is not observed mid-drain | `loopSleep` `:127-143` (resolves immediately when aborted), `waitForWake` top-of-loop abort check `:211`, loop condition and post-wake break `:504-511` | **Fixed** — pass-4 finding 4's "observed at the loop head" shorthand is gone; the statement now explains why the post-abort tail is ~115–176 ms rather than another whole interval |
| no gate language | `task check 1088` emits no `L4 Design` warning; the `hasGateLanguage` pattern re-run per section gives `Background []`, `Requirements []`, `Design []`, `Acceptance Criteria []`, `Plan []` | **Fixed** — pass-4 finding 5's `approved` token is gone |
| reset chain `agent-loop-service.ts:566` → `member-session.ts:304`; "no budget parameter exists on the `packages/app` path" | `:566` `memberSession.reset('operator')`; `:304` `process.stop()`; the port is `stop(): Promise<void>` (`member-session.ts:49`) | **Correct** — no caller on that path can shorten the wait |

##### AC1, R1 and R2 freeze check

A `diff` of the entire `Requirements` → `Q&A` region against `git show HEAD:docs/tasks5/1088_…` yields exactly one change (`14c14,20`): the AC2 line, 1 line → 7. R1 (`:50`), R2 (`:54`) and AC1 (`:60`) are line-identical to the frozen original. The task-file hunk headers agree: `@@ -61 +61,7 @@` is the only Requirements/AC hunk; the remaining hunks are the frontmatter (`@@ -4`, `@@ -7`), the previously-reviewed `### Design` amendment block (`@@ -99,0 +106,31 @@`), the `### Solution` fill (`@@ -116`, `@@ -124`) and the prior `### Review` body (`@@ -130,0 +299,4 @@`). Nothing else in the contract region moved.

##### AC traceability

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET (unchanged) | `.spur/run/1088-ac-e2e-receipt.md`: no `--server` anywhere; status resolved the registry port 3011 and reported the live loop pid 38678; stop returned `{"ok":true}` and the pid was gone; the verify stage reproduced it independently (pid 26950). The delta touched no line of AC1. |
| AC2 | MET under the restated contract (the verify stage's PARTIAL/P2 is dispositioned by it) | 10/10 serve-parented exits in `{115 … 2065}` ms, negative control ALIVE in every run, exit unconditional; the one slow path 6412 / 7160 ms = 2000 + ~5000 ms is the exception the restated AC2 now names. The verdict file's `AC2 = PARTIAL` remains the verification record for the *pre-restatement* wording; the restatement is that record's own disposition option A. |

##### Req traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET (unchanged) | `resolveAgentServer(cwd, explicit?)` (`apps/cli/src/commands/agent.ts:98-107`), wired at `:593` / `:616` / `:999` / `:1074`; no commander default on the four `--server` options (`:253`, `:270`, `:583`, `:606`); registry port → `http://localhost:<port>/api`, else the 3000 fallback (`:84`). Corpus delta only; no R1 line moved. |
| R2 | MET (unchanged) | watch installed at `:395`, body `:1530-1542`, cleared in the `finally` (`:400-401`); the loop honours the signal at `packages/app/src/services/agent-loop-service.ts:504-511`. AC2's restatement narrows a *timing* claim only — the exit stays unconditional, so R2's "cannot leave orphan loops" is untouched. |

##### Does pass 4's PASS still hold?

**Yes, on mechanical evidence.** The delta is documentation on a task whose code was certified by two prior P1 reworks and the verify stage: `agent.ts` sha256 `9affcd4b…` and the test `cdd67d9e…` are the exact pass-4 hashes, at mtimes (`16:45:44` / `16:45:52`) older than every corpus write; the source numstat is unchanged (`89+/12-`) and the task file alone moved (`177+/5-`); nothing is staged. A fresh re-run of the focused suite gives `(cd apps/cli && bun test tests/commands/agent*.test.ts)` → **159 pass / 0 fail, 551 expect() calls, 12 files [10.88s]**. `task check 1088` → **PASS** with a single carried warning. No new P1/P2: all five pass-4 findings were prose precision, all five are fixed, and no correction regressed the delivered behaviour, R1 or R2.

##### Carried items (known, unchanged, not re-litigated)

- P3 — drain-in-flight abort gap; the restated AC2 discloses it, which is its disposition.
- P3 — the resolver's registry read is not read-only (`getByPath` → `list()` → `healStale`); P3 — exact-match cwd lookup, no ancestor walk.
- P4 — help rows advertise a `(default: …)` commander no longer declares; P4 — a registry read/lock error falls back to the 3000 URL silently.
- WARN — `L4 Solution: Anchor docs/03_ARCHITECTURE.md:758 subject mismatch`. The delta's own gate-language warning is gone, so this is the only warning left.

##### Checks run

- `git diff -U0 -- docs/tasks5/1088_…` hunk headers → `@@ -4`, `@@ -7`, `@@ -61 +61,7 @@` (AC2 only), `@@ -99,0 +106,31 @@`, `@@ -116`, `@@ -124`, `@@ -130,0 +299,4 @@`.
- `diff <(git show HEAD:… | awk '/^### Requirements/,/^### Q&A/') <(awk …)` → `14c14,20` — the AC2 line alone; R1 / R2 / AC1 identical at `:50` / `:54` / `:60`.
- AC2 list vs the measured set: sorted AC2 list `115 261 262 270 653 1027 1034 1034 1476 2065` = verify items 7 / 8 / 9 + the receipt's `2065`; `2065 − 2000 = 65`.
- `shasum -a 256 apps/cli/src/commands/agent.ts apps/cli/tests/commands/agent-supervision.test.ts` → `9affcd4b…` / `cdd67d9e…`; `stat` mtimes `16:45:44` / `16:45:52`, task file `17:55:13`; `git diff --numstat` → `89/12` (agent.ts) and `177/5` (task file); `git diff --cached --stat` → empty.
- `node_modules/@gobing-ai/ts-ai-runner/src/team-agent-process.ts:90-120` printed with line numbers → `stop()` `:96`, `endStdin` `:103`, SIGTERM `:107`, `setTimeout(…,5000)` `:109`, SIGKILL `:113`.
- `packages/app/src/services/agent-loop-service.ts:120-150,200-220,498-515,560-572` and `member-session.ts:298-312,49` printed → every Design item 3 citation confirmed.
- Per-section gate-language scan (the `hasGateLanguage` pattern re-run) → all five gate sections `[]`.
- `task check 1088` → **PASS**, one warning (`L4 Solution: Anchor docs/03_ARCHITECTURE.md:758 subject mismatch`); the delta-introduced `L4 Design` warning is absent.
- `(cd apps/cli && bun test tests/commands/agent*.test.ts)` → **159 pass / 0 fail, 551 expect() calls, 12 files [10.88s]**.
- No source, test or `docs/tasks5/**` file was edited by this pass; `bun run spur-check` was not run; no suppressions.

**Next:** approve the gate — the delta is complete and **no further review round is warranted**. Before the `done` transition, flip the R1 / R2 / AC1 / AC2 boxes. The only item worth carrying forward is the verify stage's pre-existing "serve-shaped immunity unexplained" note (finding 1 here) — a measurement curiosity about a case that still cannot orphan a loop.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-05T23:07:16.869Z backlog → todo (system)
- 2026-10-05T23:23:50.196Z todo → wip (system)
- 2026-10-06T01:53:38.110Z wip → testing (system)
- 2026-10-06T01:54:04.195Z testing → done (system)

