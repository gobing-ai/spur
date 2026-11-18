---
schema_version: 1
name: Gateway health counters rendered by self status
status: done
template: feature-impl
created_at: 2026-11-18T05:29:27.372Z
updated_at: "2026-11-18T08:21:38.007Z"
feature_id: K42
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 2.5

done_forced: "false"
done_reason: unforced close
---

## 1385. Gateway health counters rendered by self status

### Background

The gateway's `/api/health` (`packages/app/src/services/project-gateway.ts:373-384`) returns `{ ok, gateway: true, port, projects: [{ name, prefix, running }] }`, which is liveness only.

**Refine corrections (2026-11-17)**
- "spur self status reads /api/health" (the gateway's) → `collectSelfStatus` probes the current *project's* serve health (`packages/app/src/services/self-status.ts:223`). It never probes the gateway, and `SelfStatusSections` (`:52-62`) has no gateway section → add an additive `gateway` section (scope `machine`) that probes `localhost:<server.gateway.port>/api/health`.
- "counters on the gateway instance" → the handler is a closure with no instance → counters live in that closure, incremented at the router's response boundary and in the restart branch.
- Per-project key was unspecified → names are not unique (the registry holds `knowledge-kit` twice) → key restarts by resolved prefix.

### Requirements

- [x] R1. Count in memory since handler creation: `requests`, `status4xx`, `status5xx` (by final response status, including guard refusals and 502s), and `upstreamRestarts` keyed by prefix. Counters reset on restart (feature Notes).
- [x] R2. `/api/health` adds `counters: { since, requests, status4xx, status5xx, upstreamRestarts }`. Existing fields are unchanged; `isGatewayAnswering` and `probeGatewayPort` keep working because they read only `gateway`.
- [x] R3. `spur self status` adds a `gateway` section, using the existing `SelfStatusSection` shape and deadline: `ready` with `data.counters` when the port answers as the gateway, `not-applicable` when the port is free, and `degraded` when a foreign listener holds it. Text output prints one counters line. The section is additive; `ok` semantics are unchanged.

Out of scope: persistence, per-route histograms, and an env mapping for `server.gateway.port` (pre-existing gap, proposed separately in K41).

### Acceptance Criteria

- [x] AC1 — Health exposes live counters rendered by self status (req: R1, R2, R3)

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

**Change map.**

- `packages/app/src/services/project-gateway.ts` — `counters` closure object (`since`, `requests`,
  `status4xx`, `status5xx`, `upstreamRestarts`) created once per handler; the former root arrow is
  now `handle`, wrapped by a returned function that counts each final `Response` once (5xx before
  4xx, so a 502 is never double-counted) — every path, refusals included, passes through it.
  `counters.upstreamRestarts[prefix]` increments in the single restart branch, keyed by prefix
  because registry names are not unique. `health()` spreads a copy of the counters, so the health
  read reports the count taken before its own increment and a caller cannot mutate the store.
- `packages/app/src/services/self-status.ts` — new machine-scoped `gateway` section
  (`probeGateway`), added to `SelfStatusSections` and to the section map, run inside the shared
  `bounded` deadline like the other probes. It probes `localhost:<server.gateway.port>/api/health`:
  `ready` + `data.counters` when the body says `gateway: true`, `not-applicable` when nothing
  listens (a free port is a legitimate state), `degraded` naming the port when a listener answers
  that is not the gateway. The port is read structurally with a 3000 fallback — the shared config
  type carries no `server` block (project files cannot set it; the env mapping is the K41 gap).
- `apps/cli/src/commands/status.ts` — `gatewayCountersLine(name, section)` renders exactly one
  `gateway counters: …` line, and only for a `gateway` section that actually carries counters, so a
  probe that did not answer is never printed as zeroes. The section map spreads it under its line.

**Rationale.** Closure-local counters are the smallest store that keeps the gateway stateless and a
restart honest; incrementing at the response boundary means no branch can forget to count itself; the
probe reuses the injected `fetchImpl` and shared deadline, so `spur self status` stays bounded and
never fails when no gateway runs.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `counters` is created once per handler with `since`, `requests`, `status4xx`, `status5xx`, `upstreamRestarts` (`packages/app/src/services/project-gateway.ts:381`); the returned wrapper counts every final `Response` — 5xx checked before 4xx — so guard refusals and 502s are counted (`:617`); the single restart branch increments `upstreamRestarts[prefix]` (`:521`). Tests: `packages/app/tests/services/project-gateway-counters.test.ts` — buckets for 200/404/502, a 421 in the 4xx bucket, restarts keyed by prefix across two retry rounds, a fresh handler back at zero. |
| R2 | MET | `health()` spreads `counters` (deep copy of `upstreamRestarts`) next to the unchanged `ok`/`gateway`/`port`/`projects` fields (`project-gateway.ts:414`). `isGatewayAnswering`/`probeGatewayPort` read only `gateway` (`:92-130`). Test: `project-gateway.test.ts` "answers the gateway index and /api/health at the root" now asserts the same four fields plus additive counters; `project-gateway-counters.test.ts` re-asserts the four legacy fields verbatim. |
| R3 | MET | New machine-scoped `gateway` section in `SelfStatusSections` and the section map (`packages/app/src/services/self-status.ts:62`, `:471`), probed by `probeGateway` under the shared `bounded` deadline (`:261`): `ready` with `data.counters` when the body says `gateway: true`, `not-applicable` when nothing listens, `degraded` naming the port for a foreign listener. Text mode prints one line via `gatewayCountersLine` (`apps/cli/src/commands/status.ts:97`) only when counters exist. Tests: `packages/app/tests/services/self-status-gateway.test.ts` (4 cases), `apps/cli/tests/commands/status-gateway.test.ts` (3 cases). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Live counters rendered by self status, exercised on the real handler and the real collector: `packages/app/tests/services/project-gateway-counters.test.ts` (4) + `packages/app/tests/services/self-status-gateway.test.ts` (4) + `apps/cli/tests/commands/status-gateway.test.ts` (3). |
| AC1 | MET | command | `(cd packages/app && bun test tests/services/{project-gateway-counters,self-status-gateway,self-status,project-gateway,project-gateway-events}.test.ts)` → 44 pass / 0 fail; `(cd apps/cli && bun test tests/commands/{status-gateway,status}.test.ts)` → 8 pass / 0 fail; `bunx biome check` and `bunx tsc --noEmit` clean in both workspaces; pipeline light gate PASS (`.spur/run/1385-gate.log`). |
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

- 2026-11-18T08:20:49.666Z todo → wip (system)
- 2026-11-18T08:21:35.976Z wip → testing (system)
- 2026-11-18T08:21:38.002Z testing → done (system)

