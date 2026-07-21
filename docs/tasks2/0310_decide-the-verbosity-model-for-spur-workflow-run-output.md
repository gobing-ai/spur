---
template: brainstorm
schema_version: 1
name: "Decide the verbosity model for spur workflow run output"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: P
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-21T20:48:47.838Z"
updated_at: "2026-07-21T22:57:36.195Z"
---

## 0310. Decide the verbosity model for spur workflow run output

### Background
Design the observability enhancement for `spur workflow run` end to end: the verbosity model, the engine
seam that makes it possible, the enriched line formats, verbose FSM transitions, and progress for long and
detached runs. Feature **P**. Output is a locked design; implementation follows via the normal `/sp:dev-*`
pipeline.

> **Scope note:** this ticket was consolidated from six. The title retains the original narrower wording
> ("verbosity model") because the CLI has no task-rename verb — read the scope from this section, not the title.

#### The problem

A 30-minute pipeline run prints this and nothing else:

```
▶ implement [running]
  → implement: agent.run…
  ✓ done (18m 33s)
```

`agent.run…` is the *action kind*. It does not say which agent ran, what it was asked to do, or whether it is
alive. Target:

```
[agent.run] - omp(zai) => /sp:dev-run 0302 --auto --next
```

#### The crux constraint

The observability seam is a **persistence** decorator, not an action seam:

- `packages/app/src/workflow/observability.ts` — `ObservableWorkflowAdapter.saveActionStart(runId, node, kind)`
- Engine call site: `dual-workflow-engine/src/action-step.ts:65` —
  `persistence.saveActionStart(runId, stateOrNodeId, action.kind)`

The action's `options` (carrying `agent`, `input`, `command`) never cross the boundary, so this is **not** a
formatter change in `step-reporter.ts`. Operator decision: take the **upstream engine change** in
`@gobing-ai/ts-dual-workflow-engine` rather than an in-repo ActionRunner decorator. That puts a ts-libs
release on the critical path — **start there.**

Blast radius to verify (per `sp:source-driven-development`, against source, not memory):

| Location | Role |
|---|---|
| `dual-workflow-engine/src/types.ts:278` | `WorkflowPersistenceAdapter` interface declaration |
| `dual-workflow-engine/src/persistence.ts:154`, `:309` | two implementations |
| `dual-workflow-engine/src/action-step.ts:65` | the single call site (has the full `action` in scope) |
| `packages/app/src/workflow/observability.ts` | Spur decorator + event map |
| root `workspaces.catalog` | pin, currently `^0.4.10` |

Sub-questions: optional 4th param vs. a separate non-persistence observer hook; raw `options` vs. a
pre-computed summary; **who redacts** (the engine cannot know which Spur option keys hold secrets — note the
existing `ActionRedactor` type already used by `saveActionFinalize`); confirmation that the widened payload
is **not** persisted (the "mirror, never alter persistence" invariant must hold); backward compatibility for
existing implementors; version bump + catalog path; and whether widening a published interface warrants an ADR.

#### The verbosity model

The ask splits across levels: enriched `agent.run` lines are wanted in **default** output, FSM transitions
only in **verbose**. So this is not one on/off flag over one body of output — there are at least two human
levels plus the frozen `--json` mode. **No `--verbose` flag exists on `workflow run` today**
(`apps/cli/src/commands/workflow.ts:104-112`).

Candidates: boolean `--verbose`; stacked `-v`/`-vv`; `--detail <quiet|normal|verbose|debug>`; env var for
CI/nested invocation. Settle: how much default output changes; interaction with the existing `--no-plan` and
with `--json`; whether the level auto-degrades when stdout is not a TTY.

#### Line formats — `agent.run` and `shell`

Resolve, don't assume: **what is `(zai)`** in the sketch — model? provider/profile? Ground it against what
`AgentRunActionRunner` actually resolves; it already captures agent, argv (post slash-command translation),
cwd, output mode, timeout, and continue state into `ActionResult.data.invocation`
(`packages/app/src/workflow/actions/agent-run.ts`). The pipeline pins `agent: "omp"` in
`.spur/workflows/task-pipeline.yaml`.

