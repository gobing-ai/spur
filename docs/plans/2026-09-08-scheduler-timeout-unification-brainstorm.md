---
date: 2026-09-08
status: proposed
needs_design: true
run_id: idea-timeout-20260908-7c2fd396
---

# Scheduler timeout unification — idea evaluation

## Enhanced Idea

Give scheduled commands, completion-triggered history refreshes, and history imports one owner for timeout defaults, validation, and budget resolution. Reuse the upstream scheduler for scheduling and upstream process/import cancellation wherever its verified contract is sufficient. Keep per-source limits, whole-job limits, termination grace, queue visibility, and shutdown draining semantically distinct. A timeout must not be mistaken for proof that a database writer stopped. This repairs demonstrated timeout inconsistencies; it does not claim to establish or eliminate the reported database-lock root cause.

## Scores

| Dimension | Score | Rationale |
| --- | --- | --- |
| Urgency | 4/5 | Recurring lock failures are operator-reported; timeout wiring has a concrete inconsistency. |
| Necessity | 4/5 | Shared execution already exists, but duplicated policy and incomplete cancellation make recovery unreliable. |

## Premises and Findings

Confidence is HIGH for source observations below, MEDIUM for inferred incident impact. Sources inspected on 2026-09-08; no live lock incident was reproduced.

1. **High — termination and stale recovery disagree.** `apps/server/src/serve.ts:241` adds environment-resolved grace to the stale threshold. Its two handler registrations at lines 741–770 pass no grace. `packages/app/src/services/bounded-child-run.ts:109` therefore uses 5,000 ms. `history-refresh-service.ts:236` has no grace collaborator at all. A smaller configured grace can mark a row stale before the child's actual escalation window ends; a larger grace delays recovery without extending child cleanup. This is a demonstrated wiring defect, not proof of the current lock holder.
2. **High — timeout is abandonment, not import cancellation.** `packages/app/src/services/history-service.ts:1022` races an import against a timer, without passing the abort signal into the import. It explicitly permits later writes. `importAll` stops subsequent sources at line 883, but cannot stop the active one. The installed importer's `ImportOptions` exposes no cancellation signal. Reusing a shared timer alone cannot repair that lifecycle gap.
3. **Medium — duplicate defaults and inconsistent validation.** The private `DEFAULT_SOURCE_TIMEOUT_MS` at `history-service.ts:416`, exported `SCHEDULER_CUSTOM_TIMEOUT_MS` at `scheduler-custom-job-service.ts:73`, and CLI literals at `apps/cli/src/commands/history.ts:93,120,382,390` repeat 600,000 ms. CLI `parseInt(...) || 600_000` accepts partial and negative values. Environment resolvers at `scheduler-custom-job-service.ts:82,114`, `history-refresh-service.ts:260`, and `bounded-child-run.ts:37` independently parse positive integers without a queue-budget upper bound.
4. **Medium — job budget and recovery need the same resolved snapshot.** The sweep threshold is captured at registration (`serve.ts:241`); handler closures resolve per-job/refresh overrides later (`serve.ts:749,767`). Standalone registration also resolves its global fallback from ambient `process.env` before considering `options.env` (`serve.ts:184`). The proposed consolidation must make injected configuration authoritative and share resolved values.
5. **Medium — existing independent budgets are deliberate.** Task 0806 introduced per-job and refresh overrides to avoid extending every short refresh when one shell chain needs longer. Its regression contract is visible in `packages/app/tests/services/job-exclusion-guard.test.ts:53`. Sharing implementation should preserve this behavior. A ten-minute per-source ceiling and a ten-minute whole-command ceiling apply to different scopes; six sequential sources do not get sixty minutes under a ten-minute parent.
6. **Medium — recovery has an independent ceiling.** `apps/server/src/context.ts:108,650` configures a two-hour queue visibility timeout. Accepted job deadline plus termination grace must fit inside that ceiling, or visibility must explicitly support the longer job. A stale age alone does not prove an old process is dead; retain that distinction when evaluating the sweep's safety.
7. **Low — documentation/test descriptions have drifted.** `history-refresh-service.ts:246` and `serve.ts:715` still describe one shared environment value, while the actual handlers use separate resolvers. `apps/server/tests/serve.test.ts:1448` says one variable bounds both handlers but sets both variables at lines 1507–1508.

## Upstream Capability Check

The installed versions and npm's current version are all **0.4.57** for `ts-infra`, `ts-runtime`, and `ts-llm-jsonl-importer`. Read-only local upstream checkout: `/Users/robin/xprojects/ts-libs`, clean at `f01336f7b770219babaf62c2bde2f11ac9c1d86e`. No upstream files were edited. The [official repository](https://github.com/gobing-ai/ts-libs) confirms the package ownership split; installed source is the behavior authority for this build.

