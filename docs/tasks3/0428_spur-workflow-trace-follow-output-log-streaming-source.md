---
template: feature-impl
schema_version: 1
name: "spur workflow trace --follow --output log-streaming source"
description: ""
status: done
type: task
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: ["workflow", "cli", "trace", "log", "follow"]
dependencies: ["0426"]
created_at: "2026-08-04T17:25:04.939Z"
updated_at: "2026-08-05T02:12:11.231Z"
---

## 0428. spur workflow trace --follow --output log-streaming source

### Background

Feature D2 — real-time following of the consolidated run log. Extends `spur workflow trace <run-id> --follow` with a log-streaming source: `--output` tails `.spur/run/<RUNID>.log` (tail -f equivalent) and exits at terminal status. Operator-settled: extend `trace --follow`, no new `monitor` verb. The structured DB timeline remains the default; `--output` is a distinct source, not an interleaving. Updates its own `spur-cli` workflow reference row (ADR-038 parity).

Implements: R8 — spur workflow trace RUNID --follow streams the all-in-one log in real time.

Rubric: E2 D1 L2 C1 R0 = 6 → decompose (child of parent score 14).

### Requirements
- [x] R1. `spur workflow trace <run-id> --follow --output` streams `.spur/run/<RUNID>.log` and exits at terminal status.
- [x] R2. `--output` requires `--follow` and is rejected with `--json` (a human stream).
- [x] R3. The structured DB timeline remains the default follow source; `--output` is a distinct source and does not interleave with it.
- [x] R4. No new `spur workflow monitor` verb is added.
- [x] R5. Update the `spur-cli` workflow reference trace signature (ADR-038 parity test must pass).
### Acceptance Criteria
```gherkin
Feature: spur workflow trace --follow --output log-streaming source

  @core
  Scenario: R8 — spur workflow trace RUNID --follow streams the all-in-one log in real time
    Given an active workflow run with a written RUNID.log and the persisted run state
    When the operator runs spur workflow trace RUNID --follow
    Then the follower streams new log lines from RUNID.log as the run progresses
    And no new spur workflow monitor verb exists
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
## Approach

Extend `spur workflow trace <run-id> --follow` with a **log-streaming source**
flag `--output`. When set, the follower tails `.spur/run/<RUNID>.log`
(tail -f equivalent) and exits when the run reaches a terminal status. The
structured DB timeline remains the default `--follow` source; the two sources
do not interleave. No new `monitor` verb.

## Chosen design

1. **CLI flag** — `.option('--output', 'With --follow: stream .spur/run/<RUNID>.log instead of the DB timeline')`
   on `workflow trace` in `apps/cli/src/commands/workflow.ts`.
2. **Validation**
   - `--output` without `--follow` → error exit 2 (source only meaningful under follow).
   - `--output` with `--json` → error (human stream; same rule as `--follow` today).
   - `--output` without `run-id` → error (same as `--follow requires a run-id`).
3. **Follower** — new exported helper `followRunLog(runId, dir, pollMs, write, wait?, isTerminal?)`
   colocated with `followTrace` in `workflow.ts`:
   - Resolve path `join(cwd, '.spur/run', `${runId}.log`)`.
   - If missing at start: poll until the file appears or the run is terminal
     (mirror `followTrace`'s "Run not found" retry window).
   - Stream new bytes/lines as they land (read from last offset; prefer line
     buffering so partial lines are not flushed mid-chunk).
   - Poll run status via `service.trace(runId)` (or a thin status lookup) using
     the same terminal predicate as `isTerminalTraceStatus`; on terminal, drain
     remaining bytes once and exit.
4. **Do not interleave** — when `--output` is set, skip `followTrace` entirely;
   never mix DB timeline lines into the log stream.
5. **ADR-038 parity** — same-change update of the spur-cli workflow reference
   trace signature.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| New `spur workflow monitor` verb | Explicitly rejected by operator (D2 Notes). |
| Interleave DB timeline + log | Operator settled: distinct source, not a merge. |
| FSEvents / inotify watcher | Overkill; poll interval already exists (`--poll`); portable. |
| `--raw` alias only | Design doc names `--output`; keep one flag. |

## Invariants

- Human stream only — rejects `--json` (existing `--follow` contract).
- Best-effort: if the log file never appears (e.g. run used `--no-log`),
  surface a clear message after terminal status rather than hanging forever.
- Does not modify the log file; read-only tail.

## Surfaces touched

| Surface | Change |
|---|---|
| `apps/cli/src/commands/workflow.ts` | `--output` option; validation; branch to `followRunLog` |
| `apps/cli/tests/commands/workflow.test.ts` | follow+output streams; rejects without --follow / with --json |
| `plugins/sp/skills/spur-cli/references/workflows.md` | Trace signature + follow examples (ADR-038) |
### Plan
- [x] Add `.option('--output', …)` on `workflow trace`.
- [x] Validate: `--output` requires `--follow` + `run-id`; rejects `--json` (exit 2).
- [x] Implement `followRunLog` (offset tail + terminal-status exit) next to `followTrace`.
- [x] Wire the follow branch: `--output` → `followRunLog`; else existing `followTrace`.
- [x] Handle missing log file: poll/retry, then clear message if run ends with no log (e.g. `--no-log`).
- [x] Tests: streams appended lines; exits on terminal; validation errors for illegal flag combos.
- [x] Update `plugins/sp/skills/spur-cli/references/workflows.md` trace signature + examples (ADR-038).
- [x] Gate: `bun run lint` + targeted CLI tests green.
### Solution
Implemented `spur workflow trace --follow --output` as a log-streaming follow source (R1–R5).

- `apps/cli/src/commands/workflow.ts:562` — added `.option('--output', …)` on the `trace` command (R1).
- `apps/cli/src/commands/workflow.ts:588-597` — validation: `--output` requires `--follow` (exit 1); `--output` rejects `--json` (exit 1, human stream) (R2). `--follow --output` without a run-id is caught by the shared `--follow requires a run-id` rule.
- `apps/cli/src/commands/workflow.ts:604-608` — follow branch: `--output` → `followRunLog`; else existing `followTrace`. The two sources never interleave (R3).
- `apps/cli/src/commands/workflow.ts:821` — new exported `followRunLog(service, runId, dir, pollMs, write, wait?)` tails `.spur/run/<RUNID>.log` read-only (offset-based), polls run status via `service.trace(runId)` with the same `isTerminalTraceStatus` predicate, and exits at terminal status. Best-effort: if the log never appears (e.g. run started with `--no-log`), prints a clear message at `:849` rather than hanging.
- `apps/cli/src/commands/workflow.ts:789` — new private `readRunLogChunk(logPath, offset)` reads only complete lines since the offset and holds back a trailing partial line until a newline lands (line buffering).
- `apps/cli/tests/commands/workflow.test.ts` — `trace --output` validation tests (requires `--follow`, rejects `--json`, shared run-id rule); `followRunLog` unit tests: appends lines + exits at terminal status (incl. blank separator line), holds partial trailing line until newline, and emits the missing-log message when the log never appears.
- `plugins/sp/skills/spur-cli/references/workflows.md` — updated the `trace` row and verb signature with `[--output]` and added `--output` follow examples + bullet describing the log-streaming source (ADR-038 parity, R5).

No new `spur workflow monitor` verb (R4).
### Testing
**Re-verify results** (2026-08-05T02:12:10Z, `/sp-dev-verifyall --feature D2 --force --fix all`)

- Verdict: PASS
- Fresh tests: CLI workflow 88/88 including `trace --output` validation, `followRunLog` unit tests, no-log terminal message.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/workflow.ts:585` --output flag; `:628` branch; `followRunLog` `:844+`; tests `workflow.test.ts:1624+` |
| R2 | MET | validation `:612-619` requires --follow, rejects --json; test `:842` |
| R3 | MET | if/else `--output` → followRunLog else followTrace `:628` region; sources not interleaved |
| R4 | MET | no `monitor` subcommand registered (rg clean); docs only at workflows.md:254 |
| R5 | MET | workflows.md:97,211,242,249-254; spur-cli-parity 14/14 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R8 — trace --follow streams log | MET | test | `workflow.test.ts` followRunLog suite + `:1405` no-log message; exit 0 this run |

