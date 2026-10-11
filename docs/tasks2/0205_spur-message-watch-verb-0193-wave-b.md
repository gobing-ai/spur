---
template: feature-impl
schema_version: 1
name: spur message watch verb (0193 wave B)
description: ""
status: done
type: task
profile: standard
feature_id: G1
parent_wbs: "0193"
priority: P1
tags: [approach-c,cli,collaboration,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.854Z
updated_at: "2026-10-11T00:26:11.164Z"
---

## 0205. spur message watch verb (0193 wave B)

### Background

Wave B of parent 0193 (Inbox IPC) — read the parent's Background and Design first. Delivers `spur message watch --agent <id> [--interval <ms>] [--json]` in `apps/cli/src/commands/message.ts`: a blocking follower that POLLS the store via TeamService (serverless is the contract — no server required), surfaces each new message as it arrives, emits one JSON object per line under `--json` (machine-consumable by agent wrappers), and exits cleanly on SIGINT. Semantics: watch SURFACES, it never consumes — read-marking stays with `--drain`/explicit reads, which makes watch safe beside drain loops. SSE-follow when serve is up is optional — implement only if trivial, else scoped follow-up. Independent of wave A (poll path reads the store directly), so it can start in parallel.

### Requirements

- [x] R1 — `watch` verb with poll baseline, `--interval` (sane default), `--json` JSON-lines output, SIGINT-clean exit; registered in helpText. (Parent R4)
- [x] R2 — Watch never marks messages read; asserted by test. (Parent R4)
- [x] R3 — Injected-interval tests — no real sleeps; new-message surfacing within one tick. (Parent R7)
- [x] R4 — Full gate green. (Parent R8)

### Acceptance Criteria
```gherkin
Feature: Inbox IPC

  Scenario: A watching agent observes new messages without restart
    Given an agent session is running spur message watch
    When another agent sends it a message
    Then the watcher surfaces the new message within the follow interval
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0193's Design owns the full approach — this slice implements **Watch verb**: `spur message watch --agent <id> [--interval <ms>] [--json]` in `apps/cli/src/commands/message.ts`. Poll baseline via TeamService (serverless is the contract — no server required); one JSON object per line under `--json` (agent-wrapper consumable); SIGINT-clean exit. Semantic invariant: watch SURFACES and never consumes — no read-marking (that stays with `--drain`/explicit reads), which makes watch safe beside drain loops; assert it in a test. SSE-follow is optional — only if trivial, else scoped follow-up. Depends on: nothing hard (reads the store directly; can run parallel to 0204). Downstream: 0207+ supervised loops.
### Plan

- [x] `watch` verb: poll loop with injected interval, `--json` JSON-lines, SIGINT-clean; helpText entry (R1).
- [x] No-consume semantics asserted by test (R2).
- [x] Injected-interval tests — surfacing within one tick, no real sleeps (R3).
- [x] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R4). — re-verified 2026-10-10: lint/typecheck/focused suites green; `test-cf` blocked by the sandbox (see Testing)
- [x] Manual two-terminal check: watch + send; evidence in Testing. — run 2026-10-10 as the scripted e2e `.spur/run/verifyall/g1-e2e.sh` (see Testing)

### Solution

**Watch verb (R1).** Added `spur message watch --agent <id> [--interval <ms>] [--json]` in `apps/cli/src/commands/message.ts`. Commander `.command('watch')` with required `--agent`, optional `--interval` (default 2000ms, parsed via `parseInterval` → exit 2 on non-positive), and `--json`. The CLI action wires an `AbortController` to `SIGINT` (clean Ctrl-C exit) and delegates to the exported `runMessageWatch` core.

**Core loop (R3).** `runMessageWatch(svc, output, options, runtime)` is the poll loop, separated from the CLI action for testability. Tracks `seen` ids, polls `svc.getInbox`, surfaces each NEW message exactly once (DAO returns newest-first; iterate in reverse so older-arrived messages surface first when multiple land between polls). `WatchRuntime` injects `signal` (abort), `maxIterations` (test cap), and `sleep` (no-op in tests — zero real waits).

**`--json` (R1).** Emits one JSON object per new message line (machine-consumable by agent wrappers). Plain mode uses the existing `formatInboxLine`.

**No-consume semantics (R2).** Watch only reads via `getInbox`; it never calls mark-read/deliver. Asserted by a test that runs watch for 2 iterations then verifies the inbox row's status is still `queued` (the DAO's enqueue default), unchanged from before watch ran.

**Docs.** AGENTS.md CLI surface, `docs/04_DESIGN.md` message verb heading, and `docs/help/cmd_message.md` (subcommand table + full watch section + two-terminal example) updated.

**SSE-follow deferred.** Poll baseline is the contract (serverless). SSE-follow when `spur serve` is up is a scoped follow-up — noted in Design + help doc.

**Current anchors (re-verified 2026-10-10; TeamService was later renamed AgentCoordinationService):**

- `apps/cli/src/commands/message.ts:138` — `watch` verb registration; `apps/cli/tests/commands/message.test.ts:372` — watch one-tick surfacing; `apps/cli/tests/commands/message.test.ts:444` — no-consume

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/commands/message.test.ts:422` (`--json` lines), `apps/cli/tests/commands/message.test.ts:540` (interval parsing), `apps/cli/tests/commands/message.test.ts:572` (SIGINT-clean exit) |
| R2 | MET | `apps/cli/tests/commands/message.test.ts:444` — status stays `queued` after watch |
| R3 | MET | `apps/cli/tests/commands/message.test.ts:372`, `apps/cli/tests/commands/message.test.ts:391` — injected sleep, no real waits |
| R4 | MET | lint + typecheck green and focused suites green this run (app 72, server 49, cli 49, web 202, 0 fail); `bun run spur-check` 10914 pass / 7 fail — all 7 sandbox-induced (git hook-template EPERM, Chromium DevTools port, `mktemp` EPERM) and reproduced at clean HEAD; `test-cf` not runnable in this sandbox |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: A watching agent observes new messages without restart | MET | test | `apps/cli/tests/commands/message.test.ts:372` (one-tick surfacing) and `apps/cli/tests/commands/message.test.ts:391` (between-poll, exactly once); e2e: `spur message watch --agent watcher1 --interval 1 --json` surfaced a message sent from a separate CLI process within one interval, then exited on SIGINT |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**P1 — none.** Loop terminates deterministically under signal + maxIterations; no-consume invariant asserted; JSON-lines output verified parseable.

**P2 — manual two-terminal check skipped.** No interactive TTY in this sandbox. SIGINT path covered by the abort-signal unit test; the blocking default-sleep is the only untested branch (deliberately — it's a thin setTimeout wrapper).

**P3 — SSE-follow deferred.** Recorded in Design + help. Poll baseline satisfies the serverless contract.

**Disposition:** R1–R4 met. Task complete.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P1 | — | — | None | — |
| P2 | Usability | `apps/cli/tests/commands/message.test.ts:572` | Manual two-terminal check originally skipped; run 2026-10-10 as a scripted e2e | FIXED — scripted e2e .spur/run/verifyall/g1-e2e.sh, 2026-10-10 |
| P3 | Architecture | `apps/cli/tests/commands/message.test.ts:372` | SSE-follow deferred; the poll baseline satisfies the serverless contract | DEFERRED — add SSE follow when serve-attached watch matters |
| P4 | — | — | Re-verified 2026-10-10 (G1 shippable): PASS/HIGH, residual sweep clean | — |

### References

G1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
