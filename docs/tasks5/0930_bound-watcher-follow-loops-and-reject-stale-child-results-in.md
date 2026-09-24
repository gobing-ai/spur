---
schema_version: 1
name: Bound watcher follow loops and reject stale child results in batch runs
status: done
template: feature-impl
created_at: 2026-09-23T05:54:04.867Z
updated_at: "2026-09-24T15:32:20.321Z"
feature_id: H53

dependencies: ["0928", "0929"]
priority: P2
estimate_hours: 4
---

## 0930. Bound watcher follow loops and reject stale child results in batch runs

### Background

Covers all three H53 scenarios. Only F7 still needs code; F5 and F10 are already in the tree and are confirmed here with cited evidence, not rebuilt.

- **F7 (open).** Two gaps remain:
  - `followTrace` and `followRunLog` (`apps/cli/src/commands/workflow.ts:1816`, `:1903`) poll until the run is terminal and have no deadline. `workflow run --async` tells operators and agents to use `spur workflow trace <id> --follow` (`workflow.ts:752`).
  - The batch driver accepts `.spur/run/<wbs>-verdict.json` as completion evidence (`plugins/sp/skills/spur-dev/references/execution-batch.md:216`, `:270`; `plugins/sp/agents/super-planner.md:89`). That file is keyed by WBS, not run ID, so a verdict left over from an earlier run of the same task can be read as the current result.
  - The 0777 rule ("compare run IDs, require log mtime ≥ dispatch time, bound each watch") exists only as a Gotcha in `plugins/sp/skills/spur-dev/SKILL.md:162-166`. Its "10 minutes or 20 polls" bound is inconsistent: at the default `--poll 1000`, 20 polls is 20 s.
- **F5 (delivered).** `implementAgent=auto` resolution order is documented at `plugins/sp/skills/spur-dev/references/cross-cutting.md:53` and `:161` (stage `model_policy` → `agent.default` → tier priority; subprocess, because the host session model cannot be supplied). It is pinned by B7 (`docs/design/session-pinned-dispatch.md:128`).
- **F10 (delivered).** The mutation-policy guard is at `config/workflows/task-pipeline.yaml:76`, tested at `plugins/sp/tests/task-pipeline-resilience.test.ts:76` (0777).

Rubric: E2 D1 L1 C1 R1 = 6. Kept as one task: the CLI deadline and the driver acceptance rule have to land together, because the driver's bound uses the flag.

**Refine corrections (2026-09-22)**
- "Driver records `DISPATCHED_AT` itself" → `spur workflow trace <run-id> --json` already returns `.run.startedAt` and `.run.runId` (checked against run 992bee7e) → use `.run.startedAt` as the freshness reference and `.run.runId` for identity; the driver keeps no clock of its own.
- "`execution-batch.md` §3.1 polling works as written" → its `jq '{runId, status, terminalState}'` reads top-level keys, but the per-run trace JSON is `{run, events, outputArtifact}` with `runId`/`status` under `.run` and has no `terminalState` → fix the jq in this task, because it is the acceptance step R3 changes.

### Requirements

- [x] R1. Add `--timeout <ms>` to `spur workflow trace <run-id> --follow` (DB timeline and `--output` log modes). When the deadline passes before the run is terminal, write one checkpoint line with the run ID, last observed status and elapsed time, exit nonzero, and leave the run untouched.
- [x] R2. Keep existing behavior when `--timeout` is omitted (unbounded follow). Reject `--timeout` without `--follow`, and reject values that are not positive integers, using the existing `VALIDATION_FAILED` convention.
- [x] R3. The batch driver accepts a child result only when the trace run ID equals the dispatched run ID and the `<wbs>-verdict.json` mtime is at or after the recorded dispatch time. A mismatch or stale verdict is reported as `stale-evidence`, never as `done`.
- [x] R4. Replace the "10 minutes or 20 polls" wording with a single bound, `--timeout 600000`, in the spur-dev Gotcha, execution-batch Step 3.1 and the super-planner inspect step. A bounded watch that times out reports a checkpoint and does not cancel or relaunch the run.
- [x] R5. Record F5 and F10 evidence with `file:line` citations in the task Solution. Add no new behavior for them.

