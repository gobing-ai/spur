---
schema_version: 1
name: Executor-failure rescue classifier for unmatched dispatch failures
status: done
template: issue
created_at: 2026-10-19T18:27:34.608Z
updated_at: "2026-10-20T02:45:59.071Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
dependencies: ["1260", "1262"]
feature_id: P1
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1264-verdict.json
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

- [x] R1. **Catalog decision.** New shipped catalog `config/decisions/executor.yaml` with decision `executor-failure-class`: `type: choice`, labels `resource-exhaustion`, `auth`, `task-defect`; `fallback: task-defect`; `minConfidence: 0.85`; `instructions` embedding `${params.instructions}` with observable criteria per label. There is no `transient` label; the escalation enum has no retry signal (`packages/domain/src/stage-registry/schema.ts:375-382`).
- [x] R2. **Rescue only the residue.** Consult the decision only when all of these hold: the dispatch exited non-zero without a signal (no timeout); `classifyDispatch` returned `undefined`; `permissionFailureEvidence(text)` is `undefined` (a permission denial stays terminal, 0687 R9); `quotaConfirmed` is false; the stderr+stdout text is non-blank; and the rescue seam is wired (R4). Evidence is `redactAndBound(text, configuredSecretValues(env), Number.MAX_SAFE_INTEGER).slice(-4096)` over `text = stderr + "\n" + stdout` (`packages/app/src/observability/agent-execution.ts:342,352`): redact the **full** text first, then take the tail. `redactAndBound` keeps the head (`slice(0, maxChars)`), and slicing before redacting can cut a secret at the boundary and leak its unmatched fragment.
- [x] R3. **Mapping.** Accepted `resource-exhaustion` or `auth` becomes `escalationSignal` and enters the existing 1260 path unchanged (fallback matching, attempted-set exclusion, chain-exhausted diagnostic). `task-defect`, any fallback, low confidence, or a thrown error → `undefined` (today's behaviour). A rescue failure never fails the run differently than it would have without the rescue.
- [x] R4. **Opt-in seam.** `AgentServiceContext` (`packages/app/src/services/agent-service.ts:249`) gains optional `classifyUnmatchedFailure?: (evidence: string, correlation: DecisionCorrelation) => Promise<'resource-exhaustion' | 'auth' | undefined>`. `apps/cli/src/context.ts:168` wires it only when `spurConfig.workflows.executorFailureDecisionMaker === true`. The new optional boolean sits beside `decideDecisionMaker` at `packages/config/src/index.ts:823` and defaults to absent/false. The wired function calls `getDecisionService(spurConfig, cwd).decide('executor-failure-class', { instructions: evidence }, { bus, context: { caller: 'executor', correlation }, decisionLog })`.
- [x] R5. **Ledger attribution.** Add `'executor'` to `DecisionCaller` (`packages/app/src/decision/decision-events.ts:32`), so every rescue appears in `decision.*` events and `decision_logs` with `caller: executor` and the run id. Then `spur decision status --reliability` reports it with no extra work.
- [x] R6. **Docs.** `plugins/sp/skills/spur-cli/references/decision.md` documents the flag, the off-box evidence caveat for hosted makers, the recommended maker (probability-native; `laya-local` keeps evidence on-box once 1262 R1 lands), and a `decision_logs` query that lists accepted rescues so a maintainer can promote recurring text to a `FAILURE_RULES` entry.

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

| File:line | Change |
|---|---|
| `config/decisions/executor.yaml` | New shipped catalog: `executor-failure-class` (choice; `resource-exhaustion` / `auth` / `task-defect`; fallback `task-defect`; `minConfidence: 0.85`) with an `instructions` template embedding `${params.instructions}` and observable criteria per label. No `transient` label — the escalation enum has no retry signal. |
| `packages/app/src/services/agent-run-executor.ts:672-690` | The rescue hook sits exactly where the loop used to `break`: after `classifyObjectiveFailure` and the quota confirmation, and only when there is no timeout signal, the seam is wired, the output is non-blank and `permissionFailureEvidence` is undefined. The promise is `.catch(() => undefined)`, so a rescue can never change how a run fails. |
| `packages/app/src/services/agent-service.ts:249` | `AgentServiceContext.classifyUnmatchedFailure?(evidence, correlation)` — one optional function; the executor never learns about catalogs or ts-ai-decision. |
| `packages/app/src/services/failure-classification.ts:142` | `rescueEvidenceTail(text, secrets, maxChars = 4096)`: redact the **full** text, then keep the last 4096 characters. Tailing first would slice a secret at the boundary and hand the maker its fragment. |
| `apps/cli/src/context.ts:200-250` | The composition root wires the seam only when `spurConfig.workflows.executorFailureDecisionMaker === true`, then calls `getDecisionService(...).decide('executor-failure-class', { instructions: tail }, { bus, context: { caller: 'executor', correlation }, decisionLog })`. Absent config → the empty object, so the default service context is byte-identical to before. |
| `packages/config/src/index.ts:829` | `workflows.executorFailureDecisionMaker?: boolean` beside `decideDecisionMaker`, absent/false by default. |
| `packages/app/src/decision/decision-events.ts:33` | `DecisionCaller` gains `'executor'`, so rescues carry `caller: executor` and the run id in `decision.*` events and `decision_logs` (and appear in `spur decision status --reliability` for free). Exported through `packages/app/src/index.ts`. |
| Tests | `packages/app/tests/services/agent-service.test.ts` (AC1 rule match never calls the seam; AC2 an unmatched "credits depleted" fails over under the 1260 exclusion rules; AC3 decline/throw/permission-denial keep today's behaviour; AC4 no seam → no rescue), `packages/app/tests/services/failure-classification.test.ts` (AC5 redact-then-tail: a secret straddling the 4096 boundary is `[REDACTED]`, never sliced), `packages/app/tests/decision/decision-service.test.ts` (AC5 caller `executor` + `runId` on the event and the `decision_logs` row), `packages/app/tests/decision/confidence-level.test.ts` (the shipped-bar invariant restated for a 0.85 floor), `apps/cli/tests/commands/decision.test.ts` (shared catalog count 5 → 6). |
| Docs | `plugins/sp/skills/spur-cli/references/decision.md` § "Executor failure rescue" (off-by-default flag, residue-only rules, redact-then-tail, the hosted-maker evidence caveat, the probability-native maker recommendation, and the `decision_logs` promotion query), `docs/design/decision-observability-and-adoption.md` §4 (audit row for the executor decision point, marked opt-in). |

**Design notes, recorded.** The flag stays off in every shipped config; this task never flips it, so
no P1 evidence bar applies (operator-confirmed in Q&A). The `confidence-level` invariant test was
restated rather than loosened: a served bar is an acceptance floor, so a bar below the HIGH cut
would let an accepted answer read MEDIUM/LOW — the new assertion is that every real bar is at or
above the HIGH threshold and that `executor-failure-class` is the strictest at 0.85, which is the
fail-safe direction this decision needs.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/decisions/executor.yaml:20-52` declares `executor-failure-class`: choice of `resource-exhaustion`/`auth`/`task-defect`, `fallback: task-defect`, `minConfidence: 0.85` at `:17`, instructions embedding `${params.instructions}` with observable criteria, no `transient` label. Fix pass: the `wbs` param had no default, which made it required, and the seam cannot supply it, so every rescue was rejected. It is optional now via `default: ""` at `config/decisions/executor.yaml:41`. Upstream rule: a param is optional exactly when it has a `default` (`node_modules/.bun/@gobing-ai+ts-ai-decision@0.5.32+b2d869f83d0e4e20/node_modules/@gobing-ai/ts-ai-decision/dist/params.js:56`). |
| R2 | MET | `packages/app/src/services/agent-run-executor.ts:672-690` consults the rescue only when the rule signal is undefined, quota is unconfirmed, there is no timeout signal, the seam is wired, text is non-blank and there is no permission evidence; `packages/app/src/services/failure-classification.ts:149-150` (`rescueEvidenceTail`) redacts the full text first, then tails 4096; tests `packages/app/tests/services/agent-service.test.ts:5255`, `:5301` and `packages/app/tests/services/failure-classification.test.ts:144` |
| R3 | MET | `packages/app/src/services/agent-run-executor.ts:686-688` turns an accepted label into `escalationSignal` on the 1260 path; a throw resolves to `undefined`; `apps/cli/src/context.ts:249-251` returns undefined for a non-accepted or `task-defect` answer; tests `packages/app/tests/services/agent-service.test.ts:5277` (failover) and `:5301` (unchanged) |
| R4 | MET | `packages/app/src/services/agent-service.ts:265` adds the optional `classifyUnmatchedFailure`; `packages/config/src/index.ts:829` adds the optional `executorFailureDecisionMaker`; `apps/cli/src/context.ts:222-229` wires the seam only under the flag and, after the fix pass, forwards the run's ledger-attached `events` bus as `bus` (`apps/cli/src/context.ts:192-200`, `:243`), as R4's `{ bus, context, decisionLog }` call requires; tests `apps/cli/tests/context.test.ts:110`, `packages/app/tests/services/agent-service.test.ts:5336` |
| R5 | MET | `packages/app/src/decision/decision-events.ts:36` adds `executor` to `DecisionCaller`; `packages/app/tests/decision/decision-service.test.ts:439` checks the event + `decision_logs` attribution at the service seam. Fix pass: the CLI seam previously passed no bus, so a rescue wrote `decision_logs` but no `decision.*` events (invisible to `--reliability` and the 1263 outcome verb). `apps/cli/tests/context.test.ts:138` now proves that the wired seam emits `decision.end` with `caller: executor` + run id and no rejection; it fails without the fix (verified via stash). |
| R6 | MET | `plugins/sp/skills/spur-cli/references/decision.md:139` adds the "Executor failure rescue" section: flag at `:148`, redact-then-tail at `:157`, `laya-local` on-box recommendation at `:165`, `decision_logs` promotion query at `:174`; `docs/design/decision-observability-and-adoption.md:309` adds the audit row |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — rule matches never consult the model (req: R2) | MET | test | `packages/app/tests/services/agent-service.test.ts:5255`: a FAILURE_RULES message escalates `resource-exhaustion` and the recording double's call count stays 0. Run this session within 371 pass |
| AC2 — an unmatched exhaustion message fails over when accepted (req: R1, R3) | MET | test | `packages/app/tests/services/agent-service.test.ts:5277`: "credits depleted" plus a double answering `resource-exhaustion` dispatches the next eligible executor under 1260 exclusion. Run this session within 371 pass |
| AC3 — uncertainty, errors and permission denials keep today's behaviour (req: R2, R3) | MET | test | `packages/app/tests/services/agent-service.test.ts:5301`: decline and throw each end with one dispatch and no failover, and the permission denial never calls the double. Run this session within 371 pass |
| AC4 — disabled by default (req: R4) | MET | test | `apps/cli/tests/context.test.ts:110` (absent or false flag → `{}`) and `packages/app/tests/services/agent-service.test.ts:5336` (no seam → no rescue attempt). Run this session: 8 pass (context) |
| AC5 — the wired rescue is redacted and attributed (req: R1, R2, R5) | MET | test | `packages/app/tests/services/failure-classification.test.ts:144` (a secret straddling the 4096 boundary is redacted, never sliced); `packages/app/tests/decision/decision-service.test.ts:439` (`caller: executor` + runId on the event and the row); `apps/cli/tests/context.test.ts:124` (the wired seam never re-raises the secret) and the fix-pass `:138` (the wired seam's `decision.end` carries `caller: executor` + run id on the run bus) |
| AC6 — the operator guide exists (req: R6) | MET | test | `plugins/sp/tests/help-docs-parity.test.ts` + `apps/cli/tests/help-doc-parity.test.ts` (run this session, pass); prose re-read this session at `plugins/sp/skills/spur-cli/references/decision.md:139-174` (flag, off-box caveat, maker recommendation, promotion query) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed the diff against R1–R6 plus the three edges this change creates: what the rescue may see,
what it may send off-box, and what happens when it declines.

| Priority | Location | Finding | Disposition |
|---|---|---|---|
| P3 | `apps/cli/src/context.ts:216` | The new CLI seam was uncovered — the gate's coverage floor flagged it (`funcs 87.5% / lines 75%`), and an untested wiring closure is where a flag inversion or a redaction reorder hides. | FIXED — `executorRescue` is exported and `apps/cli/tests/context.test.ts` covers the off flag (no seam, AC4) and the wired path (redact → decide → decline on an offline maker, AC5) |
| P3 | `packages/app/tests/decision/confidence-level.test.ts:88` | The shipped-bar invariant claimed every catalog bar is "at or below the HIGH threshold". A served bar is an acceptance floor, so a bar *above* the threshold is the safe direction (accepted answers are then always HIGH) — the old wording would have blocked the 0.85 rescue floor for the wrong reason. | FIXED — the invariant now reads "every non-zero bar is at least the HIGH threshold, and the rescue is the strictest at 0.85", which is the property that actually protects the display |
| P4 | `packages/app/src/services/agent-run-executor.ts:686` | The rescue is guarded twice: `.catch(() => undefined)` at the loop and a `try/catch` that logs inside the wired seam. Redundant on purpose (the seam is injectable, so the loop cannot assume its shape), but it means a silent decline is only visible through the operator log line. | ACCEPTED |

Correctness notes checked, no finding raised: the rescue is unreachable for a rule match, a timeout
(`result.signal` set), a permission denial (0687 R9) or a confirmed quota event, so the 0407
precision bias is intact and AC1/AC3 pin it; `rescueEvidenceTail` redacts the whole text before the
4096 cut, and the boundary case is tested with a secret straddling it; `undefined` from a decline, a
throw, or a `task-defect` answer leaves `escalationSignal` undefined, which is bit-for-bit the
pre-1264 route; the flag defaults absent and `executorRescue` returns an empty context object, so
the shipped CLI behaves exactly as before; the caller attribution (`executor` + run id) rides the
existing event/log path, so the reliability report needs no change.

Residual risk: the decision ships off and this task does not flip it; nothing in this batch
exercised a *real* accepted rescue against a live maker (the tests use doubles, and the offline
`typesafe` maker declines). The replay evidence the Q&A requires before default-on therefore does
not exist yet — that is the intended state, and the operator guide documents the promotion query
that would collect it.

Verdict: PASS
Confidence: MEDIUM

### References

- Task 1260 (executor failover on quota/auth): this task reuses its escalation path unchanged.
- Task 1262: `laya-local` bundling (R1), a local maker for on-box evidence.
- Code: `packages/app/src/services/failure-classification.ts:5-17,25,132-162`; `packages/app/src/services/agent-run-executor.ts:664-720`; `packages/app/src/services/agent-routing-attribution.ts:20`; `packages/app/src/services/agent-service.ts:249`; `apps/cli/src/context.ts:155-185`; `packages/app/src/decision/decision-service.ts:122-131,413,701-714`; `packages/app/src/decision/decision-events.ts:31-46`; `packages/app/src/observability/agent-execution.ts:342-360`; `packages/config/src/index.ts:821-823`; `packages/domain/src/stage-registry/schema.ts:375-385`.
- ts-libs `docs/design/llm-agent-decision-backend.md` § Confidence granularity.

### History

- 2026-10-20T01:09:00.105Z todo → wip (system)
- 2026-10-20T01:20:51.735Z wip → testing (system)
- 2026-10-20T01:20:55.368Z testing → done (system)

