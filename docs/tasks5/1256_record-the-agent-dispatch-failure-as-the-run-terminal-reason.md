---
schema_version: 1
name: Record the agent dispatch failure as the run terminal reason
status: done
template: issue
created_at: 2026-10-18T19:33:17.168Z
updated_at: "2026-10-20T02:33:20.264Z"

feature_id: D3
priority: P2
ac_altitude: task-local
estimate_hours: 4
dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1256-verdict.json
---

## 1256. Record the agent dispatch failure as the run terminal reason

### Background

Valid cause-attribution gap: classifyTerminalReason has an agent.run branch, but all three production closure call sites omit actionKind (`packages/app/src/workflow/action-trace.ts:244,357` and `packages/app/src/workflow/observability.ts:520`). They pass only status/reason/errorText, so an immediate dispatch failure carrying an opaque error falls through to failed-check even when the failing action row identifies agent.run. The local DB contains both classified and unclassified historical failures; no historical rewrite is required to establish this code gap.

**Refine corrections (2026-10-18)**
- Retained: preserve the causal failing action identity at new-run closure and classify immediate agent failures correctly.
- Removed: dynamic terminal reasons containing stage/executor, six new reason classes, optional migrations and a reasonClass column. The current closed vocabulary already distinguishes failed-agent, failed-timeout, failed-check and failed-guard; action rows already hold node/error/agent details.
- Removed: the claim that every failed agent action must override the final run reason. A recovered failure followed by a gate failure, explicit cancellation or retry exhaustion must keep its actual terminal cause. Declared reasons intentionally have precedence; the current classifier test documents that.
- Removed: an asserted universal structured errorClass field; agent.run paths do not share such a field today. Reuse existing result.error/data and typed run statuses without inventing a cause taxonomy. Estimate unset → 4h.

### Requirements

- [x] R1. A new run closing directly because its current agent.run action failed records failed-agent; a definite timeout records failed-timeout through the existing classifier. The associated action row retains the node, selected executor/agent and redacted error evidence.
- [x] R2. Gate/guard failures, explicit declared terminal reasons, cancellation, interruption, paused-operator, retry exhaustion and outcome-unknown keep existing precedence and vocabulary. A previously recovered agent failure must not relabel a later unrelated close.
- [x] R3. The persisted run terminal reason and workflow.run.finalized event report the same classification in inline and engine-backed execution. Existing callers that supply no reason retain their legacy null behavior.
- [x] R4. Real persistence-adapter tests cover immediate agent failure, timeout, gate failure, recovered failure followed by a gate, explicit cancellation/retry bound, outcome-unknown and concurrent run isolation.

Out of scope: dispatch retry policy, quota/auth handling, new terminal enum members, database columns/migrations, Board UI redesign, historical DB repair and executor/model resolution.

### Acceptance Criteria

- [x] AC1 — An immediate agent failure and timeout persist the existing specific terminal reasons (req: R1, R4)
- [x] AC2 — Recovered failures and explicit lifecycle reasons retain the true terminal cause (req: R2, R4)
- [x] AC3 — Event and stored reason agree across execution paths without cross-run leakage (req: R3, R4)

### Q&A

- Closed: preserve the nine-member TERMINAL_REASONS vocabulary and existing trace details; no migration.
- Closed: an explicit reason is not invalid just because an earlier agent action failed.
- Closed: unavailable structured classes are not inferred from provider-specific strings in this task.

### Design

Chosen: carry bounded, run-scoped causal action context through the existing persistence decorators and call classifyTerminalReason once with it; no new public API/schema. Reuse saveActionStart/saveActionFinalize boundary identity in WorkflowActionTraceWriter and equivalent observability action callbacks. Store only the current relevant identity/result fields; clear on recovery/progression/final close so a prior failure cannot poison a later one. If existing decorator composition can expose one classified closure value to both persistence and event emission, use it rather than adding independent classification rules. Read the actual wrapper order at the workflow service composition root before editing.

Precedence: explicit declared reasons and terminal/resumable status semantics stay authoritative; action kind refines only otherwise unclassified direct failures. Timeout remains the existing failed-timeout branch; outcome-unknown remains interrupted. Never pick the last historical failed row by a broad database query. No concatenated stage/executor in terminal_reason: trace/action rows are the detailed evidence.

Targets: `packages/app/src/workflow/terminal-reason.ts`, `packages/app/src/workflow/action-trace.ts`, `packages/app/src/workflow/observability.ts`; composition wiring only if necessary to avoid double classification. Tests: `packages/app/tests/workflow/terminal-reason.test.ts`, `packages/app/tests/workflow/action-trace.test.ts` and `packages/app/tests/workflow/observability.test.ts` and one fake-agent workflow close fixture. Owning taxonomy/write-path contract: `docs/design/workflow-catalogue-refactor.md` §3, referenced by `docs/design/observability-contracts.md`; update only changed semantics.

Dependencies: none; 1255 fixes dispatch input, 1260 owns failover policy, 1257 was cancelled because durable lifecycle behavior already exists. Preserve that behavior. Budget 4h; evidence is persisted run row plus matching emitted event, not only a helper unit test.

