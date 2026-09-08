---
schema_version: 1
name: Move process-tree deadline and cancellation containment into ts-runtime
status: todo
template: feature-impl
created_at: 2026-09-08T22:33:10.231Z
updated_at: "2026-09-08T22:34:23.504Z"
feature_id: A21
priority: P1
tags:
  - A21
  - execution-timeouts
  - upstream

---

## 0810. Move process-tree deadline and cancellation containment into ts-runtime

### Background

Robin selected reusable upstream timeout control and an explicit unlimited mode on 2026-09-08. Feature A21 and ADR-112 define the scope; docs/design/execution-deadlines.md is the accepted design.

- Implements: R3 — Process cancellation reaps the complete child tree

- Owner: Upstream /Users/robin/xprojects/ts-libs: packages/runtime/src/process-executor.ts, its option/result types, packages/runtime/tests, package README and owning upstream design docs. Spur tracking evidence only; no Spur source implementation.
- Rubric: E5 D1 L1 C1 R2 = 10; independently verifiable deliverable, estimated 4–6 hours. Tests/docs stay in this task. Whole feature E23 D4 L5 C2 R2 = 36; split by reusable capability and release boundary, not by scenario.
- Evidence baseline: installed upstream 0.4.57 and read-only ts-libs checkout f01336f7b770219babaf62c2bde2f11ac9c1d86e; existing 65 focused Spur tests passed but do not prove the new contract.

### Requirements

- **R1** — Extend the existing native ProcessExecutor path so finite timeout, explicit unlimited, external abort and normal exit compose without competing caller watchdogs; preserve existing omitted/default behavior and distinguish the termination reason. Reap owned Unix descendants after SIGTERM-to-SIGKILL grace, including a leader that exits first and descendants retaining pipes or a temporary SQLite write transaction; completion must permit lock reacquisition within a measured tolerance.

### Acceptance Criteria

```gherkin
Feature: Move process-tree deadline and cancellation containment into ts-runtime

  @core
  Scenario: R1 — Process cancellation reaps the complete child tree
    Given a shell descendant ignores SIGTERM and retains inherited output pipes
    When the process execution is cancelled or its finite deadline expires
    Then the native runtime escalates after the configured grace and reaps the owned process group
    And the result distinguishes timeout from external cancellation, signal, and normal exit
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Keep lifecycle machinery in the existing ProcessExecutor implementation; do not create an application-specific scheduler executor. Add backwards-compatible optional timeout/grace/outcome fields through the native facade, preserving explicit null versus omitted defaults. Supplied parent cancellation remains effective for unlimited local execution. One termination path owns group isolation, SIGTERM, escalation, output draining and final outcome; a parent context supplies the deadline rather than requiring Spur to race a second timer. Never cancel descendant escalation solely because the direct child exited. On unsupported platforms keep existing behavior explicit and do not promise Unix group semantics. Use the existing optional ProcessOptions.signal and onSpawn seams as the starting point, verified in installed/upstream 0.4.57; new signatures are designed here and must be implemented before callers use them.

#### Decisions

- Follow ADR-112 and docs/design/execution-deadlines.md; null means unlimited, omitted inherits. Native mechanisms own lifecycle; no parallel Spur framework.
- Rejected: constant-only deduplication, -1 sentinels passed to timers, unbounded visibility leases and promise-race-only cancellation.
- Preserve concurrent changes; work in a clean isolated checkout for implementation and use only task-owned temporary processes/databases.

#### Dependencies and premises

The current installed and clean upstream 0.4.57 implementation only sends group SIGTERM for signal cancellation and does not provide equivalent group escalation. Recheck this at implementation start and reuse a newly available native capability instead of duplicating it.

#### Execution budget and evidence

- Budget: 4–6 hours; checkpoint at the upper bound with changed-file/commit/test evidence, then resume against the same requirements.
- Ownership: Upstream /Users/robin/xprojects/ts-libs: packages/runtime/src/process-executor.ts, its option/result types, packages/runtime/tests, package README and owning upstream design docs. Spur tracking evidence only; no Spur source implementation.
- Upstream work follows upstream AGENTS.md and harness; this Spur record tracks acceptance and cross-repository ordering. Record the exact upstream commit and verification commands in this task through spur task, never fabricate local product changes to satisfy requireDiff.
- requireDiff: source changes must be verified in the owning repository; documentation/evidence here is allowed tracking, not proof of upstream implementation. If the task pipeline cannot verify external source scope, use its explicit external-evidence path and report that limit before completion.
- No production mutations, releases, workflow edits, new toolchains or publication are included.

### Plan

1. Read upstream AGENTS.md, ADRs and native process executor tests; record git baseline and source/lockfile version. Reproduce descendant/pipe/SQLite cleanup failure using task-owned temporary processes and database files.
2. Add the minimum compatible native timeout/null/grace/cancellation outcome contract and implement one group termination lifecycle in packages/runtime.
3. Add deterministic unit cases and a real nested TERM-resistant child test, waiting for a readiness handshake before expiry; verify group exit, output settlement and another SQLite writer succeeds.
4. Run focused runtime tests, then upstream bun run spur-check and bun run build. Update runtime README and upstream authority/design docs; attach upstream commit SHA, command provenance and results to this Spur record. Do not publish.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
