---
schema_version: 1
name: Executor-failure rescue classifier for unmatched dispatch failures
status: todo
template: issue
created_at: 2026-10-19T18:27:34.608Z
updated_at: "2026-10-19T20:41:57.355Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
dependencies: ["1260", "1262"]
feature_id: P1
---

## 1264. Executor-failure rescue classifier for unmatched dispatch failures

### Background

This task follows task 1260 (executor failover on quota/auth) and is not part of it. 1260
deliberately keeps recognition rule-based and narrow (the 0407 precision bias).

`classifyDispatch` (`packages/app/src/services/failure-classification.ts:142-162`) maps a failed
dispatch to an `ObjectiveEscalationSignal` through `FAILURE_RULES` (`:25`). The executor loop calls
it via `classifyObjectiveFailure` (`packages/app/src/services/agent-run-executor.ts:672`). Anything
unmatched yields `undefined`, the loop `break`s (`:674-676`), and the run fails as a task defect.
That gives good precision but a recall gap. A new vendor message ("credits depleted", a reworded
rate limit, a proxy error body) fails the task instead of failing over until someone adds a regex.

A catalog decision suits this residue: it has a fixed vocabulary, a fail-safe fallback, ledger
visibility, and it runs only after the rules have had their say. This task adds it, off by
default.

### Requirements

