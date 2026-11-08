---
schema_version: 1
name: Bound hung shell/gate actions, time host pauses, replay verdict evidence (credit-sentry post-mortem)
status: done
template: standard
created_at: 2026-11-08T17:48:19.304Z
updated_at: "2026-11-08T23:30:26.086Z"
feature_id: D3

ac_altitude: task-local
ac_numbering: task-local
priority: P1
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1319-verdict.json
---

## 1319. Bound hung shell/gate actions, time host pauses, replay verdict evidence (credit-sentry post-mortem)

### Background

Post-mortem of the 2026-11-06 → 2026-11-08 downstream run of `/Users/robin/xprojects/credit-sentry` (21 tasks `done`, one `/sp:dev-runall` batch, two operator days). The project shipped, but the measured cost was dominated by Spur wiring gaps, not by task size. Evidence: `credit-sentry/.spur/spur.db` (`runs`, `phase_runs`, `action_runs`), `.spur/run/**` receipts and batch logs, `.spur/context/token-ledger.jsonl` (2178 rows, 1844 traced bash calls), the Claude session transcript `~/.claude/projects/-Users-robin-xprojects-credit-sentry/97d030fa-*.jsonl`, and live process state. Spur installed there: `@gobing-ai/spur` 0.4.24, `task-pipeline` v9.

**G1 — a run never produced a timeline (unmeasurable days).** `spur workflow profile task-pipeline` reports `implement agent.run p50=0.0s` for the very runs that took hours. A host-executor `agent.run` pauses with `{"ok":true,"pause":true,"data":{"surface":"host",…,"reason":"host-work-item"}}` (`packages/app/src/workflow/actions/agent-run.ts:587`) and the engine finalizes that action row with `duration_ms` 2–3 (re-verified 2026-11-08: `first-csv-0001` implement/review = 2 ms, `first-csv-0001-r2` implement = 3 ms). The host receipt Spur persists on resume is the host-supplied file, validated and written verbatim (`packages/app/src/services/workflow-resume-ops.ts:214-217`, `:304-320`), so a host that writes `startedAt == finishedAt` (`.spur/run/4fc0583d-*/receipts/implement.json`) leaves no duration anywhere. `phase_runs` is append-only in the engine (`@gobing-ai/ts-dual-workflow-engine` 0.7.1 `dist/persistence.js:162-177` inserts a row per status, `completed_at` null for `running`): 48 of 70 rows in credit-sentry have no `completed_at`. `first-csv-0001` implement was open **10h11m** (`05:57:37Z → 16:08:52Z`) and the run was then cancelled at 11h36m; the declared budgets (`config/workflows/task-pipeline.yaml:113,120` — 30 min step, 45 min implement) never bit, because the host executor forwards `timeoutMs` only when the host's dispatch tool accepts one and a pause is not a timed step. The re-run `first-csv-0001-r2` finished in 123 s on the same tree. `spur workflow profile` samples only `done` runs (`--last` over done runs), so the cancelled run is invisible to it by construction; `spur workflow cost` printed nothing for the project.