- **Start vs finish:** the invocation is known at start, the duration only at finish. The sketch puts them on
  one line — rewrite in place (TTY-only) or keep two lines with the invocation on the start line?
- **`shell` steps too.** Today every shell step prints an indistinguishable `shell…`, several per state.
  Showing the real command is arguably a bigger win than the agent line.
- **Truncation:** fixed or terminal-width aware; head/tail/middle-ellipsis. A slash command's *trailing*
  flags (`--auto --next`) carry the most meaning, so naive head-truncation is the wrong default.
- **Redaction:** prompts are free text and may carry secrets — settle jointly with the engine-seam question.
- Keep rendering **pure** (`event → string | null`) — see `packages/app/src/workflow/step-reporter.ts`.

#### Verbose FSM transitions — the cheapest win

The data is already on the bus and fully populated; the CLI simply never subscribes.

- `observability.ts` emits `workflow.transition` with `{ from, to, trigger }` from both `saveTransition`
  and `commitTransition`.
- `apps/cli/src/commands/workflow.ts:196-198` subscribes to phase + action.started + action.finished — **not**
  transition. `renderStepLine`'s `StepEvent` union excludes it.

So: widen the union, add a render branch, subscribe under the verbose level. Settle the **duplication risk**
(`commitTransition` emits transition *and* phase — naively rendering both yields two lines per hop); how a
`null` trigger reads; that failed/short-circuit hops surface (they are the reason verbose is worth having);
and glyph/indent vocabulary — reuse the existing guard rendering at `apps/cli/src/commands/workflow.ts:451`
rather than inventing a second vocabulary.

#### Long and detached runs

**Liveness — the 18-minute blind spot.** `implementTimeoutMs` is 30 minutes, so a silent half-hour is
expected and indistinguishable from a hang. Candidates: an elapsed ticker repainting the line (needs a TTY;
breaks piped/CI/async); a periodic heartbeat line (append-only, pipe-safe, testable); or tailing the agent's
stdout — which **collides with a hard contract**: `AgentRunActionRunner` uses `runTraced`, forcing
`{ mode: 'buffered' }` by design so a non-interactive subprocess can never stall on a prompt that never
arrives. Read the R3/task-0295 rationale before touching it. Surfacing the budget
(`still running (4m / 30m)`) may be most of the value alone. Prefer a CLI-side timer over a new bus event —
no engine change, and `step-reporter.ts` stays pure.

**Async transport.** `--async` spawns a detached `setsid` leader with **ignored stdio** — nowhere to print —
and tells the operator `Monitor with: spur workflow trace <runId>`. A monitoring command already exists;
the question is what it should grow. Strong candidate: `trace --follow` polling the **already durable**
phase/transition/action rows — no new log plumbing, and it works for a run started in another shell.
Alternative: tee to `.spur/run/<runId>.log`. Settle: whether persisted data reconstructs the same line
stream as the foreground run; poll interval and termination; following an already-finished run; interaction
with `workflow clean` and `workflow cancel`; and whether `trace` and `run` should share one pure renderer.

#### Token cost and cache-hit ratio — display slot in scope, acquisition deferred

Operator ask: show token cost alongside time cost per `agent.run`, ideally with a cache-hit ratio.
**Evaluation: split it.** The *display contract* belongs here; the *data acquisition* does not.

**In scope for this ticket (cheap, prevents rework):** the line format must reserve a slot for
cost/token data and must define how it renders when the data is **unavailable**. Deciding the format
without that slot guarantees a redesign later. Unavailability is the common case, not the edge case, and
`packages/domain/src/envelope/attribution.ts` already sets the governing invariant (tickets 0281/0284):
provider cache dimensions are **never fabricated** — `providerCacheHit` is `boolean | 'unavailable'` and
absent telemetry must stay absent. The display must honor that rather than showing a plausible zero.

**Deferred to a follow-up ticket (materially larger than terminal rendering):** actually obtaining the
numbers. What exists today:

