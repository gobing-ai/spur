---
schema_version: 1
name: Fix protocol release regressions found during repository review
status: done
template: issue
created_at: 2026-11-19T06:08:48.639Z
updated_at: "2026-11-19T06:22:31.074Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 1405. Fix protocol release regressions found during repository review

### Background

Captured from the creation title: "Fix protocol release regressions found during repository review".

### Requirements

- [x] R1. Route gateway MCP calls to the mounted project endpoint over supported loopback families, preserving guarded errors.
- [x] R2. Preserve one daily-summary row per project and count all retained events in the covered day.
- [x] R3. Retire the boot-free top-level aliases, migrate the restart caller, and keep generated coverage out of Git.
- [x] R4. Resolve server planning folders from the served project root.
- [x] R5. Settle failed A2A card resolution through the existing inbox and receipt path.

- [x] R6. Preserve the Board facade default export fallback without invalid static lookups.

- [x] R7. Preserve the old batch schedule spelling in its one-release redirect and use the canonical command in current architecture guidance.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Gateway calls reach the mounted endpoint and preserve guard refusals (req: R1)
  Given a registered project serves MCP on loopback
  When a client calls the root gateway MCP
  Then it reaches the project endpoint on either loopback family and receives project guard details

Scenario: AC2 — Daily counts span all retained pages and preserve registrations (req: R2)
  Given two projects share a name and one has more than 50 events today
  When the daily view reads the registry and history
  Then it renders both rows in registry order and counts every retained event since day start

Scenario: AC3 — The CLI exposes the canonical spellings and excludes coverage output (req: R3)
  Given the release retires the legacy commands
  When the CLI is invoked or a developer checks the coverage path
  Then the old aliases are rejected, the restart script uses self serve, and generated coverage is ignored

Scenario: AC4 — Planning writes stay in the selected project (req: R4)
  Given the server process has a different working directory from the selected project
  When a gateway tool creates a task
  Then the task and the returned path belong to the selected project's corpus

Scenario: AC5 — Failed address resolution settles the claim (req: R5)
  Given two inbox claims and a target whose address lookup fails on the first request
  When the transport handles the claims
  Then the first claim settles without a remote send and the second claim completes
```

```gherkin
Scenario: AC6 — Board facades preserve their default fallback through the production build (req: R6)
  Given the Board imports a named-only host module
  When it generates and bundles that module's facade
  Then the facade retains the namespace fallback and the build emits no missing-default warning
```

```gherkin
Scenario: AC7 — Batch schedule stays compatible through the deprecated redirect (req: R7)
  Given an existing caller still uses the old batch command
  When it supplies its old schedule flag
  Then the redirect translates that flag for the current batch operation and preserves the rest
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [x] Trace gateway and per-project transports against the same route contract.
- [x] Reproduce bad routing, corpus paths, event totals, alias dispatch, and failed A2A claims.
- [x] Fix the shared entry points and rerun the regression tests.

### Root Cause

The gateway sent a browser-prefixed URL directly to a project server and dialed IPv4 only. It discarded structured refusals based on the HTTP status before parsing the MCP response. Server context passed project-relative corpus folders to operations that read and write relative to the process. The daily summary keyed rows by display name and read one bounded page. CLI early dispatch still recognized retired forms. A2A card resolution ran before the existing claim settlement path.

The Board facade generator emitted static default property references for named-only modules.

### Solution

Reuse the gateway loopback dialer for project MCP calls, anchor server planning folders to the selected project, keep daily rows in registry order while following history cursors, use canonical CLI dispatch, exclude generated domain coverage, and resolve A2A cards inside the claim settlement block.

The Board generator looks up an optional default on the loaded namespace, preserving its namespace fallback.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/tests/gateway-mcp-routing.test.ts` passes on IPv4 and IPv6. `apps/server/tests/mcp-e2e.test.ts` passes the real root gateway guard refusal. |
| R2 | MET | `packages/app/tests/services/projects-summary.test.ts` passes the duplicate-name and 57-event fixture. |
| R3 | MET | `apps/cli/tests/self-noun-only.test.ts`, `apps/cli/tests/commands/serve-gateway.heavy.test.ts` and `git check-ignore packages/domain/coverage/lcov.info` pass. `package.json` calls self serve. |
| R4 | MET | `apps/server/tests/mcp-e2e.test.ts` creates a real task in the selected corpus with the runner in a different directory. |
| R5 | MET | `packages/app/tests/services/a2a-member-transport.test.ts` verifies a failed lookup settles and another claim completes. |
| R6 | MET | `apps/web/tests/modules/runtime/manifest.test.ts` and the production Board build pass. The build emits no missing-default warning. |
| R7 | MET | `plugins/sp/tests/command-flag-parity.test.ts` passes the one-release redirect contract and `docs/03_ARCHITECTURE.md` names the replacement. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/server/tests/gateway-mcp-routing.test.ts` and `apps/server/tests/mcp-e2e.test.ts` |
| AC2 | MET | test | `packages/app/tests/services/projects-summary.test.ts` |
| AC3 | MET | test | `apps/cli/tests/self-noun-only.test.ts`, `apps/cli/tests/commands/serve-gateway.heavy.test.ts` and `git check-ignore packages/domain/coverage/lcov.info` |
| AC4 | MET | test | `apps/server/tests/mcp-e2e.test.ts` |
| AC5 | MET | test | `packages/app/tests/services/a2a-member-transport.test.ts` |
| AC6 | MET | test | `apps/web/tests/modules/runtime/manifest.test.ts`, `apps/web/tests/modules/board-runtime-browser.heavy.test.ts` and `bun run --filter @gobing-ai/spur-web build` |
| AC7 | MET | test | `plugins/sp/tests/command-flag-parity.test.ts` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P1 (blocker) | Project-relative corpus writes could land in the server process working directory. | `apps/server/src/context.ts` | FIXED |
| P2 (major) | Gateway sent calls to the public URL instead of the project endpoint, only dialed IPv4, and hid transition refusals. | `packages/app/src/services/project-gateway.ts` | FIXED |
| P2 (major) | Daily summary collapsed same-name registry entries and counted one event page. | `packages/app/src/services/projects-summary.ts` | FIXED |
| P2 (major) | A2A resolution errors escaped claim settlement and aborted a claim batch. | `packages/app/src/services/a2a-member-transport.ts` | FIXED |
| P3 (minor) | Early CLI dispatch accepted retired spellings, and the restart script and heavy test still invoked one. | `apps/cli/src/index.ts`, `package.json`, `apps/cli/tests/commands/serve-gateway.heavy.test.ts` | FIXED |
| P3 (minor) | The release tracked generated code coverage. | `.gitignore` | FIXED |
| P3 (minor) | Board facade generation attempted static access to missing default exports. | `apps/web/src/modules/runtime/manifest.ts` | FIXED |
| P3 (minor) | The deprecated batch redirect forwarded the former schedule flag without mapping it. | `plugins/sp/commands/dev-runall.md` | FIXED |

#### Follow-up candidates

1. Share the gateway and project MCP workflow inventory. The gateway scans the plugin manifest and project workflow directory while the project server also uses its configured namespace and registered layers. Preserve discovery without starting projects.
2. Register boot-free CLI command paths once. Both the full Commander tree and the early dispatch must currently change for a command retirement.
3. Count daily events in the ledger query and fetch the five latest rows independently. The current bounded pagination reads event payloads for every counted row.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-19T06:12:28.742Z todo → wip (system)
- 2026-11-19T06:15:04.492Z wip → testing (system)
- 2026-11-19T06:22:31.067Z testing → done (system)

