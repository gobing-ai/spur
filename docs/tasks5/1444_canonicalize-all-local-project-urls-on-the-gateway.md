---
schema_version: 1
name: Canonicalize all local project URLs on the gateway
status: done
template: issue
created_at: 2026-11-23T18:40:23.173Z
updated_at: "2026-11-23T20:55:37.259Z"
feature_id: K4

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 8
done_forced: "false"
done_reason: unforced close
---

## 1444. Canonicalize all local project URLs on the gateway

### Background

Follow-up to task 1443 and the operator's universal-public-origin decision: local end-user surfaces must use `http://localhost:3000/<project-prefix>/*`, while live per-project loopback servers remain private gateway upstreams. A production/source review on 2026-11-23 confirmed that the migration is incomplete across several public surfaces.

| Severity | Surface | Evidence and current behavior |
| --- | --- | --- |
| P1 (blocker) | `spur projects list` | `apps/cli/src/commands/projects.ts:261-264` hard-codes `http://127.0.0.1:<gateway-port><prefix>/board`. Live verification: that origin refuses connection while `localhost:3000` returns gateway health. |
| P1 (blocker) | Project MCP bridge | `apps/cli/src/commands/mcp.ts:154-160` returns the same unreachable IPv4 gateway URL and then falls back to the internal port. Live `resolveMcpUrl(process.cwd(), {})` returned `http://127.0.0.1:3000/spur-new/mcp`; curl failed before any MCP request. |
| P1 (blocker) | Agent CLI APIs | `apps/cli/src/commands/agent/shared.ts:65,111-119` uses direct registered ports and otherwise `http://localhost:3000/api`. The latter is now the gateway root, not a project API; `GET /api/processes` returns 404 `Unknown prefix /api`. |
| P2 (major) | ProjectSwitcher | `apps/web/src/components/ProjectSwitcher.tsx:48-53,317-339` deliberately keeps direct host:port navigation when `basePath() === '/'` and after a start. `apps/web/tests/components/project-switcher.test.ts:95-98` pins that legacy behavior. Lines 476 and 485 also expose the internal port as the primary running label. |
| P2 (major) | Same-path switcher identity | `apps/server/src/modules/health/index.ts:437-460` computes `current` by path alone, so local and remote rows for the same path are both current. `ProjectSwitcher.tsx:458-462,480` also keys rows and loading state by path/name. `/api/projects/start` accepts only name/path and passes the name to `startRegisteredProject`, which can select the remote entry first. |
| P2 (major) | CLI list/start fallbacks | `apps/cli/src/commands/projects.ts:248-264,492-500` returns per-port URLs when the gateway is down and `ProjectStartResult.url` on start. Live `projects start spur-new --json` returned `http://127.0.0.1:3001`. |
| P2 (major) | Server start response | `apps/server/src/modules/health/index.ts:481-510` leaks `result.url` (the internal upstream address) through `POST /api/projects/start`; the switcher consumes it at lines 337-339. |
| P2 (major) | Integrations and A2A | `packages/app/src/services/integrations-service.ts:114-118,197-211` builds copyable MCP/A2A URLs from the direct request origin when forwarded gateway headers are absent. `apps/server/src/modules/a2a/projection.ts:74-78` has the same direct-origin fallback for advertised Agent Cards. These are correct behind the gateway but legacy on direct-port entry. |
| P3 (minor) | Normal serve browser surface | `apps/cli/src/commands/self/serve.ts:177-180` and `apps/server/src/serve.ts:1342-1361` print/open the direct per-port Board. Listener diagnostics are still valid; the public Board target needs separate canonical mapping. |
| P3 (minor) | Contract/tests | `docs/design/project-switcher.md:222-227`, `docs/design/embedded-mcp-server.md:139-145`, `docs/design/cli-contracts.md:648-653`, `plugins/sp/skills/spur-cli/references/projects.md:81-84`, and agent references still specify per-port/root fallbacks. Tests pin those behaviors instead of the new invariant. |

Already correct and not in scope for rewriting: gateway-to-upstream loopback dialing and error diagnostics; `ProjectStartResult.url` as an internal start result; `GET /api/projects` local prefix-relative URLs behind the gateway (`apps/server/src/modules/health/index.ts:447-460`); gateway index local cards (`packages/app/src/services/project-gateway-html.ts:147-150`); project-addressed A2A resolution (`packages/app/src/services/a2a-member-address.ts:65-76`); gateway root `/mcp` and `/api/health`; explicit `--server` / `--url`; remote host:port entries; and direct-server fixtures that do not assert a public legacy URL contract.

