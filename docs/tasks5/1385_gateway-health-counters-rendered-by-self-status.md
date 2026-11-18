---
schema_version: 1
name: Gateway health counters rendered by self status
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:27.372Z
updated_at: "2026-11-18T05:48:10.460Z"
feature_id: K42
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 2.5

---

## 1385. Gateway health counters rendered by self status

### Background

The gateway's `/api/health` (`packages/app/src/services/project-gateway.ts:373-384`) returns `{ ok, gateway: true, port, projects: [{ name, prefix, running }] }`, which is liveness only.

**Refine corrections (2026-11-17)**
- "spur self status reads /api/health" (the gateway's) → `collectSelfStatus` probes the current *project's* serve health (`packages/app/src/services/self-status.ts:223`). It never probes the gateway, and `SelfStatusSections` (`:52-62`) has no gateway section → add an additive `gateway` section (scope `machine`) that probes `localhost:<server.gateway.port>/api/health`.
- "counters on the gateway instance" → the handler is a closure with no instance → counters live in that closure, incremented at the router's response boundary and in the restart branch.
- Per-project key was unspecified → names are not unique (the registry holds `knowledge-kit` twice) → key restarts by resolved prefix.

### Requirements

- [ ] R1. Count in memory since handler creation: `requests`, `status4xx`, `status5xx` (by final response status, including guard refusals and 502s), and `upstreamRestarts` keyed by prefix. Counters reset on restart (feature Notes).
- [ ] R2. `/api/health` adds `counters: { since, requests, status4xx, status5xx, upstreamRestarts }`. Existing fields are unchanged; `isGatewayAnswering` and `probeGatewayPort` keep working because they read only `gateway`.
- [ ] R3. `spur self status` adds a `gateway` section, using the existing `SelfStatusSection` shape and deadline: `ready` with `data.counters` when the port answers as the gateway, `not-applicable` when the port is free, and `degraded` when a foreign listener holds it. Text output prints one counters line. The section is additive; `ok` semantics are unchanged.

Out of scope: persistence, per-route histograms, and an env mapping for `server.gateway.port` (pre-existing gap, proposed separately in K41).

### Acceptance Criteria

- [ ] AC1 — Health exposes live counters rendered by self status (req: R1, R2, R3)

Test layer: the real gateway handler plus `collectSelfStatus` with an injected fetch.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:48:09.683Z

- **Where does self status show this?** Closed: a new additive machine-scoped `gateway` section, not the project section.
- **Restart key?** Closed: prefix, because names collide.
- **Persistence?** Dropped by design: counters reset on restart, and durable history stays in each project's system_events.

### Design

**WHAT.** In `createGatewayHandler`, create `const counters = { since: new Date().toISOString(), requests: 0, status4xx: 0, status5xx: 0, upstreamRestarts: {} as Record<string, number> }`. Wrap the root `fetch` so each final `Response` increments `requests` and its status bucket, and increment `upstreamRestarts[prefix]` in the restart branch. `health()` spreads `counters`. In `self-status.ts`, add `gateway` to `SelfStatusSections`. The probe reuses the `fetchImpl` and deadline and reads `config.server.gateway.port` (default 3000).

**WHY.** A closure-local object is the smallest stateless-compatible store. The response-boundary wrapper counts every path, including refusals, without touching each branch. A machine-scoped section fits the gateway, which is per-user, not per-project.

**WHERE.** `packages/app/src/services/project-gateway.ts`, `packages/app/src/services/self-status.ts`, the self status text renderer in `apps/cli`, `docs/design/cli-contracts.md` (section list) and `docs/design/project-gateway.md` (health shape).

**Anti-patterns.** Don't persist counters. Don't make self status fail when no gateway runs. Don't key by name.

### Plan

- [ ] Step 1 (test first, R1/R2): drive a real handler through 200, 404, 421 and 502 responses plus one restart, then assert the `/api/health` counters and that the existing fields are unchanged.
- [ ] Step 2 (test first, R3): a self-status test with an injected `fetchImpl` covering the gateway, free-port and foreign-listener cases, plus a text-render snapshot of the counters line.
- [ ] Step 3: implement the counters, the health field and the self-status section and renderer.
- [ ] Step 4: update `cli-contracts.md` and `project-gateway.md`, run the focused tests in `packages/app` and `apps/cli`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
