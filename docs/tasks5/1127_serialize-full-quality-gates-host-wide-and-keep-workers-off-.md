---
schema_version: 1
name: Serialize full quality gates host-wide and keep workers off the full gate
status: done
template: feature-impl
created_at: 2026-10-08T18:13:57.164Z
updated_at: "2026-10-09T00:50:34.997Z"
feature_id: H1

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1127-verdict.json
---

## 1127. Serialize full quality gates host-wide and keep workers off the full gate

### Background

Session review of the 2026-10-07/08 pi fleet (H15, P1, F91/E91, 1117-1120 runall sessions; transcripts under `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-10-07T22-4*.jsonl`, `2026-10-08T03-28*.jsonl`, `2026-10-07T17-5*.jsonl`) found no code-level event loop. The dominant runtime sink was **full-gate contention**: 3-4 drivers on one host each ran `bun run spur-check` (10.4k tests, 12-22 min each) at the same time, plus foreign `history import` jobs at 60-80% CPU.

Measured from transcript tool timestamps: 64 gate/poll runs >2 min, **43/64 overlapped another session's gate**; gate+poll time per session 54-169 min. Overlap produced subprocess-timeout load-flakes (different single test each run, all green alone: `display-plan`, `shell-guard`, `inline-run-trace`, `history-surface-freeze-check`, `workflow-run-from` 1072 AC4). Each flake triggered a test-fix hop that re-ran the full gate under a 30-min dispatch cap -> 3 worker timeouts (`Subagent timed out after 1800000ms`), fix-budget exhaustion, halted batches and operator "continue" prompts. Sessions even polled each other (`pgrep -f "bun test --reporter=dots"` loops of 10-20 min in the F91 session).

The isolation-rerun protocol at `plugins/sp/skills/spur-dev/references/cross-cutting.md:556` treats the symptom after the fact; nothing prevents the overlap.

**Evidence that workers ran the full gate (confirmed via `spur history`, 2026-10-08).** Imported pi rows (`.spur/spur.db` `history_tool_call`, `source='pi'`, `tool_name='subagent'`) show that the driver-written test-fix briefs told the child to re-run the full gate. This contradicts `plugins/sp/commands/dev-fixall.md:30` ("when `--gate-log` is set … run no full gate"):

- P1 session `2026-10-07T22-42-21-516Z_01a11888-32cc-751d-acbb-7806c33530f9`, seq 157/163: "Fix ONLY the import ordering … Re-run `bun run spur-check` from the repo root". The finding was a single Biome organize-imports error, yet the brief bought a 12-22 min gate inside a `timeoutMs: 1800000` dispatch.
- H15 session `2026-10-07T22-44-33-625Z_01a1188a-36d8-72ae-b267-dac37608899b`, seq 232: "execute its meaning: re-run the named gate command". The brief paraphrased `/sp:dev-fixall "bun run spur-check" --gate-log …`, and the paraphrase dropped the `--gate-log` → no-full-gate rule.

So the overlap had two sources: concurrent host gates across sessions, and child full gates inside dispatch caps. The pipeline YAML itself is safe here. `config/workflows/task-pipeline.yaml:113` notes that the soft quality-gate shell is unbounded by `stepTimeoutMs`, and the YAML test-fix hop (`task-pipeline.yaml:558`) passes `--gate-log`. The inline driver's natural-language brief is where the rule is lost.

**Current code.** `runQualityGate` (`packages/app/src/services/quality-gate.ts:598`) runs the full command via `runShellCommand` (`:576`, `spawnSync('sh', ['-c', cmd])`) in a retry loop that only retries on `isTransientLock` output (SQLite/bun lock text), up to `MAX_GATE_ATTEMPTS`. It has no cross-process coordination. The module is bundled into `plugins/sp/lib/quality-gate.generated.mjs` by `scripts/commands/bundle-plugin-lib.ts:513-533` (task 1006 R1). It is invoked through `plugins/sp/scripts/quality-gate.ts:61`, which the pipeline resolves as `.ts` (source-repo) or `.mjs` (installed) at `task-pipeline.yaml:501` and `:601`.

### Requirements

