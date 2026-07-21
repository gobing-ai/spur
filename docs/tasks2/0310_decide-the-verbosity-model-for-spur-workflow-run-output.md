---
template: brainstorm
schema_version: 1
name: "Decide the verbosity model for spur workflow run output"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: P
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-21T20:48:47.838Z"
updated_at: "2026-07-21T22:16:08.365Z"
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

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
