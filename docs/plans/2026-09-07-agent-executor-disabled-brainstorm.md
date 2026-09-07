---
date: 2026-09-07
status: proposed
needs_design: true
---

# Executor disabling and quota events — evaluation

## Enhanced Idea

Add an optional boolean `disabled` to named agent executor definitions. Preserve layered configuration semantics and keep disabled executors inspectable while excluding them from execution. Detect confirmed quota exhaustion at the shared runner boundary, carry exact executor and project identity into a typed event, and asynchronously update only an existing matching project configuration entry. Reserve a corresponding recovery event and implement its consumer, leaving recovery detection for later.

Recommendation: **reshape, then proceed**. The flag is straightforward; accurate failure classification, cross-process event delivery, and runtime refresh are the substantive work. This document is a proposal, not an approved product contract.

## Scores

| Dimension | Score | Rationale |
| --- | --- | --- |
| Urgency | 3/5 | Commenting exhausted executors out works, but requires repeated manual intervention. No blocking incident was reproduced in this evaluation. |
| Necessity | 4/5 | Explicit availability is needed for reliable selection and the requested future dynamic executor management. |

## Evidence and material findings

Evidence checked against this working tree and installed dependency source on 2026-09-07.

1. **High: persistent disabling cannot use the existing escalation classification directly.** `FAILURE_RULES` groups quota, rate limiting, overload, and context limits under `resource-exhaustion`. That classification serves fallback decisions; it is too broad for a persistent configuration mutation. See `packages/app/src/services/failure-classification.ts:29`. The installed runner's health vocabulary already distinguishes `quota_exhausted` and `rate_limited`, but invocation events currently expose start/exit rather than a dedicated quota event: `node_modules/@gobing-ai/ts-ai-runner/src/model-health-probe.ts:16`, `node_modules/@gobing-ai/ts-ai-runner/src/ai-runner.ts:204`.
2. **High: server subscriptions alone miss CLI processes.** CLI execution buses persist to the shared ledger through `apps/cli/src/system-event-ledger.ts:56`; the server registers its own bus tap at `apps/server/src/serve.ts:496`. Persisting an event does not invoke another process's bus listeners. Reuse the existing ledger follower, `packages/app/src/services/system-event-follow.ts:45`, for cross-process consumption.
3. **High: a shared helper alone does not cover every selection route.** Role and team eligibility share `cheapestEligibleExecutors` at `packages/app/src/services/agent-service.ts:2731`; direct executor resolution also exists at `packages/config/src/index.ts:508` and `packages/app/src/services/agent-service.ts:1895`; escalation has its own candidate filters. Team materialization calls both shared paths at `packages/app/src/services/team-service.ts:720`. Each execution route needs coverage.
4. **Medium: defaults must apply after merging.** The loader merges raw executor entries by name, then validates once: `packages/config/src/loader.ts:227`. Defaulting each input layer independently could incorrectly override an inherited `true` with `false`.
5. **Medium: file edits alone do not refresh active service snapshots.** Loader caching considers file mtimes and provides invalidation (`packages/config/src/loader.ts:250`), but CLI contexts capture agent config (`apps/cli/src/context.ts:176`) and server services retain config (`apps/server/src/context.ts:457`). Doctor also caches results. Runtime refresh is a requirement, not an incidental optimization.

## Refined Requirements

### R1 — Schema and layered defaults

Accept `disabled: true | false` on each `agent.executors` item in both global and project YAML. Update Zod, shipped JSON Schema, examples, and configuration documentation together. Reject strings such as `"false"`, null, and other non-booleans.

Merge raw layers first. Default an absent **effective** value to false:

| Global value | Matching project value | Effective disabled |
| --- | --- | --- |
| absent | absent | false |
| true | absent | true |
| true | false | false |
| false | true | true |

This preserves existing project-over-global semantics. “Missing means false” must not mean that a project fragment silently cancels a global disable.

### R2 — Execution eligibility

Disabled entries remain configured and valid references, but cannot launch. Role/default selection, stage policies, fallback/escalation, workflows, and role-based team materialization skip them. Explicitly pinned disabled executors fail before spawning, with an actionable disabled-executor error; do not silently switch an explicit pin or reinterpret its name as a canonical binary. A team member explicitly naming one follows the same rule.

If no enabled eligible executor remains, return the existing nonzero resolution failure with disabled candidates identified. Do not cancel an invocation already running when its executor becomes disabled. Disabling is scoped to the named profile; it does not ban every use of the same binary, model, or account.

### R3 — Doctor inspection

Show disabled entries in the full inventory and relevant role ladder, labeled `disabled`, with `disabled: true` and effective `usable: false` in JSON. They are never elected. Keep the elected enabled entry first in successful role JSON because the workflow precheck consumes `agents[0]`.

