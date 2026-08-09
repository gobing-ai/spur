---
template: issue
schema_version: 1
name: "Agent executor exhaustion failover: classifier coverage, implementAgent injection, failover semantics"
description: ""
status: todo
type: issue
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-09T02:53:14.788Z"
updated_at: "2026-08-09T02:55:01.958Z"
---

## 0485. Agent executor exhaustion failover: classifier coverage, implementAgent injection, failover semantics

### Background
Incident (2026-08-08): the feature N/H1 batch, driven from pi and omp host sessions, choked
mid-pipeline when the executor account hit its 5-hour usage limit. 0482 already shipped the
pinned-executor escalation fix; this task covers the gaps the follow-up source-level verification
found in why the tier-fallback ladder still never fired, and in how `agent.default` actually
reaches pipeline hops.

Verified findings (each has file:line evidence):

1. **Classifier vocabulary misses real exhaustion signatures.** `classifyObjectiveFailure`
   (`packages/app/src/services/agent-service.ts:1402`) matches only
   `rate[\s-]?limit|429|too many requests|quota|token limit|token budget|context length|maximum
   context|context window`. Measured against 12 realistic provider strings, 8 MISS:
   `Claude usage limit reached`, `5-hour limit reached; resets at 14:00`,
   `error: rate_limit_exceeded` (underscore defeats `\b` + `[\s-]?`),
   `{"error":{"type":"rate_limit_error"...}}`, `out of tokens`, `Insufficient credits`,
   `API Error: 529 Overloaded`, `usage limit exceeded`. No signal → no escalation → result stands.

2. **`agent.default` injection misses the implement hop.** `resolveDefaultAgentVar`
   (`packages/app/src/services/workflow-service.ts:1060`) injects only `vars.agent`, never
   `implementAgent`; `config/workflows/task-pipeline.yaml:65` pins `implementAgent: "omp"`, so the
   heaviest hop ignores `agent.default` entirely. DB evidence (`action_runs`): implement hops ran
   `agent:"omp", source:"explicit"` while doc-sync hops ran the injected `omp-zai-volc`.

3. **The escalation chain breaks instead of skipping.** All `implement` fallbacks target
   `capable-1` (`packages/domain/src/stage-registry/schema.ts:776-780`). After one hop,
   `getNextFallback` requires a strictly higher tier, falls back to the same `capable-1` entry,
   re-resolution picks the same executor, and `attemptedExecutors.has(...)` at
   `agent-service.ts:766` **breaks** the loop. Same-tier alternatives are never tried; capable-2/3
   executors are unreachable from an exhaustion signal.

4. **Exhaustion is answered with quality escalation, not availability failover.** A
   `resource-exhaustion` signal means *this account/binary is dead right now*; the policy answers
   by moving up-tier. 9 of 13 configured executors share the `omp` binary, so an omp-account
   exhaustion escalates to `omp-deepseek` — same binary, same dead account.

5. **Zero-length ladders.** `verify` and `dogfood` declare `fallback: []` (`schema.ts:822,885`) —
   `maxEscalations` is 0 there. `/sp:dev-fixall` has no registry alias, so test-fix hops resolve
   no stage and no ladder either.

6. **Unknown `agent.default` fails hard.** When `agent.default` names a commented-out executor
   (observed: `omp-zai-volc`), dispatch fails with `Unknown agent: 'omp-zai-volc'` instead of
   warning and falling through to the YAML literal. `resolveDefaultAgentVar` is best-effort about
   *reading* config but never validates the name it injects.

7. **Failed `agent.run` records carry no output.** `action_runs.result_json` holds exitCode +
   invocation only; stdout/stderr are dropped, so exhaustion post-mortems cannot confirm what the
   provider actually emitted.
### Requirements
- [ ] R1. **Widen the exhaustion classifier vocabulary** — `classifyObjectiveFailure`
  (`packages/app/src/services/agent-service.ts:1402`) must classify every realistic provider
  exhaustion signature as `resource-exhaustion`: `usage limit`, `limit will reset`,
  `rate_limit_exceeded` / `rate_limit_error` (underscore forms), `out of tokens`,
  `insufficient credits|balance|quota|funds`, `529` / `overloaded` — while keeping the existing
  matches and producing no false positives on ordinary stderr noise.
- [ ] R2. **Inject `implementAgent` alongside `agent`, and validate the default** —
  `resolveDefaultAgentVar` (`packages/app/src/services/workflow-service.ts:1060`) must inject
  `implementAgent` with the same value whenever the caller did not set it, so `agent.default`
  governs the implement hop; and when `agent.default` names neither a configured executor nor a
  canonical agent binary, warn once and inject nothing (YAML literal wins) instead of failing at
  dispatch.