**Refine corrections (2026-11-23)**
- Direct-root switcher navigation was under-specified: `/<prefix>/board` is correct only behind the gateway; a direct-port page requires an absolute canonical gateway URL. `/api/projects` and its start endpoint must therefore resolve `url` from the request context rather than always returning a prefix-relative value.
- Added the same-path local/remote identity defect (React `key`, loading state, `current`, and start-target selection) as R8 after tracing `health/index.ts` and `ProjectSwitcher.tsx`. It is required to preserve the remote boundary while migrating navigation.
- Corrected R5: URL identity cannot require a currently reachable gateway because AC4 covers gateway-down behavior. The resolver always returns the canonical local URL; transport reports unavailability separately.
- Corrected the agent fallback: registered entries must match local host as well as path. Only an unregistered project may use the legacy `server.port` direct API fallback because no prefix exists; the gateway root `/api` is never a valid fallback.
- Froze the shared helper and request-context seams (`resolveProjectGatewayUrl`, `localGatewayBase`) so implementation does not invent duplicate registries or URL policies.
- Retained one coordinated task per the operator's request. No findings were dropped; the title remains accurate. Because this has more than six requirements, implementation should use the reviewer-role floor rather than a cheap executor.

### Requirements

- [x] R1. Implement one canonical local-public URL rule: local registry entries use `http://localhost:<server.gateway.port>/<prefix>` for Board, API, MCP, and A2A URLs, with current-origin/forwarded-host preservation for browser and tunnel requests; no hard-coded 127.0.0.1 gateway origin and no local per-port public fallback when the gateway is down.
- [x] R2. `spur projects list`, `projects start`, and normal `self serve` Board output/browser navigation must advertise canonical local Board URLs while keeping low-level listener diagnostics distinct, unregistered-project fallback explicit, and remote host:port URLs unchanged.
- [x] R3. ProjectSwitcher and `/api/projects` must navigate every local running or stopped project by its gateway prefix regardless of the current Board base path, including direct-port legacy pages and start responses, without changing remote navigation.
- [x] R4. Agent CLI server resolution must target a registered local project through its gateway-prefixed API using path + local-host identity and must never fall back to the gateway root `/api`; explicit `--server` remains authoritative and only an unregistered project may use the documented direct `server.port` fallback.
- [x] R5. Project MCP URL resolution must return the canonical gateway prefix for local projects without direct-port fallback, including when the gateway is down; explicit `--url` and the gateway-hosted root `/mcp` contract remain unchanged.
- [x] R6. Project start responses plus Integrations and A2A advertised/copyable URLs must use canonical local gateway addresses, including direct-origin legacy requests, while preserving forwarded public origins and remote behavior.
- [x] R7. Update ADR-151, all owning design/CLI/plugin docs, and regression tests, then prove CLI and browser flows for IPv6-localhost, gateway-down, direct-root legacy entry, stopped-project start, and remote entries.
- [x] R8. Same-path local/remote switcher entries must have distinct React keys, loading state, `current` markers, and start-target selection using path + host identity; `/api/projects/start` must pass the exact selected entry to `startRegisteredProject` rather than resolving a duplicate name ambiguously.

### Acceptance Criteria

```gherkin
Scenario: AC1 — CLI and MCP use a reachable canonical origin (req: R1, R2, R5)
- Given a gateway bound to `localhost` on the default port and a local project with a prefix
- When `projects list`, `projects start`, normal `self serve`, or project MCP URL resolution produces a local URL
- Then it uses `http://localhost:3000/<prefix>/...`, never `127.0.0.1` or the internal upstream port, and the route is reachable; remote entries remain host:port.
- Verify in `packages/config/tests/projects-prefix.test.ts`, `apps/cli/tests/commands/{projects-list-url,projects,mcp,self/serve}.test.ts`, and live curl probes.

Scenario: AC2 — Switcher navigation and identity stay canonical (req: R2, R3, R8)
- Given a Board opened through a legacy direct-port URL with local running, local stopped, and same-path local/remote entries
- When each local entry is rendered, selected, or started
- Then local navigation targets the canonical gateway prefix, remote navigation remains unchanged, and React keys, loading state, `current`, and exact start-target selection remain distinct; internal ports are not presented as public destinations.
- Verify in `apps/web/tests/components/project-switcher.test.ts` and `apps/server/tests/modules/health.test.ts`, plus a real browser switcher run.

Scenario: AC3 — Registered agent APIs never target the gateway root (req: R1, R4)
- Given registered local projects, including a same-path remote row, a stopped upstream, or a dead recorded port
- When agent status/list/start/stop resolves its default server
- Then it targets `http://localhost:3000/<prefix>/api`, never `http://localhost:3000/api` or the internal port; explicit `--server` wins and only unregistered projects use direct `server.port`.
- Verify in `apps/cli/tests/commands/agent/{shared,start,stop}.test.ts` and one real agent-status request through the gateway.

