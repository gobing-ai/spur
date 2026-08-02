---
template: issue
schema_version: 1
name: "Stream agent subprocess output during pipeline runs via the unused onOutput hook"
description: ""
status: todo
type: issue
profile: standard
feature_id: J3
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-02T13:15:29.002Z"
updated_at: "2026-08-02T13:18:45.421Z"
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

- [ ] Pass a trivial `onOutput` logger through `runTraced` and run one short pipeline task. Confirm chunks arrive **during** execution. If they do not, stop and re-read `process-executor.ts:200-240` — the whole task rests on this.
- [ ] Confirm `stdin` is `'ignore'` and the output policy is unchanged while chunks flow.

**Phase 1 — choose the sink**

- [ ] Decide file artifact vs EventBus emission (see `### Design`). Record the choice and why. Recommendation: file sink; note for J3 to promote it later.
- [ ] If the event route is chosen, first verify the tap actually persists agent rows — feature J3 records that `system_events` currently holds **zero** `workflow.*` / `agent.*` rows, so the path may not land.

**Phase 2 — wire it**

- [ ] Thread the handler from `runTraced` → `executeRun` → `NodeProcessExecutor` options.
- [ ] Implement the sink with its volume bound and visible truncation.
- [ ] Keep the handler best-effort: swallow and continue on write failure.
- [ ] Surface the artifact from the run id so `spur workflow trace` can reach it.

**Phase 3 — prove the stall fix survives**

- [ ] Regression test: a translated slash command through `runTraced` cannot stall on an interactive prompt.
- [ ] Assert `stdin: 'ignore'` and the buffered policy explicitly.
- [ ] Mutation-check: a change that hands the child a TTY must fail a test.

**Phase 4 — gates**

- [ ] Unit coverage per R7.
- [ ] **Behavioural check against a real long-running run** — start a genuine pipeline task and read progress mid-flight. The originating complaint is behavioural; unit tests cannot close it.
- [ ] `bun run lint`, `bun run test`, `bun run build`. Full suite; bucket failures by cause.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
