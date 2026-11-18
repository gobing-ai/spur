---
schema_version: 1
name: Resolve cross-project member addresses through the gateway
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:34.906Z
updated_at: "2026-11-18T06:18:21.426Z"
feature_id: G91
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 5

dependencies: []
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

- [ ] R1. `FleetMemberSchema` accepts `project` (a registry name or prefix) plus `member` (the target's member local id) as an alternative to `a2a`. These conflict with `a2a` and `executor` (config error). `authEnv` is required with `project`.
- [ ] R2. At dispatch, resolve `project` through the project registry to a local entry and its prefix, and read the target's project slug from its config. The card URL becomes `http://localhost:<server.gateway.port><prefix>/a2a/members/<slug>-<member>/.well-known/agent-card.json`, handed to `A2aMemberTransport` exactly as an `a2a` value would be. An unknown or ambiguous project, a non-local entry (ADR-151 reason), a gateway that isn't answering, or an unknown member each fail as `not-started` with an actionable message.
- [ ] R3. The gateway `proxy` sets `x-forwarded-host: <gateway authority>` and `x-forwarded-prefix: <prefix>` on upstream requests.
- [ ] R4. The A2A card origin is `http://<x-forwarded-host><x-forwarded-prefix>` when both headers are present, and otherwise `new URL(c.req.url).origin` as today. The upstream binds loopback only, so these headers can come only from a local process.
- [ ] R5. `spur agent doctor` reports the resolved card URL and rung for a `project` member.
- [ ] R6. Update `docs/design/a2a-member-transport.md` §4.1 (new keys) and §3.5 (card origin behind the gateway).

### Acceptance Criteria

- [ ] AC1 — A cross-project member address resolves through the gateway (req: R1, R2, R3, R4, R5, R6)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