| Capability | Verified behavior | Consequence |
| --- | --- | --- |
| Scheduler | `node_modules/@gobing-ai/ts-infra/dist/scheduler/types.d.ts:5` has `ScheduledAction = () => Promise<void>`; `SchedulerJobConfig` has schedule/name/command only. `scheduler/node.js` bounds `stop()` draining. | No native queued-command execution deadline to switch on. Preserve native scheduling; do not confuse drain timeout with execution timeout. |
| Queue | `ts-infra/dist/job-queue/types.d.ts` provides visibility and drain timeouts; handler receives a job, without an abort signal. | Visibility is a lease/recovery boundary, not command termination. |
| Process executor | `ts-runtime/dist/process-executor.js:398` forwards native `timeout`; a supplied signal enables a detached Unix group. `observeProcessGroupCancellation` at line 416 sends group SIGTERM, without group SIGKILL escalation. | Keep the existing bounded-child adapter until equivalent upstream group containment is available and verified. The adapter currently also supplies native timeout, so two deadline timers are armed. |
| Importer | `ts-llm-jsonl-importer` `ImportOptions`; upstream `packages/llm-jsonl-importer/src/types.ts:87`. No signal/timeout option. | Reliable cooperative cancellation requires an upstream change. A hard bound for synchronous blocking work still needs a process boundary. |

## Approaches

| Approach | Benefit | Cost / limitation | Confidence |
| --- | --- | --- | --- |
| Consolidate constants only | Smallest textual diff. | Leaves grace mismatch, parsing drift, duplicate timers, and abandoned imports. Insufficient. | HIGH, findings 1–3. |
| **One policy owner, reuse existing bounded execution, explicit upstream cancellation work** | Fixes current wiring and parsing without replacing the scheduler or losing per-job control. | Complete cancellation remains dependent on upstream semantics; cannot call that gap fixed by policy cleanup. | HIGH for consolidation; MEDIUM for cancellation design until upstream tests exist. |
| Move all job budget/configuration ownership into upstream scheduler now | Potential reuse across consumers. | Scheduler only enqueues; moving command execution there expands its responsibility and schema without solving importer cancellation. | HIGH on existing boundary; LOW on benefit of the proposed expansion. |

## Pros

- A single resolved policy drives handler deadlines, termination grace, and compatible stale thresholds.
- Existing per-job tuning remains useful; invalid inputs cannot silently produce surprising timers.
- Upstream owns reusable process/import cancellation; Spur keeps application budget selection.
- Regression evidence can distinguish reporting a timeout from actually stopping a writer.

## Cons

- Old environment controls need explicit compatibility precedence during consolidation.
- Complete importer cancellation/process-tree containment crosses the upstream release boundary.
- This work does not identify competing daemons, external writers, transaction length, or every other possible lock cause.

## Design Summary

Use one small application policy owner for the shared ten-minute default and strict millisecond validation, with semantic per-source and per-job overrides. Reuse `runBoundedChild` as the existing child-execution seam. Resolve a daemon's job deadlines and grace once and pass those values into both queue handlers and scheduler recovery. Preserve current legacy environment precedence as compatibility inputs to that owner; do not add a second set of tuning controls. Explicit CLI limits override the per-source default, with malformed values rejected before work starts. Environment fallback behavior stays documented and deterministic. Validate timer bounds and ensure each server job's deadline plus grace fits inside the queue visibility budget.

Retain separate whole-job and per-source deadlines: the parent is the hard bound; a source may use less time and cannot extend it. Pass cancellation through the real upstream importer API only after that API exists and is verified. Avoid racing away from a still-writing import and reporting cancellation as completed. Cooperative checks must respect transaction/checkpoint boundaries; synchronous SQLite stalls remain bounded by the child process watchdog. Native process-tree abort/escalation should move upstream if the facade lacks sufficient semantics; remove local lifecycle machinery only when upstream tests demonstrate equivalent cleanup. This proposal authorizes no upstream release, dependency update, or external publication by itself.

Keep scheduler cadence, queue lease timeout, SQLite busy timeout, shutdown drain, and unrelated agent/workflow timeouts outside this unification. Shared names or identical numbers alone do not make them interchangeable. No new public CLI noun/verb, scheduler engine, or generic timeout framework is proposed.

`needs_design: true`: the work crosses CLI, application, server recovery, and upstream cancellation contracts. Detailed design must settle compatibility precedence, cancellation settlement, and recovery ownership before implementation.

## Candidate Work and Acceptance Evidence

These are proposed work units, not created harness tasks:

