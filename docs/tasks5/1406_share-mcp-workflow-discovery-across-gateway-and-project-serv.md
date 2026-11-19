---
schema_version: 1
name: Share MCP workflow discovery across gateway and project servers
status: done
template: issue
created_at: 2026-11-19T21:56:44.212Z
updated_at: "2026-11-19T22:00:38.597Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 1406. Share MCP workflow discovery across gateway and project servers

### Background

Captured from the creation title: "Share MCP workflow discovery across gateway and project servers".

### Requirements

- [x] R1. Discover opted-in tools using the same workflow layers and descriptor on both MCP surfaces.
- [x] R2. Use the configured namespace with manifest fallback without starting projects for discovery.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Both MCP surfaces expose the same registered workflow descriptor (req: R1)
  Given a project config registers a workflow folder and a definition opts in
  When a client lists its workflow tools through the gateway and the project endpoint
  Then both describe the same tool name, defaults and argument constraints

Scenario: AC2 — Offline discovery honors the namespace without starting the project (req: R2)
  Given the gateway and project are configured with the same namespace override
  When a client discovers tools for the stopped project and then calls one
  Then discovery uses the override without a start and the first call starts the project and succeeds
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [x] Trace project and gateway workflow discovery and compare the declared tool schemas.
- [x] Reproduce missing registered tools with a real gateway and project endpoint.
- [x] Use one ruleset for workflow layers and descriptors, then verify the normal entry points.

### Root Cause

Gateway discovery read only the legacy project config directory and synthesized a separate argument schema. The embedded MCP handler expected the merged Spur config on its context, but context creation never exposed it.

### Solution

Thread the merged project config through the server context and inject the config loader from the CLI composition root. Reuse one project, registered and shared inventory and one descriptor builder in both MCP endpoints and workflow validation. The gateway uses its namespace override with per-project manifest fallback.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/tests/mcp-e2e.test.ts` verifies matching real endpoint descriptors and successful invocation for a registered workflow. |
| R2 | MET | `apps/server/tests/mcp-e2e.test.ts` verifies offline discovery honors the override and the first call starts the project. `apps/server/tests/gateway-mcp-routing.test.ts` verifies manifest fallback. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/server/tests/mcp-e2e.test.ts` |
| AC2 | MET | test | `apps/server/tests/mcp-e2e.test.ts` and `apps/server/tests/gateway-mcp-routing.test.ts` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P3 (minor) | Offline discovery needs the same environment as a separately launched project. | `docs/design/project-gateway.md` | DEFER(offline discovery cannot inspect an adopted process environment) |
| P4 (advisory) | Discovery and invocation use one descriptor and one inventory, and the gateway still starts projects only on call. | `apps/server/tests/mcp-e2e.test.ts` | ACCEPTED |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-19T21:59:50.955Z todo → wip (system)
- 2026-11-19T22:00:22.821Z wip → testing (system)
- 2026-11-19T22:00:38.593Z testing → done (system)