- [x] R1. Host-wide gate lock: in `runQualityGate` (`packages/app/src/services/quality-gate.ts:598`), wrap only the full-gate attempt loop (the `for (gateAttempt …)` block inside `if (gateRc === 0)` that calls `runShellCommand(env.qualityGateCmd …)`) in an exclusive lock. The lock lives at `$SPUR_GATE_LOCK_DIR`, default `~/.config/spur/run/full-gate.lock`, outside any project tree so worktrees and sibling checkouts share it. The claim records pid, start time, run id/wbs and cwd, using the atomic mkdir plus `pid-uuid` marker (`wx`) pattern from `packages/app/src/services/project-server-owner.ts:59-100`. Do not use `packages/domain/src/planning/locks.ts`, which is restricted to PlanningWriteService and has a 30 s TTL.
- [x] R2. Stale reclaim: a claim whose pid is dead (`process.kill(pid, 0)` throws `ESRCH`; reuse `isProcessAlive`, `project-server-owner.ts:30`) is reclaimed. A live holder is never broken, however long it has run, and there is no max wait.
- [x] R3. Queue visibility: when a waiter starts waiting it prints one line naming the holder (wbs/run id, cwd, elapsed), then polls every `SPUR_GATE_LOCK_POLL_MS` (default 5000). The gate receipt (`<wbs>-check-receipt.json`) and the gate log record `queueWaitMs` and `gateRuntimeMs` as separate fields, so wait never inflates gate runtime.
- [x] R4. Scope: the light gate, the deferred gate, `status`, the receipt-reuse path and the no-progress-skip path never take the lock.
- [x] R5. Opt-out: `SPUR_GATE_LOCK=off` disables locking entirely, for CI and single-agent hosts. The default is on.
- [x] R6. Re-entrancy: the holder exports `SPUR_GATE_LOCK_TOKEN=<marker>` to the gate child. A nested acquire whose env token matches the live claim proceeds without waiting, so a wrapped `spur-check` (R7) run under `runQualityGate` cannot self-deadlock.
- [x] R7. Repo `spur-check` uses the same lock: the `spur-check` package script routes its `bun run test` segment through `scripts/commands/gate-lock.ts -- <cmd>`, which reuses the R1 acquire/release exported from `packages/app`. This serializes a worker that calls `bun run spur-check` directly, outside `quality-gate.ts`, which is the P1/H15 pattern.
- [x] R8. Driver brief rule: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` states that a dispatched implement or test-fix child never runs the full gate. It runs only the changed-path matrix (`cross-cutting.md` § Changed-path targeted checks), and the host's next `test-recheck` is the deciding run. The brief carries `--gate-log <path>` verbatim and never paraphrases it as "re-run the named gate command".

### Acceptance Criteria

```gherkin
Scenario: AC1 — Two concurrent full gates on one host never overlap (req: R1, R3)
  Given two temp project dirs and a shared temp SPUR_GATE_LOCK_DIR
  And qualityGateCmd = 'echo start $(date +%s%N); sleep 3; echo end $(date +%s%N)'
  When `bun plugins/sp/scripts/quality-gate.ts run` starts in both dirs at the same time
  Then their start/end intervals do not overlap
  And the second run's gate log contains one holder line naming the first run's wbs and cwd

Scenario: AC2 — A dead holder is reclaimed within one poll interval (req: R2)
  Given a claim marker in SPUR_GATE_LOCK_DIR whose pid is not alive
  When a full gate runs with SPUR_GATE_LOCK_POLL_MS=200
  Then it acquires within 1 s and logs the reclaim with the dead pid

Scenario: AC3 — The receipt separates queue wait from gate runtime (req: R3)
  Given the AC1 run pair
  When both receipts are read
  Then the queued run has queueWaitMs >= 2500 and gateRuntimeMs < 5000
  And the first run has queueWaitMs < 1000

Scenario: AC4 — Opt-out restores unlocked behavior (req: R5)
  Given the AC1 setup with SPUR_GATE_LOCK=off
  When both runs start together
  Then their intervals overlap

