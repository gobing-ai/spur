---
template: feature-impl
schema_version: 1
name: "Add team + cascading member dropdowns and status toggle+confirm to Terminal toolbar"
description: ""
status: todo
type: task
profile: standard
feature_id: M1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-15T05:35:23.261Z"
updated_at: "2026-07-15T05:54:07.555Z"
---

## 0259. Add team + cascading member dropdowns and status toggle+confirm to Terminal toolbar

### Background
M1 requires direct Terminal access without Roster prerequisite (R1, R2).

Currently TerminalTab only renders MemberTerminal when `useTeamsSelection().selectedMemberId` is set (which came from clicking a row in RosterTab).

This task moves the selection surface into the Terminal tab itself:
- Two dropdowns in the toolbar: Team (from agent.team.* keys in config) then Member (cascading from the chosen team's members).
- Live status enrichment (reuse or call the existing /api/team/teams logic).
- Status badge + toggle button. Clicking the toggle when running shows a confirmation Modal before calling stop.

Selection state for Terminal becomes local to this view (per M1 decision).

This task owns the toolbar + selection UX. The actual member terminal streaming stays in MemberTerminal.
### Requirements
R1. In TerminalTab (or a new Toolbar component), render a Team <select> whose options come from the teams returned by /api/team/teams (or equivalent declarative config surface).

R2. The Member <select> options are derived from the selected team's members; show id + type + live status badge.

R3. When a member is chosen, render <MemberTerminal agentId={selected} /> immediately (no external selection required).

R4. Add a status control next to the pickers: Badge showing running/stopped + a toggle button. If current status === 'running', the toggle must present a confirmation dialog (use existing Modal) before issuing the stop POST.

R5. The toolbar must still show the previous "connected" / reconnecting indicator from the SSE.

R6. Store/retrieve the last chosen team+member using localStorage (shared with 0263 polish).

R7. Graceful empty state when no teams are configured or no members.
### Acceptance Criteria
```gherkin
@core
Scenario: R1 Terminal provides direct team and member selection
  Given a project with .spur/config.yaml containing at least one agent.team entry with members
  And spur serve is running (so /api/team/teams returns live status)
  When the operator opens the Teams module and switches to the Terminal tab
  Then the toolbar renders a Team dropdown populated from the teams in the response
  And selecting a team immediately populates a Member dropdown with that team's members
  And each member option shows id, type, and current status badge
  And choosing a member renders its MemberTerminal view with live output

@core
Scenario: R2 status toggle requires confirmation for running members
  Given a running team member is attached in the Terminal tab
  When the operator clicks the status toggle / stop control
  Then a confirmation Modal is shown with clear warning text
  And the stop action is only issued after the operator confirms
  And on cancel the modal closes with no side effects

@edge
Scenario: Graceful handling when no teams are configured
  Given a project with no agent.team entries in .spur/config.yaml
  When viewing the Terminal tab
  Then a clear empty state message is shown ("No teams defined...")
  And no crashes or broken dropdowns occur

@edge
Scenario: Persisted selection is restored
  Given the operator previously selected team "alpha" member "alpha-claude" in Terminal
  When the browser tab is reloaded while on the Terminal tab
  Then the same team and member are pre-selected (if still present in current config)
  And the terminal view is rendered for it
```
### Q&A
**Q: Should Terminal selection still use the shared TeamsContext / useTeamsSelection?**

A: No. Per M1 wayfind decision, Terminal selection is local to the Terminal view only. Messages will show all members (unfiltered). We keep the Context provider on the shell for now (it may still be useful for other tabs or during transition) but TerminalTab will not consume the selection from it for its picker.

**Q: Where should the new toolbar live — inside MemberTerminal or in TerminalTab?**

A: Move the selection toolbar into TerminalTab (or a small extracted `TeamSelector.tsx`). MemberTerminal should receive the `agentId` as a prop and focus only on rendering the terminal + its inner status/connected line + input. This keeps concerns separated.

**Q: Do we need a new API endpoint for teams list, or reuse /api/team/teams?**

A: Reuse `/api/team/teams`. It already returns the declarative teams + live status from the supervisor. Perfect for the dropdowns. No new contract needed for v1.

**Q: Confirmation modal — use existing Modal or something custom?**

A: Use the project's `ui/Modal` + a simple message + Yes/No buttons. Keep it consistent with other confirmations in the app.

**Q: LocalStorage key and format?**

A: Use a stable key like `spur:board:teams:lastTerminal`. Store `{ teamId: string, memberId: string }`. Validate on restore against the current live teams list.
### Design
**Approach**

Move member selection out of the Roster tab and into the Terminal tab's own toolbar. TerminalTab will own local `useState` for the selected `teamId` and `memberId` (breaking the previous coupling through `TeamsContext` for this view).

Data source:
- Call the existing `GET /api/team/teams` (already used by RosterTab and enriched with live supervisor status).
- Client-side cascading: team dropdown drives the member options for that team.
- No new backend endpoint required for v1.

UI:
- Use the project's `<Select>` wrapper (daisyUI `select-*` classes) for consistency.
- Place the toolbar at the top of the Terminal tab (or inside the rendered MemberTerminal when a member is chosen).
- Keep the existing inner header (status badge + "connected" indicator) once a member is selected; the new dropdowns replace the "select from Roster" empty state.
- Status toggle: render a button next to the status Badge. On click when `running`, open a confirmation `<Modal>` (reuse existing `ui/Modal`). Only on confirm call the stop endpoint and refresh status.

State & persistence:
- Local React state in TerminalTab for the current attachment.
- Use `localStorage` (key e.g. `spur:teams:lastTerminalSelection`) to remember last team+member across reloads (coordinated with task 0263).
- On mount, attempt restore + validate against current teams list.

Selection model (per M1):
- Terminal's choice is **local** to the Terminal tab. It does not drive MessagesTab (which becomes unfiltered/all-members per M1 decision).
- `TeamsContext` / `useTeamsSelection` can be simplified or kept only for legacy paths during transition.

Error/empty handling:
- If no teams in `.spur/config.yaml` or fetch fails: clear, friendly empty state.
- If selected member disappears (stopped team, etc.): fall back gracefully.

Impacted files:
- `apps/web/src/modules/teams/TerminalTab.tsx` (main owner of new toolbar + local state)
- `apps/web/src/modules/teams/MemberTerminal.tsx` (may receive agentId as prop only; toolbar logic moves up)
- `apps/web/src/modules/teams/TeamsContext.tsx` (possible cleanup of selection if no longer shared)
- Tests in `apps/web/tests/modules/teams/`
- Possibly extract a small `TeamMemberSelector.tsx` if it grows.

Tradeoffs:
- Duplication of "team list + status" fetching vs Roster (acceptable for now; can later extract a `useTeamsData` hook).
- Native `<select>` or `<Select>` is sufficient; no need for searchable combobox yet.
- Confirmation modal prevents accidental stops (R2).

Constraints / invariants:
- Must continue to work when `spur serve` is not running (graceful degradation to "no live status").
- Selection must not require Roster tab to be present (R4).
- LocalStorage key must be stable and not conflict with other Spur board state.
### Plan
1. Modify TerminalTab.tsx to own local teamId / memberId state (remove or ignore the global useTeamsSelection for its own picker).
2. Build or reuse two <select> (or the project's Select) components in the toolbar area of MemberTerminal or a new wrapper.
3. Implement loading of team list (fetch /api/team/teams or a dedicated config endpoint) and derive member options.
4. Add status polling + toggle logic with confirmation Modal (reuse ui/Modal and existing stop/start URLs).
5. Wire localStorage persist/restore (coordinate with 0263).
6. Update any shared context usage or tests that assumed Roster selection.
7. Verify against M1 R1/R2 AC.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

M1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