Scenario: AC4 — Gateway-down does not reintroduce per-port public URLs (req: R1, R2, R4, R5)
- Given no answering gateway
- When local Board, agent API, or MCP URLs are listed or resolved
- Then their identity remains the canonical gateway prefix and unavailability is reported separately; no direct-port substitution occurs and no prefix can be invented for an unregistered project.
- Verify with gateway probes mocked down in CLI/server tests; no production gateway is stopped for this scenario.

Scenario: AC5 — Start, Integrations, and A2A advertise canonical URLs (req: R1, R2, R6)
- Given project-start and direct-origin legacy requests, plus gateway-forwarded requests
- When start responses, copyable MCP examples, Integration surfaces, and Agent Cards are produced
- Then local addresses use the canonical gateway prefix, forwarded public origins remain correct, exact-entry start selection is preserved, and remote/explicit override behavior is unchanged.
- Verify in `apps/server/tests/modules/{health,a2a/routes,integrations/handlers}.test.ts` and `packages/app/tests/services/integrations-service.test.ts`.

Scenario: AC6 — Contracts and regression coverage migrate together (req: R7)
- Given the amended ADR-151 policy and all affected tests
- When focused checks and the task pipeline run
- Then owning docs and assertions agree with implementation, and repeatable CLI/browser proofs cover IPv6-localhost, gateway-down, direct-root entry, stopped starts, same-path local/remote rows, and remote entries without rewriting intentional loopback internals.
- Verify with the changed-path light gate, the pipeline's assigned gate, the existing gateway heavy proof, and a final browser/network receipt.
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-23T18:57:24.007Z

- **Decision:** One coordinated migration task is retained because the operator explicitly requested one task; use the reviewer-role implementation floor for the eight requirements.
- **Decision:** URL identity and availability are separate. Local public URLs remain canonical when the gateway is down; no direct-port fallback is introduced.
- **Decision:** Only unregistered projects may use direct `server.port` API/Board fallback because no gateway prefix exists. This is documented legacy behavior, not a canonical route.
- **Decision:** Add no CLI flag. `/api/projects/start` accepts additive optional `host`; legacy bodies without it retain current behavior, while the switcher always sends host for exact-entry selection.
- **Decision:** `ProjectStartResult.url` remains an internal upstream result. Public URLs are derived only at CLI/HTTP/UI boundaries.
- **Decision:** Remote entries, explicit `--server`/`--url`, gateway-root `/mcp`, and loopback diagnostics are unchanged.
- **Decision:** Gateway-down E2E uses mocked probes; the production gateway is not stopped merely to test this scenario.

### Design

**Canonical seam (R1).** Add `resolveProjectGatewayUrl(entry, gateway, suffix): string | null` beside `resolveProjectPrefix` in `packages/config/src/projects.ts` (already re-exported by `packages/config/src/index.ts:1550`). `gateway` is `{ host?: string; port: number }`, defaulting host to `localhost`; `suffix` is a caller-owned absolute path such as `/board`, `/api`, or `/mcp`. It returns `null` for remote entries and otherwise `http://<gateway.host>:<gateway.port><resolveProjectPrefix(entry)><suffix>`. It does no liveness probe and adds no configuration. Cover it in `packages/config/tests/projects-prefix.test.ts`.

**URL identity versus availability (R1, R5).** Local public URL construction never depends on gateway liveness. `projects list` and status output report gateway/upstream availability separately; they never substitute an internal port. Listing still does not start the gateway, and an actual prefix request retains start-on-demand behavior. An unregistered project has no canonical prefix: only that case may retain the direct `server.port` API fallback, explicitly labeled legacy rather than canonical.

**CLI mappings (R2, R4, R5).**
- `apps/cli/src/commands/projects.ts`: local JSON rows always carry the canonical Board URL, and human rows print it for running, stopped, and gateway-down entries. Map only the selected local start result at the CLI boundary; leave `ProjectStartResult.url` unchanged for internal callers.
- `apps/cli/src/commands/agent/shared.ts`: resolution order is explicit `--server` → nearest ancestor entry with matching normalized path **and local host** → canonical `/api` URL → unregistered legacy `http://localhost:<server.port>/api`. Dead/stopped registered entries keep the canonical prefix so the gateway can start them; the gateway root `/api` is never returned.
- `apps/cli/src/commands/mcp.ts`: local registered entries always use the canonical `/mcp` URL. Explicit `--url` and the separately hosted gateway-root `/mcp` resolver are unchanged.
- `apps/cli/src/commands/self/serve.ts` and `apps/server/src/serve.ts`: retain the listener URL as a diagnostic, but resolve the advertised/opened Board URL through the registered local prefix. An unregistered direct serve keeps its direct Board URL and says why it cannot derive a gateway route.