### Acceptance Criteria

- [x] AC1 — Watcher reports are identity-fresh (req: R1, R2, R3, R4)
  Given a running workflow run and a watcher following it with `spur workflow trace <run-id> --follow --timeout <ms>`
  When the deadline passes before the run is terminal
  Then the command prints a checkpoint naming the run ID and last observed status, exits nonzero, and the run is still `running` in `spur workflow trace <run-id> --json`
  And without `--timeout` the follow still returns only at a terminal status
  And a batch inspect step given a `<wbs>-verdict.json` older than its dispatch time, or a trace for a different run ID, reports `stale-evidence` instead of accepting the verdict
  Verify with `followTrace`/`followRunLog` unit tests that inject `wait` and a clock in `apps/cli/tests/commands/workflow.test.ts`, a CLI validation test for `--timeout` without `--follow`, and a plugin contract assertion in `plugins/sp/tests/` over execution-batch.md, super-planner.md and spur-dev SKILL.md.

- [x] AC2 — Auto resolution semantics are documented (req: R5)
  Given implementAgent=auto
  When the docs describe model selection
  Then the Solution cites `cross-cutting.md` lines for the resolution order and the host-session exclusion, and the B7 pin in `session-pinned-dispatch.md`; no behavior change

- [x] AC3 — Classification-only tasks never receive source edits from test-fix (req: R5)
  Given a task whose mutation policy is none
  When its test gate fails and the test-fix hop runs
  Then the existing `task-pipeline-resilience.test.ts` mutation-policy test passes and is cited in Solution; no behavior change

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-23T05:55:29.414Z

- **Bound mechanism (closed 2026-09-22, operator).** Add `--timeout <ms>` to `spur workflow trace --follow`, reusing `SHARED_OPTIONS.timeout` (`apps/cli/src/commands/shared-options.ts:42`, already used by `spur message send --wait`). The default stays unbounded. The operator granted public-surface consent in this planning session. Rejected: prose-only bounded polling of `trace --json`, because nothing enforces it.
- **`--max-polls` (closed).** Not added. A wall-clock deadline is the invariant, and poll count depends on `--poll`. Add it only if a caller shows a real need.
- **Freshness source (closed).** Use the verdict file mtime compared with a dispatch timestamp that the driver captures when `workflow run --async` returns. Do not add a `runId` field to the verdict schema: that is a schema change with other owners, and mtime is enough for the stale-leftover case.

#### Q&A entry — 2026-09-23T05:59:47.881Z

- **Bound mechanism (closed 2026-09-22, operator).** Add `--timeout <ms>` to `spur workflow trace --follow`, reusing `SHARED_OPTIONS.timeout` (`apps/cli/src/commands/shared-options.ts:42`, already used by `spur message send --wait`). The default stays unbounded. The operator granted public-surface consent in this planning session. Rejected: prose-only bounded polling of `trace --json`, because nothing enforces it.
- **`--max-polls` (closed).** Not added. A wall-clock deadline is the invariant, and poll count depends on `--poll`. Add it only if a caller shows a real need.
- **Freshness source (closed).** Compare the verdict file mtime with `.run.startedAt` from `spur workflow trace <run-id> --json`, a Spur-owned timestamp, rather than a driver-side clock. Do not add a `runId` field to the verdict schema: that is a schema change with other owners, and mtime is enough for the stale-leftover case.

### Design

