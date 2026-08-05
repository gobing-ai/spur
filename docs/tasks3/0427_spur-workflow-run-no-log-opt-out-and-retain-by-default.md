---
template: feature-impl
schema_version: 1
name: "spur workflow run --no-log opt-out and retain-by-default"
description: ""
status: done
type: task
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: ["workflow", "cli", "log", "retention"]
dependencies: ["0426"]
created_at: "2026-08-04T17:25:04.934Z"
updated_at: "2026-08-05T02:12:10.844Z"
---

## 0427. spur workflow run --no-log opt-out and retain-by-default

### Background

Feature D2 — the run command surface for log retention. Adds `spur workflow run --no-log` to opt out of the consolidated log, retains the log by default, and propagates the flag to the `--async` detached worker. Operator-settled: retain-by-default with `--no-log` (no `--keep-log`, no delete-by-default). Updates its own `spur-cli` workflow reference row (ADR-038 parity) so the flag ships in the same change.

Implements: R6 — the all-in-one log is retained by default after the run ends; R7 — --no-log opts out of writing the all-in-one log.

Rubric: E2 D1 L2 C1 R0 = 6 → decompose (child of parent score 14).

### Requirements
- [x] R1. Retain the consolidated `.spur/run/<RUNID>.log` by default after a run reaches terminal status.
- [x] R2. `spur workflow run --no-log` opts out of writing the consolidated log.
- [x] R3. Propagate `--no-log` to the `--async` detached worker (same propagation path as `--trace-file`).
- [x] R4. Do not add a `--keep-log` flag or delete-by-default behavior (operator-settled polarity).
- [x] R5. Update the `spur-cli` workflow reference run signature (ADR-038 parity test must pass).
### Acceptance Criteria
```gherkin
Feature: spur workflow run --no-log opt-out and retain-by-default

  @core
  Scenario: R6 — the all-in-one log is retained by default after the run ends
    Given a workflow run completes
    When the operator inspects .spur/run
    Then the file RUNID.log still exists for that run
    And no --keep-log flag or delete-by-default behavior applies

  @core
  Scenario: R7 — --no-log opts out of writing the all-in-one log
    Given an operator starts a workflow run with spur workflow run --no-log
    When the run completes
    Then no RUNID.log file is written for that run
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
## Approach

Gate construction of the existing `WorkflowRunLogSink` (task 0426) behind a new
`spur workflow run --no-log` flag. Default remains **write + retain** the
`.spur/run/<RUNID>.log` file; `--no-log` skips sink construction entirely so no
file is opened or written. Propagate the flag to the `--async` detached worker
along the same path as `--trace-file` today.

## Chosen design

1. **CLI flag only** — `.option('--no-log', …)` on `workflow run` in
   `apps/cli/src/commands/workflow.ts`. Commander exposes it as `options.noLog`
   (boolean). No complementary `--keep-log`; polarity is operator-settled.
2. **Conditional sink** — wrap the existing
   `new WorkflowRunLogSink({…})` block (`workflow.ts` ~304–310) in
   `if (options.noLog !== true)`. When opted out, leave `runLog` undefined and
   skip `close()` in `finally`. Do not invent a null-object sink.
3. **Async propagation** — in the `--async` spawn arm (`workflow.ts` ~222–236),
   when `options.noLog` is true, `cmd.push('--no-log')` next to the existing
   `--trace-file` propagation. The detached worker re-enters the sync run path
   (`SPUR_ASYNC_WORKER=1` → `workflow run --run-id`), so the same gate applies
   in-process independent of nohup `/dev/null`.
4. **Retention is a no-op under opt-out** — if no file was written, there is
   nothing for task 0429's clean policy to reclaim. No interaction with
   `workflow.logRetentionDays`.
5. **ADR-038 parity** — same-change update of the `sp:spur-cli` workflow
   reference run signature to include `--no-log`.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| `--keep-log` / delete-by-default | Explicitly rejected by operator (D2 Notes). |
| Config key for default-off | Operator settled retain-by-default; opt-out is per-run CLI only. |
| Null-object sink that opens then writes nothing | Wastes an fd and risks empty files; skip construction. |

## Invariants

- Unwritable `.spur/run/` still degrades the log, never the run (0426 R8/R12) —
  `--no-log` is a clean opt-out of that path, not a second failure mode.
- Redaction / bounds live in the sink; when the sink is absent there is no
  leak surface to maintain.
- `--no-log` composes with `--async`, `--trace-file`, `--steer` (steer remains
  sync-only as today), and output-verbosity flags.

## Surfaces touched

| Surface | Change |
|---|---|
| `apps/cli/src/commands/workflow.ts` | `.option('--no-log')`; conditional sink; async `cmd.push('--no-log')` |
| `apps/cli/tests/commands/workflow.test.ts` | Golden paths: default retains log; `--no-log` writes none; async propagates |
| `plugins/sp/skills/spur-cli/references/workflows.md` | Run signature + flag table row (ADR-038) |
### Plan
- [x] Add `.option('--no-log', 'Opt out of writing the consolidated .spur/run/<RUNID>.log')` on `workflow run`.
- [x] Gate `WorkflowRunLogSink` construction on `options.noLog !== true`; skip `close()` when absent.
- [x] In the `--async` spawn arm, propagate `--no-log` into the detached worker `cmd` (mirror `--trace-file`).
- [x] Confirm default path still builds the sink and leaves `.spur/run/<RUNID>.log` after terminal status (R6).
- [x] Tests: default retains log; `--no-log` produces no file; async spawn argv includes `--no-log` when set.
- [x] Update `plugins/sp/skills/spur-cli/references/workflows.md` run signature + flag table (ADR-038).
- [x] Gate: `bun run lint` + targeted CLI tests green.
### Solution
Implemented `spur workflow run --no-log` (feature D2) as a per-run CLI opt-out that skips the
`WorkflowRunLogSink` entirely; retain-by-default is unchanged.

**Code (`apps/cli/src/commands/workflow.ts`)**
- Flag: `.option('--no-log', …)` on `run` at `apps/cli/src/commands/workflow.ts:181`. Commander maps the
  negated flag to `options.log` (default `true`, `false` when `--no-log` passed) — not `options.noLog`
  as the design draft assumed; the gate keys off `options.log === false`.
- Async propagation (R3): `apps/cli/src/commands/workflow.ts:238-240` pushes `--no-log` into the detached
  worker `cmd` next to the existing `--trace-file` push, so the worker re-enters the sync path opted out.
- Conditional sink (R2/R7): `apps/cli/src/commands/workflow.ts:308-317` builds the `WorkflowRunLogSink`
  only when `options.log !== false`; `apps/cli/src/commands/workflow.ts:408` uses `runLog?.close()`. No
  null-object sink, no `--keep-log`, no delete-by-default (R4).

**Tests (`apps/cli/tests/commands/workflow.test.ts`)** — 3 new cases, all passing:
- R6 default retains log: `apps/cli/tests/commands/workflow.test.ts:647`.
- R7 `--no-log` writes none: `apps/cli/tests/commands/workflow.test.ts:664`.
- R3 async propagation (spies `NodeProcessExecutor.prototype.run` argv): `apps/cli/tests/commands/workflow.test.ts:1079`.

**Docs (R5, ADR-038 parity)** — `plugins/sp/skills/spur-cli/references/workflows.md`: run signature in
the ops table + command surface, the output/observability flag block (six → seven, noting `--no-log` is
output-mode-independent), a `--no-log` bullet, and a flag-table row.

**Verification**: `bun test apps/cli/tests/commands/workflow.test.ts` → 77 pass / 0 fail (incl. 3 new);
`bunx biome check` on both files clean; `bunx tsc --noEmit` in `apps/cli` exit 0. End-to-end smoke:
default run leaves `.spur/run/smoke-default.log`, `--no-log` run writes no `.spur/run/smoke-nolog.log`,
`--async --no-log` starts.
### Testing
**Re-verify results** (2026-08-05T02:12:10Z, `/sp-dev-verifyall --feature D2 --force --fix all`)

- Verdict: PASS
- Fresh tests: `bun test apps/cli/tests/commands/workflow.test.ts` → 88 pass / 0 fail (includes R6/R7/async --no-log); parity 14/14.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | default sink build `apps/cli/src/commands/workflow.ts:306-320`; test `:653` retain by default |
| R2 | MET | `--no-log` option `:183`; gate `options.log === false` `:311-312`; test `:670` |
| R3 | MET | async argv `cmd.push('--no-log')` `:238-241`; test `:1189` |
| R4 | MET | no `--keep-log` / keepLog in CLI (rg clean); polarity documented `:183` |
| R5 | MET | `plugins/sp/skills/spur-cli/references/workflows.md:92,206,178-186,196-198,225`; parity 14/14 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R6 — retained by default | MET | test | `apps/cli/tests/commands/workflow.test.ts:653` exit 0 this run |
| R7 — --no-log opts out | MET | test | `apps/cli/tests/commands/workflow.test.ts:670` exit 0 this run |

Coverage: N/A (CLI behavior tests).
Fix-pass: Requirements+Plan checkboxes marked [x]; Testing anchors refreshed.
### Review
**Functional Review — requirements traceability (PASS)**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/commands/workflow.ts:308-317` — `WorkflowRunLogSink` built when `options.log !== false` (default `true`); `apps/cli/tests/commands/workflow.test.ts:647` — R6 test asserts `.spur/run/retain-log-run.log` exists and is non-empty after terminal run |
| R2 | MET | `apps/cli/src/commands/workflow.ts:308` — `options.log === false ? undefined : new WorkflowRunLogSink(...)`; `apps/cli/tests/commands/workflow.test.ts:664` — R7 test asserts `readFile(no-log-run.log)` rejects |
| R3 | MET | `apps/cli/src/commands/workflow.ts:238-240` — `if (options.log === false) cmd.push('--no-log')` in `--async` spawn arm; `apps/cli/tests/commands/workflow.test.ts:1079` — spy on `NodeProcessExecutor.prototype.run` asserts argv contains `--no-log` |
| R4 | MET | `apps/cli/src/commands/workflow.ts:181` — only `.option('--no-log', …)` added; no `--keep-log`, no delete-by-default; sink retains by default |
| R5 | MET | `plugins/sp/skills/spur-cli/references/workflows.md:92,206` — run signature includes `--no-log`; `:178-186` flag block; `:196-198` bullet; `:225` flag-table row |