1. **Consolidate policy and wiring in Spur.** Cover both history CLI paths, both queue handlers, and scheduler stale recovery. Preserve existing override behavior; remove duplicate default/parsing owners. Verify that a non-default grace reaches actual termination and stale thresholds, injected environment wins consistently, malformed/oversized values are handled explicitly, and long jobs cannot exceed visibility unnoticed.
2. **Close native cancellation gaps, then adopt them.** Upstream runtime/importer changes are conditional on confirmed capability gaps above and require the upstream project's lifecycle. Verify actual descendants, inherited pipes, a TERM-resistant child, lock reacquisition, no later writes after cancellation settlement, and checkpoint resume. Spur adoption depends on an available validated release; retain existing containment until then.
3. **Integrate regression evidence and docs in those tasks.** No separate test-only or documentation-only task is needed. Add a server-level non-default-grace regression and an isolated SQLite writer/timeout/reacquisition test. Keep whole-chain verdict distinct from child stdout exit codes. Update `docs/04_DESIGN.md` and related descriptions with the final contract.

## Validation Performed

From `packages/app`:

```sh
bun test tests/services/bounded-child-run.test.ts tests/services/scheduler-custom-job-service.test.ts tests/services/history-refresh-service.test.ts tests/services/job-exclusion-guard.test.ts
bun test tests/services/history-service.test.ts --test-name-pattern 'per-source timeout containment'
```

Results: **64 pass, 0 fail**, then **1 pass, 0 fail** (52 filtered). These are baseline checks, not implementation verification. The existing test named “SIGTERM-resistant descendant” directly spawns one Bun process; it does not prove a nested shell descendant holding SQLite is reaped. The import timeout test proves fan-out stops, not cancellation or lock release. Full build/lint gates were not run because no product code changed.

## Recommendation

**Proceed with the second approach.** Unify policy and validation, repair the grace wiring, and treat upstream cancellation as an explicit dependency for full lifecycle correctness. Do not raise a global timeout to hide contention or claim constant deduplication fixes locks.

Stakes: application consolidation is local and reviewable; upstream lifecycle changes require their own tests and release coordination. Existing changes in `apps/cli/src/commands/serve.ts` and its tests were preserved.

## Spec Self-Review

No placeholders, no new execution engine, no claim of a reproduced database-lock root cause. Scope distinguishes policy cleanup from missing cancellation. Compatibility and upstream dependencies are explicit. This report is proposed, not an approved design.

## Pipeline Checkpoint

Inline idea run `idea-timeout-20260908-7c2fd396`: authoritative identity created; doctor PASS; discovery complete; host waiting at `idea-eval`. No feature or tasks created. Invocation has `profile=auto`, `idea_approved=false`, `design_approved=false`. The invoked `sp-dev-idea` skill explicitly retains the idea-evaluation taste gate under `--auto`.

---
run_id: idea-timeout-20260908-7c2fd396
generated_at: 2026-09-08T22:12:35Z
---

## 2026-09-08 Revision — Upstream Ownership and Unlimited Execution

Operator feedback: put reusable timeout control in `@gobing-ai/ts-infra` so downstream consumers benefit, and support explicitly waiting without an execution deadline. This revision supersedes the earlier local-first recommendation, the unconditional finite-budget/visibility inequality, and the earlier scope's lack of an unlimited mode. It is still an evaluation proposal, not implementation or release approval.

### Revised recommendation

**Build the reusable mechanism upstream first; make Spur an adopting consumer.** `ts-infra` should own execution-deadline resolution and lifecycle for scheduler callbacks and queue handlers, including per-execution overrides, cancellation context, and timeout outcomes. Both surfaces should reuse the same mechanism. For a scheduled queue-backed command, the scheduler's callback ends after enqueue; the actual execution policy must reach the queue consumer. Timing the enqueue alone does not bound that command.

`ts-runtime` remains responsible for terminating process trees and escalation. `ts-llm-jsonl-importer` remains responsible for observing cancellation at safe import/transaction boundaries. `ts-infra` composes these through a cancellation signal; it cannot forcibly stop an arbitrary JavaScript promise. Do not retry or report completed cancellation while an old handler can still write. Spur owns application defaults, job-specific budgets, legacy configuration translation, and user-facing error presentation. Generic mechanisms and timeout configuration should no longer live in separate Spur handlers.