- **CLI (R1/R2).** Add `.option(...SHARED_OPTIONS.timeout)` to the `trace` command (`workflow.ts:1470` block). Validate next to the existing `--follow`/`--output` guards: `--timeout` requires `--follow`, and the value must be a positive integer. Pass an optional `deadlineMs` into both `followTrace` and `followRunLog`. Both loops already take an injectable `wait`; also add an injectable `now` (default `Date.now`) so tests stay deterministic. When `now() >= start + deadlineMs` and the status is not terminal, write `Follow timed out after <ms>ms: run <id> status=<status> — run continues; resume with spur workflow trace <id> --follow` and return a result the action maps to exit code 1 through `context.setExitCode(1)`. Never call cancel. The `Run not found` retry window in `followTrace` also counts against the deadline.
- **Driver acceptance (R3/R4).** In `execution-batch.md` Step 3 pseudo-code and §3.1/§3.3: keep `RUN` from `workflow run --async --json`. Inspect with `spur workflow trace "$RUN" --json | jq '.run | {runId, status, startedAt}'`, replacing the broken top-level `{runId, status, terminalState}` jq. Accept `.spur/run/<wbs>-verdict.json` only if `.run.runId == $RUN` and the verdict mtime ≥ `.run.startedAt`. Otherwise record outcome `stale-evidence` (non-`done`; failure policy applies). Mirror this in one line in `plugins/sp/agents/super-planner.md:89`. In the `spur-dev/SKILL.md:162-166` Gotcha, replace "10 minutes or 20 polls" with `spur workflow trace <run-id> --follow --timeout 600000`. The interactive inline host driver has no dispatch gap and is out of scope.
- **Surface governance.** Add a ledger row to `docs/design/harness-surface-governance.md` (new flag on an existing verb, consent recorded in Q&A). Update the `spur workflow trace` synopsis in `docs/design/cli-contracts.md:641` and the workflow reference in `plugins/sp/skills/spur-cli/references/workflows.md`.
- **Coordination.** E7 tasks 0925–0928 migrate `.spur/run/<runId>.log` to the `.md`/`.state.json` pair and may change `followRunLog`'s path. This task depends on 0928/0929 and must rebase onto their final `followRunLog`. Add the deadline without changing log-path resolution.
- **Invariants.** A timeout never mutates run state. Omitting the flag keeps current output byte-for-byte. `--follow` + `--json` stays rejected. Plugin surfaces keep the standalone import contract.
- **Budget.** About 4 h. Mutation policy: code. Scope: `apps/cli/src/commands/workflow.ts`, its tests, and the four plugin/doc files named above.
- **Concurrency (2026-09-22).** The D63 batch worktree `spur-new-runall-d63-767a` (branch `sp/runall-d63-767a`) is active. D63 0919 ("reconcile batch continuation") also edits `execution-batch.md`. The 0928/0929 dependency orders this task after it; rebase before editing that file.
- **Out of scope.** Verdict schema changes; `--max-polls`; bounding `spur message send --wait` (it already has `--timeout`); the inline host driver; cancelling or relaunching on timeout.

### Plan

1. Rebase onto the final E7 `followRunLog`/`followTrace`. Write failing tests first: deadline hit, run not terminal → checkpoint + nonzero, no cancel; no-flag unchanged; `--timeout` without `--follow` rejected.
2. Implement the `deadlineMs` + `now` parameters and the `trace` option/validation. Run `cd apps/cli && bun test tests/commands/workflow.test.ts`.
3. Update the execution-batch Step 3/§3.1/§3.3 acceptance rule, the super-planner inspect line and the spur-dev Gotcha. Add the plugin contract assertion.
4. Update `cli-contracts.md`, `spur-cli/references/workflows.md` and the governance ledger row.
5. Write the F5/F10 citations into Solution. Run `bun run spur-check` and `bun run plugin-smoke`.

### Solution

Implemented on branch `sp/run-0930-a1041` (worker run a1041). R1/R2: `--timeout <ms>` on `spur workflow trace <run-id> --follow`. R3/R4: batch-driver acceptance rule + single `--timeout 600000` bound. R5: citations only, zero behavior change.

## Change map (R1–R4)

