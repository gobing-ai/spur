---
schema_version: 1
name: Resolve same-gateway A2A targets and read the remote inbox thread for an outbound receipt
status: done
template: feature-impl
created_at: 2026-11-27T07:35:46.757Z
updated_at: "2026-11-27T20:19:15.614Z"
feature_id: A822

estimate_hours: 5
priority: P2
done_forced: "false"
done_reason: unforced close
---

## 1468. Resolve same-gateway A2A targets and read the remote inbox thread for an outbound receipt

### Background

Feature A822: an outbound A2A call to another project behind the same gateway should show the remote side of the dialog. Peers outside the gateway, or remote reads that fail, show a marker instead.

Existing seams:
- Project-addressed members (1395) resolve through `resolveProjectCardTarget` in `packages/app/src/services/a2a-member-address.ts` (~:40-78). It returns the gateway URL `http://localhost:<gatewayPort><prefix>/a2a/members/<instanceId>/…`, where `prefix = resolveProjectPrefix(entry) ?? /<slug>`, and probes `/api/health` for `gateway: true`. `envProjectCardRefResolver` (`:129`) composes it from env.
- Outbound members are listed with `kind: 'a2a' | 'project'` in `packages/app/src/services/integrations-service.ts:292-298`.
- Each receipt carries its own `remoteTaskId` / `remoteContextId` (`packages/contracts/src/inbox.ts:60-72`, 1440 R2), persisted on `coordination_runs.remote_context_id` (migration 0056).
- On the receiving project, the A2A projection sets the task's `contextId` to the inbox `message.threadId` (`apps/server/src/modules/a2a/index.ts:219`).
- The remote dialog is readable via `inbox.thread`: `GET /inbox/messages/{id}/thread` (`packages/contracts/src/inbox.ts:187-191`) returns the root plus replies, oldest first.

**Refine corrections (2026-11-27)**

- Q&A left open whether `inbox.thread` accepts the remote `contextId` (a `threadId`), with an `inbox.timeline` fallback → settled from code: `InboxService.thread(id)` (`packages/app/src/services/inbox-service.ts:425-429`) loads `id` then calls `dao.thread(root?.threadId ?? id)`, and `InboxDao.thread` (`packages/domain/src/dao/inbox-dao.ts:551-554`) matches `thread_id = ?1 OR id = ?1` → a `threadId` works directly; the timeline fallback is removed; Plan step 1 becomes a regression test, not an open probe.
- Gateway reachability of the read was unstated → `gatewayGuard` (`project-gateway.ts:226`) passes safe GET methods through to `/<prefix>/api/*`, and the server mounts oRPC at `/api` (`apps/server/src/bootstrap.ts:56-59`) → `GET <base>/api/inbox/messages/<id>/thread` is reachable through the gateway.
- Line refs → verified: `resolveProjectCardTarget` at `a2a-member-address.ts:37` (prefix `:70`, URL `:77`, `probeGateway` `/api/health` `:85`), `envProjectCardRefResolver` `:129`; outbound kinds at `integrations-service.ts:285-300`; receipt remote refs `inbox.ts:58-72`; thread route `inbox.ts:187-191`; `contextId = message.threadId` at `a2a/index.ts:219` → premises hold.
- AC rows used the non-canonical `R<n> —` form → rewritten as `AC<n> — … (req: …)` with test layers.

### Requirements

- [x] R1. An application function `readRemoteDialog({ member, remoteContextId })` resolves a `kind: 'project'` member to its gateway base `http://localhost:<port><prefix>` by reusing `resolveProjectCardTarget`'s registry and prefix logic, extracted into a shared helper without duplication. It then reads `<base>/api/inbox/messages/<remoteContextId>/thread`.
- [x] R2. The result is a discriminated union: `{ status: 'remote', messages }`, or `{ status: 'outside-gateway' }` for an `a2a`-kind member or a project with no local registry entry, or `{ status: 'unavailable', reason }` when there is no gateway, a non-2xx response, a timeout (2s budget), or an invalid body.
- [x] R3. An oRPC procedure `integrations.remoteDialog` (contract in `packages/contracts/src/integrations.ts`, handler via `implement(contract)`) exposes it to the Board. No public `spur` CLI verb is added.
- [x] R4. The read never forwards local credentials. It is loopback-only, with `redirect: 'error'`.

Out of scope: rendering (task 1469); peers on other hosts; writing to the remote inbox.

### Acceptance Criteria