Skip health probes for disabled entries. Recommended exit behavior: full-inventory inspection ignores intentional disables when calculating health failures; an explicit disabled-executor check fails; role inspection succeeds only if an enabled usable candidate exists. Disabled rows alone must not make a healthy enabled fleet fail doctor. Refresh cached eligibility when the flag changes.

### R4 — Shared project update operation

Provide an internal asynchronous function with the conceptual signature:

```ts
setProjectExecutorDisabled(projectRoot, executorName, disabled)
```

It targets only `<projectRoot>/.spur/config.yaml` and exact, case-sensitive `name` equality. Missing file, missing executor list, or missing named entry produces a structured no-op reason. It never creates the file, section, entry, or a global configuration override. It may update a name-only project fragment whose remaining fields come from global configuration.

Only the matching entry's `disabled` attribute changes. Preserve other values, comments, and ordering; avoid serializing a fully merged/default-expanded config back into a project file. If the explicit stored boolean already matches, do not rewrite. Setting false on an existing entry with no attribute writes explicit false, which matters for overriding global true.

Invalid YAML, ambiguous duplicate names, unsupported edit structures, and write failures return actionable errors with the original file intact. Serialize read-modify-write operations per file, commit atomically, and detect concurrent external edits rather than overwrite them. Atomic rename alone does not prevent lost updates. Reuse existing filesystem/YAML facilities where their contracts fit.

### R5 — Precise event names and classification

Use **`agent.quota.exhausted`** and **`agent.quota.recovered`**. Quota describes the unavailable resource more precisely than “token,” which can also mean context or output budget.

Emit exhaustion once per observed failing invocation/health observation when evidence confirms depleted usage allowance or credits. Do not emit it for a generic 429, temporary throttling, overload, authentication errors, context length, maximum output tokens, timeout, or unknown failure. Prefer structured provider error codes; otherwise use narrow, tested provider evidence at the shared runner boundary. Never classify arbitrary quoted prompt content as a provider failure. Preserve the original run result and existing fallback policy.

Own reusable detection/event production in `@gobing-ai/ts-ai-runner` in ts-libs. Spur supplies project and named-executor routing context and consumes the event. Avoid two competing classifiers or duplicate emission for the same observation. Cover supported buffered, streaming, workflow, and team execution paths; event wiring must be explicit for standalone upstream consumers. Uninstrumented external agent sessions are outside this feature's detection guarantee.

### R6 — Event identity and isolation

Use the existing event envelope and correlation conventions. Carry stable event/observation identity, timestamp, run/execution identity when available, exact executor name, project identity, canonical agent, optional model, and normalized reason/evidence source. Keep secrets and raw prompts/output out of the mutation payload.

The upstream runner currently knows canonical agent and run correlation; that is insufficient to identify a named Spur executor. Propagate exact attribution from the dispatch boundary. Unknown or ambiguous attribution may be recorded for inspection but must never trigger a guessed YAML update. Resolve the target through trusted project context/registry; an event-supplied arbitrary filesystem path is not authority.

### R7 — Server consumption and delivery

At local Bun server startup, attach consumers for both event kinds before dispatch/autostart begins. Exhaustion maps to true and recovery to false through R4. Consume server-local and CLI/upstream-produced events through one ordered application path; a bus notification may wake the consumer but must not also perform a duplicate write.

Recommended transport: reuse the project SQLite event ledger and follower. Record the last successfully handled sequence durably so retained events emitted while the server was stopped can be applied at startup. Advance only after a successful update or classified no-op. Process in ledger order, deduplicate stable observation identity, and prevent delayed events from reversing a newer applied status. Bound retries and expose mutation failures without changing the original agent failure. Unsubscribe and drain pending updates during graceful shutdown.

This is operational behavior and must not silently stop when diagnostic event display is disabled. Existing observability retention is not a guaranteed work queue: the design must specify checkpoint storage and pending-event retention/gap reporting before implementation. Do not promise indefinite offline delivery from a prunable ledger. A live-only implementation is a narrower alternative, not full satisfaction of the requested “each time” behavior.

### R8 — Refresh and immediate fallback

After a successful write, refresh effective configuration and doctor eligibility for subsequent dispatch decisions without restarting the server. Re-read relevant availability before retries/fallback in a long-running workflow. Exclude the just-exhausted executor immediately within the current invocation, even before the asynchronous file update finishes or if R4 returns a no-op.

### R9 — Recovery reservation

Define and test the recovery event and consumer now. Do not add a timer, provider polling, automatic health probing, or infer recovery from elapsed time in this feature. Recovery means an explicit trusted instruction that re-enables the named executor, and applies only to an existing project entry.

