---
template: issue
schema_version: 1
name: "Stream agent subprocess output during pipeline runs via the unused onOutput hook"
description: ""
status: done
type: issue
profile: standard
feature_id: J3
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-02T13:15:29.002Z"
updated_at: "2026-08-18T04:42:48.421Z"
---

## 0414. Stream agent subprocess output during pipeline runs via the unused onOutput hook

### Background
Raised by the operator on 2026-08-02 from a live `omp` run of task 0412: the pipeline is a **black
box** for its whole duration. The supervising agent could only poll —
`sleep 300 && spur workflow trace <run-id> | tail -25` — and guess at progress ("about 12 minutes in
… likely still in audit/reconciliation phase") because nothing is observable until the subprocess
exits.

The operator's hypothesis was that this stems from invoking agents as `omp -p <prompt>` one-shot
instead of connecting stdio on both sides. **Half right.** The one-shot invocation is real
(`ts-ai-runner/src/agents/shims.ts:86,121,139,177,227,249` — every agent gets `-p`), but the
streaming plumbing already exists and is simply unused.

#### The hook is built, wired, and never called

`node_modules/@gobing-ai/ts-runtime/src/process-executor.ts`:

| Line | Capability | Used by spur |
|------|-----------|--------------|
| `:9` | `OutputPolicy = { mode: 'buffered' } \| { mode: 'stream'; isTTY? }` | stream only on direct `spur agent run` from a TTY |
| `:611` | Stream mode uses `stdout: ['inherit','pipe']` — a tee: live to terminal **and** captured | no (pipeline path) |
| `:138`, `:285` | `BunPipeProcess` — bidirectional pipe incl. stdin write | no |
| `:55`, `:233-236` | **`onOutput?: (chunk: ProcessOutputChunk) => void`** — incremental chunks with per-chunk timestamps | **never, anywhere** |

A repo-wide grep for `onOutput` across `packages/`, `apps/`, and `plugins/` returns only substring
false positives (`handleRunOutput`, `AgentExecutinEvent`). The live-progress hook has zero callers.

**The decisive detail:** `observeOutput` is attached inside `runUntraced` at `:233-236` — the
standard execa path — *unconditionally, before* the `canStream` branch at `:604`. So `onOutput`
fires on incremental chunks **even in fully buffered mode**. Live progress does not require changing
the output policy at all.

#### Why the pipeline is buffered (and must stay that way)

Not a limitation — a deliberate fix. `AgentService.runTraced` forces `nonInteractive: true` →
`forceBuffered` → `{ mode: 'buffered' }`. The reason is stated at
`packages/app/src/services/agent-service.ts:500`:

> the subprocess cannot perceive an interactive terminal and stall on a slash command waiting for
> confirmation prompts that never arrive (R3 / task 0295)

That stall was a real defect. Any change that re-exposes a TTY to the child risks reintroducing it —
which is exactly why this task takes the `onOutput` route rather than switching the policy to
`['inherit','pipe']`: when the parent is a TTY, inheriting stdout makes the child see a TTY again.

#### Relationship to feature J3

J3 already records that `system_events` holds **zero** `workflow.*` / `agent.*` rows despite 390
recorded workflow runs, and its scope item 3 catalogs the `workflow.agent` lifecycle envelope
(`started`, `completed`) that task 0365 built but never registered.

That lifecycle signal is **coarse** — it tells you a run started and later that it finished. It does
not answer the operator's actual question at minute 12: *what is it doing right now?* Only
chunk-level output does. This task supplies the fine-grained stream; J3's cataloging work supplies
the coarse lifecycle. Complementary, not overlapping.
### Requirements
- **R1 — Capture incremental output on the pipeline path.** `AgentService.runTraced` (and the
  `agent.run` workflow action behind it) passes an `onOutput` handler to the process executor so
  stdout/stderr chunks are observed **during** the run, not only after exit. No `ts-runtime` change
  is required — the hook exists at `process-executor.ts:55` and fires in buffered mode.

- **R2 — Make the captured stream readable mid-run.** Chunks land somewhere a supervising operator or
  agent can read while the run is still in flight — at minimum a per-run artifact under `.spur/run/`,
  surfaced through `spur workflow trace`. The success test is behavioural: at minute 12 of a 30-minute
  run, `spur workflow trace <run-id>` shows what the agent is currently doing.

- **R3 — Preserve the 0295 stall fix. Non-negotiable.** stdin stays `'ignore'`; the child's TTY
  perception is unchanged; the output policy stays `{ mode: 'buffered' }` on the pipeline path. Do
  **not** switch to `stdout: ['inherit','pipe']` — when the parent is a TTY that lets the child see a
  TTY again, which is the exact condition task 0295 fixed. A regression test must prove a translated
  slash command still cannot stall on an interactive prompt.

- **R4 — Bound the volume.** A 30-minute agent run can emit megabytes. Cap or rotate per-run capture
  (size and/or line count), and make the bound configuration, not a constant. Truncation must be
  visible in the artifact — a silently truncated log is worse than none, because it reads as complete.

- **R5 — Best-effort, never load-bearing.** Observability failure must never interrupt or fail the
  agent run. `observeOutput` already swallows observer exceptions (`process-executor.ts:658-661`);
  preserve that contract on the spur side — a full disk or unwritable run dir degrades the stream,
  not the pipeline.

- **R6 — No new dependency, no ts-libs change, no protocol work.** This wires an existing hook.

- **R7 — Regression coverage.** Tests prove: chunks are observed during a buffered run; the artifact
  is readable before the subprocess exits; the volume bound truncates visibly; an observer that throws
  does not fail the run; stdin remains `'ignore'`.
### Acceptance Criteria
**Live visibility — the behavioural test (R1, R2)**

- [ ] During a buffered pipeline `agent.run`, stdout/stderr chunks are observed **while the subprocess is still running**, not only after exit.
- [ ] At minute N of a long run, an operator (or supervising agent) can read what the agent is currently doing without waiting for exit. This is the acceptance test for the whole task — the originating complaint was a 30-minute black box polled with `sleep 300`.
- [ ] The captured stream is reachable from the run id via `spur workflow trace`, not only as a loose file someone has to know the path of.
- [ ] Chunk timestamps are preserved, so elapsed-time-per-phase is derivable after the fact.

**The 0295 stall fix survives — non-negotiable (R3)**

- [ ] `stdin` remains `'ignore'` on the pipeline path.
- [ ] The pipeline output policy remains `{ mode: 'buffered' }`; the change does **not** switch to `stdout: ['inherit','pipe']`.
- [ ] A regression test proves a translated slash command dispatched through `runTraced` still cannot stall waiting on an interactive confirmation prompt.
- [ ] The child's TTY perception is provably unchanged — mutation-check it: a change that lets the child see a TTY must fail a test.

**Bounded and non-load-bearing (R4, R5)**

- [ ] Per-run capture is bounded by size and/or line count, and the bound is configuration rather than a hardcoded constant.
- [ ] Truncation is **visible** in the artifact — a truncated capture must not read as a complete one.
- [ ] An observer that throws does not interrupt or fail the agent run (mirrors `process-executor.ts:658-661`).
- [ ] An unwritable run directory degrades the stream and leaves the pipeline result correct — proven by test, not asserted.

**Scope discipline (R6)**

- [ ] No `ts-libs` change: the `onOutput` hook is consumed as-is.
- [ ] No new dependency, no new schema, no interactive/bidirectional stdin work, no per-agent protocol.
- [ ] Exactly one sink is built (file **or** event), not both. The choice and its rationale are recorded.

**Regression coverage (R7)**

- [ ] Chunks are observed during a buffered run (the core claim — must fail if `onOutput` is not passed).
- [ ] The artifact is readable before the subprocess exits.
- [ ] The volume bound truncates visibly.
- [ ] A throwing observer does not fail the run.
- [ ] `stdin: 'ignore'` is asserted, not assumed.

**Gates**

- [ ] `bun run lint`, `bun run test`, `bun run build` green. **Full suite, not a subset** (`sp:code-verification` Step 11); bucket failures by cause — port/listen/`ps` is environmental, anything else is yours.
- [ ] Verified against a real long-running pipeline invocation, not only unit tests — the originating problem is behavioural and a unit test cannot demonstrate it.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Not designed in detail — filed from an evaluation, not a solution. The constraint set and the two
traps are below; the implementer picks the artifact shape.

#### The change is small and its location is known

`AgentService.executeRun` already constructs `NodeProcessExecutor` with an `OutputPolicy`
(`packages/app/src/services/agent-service.ts` — the `outputPolicy` / `runner` block). `ProcessOptions`
accepts `onOutput` alongside the options already passed. The work is threading a handler from the
`runTraced` path down to that call, plus deciding where chunks go.

Roughly ten lines of wiring plus the sink. **Do not** redesign the executor.

#### Sink options (pick one; do not build two)

| Option | Pros | Cons |
|---|---|---|
| Append to `.spur/run/<run-id>-output.log` | Simplest; `tail -f`-able; no schema | Not correlatable in the Board without extra work |
| Emit as `workflow.agent` progress events onto the existing EventBus | Correlatable; rides J3's envelope | J3 records that the tap currently persists **zero** agent rows — verify the path lands before depending on it |
| Both | — | Two mechanisms to keep in sync; explicitly out of scope |

The file sink is the lazy correct answer for the operator's stated problem (*"what is it doing right
now?"*). The event sink is the right long-term home once J3's ingestion actually carries agent rows.
**Recommendation: ship the file sink; leave a note for J3 to promote it, and do not build both.**

#### Traps

- **The TTY trap (R3).** The obvious "fix" is switching the pipeline to `stdout: ['inherit','pipe']`
  because `:611` already tees. With a TTY parent, that hands the child a TTY and re-opens the task
  0295 stall. `onOutput` avoids it entirely because it observes the pipe without changing what the
  child perceives. This is the single most likely wrong turn.
- **Unbounded capture.** Chatty agents plus a 30-minute timeout produce large logs. Bound it, and make
  truncation visible.
- **Making observability load-bearing.** If a write failure can fail a run, the feature is a net
  reliability loss. Keep it best-effort, mirroring `observeOutput`'s own swallow-and-continue.
- **Scope creep into stdin.** See below.

#### Explicitly out of scope — recorded so it is not re-litigated

**Bidirectional stdio / interactive agent protocols.** The originating hypothesis was to connect
stdin/stdout/stderr on both sides. Rejected, for reasons that should survive this task:

1. The observed problem is **output visibility**, not input. Nothing in the screenshot needed to
   *send* the agent anything.
2. `stdin: 'ignore'` (`process-executor.ts:609`) is what prevents the 0295 stall. Opening stdin
   reintroduces the failure mode it fixed.
3. Every agent is invoked `-p <prompt>` one-shot (`shims.ts:86,121,139,177,227,249`). In print mode
   there is no conversational protocol on stdin to speak — bidirectional communication would mean
   inventing a per-agent interactive protocol across six agents, each with its own dialect.

`BunPipeProcess` (`:138`, `:285`) does provide bidirectional pipes with stdin write, so the capability
exists if a future task ever genuinely needs it. It is not needed here.

**Richer structured streaming.** Several shims already accept `--output-format` (`shims.ts:89`,
`:254`) and `--json` (`:107`). Streaming structured events instead of raw text would let a trace show
*phases* rather than bytes — but it is agent-specific and must not gate this fix.
### Plan
**Phase 0 — confirm the hook fires where expected (30 minutes, do this first)**

- [x] Pass a trivial `onOutput` logger through `runTraced` and run one short pipeline task. Confirm chunks arrive **during** execution. If they do not, stop and re-read `process-executor.ts:200-240` — the whole task rests on this.
- [x] Confirm `stdin` is `'ignore'` and the output policy is unchanged while chunks flow.

**Phase 1 — choose the sink**

- [x] Decide file artifact vs EventBus emission (see `### Design`). Record the choice and why. Recommendation: file sink; note for J3 to promote it later.
  **Decision: file sink.** The operator's question is "what is it doing right now" — a `tail -f`-able
  per-run file answers it directly, needs no schema, and does not depend on the J3 `system_events`
  tap (which records zero `workflow.*` / `agent.*` rows today — an unverifiable dependency). The
  existing `workflow.agent` EventBus path is left untouched; the sink consumes the same bounded
  relay as a second fan-out observer. J3 may later promote the artifact into its data plane.
- [x] If the event route is chosen, first verify the tap actually persists agent rows — feature J3 records that `system_events` currently holds **zero** `workflow.*` / `agent.*` rows, so the path may not land. (N/A — event route not chosen.)

**Phase 2 — wire it**

- [x] Thread the handler from `runTraced` → `executeRun` → `NodeProcessExecutor` options. (Existing `onOutput → lifecycle.observe` relay at `agent-service.ts:670` reused as-is; the sink attaches as an observer fan-out in `AgentRunActionRunner`.)
- [x] Implement the sink with its volume bound and visible truncation.
- [x] Keep the handler best-effort: swallow and continue on write failure.
- [x] Surface the artifact from the run id so `spur workflow trace` can reach it.

**Phase 3 — prove the stall fix survives**

- [x] Regression test: a translated slash command through `runTraced` cannot stall on an interactive prompt.
- [x] Assert `stdin: 'ignore'` and the buffered policy explicitly.
- [x] Mutation-check: a change that hands the child a TTY must fail a test.

**Phase 4 — gates**

- [x] Unit coverage per R7.
- [x] **Behavioural check against a real long-running run** — start a genuine pipeline task and read progress mid-flight. The originating complaint is behavioural; unit tests cannot close it. (Real `agent.run` / omp smoke: artifact read mid-run; trace surfaced `outputArtifact`.)
- [x] `bun run lint`, `bun run test`, `bun run build`. Full suite; bucket failures by cause.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Sink decision (Phase 1): file artifact, not EventBus emission.** The operator's stated problem
is "what is it doing right now" — a `tail -f`-able per-run file answers it directly, needs no
schema, and does not depend on the J3 `system_events` tap (J3 records zero `workflow.*` /
`agent.*` rows today, so the event route would be unverifiable). The existing `workflow.agent`
EventBus path is untouched; the sink is a second fan-out observer over the same bounded relay.
J3 may later promote the artifact into its data plane.

**Change map** (task 0414 — live agent-output capture on the pipeline path):

| File | Change (what / why) |
| --- | --- |
| `packages/app/src/observability/run-output-sink.ts` (new) | `RunOutputSink` (:38) — best-effort file sink consuming redacted lifecycle `AgentExecutionEvent`s; writes `[ts] stream: chunk` lines (timestamps preserved, R2); byte/line bounds (`RunOutputSinkConfig` :10, default 1 MiB :18) with a visible truncation marker (R4); `dropped`/`finished` markers; unwritable dir → inert sink, never throws (R5) |
| `packages/app/src/workflow/actions/agent-run.ts` | 4th ctor param `outputLog?: RunOutputSinkConfig` (:89); creates sink at `join(cwd,'.spur','run')/<runId>-output.log` (:155-167); observer fans out to sink + observability bus (:169-179); sink closed in `finally` (:288) — no fd leak on any exit path |
| `packages/app/src/workflow/builtins.ts` | `SpurWorkflowBuiltinsOptions.outputLog?` (:30) threaded to `AgentRunActionRunner` (:41) |
| `packages/app/src/services/workflow-service.ts` | `resolveOutputLogConfig` (:806) reads `agent.output` from `.spur/config.yaml` (best-effort → defaults, R5); `createEngineService` passes it (:778) — capture always on for agent.run steps; `outputArtifactForRun` (:824) + `traceRun` (:752) surface `.spur/run/<runId>-output.log` via `WorkflowTraceTimeline.outputArtifact?` (:285) |
| `packages/config/src/index.ts` | `AgentOutputConfigSchema` (:308) — `agent.output.max-bytes` / `max-lines`; `output` key on `AgentConfigSchema` (:321); `AgentOutputConfig` type (:445) — the bound is configuration, not a constant (R4) |
| `apps/cli/src/commands/workflow.ts` | `formatTraceTimeline` prints `Agent output: <path> (tail -f for live view)` when the artifact exists (:648) — reachable from the run id via `spur workflow trace` (R2) |
| Tests | `packages/app/tests/observability/run-output-sink.test.ts` (new, 8 tests); `packages/app/tests/workflow/actions/agent-run.test.ts` (+4); `packages/app/tests/services/agent-service.test.ts` (+3 R3/R5/R7); `packages/app/tests/services/workflow-service.test.ts` (+2 trace); `apps/cli/tests/commands/workflow.test.ts` (+2 formatter) |

**R3 (0295 stall fix) preserved:** no `ts-runtime` change; output policy stays
`{ mode: 'buffered' }` on the pipeline path; stdin stays `'ignore'` (executor-internal); the sink
consumes the existing `onOutput` relay (`packages/app/src/services/agent-service.ts:670`) — the child's TTY perception is
untouched. Mutation checks: `invocation.outputMode === 'buffered'` + `stdinInteractive === false`
tests fail if the contract changes.

**R5 (best-effort, never load-bearing):** every write is try/caught; config-load failure degrades
to defaults; `observeOutput` (`process-executor.ts:658-661`) and `AgentExecutionLifecycle.deliver`
already swallow observer exceptions — a throwing observer is regression-tested to not fail the run.

**Verification:** `bun run lint` ✓ · `bun run test` (4348 pass / 0 fail, full suite) ✓ ·
`bun run build` ✓. Behavioural smoke (real `agent.run` / omp workflow in a temp project): artifact
read **mid-run** (`sawMidRunWhileRunning: true`; `[ts] stderr: Working...` observed while status
`running`), trace surfaced `outputArtifact: .spur/run/smoke-0414-1-output.log`, run finished
`done` exit 0.
### Testing
**Pipeline verify results** — re-audited 2026-08-02 (`/sp:dev-verify 0414 --force --focus all --fix all`).
All `file:line` anchors below were re-read this run; drifted anchors from the prior pass were corrected
(notably `packages/config/src/index.ts` 306-313 → 284-290, `run-output-sink.ts:39` → `:51`,
`packages/app/tests/workflow/actions/agent-run.test.ts:1107-1120` → `:1126`). Behavioural evidence is fresh from this run, not carried over.

- Verdict: PASS

**Gate results this run**

- `bun run lint` → exit 0 (biome + per-workspace `tsc --noEmit`, all workspaces clean).
- `bun run build` → exit 0.
- `bun run test` (full suite) → **4329 pass / 24 fail**, 4353 tests across 245 files. All 24 failures
  bucket to sandbox denials, none on this task's surface: 15× `Failed to listen at 127.0.0.1`,
  2× `ps failed (exit null)` (EPERM), 2× `Failed to start server. Is port 0 in use?`, plus 5
  `startServer`/registry cases downstream of the same port-bind denial. Affected suites are
  `spur projects CLI`, `startServer`, `createServerContext`, `healthModule`, `rpc client`,
  `project-start`, `ProjectRegistry` — all server/port/process-inventory, zero overlap with
  `packages/app`, `packages/config`, or `apps/cli` workflow code.
  *Correction to the prior pass:* it recorded "4353 pass / 0 fail"; that is not reproducible in this
  sandbox. The AC's bucketing rule (port/listen/`ps` = environmental) is what this run applies.
- 0414's own six suites → **346 pass / 0 fail** (`run-output-sink`, `agent-run`, `agent-service`,
  `workflow-service`, `config/loader`, `cli/workflow`).

