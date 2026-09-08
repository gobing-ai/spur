---
schema_version: 1
name: Make history importer cancellation settle writes and checkpoints
status: todo
template: feature-impl
created_at: 2026-09-08T22:33:10.234Z
updated_at: "2026-09-08T22:34:22.074Z"
feature_id: A21
priority: P1
tags:
  - A21
  - execution-timeouts
  - upstream

---

## 0811. Make history importer cancellation settle writes and checkpoints

### Background

Robin selected reusable upstream timeout control and an explicit unlimited mode on 2026-09-08. Feature A21 and ADR-112 define the scope; docs/design/execution-deadlines.md is the accepted design.

- Implements: R4 — Import cancellation settles before reporting completion

- Owner: Upstream /Users/robin/xprojects/ts-libs: packages/llm-jsonl-importer/src/types.ts, importer.ts and directly called import loops/adapters; corresponding package tests/README and owning upstream docs. Spur tracking evidence only.
- Rubric: E4 D1 L1 C1 R2 = 9; independently verifiable deliverable, estimated 3–5 hours. Tests/docs stay in this task. Whole feature E23 D4 L5 C2 R2 = 36; split by reusable capability and release boundary, not by scenario.
- Evidence baseline: installed upstream 0.4.57 and read-only ts-libs checkout f01336f7b770219babaf62c2bde2f11ac9c1d86e; existing 65 focused Spur tests passed but do not prove the new contract.

### Requirements

- **R1** — Add cooperative AbortSignal support to the existing importer entry/options contract. Abort before further work, settle in-flight transactions/checkpoints before rejecting, and guarantee no invocation-owned writes after cancellation settlement while preserving incremental resume and behavior without a signal.

### Acceptance Criteria

```gherkin
Feature: Make history importer cancellation settle writes and checkpoints

  @core
  Scenario: R1 — Import cancellation settles before reporting completion
    Given an importer is processing records under an abort signal
    When cancellation arrives during the import
    Then the importer stops scheduling further writes and settles transaction and checkpoint work before rejecting
    And no writes from that cancelled invocation occur after rejection
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend existing ImportOptions with an optional signal and propagate it through real work owners instead of wrapping an uncancellable import in Promise.race. Check before file/batch processing, before starting additional writes and between bounded batches. Track and await in-flight work so the public promise cannot reject ahead of its writes. Active transaction work must commit consistently or roll back; never claim a synchronous SQLite operation can be interrupted by a JavaScript timer. The containing process from the runtime task remains the hard fallback. Preserve all source adapters, dry-run and full reconciliation semantics without new import pipelines.

#### Decisions

- Follow ADR-112 and docs/design/execution-deadlines.md; null means unlimited, omitted inherits. Native mechanisms own lifecycle; no parallel Spur framework.
- Rejected: constant-only deduplication, -1 sentinels passed to timers, unbounded visibility leases and promise-race-only cancellation.
- Preserve concurrent changes; work in a clean isolated checkout for implementation and use only task-owned temporary processes/databases.

#### Dependencies and premises

ImportOptions in 0.4.57 has no signal. Cancellation is cooperative; lock acquisition or another synchronous blocked call needs the existing external process watchdog, not a stronger promise claim.

#### Execution budget and evidence

- Budget: 3–5 hours; checkpoint at the upper bound with changed-file/commit/test evidence, then resume against the same requirements.
- Ownership: Upstream /Users/robin/xprojects/ts-libs: packages/llm-jsonl-importer/src/types.ts, importer.ts and directly called import loops/adapters; corresponding package tests/README and owning upstream docs. Spur tracking evidence only.
- Upstream work follows upstream AGENTS.md and harness; this Spur record tracks acceptance and cross-repository ordering. Record the exact upstream commit and verification commands in this task through spur task, never fabricate local product changes to satisfy requireDiff.
- requireDiff: source changes must be verified in the owning repository; documentation/evidence here is allowed tracking, not proof of upstream implementation. If the task pipeline cannot verify external source scope, use its explicit external-evidence path and report that limit before completion.
- No production mutations, releases, workflow edits, new toolchains or publication are included.

### Plan

1. Trace every caller and source adapter of ImportOptions/importer execution; document where writes and checkpoints begin/end and add a failing cancellation-after-start regression.
2. Thread the optional signal through the existing loops, await invocation-owned work, and preserve transaction/checkpoint invariants.
3. Test already-aborted input, abort during file/batch/transaction work, no post-rejection writes, dry-run behavior and resume from the last committed checkpoint; avoid timer-only tests that merely prove Promise.race returned.
4. Run focused importer tests, then upstream bun run spur-check and bun run build. Update importer README and upstream docs, and attach upstream commit/test evidence to this task without publishing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