Scenario: AC5 — A nested wrapper under the holder does not self-deadlock (req: R6, R7)
  Given a runQualityGate whose qualityGateCmd runs `bun scripts/commands/gate-lock.ts -- true`
  When the gate runs
  Then it completes with queueWaitMs < 1000 for the nested acquire

Scenario: AC6 — Light and status paths stay lock-free (req: R4)
  Given a full gate holding the lock (sleep 5)
  When `quality-gate.ts light` and `quality-gate.ts status` run in another dir
  Then each returns in under 2 s without printing a holder line

Scenario: AC7 — Brief rule, generated twin and contracts stay in sync (req: R7, R8)
  Given the implementation is complete
  When `bun run build:plugin-lib`, `bun run inline-pipeline-parity-check` and `(cd plugins/sp && bun test tests/quality-gate-receipt.test.ts tests/quality-gate.test.ts tests/skill-structure.test.ts)` run
  Then `git status --short` shows no new diff from regeneration, all checks pass, `inline-pipeline-driver.md` contains the R8 rule, and `package.json` `spur-check` routes `test` through gate-lock.ts
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-08T18:34:57.869Z

- **Host-wide vs per-repo lock?** Host-wide. The contention is CPU and IO on one machine: the 43/64 overlapping gates ran in different worktrees of the same repo, plus foreign `history import` jobs. A per-repo lock would miss sibling worktrees. `SPUR_GATE_LOCK_DIR` lets tests and unusual hosts relocate it.
- **Max wait / timeout on the lock?** None. The soft gate shell is unbounded by design (`task-pipeline.yaml:113`), and a waiting gate is cheaper than a load-flaked one. The holder line plus `queueWaitMs` make a long queue visible. Deferred: add a cap only if an observed queue exceeds about 1 h.
- **Why not reuse `planning/locks.ts`?** Its header restricts it to PlanningWriteService, and its 30 s TTL staleness would break a live 20-minute gate. PID liveness is the correct staleness signal for a long-held lock.
- **Why also wrap `spur-check` (R7)?** Workers called `bun run spur-check` directly (P1 seq 157/163). R8 fixes the brief, but a brief is prose, while the wrapper is mechanical for this repo. Other projects get R1 only, through `quality-gate.ts`.

### Design

- **New helper in `packages/app/src/services/quality-gate.ts`, next to `runShellCommand`.**
  - Exported `acquireGateLock(env, logLine): { release(): void; queueWaitMs: number }`.
  - Claim: `mkdirSync(lockDir)`, then `writeFileSync(join(lockDir, marker), JSON.stringify({pid, startedAt, wbs, runId, cwd}), {flag: 'wx'})`.
  - `marker = <pid>-<uuid>`.
  - On `EEXIST`: read the single marker. If its pid is dead, unlink marker and rmdir, and retry. If it is alive and `process.env.SPUR_GATE_LOCK_TOKEN === marker`, re-enter with a no-op release. Otherwise log the holder once and `gateSleep(pollMs)`.
  - `release` unlinks only its own marker, then rmdirs, ignoring `ENOENT`. This mirrors `project-server-owner.ts:73-83`, so a stale reaper never removes a replacement claim.
- **Call site.** In `runQualityGate`, inside `if (gateRc === 0) {`, before the attempt loop:
  - acquire;
  - set `SPUR_GATE_LOCK_TOKEN` on the child env (`runShellCommand` needs an `env` param, or set `process.env` for the synchronous `spawnSync` scope and restore it);
  - `try { loop } finally { release() }`.
- **Receipt.** Measure `queueWaitMs` around acquire, and take `gateRuntimeMs` from `Date.now()` after acquire. Add both to the receipt writer that already stamps `gateStartedAtMs` (`:617`).
- **Wrapper.** `scripts/commands/gate-lock.ts` parses `-- <cmd...>`, then acquire → `spawnSync` inherit → release → exit with the child's code. Edit `package.json` `spur-check` so the `bun run test` segment becomes `bun scripts/commands/gate-lock.ts -- bun run test`. Lint stays outside the lock because it is cheap.
- **Invariants.**
  - Release runs on every exit path (`finally`).
  - Light and deferred paths are untouched.
  - The plugin-standalone contract holds because the helper lives in `packages/app` and is bundled into the generated `.mjs`.
  - The `plugins/sp/scripts/quality-gate.ts` glue gains no new imports.