A single boolean cannot distinguish a manual disable from an automatic disable. Before adding an automatic recovery producer later, design disable ownership so it cannot undo an operator's manual choice. Until then, normal manual recovery is an explicit YAML `disabled: false` change.

### R10 — Scope limits that must remain visible

- Global-only executors: events cannot persistently disable them under the requested no-insertion rule. An operator can predeclare a name-only project override if project-local automation is desired.
- Same provider/account across profiles or projects: update only the exact attributed executor in the affected project. No inferred account-wide fan-out.
- Server offline: asynchronous application waits for startup; retained-event delivery needs R7's checkpoint and retention contract.
- Cloudflare Workers: this local filesystem updater belongs to the Bun server path.
- No public enable/disable CLI, dynamic profile CRUD, provider credential management, or recovery detector is added.

## Acceptance evidence required before completion

| Area | Observable checks |
| --- | --- |
| Schema | Legacy omission; true/false validation; merge matrix; shipped JSON Schema parity. |
| Selection | Disabled explicit pin rejected; role/default/fallback/workflow/team skip it; all-disabled failure; same-name binary collision cannot bypass rejection. |
| Doctor | Text/JSON disabled state; no disabled probe/election; elected row first; inventory vs targeted exit semantics; stale cache invalidated. |
| Mutation | Exact name only; absent file/list/name no-op; global file unchanged; name-only fragment supported; explicit false persisted; comments/unrelated fields preserved; duplicate/invalid YAML rejected. |
| Concurrency | Two executor updates both survive; concurrent external edit detected; atomic-write failure preserves original file. |
| Classification | Confirmed quota/credits positive cases and every R5 negative case; buffered and streaming detection; no duplicate observation emission. |
| Delivery | CLI and server emissions update the same project; missing identity cannot write; retained offline events caught up; failed write not acknowledged; duplicate/stale events cannot undo newer state; retention gaps surfaced. |
| Runtime | Same running service's next selection reflects the write; current fallback immediately excludes exhaustion; startup subscription precedes dispatch; shutdown drains. |
| Recovery | Trusted recovery sets false; no automatic recovery producer exists; absent project entry remains absent. |

## Alternatives, benefits, and costs

| Approach | Benefits | Costs / limits | Confidence |
| --- | --- | --- | --- |
| Flag + selection + manual YAML updates | Smallest useful increment; replaces commenting out entries. | Does not satisfy requested automatic events and server updates. | High: established schema and selection seams above. |
| Flag + precise quota events + project updater + ledger consumer **(recommended)** | Meets the requested behavior; reuses config, runner, and event infrastructure. | Cross-repository release coordination; runtime refresh and reliable consumption require design. | Medium: seams verified, delivery/checkpoint contract still needs design. |
| Separate availability store with account-level circuit breaking and recovery polling | Can separate operator intent from transient health and share provider state. | Larger state model and new policy surfaces; premature for the requested preparation. | Medium: architectural alternative, not a verified existing facility. |

Premises: named profile identity is the intended mutation scope; project configuration is writable; exact dispatch attribution is available or will be propagated; upstream integration changes can be released before Spur consumes them. Provider-specific exhaustion examples still need regression fixtures; this evaluation did not exercise live failures or inspect every upstream adapter.

Pros: explicit reversible configuration, visible exclusions, fewer repeated failed dispatches, shared event contract for future recovery.

Cons: automated writes can conflict with operator edits; false classification could strand executors; inherited global-only entries intentionally remain outside persistent project automation; offline delivery adds lifecycle work.

## Design Summary

Keep policy in Spur and reusable failure detection in ts-libs. Configuration owns the flag and exact project-file mutation. Shared eligibility funnels and explicit-pin guards enforce availability. A typed, attributed quota event enters the existing durable event infrastructure; a local server consumer orders application through the same updater and refreshes runtime configuration. Immediate in-run exclusion does not wait for persistence. Recovery has a contract and consumer but no producer.

`needs_design: true`: this spans configuration/schema, runner events, resolution, server lifecycle, persistence, and an upstream release boundary. Before decomposition, settle R7's checkpoint/retention mechanism and map every dispatch route. No new dependencies are justified by the evaluation.

Suggested implementation slices after approval: (1) schema, eligibility, and doctor; (2) safe project updater; (3) upstream classification/event attribution and release dependency; (4) Spur event consumption, refresh, lifecycle checks, and docs. These are proposed slices, not created tasks.

## Evaluation status

Source review and spec self-review completed. Source-local `bun run apps/cli/src/index.ts agent doctor planner --json` exited 0 with an elected usable executor. This checks the idea pipeline's preflight only; it does not validate the proposed behavior. No production changes or implementation tests were run. Existing unrelated Git changes were preserved.

The `--auto` idea run stops for review at `idea-eval`; approve this refined scope to proceed to feature creation. No feature or task has been created.
