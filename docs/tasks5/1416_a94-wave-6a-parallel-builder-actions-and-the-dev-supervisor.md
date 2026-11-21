---
schema_version: 1
name: "A94 wave 6a: parallel builder actions and the dev supervisor"
status: done
template: feature-impl
created_at: 2026-11-20T20:46:27.786Z
updated_at: "2026-11-21T00:04:47.700Z"
feature_id: A94

done_forced: "false"
done_reason: unforced close
---

## 1416. A94 wave 6a: parallel builder actions and the dev supervisor

### Background

A94 wave 6a (split from 1414 at the operator's direction after the host-probe coverage ceiling): the dev supervisor and the parallel `builder.actions` form. The `agent doctor-hosts` half stays in 1414.

Implements: R2, R3 (parallel half), R4 (parallel half) of A94. Design authority: docs/design/downstream-tooling-absorption.md §2/§4 and docs/design/sdlc-actions.md.

Carried work: the reverted wave-6 implementation is parked at `.spur/run/1414-wip/` (parallel-supervisor + its tests, config schema edits described in the session learnings).

### Requirements

- [x] R1. `builder.actions.<name>` accepts `{parallel: string[] (≥2 shell commands), graceMs?: int > 0 (default 3000)}`. Load-time validation names `builder.actions.<name>` for a blank entry, fewer than 2 entries, or an entry that is an action name. `apps/cli/schemas/spur-config.schema.json` carries the same shape (oneOf branch).
- [x] R2. `spur self exec <name>` on a parallel group starts each entry (through `sh -c`) in its own process group; a received SIGINT/SIGTERM/SIGHUP, the first child exit, or a spawn error runs one shutdown: SIGTERM to every group, an unconditional `graceMs` wait, SIGKILL, then the verb reports that code. Exit code is the first-exiting child's (`128+signo` when signal-killed).
- [x] R3. `packages/app/src/services/sdlc-actions.ts` gains `kind: 'parallel'` (`commands`, `graceMs`); `--list` renders `cmd1 & cmd2 (parallel)` and `--json` adds `parallel`/`graceMs`. `packages/app/src/services/quality-gate.ts` treats a parallel binding as its `&`-joined command.
- [x] R4. `.spur/config.yaml` defines `actions.dev.parallel` (server + web); `scripts/commands/dev-all.ts` and its heavy test are gone, `dev-all` is RETIRED to `spur self exec dev`; the heavy test moves to `apps/cli/tests/commands/self/exec-parallel.heavy.test.ts` and passes in seconds.

### Acceptance Criteria

- [x] AC1 — Dev supervisor runs configured processes downstream (req: R1, R2, R4)
- [x] AC2 — Parallel binding is a first-class action form (req: R1, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT/WHY.** The dev supervisor becomes configuration, not a repository script: a `{parallel, graceMs}` binding runs several long-lived commands under one owner, so any Spur project supervises its own dev processes with the same signal and exit contract.

**WHERE (frozen).**
- `packages/config/src/index.ts`: `ParallelActionSchema` (strict `{parallel: string[].min(2), graceMs?: int>0}`), unioned into `BuilderActionValueSchema`; the load-time validator refuses blank entries, fewer than 2, and action-name entries.
- `apps/cli/schemas/spur-config.schema.json`: the same shape as a third `oneOf` branch.
- `packages/app/src/services/sdlc-actions.ts`: `ResolvedAction` gains `kind: 'parallel'` (`commands: string[]`, `graceMs: number`).
- `packages/app/src/services/parallel-supervisor.ts`: new; `superviseParallel({commands, cwd, graceMs, env, onChildEvent, onExit})` returns `{exited, stop, stopping}` and never calls `process.exit`.
- `apps/cli/src/commands/self/exec.ts`: dispatches `kind: 'parallel'`, awaits `exited`, reports the code.
- `.spur/config.yaml`: `actions.dev.parallel` = the server + web dev commands.
- Tests: `packages/app/tests/services/parallel-supervisor.test.ts` (unit), `apps/cli/tests/commands/self/exec-parallel.heavy.test.ts` (signals/exit through a real runner process).

**Anti-patterns.** No `dev` noun; no action-name entries; no `process.exit` inside the service; no second-signal escalation.

### Plan

- [x] 1. Schema: `ParallelActionSchema` + validator + JSON schema branch. (R1)
- [x] 2. `resolveAction` parallel kind, `--list` rendering, quality-gate projection. (R3)
- [x] 3. `parallel-supervisor.ts` with the bounded shutdown and exit contract; `self exec` dispatch. (R2)
- [x] 4. `.spur/config.yaml` actions.dev.parallel; delete `dev-all.ts` + heavy test; RETIRED entry; inventory. (R4)
- [x] 5. Tests + gate: unit (in-process) and heavy (runner process) cover the supervisor; receipt at `.spur/run/1416-receipt.md`. (all)

### Solution

**WHAT.** `builder.actions.<name>` gained a `{parallel: string[], graceMs?}` form that `spur self exec` runs under one supervisor, and the repository's own dev topology became that binding (`spur self exec dev`), retiring `scripts/dev-all.ts`.

**WHY.** A downstream project runs several long-lived dev processes but had no way to describe them; the only supervisor lived in a repository script with repository paths.

**Change map** (one anchored row per file):

| Area | Anchor | Change |
| --- | --- | --- |
| config schema | packages/config/src/index.ts:1081 | `ParallelActionSchema` unioned into the action value; validator refuses blank/nested/too-few entries |
| JSON schema | apps/cli/schemas/spur-config.schema.json:378 | third `oneOf` branch for the parallel object |
| supervisor | packages/app/src/services/parallel-supervisor.ts:60 | owned process groups, bounded SIGTERM→grace→SIGKILL, exit contract, no `process.exit` |
| action resolution | packages/app/src/services/sdlc-actions.ts:76 | `kind: 'parallel'` with `commands`/`graceMs` |
| gate projection | packages/app/src/services/quality-gate.ts:768 | a parallel binding renders as its `&`-joined command |
| transport | apps/cli/src/commands/self/exec.ts:69 | parallel dispatch, args refusal, `--list`/`--json` rendering |
| barrier | packages/app/src/index.ts:1500 | exports the supervisor and its types |
| repo config | .spur/config.yaml:104 | `actions.dev.parallel` = server + web |
| dispatcher | scripts/spur-dev.ts:112 | `dev-all` RETIRED to `spur self exec dev` |
| boundary rule | config/rules/strict/runtime-boundaries.yaml:35 | recorded spawn exemption (detached groups) |
| design doc | docs/design/sdlc-actions.md:1 | parallel form: schema, signals, exit codes, `--list` |
| unit tests | packages/app/tests/services/parallel-supervisor.test.ts:1 | first-exit, idempotent stop, spawn failure, received signal |
| unit tests | packages/app/tests/services/sdlc-actions.test.ts:200 | parallel resolution + 3000 ms default |
| heavy tests | apps/cli/tests/commands/self/exec-parallel.heavy.test.ts:1 | real runner process: clean/failure/child-signal/parent-signal/missing-command |
| transport tests | apps/cli/tests/commands/self/exec.test.ts:266 | dispatch, args refusal, `--list` row |
| inventory | docs/reports/A94-script-ownership.json:1 | `dev-all` entries removed |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/config/src/index.ts:1080` `ParallelActionSchema` and its validator |
| R2 | MET | `packages/app/src/services/parallel-supervisor.ts:58` `superviseParallel`; `apps/cli/tests/commands/self/exec-parallel.heavy.test.ts` |
| R3 | MET | `packages/app/src/services/sdlc-actions.ts:82` `kind: 'parallel'`; `apps/cli/src/commands/self/exec.ts:68` |
| R4 | MET | Re-verify (2026-11-20) found `dev-all` removed from the dispatcher without the required RETIRED pointer (exit 1 "unknown command"). Fix pass added `'dev-all': 'spur self exec dev'` at `scripts/spur-dev.ts:101`; `bun scripts/spur-dev.ts dev-all` now prints the pointer and exits 2 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R12 — Dev supervisor runs configured processes downstream | MET | test | `apps/cli/tests/commands/self/exec-parallel.heavy.test.ts` (in `test:heavy`, feature verification pass) |
| AC2 — Parallel binding is a first-class action form | MET | test | `packages/app/tests/services/sdlc-actions.test.ts:200` (15/15 pass, 2026-11-20: `{parallel, graceMs}` resolves to the parallel kind and lists as such); `apps/cli/tests/commands/self/exec.test.ts:266` (26/26 pass: `spur self exec dev` reports `parallel: 2`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-20T20:51:13.918Z backlog → wip (system)
- 2026-11-20T21:31:16.057Z wip → testing (system)
- 2026-11-20T21:31:17.343Z testing → done (system)