- **Blast radius.** Every `/sp:dev-run*` gate on the host. The opt-out exists for CI.
- **Explicit ceiling.** `# ponytail: single host-wide FIFO-less lock — waiters race on release; add a ticket queue only if starvation is observed`.
- **Test isolation (deadlock guard).** `bun run test` runs inside the R7 lock, and existing suites (`plugins/sp/tests/quality-gate.test.ts`, `quality-gate-receipt.test.ts`) call `runQualityGate`. A test that spawns with a scrubbed env would lose `SPUR_GATE_LOCK_TOKEN` and wait forever on the outer claim. The test preloads (`tests/setup.ts` and each workspace `bunfig.toml` preload) must therefore set `SPUR_GATE_LOCK_DIR` to a per-process temp dir unless a test sets it explicitly. Test gates then never touch the host lock.

### Plan

1. Write the AC1–AC6 E2E test first: `plugins/sp/tests/quality-gate-lock.test.ts`, using temp dirs, `SPUR_GATE_LOCK_DIR` and `sleep`-based commands. Confirm it fails.
2. Implement `acquireGateLock` and wire it into `runQualityGate` (R1–R6). Add the receipt fields `queueWaitMs` / `gateRuntimeMs`.
3. Add `scripts/commands/gate-lock.ts` and update the `package.json` `spur-check` (R7). Check placement against `docs/design/harness-surface-governance.md` §2 (ADR-130; `sp-script-placement`).
4. Add the R8 rule to `inline-pipeline-driver.md`, near the "Timeout boundary" paragraph (about `:643`) or the test-fix brief guidance. Mirror it in `cross-cutting.md` § Changed-path targeted checks if that is where the brief template lives.
5. Run `bun run build:plugin-lib`, then `bun run --filter @gobing-ai/spur build:bundle`, to regenerate `quality-gate.generated.mjs` and `apps/cli/plugins`.
6. Run focused tests, `bun run inline-pipeline-parity-check` and `bun run plugin-smoke`, then `bun run spur-check` once. That run itself goes through the lock, which proves R7 end to end.

### Solution

Host-wide full-gate serialization with worker re-entrancy, implemented in the gate core
(`packages/app/src/services/quality-gate.ts`) and surfaced through the plugin gate script bundle.

- `acquireGateLock` / `GateLock` (`packages/app/src/services/quality-gate.ts:720`): one `mkdir`
  claim per holder under `SPUR_GATE_LOCK_DIR` (default `~/.config/spur/run/full-gate.lock`); claim
  JSON `{pid, startedAt, wbs, runId, cwd}`; marker `<pid>-<uuid>`.
- **Ownership is verified, not inferred** (review P2-1,
  `packages/app/src/services/quality-gate.ts:774`): after the marker write the holder re-reads the
  dir and holds only while the dir at that path is still the one its own `mkdir` created (dir
  identity, never "my mkdir returned success"). A creator whose dir was reclaimed and recreated
  underneath it withdraws its marker and retries, so two gates can never hold at once even when the
  mkdir→marker window is preempted. Regression proof: `AC1b`
  (`plugins/sp/tests/quality-gate-lock.test.ts:130`) fails with that check removed — "the creator
  held the lock from inside a foreign live claim".
- Live holder → one operator-facing wait line naming wbs/run/pid/cwd/held-time (AC1), then blocking
  poll (`SPUR_GATE_LOCK_POLL_MS`, default 5s; `Bun.sleepSync`, `Atomics.wait` fallback).
