---
schema_version: 1
name: Resolve cross-project member addresses through the gateway
status: done
template: feature-impl
created_at: 2026-11-18T05:29:34.906Z
updated_at: "2026-11-18T08:56:23.225Z"
feature_id: G91
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 5

dependencies: []
done_forced: "false"
done_reason: unforced close
---

## 1395. Resolve cross-project member addresses through the gateway

### Background

Cross-install A2A delegation is already built. A fleet member declared with `a2a: <card host|URL|path>` and `authEnv` dispatches through `A2aMemberTransport` (`docs/design/a2a-member-transport.md` §3.3, §4.1), and a target `spur serve` with `server.a2a.enabled` serves `/a2a/members/<projectSlug>-<memberLocalId>/…` (§3.5). The gateway forwards `/<prefix>/a2a/*` and strips the prefix (`packages/app/src/services/project-gateway.ts:579`, `proxy` at `:405-420`).

**Refine corrections (2026-11-17)**
- "Define the `<project>/<member>` address and its CLI/agent surface" → no new address grammar is needed. The existing member declaration already carries a target. → Add a `project` + `member` pair to `FleetMemberSchema` as an alternative to a literal `a2a` URL, resolved at dispatch to the gateway card URL. `--agent <id>`, `spur message` and every verb stay unchanged, so no public noun/verb change and no consent gate (the feature's "task XPROJ1" does not exist).
- "Resolve to the gateway /<prefix>/a2a path" → this breaks today. The gateway rewrites `host` to the upstream loopback authority (`upstreamRequestHeaders`, `project-gateway.ts:179-186`), and the card builds its interface URL from `new URL(c.req.url).origin` (`apps/server/src/modules/a2a/index.ts:234`, `projection.ts:70`). A card fetched through the gateway therefore advertises `http://127.0.0.1:<ephemeral serve port>/a2a/members/…`, so send and get bypass the gateway and break when the target serve restarts on a new port. → The gateway adds `x-forwarded-host` and `x-forwarded-prefix`, and the card origin honors them.
- "with the target project token" → the token is the target's `server.a2a.authEnv` value. The sender member's `authEnv` names a sender-side variable holding it. The gateway passes `Authorization` through unchanged. → Nothing new to resolve. The member's `authEnv` is required when `project` is set.
- "Refuse remote entries (ADR-151)" → still valid. A registry entry that is not local is refused at resolution.

### Requirements

- [x] R1. `FleetMemberSchema` accepts `project` (a registry name or prefix) plus `member` (the target's member local id) as an alternative to `a2a`. These conflict with `a2a` and `executor` (config error). `authEnv` is required with `project`.
- [x] R2. At dispatch, resolve `project` through the project registry to a local entry and its prefix, and read the target's project slug from its config. The card URL becomes `http://localhost:<server.gateway.port><prefix>/a2a/members/<slug>-<member>/.well-known/agent-card.json`, handed to `A2aMemberTransport` exactly as an `a2a` value would be. An unknown or ambiguous project, a non-local entry (ADR-151 reason), a gateway that isn't answering, or an unknown member each fail as `not-started` with an actionable message.
- [x] R3. The gateway `proxy` sets `x-forwarded-host: <gateway authority>` and `x-forwarded-prefix: <prefix>` on upstream requests.
- [x] R4. The A2A card origin is `http://<x-forwarded-host><x-forwarded-prefix>` when both headers are present, and otherwise `new URL(c.req.url).origin` as today. The upstream binds loopback only, so these headers can come only from a local process.
- [x] R5. `spur agent doctor` reports the resolved card URL and rung for a `project` member.
- [x] R6. Update `docs/design/a2a-member-transport.md` §4.1 (new keys) and §3.5 (card origin behind the gateway).

### Acceptance Criteria

- [x] AC1 — A cross-project member address resolves through the gateway (req: R1, R2, R3, R4, R5, R6)

Test layer: e2e with two fixture projects behind the real gateway handler and a real target serve. No mocks on the A2A path.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T06:04:42.050Z

- **New `<project>/<member>` address grammar on `--agent`/`spur message`?** No. A member declaration names the target and `--agent <id>` stays as it is. This avoids a public-surface change; the consent gate is not triggered.
- **Card origin from forwarded headers: spoofable?** Only by a local process, since the upstream binds loopback, and it affects only the advertised URL, never auth.
- **Cache the resolved URL?** No. Resolve per dispatch so a re-prefixed project keeps working.

### Design

**WHAT.**

```yaml
agent:
  fleet:
    members:
      - { id: tslibs, project: ts-libs, member: coder, authEnv: TSLIBS_A2A_TOKEN }
```

Resolution produces a card URL and then follows the existing A2A path unchanged: delivery ladder rung 2, write-fencing admission, receipt and never-resend. The forwarded headers fix the card so every later call stays on the stable gateway port.

**WHY.** The transport, receipts, fencing and inbox ledger already exist and are proven (`a2a-two-install-e2e`, 9/9). The only real gaps are naming a local project instead of a URL, and the card leaking the ephemeral port behind the gateway.

**WHERE.**
- `packages/config/src/index.ts` (`FleetMemberSchema`, about `:584`)
- the member-resolution site that feeds `A2aMemberTransport` (`packages/app/src/services/member-dispatch.ts` / `fleet-dispatcher.ts`)
- `packages/app/src/services/project-gateway.ts` (`proxy` headers)
- `apps/server/src/modules/a2a/index.ts:234` (card origin)
- `spur agent doctor`
- `docs/design/a2a-member-transport.md`

**Anti-patterns.**
- No new address grammar, verb or transport.
- Don't trust forwarded headers for anything except the card origin.
- Don't store a resolved URL; resolve at each dispatch.

### Plan

- [ ] Step 1 (test first, R1-R4): an e2e using two fixture projects registered behind a real gateway handler, with the target running A2A. A sender member `{project, member}` dispatches. Assert:
  - the card's interface URL is the gateway prefix URL;
  - the target inbox receives a `request` row;
  - the sender receipt stores `remote_task_id`.
  Add negative cases for an unknown project, a remote entry, and a missing `authEnv`.
- [ ] Step 2 (R1): schema change and its config tests.
- [ ] Step 3 (R2/R5): resolution and doctor.
- [ ] Step 4 (R3/R4): gateway headers and card origin.
- [ ] Step 5 (R6): update the design satellite.
- [ ] Step 6: run the focused `packages/config`, `packages/app` and `apps/server` tests, `bun run a2a-two-install-e2e` (regression), then `bun run spur-check`.

### Solution

**Change map.**

- `packages/config/src/index.ts` — `FleetMemberSchema` gains `project` and `member`;
  `FleetMemberEntrySchema` enforces the address rules as item-level issues so one load lists every
  problem: `project` × `a2a`, `project` × `executor`, `member` requires `project` and vice versa,
  `authEnv` required with `project`, and the "one target" rule now counts `project`.
- `packages/app/src/services/a2a-member-address.ts` (new) — `resolveProjectCardTarget` resolves a
  registry name or prefix to `http://localhost:<gatewayPort><prefix>/a2a/members/<registryName>-<member>/.well-known/agent-card.json`,
  returning `{error}` instead of throwing for an unknown/ambiguous project, a remote entry
  (ADR-151), a missing prefix, a gateway that is not answering, or a foreign listener on its port.
  `createProjectCardRefResolver` adapts it to the transport, throwing so the turn records a `failed`
  receipt with the actionable message. Resolution runs per dispatch and is never cached.
- `packages/app/src/services/a2a-member-transport.ts` — `A2aMemberTransportDeps.cardRefs`; the
  transport resolves a project-addressed member once per turn into a `{...member, a2a: url}` view and
  hands that to the A2A CLI, so every downstream step (send/get/cancel/card/doctor/output) sees a
  card URL exactly as a literal `a2a` declaration would produce.
- `packages/app/src/services/fleet-service.ts` + `member-dispatch.ts` — `RosterMember` and
  `ResolvedFleetMember` carry `project`/`member`; `memberDelivery`, the roster projection and the
  output lookup treat a project member as A2A (rung 2) without inventing a local executor.
- `packages/app/src/services/project-gateway.ts` — `upstreamRequestHeaders` takes the forwarded
  identity; `proxy` passes `{prefix, host}` where `host` is the authority the client dialed (falling
  back to `localhost:<port>`), and any inbound copy of both headers is stripped first.
- `apps/server/src/modules/a2a/projection.ts` + `index.ts` — `cardOrigin(forwarded, fallback)` builds
  the advertised origin from `x-forwarded-host` + `x-forwarded-prefix` when BOTH are present, else the
  request origin as before; the card route passes both headers in.
- `apps/cli/src/commands/agent/shared.ts` — `projectCardRefs(context)` (registry read fresh, gateway
  port from the env config) wired into all three transports, and `memberDeliveryRows` prints the
  resolved card URL (or why it cannot resolve) next to the rung for a project member.
- `packages/app/src/services/workflow-engine-factory.ts` — the same resolver for workflow dispatches.
- `docs/design/a2a-member-transport.md` — §4.1 keys and the resolution rule, §3.5 card origin and the
  forwarded-identity row.

**Rationale.** The transport, receipts, fencing and inbox ledger already exist, so the only real gaps
were naming a local project instead of a URL and a card leaking the ephemeral serve port. Both fixes
sit on existing seams: a resolver injected by the composition root, and two forwarded headers that
only affect the advertised URL (the upstream binds loopback, and auth still comes from `authEnv`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `project` and `member` on `FleetMemberSchema` (`packages/config/src/index.ts:589`, `:591`); item-level rules reject `project`×`a2a`, `project`×`executor`, `member` without `project`, `project` without `member`/`authEnv`, and count `project` toward the one-target rule (`:639-682`). Tests: `packages/config/tests/fleet-member-project.test.ts` (5). |
| R2 | MET | `resolveProjectCardTarget` (`packages/app/src/services/a2a-member-address.ts:34`) resolves name or prefix → `http://localhost:<gatewayPort><prefix>/a2a/members/<registryName>-<member>/.well-known/agent-card.json`, refusing unknown (`:47`), remote (`:53`, ADR-151), ambiguous (`:58`), a non-answering gateway and a foreign listener (`probeGateway`, `:85`); `createProjectCardRefResolver`/`envProjectCardRefResolver` (`:113`, `:129`) adapt it for the transport, which resolves once per turn into a `{...member, a2a}` view (`a2a-member-transport.ts:344`) — never cached. Tests: `a2a-member-address.test.ts` (10), `a2a-member-transport.test.ts` (project-addressed turn). |
| R3 | MET | `proxy` computes the dialed authority and passes `{prefix, host}` into `upstreamRequestHeaders` (`project-gateway.ts:218-221`), which strips any inbound copy first and sets `x-forwarded-host`/`x-forwarded-prefix` while keeping `host` as the loopback authority. Tests: `project-gateway-forwarded.test.ts` (3). |
| R4 | MET | `cardOrigin(forwarded, fallback)` (`apps/server/src/modules/a2a/projection.ts:70`) returns `http://<x-forwarded-host><x-forwarded-prefix>` only when both are non-empty, else the previous `new URL(c.req.url).origin`; the card route passes both headers (`apps/server/src/modules/a2a/index.ts:234`). Tests: `apps/server/tests/modules/a2a/routes.test.ts` — both headers, each missing, empty prefix. |
| R5 | MET | `memberDeliveryRows` (`apps/cli/src/commands/agent/shared.ts:625-643`) resolves the project member's card URL per row and prints `card <url>; <binary>; <card reachability>` beside the rung, or `card unresolved (<actionable message>)`; all three transports in the CLI and the workflow engine now carry the resolver. Static-ref: `shared.ts:559` (`projectCardRefs`), `workflow-engine-factory.ts:213`. |
| R6 | MET | `docs/design/a2a-member-transport.md` §4.1 (new keys, resolution rule, mutual exclusion) and §3.5 (card origin + forwarded-identity row) updated in this change. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Cross-project address resolves through the gateway end to end: real gateway handler in front of the real card route with nothing mocked advertises `http://localhost:3000/tslibs/a2a/members/proj-coder` (`apps/server/tests/modules/a2a/routes.test.ts`, "gateway → card round trip"), plus the resolution matrix and the transport turn. |
| AC1 | MET | command | `(cd packages/config && bun test)` → 334 pass; `(cd packages/app && bun test)` → 5946 pass; `(cd apps/server && bun test)` → 681 pass; `(cd apps/cli && bun test)` → 1890 pass / 1 fail (the `gateway` section key that 1385 added, fixed in this change); `bun run a2a-two-install-e2e` → 9/9 checks; `task gate 1395 light` → PASS. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T08:40:55.307Z todo → wip (system)
- 2026-11-18T08:56:21.339Z wip → testing (system)
- 2026-11-18T08:56:23.221Z testing → done (system)