| Capability | State |
|---|---|
| Duration per action | **Already captured and displayed** (`durationMs`) |
| Cost/pricing math | **Already exists** — `computeRecordCost` / `aggregateCosts` / `resolvePricing` (`packages/domain/src/analytics/`) |
| Real token + cache counts in agent JSONL | **Already parsed** — `extractClaudeTokens` (`analytics/query.ts:74`) reads `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` |
| Cache breakdown preserved | **No** — `extractClaudeTokens` sums cache reads/creates into `inputTokens` and discards the split, so the ratio is computable at the source but thrown away |
| Tokens on the agent.run result | **No** — `AgentRunTracedResult` carries `exitCode`/`stdout`/`durationMs`/`signal`, no usage |
| Run ↔ agent-session join key | **No** — the session latch stores the string `"open"`, not a session id |
| Pipeline agent output mode | **text** — `.spur/workflows/task-pipeline.yaml` sets no `mode:`, so stdout is prose, not a usage-bearing JSON envelope |

Three acquisition paths, in ascending cost:

1. **Post-hoc join via history import** — *recommended*. `spur history import` already produces ETL rows
   with real usage, and the cost math already runs on them with real pricing. The only missing piece is a
   join key from a workflow run/action to those records. `EtlPayload` keeps `created_at` plus arbitrary
   passthrough fields, so either a captured session id or an approximate (agent, model, time-window) join
   is workable. Touches no live dispatch path, and yields *accurate* costs rather than parsed guesses.
   Cost appears on `workflow trace` shortly after a run rather than live during it — acceptable, since the
   operator's stated use is *evaluating* an `agent.run`, which is inherently after the fact.
2. **Recover the cache split** — small and independent: stop flattening cache reads/creates in
   `extractClaudeTokens` and carry them onto `CostRecord`. Unlocks the cache-hit ratio for every existing
   analytics surface, not just this one. Worth doing regardless of path 1.
3. **Live capture from agent stdout** — *not recommended as a first step*. Requires switching agent.run
   steps to `mode: 'json'`, which changes what the agent prints and risks breaking steps that consume
   `data.answer` / `answerFile` / `response.validate`; then a **per-agent** usage-envelope parser
   (omp / claude / codex / gemini all differ), plus a graceful path for agents reporting nothing. This is
   an adapter matrix, and it buys only earlier availability of numbers path 1 already produces accurately.

So: settle the slot and the `unavailable` rendering here; open the acquisition ticket after this lands,
starting with path 2 (independently useful) then path 1.

#### Out of scope

Web board / SSE; the `--json` shape (frozen); changing what is persisted; rewriting the pipeline YAML; and
the `runId: ''` correlation gap in `saveActionFinalize` (real, but only load-bearing under concurrent step
execution, which the engine does not do today).
### Requirements

<!-- Constraints the eventual direction must satisfy, if known. -->

### Acceptance Criteria
```gherkin
# Destination criteria for feature P. These describe the DESIGN being locked,
# not the shipped rendering — implementation acceptance belongs to the task
# batch this design produces.
Feature: workflow run observability — design destination

  Scenario: The engine seam is designed and released
    Given ticket 0310 is done
    When the design record is read
    Then the widened contract carrying action options to the observability seam is specified
    And backward compatibility for existing WorkflowPersistenceAdapter implementors is demonstrated
    And the mirror-never-alter-persistence invariant is confirmed intact
    And a ts-libs version and catalog bump path is named

  Scenario: The verbosity model and line formats are decided
    Given ticket 0310 is done
    When the design record is read
    Then the levels exposed by `spur workflow run` are named and specified
    And a line format carrying agent, truncated invocation, and duration is specified
    And a truncation and redaction policy is written down
    And `shell` steps are covered, not only `agent.run`
    And verbose-mode FSM transition rendering is specified
    And the format reserves a slot for per-agent.run token cost
    And an `unavailable` rendering is specified for absent cost telemetry

  Scenario: Long and detached runs are observable
    Given ticket 0310 is done
    When the design record is read
    Then a progress transport for `--async` runs is decided
    And a liveness mechanism for multi-minute steps is decided
    And non-TTY behavior is specified for both
```
### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

<!-- Candidate approaches, tradeoffs, and selected direction. -->

### Plan