### Plan

- [x] 1. Reproduce through the real decorator chain: failing fake agent action closes with failed-check despite kind agent.run; capture the stored row and finalized event (R1, R3).
- [x] 2. Add regressions for recovered-failure/later-gate, concurrent runs, explicit cancel/bound, timeout and outcome-unknown precedence (R2, R4).
- [x] 3. Thread current causal action context into the existing closure classifier and keep persisted/event classification identical; retain null/no-reason compatibility (R1-R3).
- [x] 4. Run focused terminal-reason, trace, observability and workflow service tests inside packages/app; run app/CLI typechecks and a hermetic CLI trace probe (R4).
- [x] 5. Update the owning contract, run task-local gate, then review/verify. Do not mutate historical run rows or taxonomy to make tests green.

### Root Cause

WorkflowActionTraceWriter already receives action kind, run/node identity and the final result at saveActionFinalize, but discards their causal context before finalizeRun. ObservableWorkflowAdapter classifies the same raw reason separately, also without action identity. Missing context makes the existing classifier's failed-agent branch unreachable through these ordinary closure paths. An arbitrary earlier failed action is not sufficient causal evidence.

### Solution

Threaded the failing action's identity into the existing run-closure classifier, so an immediate
`agent.run` failure is recorded as `failed-agent` instead of falling through to `failed-check`.

| File | Change |
| --- | --- |
| `packages/app/src/workflow/terminal-reason.ts:47-127` | New exported `CausalActionContext` (plus `CausalActionFailure`): a run-scoped record of the last failed action's kind and its own bounded error text, set at the action boundary, cleared by any successful action, consumed at the run's terminal close, and bounded to 64 live runs. Pure, no schema and no new terminal enum member. |
| `packages/app/src/workflow/action-trace.ts:222,250,371` | `WorkflowActionTraceWriter` notes every action finalize against its boundary run id (success clears, failure replaces) and consumes the context at both closures — `finalizeRun` (engine/lifecycle) and `closeRun` (inline driver). The classified value is exactly one classification per close. |
| `packages/app/src/workflow/observability.ts:526,633` | `ObservableWorkflowAdapter` uses its own tracker from its `saveActionFinalize` hook and classifies once, then persists that value and emits it as `terminalReason` on `workflow.run.finalized` (new optional field on `WorkflowRunFinalizedEvent`), so the row and the event agree. |
| `packages/app/src/index.ts:1156-1164` | Barrel exports the tracker and its result type for the app layer. |
| `docs/design/workflow-catalogue-refactor.md:59-68` | Owning taxonomy contract records the causal-identity rule, the precedence that stays authoritative (declared reason, guard/bound, outcome-unknown) and the event/row agreement. |
| `packages/app/tests/workflow/action-trace.test.ts:729-835` | Real persistence-adapter closure tests: immediate agent failure → `failed-agent` (action row keeps node/kind/ok), recovered failure + gate → `failed-guard`, cancellation and timeout precedence, concurrent-run isolation, and reasonless-close null compatibility. |
| `packages/app/tests/workflow/observability.test.ts:424-481` | The emitted event's `terminalReason` equals the persisted reason for an immediate failure, a recovered failure and a reasonless close. |
| `packages/app/tests/workflow/terminal-reason.test.ts:146-203` | Tracker semantics: failure/timeout classification, progress clearing, declared/outcome-unknown precedence, run isolation, destructive consume. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/action-trace.ts:222` records the failing action kind at its boundary; `packages/app/src/workflow/action-trace.ts:250` and `packages/app/src/workflow/action-trace.ts:371` consume it at engine finalize and inline close (anchors re-read this run); `packages/app/tests/workflow/action-trace.test.ts:758` persists failed-agent and `packages/app/tests/workflow/action-trace.test.ts:787` keeps failed-timeout |
| R2 | MET | `packages/app/tests/workflow/action-trace.test.ts:774` gate classification after a recovered failure, `:787` explicit cancellation outranks a live failure, `:828` reasonless legacy null; precedence owned unchanged by `packages/app/src/workflow/terminal-reason.ts:130-140` |
| R3 | MET | `packages/app/src/workflow/observability.ts:526-538` consumes once, persists and emits the same terminalReason on workflow.run.finalized; `packages/app/tests/workflow/observability.test.ts:425` and `packages/app/tests/workflow/observability.test.ts:456` assert persisted == emitted |
| R4 | MET | `packages/app/tests/workflow/action-trace.test.ts:729` suite drives the real persistence adapter for immediate failure, timeout, recovered-then-gate, cancellation, concurrency (`:811`) and reasonless close; `packages/app/tests/workflow/terminal-reason.test.ts:146` covers the tracker |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/workflow/action-trace.test.ts:758` (failed-agent) and `:787` (failed-timeout); re-run this session: `bun test tests/workflow/action-trace.test.ts tests/workflow/observability.test.ts tests/workflow/terminal-reason.test.ts` 60 pass / 0 fail |
| AC2 | MET | test | `packages/app/tests/workflow/action-trace.test.ts:774` (recovered + gate), `:787` (cancellation precedence), `:828` (reasonless close) |
| AC3 | MET | test | `packages/app/tests/workflow/observability.test.ts:425` and `:456` event == stored reason; `packages/app/tests/workflow/action-trace.test.ts:811` concurrent runs isolated |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1256
**Scope:** task 1256 diff — `packages/app/src/workflow/terminal-reason.ts`, `action-trace.ts`, `observability.ts`, `packages/app/src/index.ts`, `docs/design/workflow-catalogue-refactor.md`, three workflow test files
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | `causalErrorText` reads only the top-level `error`/`message`/`reason` string of an action result. A diagnostic nested inside `data` records the action kind but no text — the kind still classifies `failed-agent`, and the engine reason is passed as the fallback error text, so the timeout branch stays reachable; a nested-only timeout string would classify as `failed-agent`. | `packages/app/src/workflow/terminal-reason.ts:66` | ACCEPTED |
| 2 | P4 (advisory) | architecture | Each persistence decorator owns a separate tracker instance by design: they classify the same run's closure independently, and a shared tracker would let whichever runs first consume the context and leave the other classifying without it (the persisted row could then disagree with the event). The cost is a few duplicated lines of Map handling. | `packages/app/src/workflow/observability.ts:497` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/workflow/action-trace.ts:222,250,371` track and consume the causal context at both closures; `packages/app/tests/workflow/action-trace.test.ts:749` asserts the persisted `failed-agent` through the real SQLite adapter, with the action row keeping node/kind/ok, and `:788` covers `failed-timeout` |
| R2 | MET | `packages/app/tests/workflow/action-trace.test.ts:770` (recovered failure then gate failure → `failed-guard`), `:788` (declared `cancelled` outranks a live failure), `:806` (concurrent runs stay isolated) and `:820` (reasonless close keeps the legacy null); the declared-reason/guard/outcome-unknown precedence in `classifyTerminalReason` is unchanged and re-pinned in `packages/app/tests/workflow/terminal-reason.test.ts:170` |
| R3 | MET | `packages/app/src/workflow/observability.ts:526-543` classifies once and both persists and emits that value (`WorkflowRunFinalizedEvent.terminalReason`, `:77-87`); `packages/app/tests/workflow/observability.test.ts:427` asserts `persisted === emitted === 'failed-agent'` and `:455` the recovered/reasonless cases |
| R4 | MET | The closures run against `DbWorkflowPersistenceAdapter` over a real in-memory project DB (`packages/app/tests/workflow/action-trace.test.ts:729-835`): immediate failure, timeout, recovered-then-gate, cancellation, concurrent isolation, reasonless null; no fake-level stubbing of the classification path |