**Switcher and start boundary (R3, R8).**
- `GET /api/projects`: for a forwarded gateway request, local `url` stays prefix-relative (`/<prefix>/board`) so navigation shares the current public origin. For a direct-root request, local `url` is the absolute canonical gateway URL from `resolveProjectGatewayUrl`; a relative prefix on a direct-port page would incorrectly remain on that port. Remote `url` remains host:port. `current` is true only for a local entry whose normalized path matches `ctx.cwd`.
- `directBoardUrl`: local entries prefer the server-resolved `project.url` regardless of running state or current base; stopped projects are started by the gateway. Remote entries keep their direct host:port URL. The start path uses the returned canonical `body.url` and has no per-port fallback. Local labels show the prefix rather than presenting the internal port as the destination.
- Add `projectIdentity(project)` in `ProjectSwitcher.tsx`, returning `<effective-host>|<normalized-path>`. Use it for React `key` and `loadingProject`; same-name/same-path local and remote rows must not share component or loading identity.
- `POST /api/projects/start`: accept additive optional `host` in the JSON body (the switcher always sends it). Resolve the selected registry entry by name/path **plus host** and pass it through `startRegisteredProject(..., { entry })`, the exact-entry seam added for the gateway. Legacy bodies without `host` keep existing behavior. Return a canonical local URL or the remote URL; do not expose `result.url` directly.

**Integrations and A2A (R6).** Extend `IntegrationsRequestContext` with optional `localGatewayBase`, computed by the `apps/server` composition root with the shared helper. `callerBase` precedence is forwarded host + forwarded prefix (including forwarded scheme) → `localGatewayBase` → direct `origin` only for unregistered/remote contexts. `cardOrigin` receives the same canonical fallback from the A2A composition root; forwarded identity still wins. No token or registry secret enters these projections.

**Anti-patterns / non-goals.** Do not rewrite gateway-to-upstream loopback URLs, health/ownership probes, internal `ProjectStartResult.url`, remote entries, explicit overrides, gateway-root `/mcp` or `/api/health`, or direct-server fixtures unless they assert the old public behavior. Do not add a new CLI flag, a second registry, or a universal multi-tenant server. Do not put registry/network access into `directBoardUrl` or the pure card projection.

**Docs and verification (R7).** Add a dated ADR-151 amendment replacing per-port public fallback. Synchronize `docs/design/{project-gateway,project-switcher,embedded-mcp-server,cli-contracts}.md`, `docs/03_ARCHITECTURE.md` agent URL resolution, and `plugins/sp/skills/spur-cli/references/{projects,agent}.md`. Tests live in `packages/config/tests/projects-prefix.test.ts`; `apps/cli/tests/commands/{projects-list-url,projects,mcp}.test.ts` and `commands/agent/{shared,start,stop}.test.ts`; `apps/web/tests/components/project-switcher.test.ts`; `apps/server/tests/modules/{health,a2a/routes,integrations/handlers}.test.ts`; `packages/app/tests/services/integrations-service.test.ts`; and `apps/cli/tests/commands/self/serve.test.ts`. Use the existing gateway heavy proof for route-level coverage and a real browser for direct-root and same-path switching.

Acceptance criteria remain `task-local`: these are migration regressions across K4/B9/G67/A82 surfaces, not new feature-level ship scenarios. There are no task dependencies and no dependent WBS handoff.

### Plan

- [x] R1/R5: Add failing helper and CLI/MCP regressions for canonical local URLs, gateway-down identity, remote nulls, and explicit overrides.
- [x] R4: Migrate agent server resolution with local-host filtering and the documented unregistered `server.port` fallback; add same-path remote and dead/stopped cases.
- [x] R2/R8: Migrate CLI project list/start and normal-serve Board output; fix `current`, `projectIdentity`, and exact-entry start selection.
- [x] R3/R6: Migrate `/api/projects`, ProjectSwitcher, Integrations, and A2A using request-context-aware canonical URLs; add direct-root and forwarded-origin tests.
- [x] R7: Amend ADR-151 and synchronize all owning docs/references; run changed-path light checks and the pipeline-assigned gate.
- [x] R7: Produce repeatable CLI and real-browser receipts for direct-root and same-path switching, stopped starts, IPv6-localhost, and remote entries; simulate gateway-down only in tests, then restart the gateway bundle.

