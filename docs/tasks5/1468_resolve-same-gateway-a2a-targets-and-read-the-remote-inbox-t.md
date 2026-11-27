---
schema_version: 1
name: Resolve same-gateway A2A targets and read the remote inbox thread for an outbound receipt
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:46.757Z
updated_at: "2026-11-27T16:55:50.124Z"
feature_id: A822

estimate_hours: 5
priority: P2
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

- [ ] R1. An application function `readRemoteDialog({ member, remoteContextId })` resolves a `kind: 'project'` member to its gateway base `http://localhost:<port><prefix>` by reusing `resolveProjectCardTarget`'s registry and prefix logic, extracted into a shared helper without duplication. It then reads `<base>/api/inbox/messages/<remoteContextId>/thread`.
- [ ] R2. The result is a discriminated union: `{ status: 'remote', messages }`, or `{ status: 'outside-gateway' }` for an `a2a`-kind member or a project with no local registry entry, or `{ status: 'unavailable', reason }` when there is no gateway, a non-2xx response, a timeout (2s budget), or an invalid body.
- [ ] R3. An oRPC procedure `integrations.remoteDialog` (contract in `packages/contracts/src/integrations.ts`, handler via `implement(contract)`) exposes it to the Board. No public `spur` CLI verb is added.
- [ ] R4. The read never forwards local credentials. It is loopback-only, with `redirect: 'error'`.

Out of scope: rendering (task 1469); peers on other hosts; writing to the remote inbox.

### Acceptance Criteria

- [ ] AC1 — An outbound call to a same-gateway project shows the remote dialog (req: R1; R3; R4) — unit: `packages/app/tests` proves `readRemoteDialog` on a registered `project` member returns `{ status: 'remote', messages }` oldest first from `<base>/api/inbox/messages/<threadId>/thread` (stub loopback server), with `redirect: 'error'` and no credential headers; contract test in `apps/server/tests` exercises `integrations.remoteDialog`.
- [ ] AC2 — A peer outside the gateway is marked, not guessed (req: R2) — unit: `packages/app/tests` proves an `a2a`-kind member and an unregistered project both return `{ status: 'outside-gateway' }` with no fetch issued.
- [ ] AC3 — A failed remote read degrades to the marker (req: R2; R4) — unit: `packages/app/tests` proves gateway-down, non-2xx, 2s timeout and malformed body each return `{ status: 'unavailable', reason }` without throwing.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/app/src/services/a2a-member-address.ts` (~:40-78, :105-140)
- `packages/app/src/services/integrations-service.ts:292-298`
- `packages/contracts/src/inbox.ts:60-72,107,187-191`; `packages/contracts/src/integrations.ts`
- `apps/server/src/modules/a2a/index.ts:219`
- `docs/design/integrations-module.md` §3.1; feature A822

### History

- 2026-11-27T07:54:34.025Z backlog → todo (system)

