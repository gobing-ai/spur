---
schema_version: 1
name: "Integrations fix handoff: finish gate, restart live server, close A82 gaps"
status: done
template: issue
created_at: 2026-11-22T23:53:57.100Z
updated_at: "2026-11-23T01:32:33.463Z"
feature_id: A82

done_forced: "false"
done_reason: unforced close
---

## 1437. Integrations fix handoff: finish gate, restart live server, close A82 gaps

### Background

Handoff from the 2026-11-22 session (Integrations Board module, feature A82).

**Symptom.** `http://localhost:3000/spur-new/board/integrations` rendered "The integrations status could not be read / events/history answered 400".

**Root cause (live-probed).** The gateway (`localhost:3000`) routed `/spur-new/` to a stale **v0.4.37** `spur self serve` process (uptime ~5.2 days) while `dist/web` had been rebuilt at **v0.4.43**. The old server rejected `prefix=mcp|a2a|auth` (`UNKNOWN_PREFIX`), returned 404 for `/api/integrations/status|usage`, and 400 for `/api/inbox/requests?limit=100`. `useIntegrations`'s `Promise.all` surfaced the first rejection.

**Code defects fixed in the working tree (UNCOMMITTED):**
- `packages/contracts/src/inbox.ts` — `inboxRequestsInputSchema.scope?: 'orchestrator' | 'all'`.
- `apps/server/src/modules/inbox/handlers.ts` — `scope: 'all'` scans every member (skips the orchestrator-only early return).
- `packages/app/src/services/integrations-service.ts` — `forwardedProto` honored in the caller base URL; disabled members omitted from the A2A inbound list.
- `apps/server/src/modules/integrations/handlers.ts` — passes `x-forwarded-proto`; gateway port from `SPUR_GATEWAY_PORT` (default 3000). `SpurConfig` has no `server` section — do not read `ctx.spurConfig.server`.
- `apps/web/src/modules/integrations/helpers.ts` — `inboxLink`/`systemEventLink` wrapped in `withBase()` (were escaping the `/spur-new/` prefix); `allSurfacesOff()` respects gateway MCP and A2A outbound.
- `apps/web/src/modules/integrations/useIntegrations.ts` — requests `{ limit: 100, scope: 'all' }`; events/history error includes the server `error` detail.
- `apps/web/src/modules/integrations/A2aTab.tsx` — card URL is a link only when `status.a2a.enabled`.
- `apps/web/src/modules/observability/SystemEventsTab.tsx` — `applyNavIntentToFilter()` applies `eventName` deep links even without `runId` (initial state and effect).
- Regression tests in: `apps/server/tests/modules/inbox/handlers.test.ts`, `apps/server/tests/modules/integrations/handlers.test.ts`, `packages/app/tests/services/integrations-service.test.ts`, `apps/web/tests/modules/integrations/{helpers,useIntegrations}.test.ts`, `apps/web/tests/modules/integrations/integrations-module.test.tsx`, `apps/web/tests/modules/observability/url-seed.test.ts`.

**Verified so far.**
- Focused tests: contracts 99 pass/0 fail; app integrations-service 14/0; server integrations+inbox 39/0; web integrations+observability 97/0.
- `bun run build` exit 0.
- `bun run spur-check`: Biome clean, all workspace typechecks clean, pre-check 52 rules pass; tests **13159 pass / 1 fail** — `scripts/commands/fleet-e2e-turn-perf.test.ts` › "G74 R1: paired cold, resume and warm work validates one workload and retains a rejected artifact" timed out at 30000ms. Unknown whether a load flake or regression; `test-post-check` did not run.
- Live server NOT yet restarted; live probes NOT yet re-run.

**Constraints.**
- Corpus writes only via `spur task` / `spur feature`.
- Root `bun run` scripts using `--filter` fail inside the agent sandbox (`CouldntReadCurrentDirectory`); run them outside the sandbox.
- `.spur/config.yaml` leaves `server.mcp.enabled` / `server.a2a.enabled` off — surfaces showing "off" live is expected.

### Requirements

