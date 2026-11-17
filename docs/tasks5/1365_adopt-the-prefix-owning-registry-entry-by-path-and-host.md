---
schema_version: 1
name: Adopt the prefix-owning registry entry by path and host
status: done
template: feature-impl
created_at: 2026-11-17T08:50:47.851Z
updated_at: "2026-11-17T09:20:11.714Z"
feature_id: Q
priority: P1
tags:
  - gateway
  - registry
  - identity

done_forced: "true"
done_reason: "Implemented inline in the 2026-11-17 session under feature Q; verify verdict PASS recorded in the task Testing section; bun run spur-check green (12558 pass, 0 fail)."
---

## 1365. Adopt the prefix-owning registry entry by path and host

### Background

With two registry entries for one path — remote `192.168.87.27:3003` and local `:3007` for `/Users/robin/xprojects/knowledge-kit` — the gateway resolved `/knowledge-kit` to the local entry but adopted the remote entry's port 3003, producing `502 ... could not reach project "knowledge-kit" at 127.0.0.1:3003`. `startRegisteredProject` resolves by path only. Covers feature scenario R3.

### Requirements

- [ ] R1. Pass the entry the prefix resolved to (normalized path **and** host) into `startRegisteredProject` / the adopt path, and keep that identity end to end.
- [ ] R2. A local prefix may only ever be served by a local entry; a same-path remote entry must never supply its port.
- [ ] R3. Keep one in-flight start promise per entry identity rather than per path, so two hosts do not coalesce onto one spawn.
- [ ] R4. Preserve the existing live-serve adoption and owner-claim behaviour for the normal single-entry case.

### Acceptance Criteria

- [ ] AC1 — A second entry for the same path on another host cannot capture a local prefix

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Thread identity through the one seam that lost it: `packages/app/src/services/project-start.ts` already normalizes and matches by path+host when it writes the registry (`findProjectIndex`), so the adopt lookup uses the same key instead of a fresh path-only scan. Rejected: banning duplicate paths in the registry (a legal, documented layout — one project served from two hosts); rejected: making the gateway prefer the highest port (arbitrary and would mask the real defect). Invariants: a prefix still maps to exactly one entry (`resolveProjectPrefix`); remote entries keep routing outside the gateway; no registry write changes key semantics.

### Plan

- [ ] Add an identity-aware lookup (path + host) beside the existing path lookup in the registry service.
- [ ] Change the adopt/start entry point used by `ensureUpstream` to take the resolved `ProjectEntry` rather than a path.
- [ ] Key the in-flight start map by identity.
- [ ] Tests: duplicate-path fixture (remote + local) proves the local port is adopted; single-entry fixture proves behaviour is unchanged; two-host fixture proves two spawns are not coalesced.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T09:18:34.025Z todo → wip (system)
- 2026-11-17T09:18:34.553Z wip → testing (system)
- 2026-11-17T09:18:35.079Z testing → done (system)
- 2026-11-17T09:20:10.509Z done → wip (system)
- 2026-11-17T09:20:11.092Z wip → testing (system)
- 2026-11-17T09:20:11.615Z testing → done (system)