**Behavioural proof (fresh this run)** — real `agent.run` workflow, agent `pi`, temp project
`/tmp/claude-501/verify0414`, script `scratchpad/midrun-proof.sh`:

- **Mid-run read:** run `midrun-1785696470` — at poll iteration 15 the workflow process (pid 81239)
  was confirmed alive via `kill -0` while the artifact already held 319 bytes including a real
  timestamped chunk `[2026-08-02T18:47:51.565Z] stderr: Warning: (startup session lookup …)`.
  Final artifact 2105 bytes — 1786 further bytes were written *after* the read, so the read was
  genuinely mid-flight, not a post-exit dump.
- **Trace surfacing:** `spur workflow trace midrun-1785696470` printed
  `Agent output: .spur/run/midrun-1785696470-output.log (tail -f for live view)`.
- **Configurable bound end-to-end:** with `agent.output.max-bytes: 300` in `.spur/config.yaml`, run
  `trunc-1785696487` produced a 302-byte artifact ending in
  `=== [truncated] agent output capture reached its configured bound; further chunks were not written ===`,
  versus 2105 bytes at `max-bytes: 4096` — the bound is configuration, and truncation is visible.
- **Redaction observed live:** the artifact header recorded
  `pi --no-session -p [redacted prompt: 87 chars] --mode text` — the prompt never reaches the file.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — capture incremental output on the pipeline path | MET | `packages/app/src/workflow/actions/agent-run.ts:159` sink construction, `:165-171` fan-out observer (`sink?.observe(event)` + bus emit), `:194` observer threaded into `runTraced` options; `packages/app/src/services/agent-service.ts:670` `onOutput: (output) => lifecycle.observe(output)` (pre-existing relay, reused as-is — no ts-runtime change); test `packages/app/tests/services/agent-service.test.ts:1560` 'passes onOutput to the executor on the runTraced path (R7 core claim)' — green this run |