- [x] AC1 — An outbound call to a same-gateway project shows the remote dialog (req: R1; R3; R4) — unit: `packages/app/tests` proves `readRemoteDialog` on a registered `project` member returns `{ status: 'remote', messages }` oldest first from `<base>/api/inbox/messages/<threadId>/thread` (stub loopback server), with `redirect: 'error'` and no credential headers; contract test in `apps/server/tests` exercises `integrations.remoteDialog`.
- [x] AC2 — A peer outside the gateway is marked, not guessed (req: R2) — unit: `packages/app/tests` proves an `a2a`-kind member and an unregistered project both return `{ status: 'outside-gateway' }` with no fetch issued.
- [x] AC3 — A failed remote read degrades to the marker (req: R2; R4) — unit: `packages/app/tests` proves gateway-down, non-2xx, 2s timeout and malformed body each return `{ status: 'unavailable', reason }` without throwing.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:08.970Z

- **Q: Is `remoteContextId` the remote thread root id?** A: The remote `contextId` is the inbox `threadId` (`a2a/index.ts:219`). Plan step 1 proves `inbox.thread` accepts it. If it does not, the read becomes `inbox.timeline` filtered by `threadId` (`inbox.ts:107`). The return shape stays the same.
- **Q: A new CLI verb?** A: No. A Board-only oRPC procedure needs no public-surface consent.
- **Q: Guess a same-host peer from its card URL?** A: No. Only a registry-resolved `project` member counts as same-gateway, and anything else is marked.
- **Q: Cache remote reads?** A: No. The read happens only when the user expands a receipt.

#### Q&A entry — 2026-11-27 (refine, depth=ready)

- **Q: Does `inbox.thread` accept the remote `contextId`?** A: Yes (supersedes the earlier conditional answer). `InboxService.thread` resolves `root?.threadId ?? id` and `InboxDao.thread` matches `thread_id = ?1 OR id = ?1`, so the `threadId` is a valid key. No `inbox.timeline` fallback is built.

### Design

- **Chosen:** extract `resolveProjectGatewayBase()` from `resolveProjectCardTarget`, so the card URL and the dialog base share one prefix rule. Add `readRemoteDialog` in `packages/app` and a thin oRPC procedure.
- **Rejected:** re-deriving the prefix in the web app (a duplicate rule); reading the remote project's SQLite directly, which crosses a project boundary.
- **Frozen names:** `readRemoteDialog`, `integrations.remoteDialog`, statuses `remote | outside-gateway | unavailable`.
- **Invariants:** never throws to the caller, because every failure maps to `unavailable` with a reason; loopback-only.
- **Anti-patterns:** falling back to guessed content; retry loops.
- **Handoff:** task 1469 renders the union.

### Plan

1. Regression first: a test proving `inbox.thread` keyed by a `threadId` (not a message id) returns the root plus replies oldest first — the read key `readRemoteDialog` relies on.
2. Failure modes first:
   - `a2a` member → `outside-gateway`;
   - unregistered project → `outside-gateway`;
   - gateway down → `unavailable`;
   - 500 → `unavailable`;
   - timeout (2s) → `unavailable`;
   - malformed body → `unavailable`;
   - redirect response → `unavailable` (`redirect: 'error'`);
   - happy path → `remote` with messages oldest first.
3. Extract `resolveProjectGatewayBase()` from `resolveProjectCardTarget` (`a2a-member-address.ts:37-85`). Implement `readRemoteDialog`, the contract in `packages/contracts/src/integrations.ts` and the handler via `implement(contract)`.
4. Real proof: on the local gateway with two registered projects, send one outbound A2A turn, then call the procedure and record the JSON.
5. Run `bun run spur-check`.

### Solution

