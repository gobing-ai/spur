---
schema_version: 1
name: Render protocol events in the Board System Events view
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:15.947Z
updated_at: "2026-11-18T05:37:13.624Z"
feature_id: J94
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 1.5

dependencies: ["1376", "1377"]
---

## 1378. Render protocol events in the Board System Events view

### Background

Protocol events from 1376/1377 must read as sentences in the Board's System Events view (feature J9/J91 presenter contract). The Board is already switch-free: `apps/web/src/modules/observability/SystemEventsTab.tsx` renders the server-shipped `renderer` key and the presentation from the catalog presenters, with no per-event branches.

**Refine corrections (2026-11-17)**
- "Each new protocol event has an event-specific presenter" (old R1) → owned by 1376/1377, because the presenter record is exhaustive by type (`event-names.ts:439`) and cannot compile without them → requirement dropped. This task keeps only the end-to-end rendering proof.
- "without event-specific switches in apps/web" → already true by construction → restated as a guard, not new work.
- Estimate 2h → 1.5h after the drop.

### Requirements

- [ ] R2. The Board System Events view renders each protocol event (`mcp.tool.called`, `mcp.tool.failed`, `mcp.resource.read`, `auth.denied`, `a2a.message.received`, `a2a.task.cancelled`) through its presenter summary and fields. No change in `apps/web` adds an event-name branch.
- [ ] R3. A browser check against a seeded database captures a screenshot artifact under `docs/tasks5/artifacts/1378/`.
- [ ] R4. The history/system-events read API returns the presenter output for those names. A server test asserts this, so the proof is repeatable without a browser.

Out of scope: authoring presenters (1376/1377) and any Board redesign.

### Acceptance Criteria

- [ ] AC1 — Protocol events read as sentences in the Board (req: R2, R3, R4)

Test layer: a server read-API test (repeatable) plus a browser screenshot artifact (human-verifiable).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:36:42.778Z

- **Merge into 1376/1377?** Proposed, not executed. Kept as a separate verification step because it needs both producers, and the screenshot artifact is cross-cutting.

### Design

**WHAT.** Verification only, with no new production code expected. Seed the six events through the real bus and tap into a temp project database, start `spur serve`, open Observability → System Events, and capture the view. In a server test, assert the read API returns each event's presentation `summary`.

**WHY.** 1376/1377 prove persistence. This task proves the operator-facing outcome (feature R5). The API-level test makes it repeatable, and the screenshot is the human-verifiable artifact the testing policy asks for.

**Anti-patterns.** No `if (name === 'mcp…')` in `apps/web`. Don't hand-insert DB rows, emit through the bus. If rendering is wrong, fix the presenter in `event-names.ts`, not the Board.

**Dependencies.** 1376 and 1377 must be done; this task assumes their catalog names and presenters.

### Plan

- [ ] Step 1 (R4): find the existing read-API test for system events (`rg -l "system-events\|systemEvents" apps/server/tests`) and add one case per protocol event asserting the presenter summary.
- [ ] Step 2 (R2/R3): seed the events, run `spur self serve`, browser-check System Events, and save the screenshot under `docs/tasks5/artifacts/1378/`.
- [ ] Step 3: run `rg -n "mcp\.tool|a2a\.message|auth\.denied" apps/web/src` and expect no matches (switch-free guard). Then run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