### Root Cause

ADR-151 migrated request routing and Board base-path handling, but it did not establish one owner for canonical public project URLs. Pre-gateway host:port producers remained in CLI, switcher, agent, MCP, and Integrations surfaces. Two copies also hard-coded the gateway as `127.0.0.1` even though its default `localhost` bind is IPv6-only on this macOS host. `basePath() === '/'` was treated as permission to bypass the gateway rather than as a legacy direct-port entry that should navigate back to the canonical origin. Gateway-down and no-live-entry fallbacks were never migrated, and their tests/docs now preserve the drift.

### Solution

| File | Change |
| --- | --- |
| `packages/config/src/projects.ts:75-90` | Add `resolveProjectGatewayUrl`: local-only canonical URLs from prefix + configured gateway host/port, with IPv6 bracket handling and no liveness dependency. |
| `apps/cli/src/commands/projects.ts:248-275,340-390,478-525` | Always return canonical local Board URLs, report gateway availability separately, and map selected local start results without changing internal start semantics. |
| `apps/cli/src/commands/mcp.ts:140-160` | Resolve registered local MCP endpoints through the canonical prefix; retain unregistered and explicit override behavior. |
| `apps/cli/src/commands/agent/shared.ts:61-125` | Resolve agent APIs by explicit override → local-host registry prefix → unregistered `server.port`; ignore same-path remote rows and preserve dead-port diagnostics. |
| `apps/server/src/serve.ts:1342-1370` | Advertise/open the registered project's canonical Board URL while preserving the direct listener diagnostic and unregistered fallback. |
| `apps/server/src/modules/health/index.ts:433-550` | Return direct-root absolute and forwarded-relative URLs, host-scope `current`, accept optional `host` on start, and pass the exact selected entry to `startRegisteredProject`. |
| `apps/server/src/modules/a2a/index.ts:27-45,270-285` | Use canonical local gateway fallback for direct-root Agent Cards while preserving forwarded identity and unregistered request-origin fallback. |
| `apps/server/src/modules/integrations/handlers.ts:157-180` | Supply `localGatewayBase` from the registered local project to the Integrations projection. |
| `packages/app/src/services/integrations-service.ts:77-90,114-125` | Apply forwarded base → local canonical base → unregistered request-origin precedence to MCP/A2A advertised URLs. |
| `apps/web/src/components/ProjectSwitcher.tsx:44-85,335-355,456-490` | Navigate local entries via canonical URLs in every base mode, use host-scoped identity for React keys/loading, and label local routes by prefix rather than internal port. |
| `packages/config/tests/projects-prefix.test.ts:80-130` | Cover canonical default/custom/IPv6 gateway URLs and remote nulls. |
| `apps/cli/tests/commands/projects-list-url.test.ts:45-110` | Cover gateway-up/down canonical CLI output and separate availability. |
| `apps/cli/tests/commands/projects-prefix.test.ts:129-145` | Update stopped-project output to the canonical prefix. |
| `apps/cli/tests/commands/projects.test.ts:318-345` | Assert canonical `projects start` JSON and text output. |
| `apps/cli/tests/commands/mcp.test.ts:145-175` | Assert gateway-up/down canonical MCP resolution and unregistered fallback. |
| `apps/cli/tests/commands/agent/shared.test.ts:1-310` | Assert prefixed registered agent APIs, unregistered fallback, same-path remote exclusion, and gateway origin for lifecycle calls. |
| `apps/server/tests/serve.test.ts:565-635` | Assert normal-serve browser opening and listener callback use canonical Board URLs. |
| `apps/server/tests/modules/health.test.ts:144-215,350-375` | Cover direct/forwarded URL forms, same-path `current`, exact-entry start, and remote preservation. |
| `apps/server/tests/modules/a2a/routes.test.ts:683-730` | Prove direct-root cards use the canonical local gateway origin. |
| `apps/server/tests/modules/integrations/handlers.test.ts` | Existing integration handler coverage passes with the new composition root. |
| `packages/app/tests/services/integrations-service.test.ts:210-250` | Prove direct legacy requests use `localGatewayBase` while forwarded origins remain intact. |
| `apps/web/tests/components/project-switcher.test.ts:86-140` | Cover direct-root canonical navigation, host-scoped identity, and prefix endpoint labels. |
| `docs/00_ADR.md:2960-2975` | Amend ADR-151 with canonical local URL identity, availability separation, and exact-entry start semantics. |
| `docs/03_ARCHITECTURE.md:854-862` | Update agent server discovery to canonical prefix plus unregistered fallback. |
| `docs/design/project-gateway.md:56-70` | Document the shared URL resolver and direct/forwarded forms. |
| `docs/design/project-switcher.md:222-250` | Document switcher navigation, same-path identity, and start contract. |
| `docs/design/embedded-mcp-server.md:139-148` | Update MCP resolution to canonical local prefix with unregistered fallback. |
| `docs/design/cli-contracts.md:648-660,900-925` | Update agent and MCP URL resolution contracts. |
| `docs/design/integrations-module.md:105-115` | Document forwarded/local/direct base precedence for Integrations. |
| `docs/design/a2a-member-transport.md:185-190` | Document direct-root canonical card fallback. |
| `docs/help/cmd_agent.md:205-225,365-390` | Update agent `--server` defaults. |
| `docs/help2/agent.md:65-72` | Update agent API fallback documentation. |
| `plugins/sp/skills/spur-cli/references/projects.md:81-95` | Update project list/start URL behavior. |
| `plugins/sp/skills/spur-cli/references/agent.md:163-190,320-335` | Update agent supervisor URL resolution. |
| `docs/tasks5/1444_canonicalize-all-local-project-urls-on-the-gateway.md` | Track requirement-scoped implementation progress and evidence. |

