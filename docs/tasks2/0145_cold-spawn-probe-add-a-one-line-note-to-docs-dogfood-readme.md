---
template: standard
schema_version: 1
name: "COLD-SPAWN PROBE: add a one-line note to docs/dogfood README"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-28T21:51:32.332Z"
updated_at: 2026-06-28T21:57:31.776Z
---

## 0145. COLD-SPAWN PROBE: add a one-line note to docs/dogfood README

### Background
Probe task for the 0144 cold-spawn verification of `sp:super-coder`. The deliverable is trivial and
low-risk on purpose — the point is to observe the agent's done-time housekeeping (checkbox flipping,
honest transition, gate evidence, `/tmp` cleanup, dogfood persistence) **from its definition alone**,
not the work itself.

Deliverable: create `docs/dogfood/README.md` with a one-paragraph note explaining that this
directory holds dogfood reports named `YYYY-MM-DD-<testee-slug>-dogfood.md`.
### Acceptance Criteria

```gherkin
Feature: COLD-SPAWN PROBE: add a one-line note to docs/dogfood README

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Plan
- [x] P1 — Created `docs/dogfood/README.md` with a one-paragraph note: this directory holds dogfood
      reports, named `YYYY-MM-DD-<testee-slug>-dogfood.md`, produced by `/sp:dev-dogfood --save` or
      the `sp:super-coder` dogfood mode.
- [x] P2 — Confirmed the file reads cleanly (no broken markdown).
- [x] P3 — Ran the gate (`bun run lint`) — clean (Biome 0 findings, all 7 workspaces typecheck pass).
### Solution

### Testing

### Review

### References

### History
- 2026-06-28T21:56:03.799Z backlog → todo (system)
- 2026-06-28T21:57:18.035Z todo → wip (system)
- 2026-06-28T21:57:28.283Z wip → testing (system)
- 2026-06-28T21:57:31.776Z testing → done (system)