<!-- Follow-up steps or task/feature creation plan once the idea is ready to execute. -->

### Solution

This design locks six interconnected decisions for `spur workflow run` observability. Each is grounded
against the existing codebase (source-verified locations in Background § "The crux constraint").

---


**Decision:** Add an optional 4th parameter `options?: Record<string, unknown>` to
`WorkflowPersistenceAdapter.saveActionStart(runId, stateOrNodeId, kind, options?)`.
The single call site at `dual-workflow-engine/src/action-step.ts:65` already has the full `action`
in scope — pass `action.options` through. This is a **persistence** decorator, not an action seam:
the options are forwarded to the observability layer but **never persisted** (the
"mirror, never alter persistence" invariant). The two existing `WorkflowPersistenceAdapter`
implementations at `persistence.ts:154` and `:309` accept the new parameter as a no-op default.

**Redaction:** `ActionRedactor` (already used by `saveActionFinalize`) is applied in
`observability.ts` before any rendering, not in the engine. The engine cannot know which Spur
option keys hold secrets.

**Backward compatibility:** The 4th parameter is optional with a `{}` default. Existing
implementors compile without changes. The interface widening is additive, not breaking.

**Version + catalog:** Bump `@gobing-ai/ts-dual-workflow-engine` minor version (0.4.x → 0.5.0)
per semver — additive interface change. Update root `workspaces.catalog` pin. This goes on the
critical path first.

**ADR:** Not warranted. The interface change is additive, backward-compatible, and local to one
method signature. No architectural tradeoff to record.

---


**Decision:** `spur workflow run --detail <quiet|normal|verbose|debug>`. Default: `normal`.
Not stacked `-v`/`-vv` — an explicit enum is clearer in CI, env vars, and `--vars` JSON.

| Level | What shows |
|-------|------------|
| `quiet` | Only phase headers and final status. Errors and warnings always surface. |
| `normal` (default) | Phase headers + enriched `agent.run` and `shell` lines (start + finish). |
| `verbose` | Normal + FSM transition lines (every hop). |
| `debug` | Verbose + raw event dumps (JSON). |

**TTY auto-degrade:** When stdout is not a TTY and `--detail` is unset, default degrades from
`normal` → `quiet`. An explicit `--detail` always wins. Rationale: enriched lines with CR rewrite
produce garbage in piped/CI output; periodic heartbeats cover non-TTY liveness separately.

**`--json` interaction:** `--json` freezes its output shape. `--detail` is ignored when `--json`
is set — the JSON stream carries structured events, not rendered lines.

**`--no-plan` interaction:** Orthogonal. Plan rendering is a separate concern from step output
verbosity.

**Env var:** `SPUR_WORKFLOW_DETAIL` for CI/nested invocation. CLI flag overrides env var.

**CLI surface:** `apps/cli/src/commands/workflow.ts:104-112` — add `--detail` option to the
`run` subcommand.

---


**Two-line model.** Invocation at start, duration + status at finish. On TTY, the start line is
rewritten in place (CR without LF) to add duration; on non-TTY, two separate lines.

**`agent.run` start:**
```
[agent.run] omp(zai) => /sp:dev-run 0302 --auto --next
```
Where `omp` is the agent name (from `AgentRunActionRunner` invocation data) and `zai` is the
model. Both are already captured in `ActionResult.data.invocation`
(`packages/app/src/workflow/actions/agent-run.ts`).

**`agent.run` finish (TTY — rewrites the start line):**
```
✓ agent.run (18m 33s) [cost unavailable]
```
**`agent.run` finish (non-TTY — separate line):**
```
  ✓ agent.run (18m 33s) [cost unavailable]
```

**`shell` start:**
```
[shell] bun run test
```
**`shell` finish:**
```
  ✓ shell (2.1s)
```

**Truncation:** Terminal-width aware, tail-biased, middle-ellipsis. A slash command's trailing
flags carry the most meaning — naive head-truncation is wrong. Example:
```
[agent.run] omp(zai) => .../sp:dev-run 0302 --auto --next
```
Fixed fallback width: 120 cols when terminal width is unavailable (piped).