**Verification evidence:** RED→GREEN regressions across all affected files; 38 config, 89 CLI, 14 switcher, 167 server, and 15 Integrations tests passed; all five affected workspace typechecks passed. Existing real gateway heavy proof passed. Repeatable throwaway E2E artifacts are `/tmp/spur-1444-e2e-TmCMTY/{cli-proof.txt,browser-proof.md,beta-board.png}`: direct-root switcher cold-started beta to `http://localhost:3900/beta/board/observability`, with same-path remote identity preserved and no browser errors.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/config/src/projects.ts:75-86` implements canonical local/remote URL resolution and IPv6 handling; `packages/config/tests/projects-prefix.test.ts:80-130` covers default, custom, IPv6, and remote cases without liveness probes. |
| R2 | MET | `apps/cli/src/commands/projects.ts:248-275,478-525` and `apps/server/src/serve.ts:1342-1370` produce canonical Board URLs and separate availability; `apps/cli/tests/commands/{projects-list-url,projects,projects-prefix}.test.ts` and `apps/server/tests/serve.test.ts:565-635` pass. |
| R3 | MET | `apps/web/src/components/ProjectSwitcher.tsx:44-55,333-354` uses server-resolved local URLs in every base mode; `apps/server/src/modules/health/index.ts:444-477` returns direct-root absolute and forwarded-relative forms; switcher and health tests plus the real beta switch prove it. |
| R4 | MET | `apps/cli/src/commands/agent/shared.ts:75-124` implements explicit override → local-host prefix → unregistered fallback; `apps/cli/tests/commands/agent/shared.test.ts:73-310` covers dead/stopped and same-path remote rows and never returns gateway-root `/api` for registered projects. |
| R5 | MET | `apps/cli/src/commands/mcp.ts:140-160` always returns canonical local MCP URLs; `apps/cli/tests/commands/mcp.test.ts:150-175` proves gateway-up/down identity and unregistered fallback; live resolution returned `http://localhost:3900/alpha/mcp`. |
| R6 | MET | `apps/server/src/modules/health/index.ts:515-554` maps exact-entry start responses; `packages/app/src/services/integrations-service.ts:87-121` and `apps/server/src/modules/a2a/index.ts:41-55,281-289` preserve forwarded/canonical/direct precedence. Handler/service/A2A tests and live cards all pass. |
| R7 | MET | ADR-151 and all named owning docs are synchronized. Five workspace typechecks, changed-path light gate, pipeline DEFERRED gate, real gateway heavy proof, and repeatable CLI/browser artifacts passed. |
| R8 | MET | `apps/web/src/components/ProjectSwitcher.tsx:60-68,340,473-500` scopes keys/loading/labels by host identity; `apps/server/src/modules/health/index.ts:464,517-554` scopes `current` and exact-entry start. Same-path tests and the live remote row `current:false` confirm it. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — CLI and MCP use a reachable canonical origin | MET | test | `packages/config/tests/projects-prefix.test.ts`, `apps/cli/tests/commands/{projects-list-url,projects,mcp,self/serve}.test.ts`, and live `projects list` / MCP probes all returned canonical URLs; remote stayed host:port. |
| AC2 — Switcher navigation and identity stay canonical | MET | test | `apps/web/tests/components/project-switcher.test.ts`, `apps/server/tests/modules/health.test.ts`, and the real browser moved stopped beta from direct 3901 to `localhost:3900/beta/board/observability`; same-path remote was not current and local labels were prefixes. |
| AC3 — Registered agent APIs never target the gateway root | MET | test | `apps/cli/tests/commands/agent/{shared,start,stop}.test.ts` plus live `resolveAgentServer` returned `http://localhost:3900/alpha/api`; explicit override and unregistered fallback remain covered. |
| AC4 — Gateway-down does not reintroduce per-port public URLs | MET | test | `apps/cli/tests/commands/projects-list-url.test.ts` and `commands/mcp.test.ts` mock gateway-down and retain canonical identity with separate availability; production gateway was not stopped. |
| AC5 — Start, Integrations, and A2A advertise canonical URLs | MET | test | `apps/server/tests/modules/{health,a2a/routes,integrations/handlers}.test.ts` and `packages/app/tests/services/integrations-service.test.ts`; live exact-entry start, A2A card, and Integrations URLs all used `localhost:3900/alpha`. |
| AC6 — Contracts and regression coverage migrate together | MET | test | ADR/design/help/plugin docs updated; changed-path light gate and pipeline DEFERRED gate passed; `apps/cli/tests/commands/serve-gateway.heavy.test.ts` and `/tmp/spur-1444-e2e-TmCMTY/{cli-proof.txt,browser-proof.md,beta-board.png}` provide the receipt. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1444
**Scope:** isolated worktree `sp/run-1444-5bb8`; all production, test, and owning documentation changes reviewed.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | architecture | No P1–P3 findings: one pure resolver centralizes canonical identity while thin adapters preserve forwarded origins, remote entries, explicit overrides, unregistered fallback, and internal loopback diagnostics. | `packages/config/src/projects.ts:75-86` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/config/src/projects.ts:75-86` implements canonical local/remote URL resolution and IPv6 handling; `packages/config/tests/projects-prefix.test.ts:80-130` covers default, custom, IPv6, and remote cases without liveness probes. |
| R2 | MET | `apps/cli/src/commands/projects.ts:248-275,478-525` and `apps/server/src/serve.ts:1342-1370` produce canonical Board URLs and separate availability; `apps/cli/tests/commands/{projects-list-url,projects,projects-prefix}.test.ts` and `apps/server/tests/serve.test.ts:565-635` pass. |
| R3 | MET | `apps/web/src/components/ProjectSwitcher.tsx:44-55,333-354` uses server-resolved local URLs in every base mode; `apps/server/src/modules/health/index.ts:444-477` returns direct-root absolute and forwarded-relative forms; switcher and health tests plus the real beta switch prove it. |
| R4 | MET | `apps/cli/src/commands/agent/shared.ts:75-124` implements explicit override → local-host prefix → unregistered fallback; `apps/cli/tests/commands/agent/shared.test.ts:73-310` covers dead/stopped and same-path remote rows and never returns gateway-root `/api` for registered projects. |
| R5 | MET | `apps/cli/src/commands/mcp.ts:140-160` always returns canonical local MCP URLs; `apps/cli/tests/commands/mcp.test.ts:150-175` proves gateway-up/down identity and unregistered fallback; live resolution returned `http://localhost:3900/alpha/mcp`. |
| R6 | MET | `apps/server/src/modules/health/index.ts:515-554` maps exact-entry start responses; `packages/app/src/services/integrations-service.ts:87-121` and `apps/server/src/modules/a2a/index.ts:41-55,281-289` preserve forwarded/canonical/direct precedence. Handler/service/A2A tests and live cards all pass. |
| R7 | MET | ADR-151 and all named owning docs are synchronized. Five workspace typechecks, changed-path light gate, pipeline DEFERRED gate, real gateway heavy proof, and repeatable CLI/browser artifacts passed. |
| R8 | MET | `apps/web/src/components/ProjectSwitcher.tsx:60-68,340,473-500` scopes keys/loading/labels by host identity; `apps/server/src/modules/health/index.ts:464,517-554` scopes `current` and exact-entry start. Same-path tests and the live remote row `current:false` confirm it. |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — CLI and MCP use a reachable canonical origin | MET | test+command | `packages/config/tests/projects-prefix.test.ts`, `apps/cli/tests/commands/{projects-list-url,projects,mcp,self/serve}.test.ts`, and live `projects list` / MCP probes all returned canonical URLs; remote stayed host:port. |
| AC2 — Switcher navigation and identity stay canonical | MET | test+command | `apps/web/tests/components/project-switcher.test.ts`, `apps/server/tests/modules/health.test.ts`, and the real browser moved stopped beta from direct 3901 to `localhost:3900/beta/board/observability`; same-path remote was not current and local labels were prefixes. |
| AC3 — Registered agent APIs never target the gateway root | MET | test+command | `apps/cli/tests/commands/agent/{shared,start,stop}.test.ts` plus live `resolveAgentServer` returned `http://localhost:3900/alpha/api`; explicit override and unregistered fallback remain covered. |
| AC4 — Gateway-down does not reintroduce per-port public URLs | MET | test | `apps/cli/tests/commands/projects-list-url.test.ts` and `commands/mcp.test.ts` mock gateway-down and retain canonical identity with separate availability; production gateway was not stopped. |
| AC5 — Start, Integrations, and A2A advertise canonical URLs | MET | test+command | `apps/server/tests/modules/{health,a2a/routes,integrations/handlers}.test.ts` and `packages/app/tests/services/integrations-service.test.ts`; live exact-entry start, A2A card, and Integrations URLs all used `localhost:3900/alpha`. |
| AC6 — Contracts and regression coverage migrate together | MET | test+command | ADR/design/help/plugin docs updated; changed-path light gate and pipeline DEFERRED gate passed; `apps/cli/tests/commands/serve-gateway.heavy.test.ts` and `/tmp/spur-1444-e2e-TmCMTY/{cli-proof.txt,browser-proof.md,beta-board.png}` provide the receipt. |

