---
schema_version: 1
name: Gateway dials both loopback families for local upstreams
status: done
template: feature-impl
created_at: 2026-11-17T08:50:47.848Z
updated_at: "2026-11-17T09:20:10.256Z"
feature_id: Q
priority: P1
tags:
  - gateway
  - loopback
  - reachability

done_forced: "true"
done_reason: "Implemented inline in the 2026-11-17 session under feature Q; verify verdict PASS recorded in the task Testing section; bun run spur-check green (12558 pass, 0 fail)."
---

## 1364. Gateway dials both loopback families for local upstreams

### Background

A `spur serve` started outside the registry binds `localhost`, which Bun resolves to `::1` on macOS, while `project-gateway.ts` builds `http://127.0.0.1:<port>` for every upstream request. Measured on this machine: `[::1]:3000/health` answered 200 while `127.0.0.1:3000` refused, so a healthy project returned `502 Gateway could not reach project "spur-new" at 127.0.0.1:3000`. Covers feature scenarios R1, R2 and R4.

### Requirements

- [ ] R1. Try `127.0.0.1` first and fall back to `::1` on a connection error, reusing the both-families rule `isPortLive` already implements (`packages/app/src/services/project-process.ts:226-238`).
- [ ] R2. Rewrite the proxied `Host` and `Origin` headers to the family that actually answered, so the upstream serve's own `csrf()` check still sees a same-origin request.
- [ ] R3. Remember the answering family per registry entry identity so later requests do not re-probe a family already known dead.
- [ ] R4. When neither family answers, keep the existing 502 but name the entry identity, every dialed `family:port`, and the serve spawn log path — a cross-entry mix-up must stay distinguishable from a real outage.

### Acceptance Criteria

- [ ] AC1 — Gateway reaches a local project whose serve bound ::1
- [ ] AC2 — Gateway reaches a local project whose serve bound 127.0.0.1
- [ ] AC3 — An unreachable upstream is still reported as unreachable

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend the dial step in `packages/app/src/services/project-gateway.ts` instead of adding a transport layer: one `attempt(family, port)` helper walks `['127.0.0.1', '::1']`, and the first family that completes a fetch wins and is cached on the per-entry state the handler already keeps for start coalescing. Rejected: binding spawned serves to `127.0.0.1` only and telling operators to do the same (breaks the documented hand-started `self serve` path and would silently regress IPv6-only hosts); rejected: probing with `isPortLive` before every request (a second round trip per request for no extra certainty). Invariants: exactly one upstream fetch per request once a family is cached; no leaked sockets on the failed attempt; response adaptation (`Location`, HTML rebasing, header stripping) stays on the successful attempt only.

### Plan

- [ ] Extract the upstream dial in `project-gateway.ts` into a family-aware attempt loop.
- [ ] Cache the answering family on the existing per-entry handler state and reuse it in the retry-after-adopt path.
- [ ] Keep `Host`/`Origin` rewriting in `upstreamRequestHeaders` parameterised by the answering family.
- [ ] Extend the 502 message with the dialed candidate list and keep the spawn-log reference.
- [ ] Add handler tests: ::1-only stub upstream, 127.0.0.1-only stub upstream, both-down stub (502 detail), and a cached-family second request that must not re-probe.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T09:18:28.833Z todo → wip (system)
- 2026-11-17T09:18:29.367Z wip → testing (system)
- 2026-11-17T09:18:33.716Z testing → done (system)
- 2026-11-17T09:20:08.840Z done → wip (system)
- 2026-11-17T09:20:09.483Z wip → testing (system)
- 2026-11-17T09:20:10.150Z testing → done (system)