**Redaction:** `ActionRedactor` is applied to the invocation string before rendering. The
redactor already exists for `saveActionFinalize`; reuse it at the rendering layer.

**Rendering stays pure:** `step-reporter.ts` keeps `(event) → string | null`. No side effects.
The timer/heartbeat is a CLI concern outside the reporter.

---


**Data already on the bus.** `observability.ts` emits `workflow.transition` with
`{ from, to, trigger }`. The CLI's `StepEvent` union excludes it; `renderStepLine` has no branch.

**Changes:**
1. Widen `StepEvent` union with `{ type: 'transition'; from: string; to: string; trigger: string | null }`
2. Add render branch (verbose only): `→ [trigger] from → to`
3. Subscribe under `--detail verbose`

**Deduplication:** `commitTransition` emits both `transition` and `phase` events — naively
rendering both yields two lines per hop. Solution: when a `transition` and `phase` event fire in
the same tick (same run state), suppress the phase line and render only the transition. Track
with a `lastTransitionRunId` guard in the subscriber.

**Null trigger:** Render as `→ <implicit>` (or suppress trigger portion entirely — `→ from → to`).

**Failed/short-circuit hops:** Render with `✗` glyph: `✗ [guard-deny] wip → testing`. These are
the reason verbose exists — they surface why a run stopped.

**Glyph vocabulary:** Reuse the existing guard rendering convention at
`apps/cli/src/commands/workflow.ts:451` — `→` for transitions, `✓` for success, `✗` for failure.
No second vocabulary.

---


#### Liveness — the 18-minute blind spot

**Decision: CLI-side elapsed timer — no new bus events, `step-reporter.ts` stays pure.**

- **TTY:** `setInterval` (every 5s) repaints the current step line with elapsed time:
  `[agent.run] omp(zai) => ... (still running — 4m 12s / 30m)`. CR rewrite in place.
- **Non-TTY:** Periodic heartbeat line appended to output:
  `── still running (4m 12s / 30m) ──`. Interval configurable via
  `SPUR_WORKFLOW_HEARTBEAT_S` (default 60s, minimum 10s). Set to `0` to suppress.

Budget source: `implementTimeoutMs` from `.spur/workflows/task-pipeline.yaml` (30m default).
If no timeout is configured, show elapsed only: `(still running — 4m 12s)`.

#### Async transport — `--async`

**Decision: `spur workflow trace --follow` — no new log files.**

- `spur workflow trace <runId>` already exists and reads durable rows from the DB.
- `--follow` polls at 2s intervals, printing new events as they arrive. Terminates when the
  run reaches a terminal state (`done` | `failed` | `cancelled`).
- `--follow` on an already-finished run: prints the full trace and exits immediately
  (idempotent — same as `trace` without `--follow`).
- **Shared renderer:** `trace` and `run` share one pure `StepEvent → string` renderer.
  `trace --follow` output is byte-identical to what `run --detail normal` would have printed
  for the same events (minus TTY-only CR rewrites).
- Interaction with `workflow clean`: tracing a cleaned run produces "run not found."
  Interaction with `workflow cancel`: tracing a cancelled run shows final state as `cancelled`.
- **No `.spur/run/<runId>.log`** — the DB is the single source of truth, and `trace --follow`
  reconstructs the same stream from it. A tee-to-file would fork observability into two paths
  that can diverge.

---


**Decision: Define the slot now; acquire data later.**

The finish line reserves a slot for per-`agent.run` cost data:

| Data available? | Rendering |
|-----------------|-----------|
| Full | `✓ agent.run (18m 33s) [$0.042 · 12,340 tokens · 34% cache hit]` |
| Cost only, no cache split | `✓ agent.run (18m 33s) [$0.042 · 12,340 tokens · cache —]` |
| Unavailable (default) | `✓ agent.run (18m 33s) [cost unavailable]` |

**Unavailable is the common case, not an error.** The `[cost unavailable]` suffix is rendered in
a dim/different style from error text — it signals "not yet" rather than "broken." This honors
the invariant from `packages/domain/src/envelope/attribution.ts` (tickets 0281/0284):
`providerCacheHit` is `boolean | 'unavailable'` and absent telemetry must stay absent.