**Residual risk:** the two P4 advisories above. The nested-diagnostic gap is bounded: the kind-based classification (`failed-agent`) is correct regardless, and only the timeout sub-classification depends on the text.

**Next:** close 1256 (`record` writes Testing from the PASS verdict; no open P1-P3).
Confidence: MEDIUM

### References

Refinement audit: 2026-10-18, source-local CLI, tasks 1254–1260 processed sequentially.

Evidence: action-trace.ts and observability.ts closure call sites; terminal-reason.ts precedence and closed enum.

Concurrency snapshot: git worktree list shows main only; task list --status wip returns []; one writer per tree. Recheck both before implementation. The tracked tree advanced to release 0.4.15 during the audit; preserve those external commits. Inspect installed versions/bundle at task start, then regenerate only artifacts affected by implementation.

Implement-ready checklist (specification, not an implementation PASS):

```json
[
  {
    "id": "requirements",
    "pass": true,
    "evidence": "Requirements contain bounded observable outcomes, scope exclusions and named current seams."
  },
  {
    "id": "design",
    "pass": true,
    "evidence": "Design freezes reused contracts, algorithm/precedence, files, negative cases and no-new-surface constraints."
  },
  {
    "id": "plan",
    "pass": true,
    "evidence": "Ordered Plan starts with failing fixtures, then minimal fix and named workspace/gate evidence."
  },
  {
    "id": "ac",
    "pass": true,
    "evidence": "Task-local checkbox ACs map every retained requirement to test-observable outcomes; implementation remains unchecked."
  },
  {
    "id": "decisions",
    "pass": true,
    "evidence": "Q&A closes original design choices; false premises and speculative APIs removed."
  },
  {
    "id": "dependencies",
    "pass": true,
    "evidence": "No unmet design prerequisites; boundaries to adjacent tasks explicit."
  },
  {
    "id": "premises",
    "pass": true,
    "evidence": "action-trace.ts and observability.ts closure call sites; terminal-reason.ts precedence and closed enum"
  }
]
```

### History

- 2026-10-19T07:46:32.942Z todo → wip (system)
- 2026-10-19T07:59:27.836Z wip → testing (system)
- 2026-10-19T07:59:29.784Z testing → done (system)