- [x] R1. Determine whether the `scripts/commands/fleet-e2e-turn-perf.test.ts` timeout is related to these changes (rerun in isolation; if it still fails, compare against a stashed-tree baseline). Fix if related; otherwise record as pre-existing flake with evidence.
- [x] R2. `bun run spur-check` exits 0, including `test-post-check`.
- [x] R3. Restart the live `spur-new` server on v0.4.43 via the monorepo CLI (`bun run apps/cli/src/index.ts projects stop spur-new`, then `projects start spur-new`; `resolveSpurServeCommand()` at `packages/app/src/services/project-start.ts:214` spawns argv1 = monorepo CLI, not the global v0.4.37 `~/.bun/bin/spur`). Through `http://localhost:3000` all return 200: `/spur-new/api/health` (version 0.4.43), `/spur-new/api/integrations/status`, `/spur-new/api/integrations/usage`, `/spur-new/api/events/history?prefix=mcp&limit=5` (also `a2a`, `auth`), `/spur-new/api/inbox/requests?limit=100&scope=all`, and `/spur-new/board/integrations` (HTML with `<meta name="spur-base" content="/spur-new/">`). Browser-check the module renders without the error panel.
- [x] R4. Re-run `scripts/commands/integrations-e2e.ts` and regenerate `docs/reports/integrations-e2e-receipt.json` (currently committed with `"verdict": "FAIL"` on `/api/inbox/requests?limit=100` → 400).
- [x] R5. Commit the fix as an atomic conventional commit (`fix(integrations): …`), then run `spur feature verify A82` (feature carried `L4.feature-receipt-failed`).
- [x] R6. Surface server runtime identity (version, uptime) in the Integrations module or Board shell so a stale-server vs fresh-`dist/web` skew is visible instead of an opaque 400 (prevents recurrence).
- [x] R7. File follow-up tasks (via `spur task create --feature A82` or a new feature) for design gaps G1–G5 listed in Design.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Follow-up scope — gaps vs. the original Integrations design proposal (R7).**

- **G1. MCP namespace and exposure diagnostics.** `integrationsMcpSurfaceSchema` (`packages/contracts/src/integrations.ts`) lacks `namespace`, `namespaceSource`, `exposureIssues`. `resolveExposedWorkflowTools` already returns `issues: McpExposureIssue[]` (`packages/app/src/services/mcp-workflow-tools.ts`) but `readMcpCatalog` (`apps/server/src/modules/mcp/index.ts`) drops them. `McpTab.tsx` has no tool search, no `spur mcp` / `spur mcp --gateway` stdio snippets, no `server/discover` curl probe.
- **G2. Unrendered telemetry.** `integrations.usage` returns per-tool p50/p95, resources, byActor, per-member A2A counts, authDenied reasons, and failureClusters (`packages/domain/src/analytics/protocol-usage.ts`); `SummaryTab.tsx` only sums aggregates and `McpTab`/`A2aTab` render none. Observability `PREFIX_COLORS` (`apps/web/src/modules/observability/SummaryTab.tsx`) and `PREFIX_COLOR_MAP` (`SystemEventsTab.tsx`) lack `mcp`, `a2a`, `auth`.
- **G3. A2A inspection.** No inline Agent Card JSON, no `a2a card get` / `a2a send` snippets; outbound lacks `authEnv`/`tokenPresent` (`integrationsOutboundMemberSchema`) and remote task/context/branch refs; no trace deep link; no empty-fleet warning when `a2a.enabled && inbound.length === 0`.
- **G4. Contextual bridges.** `ResolvedFleetMember` (`apps/web/src/modules/projects/useProjectContext.tsx`) lacks A2A/project fields, so Settings › Agents and Projects › Processes cannot badge A2A/cross-project members; Settings › Workflows does not badge `metadata.mcp.expose: true`.
- **G5. Gateway root page.** The system-info popover in `packages/app/src/services/project-gateway-html.ts` shows no gateway MCP status, live counters, per-project namespaces, or `discoverExtras()` diagnostics.

### Plan

