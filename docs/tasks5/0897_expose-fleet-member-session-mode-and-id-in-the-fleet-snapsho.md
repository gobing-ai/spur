---
schema_version: 1
name: Expose fleet member session mode and id in the fleet snapshot, process entries and agent status, and document the persistent-member contract
status: todo
template: feature-impl
created_at: 2026-09-17T23:19:46.557Z
updated_at: "2026-09-17T23:22:21.061Z"
feature_id: G66
priority: P2
tags:
  - fleet
  - observability
  - G66
estimate_hours: 4

dependencies: ["0896"]
---

## 0897. Expose fleet member session mode and id in the fleet snapshot, process entries and agent status, and document the persistent-member contract

### Background

Task 9 gives each member a session. Operators need to see it: `GET /api/project/fleet`, `GET /api/processes`, `spur agent status` and `spur agent list --specs` show no session information. Authority: `docs/design/session-pinned-dispatch.md` §6 (observability row), AC R5/R6; ADR-057 (durable artifacts, no terminal scraping).

### Requirements

- [ ] R1. The fleet snapshot member entry and the process entry carry `session: {{ mode, id }}` (id absent for `one-shot`); the oRPC contract in `packages/contracts` is extended and OpenAPI regenerated.
- [ ] R2. `spur agent status` and `spur agent list --specs` render mode and a shortened id; `--json` carries the full object.
- [ ] R3. The Board `AgentsView` / `MemberDetail` show the session mode (read-only text; no new interaction).
- [ ] R4. The fleet design satellite (`fleet-config-declaration.md` or its successor) and `plugins/sp/skills/spur-cli/references/agent.md` document the three modes, the reset reasons and the no-redelivery invariant.
- [ ] R5. Tests cover the contract shape and the CLI rendering; `bun run spur-check` and `bun run test-cf` pass.

### Acceptance Criteria

Covers feature G66 scenarios R5, R6.

- [ ] AC1 — Session mode and id are observable (req: R1)
- [ ] AC2 — Resumed sessions never redeliver settled messages (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: session identity is exposed through the existing snapshot/process surfaces, not a new endpoint (docs/design/session-pinned-dispatch.md §6; ADR-057 durable artifacts). Board change is display-only so no `DESIGN.md` token work is needed. Mutation policy: fleet snapshot + process entry producers (`fleet-service.ts`, supervisor process registry), `packages/contracts` + generated OpenAPI, CLI renderers, `apps/web` `AgentsView`/`MemberDetail`, tests, satellites; no loop behaviour changes (task 9).

### Plan

1. Read design §6, the fleet snapshot and process-entry producers, and the contracts for `/api/project/fleet` and `/api/processes`.
2. Add the `session` field end to end (producer → contract → OpenAPI → web).
3. Render in `agent status` / `agent list --specs`; update satellites and `agent.md`.
4. Write the tests; run `bun run spur-check` and `bun run test-cf`.
5. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
