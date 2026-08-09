---
template: issue
schema_version: 1
name: "Agent executor exhaustion failover: classifier coverage, implementAgent injection, failover semantics"
description: ""
status: done
type: issue
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-09T02:53:14.788Z"
updated_at: "2026-08-09T06:31:09.658Z"
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
- [x] R1. **Widen the exhaustion classifier vocabulary** — `classifyObjectiveFailure`
  (`packages/app/src/services/agent-service.ts:1459`) classifies the frozen positive matrix as
  `resource-exhaustion` while rejecting the ordinary-noise negative matrix.
- [x] R2. **Inject `implementAgent` alongside `agent`, and validate the default** —
  `resolveDefaultAgentVar` (`packages/app/src/services/workflow-service.ts:1081`) independently
  injects missing variables and warns once without injection when `agent.default` is stale.
- [x] R3. **Exclude attempted executors from re-resolution** — the escalation re-resolution at
  `packages/app/src/services/agent-service.ts:765` receives the run-scoped attempted set, so an
  executor is never dispatched twice within one escalation chain.
- [x] R4. **Fail over sideways before escalating up-tier on exhaustion** —
  `resolveStageModelPolicy` (`packages/app/src/services/agent-service.ts:957`) tries an eligible
  same-tier executor on a different agent binary before applying the fallback tier.
- [x] R5. **Give verify/dogfood a ladder and dev-fixall a stage** — the canonical registry provides
  `resource-exhaustion` and `gate-fail` fallbacks for verify/dogfood, and resolves `dev-fixall` to
  the test stage (`packages/domain/src/stage-registry/schema.ts:788`).
- [x] R6. **Persist safe output tails on failed agent.run records** — failed actions persist the
  last stdout/stderr tails with the complete stored string bounded to 4096 characters, omitting
  empty streams and redacting configured secrets before `result_json` persistence
  (`packages/app/src/workflow/actions/agent-run.ts:455`).
### Acceptance Criteria
- [x] AC1 (R1): The parametrized agent-service matrix executes 12 positive provider signatures and
  4 negative noise strings; positives escalate as `resource-exhaustion`, negatives do not.
- [x] AC2 (R2): Workflow-service tests prove a configured `agent.default` injects both variables,
  while a caller-supplied `agent` is preserved and only missing `implementAgent` is injected.
- [x] AC3 (R2): A stale `agent.default` leaves both YAML literals in force and emits exactly one
  warning naming the dropped value, without a dispatch failure.
- [x] AC4 (R3+R4): The mock runner proves ordered `pi → claude → codex` dispatch: same-tier,
  different-binary failover precedes up-tier fallback and no attempted executor repeats.
- [x] AC5 (R5): Registry tests prove verify/dogfood exhaustion fallbacks and the `dev-fixall` alias.
- [x] AC6 (R6): Action and persistence tests prove failed stdout/stderr tails are present, redacted,
  retain their ending, and each complete stored value is at most 4096 characters.
- [x] AC7: Targeted task suites and the repository-wide gate are green: `bun run spur-check`
  completes with 4766 tests passed, 0 failed, plus clean pre-rule, coverage, TSDoc, and corpus gates.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
#### R1 — classifier precision

Match the frozen provider-exhaustion vocabulary after lowercase normalization: rate-limit forms
(including underscores), 429/529, quota/usage reset language, out-of-token and insufficient-credit
forms, context limits, and overload. Retain word boundaries and reject bare generic terms.

#### R2 — independent default injection and observable fallback

Load `agent.default` once. Accept configured executor names or canonical agent binaries. On a stale
value, inject nothing, retain one warning in the serializable run result, and emit that warning once
through a best-effort composition-root sink (CLI stderr or server logger). A failing warning sink
must not change workflow semantics. Otherwise inject `agent` and `implementAgent` independently only
when the caller omitted that key; caller intent always wins.

#### R3/R4 — availability-first escalation

Thread the run-scoped attempted-executor set through re-resolution and filter candidates before
selection. For `resource-exhaustion`, treat every underlying agent binary represented by an
attempted executor as exhausted for the remainder of the run. Try a same-tier candidate on a
not-yet-exhausted binary before applying the fallback tier, and keep exhausted binaries excluded
from fallback-tier selection as well. The attempted set makes the availability walk finite and
preserves an honest chain-exhausted diagnostic. Other escalation signals retain their explicit
fallback-count semantics.

#### R5 — registry data

Verify and dogfood carry `capable-2` fallbacks for `resource-exhaustion` and `gate-fail`. The test
stage owns the `dev-fixall` alias. No parallel registry or new policy type is introduced.

#### R6 — safe persisted failure output

`AgentRunActionRunner` receives configured secret values from CLI/server composition roots via
`WorkflowAppServiceContext`. Before failure output enters `ActionResult.data` (and therefore
`action_runs.result_json`), redact configured values and common credential forms, then retain only
the tail. This applies to `stdoutTail`, `stderrTail`, and the capture-mode `answer` field so capture
cannot bypass the persistence boundary. Every complete stored failure-output value, including its
truncation marker, is at most 4096 characters. Empty streams remain omitted; successful capture
semantics remain unchanged.