This differs from putting application shell execution into the scheduler: the upstream addition is a reusable execution contract, usable by other applications with their own handlers. Current public upstream types do not yet expose it: [queue types](https://raw.githubusercontent.com/gobing-ai/ts-libs/main/packages/infra/src/job-queue/types.ts), checked 2026-09-08; installed `ts-infra@0.4.57` matches this limitation. Confidence HIGH for the missing API; the API shape below is proposed.

### Proposed timeout representation

```ts
timeoutMs?: number | null;
```

| Value | Proposed meaning |
| --- | --- |
| Omitted / `undefined` | Inherit the enclosing/default policy. |
| Positive finite integer | Execution deadline in milliseconds, subject to the supported timer range. |
| Explicit `null` | No deadline imposed by this execution scope. |
| Zero, negative, fractional, NaN, infinity | Invalid; do not pass through to platform timers. |

Use YAML/JSON `timeoutMs: null`; use `none` as the human-facing CLI/environment spelling, normalized once at the configuration boundary. Prefer this over `-1`: `null` is explicit and cannot accidentally become a negative timer duration. No redundant `enabled` boolean or policy class is needed. Resolution must preserve explicit null: `value ?? defaultValue` would incorrectly turn unlimited back into the default. No `-1` compatibility alias is needed because no existing documented unlimited sentinel was found in the inspected paths.

Per-job override wins over the consumer/scheduler default; an omitted override inherits. Preserve existing upstream consumers' behavior when they omit the new option (currently no execution deadline). Spur can keep its finite ten-minute default. Explicitly disabling the overall job budget must also reach default child/import budgets when the operator requests the entire operation to be unlimited; no hidden fallback may silently re-arm the old ten-minute limit. An explicitly configured inner limit remains meaningful and must be visible. An unlimited inner scope cannot override a finite parent deadline or explicit cancellation.

### Unlimited jobs require live ownership

The installed consumer calls `resetStuckJobs(visibilityTimeout)` before claiming work (`node_modules/@gobing-ai/ts-infra/dist/job-queue/db-job-queue.js:147`). It awaits the handler, then completes the row by job ID (line 222). Consequently, removing the execution timer alone is insufficient: another consumer can reclaim sufficiently old work while its original handler is still running.

Provide renewable, ownership-checked queue leases for long/unlimited executions. An active worker renews its lease independently of the job's execution deadline; a lost worker's lease eventually expires. Completion/failure/renewal must be conditional on the current attempt's ownership so an old attempt cannot mutate a replacement attempt. Lease loss requests cancellation and prevents stale acknowledgement; it does not prove arbitrary handler side effects stopped. Preserve idempotency expectations and the existing single-flight/exclusion controls. Spur's age-only stale sweeper must consume this ownership contract instead of failing a healthy unlimited job solely because it is old. Existing finite execution budgets also benefit from this separation.

Unlimited disables automatic execution expiry. It does not disable operator cancellation, process failures, or a separately configured shutdown policy. Shutdown should expose an explicit drain-to-completion choice where supported; disabling a job's timeout must not silently disable all shutdown controls. No system can promise execution survives a host kill or crash.

### Revised work sequence and acceptance evidence

1. **Upstream lifecycle:** design and implement shared optional execution budgets in `ts-infra`, renewable attempt ownership in the queue's persistence layer, and cancellation integration in `ts-runtime`/importer where required. Keep changes compatible for existing consumers. Verify finite deadlines, null inheritance, cancellation settlement, process-tree cleanup, live lease renewal beyond the old visibility interval, crashed-worker recovery, stale acknowledgement rejection, and safe checkpoint resumption.
2. **Spur adoption:** after a validated upstream release is available, route scheduler/custom/refresh/import execution through the native contract, consolidate application defaults/legacy parsing, remove superseded local watchdog/sweep logic, and update docs with bounded/unlimited examples. Verify one configured unlimited job survives beyond the previous execution and visibility limits without duplicate execution, while finite sibling jobs still time out and manual cancellation still works.

Do not add a parallel Spur-only lease/deadline framework during adoption. Upstream release/publish and dependency-update operations remain separate authorized actions. The original 65 passing tests remain baseline evidence only; no revised functionality has been implemented or tested.

## 2026-09-08 Planning Handoff — Supersedes the Initial Pause

Robin approved the revised proposal with “okay, go ahead.” The inline idea pipeline completed at
handoff with feature A21, ADR-112 and the accepted design in `docs/design/execution-deadlines.md`.

| Task | Deliverable | Predecessors |
| --- | --- | --- |
| 0810 | Native process-tree timeout/cancellation containment | None |
| 0811 | Import cancellation settlement and checkpoint safety | None |
| 0812 | Shared scheduler/queue policy and renewable attempt ownership | 0810 |
| 0813 | Spur native-policy adoption and integration regressions | 0810, 0811, 0812; compatible upstream release |

All four specifications passed task checks and digest-bound readiness checks; all eleven feature
scenarios are linked. Unfinished predecessors and unverified implementation scenarios remain visible
as expected warnings. The 45-rule recommended precheck, package-link check and diff whitespace check
passed. No implementation, upstream repository edit or publication occurred during this planning run.

Next command: `/sp:dev-runall --feature A21 --auto`.