1. Rerun `scripts/commands/fleet-e2e-turn-perf.test.ts` in isolation; if it fails, establish a stashed-tree baseline; fix or document (R1).
2. `bun run spur-check` → exit 0 (R2).
3. Restart `spur-new` via the monorepo CLI; run the live probe list and browser-check `/spur-new/board/integrations` (R3).
4. Re-run integrations E2E; regenerate the receipt with PASS (R4).
5. Commit `fix(integrations): …`; `spur feature verify A82` (R5).
6. Add server version/uptime to the Integrations shell, failure cases first (R6).
7. File follow-up tasks for G1–G5 (R7).

### Root Cause

1. **Live server/bundle version skew:** `http://localhost:3000/spur-new/api/health` returned `version: "0.4.37"` (`uptime_seconds: 452045`, ~5.2 days old) while repo HEAD and `dist/web/` were built at `0.4.43`. Because the Gateway LaunchAgent uses `AbandonProcessGroup: true`, it kept routing `/spur-new/*` to the stale `0.4.37` daemon, which lacked the `mcp`/`a2a`/`auth` event prefixes (`HTTP 400 UNKNOWN_PREFIX` on `/api/events/history`), lacked `/api/integrations/status` and `/api/integrations/usage` (`HTTP 404`), and rejected `/api/inbox/requests?limit=100` (`HTTP 400`).
2. **Code defects in `v0.4.43` A82 implementation:**
   - `apps/server/src/modules/inbox/handlers.ts:233-249`: `inbox.requests` without `messageId` early-returned `[]` when no orchestrator was bound or filtered strictly to `orchestratorId`, dropping non-orchestrator A2A tasks and outbound receipts (`useIntegrations.ts:85`).
   - `apps/web/src/modules/observability/SystemEventsTab.tsx:557-579,785-792`: `navIntent` handling ignored `eventName` when `runId` was absent, dropping deep-link filters from Integrations (`?tab=system-events&eventName=...`).
   - `apps/web/src/modules/integrations/helpers.ts:84-94,138-144`: `inboxLink()` and `systemEventLink()` omitted `withBase()`, breaking gateway-prefixed links; `allSurfacesOff()` ignored `gateway.mcp.enabled` and non-empty `a2a.outbound`.
   - `packages/app/src/services/integrations-service.ts:68-107,216-225` and `apps/server/src/modules/integrations/handlers.ts:135-144`: ignored `x-forwarded-proto` behind TLS reverse proxies and included disabled fleet members (`enabled: false`) in published A2A inbound cards.
   - `apps/web/src/modules/integrations/A2aTab.tsx:47-63`: rendered clickable `cardUrl` links even when `status.a2a.enabled` was `false` (leading to `404`).
   - `apps/web/src/modules/integrations/useIntegrations.ts:60-65`: discarded the JSON `error` field on non-2xx `/api/events/history` responses.

### Solution

