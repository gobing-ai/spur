---
template: feature-impl
schema_version: 1
name: "Task Kanban parity closure: markdown editor, metadata render, workflow-action modal + server actions"
description: ""
status: wip
type: task
profile: standard
feature_id: F7
parent_wbs: null
priority: P1
tags: ["approach-c", "board", "web"]
dependencies: []
created_at: "2026-07-03T23:35:28.255Z"
updated_at: "2026-07-04T04:13:23.907Z"
---

## 0191. Task Kanban parity closure: markdown editor, metadata render, workflow-action modal + server actions

### Background

Cycle position P3a (docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md). The Task Kanban is near parity with the legacy cc-agents board: DnD, filtering/columns, and SSE live sync are complete. Three gaps remain, catalogued with remediation detail in `docs/analysis/task-kanban-gap-analysis-v2.md` (§2–3):

Gap 1 — New Task panel (`NewTaskPanel.tsx`): plain textareas, static `w-96` width. Legacy used a markdown editor (`@uiw/react-md-editor`) with live-preview toggle for Background/Requirements and a manual resize handle.

Gap 2 — Task detail panel (`TaskDetail.tsx`): does not render `estimated_hours` or per-phase `impl_progress` bars from frontmatter (legacy showed Estimate + phase-by-phase progress with status colors: completed=green, in_progress=amber, pending=gray).

Gap 3 — Workflow actions: buttons POST to `/tasks/{wbs}/actions` but only `run` is implemented in the server handler (`apps/server/src/modules/task/handlers.ts`); refine/plan/verify/decompose/evaluate return 404. Legacy opened a modal to choose the agent channel (claude, codex, gemini, pi, opencode, antigravity, openclaw) and a skip-dependencies checkbox. Requires extending the `task.action` oRPC input schema (`packages/contracts/src/task.ts`) with `channel` and `skipDeps`, and mapping each action to the corresponding pipeline/command invocation.

This task closes F7 and, together with the A17 cutover task (feature F6), completes the Phase 1.5 exit: 'operator daily-drives the spur board'. Dependency: none on other cycle tasks (independent of P1/P2). UI work must respect the ADR-025 single UI import seam (`apps/web/src/ui.ts`) — the ui-import-seam-only rule gates it.