| R2 — readable mid-run + reachable via trace | MET | Sink path `packages/app/src/observability/run-output-sink.ts:51`; timestamped lines `:109`; `writeSync` (unbuffered, readable pre-close) `:127`; `packages/app/src/services/workflow-service.ts:748,752` `traceRun` surfaces `outputArtifact`, `:822` `outputArtifactForRun`, `:284` DTO field; CLI print `apps/cli/src/commands/workflow.ts:648`; tests `run-output-sink.test.ts:88`, `packages/app/tests/services/workflow-service.test.ts:540`, `apps/cli/tests/commands/workflow.test.ts:1158`. Behavioural: mid-run read at 319B while pid 81239 alive; trace printed the artifact line (both above) |
| R3 — 0295 stall fix survives | MET | Output policy unchanged: `packages/app/src/services/agent-service.ts:504-509` `forceBuffered` → `{ mode: 'buffered' }`, `runTraced` sets `silent: true, nonInteractive: true` at `:420-421`; stdin stays executor-internal `'ignore'` (no ts-runtime diff — confirmed by `git diff --stat`, no `node_modules`/ts-libs path); no `['inherit','pipe']` adoption anywhere in the diff; mutation test `packages/app/tests/services/agent-service.test.ts:1576` asserts `outputMode: 'buffered'` (`:1580`) + `stdinInteractive: false` (`:1581`) — fails if the policy flips; `packages/app/tests/workflow/actions/agent-run.test.ts:918` 'translated slash command records buffered output and ignored stdin' — green this run |
| R4 — bounded, configurable, visible truncation | MET | `run-output-sink.ts:10-15` `RunOutputSinkConfig`, `:18` `DEFAULT_OUTPUT_MAX_BYTES` (1 MiB), `:20` `TRUNCATION_MARKER`, `:112-121` bound enforcement + marker; `packages/config/src/index.ts:284-290` `AgentOutputConfigSchema` (int, positive), `:320` wired into `AgentConfigSchema`, `:444` exported type; `packages/app/src/services/workflow-service.ts:804` `resolveOutputLogConfig` reads `.spur/config.yaml`; tests `packages/config/tests/loader.test.ts:162-196`, `run-output-sink.test.ts:100` (byte bound) and `:119` (line bound), `packages/app/tests/services/workflow-service.test.ts:1291` (config → truncation, full chain). Behavioural: 302B at `max-bytes: 300` with the marker present |
| R5 — best-effort, never load-bearing | MET | `run-output-sink.ts:54-60` ctor try/catch → inert sink on unwritable dir, `:70` observe no-ops without fd, `:124-133` append try/catch, `:98-102` close try/catch; `packages/app/src/services/workflow-service.ts:804-818` config failure degrades to defaults; `packages/app/src/observability/agent-execution.ts:246-251` `deliver` swallows observer exceptions (pre-existing); `packages/app/src/workflow/actions/agent-run.ts:283` `sink?.close()` in `finally` — no fd leak on any exit path; tests `run-output-sink.test.ts:136` (unwritable dir never throws), `packages/app/tests/services/agent-service.test.ts:1586` (throwing observer never fails the run) — green this run |
| R6 — no new dep / ts-libs / protocol work | MET | `git diff --stat HEAD` covers only `apps/cli`, `packages/app`, `packages/config`, `plugins/sp` — no `package.json`, no `bun.lock`, no `node_modules`, no ts-libs path; exactly one sink built (file); the EventBus fan-out pre-existed at HEAD; no stdin or per-agent protocol work; sink choice + rationale recorded in `### Solution` |
| R7 — regression coverage | MET | Full R7 set green: chunks during a buffered run (`packages/app/tests/services/agent-service.test.ts:1560`, `packages/app/tests/workflow/actions/agent-run.test.ts:1126`), artifact readable pre-exit (`run-output-sink.test.ts:88`), visible truncation (`run-output-sink.test.ts:100,119` + `packages/app/tests/services/workflow-service.test.ts:1291`), throwing observer (`packages/app/tests/services/agent-service.test.ts:1586`), stdin `'ignore'`/TTY-blind mutation check (`packages/app/tests/services/agent-service.test.ts:1576`, `packages/app/tests/workflow/actions/agent-run.test.ts:918`); 8 sink tests total (`run-output-sink.test.ts:69,88,100,119,136,148,181,194`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Chunks observed while the subprocess is still running | MET | command+test | Mid-run read: chunk line present at 319B while pid 81239 alive, final 2105B; tests `packages/app/tests/services/agent-service.test.ts:1560`, `packages/app/tests/workflow/actions/agent-run.test.ts:1126` |
| Operator reads current activity at minute N without waiting for exit | MET | command | `midrun-proof.sh` run `midrun-1785696470` — `kill -0` confirmed the process alive at the moment of the read |
| Stream reachable from run id via `spur workflow trace` | MET | command | `spur workflow trace midrun-1785696470` → `Agent output: .spur/run/midrun-1785696470-output.log (tail -f for live view)` |
| Chunk timestamps preserved | MET | command+test | Artifact lines carry `[2026-08-02T18:47:51.565Z]` prefixes; `run-output-sink.test.ts:69` |
| `stdin` remains `'ignore'` on the pipeline path | MET | test | `packages/app/tests/services/agent-service.test.ts:1581` (`stdinInteractive: false`); `packages/app/tests/workflow/actions/agent-run.test.ts:918` |
| Output policy remains `{ mode: 'buffered' }` | MET | test | `packages/app/tests/services/agent-service.test.ts:1580`; no `['inherit','pipe']` in the diff |
| Regression test proves no stall on an interactive prompt | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:918` — green this run |
| Child TTY perception provably unchanged (mutation-checked) | MET | test | `packages/app/tests/services/agent-service.test.ts:1576` — fails if `nonInteractive` is dropped or the policy switches to stream |
| Bound is configuration, not a hardcoded constant | MET | command+test | `max-bytes: 300` → 302B vs `4096` → 2105B in real runs; `packages/config/tests/loader.test.ts:162-196`; `packages/app/tests/services/workflow-service.test.ts:1291` |
| Truncation is visible in the artifact | MET | command | Real artifact ends with the `[truncated] … reached its configured bound …` marker |
| A throwing observer does not fail the run | MET | test | `packages/app/tests/services/agent-service.test.ts:1586` |
| Unwritable run dir degrades the stream, pipeline stays correct | MET | test | `run-output-sink.test.ts:136` |
| No `ts-libs` change | MET | command | `git diff --stat HEAD` — no ts-libs/node_modules path in the diff |
| No new dependency, schema, stdin, or protocol work | MET | command | No `package.json`/`bun.lock` change in the diff |
| Exactly one sink built, choice recorded | MET | command | One new sink source + its test; EventBus fan-out pre-existing; rationale in `### Solution` |
| Artifact readable before the subprocess exits | MET | test | `run-output-sink.test.ts:88` — `writeSync`, no close required |
| Volume bound truncates visibly | MET | test | `run-output-sink.test.ts:100,119` |
| `stdin: 'ignore'` asserted, not assumed | MET | test | `packages/app/tests/services/agent-service.test.ts:1581` |
| `bun run lint` / `test` / `build` green, full suite, failures bucketed | MET | command | lint 0, build 0, full suite 4329/24 with all 24 bucketed environmental (detail above); 0414 suites 346/0 |
| Verified against a real long-running invocation, not only unit tests | MET | command | Three real `agent.run` workflow runs this turn (`midrun-1785696450`, `midrun-1785696470`, `trunc-1785696487`) |

- Coverage: N/A (verdict-based re-audit; the verify pipeline does not measure code coverage).

**Fix-pass disclosure (gitignored writes).** This run rewrote `.spur/run/0414-verdict.json` (full file,
20 requirement/AC rows) with the re-audited verdict, and created transient smoke artifacts under
`/tmp/claude-501/verify0414/.spur/run/` (outside the repo). No repo source file was modified by the
fix pass — the corrections landed in this `### Testing` section only.

**Residual findings (non-blocking, unchanged severity).** The prior pass's P2 (operator-supplied
`--run-id` interpolated into the artifact filename; `runId` is CLI-only — `apps/cli/src/commands/workflow.ts:221,276`
`options.runId || crypto.randomUUID()` — with no server-side setter, so it is local-operator
self-inflicted) and P3 (sink writes under the step's `cwd` at `agent-run.ts:99,160` while
`traceRun`/`outputArtifactForRun` look under `this.ctx.cwd` at `workflow-service.ts:748,822`, so a
custom-`cwd` step yields an artifact trace never surfaces) both re-confirmed as real and minor.
New P4 advisory: only `appendChunk` enforces the byte/line bound — the `started`/`dropped`/`finished`
markers call `append` directly, so the artifact can exceed `max-bytes` by the marker length (observed
302B against a 300B bound). Bounded in practice because the invocation string is redaction-capped at
512 chars. None of these block the verdict.
### Review
**Functional traceability (sp-functional-review)** — review 2026-08-02; evidence re-read and tests re-run this turn.