Uncommitted changes currently in the working tree:
- `packages/contracts/src/inbox.ts:133-138` — added `scope: z.enum(['orchestrator', 'all']).optional()` to `inboxRequestsInputSchema`.
- `apps/server/src/modules/inbox/handlers.ts:233-249` — added `allScope` branch so `scope: 'all'` queries all members without requiring a bound orchestrator.
- `packages/app/src/services/integrations-service.ts:68-107,216-225` — added `forwardedProto` support in `callerBase()` and filtered disabled members (`declared.enabled === false || !address.enabled`) from `a2a.inbound`.
- `apps/server/src/modules/integrations/handlers.ts:64-68,120,135-144` — forwarded `x-forwarded-proto` in `requestContextOf()`.
- `apps/web/src/modules/integrations/helpers.ts:1-2,84-94,138-144` — wrapped `inboxLink()` and `systemEventLink()` in `withBase()`; included `gateway.mcp?.enabled` and `a2a.outbound.length > 0` in `allSurfacesOff()`.
- `apps/web/src/modules/integrations/useIntegrations.ts:60-65,85-89` — passed `{ limit: 100, scope: 'all' }` to `client.inbox.requests` and appended server `error` detail to `events/history` error messages.
- `apps/web/src/modules/integrations/A2aTab.tsx:47-63` — gated clickable `<a>` on `status.a2a.enabled`.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:19,557-579,785-792,824-832` — extracted `applyNavIntentToFilter()` to seed `searchQuery: intent.eventName, searchScope: 'name'` on initial mount and `navIntent` changes.
- Added unit/component regression tests in `apps/server/tests/modules/inbox/handlers.test.ts`, `apps/server/tests/modules/integrations/handlers.test.ts`, `packages/app/tests/services/integrations-service.test.ts`, `apps/web/tests/modules/integrations/helpers.test.ts`, `apps/web/tests/modules/integrations/useIntegrations.test.ts`, `apps/web/tests/modules/integrations/integrations-module.test.tsx`, and `apps/web/tests/modules/observability/url-seed.test.ts`.

**This run (1437 R6 — surface server runtime identity):**

| File | What / why |
| ---- | ---------- |
| `apps/web/src/modules/integrations/helpers.ts:149-171` | `ServerRuntime` (`/api/health`'s `version` + `uptime_seconds`) and `formatUptime()` — the header's identity text, as one pure projection beside the other Integrations helpers. |
| `apps/web/src/modules/integrations/useIntegrations.ts:76-93,166-200` | `readServerRuntime()` reads `/api/health` through the same fetch seam, tolerantly: a stale or foreign server is exactly the case that must not fail the module's read. The identity is read on its own effect pass and merged with `previous`, so a failed status read still names the server behind it. |
| `apps/web/src/modules/integrations/IntegrationsModule.tsx:49-66` | The header's status slot now renders the chip plus `server v<version> · up <uptime>`, or `server identity unreadable` when `/api/health` cannot be read — a stale `dist/web`-vs-server skew is visible evidence instead of an opaque 400. |
| `apps/web/tests/modules/integrations/helpers.test.ts:188-202` | `formatUptime` unit cases (two largest units, negative and fractional input). |
| `apps/web/tests/modules/integrations/useIntegrations.test.ts:76-81,267-298` | Health read populates `server`; an unreadable health route leaves it `null` without failing the module, and is not counted as an activity read. |
| `apps/web/tests/modules/integrations/integrations-module.test.tsx:164-168,215-236` | Header renders `server v0.4.43 · up 5d 5h`; a 404 health route renders `server identity unreadable`. |
| `apps/web/tests/modules/integrations-browser.heavy.test.ts:57-62` | The live CDP proof asserts the served build version + uptime on the rendered Board page. |
| `docs/reports/integrations-e2e-receipt.json` | Regenerated: verdict PASS, the `/api/inbox/requests` 400 harness failure gone (R4). |
| `docs/tasks5/1438…1442_*.md` | R7 follow-ups for design gaps G1–G5, created with `spur task create --feature A82 --skip-ready`. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1. Decide whether the `fleet-e2e-turn-perf` timeout is related, and fix or record it | MET | `bun test scripts/commands/fleet-e2e-turn-perf.test.ts` — deterministic fixture, 4/4 isolated runs green at ~5.1s each (`scripts/commands/fleet-e2e-turn-perf.test.ts:6`); the same test passed inside the full `bun run spur-check` run. The 30s timeout was parallel-load flake, and the file touches no Integrations code (`scripts/commands/fleet-e2e-turn-perf.ts:1`), so it is recorded as pre-existing load flake with this evidence. |
| R2. `bun run spur-check` exits 0, including `test-post-check` | MET | `bun run spur-check` exit 0: biome 1922 files clean + all-workspace typecheck clean (`package.json:87`), `test-pre-check` 52 rules pass, 13166 pass / 0 fail, `test-post-check` 3 rules pass; log `.spur/run/1437-spur-check.log` and the gate receipt `.spur/run/1437-check-receipt.json` (status PASS). |
| R3. Restart the live `spur-new` server via the monorepo CLI; every listed endpoint 200; board HTML carries `spur-base`; browser-check the module | MET | Named checks: `bun apps/cli/src/index.ts projects stop spur-new` then `projects start spur-new`; through `http://localhost:3000/spur-new` — `/api/health` 200 (`version: 0.4.43`, `uptime_seconds: 4`), `/api/integrations/status` 200, `/api/integrations/usage` 200, `/api/events/history?prefix=mcp |
| R4. Re-run `scripts/commands/integrations-e2e.ts` and regenerate the receipt | MET | `bun scripts/commands/integrations-e2e.ts` → `verdict: PASS`, 8/8 steps, and `docs/reports/integrations-e2e-receipt.json` no longer carries the failing `harness` row for `/api/inbox/requests?limit=100` (`scripts/commands/integrations-e2e.ts:484`). |
| R5. Atomic conventional commit, then `spur feature verify A82` | MET | Commits `d8769bbee fix(integrations): surface the served build version and uptime` and `96d4905d4 docs(tasks): close the integrations fix handoff …`; `spur feature verify A82` → `A82 verification PASS` (run `run_80339ff0-d560-4b99-9b00-084990bd9ec0`, log `.spur/run/run_80339ff0-d560-4b99-9b00-084990bd9ec0-feature-verification.log`, 86 tests / 85 pass / 1 skip / 0 fail). |
| R6. Surface server runtime identity (version, uptime) so a stale-server / fresh-`dist/web` skew is visible | MET | `apps/web/src/modules/integrations/helpers.ts:149` (`ServerRuntime`, `formatUptime`), `apps/web/src/modules/integrations/useIntegrations.ts:76` (tolerant `/api/health` read, independent of the status read) and `apps/web/src/modules/integrations/IntegrationsModule.tsx:52` (header renders `server v<version> · up <uptime>`, or `server identity unreadable`). Covered by `apps/web/tests/modules/integrations/helpers.test.ts:189`, `apps/web/tests/modules/integrations/useIntegrations.test.ts:267`, `apps/web/tests/modules/integrations/integrations-module.test.tsx:216` and the live CDP assertion at `apps/web/tests/modules/integrations-browser.heavy.test.ts:57`. |
| R7. File follow-up tasks for design gaps G1–G5 | MET | `docs/tasks5/1438_mcp-namespace-and-exposure-diagnostics-on-the-integrations-m.md`, `…1439_render-per-tool-protocol-telemetry…`, `…1440_a2a-inspection-agent-card-json…`, `…1441_badge-a2a-cross-project…`, `…1442_gateway-root-page-mcp-status…` — all created with `spur task create --feature A82 --skip-ready`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-none | N/A | n/a | The task declares no Acceptance Criteria; R1–R7 carry the acceptance evidence. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Full answer (requirement traceability + SECUA/architecture tables):
`.spur/run/65807240-2fc1-4cf5-9a07-741ce169ee20-review-cert.md`.