This intentionally corrects the original design assumption that lifecycle-event redaction also
protected action-result persistence: those are separate sinks, so persistence must redact before
serialization.

#### Out of scope

- No new config knobs, retry/backoff machinery, dependencies, or cross-run cooldown.
- No model health pre-probing or changes to `checkUsable`.
- No reintroduction of phase maps or removed execution surfaces.
### Plan
- [x] Replace the classifier regex and add the positive/negative matrix (R1).
- [x] Inject `implementAgent` and validate `agent.default` (R2).
- [x] Thread attempted-executor exclusion through re-resolution (R3).
- [x] Add same-tier, different-binary exhaustion failover before up-tier fallback (R4).
- [x] Add verify/dogfood fallback chains and the `dev-fixall` registry alias (R5).
- [x] Persist redacted, total-bounded stderr/stdout tails on failed actions (R6).
- [x] Run the targeted task suites; all task tests execute with zero failures.
- [x] Reconcile the concurrent 0486 command/skill contract counts and corpus evidence, then rerun
  `bun run spur-check` to satisfy AC7.
### Root Cause
Executor exhaustion was not one defect: the classifier missed real provider vocabulary, default
selection did not reach the implement hop, attempted executors were eligible during re-resolution,
and the policy treated account availability as a quality-tier problem. Registry gaps then left some
stages without any ladder. Finally, the workflow persistence seam discarded failure output; the
initial implementation added tails but incorrectly assumed lifecycle-event redaction covered the
separate `ActionResult.data → action_runs.result_json` sink and bounded only content, not the marker.
### Solution
- R1: expanded objective-failure classification and regression matrix at
  `packages/app/src/services/agent-service.ts:1498` and
  `packages/app/tests/services/agent-service.test.ts:2218`.
- R2: implemented validated, independent default injection plus best-effort operational warning
  emission at `packages/app/src/services/workflow-service.ts:482` and
  `packages/app/src/services/workflow-service.ts:527`; CLI/server sinks are wired at
  `apps/cli/src/commands/workflow.ts:163` and `apps/server/src/context.ts:462`. Coverage lives at
  `packages/app/tests/services/workflow-service.test.ts:1586`.
- R3/R4: passed the attempted set into resolution at
  `packages/app/src/services/agent-service.ts:771`; resource exhaustion now excludes every
  run-scoped exhausted agent binary across sideways and fallback selection at
  `packages/app/src/services/agent-service.ts:985`. The alias-aware ordered regression at
  `packages/app/tests/services/agent-service.test.ts:2293` proves `pi → claude → codex` without
  returning through `pi`/`claude` executor aliases.
- R5: completed the canonical stage registry and test at
  `packages/domain/src/stage-registry/schema.ts:788` and
  `packages/domain/tests/stage-registry/schema.test.ts:608`.
- R6: injected configured secret values at `apps/cli/src/commands/workflow.ts:166`,
  `apps/server/src/context.ts:464`, and `packages/app/src/services/workflow-service.ts:949`.
  Failed `stdoutTail`, `stderrTail`, and capture-mode `answer` are redacted and total-bounded before
  result serialization at `packages/app/src/workflow/actions/agent-run.ts:458`. Unit and real
  persistence-adapter coverage lives at
  `packages/app/tests/workflow/actions/agent-run.test.ts:87` and
  `packages/app/tests/workflow/builtins.test.ts:184`.

Verification review fixed three implementation gaps found after the first PASS artifact:

1. availability routing could bounce between executor aliases on already exhausted binaries;
2. capture-mode `data.answer` could bypass R6 tail redaction and persist raw failure stdout;
3. stale-default warnings were returned but not emitted through an operational sink.

No scope expansion, new dependency, public config, or parallel policy path was introduced.
### Testing
Verdict: **PASS** — R1–R6 and AC1–AC7 are MET with fresh executable evidence.