### Requirements
- [ ] R1 — NewTaskPanel: markdown editor with edit/live-preview toggle for Background and Requirements fields; manual width resizing via a drag handle consistent with the main layout's resize affordance; new UI dependency (if any) enters through the `apps/web/src/ui.ts` seam and passes the ui-seam rules.
- [ ] R2 — TaskDetail: render `estimated_hours` next to Priority when present; render `impl_progress` per-phase bars (planning/design/implementation/review/testing) with status color coding when present; absent fields render nothing (no placeholder noise).
- [ ] R3 — Contract: extend the `task.action` input schema in `packages/contracts/src/task.ts` with `channel` (agent name enum consistent with ts-ai-runner's AgentName union) and `skipDeps` (boolean); server router keeps compiling via `implement(contract)` (drift is a compile error).
- [ ] R4 — Server: implement all action kinds (refine/plan/run/verify/decompose/evaluate) in `apps/server/src/modules/task/handlers.ts`, mapping to the corresponding spur pipeline/command invocations with the chosen channel; unknown action returns a typed error, not 404.
- [ ] R5 — Web: action buttons open a channel-selection modal (channel + skip-dependencies) before POSTing; result/error surfaced to the operator.
- [ ] R6 — Tests: contract round-trip for the extended action input; handler tests per action kind (mock the process/pipeline seam); component behavior consistent with existing task-kanban test style.
- [ ] R7 — Full gate green: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`; manual board pass confirming all three gaps closed against the gap-analysis checklist.
### Acceptance Criteria
```gherkin
Feature: Task Kanban web parity

  Scenario: New Task panel offers markdown editing with live preview
    Given the New Task panel is open
    When the user toggles live preview on the Background or Requirements editor
    Then the markdown renders in preview mode and the panel width is manually resizable

  Scenario: Task detail shows estimate and implementation progress
    Given a task with estimated_hours and impl_progress in its frontmatter
    When the detail panel loads
    Then the estimate renders next to priority and per-phase progress bars render with status colors

  Scenario: Workflow actions prompt for a channel and reach the server
    Given a task detail panel is open
    When the user triggers a workflow action other than run
    Then a modal collects the agent channel and skip-dependencies choice
    And the server executes the action instead of returning 404
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Close the three residual gaps from `docs/analysis/task-kanban-gap-analysis-v2.md` (§2–3 carry per-gap remediation detail — read it first; DnD/filters/SSE are already at parity and must not regress). Gaps 1–2 are pure web work; gap 3 spans contract + server + web.

**Gap 1 — NewTaskPanel markdown editor + resize.** Replace the plain textareas for Background/Requirements in `NewTaskPanel.tsx` with a markdown editor with an edit/live-preview toggle (legacy used `@uiw/react-md-editor`). Any new UI dependency enters ONLY through the `apps/web/src/ui.ts` seam (ADR-025; `ui-import-seam-only` + `no-daisyui-class-leak` rules run at error severity in `recommended-pre-check`). Panel width: manual resize via a drag handle consistent with the existing layout resize affordance (the RightPanel layout already has one — reuse its pattern/hook, don't invent a second). Verify the editor respects the board's dark theme before accepting the dependency.

**Gap 2 — TaskDetail metadata.** Render `estimated_hours` next to Priority when present; render `impl_progress` per-phase bars (`planning/design/implementation/review/testing`) color-coded completed=green / in_progress=amber / pending=gray (legacy parity). Absent fields render nothing — no placeholder noise. Both fields already exist in task frontmatter; confirm the server task DTO passes them through (extend the DTO if the list/detail projection drops them — that's a contracts change, keep it additive).

**Gap 3 — workflow actions end-to-end.** Contract: extend the `task.action` input in `packages/contracts/src/task.ts` with `channel` (literal union mirroring the runner's AgentName set: `claude|codex|gemini|pi|opencode|antigravity|openclaw` — literal transport DTO, do NOT import domain types into contracts) and `skipDeps: boolean` (optional, default false). The router binds via `implement(contract)`, so drift fails compile. Server (`apps/server/src/modules/task/handlers.ts`): implement all kinds — `refine|plan|run|verify|decompose|evaluate` — via an action→invocation table. Execution channel decision: PREFER enqueueing a `task-action` job on the queue shipped by 0190 (worker executes `AgentService.executeRun` with the translated slash command, e.g. refine → `/sp:dev-refine <wbs>`, run → the task-pipeline invocation; slash-command translation per agent already exists in agent-service). This dogfoods the queue and makes actions observable in the Events/Jobs tabs. If 0190 has not merged when this starts, fall back to direct spawn through the same AgentService seam and leave a scoped follow-up to move onto the queue. Record the actual action→command table here at implementation time. Unknown action → typed error (not 404). Web: a channel modal (channel select + skip-dependencies checkbox) opens before POST; success/error surfaced.

**Testing (R6).** Contract round-trip on the extended input; handler tests per action kind with the process/queue seam mocked; component tests per existing task-kanban style (panel toggle, metadata render given/absent, modal flow).

**Risks.** UI dependency weight + dark mode (check before adopting); action spawn must be Bun-gated (CF has no process execution — module no-ops without ctx, same as SSE); don't regress the shipped parity items (gap-analysis §2 checklist is the manual regression list).

**Decomposition guidance.** Two clean subtasks if split: A = gaps 1–2 (web only); B = gap 3 (contract + server + modal). `--parent 0191`.

**Dependencies.** Soft on 0190 (preferred execution channel — see fallback above). Independent of 0189/0192–0197. Completing this + 0192 clears the Phase 1.5 exit (board daily-driver + A17).
### Plan
- [ ] Read `docs/analysis/task-kanban-gap-analysis-v2.md` §2–3; confirm the three gaps still reproduce on a live board (`spur serve`).
- [ ] Gap 1: markdown editor via the `ui.ts` seam + live-preview toggle + resizable panel (reuse the layout resize pattern); dark-mode check; component tests (R1).
- [ ] Gap 2: `estimated_hours` + `impl_progress` rendering in TaskDetail; DTO passthrough confirmed/extended; tests incl. absent-field case (R2).
- [ ] Gap 3a: extend `task.action` contract input (`channel`, `skipDeps`); compile-time bind proves router sync; contract test (R3).
- [ ] Gap 3b: server action table for all six kinds via queue-enqueue (or documented direct-spawn fallback); typed error for unknown actions; handler tests per kind (R4).
- [ ] Gap 3c: channel modal in the web detail panel; wire to POST; surface result/error; component test (R5).
- [ ] Regression sweep: DnD, filters, SSE sync still green against the gap-analysis §2 checklist.
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R7).
- [ ] Manual board pass: all three AC scenarios exercised by hand; record evidence in Testing.

<!-- AUTO-GENERATED by spur task refresh-roster -->
| WBS | Sub-task | Status |
| --- | -------- | ------ |
| 0202 | Kanban gaps 1-2: NewTaskPanel markdown editor + TaskDetail metadata (0191 wave A) | todo |
| 0203 | Kanban gap 3: task.action contract, server action table, channel modal (0191 wave B) | todo |
<!-- END AUTO-GENERATED -->
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

F7

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-04T04:13:23.907Z todo → wip (system)
