---
template: feature-impl
schema_version: 1
name: "Job worker loop, handler registry, serve lifecycle wiring (0190 wave A)"
description: ""
status: todo
type: task
profile: standard
feature_id: A2
parent_wbs: "0190"
priority: P1
tags: ["approach-c", "server", "infra", "subtask"]
dependencies: []
created_at: "2026-07-04T04:13:23.850Z"
updated_at: "2026-07-04T07:11:32.637Z"
---

## 0200. Job worker loop, handler registry, serve lifecycle wiring (0190 wave A)

### Background

Wave A of parent 0190 (job queue enablement) — read the parent's Background and Design first; its upstream-audit step (ts-db `QueueJobDao` / ts-infra `DBJobQueue` consumer surface) belongs to THIS slice and must run before coding. Delivers the consumer half: `JobWorkerService` + `JobHandlerRegistry` in `packages/app` (injected pollMs/clock, claim → dispatch → complete/fail, unknown kind fails loud, stop releases in-flight), and the Bun-path serve wiring (`jobQueueEnabled: true`, worker start/stop in lifecycle, shutdown ordering). Cloudflare stays untouched (NotConfigured).

### Requirements
- [ ] R1. Upstream audit recorded in parent Design: claim/complete/fail/release surface of the resolved ts-db/ts-infra packages; smallest ts-libs enhancement if insufficient (never raw SQL in Spur outside packages/domain). (Parent Design)
- [ ] R2. `JobHandlerRegistry` + `JobWorkerService` with injected interval/clock; tests: execute-to-completed, unknown-kind→failed-loud, stop-releases-in-flight; no real sleeps. (Parent R1, R2, R7)
- [ ] R3. Serve wiring Bun path: enable queue, registry built at bootstrap, worker start/stop in lifecycle with correct shutdown order. (Parent R3)
- [ ] R4. CF no-op proven by `bun run test-cf`; full gate green. (Parent R3, R8)
### Acceptance Criteria
```gherkin
Feature: Embedded job queue and scheduler

  Scenario: Worker executes an enqueued job
    Given spur serve is running on Bun with the queue enabled
    When a job with a registered handler kind is enqueued
    Then the handler executes and the queue_jobs row reaches a terminal completed status

  Scenario: Unknown job kind fails loud
    Given a job whose kind has no registered handler
    When the worker claims it
    Then the job is marked failed with an error message naming the unknown kind

  Scenario: Graceful shutdown never orphans a claimed job
    Given a worker with a job in flight
    When the server receives a shutdown signal
    Then the worker loop stops and the in-flight job is completed or released back to pending

  Scenario: Cloudflare entrypoint is unaffected
    Given the Cloudflare Workers entrypoint
    When the worker boots
    Then no queue or scheduler starts and health plus OpenAPI endpoints still serve
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0190's Design owns the full approach — this slice implements its **Upstream check**, **Worker**, **Registry**, and the worker half of **Serve wiring**: audit the resolved ts-db `QueueJobDao` / ts-infra `DBJobQueue` `.d.ts` FIRST (claim/complete/fail/release; smallest ts-libs enhancement if missing — record findings in parent Design); `JobWorkerService` + `JobHandlerRegistry` in `packages/app` with injected pollMs/clock (no test sleeps); Bun-path enable (`jobQueueEnabled: true`) + worker start/stop in serve lifecycle with correct shutdown ordering; CF untouched. Keep handler typing pragmatic (per-handler zod parse over generic type-map machinery). Depends on: nothing (can start with 0198 in parallel). Blocks: 0201.
### Plan
- [ ] Upstream `.d.ts` audit; record in parent 0190 Design; ts-libs enhancement + catalog bump only if genuinely missing (R1).
- [ ] `JobHandlerRegistry` + `JobWorkerService` with injected interval/clock; tests: execute, unknown-kind fail-loud, stop-releases-in-flight (R2).
- [ ] Serve wiring: enable queue, registry at bootstrap, worker lifecycle + shutdown ordering test (R3).
- [ ] CF no-op via `bun run test-cf`; gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R4).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

A2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