| File | Change |
| --- | --- |
| `packages/app/src/services/a2a-member-address.ts:18-30` | `ProjectGatewayRefusal` (`no-entry` / `remote-host` / `ambiguous` / `no-gateway`) and `ProjectGatewayBase` — a refusal now carries a machine-readable reason, so a caller can tell "another gateway" from "gateway down" without parsing prose (R1/R2). |
| `packages/app/src/services/a2a-member-address.ts:65-127` | `resolveProjectGatewayBase()` extracted from `resolveProjectCardTarget`: ONE registry + prefix + gateway-probe rule shared by the Agent Card URL and the remote dialog read (R1's "without duplication"). `resolveProjectCardTarget` now composes it and appends the card suffix (`:38-44`). |
| `packages/app/src/services/a2a-remote-dialog.ts:14-20` | `RemoteDialogResult` — the discriminated union `remote` / `outside-gateway` / `unavailable` (R2). |
| `packages/app/src/services/a2a-remote-dialog.ts:38-85` | `readRemoteDialog`: only a `project` member resolves; `no-entry`/`remote-host` become `outside-gateway` **without a fetch**; the read is `GET <base>/api/inbox/messages/<contextId>/thread` with `redirect: 'error'`, a 2 s `AbortSignal.timeout`, `accept: application/json` and **no credential header** (R1/R2/R4); the body is validated with `inboxMessageSchema.array()` and sorted oldest first. |
| `packages/contracts/src/integrations.ts:310-332` | `integrationsRemoteDialogInputSchema` (`member`, `remoteContextId`) and `integrationsRemoteDialogSchema` (the union, embedding `inboxMessageSchema`) (R3). |
| `packages/contracts/src/integrations.ts:365-378` | `integrations.remoteDialog` — `GET /integrations/remote-dialog` (R3). No `spur` CLI verb, so no public-surface consent is needed. |
| `packages/contracts/src/index.ts:63`, `packages/contracts/src/inbox.ts:37-38` | The inbox message schema/type become reachable from the contracts barrel; the integrations contract embeds them. |
| `apps/server/src/modules/integrations/handlers.ts:288-310` | The handler resolves the member from the SAME status projection the Board reads, then delegates to `readRemoteDialog` with `bearerEnv(ctx)`'s gateway port and registry path — a caller-injected env selects the registry too, not only the process env. |
| `packages/app/src/index.ts:197-211` | Barrel exports for the new function, types and the extended address helper. |
| `packages/app/tests/services/a2a-remote-dialog.test.ts:1-215` | Ten cases: happy path over a stub loopback gateway (oldest-first ordering and the exact `/tslibs/api/inbox/messages/th-1/thread` path), no credential headers, `a2a`/unregistered → `outside-gateway` with zero fetches, dead gateway, HTTP 500, redirect not followed, malformed body, 2 s timeout, missing context id (AC1/AC2/AC3). |
| `apps/server/tests/modules/integrations/handlers.test.ts:552-660` | Contract tests through the served app: an `a2a` peer → `outside-gateway`, an unknown member → `unavailable`, and a same-gateway project member reading a real registry + stub gateway thread (AC1's `apps/server/tests` layer). |
| `packages/domain/tests/dao/inbox-dao.test.ts:315-318` | Plan step 1 regression: `InboxDao.thread` keyed by a root's `threadId` returns the same dialog as its id — the key `readRemoteDialog` relies on. |

Rationale: one prefix rule (extracted, not re-derived), a union instead of a throw, and a loopback-only read that forwards nothing. The Q&A's rejections hold — no new CLI verb, no guessed same-host peers, no caching.

Real proof (Plan step 4) — a live server, not a stub-only path:
1. A stand-in peer project answered `/api/health` (`gateway: true`) and `/peer/api/inbox/messages/ctx-live-1/thread` with two messages.
2. `SPUR_PROJECTS_FILE=<tmp registry with peer + caller> SPUR_GATEWAY_PORT=4311 bun apps/cli/src/index.ts self serve --port 4312 --cwd <throwaway root>` served a throwaway project declaring `agent.fleet.members: [{ id: peer-coder, project: peer, member: coder, authEnv: PEER_A2A_TOKEN }]`.
3. `GET http://localhost:4312/api/integrations/remote-dialog?member=a95-caller-peer-coder&remoteContextId=ctx-live-1` → `{"status":"remote","messages":[{"id":"msg-root",…,"createdAt":1000},{"id":"msg-reply",…,"createdAt":2000}]}` — oldest first, read through the gateway base.
4. The same route with `member=ghost` → `{"status":"unavailable","reason":"no outbound member \"ghost\" on this project"}`.
Probe scope: a throwaway root under the OS temp dir, no repo corpus touched, both probe processes stopped and the root removed afterwards.

Gate: `spur task gate 1468 light` → PASS (10 changed files, 11 checks); `bun apps/cli/src/index.ts self exec format` applied.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/a2a-member-address.ts:65-127` extracts `resolveProjectGatewayBase` (registry match → local-only refusal → prefix → gateway probe) and `packages/app/src/services/a2a-member-address.ts:38-44` composes the card URL from it, so the dialog base and the card share one prefix rule. `packages/app/src/services/a2a-remote-dialog.ts:38-85` reads `<base>/api/inbox/messages/<remoteContextId>/thread`; proven at `packages/app/tests/services/a2a-remote-dialog.test.ts:96` (path assertion `/tslibs/api/inbox/messages/th-1/thread`). |
| R2 | MET | `packages/app/src/services/a2a-remote-dialog.ts:14-20` is the union; `:40` returns `outside-gateway` for a non-project kind, `:57-62` maps `no-entry`/`remote-host` to `outside-gateway` and other refusals to `unavailable`, and `:66-83` maps non-2xx, timeout, redirect and invalid body to `unavailable` with a reason. Cases at `packages/app/tests/services/a2a-remote-dialog.test.ts:104` (a2a), `:113` (unregistered), `:121` (dead gateway), `:129` (500), `:137` (redirect), `:148` (malformed), `:155` (2 s timeout). |
| R3 | MET | `packages/contracts/src/integrations.ts:310-332` defines the input/output schemas and `:365-378` the `GET /integrations/remote-dialog` route; the handler is `implement(contract)`-shaped at `apps/server/src/modules/integrations/handlers.ts:288-310`. Exercised through the served app at `apps/server/tests/modules/integrations/handlers.test.ts:552-660`. No `spur` CLI verb was added (`spur decision`/`integrations` surfaces unchanged). |
| R4 | MET | `packages/app/src/services/a2a-remote-dialog.ts:66-74` sends only `accept`, sets `redirect: 'error'` and a 2 s `AbortSignal.timeout`, and resolves nothing but `http://localhost:<port><prefix>`. `packages/app/tests/services/a2a-remote-dialog.test.ts:85` asserts `authorization`/`cookie`/`x-api-key`/`x-spur-token` are absent; `:137` proves the redirect target never receives the read. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — An outbound call to a same-gateway project shows the remote dialog (req: R1; R3; R4) | MET | test | `packages/app/tests/services/a2a-remote-dialog.test.ts:96` (stub loopback gateway returns the thread oldest first from the gateway inbox route) and `apps/server/tests/modules/integrations/handlers.test.ts:616` (the served app resolves a registered project member through a real registry + stub gateway). Live probe: `GET /api/integrations/remote-dialog?member=a95-caller-peer-coder&remoteContextId=ctx-live-1` on a real `spur self serve` → `{"status":"remote","messages":[msg-root(1000), msg-reply(2000)]}`. |
| AC2 — A peer outside the gateway is marked, not guessed (req: R2) | MET | test | `packages/app/tests/services/a2a-remote-dialog.test.ts:104` and `:113` — both return `{ status: 'outside-gateway' }` with `gateway.requests` length 0, i.e. no fetch was issued. |
| AC3 — A failed remote read degrades to the marker (req: R2; R4) | MET | test | `packages/app/tests/services/a2a-remote-dialog.test.ts:121` (gateway down), `:129` (500), `:137` (redirect), `:148` (malformed body), `:155` (timeout budget) — each returns `{ status: 'unavailable', reason }` and none throws. Live: `member=ghost` → `{"status":"unavailable","reason":"no outbound member \"ghost\" on this project"}`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

P1 (blocker): none.

P2 (major): none.

P3 (minor): none open.

P4 (advisory): `resolveProjectGatewayBase` keeps returning a prose `error` for the card path and adds a machine `reason` beside it, so both callers are served by one function. The prose is duplicated data (the reason is the structured half) — acceptable because `resolveProjectCardTarget`'s contract is the message text and changing it would ripple through the 1395 tests.

P4 (advisory): the handler now builds `new ProjectRegistry(env.SPUR_PROJECTS_FILE)` from the injected env slice rather than the process env. That is what makes an embedding host or a test able to point at a registry, and it is consistent with the same handler reading `SPUR_GATEWAY_PORT` from that slice; the sibling `requestContextOf` helper still reads the process env, so the two seams differ inside one module. Worth aligning the next time that helper is touched.

P4 (advisory): the live probe needed an `authEnv` on the fleet member to satisfy the fleet schema's union branches, which means a project-addressed peer is declared with a credential variable even though the dialog read forwards no credential. That is a schema constraint, not a design choice of this task; the read itself never sends it (asserted).

Residual risk: the read trusts the remote project's own thread route to enforce its own privilege boundary. Behind the gateway that route is reachable by any local caller, so the remote dialog is only as private as the peer's `/api`, which is pre-existing gateway behaviour and unchanged here. Peer-side pagination is out of scope: the route returns the whole thread, and a very long remote dialog is bounded only by the 2 s/response-size behaviour of the peer.

Disposition: PASS — one shared prefix rule, a union that never throws, loopback-only/no-credential/no-redirect read, ten unit cases plus three served-contract cases, and a live probe against a real server process with a throwaway project root.

### References

- `packages/app/src/services/a2a-member-address.ts` (~:40-78, :105-140)
- `packages/app/src/services/integrations-service.ts:292-298`
- `packages/contracts/src/inbox.ts:60-72,107,187-191`; `packages/contracts/src/integrations.ts`
- `apps/server/src/modules/a2a/index.ts:219`
- `docs/design/integrations-module.md` §3.1; feature A822

### History

- 2026-11-27T07:54:34.025Z backlog → todo (system)
- 2026-11-27T20:18:33.288Z todo → wip (system)
- 2026-11-27T20:19:08.600Z wip → testing (system)
- 2026-11-27T20:19:15.602Z testing → done (system)