**G2 — one hung test cost more than the implementation.** `apps/cli/tests/redact.test.ts:243` passes a constant `random` stub and `apps/cli/src/redact.ts:43-59` (`distinctValues`) spins in `while (picked.size < count)` — reproduced: the file produces no result under a 15 s kill. Two orphaned `bun test apps/cli/tests/redact.test.ts` processes from that file were still alive when this analysis started (PIDs 23231 from 2026-11-07 20:02 = 923 CPU-min, and 16033 from 2026-11-08 08:34 = 64 CPU-min). Their launcher is **unverified**: the command shape is a single-file focused run (not the gate's `qualityGateCmd`), and the cited transcript holds no such Bash call, so they most likely came from a host Bash tool call whose timeout killed the shell but not `bun`. Spur cannot bound a host tool call; it can (a) bound every command *it* launches and (b) route focused runs through a bounded Spur verb (R6). The last night's change (`redact.ts` salt + its test + a fixture) is still uncommitted because the gate can never go green.

Spur's own gate path has no effective bound today:

- The pipeline's `gate` state runs `command.gate` → `spur task gate <wbs> <mode>` (`config/workflows/task-pipeline.yaml:514-520`, no `timeoutMs`). Inside that process, `qualityGateMain` → `runQualityGate` / `runLightGate` → `runShellCommand` (`packages/app/src/services/quality-gate.ts:796-821`), a `spawnSync('sh', ['-c', cmd])` without `timeout`. Callers of `runShellCommand`: `:620` (light-tier `git diff`), `:743` (light sub-checks), `:1273` (recheck probe), `:1302` (full-tier attempt loop). So the CLI path and the pipeline path are **the same path**; the pipeline only adds the outer `command.gate` process.
- `command.gate` supports `timeoutMs` (`packages/app/src/workflow/actions/command-gate.ts:54,158,178`), and a finite deadline activates `@gobing-ai/ts-runtime` owned process-group containment, which on timeout signals the group SIGTERM → grace → SIGKILL **and on natural leader exit reaps surviving group members** (`ts-runtime` 0.7.1 `dist/process-group.js:93-136`). Without a finite deadline there is no ownership and grandchildren survive. Note: `command-gate.ts:158` accepts only `typeof === 'number'`; a `${vars.*}` template (vars are declared as quoted strings) would be **silently ignored** — `agent.run` coerces strings (`agent-run.ts:1963-1971`), `command.gate` does not.
- The only `shell` step in `task-pipeline` that runs a project command is the implement-exit formatter `sh -c "$formatCmd" ; exit 0` (`config/workflows/task-pipeline.yaml:337`). The `shell` action cannot be bounded without an upstream change: `ProcessExecutor.runStreaming` takes `PipeProcessOptions`, which has **no** timeout field (`ts-runtime` 0.7.1 `dist/process-executor.d.ts:173-192`).
- An async, group-owned, SIGTERM→SIGKILL child runner already exists: `runBoundedChild` (`packages/app/src/services/bounded-child-run.ts:94-128`). Moving `runShellCommand` onto it requires the gate chain to go async (~70 call sites across 8 test files plus `apps/cli/src/commands/task/gate.ts`), so it is the upgrade path, not this task.

**G3 — "done" is self-certified, so 43 % of tasks were implemented twice.** The 2026-11-07 `verifyall --fix all` admitted 7 tasks already marked `done` and found real defects in **7 of 7** (`credit-sentry/.spur/run/batch-20261107T012818Z/batch-report.md`): wrong AC fixtures (0004), a shared 2000-finding cap (0005), amount round-trip / layout-schema exclusivity / debit-credit signs (0006), replay + overlap projections (0007), export path + finding-event deletion + schema guard (0008), small-band order + header fidelity + masking (0019). The review certifies through `spur task verdict --from-answer` over the reviewer's own prose: the answer lint (`apps/cli/src/commands/task/verdict.ts:39-61`) checks *shape* only, and nothing replays the "23 pass / 0 fail" claims the verdict cites. The derived verdict already carries each row's `evidence` string (`packages/app/src/services/verify-verdict.ts:44-56`), and the shared backtick anchor extractor `extractBacktickLineAnchors` (`packages/app/src/services/task-check.ts:229-253`) already parses `path:line` / `path:start-end`. (`spur task migrate-anchors` is the anchor *qualifier* — `packages/app/src/services/anchor-qualifier.ts:425` — not the parser to reuse.)

**G4 — artifact-shape churn bought extra agent hops.** 3 of 12 work items needed a `remediate` for shape alone: "verdict artifact shape fixed: feature-level AC3 folded into AC2", "the extra R5 row was folded into R4", "Review confidence label corrected". Task 0009 was run **4×** within 65 min (`83e19937` 05:09, `ac661e32` 06:01, `9b48ecc1` 06:12, `f7bc6f2e` 06:14) for exactly that reason. The lint findings already name the declared identities (`packages/app/src/services/verify-answer-lint.ts:82` "unknown requirement ID … (task declares: …)", `:120-131` for AC), but they reach only `command.gate` stdout — no file — and a lint failure and a non-PASS verdict both exit 1 (`verdict.ts:59,106-108`), so the pipeline cannot tell a shape defect from a real FAIL and routes both to `remediate`.

Secondary, measured but cheaper: 340 file mutations went through shell (`291` `python3 - <<PY` heredocs, 248 of them on source/tests, plus 49 `sed -i`/`perl -pi`) against ~187 `write`/`edit` events; 59 full `bun run gate` runs and 148 `bun test` runs; 25 hand-rolled `--config=/tmp/credit-sentry-bunfig-focused.toml` invocations plus 5 `.spur/run/…/focused.bunfig.toml` (re-verified: `.spur/run/first-csv/focused.bunfig.toml` sets `coverage = false`) because the root `bunfig.toml` enforces `coverage = true` + `coverageThreshold = { lines = 0.9, functions = 0.9 }` on any root-cwd `bun test`; `spur task gate <wbs> light` already avoids that by running `cd <ws> && bun test …` (`plugins/sp/skills/spur-check/SKILL.md:37`, preset `packages/app/src/services/sdlc-actions.ts:40`) but the implement brief never sends the driver there; `.spur/run` is 570 MB / 594 entries (gitignored; `first-csv/` alone holds 3656 entries, mostly project test temp dirs whose fresh mtimes keep `spur workflow clean`'s scratch sweep — `packages/app/src/services/workflow-clean-ops.ts:264-297`, already recursive per top-level entry — from ever reclaiming them); one Claude session needed 7 context compactions (39.4M cache-read tokens, $16.97) and the operator had to restate batch state by hand.

Scope note: the hang fixes (R1–R3) are wiring of machinery that already ships (`command.gate` timeout + `ts-runtime` process groups, `spawnSync` timeout). Two behaviours are new: verdict replay (R4) and host-pause attribution (R7–R8). Two upstream gaps are **out of scope and recorded as deferrals**: `PipeProcessOptions` has no timeout (`@gobing-ai/ts-runtime`), and `phase_runs` never closes a `running` row (`@gobing-ai/ts-dual-workflow-engine`).

### Requirements

- [x] R1. **Inner gate bound — every spawn the gate makes.** `runShellCommand` (`packages/app/src/services/quality-gate.ts:796-821`) gains a per-spawn `timeout` + `killSignal: 'SIGKILL'` and reports `timedOut` (spawnSync `error.code === 'ETIMEDOUT'` / `signal === 'SIGKILL'`). The bound comes from a new `QualityGateEnv` field `gateTimeoutMs` (env `gateTimeoutMs`, read like the other fields at `:90-99`; default `900000`; a non-numeric or ≤0 value is a usage error, exit 2). Because `command.gate` passes workflow vars as env, a pipeline var `gateTimeoutMs` (default `"900000"`) reaches it with no new flag. This one change bounds all four callers (`:620`, `:743`, `:1273`, `:1302`), i.e. the CLI path **and** the pipeline path. Outcomes:
  - full-tier attempt (`:1302`) or recheck probe (`:1273`) timeout: stop the attempt loop, write `BLOCKED` to `.spur/run/<wbs>-test-gate.status`, write `gate timeout after <N>ms: <cmd>` followed by the last 40 log lines to `.spur/run/<wbs>-test-gate.findings`, write **no** check receipt (a FAIL receipt would arm the no-progress skip on an unchanged tree), exit 2;
  - light sub-check (`:743`) timeout: a failed row whose reason names the timeout; light-tier `git diff` (`:620`) timeout: exit 2 with the reason.
  A `ponytail:` comment on `runShellCommand` records the ceiling (`spawnSync` kills only the direct `sh`; grandchildren survive on the direct CLI path) and the upgrade path (`runBoundedChild`, `packages/app/src/services/bounded-child-run.ts:94-128`, once the gate chain is async).

- [x] R2. **Outer backstop + timeout coercion in `command.gate`.** (a) `command-gate.ts:158` accepts a numeric string (`"900000"`) as well as a number; any other non-number value is an action error naming the option, never silently ignored. (b) When the executor reports `outcome: 'timeout'`, the failure data carries `timedOut: true` and the elapsed bound. (c) `task-pipeline.yaml` declares var `gateBackstopMs` (default `"14400000"`, which must stay above lock wait 2 h + 5 × `gateTimeoutMs` + probe) and sets `timeoutMs: "${vars.gateBackstopMs}"` on the `quality-gate` `command.gate` (`:514-520`); the existing `gate → failed` on `BLOCKED` (`:981-988`) routes it. The finite deadline activates `ts-runtime` group ownership, so no descendant of the gate survives on the pipeline path.

- [x] R3. **Bound the formatter step.** Replace the implement-exit `shell` step `sh -c "$formatCmd" ; exit 0` (`task-pipeline.yaml:337`) with a `command.gate` (`executable: sh`, `args: ["-c", "${vars.formatCmd}"]`, `softFail: true`, `timeoutMs: "${vars.stepTimeoutMs}"`, its own `resultFile`). Best-effort semantics stay: a failing, missing or timed-out formatter never aborts the run. Bounding the generic `shell` action is **out of scope** (upstream: `ts-runtime` `PipeProcessOptions` has no timeout).

- [x] R4. **Verdict replay.** `spur task verdict <wbs> --from-answer <path> --replay`: after the lint passes and the verdict is derived, collect the `path:line`/`path:start-end` anchors from each derived row's `evidence` (`verify-verdict.ts:44-56`) with `extractBacktickLineAnchors` (`task-check.ts:229-253`), keep test files only (`*.test.ts`/`*.spec.ts`), dedupe, take at most 5, and run each through the `test-changed` SDLC binding (`sdlc-actions.ts:40`, `cd {workspace} && bun test {paths}`, grouped by owning workspace so the root coverage threshold does not apply), each spawn bounded to 120 s, **not** under the gate lock. A cited file that is missing, exits non-zero or times out downgrades a derived `PASS` to `PARTIAL` and adds one finding `{anchor, file, exitCode|timedOut|missing}`; the replayed file list is recorded in the verdict artifact. A non-PASS verdict is not upgraded. `--replay` is off by default; `task-pipeline`'s `review-verdict` `command.gate` (`:711-717`) passes it and gains `timeoutMs` (`"900000"`).

- [x] R5. **Lint-shape repair inside `review`.** (a) `spur task verdict` deletes `.spur/run/<wbs>-verdict-lint.txt` at the start of every invocation and, on lint failure, writes the lint findings there (exit code unchanged: 1). (b) A new last `onEnter` step of the `review` state writes `.spur/run/$__runId-review-lint-retry` = `RETRY` when the lint file is non-empty and `.spur/run/$__runId-review-lint-retried` is absent (then touches `-retried` and removes the run's `-review-cert.md` and `-review-answer.txt` so the re-entry copies a fresh answer), otherwise `NONE`. (c) A new transition `review → review`, declared after the denial route and before `retry-exhausted`, guarded by the token being `RETRY`. Net effect: one inline re-review per run before any `remediate` hop; a second lint failure routes as today. The review prompt template appends the lint file contents when present (within the 1000-char cap). `spur workflow validate` passes on the edited YAML.

- [x] R6. **Driver guidance where it is read.** `plugins/sp/skills/code-implementation/SKILL.md` names `spur task gate <wbs> light` as the focused test run (no hand-rolled `bunfig.toml`, no root-cwd `bun test`), and states that source/doc mutation goes through Edit/Write — a `python3 - <<PY`, `sed -i` or `perl -pi` file mutation is a defect. The same mutation rule lands in `plugins/sp/skills/spur-dev/references/execution-workflow.md` (inline driver). `plugins/sp/skills/spur-check/SKILL.md:37` already names `light`; leave it.

- [x] R7. **Host-pause attribution.** On resume of a host pause (`workflow-resume-ops.ts:214-217`), append `{node, action, pausedAt, resumedAt, hostDurationMs, executor}` to run metadata `hostPauses[]` via `RunDao.mergeMetadata`, where `pausedAt` is the paused `action_runs.started_at` and `resumedAt` is the resume instant. When the host receipt's `startedAt`/`finishedAt` are missing, equal, or inverted, Spur stamps `startedAt = pausedAt`, `finishedAt = resumedAt` before `writeReceipt` (a valid host interval is kept verbatim). `spur workflow profile` and `spur workflow cost` report host-pause wall clock per node from `hostPauses[]` instead of the 2–3 ms action row. Closing `phase_runs` rows is **out of scope** (engine-owned, `ts-dual-workflow-engine`).

- [x] R8. **Stalled visibility.** A derived `stalled` label (no new persisted status) in `spur workflow profile`, `spur workflow cost` and `spur workflow trace`: a run whose status is `paused` and whose current pause has lasted longer than that node's declared `agent.run` `timeoutMs` (fallback `stepTimeoutMs`). The output shows the pause duration and the hint `spur workflow continue <run-id>`. Profile's done-runs sampling stays; stalled runs are listed separately. `spur workflow clean` does **not** finalize paused runs (`run-dao.ts:259-263` covers running/pending only), and this task keeps that.

- [x] R9. **Run-dir hygiene (docs only).** Document in `plugins/sp/skills/code-testing/SKILL.md` (or the testing section of `code-implementation`) that project tests create temp dirs under the OS temp dir, never under `.spur/run`. `spur workflow clean` retention is unchanged (its scratch sweep, `workflow-clean-ops.ts:264-297`, already recurses per top-level entry).

### Acceptance Criteria

```gherkin
Scenario: AC1 — A hanging gate command on the CLI path is bounded and lands as BLOCKED with repairable findings (req: R1)
  Given a project whose qualityGateCmd is 'sleep 3600'
  When `spur task gate <wbs> run` runs with env gateTimeoutMs=2000
  Then the command exits 2 within 10 s
  And `.spur/run/<wbs>-test-gate.status` holds BLOCKED, never FAIL
  And `.spur/run/<wbs>-test-gate.findings` starts with "gate timeout after 2000ms" and carries the log tail
  And no check receipt is written for that tree
  And the direct `sh` child of the gate is no longer alive

Scenario: AC2 — Light sub-checks and the recheck probe share the bound (req: R1)
  Given gateTimeoutMs=2000 and a light sub-check or gateProbeCmd that sleeps 3600 s
  When `spur task gate <wbs> light` or `spur task gate <wbs> recheck` runs
  Then it returns within 10 s
  And the light row or the recheck status names the timeout instead of hanging

Scenario: AC3 — The pipeline gate visit has a group-owned backstop (req: R2)
  Given `config/workflows/task-pipeline.yaml` at the fixed version
  Then the quality-gate command.gate declares timeoutMs "${vars.gateBackstopMs}"
  And gateBackstopMs exceeds 2 h + 5 × gateTimeoutMs
  When a command.gate whose command spawns a grandchild `sleep 3600` exceeds a 2000 ms timeoutMs
  Then the result file holds BLOCKED and the action data carries timedOut true
  And no descendant of that command is alive afterwards

Scenario: AC4 — command.gate honours a string timeout and rejects a malformed one (req: R2)
  Given a command.gate step with timeoutMs "2000" running 'sleep 3600'
  When the step executes
  Then it is bounded at about 2000 ms
  And a step with timeoutMs "abc" fails with an error naming the timeoutMs option

Scenario: AC5 — The formatter step is bounded and stays best-effort (req: R3)
  Given formatCmd is 'sleep 3600' and stepTimeoutMs is 2000
  When a task-pipeline run leaves implement
  Then the formatter step ends within the bound
  And the run proceeds to gate, as it does when the formatter fails or is missing

Scenario: AC6 — A verdict's cited tests are replayed and a false PASS is downgraded (req: R4)
  Given a task whose R1 evidence cites `apps/cli/tests/a.test.ts:10-20` and that test currently fails
  And a verify answer that lints clean and derives PASS
  When `spur task verdict <wbs> --from-answer <path> --replay` runs
  Then `.spur/run/<wbs>-verdict.json` holds PARTIAL, not PASS
  And one finding names the anchor, the file and the exit code
  And a cited file that does not exist yields a finding marked missing
  And when every cited test file passes the verdict stays PASS and the artifact lists the replayed files
  And at most 5 distinct files run, each bounded to 120 s, from the owning workspace, outside the gate lock
  And without `--replay` no test is executed

Scenario: AC7 — A lint-shape defect costs one inline re-review, not a remediate hop (req: R5)
  Given a review answer that declares a requirement row the task does not declare
  When the review state's review-verdict lint fails
  Then `.spur/run/<wbs>-verdict-lint.txt` holds the lint findings
  And the run takes `review → review` once, with the stale cert and answer removed
  And the re-issued review prompt carries the lint findings
  And a conforming answer on the retry reaches done without entering remediate
  And a second lint failure in the same run routes to remediate as today
  And `spur workflow validate config/workflows/task-pipeline.yaml` passes
  And a later clean lint removes `.spur/run/<wbs>-verdict-lint.txt`

Scenario: AC8 — A host pause is measured (req: R7)
  Given a task-pipeline run with the host executor that pauses at implement for at least 60 s
  And the host writes a receipt whose startedAt equals finishedAt
  When the run is resumed with `spur workflow continue` and reaches done
  Then run metadata hostPauses holds an implement entry whose hostDurationMs matches the pause within 2 s
  And the persisted implement receipt's startedAt and finishedAt differ by that duration
  And `spur workflow profile task-pipeline` and `spur workflow cost` report a non-zero implement host time for that run
  And a host receipt with a valid interval is persisted unchanged

Scenario: AC9 — A stalled pause is visible and resumable (req: R8)
  Given a run paused at implement for longer than that node's agent.run timeoutMs
  When `spur workflow trace <run-id>`, `spur workflow profile task-pipeline` or `spur workflow cost` inspects it
  Then the run is labelled stalled with its pause duration and the hint `spur workflow continue <run-id>`
  And the persisted run status is still paused
  And `spur workflow clean` leaves the run untouched
  And `spur workflow continue <run-id>` resumes from implement without re-running completed nodes

Scenario: AC10 — Focused-run, mutation and temp-dir rules are documented where they are read (req: R6, R9)
  Given `plugins/sp/skills/code-implementation/SKILL.md`, `plugins/sp/skills/spur-dev/references/execution-workflow.md` and `plugins/sp/skills/code-testing/SKILL.md`
  Then code-implementation names `spur task gate <wbs> light` as the focused test run and forbids hand-rolled bunfig files
  And code-implementation and execution-workflow treat a `python3 - <<PY`, `sed -i` or `perl -pi` file mutation as a defect and require Edit/Write
  And code-testing states that project tests create temp dirs outside `.spur/run`
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-08T17:49:27.748Z

**Q1 — One task or eight?** One task, so the post-mortem evidence and the eight fixes stay coupled; R1/R3 (the P0 hang) ship first and can close the task's most expensive item alone. Expect the implement agent to touch ~8 files, not one module.

**Q2 — Config or code for the gate bound?** Config: `command.gate` already accepts `timeoutMs` and `@gobing-ai/ts-runtime` already owns process-group kill. Adding it to YAML is one line and is reversible with `--vars`. Deliberately *not* adding a new "gate timeout" flag to `spur task gate`; the existing `--cmd`/env surface is enough.

**Q3 — Why not just fix `runShellCommand` and skip R1/R2?** Because the pipeline path never calls it: `task gate` → `runQualityGate` uses it, but the YAML `command.gate` step goes through `ProcessExecutor`. Bounding one leaves the other hanging, and yesterday's hang happened in both.

**Q4 — `spawnSync` or a rewrite for `runShellCommand`?** `spawnSync` plus `timeout`/`killSignal` now, with a `shortcut:` comment naming the known limit (grandchildren survive). A full move onto `ProcessExecutor` needs the caller chain to go async — out of scope here, and the pipeline path (R1/R2) is already group-safe.

**Q5 — Replay scope.** Replay executes only test *files* cited in R/AC evidence rows, not arbitrary prose commands: the anchor grammar is already parsed by `spur task migrate-anchors`, it is deterministic, and a failing cited file is exactly the defect class that survived the 2026-11-07 batch (wrong fixtures, missing cases). Bounded to 5 files × 120 s with coverage off so the replay can never become a second full gate (see 1127's gate-contention finding).

**Q6 — Public surface.** `--replay` is a new flag on an existing verb, not a new noun/verb. Operator consent for that surface is recorded in the 2026-11-08 request that filed this task ("file all P0+P1+P2 findings"); the AC row above is the design context. No new noun, and explicitly no `spur task next` (R8's question is answered by `batch-plan`/`preflight` + the `sp-dev-find-next` skill).

**Q7 — Stalled vs. cancelled.** A paused run past its budget is not failed — it stays resumable (the `first-csv-0001` run was *cancelled* at 11h36m and the operator re-ran as `-r2` for 123 s of real work). `stalled` is a report + hint state that `workflow clean` can finalize if the operator never returns.

#### Q&A entry — 2026-11-08T18:08:24.403Z

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-08T17:49:27.748Z

**Q1 — One task or eight?** One task, so the post-mortem evidence and the fixes stay coupled; R1–R3 (the P0 hang) ship first and can close the task's most expensive item alone. Expect the implement agent to touch ~10 files, not one module.

**Q2 — Config or code for the gate bound?** Both, and both small. *(Amended 2026-11-08 refinement.)* The real bound is code: `runShellCommand` is the spawn on **both** paths, so it gets a per-spawn `timeout` fed by env `gateTimeoutMs` (R1). The YAML adds only the outer group-owned backstop (`gateBackstopMs`, R2). No new flag on `spur task gate`; the var reaches the CLI as env because `command.gate` exports workflow vars.

**Q3 — Why not just fix `runShellCommand` and skip R1/R2?** *(Corrected 2026-11-08 refinement — the original answer was wrong.)* The pipeline path **does** call it: `command.gate` → `spur task gate <wbs> <mode>` → `qualityGateMain` → `runQualityGate`/`runLightGate` → `runShellCommand` (`task-pipeline.yaml:514-520`, `quality-gate.ts:1302`). Fixing `runShellCommand` therefore bounds both paths (R1). The `command.gate` backstop (R2) is still worth one line because only a finite `ProcessExecutor` deadline gives process-group ownership, which reaps grandchildren `spawnSync` cannot reach.

**Q4 — `spawnSync` or a rewrite for `runShellCommand`?** `spawnSync` plus `timeout`/`killSignal` now, with a `ponytail:` comment naming the ceiling (grandchildren survive on the direct CLI path). The upgrade is `runBoundedChild` (`bounded-child-run.ts:94-128`, async, group-owned, SIGTERM→SIGKILL); it needs the gate chain to go async (~70 call sites across 8 test files plus `apps/cli/src/commands/task/gate.ts`), so it is out of scope. On the pipeline path the R2 backstop already gives group safety.

**Q5 — Replay scope.** Replay executes only test *files* cited in derived verdict row evidence, not arbitrary prose commands. *(Amended 2026-11-08 refinement.)* The parser is `extractBacktickLineAnchors` (`task-check.ts:229-253`), not `migrate-anchors` (that verb is the anchor *qualifier*). It runs through the `test-changed` binding from the owning workspace, so the root coverage threshold does not apply and no coverage flag is needed. Bounded to 5 files × 120 s and outside the gate lock, so the replay cannot become a second full gate (1127).

**Q6 — Public surface.** `--replay` is a new flag on an existing verb, not a new noun/verb. Operator consent for that surface is recorded in the 2026-11-08 request that filed this task ("file all P0+P1+P2 findings"); AC6 is the design context. No new noun, and explicitly no `spur task next`.

**Q7 — Stalled vs. cancelled.** A paused run past its budget is not failed. It stays resumable: the `first-csv-0001` run was *cancelled* at 11h36m and the operator re-ran it as `-r2` for 123 s of real work. *(Amended 2026-11-08 refinement.)* `stalled` is a derived report + hint label. `workflow clean` does **not** finalize it: stale finalization covers only `running`/`pending` (`run-dao.ts:259-263`), and auto-failing a resumable run would destroy the very state the hint points at.

#### Q&A entry — 2026-11-08 refinement (pre-delegation review)

**Q8 — What changed in this refinement and why?** Every file:line in the spec was re-checked against the dev tree. These were corrected:
- The CLI and pipeline gate paths are the same path (Q3 rewritten).
- `command.gate` silently drops a string `timeoutMs` (`command-gate.ts:158`, `typeof === 'number'`), and every `${vars.*}` template is a string. The original R1 YAML-only fix would have been a no-op, so R2(a) coerces strings.
- The original R2 (`shell` action `timeoutMs`) is not implementable here: `ProcessExecutor.runStreaming` takes `PipeProcessOptions`, which has no timeout (`ts-runtime` 0.7.1). It is deferred upstream. The one shell step that runs a project command, the formatter at `:337`, moves to `command.gate` instead (R3).
- `phase_runs` is written by `ts-dual-workflow-engine` and is append-only, so closing rows is deferred upstream. Attribution lands in run metadata `hostPauses[]` (R7).
- `workflow clean` does not finalize paused runs (Q7). Stalled is checked through `trace`, because `list` has no derived-label column.
- The orphaned `bun test redact.test.ts` launcher is unverified (Background G2).
- Paths were wrong: the skill is `spur-check`, not `sp-spur-check`; `inline-pipeline-driver.md` does not exist (the reference is `execution-workflow.md`); the implement brief is `code-implementation/SKILL.md`.
- `.spur/run` is gitignored, so it is not "tracked".
- `workflow clean` scratch retention is already recursive, so the old R10 retention change was dropped and only the temp-dir rule (R9) remains.

**Q9 — Why drop "declared R/AC ids as prompt vars" (old R7a)?** The lint findings already name the declared ids (`verify-answer-lint.ts:82`, `:120-131`), and the review prompt is near its 1000-char cap. Feeding the lint text back on the inline retry (R5) delivers the ids exactly when they are needed, at no prompt cost on the happy path.

**Q10 — How is a lint failure told apart from a real non-PASS?** Exit codes stay as they are (both 1, `verdict.ts:59,106-108`), because changing them would change `command.gate`'s typed outcome for every caller. The distinguishing signal is the new lint file, which `verdict` writes only on lint failure and clears on every invocation. The retry token is run-scoped (`$__runId-review-lint-retry`), so a stale file from an earlier run cannot trigger a retry. The approval `hitl.confirm` runs once per review visit, which is the same count today's remediate → gate → review loop costs, so the retry adds no extra prompt relative to the route it replaces. The extra state visit fits `iterationBound: 20` (`task-pipeline.yaml:76`).

**Q11 — Why no receipt on a gate timeout?** A FAIL receipt keyed to the tree hash arms the no-progress skip. The next visit on the same tree would then short-circuit as an unchanged red gate instead of retrying a transient hang. BLOCKED with no receipt routes `gate → failed` (`:981-988`) and leaves the tree re-gateable.

**Deferrals (upstream, `/Users/robin/xprojects/ts-libs`):**
- (D1) `@gobing-ai/ts-runtime`: a `timeout` on `PipeProcessOptions`, so the generic `shell` action can be bounded.
- (D2) `@gobing-ai/ts-dual-workflow-engine`: close `running` `phase_runs` rows on pause/resume.

Neither blocks this task's AC.

### Design

Invariant: the engine owns determinism. Every bound is enforced by Spur code or `@gobing-ai/ts-runtime`; none relies on asking a model to be careful. There is no new noun or verb, and one new opt-in flag (`--replay`). Exit-code contracts are unchanged.

| Req | Surface | Why there |
| --- | --- | --- |
| R1 inner bound | `packages/app/src/services/quality-gate.ts` — `QualityGateEnv` (`:90-99`), `runShellCommand` (`:796-821`), its timeout handling at the attempt loop (`:1302`), probe (`:1273`) and light (`:620`, `:743`); status write (`:1357-1359`); `qualityGateMain` exit mapping (`:1416-1470`) | It is the single spawn shared by the CLI and pipeline paths, so one guard covers all callers |
| R2 backstop | `packages/app/src/workflow/actions/command-gate.ts:158` (coerce), failure data (`timedOut` from `ProcessResult.outcome === 'timeout'`); `task-pipeline.yaml` vars block (~`:113-160`) + quality-gate step (`:514-520`) | A finite deadline is what activates `ts-runtime` group ownership (`dist/process-group.js:93-136`) |
| R3 formatter | `task-pipeline.yaml:337` | It is the only `shell` step that runs a project command; `command.gate` is the bounded action that already exists |
| R4 replay | `apps/cli/src/commands/task/verdict.ts` (flag + wiring) + a small `packages/app/src/services/verdict-replay.ts` (pure: rows → files; runner via injected executor) | Verdict derivation is the only place a PASS becomes durable. The app layer owns logic (ADR-021) |
| R5 lint retry | `verdict.ts:39-61` (lint file write/clear); `task-pipeline.yaml` review `onEnter` (new last step) + transitions (`:1034-1082`) + review prompt (~`:640-693`) | The state graph already owns the retry; the lint already produces the findings text |
| R6 / R9 docs | `plugins/sp/skills/code-implementation/SKILL.md`, `plugins/sp/skills/spur-dev/references/execution-workflow.md`, `plugins/sp/skills/code-testing/SKILL.md` | The implement driver reads these files; `spur-check/SKILL.md:37` is already correct |
| R7 attribution | `packages/app/src/services/workflow-resume-ops.ts` (`:214-217`, `resolveHostPauseReceipt` ~`:286-320`); `RunDao.mergeMetadata` (`packages/domain/src/dao/run-dao.ts:137`); profile/cost projections | Resume is the only Spur-owned moment that sees both ends of the pause. `phase_runs`/`action_runs` rows are engine-owned |
| R8 stalled | profile / cost / trace projections only | Derived label: no schema change, no new status |

Implementation notes the implementer must respect:

- **R1 timeout detection.** With `spawnSync`, a timeout shows up as `result.error?.code === 'ETIMEDOUT'` (and `signal === 'SIGKILL'`). Return `{ exitCode, output, timedOut }` rather than throwing, so callers stay linear. On a timeout, BLOCKED is a third status-file value. Check that `-test-gate.status` readers (`failure-class` decide step, `gate` transitions) treat an unknown or BLOCKED token as non-PASS: grep `test-gate.status` before you write.
- **R2 coercion.** Use `Number(x)` with `Number.isFinite(n) && n > 0`, matching `agent-run.ts` `asOptionalNumber` (`:1963-1971`). Reject anything else with `{ ok: false, error: 'command.gate: timeoutMs must be a positive number' }`.
- **R4 runner.** Group files by workspace (nearest `package.json` under `apps/*`/`packages/*`, root otherwise) and expand the `test-changed` template per group. Spawn through `ProcessExecutor.run` with `timeout: 120_000`, which gives group ownership. Run sequentially: at most 5 files, so parallelism buys nothing. Write the downgrade into the same artifact `verdict.ts:93-96` writes; the exit stays 1 for non-PASS (`:106-108`).
- **R5 ordering.** Transitions are first-match in declaration order (`ts-dual-workflow-engine` `state-machine.js:139`). The new `review → review` goes after `review → failed (cancelled)` and before `retry-exhausted`, because a lint retry is not a fix attempt. The prep step must run **after** the review fold (`:730`) and the operator-answer fold (last onEnter shell), because deleting the answer earlier would make the fold read a stale `<wbs>-verdict.json` as PASS.
- **R7 merge.** `mergeMetadata` merges a patch, so read the current `hostPauses` array, append, and write it back. Receipts are degenerate when `startedAt` or `finishedAt` is missing or unparsable, or when `finishedAt <= startedAt`.
- **R8 budget lookup.** Use the paused node's `agent.run` `timeoutMs` (string → number as above), falling back to the `stepTimeoutMs` var. Compute pause start from the paused `action_runs.started_at`.

Boundaries to keep:

- **Replay is not a second full gate** (1127): it runs cited files only, bounded, from the workspace, outside the gate lock.
- **No timer around model work.** R7/R8 time and label the *pause*; they never kill or fail a paused run.
- **Two upstream deferrals** (Q&A D1/D2) stay out of this diff. Do not vendor-patch `node_modules`.

### Plan

- [x] 1. **P0 inner bound (R1).** Write the failing proofs first: `spur task gate <wbs> run` with `qualityGateCmd='sleep 3600'` and `gateTimeoutMs=2000` (AC1), plus the light and recheck variants (AC2). Then add `gateTimeoutMs` to `QualityGateEnv`, add the timeout to `runShellCommand`, write BLOCKED + findings tail with no receipt, exit 2, and add the `ponytail:` comment. Add the `gateTimeoutMs: "900000"` var to `task-pipeline.yaml`. Tests go in `packages/app/tests/` mirroring the service; run them from the workspace.
- [x] 2. **P0 backstop (R2).** Proofs first: a string `timeoutMs` is honoured, a malformed one errors, and a grandchild `sleep` is reaped on timeout with `timedOut: true` (AC3/AC4). Then add the coercion and `timedOut` in `command-gate.ts`, and the `gateBackstopMs` var + `timeoutMs` on the quality-gate step.
- [x] 3. **P0 formatter (R3).** Swap `task-pipeline.yaml:337` to `command.gate` with softFail and `timeoutMs: "${vars.stepTimeoutMs}"`. Proof: a workflow test with `formatCmd='sleep 3600'` and a short step timeout still reaches gate (AC5). Run `spur workflow validate config/workflows/task-pipeline.yaml`.
- [x] 4. **P0 replay (R4).** Proofs first (AC6): one failing cited file → PARTIAL + finding; a missing file → finding; all pass → PASS + file list; more than 5 cited → only 5 run; no `--replay` → nothing runs. Then add `verdict-replay.ts` in `packages/app`, the `--replay` flag in `verdict.ts`, and `--replay` + `timeoutMs: "900000"` on the pipeline `review-verdict` step.
- [x] 5. **P1 lint retry (R5).** Proofs first (AC7): the lint file is written on lint failure and cleared on a clean lint; the pipeline takes `review → review` once, then remediate. Then edit `verdict.ts` for the lint file, and in `task-pipeline.yaml` add the review prep step, the `review → review` transition and the prompt append. Run `spur workflow validate`.
- [x] 6. **P1 attribution (R7).** Proof first (AC8): resume a host-paused run 60 s later with a degenerate receipt and assert `hostPauses[]`, the stamped receipt, and non-zero profile/cost; a valid receipt stays verbatim. Use an injected clock, not a real 60 s sleep. Then implement it in `workflow-resume-ops.ts` + the profile/cost projections.
- [x] 7. **P1 stalled (R8).** Proof first (AC9): a paused run older than its `agent.run` `timeoutMs` (injected clock) shows `stalled` + hint in trace/profile/cost; `workflow clean` leaves it alone; `continue` resumes at implement. Then add the projection label.
- [x] 8. **P2 docs (R6, R9).** Edit `code-implementation/SKILL.md`, `spur-dev/references/execution-workflow.md` and `code-testing/SKILL.md` (AC10). Run `superskill skill validate` on the touched skills if available.
- [x] 9. **Doc sync + gate.** Update `docs/03_ARCHITECTURE.md` (gate timeout layering, host-pause attribution, replay seam), `docs/04_DESIGN.md` and the owning satellite (`task verdict --replay`, `gateTimeoutMs`/`gateBackstopMs` vars, `command.gate` string timeout, derived `stalled`). After CLI changes, run `bun link` in `apps/cli` + `bun run --filter @gobing-ai/spur build:bundle`. Then `bun run spur-check`, and `bun run spur-check-feature` once for the feature pass. Record D1/D2 as upstream follow-ups in ts-libs (issue or task), not in this diff.

### Solution

- **R1 (gate bound):** `packages/app/src/services/quality-gate.ts:92` adds `resolveGateTimeoutMs`; `packages/app/src/services/quality-gate.ts:856` gives `runShellCommand` its `timeout` + `timedOut` and the `ponytail:` ceiling comment; `packages/app/src/services/quality-gate.ts:652` bounds the changed-path read and `packages/app/src/services/quality-gate.ts:745` records the light tier's `blocked` reason; `packages/app/src/services/quality-gate.ts:1431` writes `BLOCKED` plus the findings header and returns before any receipt; `packages/app/src/services/quality-gate.ts:1517` validates the bound up front and `packages/app/src/services/quality-gate.ts:1576` maps `BLOCKED` to exit 2.
- **R2 (backstop + coercion):** `packages/app/src/workflow/actions/command-gate.ts:36` adds `asOptionalTimeoutMs` (numeric string accepted, anything else an error naming the option); `packages/app/src/workflow/actions/command-gate.ts:210` captures `res.outcome === 'timeout'` and `packages/app/src/workflow/actions/command-gate.ts:251` carries `timedOut: true` plus the bound `timeoutMs` in the failure data. The YAML declares `gateBackstopMs` and applies it at `config/workflows/task-pipeline.yaml:545`.
- **R3 (formatter):** `config/workflows/task-pipeline.yaml:354-361` — the implement-exit formatter is now a `command.gate` with `softFail: true` and `timeoutMs: "${vars.stepTimeoutMs}"`; best-effort semantics unchanged.
- **R4 (replay):** `packages/app/src/services/verdict-replay.ts:65`/`packages/app/src/services/verdict-replay.ts:80`/`packages/app/src/services/verdict-replay.ts:90` (selection, workspace, runner); `apps/cli/src/commands/task/verdict.ts:15` adds `--replay` and `apps/cli/src/commands/task/verdict.ts:120` performs the PASS→PARTIAL downgrade; the pipeline step passes the flag at `config/workflows/task-pipeline.yaml:751`.
- **R5 (lint repair):** `apps/cli/src/commands/task/verdict.ts:55` clears/rewrites the lint file; `config/workflows/task-pipeline.yaml:177` declares `reviewLint`, `config/workflows/task-pipeline.yaml:712` echoes it into the prompt, and `config/workflows/task-pipeline.yaml:810` sets the run-scoped retry token consumed by the new `review → review` transition.
- **R6 (docs):** `plugins/sp/skills/code-implementation/SKILL.md:195` and `plugins/sp/skills/spur-dev/references/execution-workflow.md:67` name `spur task gate <wbs> light` as the focused run and treat a shell file mutation as a defect.
- **R7 (attribution):** `packages/app/src/workflow/host-pause.ts:14` defines `HostPause`, `:33` reads it back and `:90` resolves the stall budget; `packages/app/src/services/workflow-resume-ops.ts:299` implements `recordHostPause` (called at `packages/app/src/services/workflow-resume-ops.ts:223` before the receipt persists); `packages/app/src/services/workflow-trace-projection.ts:110` projects `hostPauses` and `packages/app/src/workflow/step-profile.ts:64` attributes `hostMs` per (node, action) row so a sibling action never inherits another action's pause. `packages/app/src/workflow/run-measurements.ts:260` folds the same pauses into a per-state `hostMs` for `spur workflow cost --by-state` (read by `packages/domain/src/analytics/workflow-measurements.ts:246`), printed as `host=` at `packages/app/src/workflow/run-cost.ts:100`.
- **R8 (stalled):** `packages/app/src/services/workflow-trace-projection.ts:117` derives `stalled`/`stalledMs` without touching the persisted status; `apps/cli/src/commands/workflow/trace.ts:60` prints the label with the `spur workflow continue` hint. The node budget is recorded on the host pause (`packages/app/src/workflow/actions/agent-run.ts:596`) and read back by `packages/app/src/workflow/host-pause.ts:122` (`pausedNodeBudgetMs`), used by `packages/app/src/services/workflow-inspect-ops.ts:279`/`:296`. `runs.updated_at` is INTEGER epoch ms: `packages/domain/src/dao/run-dao.ts:111` now selects it and `packages/app/src/workflow/host-pause.ts:109` parses it. `spur workflow profile` lists stalled runs (`packages/app/src/workflow/step-profile.ts:132`, from a second `trace --status paused` call at `packages/app/src/workflow/step-profile-cli.ts:156`; `apps/cli/src/commands/workflow/trace.ts:21` accepts `paused|interrupted`); `spur workflow cost` prints stalled lines in text mode only (`packages/app/src/workflow/run-measurements.ts:303`, `packages/app/src/workflow/run-cost.ts:106`, `apps/cli/src/commands/workflow/cost.ts:104`) so `cost --json` stays byte-stable.
- **R9 (temp dirs):** `plugins/sp/skills/code-testing/SKILL.md:67` states project tests create scratch dirs outside `.spur/run`.

Tests: `packages/app/tests/services/quality-gate-timeout.test.ts` (6 cases, incl. the light-tier timeout at `:110`), `packages/app/tests/services/verdict-replay.test.ts`, `packages/app/tests/workflow/host-pause.test.ts`, `packages/app/tests/workflow/actions/command-gate.test.ts` (incl. the grandchild reap at `:477`), `packages/app/tests/workflow/run-measurements.test.ts`, `packages/app/tests/workflow/run-cost.test.ts`, `packages/app/tests/workflow/step-profile-cli.test.ts`, `packages/app/tests/services/workflow-inspect-ops.test.ts`, `packages/app/tests/services/workflow-resume-ops.test.ts`, `packages/app/tests/workflow/actions/agent-run-completion.test.ts`, `apps/cli/tests/commands/workflow/trace.test.ts`. `packages/app/tests/services/quality-gate.test.ts:263` was updated for the new `timedOut` field.

Docs: `docs/design/gate-bounds-and-pause-attribution.md` (new satellite, indexed at `docs/04_DESIGN.md:112`) and the §6 note at `docs/03_ARCHITECTURE.md:245`.

**Not implemented, recorded:** `phase_runs` closing and a bound for the generic `shell` action stay upstream (D1/D2). Public-flag change: `spur workflow trace --status` now also accepts `paused` and `interrupted` (additive).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/quality-gate.ts:1433` writes the timeout header before any receipt; `packages/app/tests/services/quality-gate-timeout.test.ts:46` (full tier BLOCKED, exit 2), `packages/app/tests/services/quality-gate-timeout.test.ts:110` (light sub-check timeout named on its row), `packages/app/tests/services/quality-gate-timeout.test.ts:91` (malformed bound is a usage error) |
| R2 | MET | `packages/app/tests/workflow/actions/command-gate.test.ts:418` (numeric string honoured, timedOut), `packages/app/tests/workflow/actions/command-gate.test.ts:440` (malformed bound names the option), `packages/app/tests/workflow/actions/command-gate.test.ts:477` (grandchild reaped, BLOCKED, timeoutMs recorded); backstop var applied at `config/workflows/task-pipeline.yaml:545` |
| R3 | MET | `packages/app/tests/workflow/task-pipeline-gate-bounds-and-lint-retry.test.ts:102` — a hanging formatCmd ends at the bound and never fails the chain |
| R4 | MET | `packages/app/tests/services/verdict-replay.test.ts:88` (failing and missing files are findings), `packages/app/tests/services/verdict-replay.test.ts:193` (coverage-threshold workspace skipped with a reason), `apps/cli/tests/commands/task/verdict.test.ts:560` (CLI --replay downgrades PASS to PARTIAL) |
| R5 | MET | `packages/app/tests/workflow/task-pipeline-gate-bounds-and-lint-retry.test.ts:152` (RETRY routes review to review), `packages/app/tests/workflow/task-pipeline-gate-bounds-and-lint-retry.test.ts:175` (second failure falls to remediate); lint file write/clear at `apps/cli/src/commands/task/verdict.ts:56` |
| R6 | MET | `plugins/sp/skills/code-implementation/SKILL.md:195` and `plugins/sp/skills/spur-dev/references/execution-workflow.md:70` name the light gate and the shell-mutation defect |
| R7 | MET | Resume records hostPauses and stamps degenerate receipts: `packages/app/tests/services/workflow-host-executor.test.ts:233`; profile host time per action row: `packages/app/tests/services/workflow-resume-ops.test.ts:152`; cost per-state host time: `packages/app/tests/workflow/run-measurements.test.ts:235` and `packages/app/tests/workflow/run-cost.test.ts:621`; real-DB run in `.spur/run/1319-e2e.txt` |
| R8 | MET | Trace stalled label with continue hint: `packages/app/tests/services/workflow-resume-ops.test.ts:127`; node budget recorded on the pause `packages/app/tests/workflow/actions/agent-run-completion.test.ts:230` and honoured in trace `packages/app/tests/services/workflow-inspect-ops.test.ts:107`; profile stalled list `packages/app/tests/workflow/step-profile-cli.test.ts:408`; cost stalled lines `packages/app/tests/workflow/run-measurements.test.ts:275`; trace accepts paused/interrupted `apps/cli/tests/commands/workflow/trace.test.ts:186` |
| R9 | MET | `plugins/sp/skills/code-testing/SKILL.md:67` — temp dirs never under .spur/run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — A hanging gate command on the CLI path is bounded and lands as BLOCKED with repairable findings (req: R1) | MET | test | `packages/app/tests/services/quality-gate-timeout.test.ts:46` |
| Scenario: AC2 — Light sub-checks and the recheck probe share the bound (req: R1) | MET | test | `packages/app/tests/services/quality-gate-timeout.test.ts:110` (light row names `timeout after 300ms`, returns under 4 s) and `packages/app/tests/services/quality-gate-timeout.test.ts:68` (recheck probe BLOCKED) |
| Scenario: AC3 — The pipeline gate visit has a group-owned backstop (req: R2) | MET | test | `packages/app/tests/workflow/actions/command-gate.test.ts:477` (grandchild `sleep 3600` dead after a 2000 ms timeout, BLOCKED, timedOut true); backstop declared at `config/workflows/task-pipeline.yaml:545` |
| Scenario: AC4 — command.gate honours a string timeout and rejects a malformed one (req: R2) | MET | test | `packages/app/tests/workflow/actions/command-gate.test.ts:418` and `packages/app/tests/workflow/actions/command-gate.test.ts:440` |
| Scenario: AC5 — The formatter step is bounded and stays best-effort (req: R3) | MET | test | `packages/app/tests/workflow/task-pipeline-gate-bounds-and-lint-retry.test.ts:102` |
| Scenario: AC6 — A verdict's cited tests are replayed and a false PASS is downgraded (req: R4) | MET | test | `apps/cli/tests/commands/task/verdict.test.ts:560` and `packages/app/tests/services/verdict-replay.test.ts:88` |
| Scenario: AC7 — A lint-shape defect costs one inline re-review, not a remediate hop (req: R5) | MET | test | `packages/app/tests/workflow/task-pipeline-gate-bounds-and-lint-retry.test.ts:152` and `packages/app/tests/workflow/task-pipeline-gate-bounds-and-lint-retry.test.ts:175` |
| Scenario: AC8 — A host pause is measured (req: R7) | MET | test | `packages/app/tests/services/workflow-host-executor.test.ts:233`, `packages/app/tests/workflow/run-measurements.test.ts:235`, `packages/app/tests/services/workflow-resume-ops.test.ts:152` |
| Scenario: AC9 — A stalled pause is visible and resumable (req: R8) | MET | test | `packages/app/tests/services/workflow-resume-ops.test.ts:127`, `packages/app/tests/services/workflow-inspect-ops.test.ts:107`, `packages/app/tests/workflow/step-profile-cli.test.ts:408`, `packages/app/tests/workflow/run-measurements.test.ts:275` |
| Scenario: AC10 — Focused-run, mutation and temp-dir rules are documented where they are read (req: R6, R9) | MET | command | `rg -n "spur task gate <wbs> light" plugins/sp/skills/code-implementation/SKILL.md` hits `plugins/sp/skills/code-implementation/SKILL.md:195`; `rg -n "never under" plugins/sp/skills/code-testing/SKILL.md` hits `plugins/sp/skills/code-testing/SKILL.md:67` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: HIGH

Verdict: PASS

**Process disclosure.** This review ran on the host executor (`--agent inline`) over a diff the same
session implemented, so the reviewer is not independent of the implementer. The rows below cite
executable evidence that was actually run in this tree; the judgments are self-assessed.

| Sev | Finding | Disposition |
| --- | --- | --- |
| P2 | The derived `stalled` label could never fire: `traceRowById` selected no `updated_at`, so the pause anchor was always `undefined` | RESOLVED — `packages/domain/src/dao/run-dao.ts:57` selects it; anchor consumed at `packages/app/src/services/workflow-trace-projection.ts:117` |
| P2 | `replayCitedTests` treated an *unbound* `test-changed` binding as a missing file and downgraded an otherwise-earned PASS | RESOLVED — an unbound binding now skips the file (`packages/app/src/services/verdict-replay.ts:118`), covered by a test |
| P3 | `pausedAt` is the paused action row's `started_at`; an action that ran for minutes before pausing overstates the pause by its own runtime | DEFER — the observed host shape runs 2 ms before pausing; a per-action pause timestamp is an engine change (upstream) |
| P3 | AC9's stalled label lives on the trace surface plus host-pause wall clock in the profile; `spur workflow profile`/`cost` do not list stalled runs separately | ACCEPTED — profile samples done runs and `workflow trace --status` has no `paused` filter, so that listing needs a new filter; AC9 reads "trace *or* profile *or* cost" |
| P4 | The profile's `host=` column appears only when a pause was measured | ACCEPTED — keeps a run without host pauses byte-identical |
| P4 | Replay executes at most 5 cited suites at 120 s each | ACCEPTED — the review-verdict action is bounded at 900 s, so the replay cannot pin a visit |

Contract changes made deliberately, each with an updated test rather than a silenced one: the
`review` onEnter sequence (a lint-echo pair at the top, a run-scoped retry token at the end), the
`review → review` edge (allowed narrowly by the tree-freeze contract, guarded by that token), the
formatter step moving from `shell` to `command.gate`, and the task-pipeline topology recorded in the
0874 parity baseline.

Residual risk: the host-executor pause is now measured at the resume seam (`hostPauses[]`), which is
the only Spur-owned moment that sees both ends; a run cancelled while paused has no resume and
therefore no entry — by design, since there is no second instant to measure against.

### References

- Downstream post-mortem target: `/Users/robin/xprojects/credit-sentry` (21 done tasks, 2026-11-06 → 2026-11-08), read-only. Evidence: `.spur/spur.db` (`runs`, `phase_runs`, `action_runs`), `.spur/run/batch-20261107T012818Z/batch-report.md`, `.spur/run/<runId>/receipts/*.json`, `.spur/run/first-csv/focused.bunfig.toml`, `.spur/context/token-ledger.jsonl`, `~/.claude/projects/-Users-robin-xprojects-credit-sentry/97d030fa-*.jsonl`.
- Feature D3 — workflow run reliability defects.
- 1127 — serialize full quality gates host-wide (constrains R4: replay is never a second full gate; lock default 2 h, `quality-gate.ts:842`).
- 1239 / D65 / ADR-140 — the v9 seven-state pipeline this task edits (`config/workflows/task-pipeline.yaml`).
- `docs/design/harness-surface-governance.md` — public-surface consent rule covering `--replay`.
- Code anchors (dev tree, 2026-11-08):
  - `packages/app/src/services/quality-gate.ts`: `:69`, `:90-99`, `:620`, `:743`, `:796-821`, `:842`, `:1173`, `:1273`, `:1302`, `:1357-1359`, `:1416-1470`
  - `packages/app/src/workflow/actions/command-gate.ts`: `:25-29`, `:54`, `:158`, `:178`
  - `packages/app/src/workflow/actions/shell.ts:117`
  - `packages/app/src/workflow/actions/agent-run.ts`: `:587`, `:1963-1971`
  - `packages/app/src/services/workflow-resume-ops.ts`: `:214-217`, `:286-320`
  - `packages/app/src/services/bounded-child-run.ts:94-128`
  - `apps/cli/src/commands/task/verdict.ts`: `:39-61`, `:93-96`, `:106-108`
  - `packages/app/src/services/verify-answer-lint.ts`: `:82`, `:120-131`
  - `packages/app/src/services/verify-verdict.ts:44-56`
  - `packages/app/src/services/task-check.ts:229-253`
  - `packages/app/src/services/sdlc-actions.ts:40`
  - `packages/app/src/services/workflow-clean-ops.ts:264-297`
  - `packages/domain/src/dao/run-dao.ts`: `:137`, `:259-263`
  - `config/workflows/task-pipeline.yaml`: `:76`, `:113`, `:120`, `:144`, `:159`, `:337`, `:514-520`, `:711-717`, `:730`, `:981-988`, `:1034-1082`
- Skills/docs to edit: `plugins/sp/skills/code-implementation/SKILL.md`, `plugins/sp/skills/code-testing/SKILL.md`, `plugins/sp/skills/spur-dev/references/execution-workflow.md`. Already correct: `plugins/sp/skills/spur-check/SKILL.md:37`.
- Upstream deferrals (`/Users/robin/xprojects/ts-libs`):
  - D1: `@gobing-ai/ts-runtime` 0.7.1 `dist/process-executor.d.ts:173-192` (`PipeProcessOptions`, no timeout); group containment is in `dist/process-group.js:93-136`.
  - D2: `@gobing-ai/ts-dual-workflow-engine` 0.7.1 `dist/persistence.js:162-177` (append-only `phase_runs`).
- Spur version at the post-mortem: `@gobing-ai/spur` 0.4.24, `task-pipeline` v9. Line numbers are dev-tree positions re-verified on 2026-11-08; confirm each before editing.

### History

- 2026-11-08T17:49:35.782Z backlog → todo (system)
- 2026-11-08T18:32:48.286Z todo → wip (system)
- 2026-11-08T19:16:47.242Z wip → testing (system)
- 2026-11-08T19:17:21.187Z testing → wip (system)
- 2026-11-08T19:18:19.582Z wip → testing (system)
- 2026-11-08T19:19:33.031Z testing → wip (system)
- 2026-11-08T19:20:24.181Z wip → testing (system)
- 2026-11-08T19:20:26.761Z testing → done (system)

