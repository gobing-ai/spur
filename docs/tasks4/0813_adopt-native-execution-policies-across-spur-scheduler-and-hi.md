---
schema_version: 1
name: Adopt native execution policies across Spur scheduler and history jobs
status: todo
template: feature-impl
created_at: 2026-09-08T22:33:10.236Z
updated_at: "2026-09-08T22:35:57.291Z"
feature_id: A21
priority: P1
tags:
  - A21
  - execution-timeouts
  - adoption

dependencies: ["0810", "0811", "0812"]
---

## 0813. Adopt native execution policies across Spur scheduler and history jobs

### Background

Robin selected reusable upstream timeout control and an explicit unlimited mode on 2026-09-08. Feature A21 and ADR-112 define the scope; docs/design/execution-deadlines.md is the accepted design.

- Implements: R7 — Spur consumes one resolved native execution policy
- Implements: R8 — Unlimited execution reaches inherited history limits
- Implements: R10 — Existing consumers and configuration remain compatible
- Implements: R11 — Timeout cleanup permits another SQLite writer

- Owner: Spur apps/server/src/serve.ts and context.ts; packages/app/src/services/bounded-child-run.ts, scheduler-custom-job-service.ts, history-refresh-service.ts, history-service.ts and callers; apps/cli/src/commands/history.ts; relevant tests/exports and root catalog/lockfile when an approved compatible release exists. Owning docs/04_DESIGN.md, docs/03_ARCHITECTURE.md and design/execution-deadlines.md.
- Rubric: E6 D1 L3 C1 R1 = 12; independently verifiable deliverable, estimated 4–8 hours. Tests/docs stay in this task. Whole feature E23 D4 L5 C2 R2 = 36; split by reusable capability and release boundary, not by scenario.
- Evidence baseline: installed upstream 0.4.57 and read-only ts-libs checkout f01336f7b770219babaf62c2bde2f11ac9c1d86e; existing 65 focused Spur tests passed but do not prove the new contract.

### Requirements

- **R1** — Adopt the released ts-infra/ts-runtime/importer contracts and one resolved application policy, including actual grace propagation. Remove superseded caller watchdogs and age-only startup/periodic sweeping while preserving single-flight behavior.
- **R2** — Propagate explicit unlimited policy through queued history child/source defaults without a hidden ten-minute timer; explicit finite inner limits and finite ancestor cancellation still take precedence.
- **R3** — Preserve canonical-option-over-legacy precedence, independent refresh override behavior and the existing ten-minute Spur default. Normalize none once and reject malformed CLI input, including partial numbers, negative values and timer overflow, before importing.
- **R4** — Prove end-to-end native cleanup on a temporary SQLite writer and unlimited execution across prior timeout/visibility boundaries, with no duplicate execution, truthful whole-job outcomes and safe incremental resume.

### Acceptance Criteria

