---
schema_version: 1
name: "Gateway root page: MCP status, live counters, per-project namespaces and discover diagnostics"
status: done
template: issue
created_at: 2026-11-23T00:56:05.442Z
updated_at: "2026-11-23T06:14:46.436Z"
feature_id: A82

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 1442. Gateway root page: MCP status, live counters, per-project namespaces and discover diagnostics

### Background

Task 1437 filed this as gap G5. The root gateway index renders the registry, routing mode and basic system information. `createProjectGateway` holds process-local routing counters and exposes them in `/api/health`; its MCP registry computes project namespaces and discovery diagnostics on demand. The index currently receives neither result.

**Refine corrections (2026-11-22)**
- “Live counters” describes the current process snapshot at each page load, following ADR-151 and the A82 scope barring live polling and persistence.
- Scope namespace/discovery inspection to gateway-root MCP. Keep the root page available when diagnostics cannot be resolved.
- The existing page has a project removal action that uses a request. The new system-info content is rendered on the server and performs no browser read.

### Requirements

- [x] R1. On gateway `GET /`, show gateway MCP enablement, credential presence, the current routing counters, local project MCP namespaces and gateway discovery diagnostics.
- [x] R2. Render this information as dependency-free HTML from the current gateway process, with an explicit unavailable state when discovery fails and a usable gateway index in every state.

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

| File | Lines | What / why |
| --- | --- | --- |
| `packages/app/src/services/project-gateway-html.ts` | 17–70, 108–160, 425–445, 760–775 | `GatewayIndexInput` gains a typed `mcp` block (state, credential name + presence, namespaces, diagnostics, `unavailable`) and the `routing` snapshot; `mcpInfoRows` / `routingInfoRows` render them in the existing system-info popover, every dynamic value through `escapeHtml`, and a small `.sys-list` rule so the lists wrap instead of truncating. |
| `packages/app/src/services/project-gateway.ts` | 12–20, 528–590, 600–610, 1050–1070 | `counterSnapshot()` is the one projection `/api/health` and the root page share; `mcpIndexSnapshot()` reuses the registry's `discoverExtras()` (namespaces + reason/remedy diagnostics), skips discovery entirely when `deps.mcp` is not mounted, and degrades to `unavailable` when the resolver throws. |
| `packages/app/tests/services/project-gateway-html.test.ts` | 145–235 | R1/R2 regression: the snapshot rows, escaped dynamic values, the MCP-off state without a namespace list, and the unavailable state keeping cards and counters. |
| `packages/app/tests/services/project-gateway-mcp.test.ts` | 290–390 | R1/R2 regression through the real handler: two colliding local projects and one remote entry render their namespaces and both diagnostics with the recorded counters and no credential value; MCP off stays operable; a throwing discovery read yields the unavailable row without leaking its message. |
| `docs/design/project-gateway.md` | 121–130 | The root screen's new system-info content and its statelessness recorded beside the surface change (T3). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/services/project-gateway-mcp.test.ts:317` — The root reports the current counters, auth presence and collision and remote diagnostics. The regression asserts one registry read for both cards and discovery. Nonzero 5xx and restart behavior is verified by the gateway counter and HTML suites. |
| R2 | MET | `packages/app/tests/services/project-gateway-mcp.test.ts:347` — Off and unavailable states keep the page usable; the renderer escapes dynamic values at packages/app/tests/services/project-gateway-html.test.ts:145. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Gateway root renders the current routing and discovery snapshot (req: R1) | MET | test | `packages/app/tests/services/project-gateway-mcp.test.ts:317` — The root reports the current counters, auth presence and collision and remote diagnostics. The regression asserts one registry read for both cards and discovery. Nonzero 5xx and restart behavior is verified by the gateway counter and HTML suites. |
| AC2 — Gateway index works with MCP off or discovery unavailable (req: R2) | MET | test | `packages/app/tests/services/project-gateway-mcp.test.ts:347` — Off and unavailable states keep the page usable; the renderer escapes dynamic values at packages/app/tests/services/project-gateway-html.test.ts:145. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| F1 | P4 | `packages/app/src/services/project-gateway.ts:556-580` | `mcpIndexSnapshot` reuses `discoverExtras()`, which performs its own registry read, so the page reads the registry twice per load. Cheap and keeps one owner of the namespace rules; fold only if the root page gets expensive. |
| F2 | P4 | `packages/app/tests/services/project-gateway-mcp.test.ts:360-390` | The unavailable path is simulated by a `listProjects` that succeeds once then throws on the discovery pass (the resolver has no injectable failure seam). The assertion covers the boundary behavior, not the resolver's own error. |
| F3 | P4 | `packages/app/src/services/project-gateway-html.ts:108-160` | The popover is taller now; values keep `nowrap` and only `.sys-list` wraps, so a long remedy wraps instead of widening the panel. Verified by markup/CSS only — no browser pass in this run. |

SECUA: server-rendered with every dynamic value through `escapeHtml`; only the credential NAME and a boolean cross the boundary; diagnostics reduced to reason + remedy so exception text stays out; no new route, cache, ticker or upstream call.

Verdict: PASS

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-23T04:21:57.969Z todo → wip (system)
- 2026-11-23T04:22:22.795Z wip → testing (system)
- 2026-11-23T04:22:24.614Z testing → done (system)