- Dead holder → claim reclaimed with the dead pid logged (AC2). Lost-claim races (`ENOENT`, and
  Darwin's `EINVAL` for the same interleaving) retry after a 20ms sleep so a pathological streak
  cannot hot-spin, and the waiter says so on the log after 250 consecutive losses
  (`packages/app/src/services/quality-gate.ts:647`, review P3-2). Pid-reuse liveness is a documented,
  accepted residual (`packages/app/src/services/quality-gate.ts:663`, review P4).
- Receipts carry `queueWaitMs=<n> gateRuntimeMs=<n>` on the summary line and in receipt fields
  (AC3); light and status modes never acquire the lock (`plugins/sp/tests/quality-gate-lock.test.ts:268`
  covers both, AC6); the gate child re-enters via `SPUR_GATE_LOCK_TOKEN` exported at spawn — no wait
  behind its own parent (R6/AC5); `SPUR_GATE_LOCK=off` disables everything (AC4).
- Re-entrancy plumbing: Bun does not propagate `process.env` mutations to `spawnSync` children, so
  the token rides in an explicit `extraEnv` merged over `{...getEnvVars()}` in `runShellCommand`
  (`packages/app/src/services/quality-gate.ts:600`); without it the gate child deadlocked on its own
  parent's claim.

**Worker keeps off the full gate (R7):** `package.json:88-89` routes the `spur-check` **and**
`spur-check-new` (`bun run test` hop) through `scripts/commands/gate-lock.ts:1`, which acquires the
same host-wide lock and runs the command under it — so a worker calling `bun run spur-check`
directly and the pipeline gate serialize instead of overlapping. The wrapper releases in `finally`,
supports `--` passthrough (Bun strips it, Node keeps it — argv normalized), and pairs with the
`tests/setup.ts` per-process lock-dir isolation plus the R8 driver-doc note in
`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`.

**Verification (all green):** E2E 7/7 — AC1–AC6 plus the AC1b ownership regression
(`plugins/sp/tests/quality-gate-lock.test.ts`; AC5 nested re-entry < 1s); focused unit
`packages/app/tests/services/quality-gate.test.ts` + `scripts/commands/gate-lock.test.ts`;
`script-contract-check` PASS (plugin twin regenerated); `bun run plugin-smoke` PASS; biome + 8
workspace typechecks clean; full `bun run spur-check` green (10572 tests) with the lock active.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/quality-gate.ts:720-806` — `export function acquireGateLock` claims with `mkdirSync(dir)` then `writeFileSync(..., { flag: 'wx' })` at `:734` using marker `<pid>-<uuid>`; `gateLockDir()` at `:667-669` defaults to `~/.config/spur/run/full-gate.lock` (homedir, outside every project tree) with `SPUR_GATE_LOCK_DIR` override; claim JSON `{pid, startedAt, wbs, runId, cwd}` at `:727-733`; no import of `packages/domain/src/planning/locks.ts` anywhere in the file. Call site `:938-971` opens only inside `if (gateRc === 0)` and releases in `finally` at `:971`. Executed: `(cd plugins/sp && bun test tests/quality-gate-lock.test.ts)` → AC1 + AC1b pass, 7 pass / 0 fail, 46 expect() calls, 34.57s. |
| R2 | MET | `packages/app/src/services/quality-gate.ts:685-691` — signal-0 probe returning false only on `ESRCH` (EPERM fails closed as live); reclaim path `:811-831` logs `reclaimed stale claim (pid …)` at `:826` then unlinks the dead marker and removes the dir; acquisition loop is `for (;;)` with no deadline or max wait. Executed: AC2 in `plugins/sp/tests/quality-gate-lock.test.ts:202` passes on a real exited pid (`reclaimed stale claim (pid <deadPid>)` + gate ran after reclaim). |
| R3 | MET | `packages/app/src/services/quality-gate.ts:821` prints exactly one holder line naming `wbs`, `runId`, `pid`, `cwd` and held-time (guarded by `holderLogged`, `:819-822`); poll interval `gateLockPollMs()` at `:672-675` defaults to `GATE_LOCK_POLL_MS_DEFAULT = 5_000` (`:637`) with `SPUR_GATE_LOCK_POLL_MS` override; separate receipt fields declared at `:254-255` (comment `:214-216`) and written at `:1033-1034`. Executed: AC1 and AC3 pass (`plugins/sp/tests/quality-gate-lock.test.ts:103`, `:230`); AC3 reads both on-disk receipts and asserts exactly one `queueWaitMs >= 2500`, one `< 1000`, and every `gateRuntimeMs` from the 3s sleep. |
| R4 | MET | `packages/app/src/services/quality-gate.ts:899-905` (PASS receipt reuse) and `:918-922` (no-progress skip) both return/set `gateRc = 1` before the lock, and `:938` is the only acquire site, reached only when `gateRc === 0`; probe at `:926-932` also precedes it; light/deferred/status are separate mode branches above. Executed: AC6 (`plugins/sp/tests/quality-gate-lock.test.ts:266`) runs `quality-gate.ts light` and `quality-gate.ts status` beside a live full-gate holder; both exit 0 in under 2s with no holder line. |
| R5 | MET | `packages/app/src/services/quality-gate.ts:634` declares `GATE_LOCK_OFF_ENV = 'SPUR_GATE_LOCK'`; `:721-722` returns a no-op `{ release(){}, queueWaitMs: 0, token: '' }` when it equals `off`, so the default (unset) is locking on. Executed: AC4 (`plugins/sp/tests/quality-gate-lock.test.ts:339`) with `SPUR_GATE_LOCK=off` on two concurrent runs — intervals overlap and neither log contains a holder or reclaim line; AC1 (no `SPUR_GATE_LOCK` set) serializes, proving the on-by-default path. |
| R6 | MET | `packages/app/src/services/quality-gate.ts:813-816` — a waiter whose `SPUR_GATE_LOCK_TOKEN` equals the live claim marker returns immediately with a no-op release; the holder exports it at `:948-949` (`setEnvVar`) and passes it explicitly as `extraEnv` to the gate child at `:956` (Bun does not propagate `process.env` mutations to `spawnSync`), restoring the previous value at `:970`. Executed: AC5 (`plugins/sp/tests/quality-gate-lock.test.ts:307`) runs a gate whose command is the R7 wrapper; log shows `gate-lock: acquired in <1000ms` and no holder line. |
| R7 | MET | `package.json:88-89` routes the `bun run test` segment of both `spur-check` and `spur-check-new` through `bun scripts/commands/gate-lock.ts -- bun run test` (lint stays outside the lock); `scripts/commands/gate-lock.ts:19` imports `acquireGateLock` from `packages/app/src/services/quality-gate.ts`, acquires at `:29` and releases in `finally` at `:43-44`, exiting with the child's code. Executed: `(cd scripts && bun test commands/gate-lock.test.ts)` → 3 pass / 0 fail; the AC5 E2E exercises the wrapper under a live holder. |
| R8 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:643-655` (new block, `git diff` verified) states implement and test-fix workers never run the full gate, run only the changed-path matrix, and that `--gate-log <path>` is carried through verbatim with the explicit "never paraphrase it into 're-run the named gate command'" rule. Requirement content confirmed by reading the diff, not by the task file's claim. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Two concurrent full gates on one host never overlap (req: R1, R3) | MET | test | `plugins/sp/tests/quality-gate-lock.test.ts:103` drives the shipped `plugins/sp/scripts/quality-gate.ts run` entrypoint as two concurrent processes over one shared `SPUR_GATE_LOCK_DIR`; asserts disjoint start/end intervals, exactly one `waiting for holder` line across both logs, the line names the first run's wbs and `realpathSync` cwd, and the queued log carries `queueWaitMs=<n>`. Executed: pass (7 pass / 0 fail, 34.57s). |
| Scenario: AC2 — A dead holder is reclaimed within one poll interval (req: R2) | MET | test | `plugins/sp/tests/quality-gate-lock.test.ts:202` — a real exited pid (`sh -c 'echo $$; exit 0'`) writes the claim, the run completes exit 0 with `SPUR_GATE_LOCK_POLL_MS=300`, and the log contains `reclaimed stale claim (pid <deadPid>)` followed by the gate's own `start` stamp. Executed: pass. |
| Scenario: AC3 — The receipt separates queue wait from gate runtime (req: R3) | MET | test | `plugins/sp/tests/quality-gate-lock.test.ts:230` reads both on-disk `<wbs>-check-receipt.json` files: exactly one has `queueWaitMs >= 2500`, the other `< 1000`, every `gateRuntimeMs < 5000`, and the summary log line `quality gate lock: queueWaitMs=<n> gateRuntimeMs=<n>` matches the receipt field values (`packages/app/src/services/quality-gate.ts:1033-1034`, `:240`). Executed: pass. |
| Scenario: AC4 — Opt-out restores unlocked behavior (req: R5) | MET | test | `plugins/sp/tests/quality-gate-lock.test.ts:339` — two concurrent runs with `SPUR_GATE_LOCK=off` (handled at `packages/app/src/services/quality-gate.ts:721-722`) have overlapping intervals and neither log contains `waiting for holder` or `reclaimed stale claim`. Executed: pass. |
| Scenario: AC5 — A nested wrapper under the holder does not self-deadlock (req: R6, R7) | MET | test | `plugins/sp/tests/quality-gate-lock.test.ts:307` — `qualityGateCmd` is `bun scripts/commands/gate-lock.ts -- echo gate-lock-nested-ok`; the run exits 0, the nested marker prints, and `gate-lock: acquired in <N>ms` with N < 1000 with no holder line. Executed: pass. |
| Scenario: AC6 — Light and status paths stay lock-free (req: R4) | MET | test | `plugins/sp/tests/quality-gate-lock.test.ts:266` — a full-gate holder (3s sleep) is live while `quality-gate.ts light` and `quality-gate.ts status` run in other dirs; each exits 0 in under 2000ms wall and its log has no holder line, while the holder itself still exits 0. Executed: pass. |
| Scenario: AC7 — Brief rule, generated twin and contracts stay in sync (req: R7, R8) | MET | command | Executed this run: `bun scripts/commands/script-contract-check.ts` → "21 script(s) baselined (20 standard, 1 repo-only), 0 violation(s) — PASS"; `bun run inline-pipeline-parity-check` → "ok (11 actions, 4 guards agree across 9 workflows and both reference sets)"; `(cd plugins/sp && bun test tests/quality-gate-receipt.test.ts tests/quality-gate.test.ts)` → 29 pass / 0 fail; `(cd plugins/sp && bun test tests/skill-structure.test.ts)` → 91 pass / 0 fail; `grep -n "gate-lock" package.json` → `:88-89` route `bun run test` through `scripts/commands/gate-lock.ts`; `grep -n "never run the full gate" plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` → `:643`. Twin content confirmed at `plugins/sp/lib/quality-gate.generated.mjs:350-360` and `plugins/sp/scripts/quality-gate.mjs`. Note (observe-only run): literal `bun run build:plugin-lib` regeneration was not re-executed because it rewrites tracked artifacts; twin freshness rests on the two executed contract checks plus the twin content anchors above. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Parent context: session review 2026-10-08 of pi sessions P1 `…01a11888-32cc…`, H15 `…01a1188a-36d8…`, F91/E91 `…01a1188a-c284…`, batch `…01a1198d-e0d1…`, in `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/`. They are imported in `.spur/spur.db`; query with `bun run apps/cli/src/index.ts history analyze --source pi --session <file-stem> --json`.
- Code: `packages/app/src/services/quality-gate.ts:576,598,617`; `packages/app/src/services/project-server-owner.ts:30,59-100`; `plugins/sp/scripts/quality-gate.ts:20,61`; `scripts/commands/bundle-plugin-lib.ts:513-533`.
- Workflow: `config/workflows/task-pipeline.yaml:113-117` (stepTimeoutMs semantics), `:501`, `:558` (test-fix hop with `--gate-log`), `:601`.
- Docs: `plugins/sp/commands/dev-fixall.md:30`; `plugins/sp/skills/spur-dev/references/cross-cutting.md:556` (isolation-rerun protocol for load-flakes); `inline-pipeline-driver.md` § Timeout boundary.
- Related: 1128 (bootstrap size), 1129 (commit guard), 1131 (history fidelity, needed to re-measure gate overlap from history instead of by hand).

### History

- 2026-10-08T18:35:26.555Z backlog → todo (system)
- 2026-10-09T00:50:19.805Z wip → testing (system)
- 2026-10-09T00:50:34.993Z testing → done (system)