- `apps/cli/src/commands/workflow.ts:1483` — trace option block gains `--timeout` via `SHARED_OPTIONS.timeout` (prior art: `message send --wait`, `apps/cli/src/commands/message.ts:179`).
- `apps/cli/src/commands/workflow.ts:1525-1538` — R2 guards next to the follow guards: `--timeout requires --follow` and positive-integer-ms check, both `VALIDATION_FAILED` + exit 1.
- `apps/cli/src/commands/workflow.ts:1564-1588` — follow branch passes the deadline into `followTrace`/`followRunLog`; a `true` (timed-out) return maps to `context.setExitCode(1)`. No cancel path exists or was added (R1: run untouched).
- `apps/cli/src/commands/workflow.ts:1855-1926` — `followTrace`: injectable `now` (default `Date.now`) alongside `wait`; deadline measured from follow start and enforced in the `Run not found` retry window too (checkpoint reports `status=pending` there); main loop checks the deadline once per poll cycle after the terminal check; checkpoint line is exactly `Follow timed out after <ms>ms: run <id> status=<status> — run continues; resume with spur workflow trace <id> --follow`; returns the timed-out boolean; terminal completion returns false and exits 0 as before (R1/R2).
- `apps/cli/src/commands/workflow.ts:1971-2047` — `followRunLog`: same deadline contract; `lastStatus` tracked (initialized `pending` while the run is unregistered) for the checkpoint.
- `apps/cli/tests/commands/workflow.test.ts:1605-1633` — CLI validation: `--timeout` without `--follow` and non-positive-integer values (`0`, `-5`, `abc`, `1.5`, `''`) rejected `VALIDATION_FAILED` (R2).
- `apps/cli/tests/commands/workflow.test.ts:2307-2346` — AC1 CLI integration: seeded `running` run, `--follow --poll 50 --timeout 60` → one checkpoint naming run id + `status=running`, exit 1, and a follow-up `trace --json` still shows `running`.
- `apps/cli/tests/commands/workflow.test.ts:2842-2934,3054-3080` — `followTrace`/`followRunLog` unit tests with injected `wait` + clock: deadline checkpoint content (one line, exact text), unbounded behavior without a deadline, and the `Run not found` retry window counting against the deadline.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:213-219` — Step 3 pseudo-code: bounded follow + verdict acceptance annotations.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:244-261` — §3.1: the single `spur workflow trace "$RUN" --follow --timeout 600000` watch replaces the hand-rolled poll loop; inspect projects `.run | {runId, status, startedAt}`, fixing the broken top-level `jq '{runId, status, terminalState}'` (per-run payload is `{run, events, outputArtifact}`).
- `plugins/sp/skills/spur-dev/references/execution-batch.md:285-294` — §3.3 driver acceptance (R3): verdict accepted only when the trace's `.run.runId` equals the dispatched run AND the verdict's mtime ≥ `.run.startedAt`; otherwise outcome `stale-evidence` (non-done, failure policy applies), never cancel/relaunch.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:378-386` — same-defect jq repair in the green-path trace-observation block (`.run.status` wording).
- `plugins/sp/skills/spur-dev/SKILL.md:163-168` — Gotcha: "10 minutes or 20 polls" → `--follow --timeout 600000`, checkpoint on timeout, never cancel/relaunch (R4).
- `plugins/sp/agents/super-planner.md:89-92` — inspect line carries the bound + acceptance rule (R3/R4).
- `plugins/sp/tests/batch-watch-bound-contract.test.ts` — plugin contract assertions over the three surfaces (AC1): bound present, retired poll-count wording absent, acceptance rule + `.run.startedAt` + `stale-evidence` present, broken jq absent.
- `docs/design/cli-contracts.md:639,641,752-757` — trace synopsis `[--timeout <ms>]` (anchor updated) + behavior bullet.
- `plugins/sp/skills/spur-cli/references/workflows.md:117,267,301-306,313-318` — surface table, command block, follow examples, `--timeout` bullet.
- `docs/design/harness-surface-governance.md:122` — §4 consent ledger row (2026-09-23, task 0930, flag on existing verb; consent recorded in task Q&A 2026-09-22/23).

## F5/F10 evidence citations (R5 — citations only, no behavior change)

- **F5 (implementAgent=auto resolution semantics):** `plugins/sp/skills/spur-dev/references/cross-cutting.md:53` — the `auto` row of the inline-default value→behavior table (resolves to the caller-declared role via stage `model_policy` → `agent.default` → tier priority, landing on a subprocess executor; the host session cannot supply a pinned agent/model) and `plugins/sp/skills/spur-dev/references/cross-cutting.md:161` — the prose restating tier-resolution-before-merge. B7 pin: `docs/design/session-pinned-dispatch.md:128` — "H53 (formerly P): F5 implementAgent=auto semantics lands with B7". None of these files changed in this task.
- **F10 (classification-only tasks never receive fixall source edits):** `config/workflows/task-pipeline.yaml:77` — `mutationPolicy: "code"` under the both-caps-and-policy gate comment, enforced by `plugins/sp/tests/task-pipeline-resilience.test.ts:76` (`0503 task-pipeline resilience` → mutation-policy test). Unchanged here; cited as the standing evidence AC3 references.

Validation: 156/156 `apps/cli` workflow tests green (incl. 7 new 0930 tests); plugin contract test 3/3; `bun run plugin-smoke` PASS; `bun run format` applied with no unintended files.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/workflow.ts:1483` adds SHARED_OPTIONS.timeout; `apps/cli/src/commands/workflow.ts:1563-1588` passes deadlineMs into followTrace and followRunLog and maps a true return to setExitCode(1) with no cancel; `apps/cli/src/commands/workflow.ts:1855-1925` and `apps/cli/src/commands/workflow.ts:1975-2044` write one checkpoint with run id, status, and elapsed ms, including the Run-not-found window. `apps/cli/tests/commands/workflow.test.ts:2305-2338` (exit 1, status=running, follow-up trace still running) and `apps/cli/tests/commands/workflow.test.ts:2862-2943` plus `apps/cli/tests/commands/workflow.test.ts:3060-3085`. Re-verified 2026-09-24; artifacts .spur/run/0930-verify-answer.txt and .spur/run/0930-verdict.json. |
| R2 | MET | `apps/cli/src/commands/workflow.ts:1525-1541` rejects --timeout without --follow and non-positive integers as VALIDATION_FAILED exit 1; `apps/cli/src/commands/workflow.ts:1880` and `apps/cli/src/commands/workflow.ts:1986` keep an omitted deadline unbounded. `apps/cli/tests/commands/workflow.test.ts:1605-1617` and `apps/cli/tests/commands/workflow.test.ts:1620-1631` (integer cases now assert the integer message; --json omitted so --follow --json cannot hide the guard). `apps/cli/tests/commands/workflow.test.ts:2891-2915`. CLI: `bun apps/cli/src/index.ts workflow trace no-such-run --timeout 5000 --json --json-envelope` exit 1 code VALIDATION_FAILED message "--timeout requires --follow"; human `--follow --timeout abc` and `--follow --timeout 0` exit 1 message "--timeout must be a positive integer of milliseconds". |
| R3 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:285-296` accepts a verdict only when trace `.run.runId` equals the dispatched run and verdict mtime is at least `.run.startedAt`, otherwise outcome stale-evidence and never cancel or relaunch. `plugins/sp/agents/super-planner.md:89-92` states the same rule. `plugins/sp/tests/batch-watch-bound-contract.test.ts:29-35` passed this run. |
| R4 | MET | `plugins/sp/skills/spur-dev/SKILL.md:165-168` Gotcha uses `spur workflow trace <run-id> --follow --timeout 600000` and says a timeout does not cancel or relaunch. `plugins/sp/skills/spur-dev/references/execution-batch.md:244-258` is the single bounded watch. `plugins/sp/agents/super-planner.md:89-92` carries the same bound. `plugins/sp/tests/batch-watch-bound-contract.test.ts:38-45` passed this run (retired poll-count wording absent from SKILL.md and super-planner.md). |
| R5 | MET | Solution cites `plugins/sp/skills/spur-dev/references/cross-cutting.md:53` (auto row: host session cannot supply the pinned agent/model), `plugins/sp/skills/spur-dev/references/cross-cutting.md:161` (model_policy then agent.default then tier priority, before merge), and `docs/design/session-pinned-dispatch.md:128` (H53 F5 lands with B7). F10 cites `config/workflows/task-pipeline.yaml:77` mutationPolicy code and `plugins/sp/tests/task-pipeline-resilience.test.ts:76`. None of those files are in commit f2866492a. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Watcher reports are identity-fresh | MET | test | `apps/cli/tests/commands/workflow.test.ts:2305` checkpoint exit 1 run still running; `apps/cli/tests/commands/workflow.test.ts:2862` and `apps/cli/tests/commands/workflow.test.ts:3060` injected clock; `apps/cli/tests/commands/workflow.test.ts:2891` unbounded without a deadline; `apps/cli/tests/commands/workflow.test.ts:1605` and `apps/cli/tests/commands/workflow.test.ts:1620` validation; `plugins/sp/tests/batch-watch-bound-contract.test.ts:16` stale-evidence contract. 7/7 workflow 0930 tests and 3/3 contract tests passed this run. |
| Auto resolution semantics are documented | MET | command | Solution F5 block cites `plugins/sp/skills/spur-dev/references/cross-cutting.md:53`, `plugins/sp/skills/spur-dev/references/cross-cutting.md:161`, and `docs/design/session-pinned-dispatch.md:128`. Those lines name the auto resolution order and the host-session exclusion, and the B7 pin. No behavior change in those files (absent from f2866492a). |
| Classification-only tasks never receive source edits from test-fix | MET | test | `plugins/sp/tests/task-pipeline-resilience.test.ts:76` passed this run (exit 0, source.ts unchanged, mutationPolicy none refuses). Cited from Solution; `config/workflows/task-pipeline.yaml:77` unchanged in f2866492a. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | CLI deadline, both follow loops, validation, driver acceptance, single --timeout 600000 bound, governance ledger `docs/design/harness-surface-governance.md:122`, synopsis `docs/design/cli-contracts.md:641`, workflows reference `plugins/sp/skills/spur-cli/references/workflows.md:313-317`. All design claims DONE. |
| P4 | scope-creep | — | skill-structure.test.ts jq expectation and docs/help timeout row follow the jq repair and the new flag. |
| P4 | cli-golden-path-present | — | bun apps/cli/src/index.ts workflow trace no-such-run --timeout 5000 --json --json-envelope exit 1 VALIDATION_FAILED "--timeout requires --follow". |
| P4 | secu-review | — | No P1-P3 findings. Integer-timeout test fixed at workflow.test.ts:1620. cli-contracts.md:749-751 now names the .md run record. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: `docs/features/H53_pipeline-dispatch-reliability.md` (F5/F7/F10 from 0777).
- `docs/design/session-pinned-dispatch.md` §7; `docs/design/harness-surface-governance.md`; `docs/design/cli-contracts.md:641`.
- Prior art: `spur message send --wait --timeout` (`apps/cli/src/commands/message.ts:179`, `:642`).
- Sequencing: after E7 0928/0929 (which themselves follow D63 0921).

### History

- 2026-09-23T05:59:53.034Z backlog → todo (system)
- 2026-09-24T07:56:40.274Z todo → wip (system)
- 2026-09-24T08:40:42.261Z wip → testing (system)
- 2026-09-24T08:41:14.357Z testing → done (system)