- [ ] R1. **Catalog decision.** New shipped catalog `config/decisions/executor.yaml` with decision `executor-failure-class`: `type: choice`, labels `resource-exhaustion`, `auth`, `task-defect`; `fallback: task-defect`; `minConfidence: 0.85`; `instructions` embedding `${params.instructions}` with observable criteria per label. There is no `transient` label; the escalation enum has no retry signal (`packages/domain/src/stage-registry/schema.ts:375-382`).
- [ ] R2. **Rescue only the residue.** Consult the decision only when all of these hold: the dispatch exited non-zero without a signal (no timeout); `classifyDispatch` returned `undefined`; `permissionFailureEvidence(text)` is `undefined` (a permission denial stays terminal, 0687 R9); `quotaConfirmed` is false; the stderr+stdout text is non-blank; and the rescue seam is wired (R4). Evidence is `redactAndBound(text, configuredSecretValues(env), Number.MAX_SAFE_INTEGER).slice(-4096)` over `text = stderr + "\n" + stdout` (`packages/app/src/observability/agent-execution.ts:342,352`): redact the **full** text first, then take the tail. `redactAndBound` keeps the head (`slice(0, maxChars)`), and slicing before redacting can cut a secret at the boundary and leak its unmatched fragment.
- [ ] R3. **Mapping.** Accepted `resource-exhaustion` or `auth` becomes `escalationSignal` and enters the existing 1260 path unchanged (fallback matching, attempted-set exclusion, chain-exhausted diagnostic). `task-defect`, any fallback, low confidence, or a thrown error → `undefined` (today's behaviour). A rescue failure never fails the run differently than it would have without the rescue.
- [ ] R4. **Opt-in seam.** `AgentServiceContext` (`packages/app/src/services/agent-service.ts:249`) gains optional `classifyUnmatchedFailure?: (evidence: string, correlation: DecisionCorrelation) => Promise<'resource-exhaustion' | 'auth' | undefined>`. `apps/cli/src/context.ts:168` wires it only when `spurConfig.workflows.executorFailureDecisionMaker === true`. The new optional boolean sits beside `decideDecisionMaker` at `packages/config/src/index.ts:823` and defaults to absent/false. The wired function calls `getDecisionService(spurConfig, cwd).decide('executor-failure-class', { instructions: evidence }, { bus, context: { caller: 'executor', correlation }, decisionLog })`.
- [ ] R5. **Ledger attribution.** Add `'executor'` to `DecisionCaller` (`packages/app/src/decision/decision-events.ts:32`), so every rescue appears in `decision.*` events and `decision_logs` with `caller: executor` and the run id. Then `spur decision status --reliability` reports it with no extra work.
- [ ] R6. **Docs.** `plugins/sp/skills/spur-cli/references/decision.md` documents the flag, the off-box evidence caveat for hosted makers, the recommended maker (probability-native; `laya-local` keeps evidence on-box once 1262 R1 lands), and a `decision_logs` query that lists accepted rescues so a maintainer can promote recurring text to a `FAILURE_RULES` entry.

### Acceptance Criteria

```gherkin
Scenario: AC1 — rule matches never consult the model (req: R2)
  Given the rescue seam wired with a recording double and a dispatch failing with a FAILURE_RULES resource-exhaustion message
  When the executor loop handles the failure
  Then the signal is resource-exhaustion and the double was not called

Scenario: AC2 — an unmatched exhaustion message fails over when accepted (req: R1, R3)
  Given an unmatched "credits depleted for this billing period" failure and a rescue double returning resource-exhaustion
  When the executor loop handles the failure
  Then the next eligible executor is dispatched under the 1260 exclusion rules

Scenario: AC3 — uncertainty, errors and permission denials keep today's behaviour (req: R2, R3)
  Given an unmatched failure with a rescue double returning undefined, a double that throws, and a permission-denied failure
  When the executor loop handles each failure
  Then each run ends with no failover, and the permission-denied run never calls the double

Scenario: AC4 — disabled by default (req: R4)
  Given default config
  When the CLI context builds the agent service
  Then classifyUnmatchedFailure is absent and an unmatched failure ends with no decision event

Scenario: AC5 — the wired rescue is redacted and attributed (req: R1, R2, R5)
  Given the flag on, a maker double answering resource-exhaustion at 0.95, and output containing a configured secret value that straddles the 4096-character tail boundary
  When the rescue runs
  Then the decision row has caller executor and the run id, and the evidence sent to the maker does not contain the secret

Scenario: AC6 — the operator guide exists (req: R6)
  Given the decision CLI reference
  When a reader looks up executor failure rescue
  Then it documents the flag, the off-box evidence caveat, the recommended maker and the promotion query
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-19T18:59:30.390Z

- **Q: Feature?** A: P1 ("workflow decision points adopt Spur decision catalogs"). This adds a decision point to the executor loop. Scenarios are task-specific, so `ac_altitude: task-local`.
- **Q: Does the P1 evidence bar apply?** A: only to turning the flag on by default. Shipping off-by-default routes nothing. Record the replay evidence (`spur decision run executor-failure-class --evidence <tail>` over real unmatched tails) in this Q&A before anyone proposes default-on.
- **Q: `transient` label, as the first draft had?** A: dropped. No `ObjectiveEscalationSignal` means "retry the same executor", and adding one is a routing-policy change outside this task.
- **Q: Auto-suggest a new `FAILURE_RULES` entry after N recurrences (first draft R5)?** A: dropped as code. The ledger already holds every accepted rescue. R6 documents the query; promoting a rule stays a human edit with tests.
- **Q: Why a function seam on the context instead of passing `DecisionService` in?** A: `AgentServiceContext` carries no `SpurConfig`, and the executor should not know about catalogs. One optional function keeps tests hermetic (AC1–AC3 use a double) and leaves the composition root as the only place that reads the flag.
- **Q: Sampled makers?** A: they accept only on unanimity (ts-libs `docs/design/llm-agent-decision-backend.md` § Confidence granularity), so a 0.85 floor does not grade them. Recommend a probability-native maker via `decisions.makers`.

#### Q&A entry — 2026-10-19T20:40:33.483Z

- **Q: Feature?** A: P1 ("workflow decision points adopt Spur decision catalogs"). This adds a decision point to the executor loop. Scenarios are task-specific, so `ac_altitude: task-local`.
- **Q: Does the P1 evidence bar apply?** A (operator-confirmed 2026-10-19; binding): ship off by default; this task never flips the default. Shipping off-by-default routes nothing, so no evidence bar gates this task. Record the replay evidence (`spur decision run executor-failure-class --evidence <tail>` over real unmatched tails) in this Q&A before anyone proposes default-on.
- **Q: `transient` label, as the first draft had?** A: dropped. No `ObjectiveEscalationSignal` means "retry the same executor", and adding one is a routing-policy change outside this task.
- **Q: Auto-suggest a new `FAILURE_RULES` entry after N recurrences (first draft R5)?** A: dropped as code. The ledger already holds every accepted rescue. R6 documents the query; promoting a rule stays a human edit with tests.
- **Q: Why a function seam on the context instead of passing `DecisionService` in?** A: `AgentServiceContext` carries no `SpurConfig`, and the executor should not know about catalogs. One optional function keeps tests hermetic (AC1–AC3 use a double) and leaves the composition root as the only place that reads the flag.
- **Q: Sampled makers?** A: they accept only on unanimity (ts-libs `docs/design/llm-agent-decision-backend.md` § Confidence granularity), so a 0.85 floor does not grade them. Recommend a probability-native maker via `decisions.makers`.

### Design

**Frozen names**

| Item | Name |
|---|---|
| Catalog file | `config/decisions/executor.yaml` |
| Decision id | `executor-failure-class` |
| Labels / fallback | `resource-exhaustion`, `auth`, `task-defect` / `task-defect` |
| Config flag | `workflows.executorFailureDecisionMaker` (optional boolean) |
| Context seam | `AgentServiceContext.classifyUnmatchedFailure` |
| Caller | `'executor'` |

**Placement in the loop** (`agent-run-executor.ts:671-676`):

```ts
const classifiedSignal = classifyObjectiveFailure(result);
let escalationSignal = quotaConfirmed ? ('resource-exhaustion' as const) : classifiedSignal;
if (escalationSignal === undefined && result.signal === undefined && this.ctx.classifyUnmatchedFailure !== undefined) {
    const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
    if (text.trim() !== '' && permissionFailureEvidence(text) === undefined) {
        escalationSignal = await this.ctx.classifyUnmatchedFailure(text, { runId: lifecycle.identity.runId })
            .catch(() => undefined);
    }
}
```

Redaction happens inside the wired function in `context.ts`, where `env` is available, before
`decide`: redact the full text, then keep the last 4096 characters (R2). Never tail before
redacting. The executor passes raw text only to the injected function and never to a network
client.

**Fail-safe direction.** A false `task-defect` equals today's behaviour. A false
`resource-exhaustion` costs one failover attempt, bounded by the 1260 attempted set. Hence the 0.85
floor and the `task-defect` fallback.

**Anti-patterns**
- Do not call the rescue for timeouts, permission denials, or rule matches.
- Do not import `DecisionService` or ts-ai-decision into `agent-run-executor.ts`.
- Do not add a retry signal, change tier or binary policy, or touch verification-failure handling.
- Do not log or emit unredacted output.
- Do not make network calls in tests; use a double for the seam (AC1–AC4) and a maker double (AC5).

### Plan

1. Collect 5–10 real unmatched failure tails from `.spur/run/*.log` (those whose run ended non-zero with no `agent.invoke.escalated` event). Keep them redacted as fixtures; they inform the R1 criteria text.
2. Failing tests for AC1–AC3 next to the existing escalation tests for `agent-run-executor` in `packages/app/tests/` (find them with `rg -l "resource-exhaustion" packages/app/tests`), using a seam double.
3. R4/R5: add the context field, the caller value, the config flag, and the loop hook.
4. R1: add the catalog; confirm `spur decision list` shows `executor-failure-class`, and add it to any shipped-catalog inventory test that enumerates decisions.
5. AC4/AC5: CLI-context test with the flag off and on, a maker double, and a secret in env.
6. R6 docs; AC6.
7. `bun run spur-check` and `bun run build`; `git status` shows only this task's files.

### Root Cause

Missing capability, not a defect. `classifyDispatch` returns `undefined` for every failure no
`FAILURE_RULES` entry matches (`packages/app/src/services/failure-classification.ts:155-161`).
The executor loop treats `undefined` as terminal (`packages/app/src/services/agent-run-executor.ts:672-676`).
No second classifier exists, so recall equals the regex table's coverage.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Task 1260 (executor failover on quota/auth): this task reuses its escalation path unchanged.
- Task 1262: `laya-local` bundling (R1), a local maker for on-box evidence.
- Code: `packages/app/src/services/failure-classification.ts:5-17,25,132-162`; `packages/app/src/services/agent-run-executor.ts:664-720`; `packages/app/src/services/agent-routing-attribution.ts:20`; `packages/app/src/services/agent-service.ts:249`; `apps/cli/src/context.ts:155-185`; `packages/app/src/decision/decision-service.ts:122-131,413,701-714`; `packages/app/src/decision/decision-events.ts:31-46`; `packages/app/src/observability/agent-execution.ts:342-360`; `packages/config/src/index.ts:821-823`; `packages/domain/src/stage-registry/schema.ts:375-385`.
- ts-libs `docs/design/llm-agent-decision-backend.md` § Confidence granularity.

### History