- [ ] R3. **Skip attempted executors instead of breaking the chain** — the re-resolution at
  `agent-service.ts:762` must exclude executors already attempted this run, so the ladder walks
  to the next eligible candidate instead of stopping at `attemptedExecutors.has(...)`.
- [ ] R4. **Fail over sideways before escalating up-tier on exhaustion** — when the signal is
  `resource-exhaustion`, `resolveStageModelPolicy` (`agent-service.ts:951`) must first try
  same-tier candidates whose `agent` binary differs from the failed executor's; only when none is
  usable does it proceed to the fallback tier.
- [ ] R5. **Give verify/dogfood a ladder and dev-fixall a stage** — `verify` and `dogfood` in
  `packages/domain/src/stage-registry/schema.ts` get a `resource-exhaustion`/`gate-fail` fallback
  to `capable-2`; the `test` stage gains the `dev-fixall` alias so test-fix hops resolve a stage.
- [ ] R6. **Persist output tails on failed agent.run records** — the failure record written by
  the `agent.run` workflow action (`packages/app/src/workflow/actions/agent-run.ts`) must include
  the last ≤4 KB of stdout and stderr so post-mortems can confirm what the provider emitted.
### Acceptance Criteria
- [ ] AC1 (R1): A parametrized unit test in `packages/app/tests/services/agent-service.test.ts`
  feeds the 12 positive strings from Design §R1 through `classifyObjectiveFailure` (via a mock
  runner returning each as stderr with a non-zero exit) and each yields a `resource-exhaustion`
  escalation; the 4 negative strings yield no escalation.
- [ ] AC2 (R2): A workflow-service test sets `agent.default` to a configured executor, passes no
  caller vars, and asserts the run receives both `vars.agent` and `vars.implementAgent` equal to
  that executor. A second case with caller-supplied `vars.agent` but no `implementAgent` asserts
  only `implementAgent` is injected.
- [ ] AC3 (R2): With `agent.default` set to a non-existent executor name, the run starts with the
  pipeline YAML literal for both vars and exactly one warning naming the dropped value — no
  dispatch failure.
- [ ] AC4 (R3+R4): With two same-tier executors on different `agent` binaries plus one
  higher-tier executor configured: exhaustion on the first dispatch re-dispatches on the
  same-tier different-binary executor, and the attempted executor is never re-dispatched within
  the run. Asserted via mock-runner call sequence + the `Escalating:`/failover stderr lines.
- [ ] AC5 (R5): Registry unit test: `verify` and `dogfood` have non-empty `fallback` including a
  `resource-exhaustion` trigger; `getCanonicalStage('dev-fixall')` returns the `test` stage.
- [ ] AC6 (R6): A failed `agent.run` action test asserts the persisted failure record contains
  `stderrTail`/`stdoutTail`, each capped at 4096 chars.
- [ ] AC7: `bun test packages/app/tests/services/agent-service.test.ts` and
  `bun test packages/app/tests/services/workflow-service.test.ts` green; targeted-then-full gate:
  `bun run spur-check` green.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
#### R1 — classifier regex (frozen)

Replace the alternation at `packages/app/src/services/agent-service.ts:1403` with:

```ts
/\b(rate[\s_-]?limit|429|529|too many requests|quota|usage[\s_-]?limit|limit will reset|out of tokens?|insufficient[\s_-]?(credits?|balance|quota|funds)|token[\s_-]?(limit|budget)|context[\s_-]?(length|window)|maximum context|overloaded)\b/
```

Notes: `quota` (bare) is retained from the current regex — `insufficient_quota` and
`AccountQuotaExceeded` already match through it. The `\b` wrapper and lowercase pre-processing
stay as-is. Precision bias is preserved: no bare `limit`, `token`, or `error` terms.

Test matrix (all must classify `resource-exhaustion`): the 8 strings quoted in Background §1 plus
the 4 currently-matching ones (`rate limit exceeded (429)`, `exceeded your current quota`,
`HTTP 429 Too Many Requests`, `request exceeds the maximum context length`).
Negative matrix (must return `undefined`): `rate of failure is high`, `token bucket refilled`,
`no issues found`, `Limited concurrency set to 4`.

#### R2 — injection + validation (frozen contract)

In `resolveDefaultAgentVar` (`packages/app/src/services/workflow-service.ts:1060`):

- Build the return as `{ agent?, implementAgent? }`: set each key to `agent.default` only when the
  caller's `opts.vars` does not already define that key (independent per key).
