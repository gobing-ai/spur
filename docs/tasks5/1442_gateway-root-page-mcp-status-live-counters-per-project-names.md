---
schema_version: 1
name: "Gateway root page: MCP status, live counters, per-project namespaces and discover diagnostics"
status: todo
template: issue
created_at: 2026-11-23T00:56:05.442Z
updated_at: "2026-11-23T02:51:22.036Z"
feature_id: A82

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 5
---

## 1442. Gateway root page: MCP status, live counters, per-project namespaces and discover diagnostics

### Background

Task 1437 filed this as gap G5. The root gateway index renders the registry, routing mode and basic system information. `createProjectGateway` holds process-local routing counters and exposes them in `/api/health`; its MCP registry computes project namespaces and discovery diagnostics on demand. The index currently receives neither result.

**Refine corrections (2026-11-22)**
- “Live counters” describes the current process snapshot at each page load, following ADR-151 and the A82 scope barring live polling and persistence.
- Scope namespace/discovery inspection to gateway-root MCP. Keep the root page available when diagnostics cannot be resolved.
- The existing page has a project removal action that uses a request. The new system-info content is rendered on the server and performs no browser read.

### Requirements

- [ ] R1. On gateway `GET /`, show gateway MCP enablement, credential presence, the current routing counters, local project MCP namespaces and gateway discovery diagnostics.
- [ ] R2. Render this information as dependency-free HTML from the current gateway process, with an explicit unavailable state when discovery fails and a usable gateway index in every state.

Out of scope are new gateway endpoints, client polling, auto-starting project listeners, and gateway state persistence.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Gateway root renders the current routing and discovery snapshot (req: R1)
  Given a gateway with MCP mounted, recorded 4xx/5xx responses and upstream restart counts, two local projects claiming the same namespace and one remote project
  When an operator loads the gateway root
  Then the system info shows MCP state and credential presence, current counts, the local namespace assignments and the collision and remote-project reasons, while credential values are absent

Scenario: AC2 — Gateway index works with MCP off or discovery unavailable (req: R2)
  Given MCP is off or the discovery resolver fails
  When an operator opens the gateway root
  Then the root returns an operable HTML page with the applicable off or unavailable state, the routing counters and project links, without a new browser request
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-23T02:51:20.537Z

Closed during refinement. The root page samples completed request counters at render time using the same process snapshot semantics as `/api/health`. Surface display-safe discovery reason and remedy text; keep internal exception text out of the page.

### Design

In `packages/app/src/services/project-gateway.ts`, share the existing counter snapshot projection between health and index. When `deps.mcp` is mounted, reuse the gateway registry's `discoverExtras()` projection of `mcpRoutes` and `collidingNamespaces`; use the index's existing registry snapshot in the shared discovery path to keep displayed project rows and diagnostics consistent. Keep the protocol response shape and existing route order. Handle a read failure at the index boundary with a generic “Discovery unavailable” state, retaining the registry cards and counters. A disabled gateway shows its off state and avoids discovery reads.

Extend `GatewayIndexInput` and the existing system-info region in `project-gateway-html.ts` with typed data for MCP state, a routing snapshot, and discovery projects/diagnostics. Render request total, 4xx, 5xx, since and restart counts. Render null namespace as unassigned; use existing `escapeHtml` for dynamic values and display-safe remedies (omit raw exception detail and credential values). Retain the existing focus and dismissal behavior. No new public route, cache, ticker or project start/proxy call. ADR-151 and ADR-152 own statelessness and MCP routing; 1438 concerns project catalog diagnostics, a separate projection.

### Plan

- [ ] R1. Add an in-process HTTP route test to `packages/app/tests/services/project-gateway-mcp.test.ts` using local fixture manifests, a remote entry and known response counts; compare the rendered snapshot with the existing gateway health and discovery behavior.
- [ ] R2. Extend `packages/app/tests/services/project-gateway-html.test.ts` for escaped text and the disabled/unavailable popover states. Exercise the failure through the root handler and assert no upstream launch.
- [ ] R1–R2. Apply the shared projection and server-rendered markup. Run the gateway HTML and route suites and exercise the popover in a local browser with repeatable fixture evidence. Update the owning gateway/Integrations design satellite for the new root screen behavior.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