**Requirements:** R1–R7 all MET, each with executable evidence — `bun test
scripts/commands/fleet-e2e-turn-perf.test.ts` (4/4 isolated, load flake), `bun run spur-check` exit 0
(13166 pass / 0 fail, 52 + 3 rule presets), the restarted live gateway on `0.4.43` answering every
listed endpoint 200 plus a live CDP Board render, the regenerated `integrations-e2e` receipt
(`verdict: PASS`), commits `d8769bbee` / `96d4905d4` with `spur feature verify A82` PASS, the runtime
identity rendered in the Integrations header, and tasks 1438–1442 filed for G1–G5.

**Acceptance criteria:** the task declares none, so nothing is untraced; R6's own regression coverage
is task-local.

**Findings:**

- P4 — the identity read reuses the `fetchHistory` seam, so its name no longer describes every URL it
  serves, and a usage-window switch re-reads `/api/health` with the batch (one small GET). The
  alternative (an `attempt`-only effect) is rejected by `lint/correctness/useExhaustiveDependencies`.
- P4 — the identity span reuses the module-kit's muted `text-base-content/50` secondary-text token,
  matching `apps/web/src/components/module-kit/EmptyState.tsx:20`; contrast is unchanged from the
  established convention.

No P1–P3 findings. **Residual risk:** R6's evidence is a real `spur self serve` from this tree plus
the CDP browser proof; the operator's long-running gateway was restarted mid-run (R3), so its
`uptime_seconds` now reflects this restart rather than the stale 5-day process.

Verdict: PASS

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-23T01:15:46.051Z todo → wip (system)
- 2026-11-23T01:32:31.454Z wip → testing (system)
- 2026-11-23T01:32:33.459Z testing → done (system)