- Validate `agent.default` before injecting: accept iff it matches an `agent.executors[].name`
  from the same config **or** resolves via `resolveAgentName` (canonical binary). On mismatch,
  emit one warning line through the workflow service's output channel (add a narrow param or move
  the helper to a method — implementer's choice, no new public API) and return `{}`, leaving the
  YAML literal in force. Config-read failure keeps the current silent-`{}` behavior.

#### R3 — attempted-set exclusion (frozen seam)

`executeRun` already holds `attemptedExecutors: Set<string>`. Thread it into re-resolution as an
optional `exclude?: ReadonlySet<string>` parameter: `resolveAgent` → `resolvePinned` /
`resolveAgentAuto` → `resolveStageModelPolicy`. In the `eligible` loop, skip executors whose
`name` is in `exclude`. When exclusion empties the candidate list, `resolveStageModelPolicy`
returns `undefined`, which already produces the "chain exhausted" report at
`agent-service.ts:769-774`. No new result type; optional param only.

#### R4 — sideways failover (frozen rule)

In `resolveStageModelPolicy`, when `signal === 'resource-exhaustion'` and `fromExecutor` resolves
to a configured executor: before applying the fallback tier, build a sideways list = executors at
the failed executor's tier whose `agent` binary differs from the failed one's, filtered by R3's
exclusion set, ordered by array position (the documented tie-break). Try each with `checkUsable`;
first usable wins. Only when the sideways list is empty or none usable, proceed with the existing
fallback-tier path. Up-tier escalation for `gate-fail`/`timeout` is unchanged.

#### R5 — registry data (frozen literals)

`packages/domain/src/stage-registry/schema.ts`:

- `verify` (~line 821) and `dogfood` (~line 885): `fallback: [{ tier: 'capable-2', trigger:
  'resource-exhaustion' }, { tier: 'capable-2', trigger: 'gate-fail' }]`.
- `test` (~line 789): `aliases: ['dev-unit', 'dev-fixall']`.

#### R6 — failure-record tails (frozen shape)

In the `agent.run` workflow action's failure branch
(`packages/app/src/workflow/actions/agent-run.ts`), extend the failure payload with
`stderrTail` and `stdoutTail`: last 4096 characters of each stream, omitted when empty. No
redaction change — the lifecycle observer's existing secret-value redaction already covers
dispatched output; tails reuse the same captured strings.

#### Anti-patterns / out of scope

- No new config knobs, no retry/backoff machinery, no new dependencies.
- No `ModelHealthProbe` (quota pre-probing) integration — separate concern, not this task.
- No batch-level exhaustion persistence across workflow runs (the in-memory exclusion covers one
  run's escalation chain; cross-run cooldown is out of scope).
- Do not touch `default-by-phase` (removed 0452) or reintroduce phase maps.
- Do not change `checkUsable` semantics.
### Plan
- [ ] Replace the classifier regex and add the parametrized positive/negative test matrix (R1)
- [ ] Inject `implementAgent` and validate `agent.default` in `resolveDefaultAgentVar` (R2)
- [ ] Thread the attempted-executor exclusion set through re-resolution (R3)
- [ ] Add sideways same-tier/different-binary failover for `resource-exhaustion` (R4)
- [ ] Add verify/dogfood fallback chains and the `dev-fixall` alias to the stage registry (R5)
- [ ] Persist `stderrTail`/`stdoutTail` (≤4 KB) in failed agent.run records (R6)
- [ ] Run targeted suites to green, then `bun run spur-check` (R1–R6)
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- `packages/app/src/services/agent-service.ts:1396` — `classifyObjectiveFailure` (R1)
- `packages/app/src/services/agent-service.ts:586,624-788` — escalation loop, `maxEscalations`,
  `attemptedExecutors` break at :766 (R3, R4)
- `packages/app/src/services/agent-service.ts:951-1018` — `resolveStageModelPolicy` (R3, R4)
- `packages/app/src/services/workflow-service.ts:1051-1070` — `resolveDefaultAgentVar` (R2)
- `packages/domain/src/stage-registry/schema.ts:789,821,885` — test/verify/dogfood stage
  records (R5); `getNextFallback` at :431
- `packages/app/src/workflow/actions/agent-run.ts` — failure-record write (R6)
- `config/workflows/task-pipeline.yaml:59,65` — `agent` / `implementAgent` vars
- Incident verification conversation: 2026-08-08 session (classifier miss-matrix measured, DB
  evidence from `action_runs`)
- Prior art: 0407 (escalation mechanism), 0482 R1 (pinned-executor ladder), ADR-033 (tier
  routing), ADR-047 (inline/default surfaces)
### History