Functional verdict: PASS. All 5 R-items MET with file:line + test evidence. 77/77 workflow CLI tests pass (incl. 3 new), biome clean, `tsc --noEmit` exit 0.

**SECUA Review**

- No security findings — `--no-log` adds no input handling, secrets, or injection surface.
- No correctness findings — Commander negation (`options.log`, default `true`, `false` on `--no-log`) is correctly gated at `apps/cli/src/commands/workflow.ts:308` and the async fallback path (spawn-throw → sync) re-enters the same gate, so behavior is consistent. `runLog?.close()` at `apps/cli/src/commands/workflow.ts:408` avoids NPE when opted out.
- No efficiency findings — opt-out skips sink construction entirely (no fd opened, no file written); better than a null-object sink.
- No usability findings — flag description is explicit.
- P3 (minor, advisory): the `options.log` negation semantic is Commander-specific and non-obvious to readers; it is documented in the Solution and the sink code comment (`apps/cli/src/commands/workflow.ts:305-307`). Non-blocking.

**Architecture (code-improvement)**

- No blocker/major deepening candidates. The change is minimal and sits at the correct seam (CLI command `apps/cli/src/commands/workflow.ts:181/308`), reuses the existing sink path rather than inventing a null-object, and mirrors the existing `--trace-file` propagation for async (`apps/cli/src/commands/workflow.ts:238-240`). Test surface is strong: 3 direct tests cover default-retain, opt-out, and async-argv propagation.
- P4 (advisory): design draft assumed `options.noLog`; implementation exposes the negated flag as `options.log`. Documented deviation (CHANGED) in Solution — PASS-acceptable per design-conformance rule.

**Design conformance**

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | 4/4 non-trivial claims DONE; 1 CHANGED (flag-access semantics `noLog`→`log`, documented in Solution) |

**Residual risk**: low. Retain-by-default and opt-out both covered by executable tests; async propagation verified via argv spy. `.spur/run` retention interacts with task 0429's clean policy only when a file exists — no interaction under opt-out (by design).

**P1–P4 Priority Findings**

| Priority | Dimension | Severity | Finding | Evidence | Remediation |
|----------|-----------|----------|---------|----------|-------------|
| P3 | Usability | minor | Commander `--no-log` negation maps to `options.log` (default `true`, `false` on flag); non-obvious to readers | `apps/cli/src/commands/workflow.ts:305-307` | accepted — documented in Solution + sink code comment |
| P4 | Architecture | advisory | Design draft assumed `options.noLog`; implementation exposes negated flag as `options.log` | Solution §1 | accepted — documented CHANGED deviation, PASS-acceptable (design-conformance) |
### References

D2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-04T21:57:42.897Z todo → wip (system)
- 2026-08-04T22:38:30.052Z wip → testing (system)
- 2026-08-04T22:38:30.684Z testing → done (system)
