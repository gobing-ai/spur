---
schema_version: 1
name: Inbox oRPC contract and server handler
status: todo
template: feature-impl
created_at: 2026-10-20T06:59:42.645Z
updated_at: "2026-10-20T07:00:33.604Z"
feature_id: G11
priority: P1
tags:
  - inbox

dependencies: ["1266"]
---

## 1267. Inbox oRPC contract and server handler

### Background

Plan: docs/plans/2026-10-19-inbox-module-refactor.md §3.2; ADR-143.

Sizing: about 4h; contract plus handler is one review surface.

Implements: R9 — The inbox API is a typed contract with read-only reads.

Depends on: Inbox domain schema and InboxService as the single writer.

### Requirements

- [ ] R1. Add an inbox oRPC contract in `packages/contracts` (list, thread, send, reply, read, requests) using transport DTOs only.
- [ ] R2. Implement the server handler with `implement(contract)` over InboxService.
- [ ] R3. Delete `apps/server/src/modules/messages` and the `/api/project/requests` block in the health module; reads perform no writes, and guest expiry plus the claim sweep run in the reconciler pass.
- [ ] R4. `message.*` SSE events still reach the planning stream.

### Acceptance Criteria

- [ ] AC1 — The inbox API is a typed contract with read-only reads

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: a new `inbox` contract router mounted beside the existing oRPC routers; the generated OpenAPI is regenerated.
Rejected: keeping the Hono routes as aliases (A6: no compat shims).
Invariants: domain types do not enter contracts; GET-shaped procedures are side-effect free.

### Plan

1. E2E: round-trip each procedure through OpenAPILink; assert that list/thread write nothing and the old routes 404.
2. Contract and handler.
3. Delete the old routes; move expiry and sweep to the reconciler.
4. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
