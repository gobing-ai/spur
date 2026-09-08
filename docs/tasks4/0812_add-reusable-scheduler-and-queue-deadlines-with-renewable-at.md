---
schema_version: 1
name: Add reusable scheduler and queue deadlines with renewable attempt ownership
status: todo
template: feature-impl
created_at: 2026-09-08T22:33:10.235Z
updated_at: "2026-09-08T22:35:57.076Z"
feature_id: A21
priority: P1
tags:
  - A21
  - execution-timeouts
  - upstream

dependencies: ["0810"]
---

## 0812. Add reusable scheduler and queue deadlines with renewable attempt ownership

### Background

Robin selected reusable upstream timeout control and an explicit unlimited mode on 2026-09-08. Feature A21 and ADR-112 define the scope; docs/design/execution-deadlines.md is the accepted design.

- Implements: R1 — Shared upstream policy governs actual execution
- Implements: R2 — Timeout values preserve inheritance and explicit unlimited mode
- Implements: R5 — Unlimited jobs retain ownership beyond visibility intervals
- Implements: R6 — Expired ownership cannot acknowledge a replacement attempt
- Implements: R9 — Cancellation settles before retry and preserves shutdown controls

- Owner: Upstream /Users/robin/xprojects/ts-libs: packages/infra/src/job-queue, scheduler, application-node.ts and portable option types; packages/db/src/queue-job-dao.ts and schema/queue-jobs.ts plus the owning migration mechanism; corresponding tests/README/design docs. Keep DB/runtime implementations behind existing subpaths.
- Rubric: E8 D1 L2 C1 R2 = 14; independently verifiable deliverable, estimated 6–8 hours. Tests/docs stay in this task. Whole feature E23 D4 L5 C2 R2 = 36; split by reusable capability and release boundary, not by scenario.
- Evidence baseline: installed upstream 0.4.57 and read-only ts-libs checkout f01336f7b770219babaf62c2bde2f11ac9c1d86e; existing 65 focused Spur tests passed but do not prove the new contract.

### Requirements

- **R1** — Use one native execution policy/context for direct scheduler callbacks and queue handlers; persist the scheduled job execution option through enqueue so timing an enqueue does not replace timing the actual job.
- **R2** — Resolve timeoutMs as omitted=inherited, null=unlimited, or positive supported milliseconds, rejecting invalid explicit values before work. Preserve upstream omitted behavior and add compatible optional context/options without breaking existing handlers.
- **R3** — Renew finite queue leases while a bounded or unlimited execution remains owned; two consumers must not execute the same live attempt after multiple visibility intervals.
- **R4** — Fence claim, renewal, completion, failure and retry by fresh attempt ownership. Recover expired work after worker loss, refuse stale acknowledgements, and document idempotency and drained old-consumer rollout.
- **R5** — Request cancellation on deadline/ownership loss; settle owned cancellable work before normal retry or release. Keep non-cooperative live work cancelling/observable, retain explicit manual cancellation and separate bounded/drain-to-completion shutdown policies.

### Acceptance Criteria

