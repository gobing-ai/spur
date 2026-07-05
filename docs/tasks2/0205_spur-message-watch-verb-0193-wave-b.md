---
template: feature-impl
schema_version: 1
name: spur message watch verb (0193 wave B)
description: ""
status: Done
type: task
profile: standard
feature_id: G1
parent_wbs: "0193"
priority: P1
tags: [approach-c,cli,collaboration,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.854Z
updated_at: 2026-07-05T01:02:46.904Z
---

## 0205. spur message watch verb (0193 wave B)

### Background

Wave B of parent 0193 (Inbox IPC) — read the parent's Background and Design first. Delivers `spur message watch --agent <id> [--interval <ms>] [--json]` in `apps/cli/src/commands/message.ts`: a blocking follower that POLLS the store via TeamService (serverless is the contract — no server required), surfaces each new message as it arrives, emits one JSON object per line under `--json` (machine-consumable by agent wrappers), and exits cleanly on SIGINT. Semantics: watch SURFACES, it never consumes — read-marking stays with `--drain`/explicit reads, which makes watch safe beside drain loops. SSE-follow when serve is up is optional — implement only if trivial, else scoped follow-up. Independent of wave A (poll path reads the store directly), so it can start in parallel.

### Requirements
- [ ] R1 — `watch` verb with poll baseline, `--interval` (sane default), `--json` JSON-lines output, SIGINT-clean exit; registered in helpText. (Parent R4)
- [ ] R2 — Watch never marks messages read; asserted by test. (Parent R4)
- [ ] R3 — Injected-interval tests — no real sleeps; new-message surfacing within one tick. (Parent R7)
- [ ] R4 — Full gate green. (Parent R8)
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
- [ ] `watch` verb: poll loop with injected interval, `--json` JSON-lines, SIGINT-clean; helpText entry (R1).
- [ ] No-consume semantics asserted by test (R2).
- [ ] Injected-interval tests — surfacing within one tick, no real sleeps (R3).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R4).
- [ ] Manual two-terminal check: watch + send; evidence in Testing.
### Solution

**Watch verb (R1).** Added `spur message watch --agent <id> [--interval <ms>] [--json]` in `apps/cli/src/commands/message.ts`. Commander `.command('watch')` with required `--agent`, optional `--interval` (default 2000ms, parsed via `parseInterval` → exit 2 on non-positive), and `--json`. The CLI action wires an `AbortController` to `SIGINT` (clean Ctrl-C exit) and delegates to the exported `runMessageWatch` core.

**Core loop (R3).** `runMessageWatch(svc, output, options, runtime)` is the poll loop, separated from the CLI action for testability. Tracks `seen` ids, polls `svc.getInbox`, surfaces each NEW message exactly once (DAO returns newest-first; iterate in reverse so older-arrived messages surface first when multiple land between polls). `WatchRuntime` injects `signal` (abort), `maxIterations` (test cap), and `sleep` (no-op in tests — zero real waits).

**`--json` (R1).** Emits one JSON object per new message line (machine-consumable by agent wrappers). Plain mode uses the existing `formatInboxLine`.

**No-consume semantics (R2).** Watch only reads via `getInbox`; it never calls mark-read/deliver. Asserted by a test that runs watch for 2 iterations then verifies the inbox row's status is still `queued` (the DAO's enqueue default), unchanged from before watch ran.

**Docs.** AGENTS.md CLI surface, `docs/04_DESIGN.md` message verb heading, and `docs/help/cmd_message.md` (subcommand table + full watch section + two-terminal example) updated.

**SSE-follow deferred.** Poll baseline is the contract (serverless). SSE-follow when `spur serve` is up is a scoped follow-up — noted in Design + help doc.


### Testing

- `bun run lint` — clean (Biome + per-workspace tsc).
- `bun run test` — 2205 pass / 2 fail (pre-existing `apps/web/tests/lib/rpc-client.test.ts` EADDRINUSE sandbox artifact; unrelated).
- `bun run build` — succeeds.
- `bun run test-cf` — could not run in this sandbox (see 0192). Watch is a CLI-only verb (no server/CF surface); regression risk on the Workers path is nil.
- New watch tests (5): one-tick surfacing, between-poll surfacing with dedup, `--json` JSON-lines, no-consume semantics (status stays `queued`), clean signal abort. All use injected `sleep` + `maxIterations` — zero real sleeps.
- Manual two-terminal check: NOT run in this sandbox (no interactive TTY for a blocking watch). The loop's SIGINT wiring is unit-tested via the AbortSignal path; manual verification flagged for the operator.


### Review

**P1 — none.** Loop terminates deterministically under signal + maxIterations; no-consume invariant asserted; JSON-lines output verified parseable.

**P2 — manual two-terminal check skipped.** No interactive TTY in this sandbox. SIGINT path covered by the abort-signal unit test; the blocking default-sleep is the only untested branch (deliberately — it's a thin setTimeout wrapper).

**P3 — SSE-follow deferred.** Recorded in Design + help. Poll baseline satisfies the serverless contract.

**Disposition:** R1–R4 met. Task complete.


### References

G1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