```gherkin
Feature: Adopt native execution policies across Spur scheduler and history jobs

  @core
  Scenario: R1 — Spur consumes one resolved native execution policy
    Given configured scheduler jobs and completion-triggered refreshes run in Spur
    When the server resolves configuration and registers handlers
    Then both handlers consume native policy with the same effective deadline and termination grace used by recovery
    And duplicated local timeout engines and age-only recovery of live attempts are removed

  @core
  Scenario: R2 — Unlimited execution reaches inherited history limits
    Given an operator explicitly selects unlimited execution for a history job
    When the job launches its child and default source imports
    Then the unlimited policy reaches inherited child and source limits without restoring the old default
    And an explicit finite inner limit or finite ancestor cancellation remains effective

  @core
  Scenario: R3 — Existing consumers and configuration remain compatible
    Given an existing upstream consumer omits the new policy or a Spur user uses existing overrides
    When configuration is loaded
    Then upstream omitted defaults preserve existing behavior and Spur preserves its documented finite default and legacy precedence
    And the existing history CLI accepts none and rejects malformed numeric limits before importing

  @core
  Scenario: R4 — Timeout cleanup permits another SQLite writer
    Given a nested child holds a temporary SQLite write transaction and ignores SIGTERM
    When its finite execution deadline triggers native process-tree cleanup
    Then the child and descendants exit within the deadline plus grace tolerance and a second connection can write
    And an aborted incremental import can resume safely from its last committed checkpoint
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Consume only published compatible upstream versions through the root catalog (ADR-004); implementation entry is gated on predecessor verification and operator-managed release availability. Do not invent a version or publish as part of this task. One small app policy owner translates old env/CLI inputs into native options; it must preserve explicit null by testing undefined, and resolve the daemon environment once. Canonical bootstrap scheduler/default/per-job options beat old env controls; custom per-name→custom global→600000 and refresh-specific→600000 retain separate fallback chains. Source CLI explicit→propagated job→standalone600000. Use native context/termination for both child handlers and pass parent policy to history daily/importAll. Remove the local Promise.race only when the importer can settle cancellation correctly; keep hard process isolation. Replace both age-only stale sweeps with native attempt ownership and preserve existing enqueue coalescing/exclusion. Update exports without an unrequested breaking public API. Cloudflare serve behavior and unrelated workflow/agent limits remain unchanged.

#### Decisions

- Follow ADR-112 and docs/design/execution-deadlines.md; null means unlimited, omitted inherits. Native mechanisms own lifecycle; no parallel Spur framework.
- Rejected: constant-only deduplication, -1 sentinels passed to timers, unbounded visibility leases and promise-race-only cancellation.
- Preserve concurrent changes; work in a clean isolated checkout for implementation and use only task-owned temporary processes/databases.

#### Dependencies and premises

All three upstream deliverables and a compatible published release are execution prerequisites, not satisfied facts. Specification readiness does not assert release availability. The two pre-existing serve.ts/serve.test.ts edits belong to earlier work and must be preserved/isolated at implementation start.

#### Execution budget and evidence

- Budget: 4–8 hours; checkpoint at the upper bound with changed-file/commit/test evidence, then resume against the same requirements.
- Ownership: Spur apps/server/src/serve.ts and context.ts; packages/app/src/services/bounded-child-run.ts, scheduler-custom-job-service.ts, history-refresh-service.ts, history-service.ts and callers; apps/cli/src/commands/history.ts; relevant tests/exports and root catalog/lockfile when an approved compatible release exists. Owning docs/04_DESIGN.md, docs/03_ARCHITECTURE.md and design/execution-deadlines.md.
- Upstream work follows upstream AGENTS.md and harness; this Spur record tracks acceptance and cross-repository ordering. Record the exact upstream commit and verification commands in this task through spur task, never fabricate local product changes to satisfy requireDiff.
- requireDiff: source changes must be verified in the owning repository; documentation/evidence here is allowed tracking, not proof of upstream implementation. If the task pipeline cannot verify external source scope, use its explicit external-evidence path and report that limit before completion.
- No production mutations, releases, workflow edits, new toolchains or publication are included.

### Plan

1. Verify all upstream predecessor commits/tests and a compatible published version; record binary/importer provenance. If the release is unavailable, preserve this task as pending with the specific external prerequisite instead of adding a local engine.
2. Adopt the approved release through catalog/lockfile and native bootstrap/enqueue/context options. Consolidate app defaults, legacy parsers and history CLI validation, keeping null/none semantics.
3. Wire cancellation/grace/parent budgets through both handlers and history import; replace stale/orphan age-only recovery with native ownership. Remove superseded implementation and stale descriptions.
4. Add focused CLI, server and application regressions for non-default grace, environment injection, finite/null inheritance, old overrides, native timeout outcomes and two-consumer unlimited execution. Use a nested child and temporary SQLite DB for cleanup/resume evidence; never replay production jobs.
5. Update surface/architecture docs with shipped versions and migration examples; apply sp-doc-evolve sync-check. Run affected tests, then the required Spur final gates once (spur-check, test-cf, build, appropriate linking/bundle refresh for CLI source changes). Record failures separately and commit only this task's changes.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