```gherkin
Feature: Add reusable scheduler and queue deadlines with renewable attempt ownership

  @core
  Scenario: R1 — Shared upstream policy governs actual execution
    Given a scheduler callback and a queued job have explicit execution budgets
    When each execution reaches its deadline
    Then the upstream infrastructure requests cancellation through the same execution contract
    And a scheduler callback that only enqueues does not substitute its elapsed time for the queued job deadline

  @core
  Scenario: R2 — Timeout values preserve inheritance and explicit unlimited mode
    Given timeout configuration is omitted, null, positive, or invalid
    When the upstream policy resolves the execution limit
    Then omitted values inherit and null disables this scope's deadline
    And zero, negative, fractional, non-finite, and unsupported timer values fail validation before work starts

  @core
  Scenario: R3 — Unlimited jobs retain ownership beyond visibility intervals
    Given an unlimited job has a live owner and another consumer polls the same queue
    When execution exceeds multiple visibility intervals
    Then the owner renews its lease and no other consumer claims that live attempt
    And the job can complete normally without a hidden execution timer

  @core
  Scenario: R4 — Expired ownership cannot acknowledge a replacement attempt
    Given an old worker loses its renewable lease and another worker claims the job
    When the old attempt tries to renew, complete, or fail the job
    Then each stale mutation is refused using attempt ownership
    And expired work becomes recoverable without claiming arbitrary side effects are exactly once

  @core
  Scenario: R5 — Cancellation settles before retry and preserves shutdown controls
    Given a queue handler receives cancellation or the server starts shutdown
    When the worker coordinates settlement and retry
    Then the attempt is not retried while its owned cancellable work remains active
    And unlimited jobs remain manually cancellable and obey the separately selected shutdown drain policy
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend existing ts-infra scheduler/consumer APIs with compatible optional execution options/context and one internal mechanism; reuse native runtime termination via handler signal integration instead of importing application shell commands. Persist explicit null distinctly from absence. Add an attempt token and lease expiry through the existing ts-db queue schema/migration owner; claims generate fresh tokens, every mutation compares its token, and expired-lease reclaim is atomic. Renew during running and cancellation cleanup on a cadence derived from the finite visibility interval, independent of execution timeout. Handle DB renewal failure by losing ownership, aborting and fencing acknowledgements; no exactly-once side-effect promise. Replace age-based reclaim for upgraded leased attempts. Explicit drain-to-completion keeps renewal alive; bounded drain cannot falsely release live work. Keep native main barrels portable and reusable adapters on sanctioned subpaths. No queue replacement, scheduler grammar rewrite or committed package link.

#### Decisions

- Follow ADR-112 and docs/design/execution-deadlines.md; null means unlimited, omitted inherits. Native mechanisms own lifecycle; no parallel Spur framework.
- Rejected: constant-only deduplication, -1 sentinels passed to timers, unbounded visibility leases and promise-race-only cancellation.
- Preserve concurrent changes; work in a clean isolated checkout for implementation and use only task-owned temporary processes/databases.

#### Dependencies and premises

The current consumer resets jobs by processing age and marks completion by job ID. A finite visibility lease must remain recoverable for unlimited execution; changing only timeout values is insufficient. Runtime containment must be available before proving native process integration.

#### Execution budget and evidence

- Budget: 6–8 hours; checkpoint at the upper bound with changed-file/commit/test evidence, then resume against the same requirements.
- Ownership: Upstream /Users/robin/xprojects/ts-libs: packages/infra/src/job-queue, scheduler, application-node.ts and portable option types; packages/db/src/queue-job-dao.ts and schema/queue-jobs.ts plus the owning migration mechanism; corresponding tests/README/design docs. Keep DB/runtime implementations behind existing subpaths.
- Upstream work follows upstream AGENTS.md and harness; this Spur record tracks acceptance and cross-repository ordering. Record the exact upstream commit and verification commands in this task through spur task, never fabricate local product changes to satisfy requireDiff.
- requireDiff: source changes must be verified in the owning repository; documentation/evidence here is allowed tracking, not proof of upstream implementation. If the task pipeline cannot verify external source scope, use its explicit external-evidence path and report that limit before completion.
- No production mutations, releases, workflow edits, new toolchains or publication are included.

### Plan

1. Verify runtime predecessor evidence; read upstream queue DAO/schema/migration and scheduler bootstrap tests. Add a two-consumer reproduction of reclaiming an alive long execution.
2. Implement additive attempt ownership and atomic lease operations with migration/legacy-row tests; require old consumers to drain/upgrade before enabling leased execution.
3. Implement the shared nullable policy and execution context, schedule-to-enqueue propagation, renewal lifecycle, cancellation settlement, timeout results and bounded/unlimited drain semantics.
4. Test short controlled intervals for live unlimited jobs, finite siblings, null/default precedence, worker disappearance, renewal failure, stale ack rejection, cancellation-before-retry and shutdown. Verify old omitted options and portable imports.
5. Run focused db/infra tests, then upstream bun run spur-check and bun run build; update upstream schema/API docs and include the release compatibility contract and immutable upstream evidence in this task. Do not publish.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
