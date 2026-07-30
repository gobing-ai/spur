---
schema_version: 1
id: "D1"
name: "workflow run observability — enriched step lines, FSM transitions, async follow"
status: done
priority: P2
tags: []
created_at: "2026-07-21T20:46:29.481Z"
updated_at: "2026-07-30T21:10:15.480Z"
---

# P: workflow run observability — enriched step lines, FSM transitions, async follow

## Goal
**Destination:** a locked design + ready-to-run task batch for `spur workflow run` observability — enriched
step lines (real agent + truncated invocation + duration), verbose FSM transition output, and a follow path
for `--async` runs.

This is a **wayfinder map** (skill `sp:wayfinder`). The map is the orienting artifact; child tasks are
investigation tickets resolved **one per session**. Reaching the destination means the design is settled and
decomposed — implementation runs afterward through the normal `/sp:dev-*` pipeline as separate work.

### The problem, concretely

Today a 30-minute pipeline run prints this and nothing else:

```
▶ implement [running]
  → implement: agent.run…
  ✓ done (18m 33s)
```

`agent.run…` is the *action kind*. It does not say which agent ran, what it was asked to do, or what happened
during those 18 minutes. The operator wants:

```
[agent.run] - omp(zai) => /sp:dev-run 0302 --auto --next
```

### The crux constraint (found while charting)

The observability seam is a **persistence** decorator, not an action seam:

- `packages/app/src/workflow/observability.ts` — `ObservableWorkflowAdapter.saveActionStart(runId, node, kind)`
- The engine calls it at `dual-workflow-engine/src/action-step.ts:65` as
  `persistence.saveActionStart(runId, stateOrNodeId, action.kind)`

The action's `options` (which carry `agent`, `input`, `command`) **never reach the seam**. So the headline ask
is *not* a formatter change in `step-reporter.ts` — it needs the engine to widen `saveActionStart`.
Operator decision (charting session): take the **upstream engine change** in
`@gobing-ai/ts-dual-workflow-engine` rather than an in-repo ActionRunner decorator.
## Scope
**In scope:**

- `spur workflow run` synchronous human output (non-`--json`), both default and verbose modes.
- The upstream `saveActionStart` widening in `@gobing-ai/ts-dual-workflow-engine` + its release/bump.
- Enriched `agent.run` lines: resolved agent (+ model when set), truncated prompt/slash command, duration.
- Enriched `shell` lines: the actual command, truncated.
- Verbose mode: FSM transitions (`from → to`, trigger/guard), already on the bus but unsubscribed.
- Redaction/truncation policy for invocation text surfaced to the terminal.
- `--async` follow: extending `spur workflow trace <runId>` (it already exists and is what the async
  launcher tells the operator to run) rather than inventing a new command.
- Long-step liveness for the 18-minute blind spot (heartbeat / elapsed ticker).

**Out of scope:** — work consciously ruled beyond this destination. Per `sp:wayfinder`, out-of-scope work
never graduates back onto the frontier; it returns only if the destination is redrawn, as a fresh effort.

- The **web board** and any SSE/WS surface. The bus already carries these events; the board can consume
  the enriched payload later on its own cadence. Ruled out during charting to keep the map finishable.
- `--json` output shape. Machine output stays byte-identical — this is a human-output effort.
- Any change to what is **persisted**. The `ObservableWorkflowAdapter` contract is "mirror, never alter
  persistence"; that invariant holds. (0311 must confirm it, not relax it.)
- Rewriting the pipeline YAML itself (`.spur/workflows/task-pipeline.yaml`). Observability reads the
  definition; it does not restructure it.
- Fixing the `runId: ''` correlation gap in `saveActionFinalize`. Real, but only load-bearing under
  concurrent step execution, which the engine does not do today. Noted in the fog, not chased here.
