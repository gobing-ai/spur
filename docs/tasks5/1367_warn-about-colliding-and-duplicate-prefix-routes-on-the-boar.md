---
schema_version: 1
name: Warn about colliding and duplicate-prefix routes on the Board
status: done
template: feature-impl
created_at: 2026-11-17T08:50:47.852Z
updated_at: "2026-11-17T09:20:14.408Z"
feature_id: Q
priority: P2
tags:
  - board
  - web
  - gateway

done_forced: "true"
done_reason: "Implemented inline in the 2026-11-17 session under feature Q; verify verdict PASS recorded in the task Testing section; bun run spur-check green (12558 pass, 0 fail)."
---

## 1367. Warn about colliding and duplicate-prefix routes on the Board

### Background

`findPrefixCollisions` is computed only in the CLI (`apps/cli/src/commands/projects.ts:319-324`); nothing in `apps/web` or `/api/projects` reports it, so a colliding or cross-host prefix fails as an unexplained 502 inside the Board. Covers feature scenario R6.

### Requirements

- [ ] R1. Include collision and duplicate-path findings in the `/api/projects` payload the Board already consumes, derived from `findPrefixCollisions` rather than re-implemented in the browser.
- [ ] R2. Render a warning in the projects module naming the colliding prefix, both entry names, and the remedy (`spur projects add <path> --prefix /<other>`).
- [ ] R3. Keep the CLI and Board wording sourced from the same finding so the two surfaces cannot disagree.

### Acceptance Criteria

- [ ] AC1 — The Board reports a prefix collision instead of failing the route silently

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend the existing projects payload and reuse one shared message builder: the resolver in `packages/config/src/projects.ts` already returns the collision map, so the server composes `{ prefix, entries }` findings and both the CLI warning and the Board banner format from that value. Rejected: client-side collision detection (duplicates the slug rule and drifts); rejected: blocking navigation on a collision (an operator must still reach the unaffected projects). Invariants: read-only surface, no registry writes; remote entries never appear as colliding routes; the payload stays additive so older clients keep working.

### Plan

- [ ] Add the findings to the `/api/projects` contract and handler.
- [ ] Render the warning in the projects module (or switcher) with the remedy line.
- [ ] Point the CLI warning text at the same shared formatter.
- [ ] Tests: contract/handler test for the payload, web component test for the banner, and a no-findings case that renders nothing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T09:18:36.768Z todo → wip (system)
- 2026-11-17T09:18:37.300Z wip → testing (system)
- 2026-11-17T09:18:37.833Z testing → done (system)
- 2026-11-17T09:20:13.268Z done → wip (system)
- 2026-11-17T09:20:13.794Z wip → testing (system)
- 2026-11-17T09:20:14.314Z testing → done (system)