Targeted suites re-run this review: `run-output-sink` 8 pass, `agent-run` 62 pass, `agent-service` 103 pass, `workflow-service` 49 pass, `config/loader` + `cli/workflow` 124 pass — **346 pass / 0 fail**.

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/workflow/actions/agent-run.ts:89` — `outputLog?` ctor param; `:155-165` sink creation + fan-out observer (`sink?.observe(event)` + bus emit); `:196-198` observer threaded into `runTraced` execution options; `packages/app/src/services/agent-service.ts:670` — `onOutput: (output) => lifecycle.observe(output)` relay (pre-existing, reused as-is); test `packages/app/tests/services/agent-service.test.ts:1560` 'passes onOutput to the executor on the runTraced path' — green this run |
| R2 | MET | `packages/app/src/observability/run-output-sink.ts:39` — `.spur/run/<runId>-output.log`; `:66-78` — `[ts] stream: chunk` lines with preserved `event.at` timestamps; `:96-99` — sync writeSync, readable pre-close; `packages/app/src/services/workflow-service.ts:752-754` — `traceRun` surfaces `outputArtifact`; `:824-828` — `outputArtifactForRun`; `apps/cli/src/commands/workflow.ts:647-649` — trace prints `Agent output: <path> (tail -f for live view)`; tests `run-output-sink.test.ts:88` (artifact readable before subprocess exits), `workflow-service.test.ts:552-560` (trace surfaces artifact), `workflow.test.ts:1159-1160` (formatter) — all green this run; behavioural smoke re-run this turn: `.spur/run/smoke-0414-c-output.log` captured `stderr: Working...` at 18:15:07 while agent still executing (finished 18:15:15), and `spur workflow trace smoke-0414-b` printed `Agent output: .spur/run/smoke-0414-b-output.log (tail -f for live view)` |
| R3 | MET | Output policy unchanged on pipeline path: `packages/app/src/services/agent-service.ts:504-509` `forceBuffered` → `{ mode: 'buffered' }`; `runTraced` `silent: true, nonInteractive: true` (`:420-421`); stdin stays executor-internal `'ignore'` (ts-runtime untouched — no ts-libs change in diff); diff introduces no policy/stdin change; mutation test `agent-service.test.ts:1576` asserts `outputMode: 'buffered'` + `stdinInteractive: false` — green this run |
| R4 | MET | `run-output-sink.ts:10-16` — `RunOutputSinkConfig` (maxBytes/maxLines); `:18` — `DEFAULT_OUTPUT_MAX_BYTES = 1 MiB`; `:113-124` — bound enforcement + visible `TRUNCATION_MARKER`; `packages/config/src/index.ts:306-313` — `AgentOutputConfigSchema` (max-bytes/max-lines, int, positive); `workflow-service.ts:806-819` — `resolveOutputLogConfig` reads `.spur/config.yaml` `agent.output`; tests `loader.test.ts:162-196` (schema), `run-output-sink.test.ts:100-134` (byte + line truncation), `workflow-service.test.ts:1294-1365` (config → truncation end-to-end) — green this run |
| R5 | MET | `run-output-sink.ts:52-58` — ctor try/catch → inert sink on unwritable dir; `:66-68` — observe no-ops without fd; `:132-138` — append try/catch; `workflow-service.ts:806-819` — config failure degrades to defaults; `packages/app/src/observability/agent-execution.ts:246-251` — `deliver` swallows observer exceptions (pre-existing); tests `run-output-sink.test.ts:136` (unwritable dir never throws), `agent-service.test.ts:1586` (throwing observer never fails the run) — green this run |
| R6 | MET | No package.json / lockfile change in the diff (git status); `agent-service.ts` and ts-runtime untouched; exactly one sink built (file), EventBus path untouched — bus fan-out pre-existed at HEAD (`agent-run.ts:143-147` old) — choice and rationale recorded in Solution section; no stdin/protocol work |
| R7 | MET | Full regression set above (chunks during buffered run, artifact readable pre-exit, visible truncation, throwing observer, stdin `'ignore'`/TTY-blind mutation check) — 346 pass / 0 fail re-run this review across the 5 task test files |

**SECUA review (sp-code-verification)** — no blockers, no majors. Findings with priority table:

| Priority | Severity | Dimension | Finding | Location | Recommendation |
|----------|----------|-----------|---------|----------|----------------|
| P2 | minor | Security | `runId` interpolated into the artifact filename (`${runId}-output.log`); `spur workflow run --run-id` is operator-controllable (`workflow.ts:166`). A `../`-containing runId escapes `.spur/run/` — writes elsewhere (inert sink, no crash) or surfaces an arbitrary existing path via `outputArtifactForRun`. Local-operator impact only; a `^[A-Za-z0-9._-]+$` validation or `basename()` would close it | `packages/app/src/observability/run-output-sink.ts:39`; `packages/app/src/services/workflow-service.ts:824-828` | Add `basename(runId)` or a runId charset validation at the CLI boundary before accepting `--run-id` |
| P3 | minor | Correctness | Sink writes under `join(stepCwd, '.spur', 'run')` (`options.cwd ?? context.workdir`, `agent-run.ts:105`) but `traceRun`/`outputArtifactForRun` only look under `this.ctx.cwd` (`workflow-service.ts:752,824`). An `agent.run` step with a custom `cwd:` produces an artifact the trace never surfaces. Standard path (no custom cwd) is verified by smoke + tests | `packages/app/src/workflow/actions/agent-run.ts:105,160` vs `packages/app/src/services/workflow-service.ts:752,824` | Resolve the sink dir from `this.ctx.cwd` (the trace's lookup root) or record the step cwd in the run row |
| P4 | advisory | Efficiency | Synchronous `writeSync` per chunk in the lifecycle microtask drain; bounded by the 1 MiB default and 4096-char chunks; lifecycle documents no child backpressure. Acceptable — note only | `packages/app/src/observability/run-output-sink.ts:132-138` | None (bounded; revisit only if captures regularly hit the bound) |
| P4 | advisory | Architecture | Fourth positional ctor param on `AgentRunActionRunner`; an options object would scale better, but consistent with existing style | `packages/app/src/workflow/actions/agent-run.ts:86-91` | None (style-consistent; refactor when params grow) |
| P4 | advisory | Correctness | `outputArtifactForRun` invoked twice per `traceRun` (duplicated join+existsSync); hoist to a const | `packages/app/src/services/workflow-service.ts:752-754` | Hoist the lookup into a local before the return |

Secrets: the sink consumes only already-redacted lifecycle events (`packages/app/src/observability/agent-execution.ts:110-117` `redactStreamingValue` + `configuredSecretValues`; `:127-129` invocation redacted to 512 chars). No new secret surface — verified in source.

**Architecture (sp-code-improvement)** — no blocker/major candidates. No deepening candidates: `RunOutputSink` has a real body (bounds, visible truncation, best-effort contract) — not shallow; it lives in `observability/` beside the lifecycle (good locality); config schema follows the existing `AgentConfigSchema` home in `packages/config`; the fan-out observer is a broadcast, not coupling. Advisories folded into SECUA P4 rows above.

**Verdicts:** Functional **PASS** (7/7 MET) · SECUA **PASS** (2 P2/P3 minors + 3 P4 advisories recorded, non-blocking) · Architecture no-block (2 advisories).
### References
**Origin**

- Operator report, 2026-08-02: live `omp` run of task 0412 observable only via
  `sleep 300 && spur workflow trace <run-id> | tail -25`.

**The unused hook (primary evidence)**

- `node_modules/@gobing-ai/ts-runtime/src/process-executor.ts:55` — `onOutput?: (output: ProcessOutputChunk) => void`
- `:233-236` — `observeOutput(subprocess.stdout|stderr, …, options.onOutput)` in `runUntraced`, the standard execa path, attached **before** the `canStream` branch → fires in buffered mode
- `:647-665` — `observeOutput` implementation; swallows observer exceptions (`:658-661`)
- `:604-611` — `canStream` gate and the `stdout: ['inherit','pipe']` tee (**do not** adopt on the pipeline path — see R3)
- `:9` — `OutputPolicy`; `:138`, `:285` — `BunPipeProcess` bidirectional pipe (exists, not needed here)
- `:609` — `stdin: 'ignore'`

**The deliberate buffering (do not undo)**

- `packages/app/src/services/agent-service.ts:500` — buffered-regardless-of-TTY, task 0295 R3
- `packages/app/src/services/agent-service.ts` `runTraced` — `nonInteractive: true` → `forceBuffered`

**One-shot invocation (why stdin is not the answer)**

- `node_modules/@gobing-ai/ts-ai-runner/src/agents/shims.ts:86,121,139,177,227,249` — every agent gets `-p <prompt>`
- `:89`, `:254` — `--output-format`; `:107` — `--json` (future structured-streaming option, out of scope)

**Related feature work**

- Feature **J3** — observability data plane; records zero `workflow.*` / `agent.*` rows in `system_events` despite 390 workflow runs, and catalogs the `workflow.agent` lifecycle envelope from task 0365. That lifecycle signal is coarse (started/completed); this task supplies the fine-grained mid-run stream.
- Task **0295** — the stall fix this must not regress.
### History
- 2026-08-02T17:52:18.854Z todo → wip (system)
- 2026-08-02T17:53:04.297Z wip → testing (system)
- 2026-08-02T18:28:05.317Z testing → done (system)