Coverage: N/A.
Fix-pass: Requirements+Plan checkboxes marked [x]; evidence paths refreshed.
### Review
Reviewed the implemented work for 0428 (sp-dev-review). Reviewed files: `apps/cli/src/commands/workflow.ts` (trace `--follow`/`--output` log-streaming source), `apps/cli/tests/commands/workflow.test.ts`, and the `spur-cli` reference doc `plugins/sp/skills/spur-cli/references/workflows.md`.

**Functional traceability — PASS (R1–R5).** R1 stream log + exit at terminal, R2 requires `--follow` + rejects `--json`, R3 distinct log source without interleave, R4 no `monitor` verb, R5 spur-cli reference parity — all verified MET with file:line evidence and tests (`workflow.test.ts` 81 pass, `spur-cli-parity.test.ts` 14 pass, `skill-structure.test.ts` 45 pass; biome clean).

**SECUA findings table.**

| Severity | Finding | Recommendation |
|----------|---------|----------------|
| P1 | — | — |
| P2 | — | — |
| P3 | — | — |
| P4 | C-1: `followRunLog` does not drain a trailing partial line at terminal exit (no `\n` yet); theoretical — the sink always terminates lines with `\n` (`workflow-run-log-sink.ts:125,132,136,149`). | Drain remaining bytes once at terminal. |
| P4 | S-1: `runId` interpolated into the log path `join(dir, '.spur', 'run', \`${runId}.log\`)` without sanitization; a `../` runId could resolve to an arbitrary `.log` under cwd. Read-only, same-user, local. | Consider `basename`/normalize before path join. |
| P4 | A-1: `.spur/run` + `*.log` path composition is duplicated across the follower and the sink. | Extract a shared path-composition helper. |

**Design-conformance note:** Design specified exit 2 for `--output` validation; implementation uses exit 1 (matches existing `--follow`). Documented CHANGED in Solution; PASS-acceptable.

**Disposition:** APPROVE. No P1/P2/P3; three P4 advisories (trailing-line drain, runId path sanitization, path-composition dedup), none blocking.
### References

D2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-04T22:44:54.681Z todo → wip (system)
- 2026-08-04T22:58:14.016Z wip → testing (system)
- 2026-08-04T22:59:12.328Z testing → done (system)