## Acceptance Criteria
```gherkin
Feature: observable and steerable workflow execution

  Scenario: Rich progress is the human default
    Given a synchronous human workflow run containing agent.run
    When the action starts and remains active
    Then output identifies the run, state, action, resolved agent, and redacted invocation
    And periodic output reports elapsed time and timeout budget
    And completion reports duration, outcome, and usage or unavailable

  Scenario: Output modes remain composable and machine-safe
    Given the same workflow run
    When default, quiet or silent, verbose, and JSON modes are selected
    Then each human mode emits only its documented detail level
    And JSON remains a valid stable machine stream with no interactive or prose contamination

  Scenario: Interim output is streamed without losing the final answer
    Given a supported synchronous agent.run action emits stdout and stderr over time
    When live output is enabled by the selected human mode
    Then bounded redacted chunks appear before action completion
    And the action's buffered final answer and response validation remain correct
    And a slow terminal cannot deadlock or exhaust memory

  Scenario: Detached runs can be followed
    Given a workflow was started asynchronously in another process
    When the operator runs workflow trace with follow mode
    Then persisted events are replayed in order and new events continue to appear
    And following terminates with the run's final status and reason

  Scenario: Agent lifecycle correlation is complete
    Given execution enters through agent.run or spur agent run
    When start, output, heartbeat, finish, failure, or cancellation events are observed
    Then every event carries a non-empty run id and the required action or execution identity
    And nested execution is not double-counted

  Scenario: A secret never reaches an observability sink
    Given prompts, commands, environment values, output chunks, or steering notes contain known secrets
    When events are emitted, persisted, rendered, and followed
    Then all configured secrets are redacted before every sink
    And payload truncation cannot reveal the removed material

  Scenario: Bounded steering changes only a safe active run
    Given a synchronous run is paused at a declared steering boundary
    When the operator sends continue, note, retry, or abort with the expected state version
    Then the engine acknowledges exactly one request and performs the permitted transition
    And stale, duplicate, unauthorized, or unsafe-retry requests are rejected with a reason

  Scenario: Cancellation reaches the child process and trace
    Given an active agent subprocess
    When steering abort or Ctrl-C cancels the run
    Then cancellation propagates to the process group
    And partial output is finalized
    And the durable trace records who or what cancelled the run and the final reason
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0310 | Decide the verbosity model for spur workflow run output | done |
| 0311 | Attach real token cost and cache-hit ratio to workflow agent.run steps via history join | done |
| 0365 | Implement workflow run observability, live output, and steering foundations | done |
<!-- END AUTO-GENERATED -->

## Notes
### Skills every session should consult

- `sp:wayfinder` — the map protocol. **One ticket per session.** Claim (`wip`) before work.
- `sp:spur-cli` — `spur task` / `spur feature` verbs. Corpus writes are CLI-gated.
- `sp:source-driven-development` — for the engine ticket: verify the real `WorkflowPersistenceAdapter`
  contract against ts-libs source, not memory.

### Standing preferences

- **Machine output is frozen.** `--json` bytes must not change. Every idea here is human-output only.
- **Mirror, never alter persistence.** `ObservableWorkflowAdapter`'s whole point is that observability
  never changes what is stored. Any proposal that widens the *persisted* row needs an explicit ADR.
- **Pure formatters.** `step-reporter.ts` is deliberately I/O-free (`event → string | null`) so it is
  unit-testable and reusable by future surfaces. Keep new rendering pure.
- Engine work happens in `~/xprojects/ts-libs/packages/dual-workflow-engine`; Spur consumes it via the root
  `workspaces.catalog` pin (currently `^0.4.10`). Prefer fixing the ts-libs facade over a Spur workaround.

### Ground truth gathered while charting

| Fact | Evidence |
|---|---|
| Bus already emits `workflow.transition` with `from`/`to`/`trigger` | `packages/app/src/workflow/observability.ts` (`saveTransition`, `commitTransition`) |
| CLI subscribes to only phase + action.started + action.finished — **never transition** | `apps/cli/src/commands/workflow.ts:196-198` |
| No `--verbose` flag exists on `workflow run` | `apps/cli/src/commands/workflow.ts:104-112` |
| `action.finished` emits `runId: ''` — correlation gap | `packages/app/src/workflow/observability.ts` (`saveActionFinalize`) |
| Engine has the full `action` object in scope at the call site | `dual-workflow-engine/src/action-step.ts:65` |
| Interface + 2 impls to update | `dual-workflow-engine/src/types.ts:278`, `persistence.ts:154`, `persistence.ts:309` |
| `agent.run` already captures a resolved invocation (agent, argv, cwd, timeout) | `packages/app/src/workflow/actions/agent-run.ts` — `ActionResult.data.invocation` |
| Failures already write a partial-work artifact | `.spur/run/<runId>-<state>-partial.md` |
| `spur workflow trace <runId>` already exists; async launcher points at it | `apps/cli/src/commands/workflow.ts` |

### Decisions so far

<!-- One line per closed ticket: WBS + title + one-line gist. Populated as tickets resolve. -->

- Charting session — **enrichment path = upstream engine change.** Widen `saveActionStart` in
  `@gobing-ai/ts-dual-workflow-engine` rather than decorating ActionRunners in-repo. Accepts a ts-libs
  release cycle on the critical path in exchange for one clean seam.
- Charting session — **surface scope = sync CLI + async follow.** Web board and SSE ruled out (see Scope/Out).
- Charting session — **destination = spec'd + decomposed task batch**, not shipped code.
- Post-charting — **consolidated six investigation tickets into one (0310).** Six tickets was
  disproportionate for the size of the change; the questions are tightly coupled and better answered in one
  pass. 0311–0315 deleted.
- Post-charting — **token cost split in two: display slot (0310) + acquisition (0311).** Path (2) of the
  acquisition plan is **DONE**: the analytics layer now preserves the cache read/create split
  (`extractClaudeTokens` → `ExtractedTokens`, `CostRecord.cacheReadTokens`/`cacheCreationTokens`/
  `usageReported`) and exposes `cacheHitRatio(totals) → number | null` (null = unavailable, never a fabricated
  0), surfaced on `spur history analyze` output. Path (1) — the run↔usage join that puts real cost on
  `spur workflow trace` — is captured as **0311** (feature-impl, deferred; depends on 0310) with full
  Background/Requirements/Design/Plan/References for a cold pickup.

### Not yet specified — the fog

Fog — in scope, but not yet sharp enough to ticket:

- **Failure-path output.** A failed step currently prints `✗ failed (0s)` and the run ends with
  `workflow failed: task-pipeline -> verify`. The partial-work artifact path is never printed, so the
  operator doesn't know it exists. Probably a ticket after the verbosity model lands.
- **Whether `--verbose` should also change the plan preview.** The `plan:` line lists every state including
  terminals (`done → failed → cancelled`), which reads oddly as a "plan". Unclear if this is in scope or a
  separate paper-cut.
- **Interleaving under future concurrency.** If steps ever run concurrently, line-oriented output breaks and
  the `runId: ''` gap in `action.finished` becomes load-bearing. Not a problem today (engine is sequential).
- **Whether any of this warrants an ADR.** Widening a published engine interface may cross the ADR-020 line.
  Folded into 0310 as a sub-question; if the answer is yes it graduates into its own ticket.
- **Token/cost acquisition — a named follow-up, not fog.** 0310 settles only the *display slot* and the
  `unavailable` rendering. Getting real numbers is a separate ticket, opened after 0310 lands, in this
  order: (1) stop flattening the cache read/create split in `extractClaudeTokens`
  (`packages/domain/src/analytics/query.ts:74`) and carry it onto `CostRecord` — independently useful to
  every analytics surface; (2) add a run ↔ agent-session join so `workflow trace` can attach the costs
  history import already computes with real pricing. Live stdout parsing (`mode: 'json'` + a per-agent
  usage-envelope adapter matrix) is explicitly *not* the recommended first step.
- **Whether `spur workflow trace`'s existing output should be unified with the live run's line vocabulary.**
  If 0310 lands on DB-polling for async, trace and run would render the same event stream through two code
  paths — possibly one shared pure renderer. Can't specify until 0310 picks a transport.

### Frontier

One ticket: **0310**. Charting initially cut this into six (0310–0315); the operator judged that
disproportionate for the size of the change and consolidated them into 0310, which now carries the whole
design question. 0311–0315 were deleted.

Within 0310, start with the **engine seam** — it gates a ts-libs release cycle, and its answer is
independent of every display decision.

**Note:** 0310's title still reads "Decide the verbosity model", which understates its consolidated scope.
The CLI has no task-rename verb (`spur task` exposes no `delete` or `rename`), so the title was left rather
than direct-writing the corpus. Read the scope from `### Background`.
## History
- 2026-07-25T19:33:21.180Z backlog → active (system)
- 2026-07-25T19:33:21.408Z active → verifying (system)
- 2026-07-28T00:31:37.075Z moved P → D1 (system)
- 2026-07-30T20:03:20.156Z verifying → done (system)