##### Checks

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | All eight requirements implemented with the frozen resolver, request-context precedence, exact-entry start seam, and explicit non-goals. |
| regression | pass | RED→GREEN on every slice; 38 config, 89 CLI, 14 switcher, 167 server, and 15 Integrations tests passed. |
| types-and-lint | pass | `@gobing-ai/spur-config`, `spur-app`, `spur`, `spur-server`, and `spur-web` typechecks plus Biome changed-file checks passed. |
| quality-gate | pass | Changed-path light gate PASS; pipeline gate outcome PASS with DEFERRED tier and 14 reused checks on the bound tree. |
| public-flow | pass | Real gateway heavy proof passed; throwaway browser cold start reached `http://localhost:3900/beta/board/observability` with no browser errors; pre-merge worktree gateway returned 200 and remote `current:false`. |

**Next:** Close the task; no code remediation is required.

Verdict: PASS

### References

- Runtime defect: `apps/cli/src/commands/projects.ts:261-264` and `apps/cli/src/commands/mcp.ts:154-160` — `curl http://127.0.0.1:3000/...` refused while `http://localhost:3000/api/health` returned 200.
- Runtime defect: `apps/cli/src/commands/agent/shared.ts:65,111-119` and `packages/app/src/services/project-gateway.ts:1044-1057` — gateway-root `/api/processes` returns 404.
- Switcher/navigation: `apps/web/src/components/ProjectSwitcher.tsx:44-53,311-339,456-485` and `apps/server/src/modules/health/index.ts:433-510`.
- Same-path identity: `ProjectSwitcher.tsx:458-462,480` and `health/index.ts:437-460`; exact-entry start seam: `packages/app/src/services/project-start.ts:40-47,377-385`.
- Public protocol URLs: `packages/app/src/services/integrations-service.ts:77-118,197-211,242-247` and `apps/server/src/modules/a2a/projection.ts:66-79,87-97`.
- Internal result boundary: `packages/app/src/services/project-start.ts:9-17,421-434,441-453,507-521`.
- Canonical helper owner: `packages/config/src/projects.ts` and `packages/config/tests/projects-prefix.test.ts`; existing export: `packages/config/src/index.ts:1550`.
- Correct controls: `apps/server/src/modules/health/index.ts:447-460`, `packages/app/src/services/project-gateway-html.ts:147-150`, and `packages/app/src/services/a2a-member-address.ts:65-88`.
- Policy owners: `docs/00_ADR.md` ADR-151; `docs/03_ARCHITECTURE.md`; `docs/design/{project-gateway,project-switcher,embedded-mcp-server,cli-contracts}.md`; `plugins/sp/skills/spur-cli/references/{projects,agent}.md`.
- Related completed work: task 1443 (local startup beside same-path remote entries), commit `8217b2593`.
- Concurrency audit 2026-11-23: base `8217b25938b7b66dda98dc1301544b8f57d32ed8`; one worktree (`/Users/robin/xprojects/spur-new`, `main`); `spur task list --status wip --json` returned no concurrent WIP tasks. `dependencies[]` is empty and no dependent WBS handoff is required.

### History

- 2026-11-23T20:49:56.434Z todo → wip (system)
- 2026-11-23T20:55:35.681Z wip → testing (system)
- 2026-11-23T20:55:37.255Z testing → done (system)