**Acquisition path (deferred to follow-up ticket):**

| Order | Step | Rationale |
|-------|------|-----------|
| 1 | **Recover cache split** in `extractClaudeTokens` — stop flattening cache reads/creates; carry them onto `CostRecord`. | Independent of workflow; unlocks cache-hit ratio for all analytics surfaces. Small, standalone change. |
| 2 | **Post-hoc join via history import.** `spur history import` already produces ETL rows with real usage and pricing. Add a join key (captured session id or approximate time-window match) from workflow run/action to those records. | Yields accurate costs, not parsed guesses. Touches no live dispatch path. Cost appears on `trace` shortly after run completes — acceptable for the operator's stated use (evaluating after the fact). |
| 3 | **Live capture** (not recommended as first step). Requires switching agent.run to `mode: 'json'`, a per-agent usage-envelope parser matrix, and graceful fallback. | Only buys earlier availability of numbers path 2 already produces accurately. |

---


1. **Engine seam** — `@gobing-ai/ts-dual-workflow-engine` version bump + `saveActionStart` widening
2. **`--detail` flag** — CLI argument + TTY detection + auto-degrade
3. **Line formats** — two-line model, `agent.run` + `shell`, truncation, redaction
4. **FSM transitions** — `StepEvent` union widening, render branch, dedup
5. **Liveness** — elapsed timer (TTY) + heartbeat (non-TTY)
6. **Async `trace --follow`** — poll loop, shared renderer
7. **Token cost slot** — format definition only (acquisition deferred)

Items 1–3 are the minimum viable observability improvement; 4–7 layer on top. Token cost
acquisition is a separate follow-up ticket (path 2 → path 1 from §6).
### Testing
**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: The engine seam is designed and released | MET | static-ref | Solution §1 — widened `saveActionStart` with optional 4th param `options?: Record<string, unknown>`, backward-compat via default `{}`, mirror-never-alter-persistence invariant confirmed, version bump 0.4.x → 0.5.0 + catalog pin path named |
| Scenario: The verbosity model and line formats are decided | MET | static-ref | Solution §§2–4,6 — `--detail <quiet\|normal\|verbose\|debug>` with TTY auto-degrade; two-line model with agent+model+invocation+truncation; ActionRedactor redaction; shell step formats; FSM transition rendering with dedup and glyph vocabulary; token cost slot with `[cost unavailable]` default |
| Scenario: Long and detached runs are observable | MET | static-ref | Solution §5 — `spur workflow trace --follow` polling durable rows at 2s for async; CLI-side elapsed timer (TTY CR rewrite) + periodic heartbeat (non-TTY, `SPUR_WORKFLOW_HEARTBEAT_S`, default 60s); non-TTY behavior specified for both |

**Per-Requirement Traceability**

Requirements section is empty (no R-items defined). N/A — this is a brainstorm/design task; the AC scenarios are the traceability targets.

**SECUA Review**

No code changes (brainstorm task — deliverable is the `## Solution` design document). SECUA dimensions are not applicable to prose design output.

| Finding | Severity | File:Line | Notes |
|---------|----------|-----------|-------|
| — | — | — | No code to review |
### Review
**Design Review — brainstorm task, no code changes.**

The deliverable is the `## Solution` design document. All AC scenarios trace to Solution sections with concrete decisions. No implementation code was produced — this task locks the design; implementation follows in child tasks.

| Priority | Finding | Status | File:Line | Notes |
|----------|---------|--------|-----------|-------|
| P1 | — | — | — | No blockers — design document is internally consistent |
| P2 | — | — | — | No deferred requirements |
| P3 | Token cost acquisition deferred | OPEN → follow-up | Solution §6 | Acquisition paths 1–3 deferred to follow-up ticket per explicit scope split |
| P4 | Engine seam ADR decision | RESOLVED | Solution §1 | ADR not warranted (additive, backward-compatible interface change) |
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-07-21T22:56:27.142Z todo → wip (system)
- 2026-07-21T22:56:30.323Z wip → testing (system)
- 2026-07-21T22:57:36.195Z testing → done (system)