| Requirement | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/agent-service.ts:1498`; 12-positive/4-negative matrix at `packages/app/tests/services/agent-service.test.ts:2218` |
| R2 | MET | independent injection and emitted warning at `packages/app/src/services/workflow-service.ts:482`; tests at `packages/app/tests/services/workflow-service.test.ts:1586` |
| R3 | MET | attempted-executor threading at `packages/app/src/services/agent-service.ts:771`; no-repeat alias regression at `packages/app/tests/services/agent-service.test.ts:2293` |
| R4 | MET | run-scoped exhausted-binary exclusion at `packages/app/src/services/agent-service.ts:985`; ordered `pi → claude → codex` regression at `packages/app/tests/services/agent-service.test.ts:2293` |
| R5 | MET | registry records at `packages/domain/src/stage-registry/schema.ts:788`; regression at `packages/domain/tests/stage-registry/schema.test.ts:608` |
| R6 | MET | redacted/bounded failure result fields at `packages/app/src/workflow/actions/agent-run.ts:458`; real persistence test at `packages/app/tests/workflow/builtins.test.ts:184` |

| Acceptance criterion | Status | Evidence type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test | classifier positive/negative matrix in `packages/app/tests/services/agent-service.test.ts:2218` |
| AC2 | MET | test | both-variable and caller-preservation cases at `packages/app/tests/services/workflow-service.test.ts:1586` |
| AC3 | MET | test | exactly-once warning plus non-failing sink behavior at `packages/app/tests/services/workflow-service.test.ts:1618` |
| AC4 | MET | test | alias-aware `pi → claude → codex` dispatch and no binary re-entry at `packages/app/tests/services/agent-service.test.ts:2293` |
| AC5 | MET | test | verify/dogfood fallbacks and `dev-fixall` alias at `packages/domain/tests/stage-registry/schema.test.ts:608` |
| AC6 | MET | test | unit and persisted-result coverage at `packages/app/tests/workflow/actions/agent-run.test.ts:87` and `packages/app/tests/workflow/builtins.test.ts:184` |
| AC7 | MET | command | `bun run spur-check` → 4767 passed / 0 failed; `bun run test-cf`, `bun run build`, and `git diff --check` → exit 0 |

- Focused 0485 suites: 355 tests passed, 0 failed across agent service, workflow service, action
  runner, real workflow persistence, and stage registry.
- `bun run autofix`: PASS — Biome formatting and every workspace typecheck clean.
- `bun run spur-check`: PASS — 4767 tests passed, 0 failed, 15124 assertions; all 43 pre-check
  rules, coverage/TSDoc, and corpus gates passed. Corpus: 4 baselined, 0 new, 0 stale.
- `bun run test-cf`: PASS — 1 file, 1 test.
- `bun run build`: PASS — CLI, server, and web builds.
- `git diff --check`: PASS.
- `--next`: BLOCKED by the normal lifecycle provenance guard because task 0485 has no recorded
  pipeline run. The task remains `todo`; no `SPUR_PROVENANCE_OVERRIDE` or force-done bypass was used.

Fix-pass artifacts: `.spur/run/0485-verify-answer.txt` and `.spur/run/0485-verdict.json` are the
canonical answer/verdict pair. This audit re-evaluated R2, R3/R4, and R6 after fixing warning
emission, exhausted-binary alias exclusion, and captured-answer persistence.
### Review
**Functional verdict: PASS**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | classifier and matrix at `packages/app/src/services/agent-service.ts:1498` and `packages/app/tests/services/agent-service.test.ts:2218` |
| R2 | MET | independent injection and operational warning at `packages/app/src/services/workflow-service.ts:482`; tests at `packages/app/tests/services/workflow-service.test.ts:1586` |
| R3 | MET | attempted-set re-resolution at `packages/app/src/services/agent-service.ts:771` |
| R4 | MET | binary-level availability exclusion at `packages/app/src/services/agent-service.ts:985`; alias regression at `packages/app/tests/services/agent-service.test.ts:2293` |
| R5 | MET | canonical registry and tests at `packages/domain/src/stage-registry/schema.ts:788` and `packages/domain/tests/stage-registry/schema.test.ts:608` |
| R6 | MET | persistence-boundary redaction at `packages/app/src/workflow/actions/agent-run.ts:458`; integration test at `packages/app/tests/workflow/builtins.test.ts:184` |

**SECUA findings**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 — FIXED | Correctness | `packages/app/src/services/agent-service.ts:985` | Executor-name-only exclusion allowed resource-exhaustion routing to bounce back through aliases on an already exhausted binary. Fixed by deriving run-scoped exhausted binaries and excluding them from sideways and fallback candidates. |
| P2 — FIXED | Security | `packages/app/src/workflow/actions/agent-run.ts:458` | Failed capture-mode runs persisted raw stdout in `data.answer`, bypassing the new redacted tails. Fixed by redacting and total-bounding every persisted failure-output field. |
| P2 — FIXED | Usability | `packages/app/src/services/workflow-service.ts:527` | Stale `agent.default` warnings existed only in the result object and were not operationally emitted. Fixed with best-effort CLI/server warning sinks and exactly-once tests. |
| P4 | Security / Efficiency / Correctness / Usability / Architecture | 0485 implementation scope | No remaining P1–P3 findings after repair and fresh gates. No new dependency, boundary violation, unbounded retry, suppression, debug output, or architecture-deepening candidate. |

**Architecture assessment:** PASS. The changes stay in the existing agent-selection service,
workflow composition roots, action-result persistence seam, and canonical stage registry. The
attempted set remains the single run-scoped bound; the shared redaction primitive remains the
single persistence sanitizer. No new abstraction or cross-package dependency direction was added.

**Verification:** focused suites 355/355; repository gate 4767/4767; Worker test, build, corpus,
lint/typecheck, coverage/TSDoc, and `git diff --check` all PASS.
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
- 2026-08-09T06:31:07.927Z todo → wip (system)
- 2026-08-09T06:31:08.672Z wip → testing (system)
- 2026-08-09T06:31:09.658Z testing → done (system)
