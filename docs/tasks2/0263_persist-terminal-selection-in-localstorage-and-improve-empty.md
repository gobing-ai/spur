---
template: feature-impl
schema_version: 1
name: "Persist Terminal selection in localStorage and improve empty states / headers"
description: ""
status: done
type: task
profile: standard
feature_id: M1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-15T05:35:26.848Z"
updated_at: "2026-08-18T04:42:47.412Z"
---

## 0263. Persist Terminal selection in localStorage and improve empty states / headers

### Background
Polish items accepted into M1 scope during wayfind:
- Persist the user's last chosen team+member (for the local Terminal selection) in localStorage so that reloading or returning to the tab remembers context.
- Improve empty states, headers, and banners across the Terminal and new Processes views (e.g. "No teams defined in .spur/config.yaml", better "connected" states, member id display).
### Requirements
R1. In the Terminal selection logic (local state), on change persist `{teamId, memberId}` to localStorage under a stable key (e.g. spur:teams:lastTerminal).

R2. On mount of the Terminal tab, attempt to restore a previous selection if the team/member still exists in the current config/live data.

R3. Add or improve empty/loading states in MemberTerminal, TerminalTab, and the new ProcessesTab.

R4. Surface the composed member id and (if available) its source (from config vs generated) in the Terminal header.
### Acceptance Criteria
```gherkin
@core
Scenario: Terminal selection is persisted and restored
  Given the operator selects team "alpha" and member "alpha-claude" in the Terminal tab
  When the page is reloaded (or the tab is closed and reopened)
  Then the same team and member are pre-selected in the dropdowns
  And the MemberTerminal for that agent is rendered

@core
Scenario: Restore is validated and falls back gracefully
  Given a previously persisted selection for a member that no longer exists in the current teams config
  When the Terminal tab mounts
  Then the invalid selection is not restored
  And the UI falls back to a clean "no member selected" state (or first valid one)
  And the stale localStorage entry may be cleared

@edge
Scenario: Improved empty states are shown
  Given no teams are configured
  When viewing Terminal or Processes tabs
  Then clear, accurate empty messages are displayed (no outdated "Roster" references)

@edge
Scenario: Terminal header shows useful identity
  Given a member is attached in Terminal
  Then the header area displays the composed agent id
  And status + connected indicators remain visible and accurate
```
### Q&A
**Q: Should we persist even if the selection came from restore, or only user-initiated changes?**

A: Persist on any change to the local selection state (including programmatic restore that the user then accepts). This keeps the last-visible selection remembered.

**Q: What if localStorage is unavailable (private mode, quota, etc.)?**

A: Silently degrade — the feature just won't remember across reloads. Use the same defensive patterns already used for theme and layout state.

**Q: Do we need to listen for storage events (cross-tab sync)?**

A: Not for v1 of this polish item. Keep it simple: persist on change in this tab, restore on mount.

**Q: Where exactly to show the "source" info in the header?**

A: Keep it light. If the teams payload already includes whether a member is `spur:generated` or hand-authored, we can show a tiny badge or tooltip. If not easily available, surface just the composed id for now (the main value).

**Q: Should ProcessesTab also get persistence?**

A: No — 0263 focuses on Terminal selection (the attach surface). Processes can have its own future filters if needed.

**Q: Impact on TeamsContext?**

A: None for this task. Terminal selection remains local (per M1 decisions). We only add client-side storage on top of the local state introduced in 0259.
### Design
**Polish for Terminal selection persistence + improved UX states/headers**

This task delivers the low-hanging polish items captured in M1 scope during the wayfind:

1. Persist last Terminal selection
2. Improve empty/loading states across Terminal-related views
3. Better headers and member identity display

**Persistence**
- After 0259, TerminalTab owns local `teamId` / `memberId` state (no longer driven by global TeamsContext selection).
- On any change to that state, persist `{ teamId, memberId }` to `localStorage` under a stable key (e.g. `spur:board:teams:lastTerminal`).
- On mount of TerminalTab (or when teams data loads), attempt to restore the previous selection.
- Validate the restored selection against the current live teams list (from `/api/team/teams` or equivalent). If the team or member no longer exists (or is no longer valid), silently fall back to no selection (or first available) and clear the stored value.
- Use the same safe localStorage patterns already present in the web app (see `lib/layout-state.ts`, `lib/theme.ts` — handle quota errors, unavailable storage, etc.).

**Empty / loading / header improvements**
- TerminalTab empty state: replace the outdated "Select a member from the Roster..." message with something accurate post-Roster removal, e.g. "Select a team and member in the toolbar above" or a friendly "No member attached" with a hint.
- MemberTerminal:
  - When no frames yet: improve "No output yet." (perhaps context-aware: "Waiting for output from <agent>..." or "Member attached but no output received").
  - Header: expand the current simple "Terminal | <status> | connected" area.
    - Show the full composed agent id (e.g. `alpha-claude`).
    - Optionally surface source info (from config vs. spur:generated) if easily available from the teams payload.
    - Keep status badge + connected/reconnecting indicator.
  - Improve the "Member is <status> — input disabled." banner.
- ProcessesTab (added in 0262): ensure consistent empty/loading states and a clear header (e.g. "Supervised Processes (v1)").
- General: use existing `<Loading>` component, consistent muted/italic styling, and data-* attributes for tests.

**No new data requirements**
- Reuse the teams list fetch already performed for the dropdowns in Terminal (from 0259).
- No changes to server or core data models.

**Trade-offs / scope**
- Persistence is best-effort and client-only (lost on different browser/device — acceptable for this polish item).
- Validation on restore prevents stale selection UX.
- Header improvements are incremental; full identity preamble or richer metadata is out of scope here.
- Empty states focus on clarity after the Roster removal and new tab structure.

**Files touched (expected)**
- `apps/web/src/modules/teams/TerminalTab.tsx` (add persist/restore logic + better empty state)
- `apps/web/src/modules/teams/MemberTerminal.tsx` (header polish + improved empty messages)
- `apps/web/src/modules/teams/ProcessesTab.tsx` (consistent states/headers if not already good)
- Possibly a small helper in `lib/` or inside the module for the storage key + safe get/set.
- Tests in `apps/web/tests/modules/teams/` for restore + empty states.

This is pure polish on top of the structural changes in 0259/0260/0262. It makes the Terminal experience feel complete and remembered.
### Plan
1. Add safe localStorage helpers for the Terminal selection (key: e.g. `spur:board:teams:lastTerminal`).
   - Implement get/set with try/catch for quota/unavailable storage (follow patterns in `lib/layout-state.ts`).

2. In `TerminalTab.tsx` (after it owns local `teamId`/`memberId` state from 0259):
   - On any selection change, persist the pair.
   - On mount (after teams data is available), attempt restore + validate against current teams list.
   - If restored value is invalid, clear it and fall back gracefully.

3. Improve empty states:
   - TerminalTab: update the "no member" message to be accurate post-Roster (no mention of Roster).
   - MemberTerminal: better "No output yet." and status banners.
   - ProcessesTab: ensure consistent empty/loading states.

4. Polish MemberTerminal header:
   - Display the full agent id prominently.
   - Optionally show source hint if data is easily available.
   - Keep existing status + connected elements.

5. Add or update tests for:
   - Persist on change.
   - Restore + validation on mount.
   - Empty state rendering.

6. Run web checks and manual verification (reload after selection, no-teams case, etc.).

7. Ensure consistency with any header changes in 0259/0262.
### Solution
R1/R2 (localStorage persist/restore) already implemented during task 0259 and committed. This task only adds the remaining polish items.

| File | Lines | What / Why |
|------|-------|------------|
| `apps/web/src/modules/teams/MemberTerminal.tsx:307` | 307–308 | R4: surface composed agentId in Terminal header (`Terminal · name`), giving operator identity context. |
| `apps/web/src/modules/teams/MemberTerminal.tsx:332` | 332 | R3: improve empty output message from generic "No output yet" to context-aware "Waiting for output from {agentId}…". |
| `apps/web/src/modules/teams/ProcessesTab.tsx:135` | 135 | R3: improve empty state with actionable guidance ("Start a team agent from the Terminal tab or via `spur team start`"). |
### Testing
**Verify run:** 2026-07-15 — `/sp:dev-verify 0263 --auto --focus all --fix all --force` (standalone; status was `done`, forced re-audit)

**`--fix all` applied:**
1. Clear stale `localStorage` on invalid restore (`clearPersistedSelection` in `TerminalTab.tsx`) — design claimed clear; implementation was missing.
2. Tests for persist-on-change, stale-restore reject+clear, MemberTerminal header/empty copy, Processes empty guidance.

**Commands**
- `bun test apps/web/tests/modules/teams/components.test.tsx apps/web/tests/modules/teams/MemberTerminal.test.tsx` → **43 pass, 0 fail, exit 0**
- `spur task check 0263 --json` → pass: true

**Coverage:** N/A for React `.tsx` per monorepo gate. Targeted teams suites green.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 persist `{teamId,memberId}` | MET | `TerminalTab.tsx:78-84,155-160` key `spur:board:teams:lastTerminal`; test “persists selection… on change” |
| R2 restore + validate on mount | MET | `apps/web/src/modules/teams/TerminalTab.tsx:130-146` restore with team/member validation + clear stale; tests restore + “rejects stale…” |
| R3 empty/loading polish | MET | Terminal no-teams (`:197-203`); MemberTerminal waiting copy (`:333`); Processes guidance (`:134-137`); tests cover all three |
| R4 header agent identity | MET | `apps/web/src/modules/teams/MemberTerminal.tsx:308` agentId in header; status + connected retained; test “0263 R4: header surfaces…” |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Terminal selection is persisted and restored | MET | test | persist-on-change + restore-on-mount tests in `components.test.tsx` |
| Scenario: Restore is validated and falls back gracefully | MET | test | “rejects stale localStorage selection and clears it” — prompt remains, key removed |
| Scenario: Improved empty states are shown | MET | test | Terminal no-teams; Processes empty + `spur team start`; MemberTerminal waiting copy |
| Scenario: Terminal header shows useful identity | MET | test | `MemberTerminal.test.tsx` 0263 R4 — agentId + status + connected |

**Design conformance:** DONE — safe get/set/clear, validate-on-restore, clear stale, empty-state polish, agentId header. Optional source badge N/A (no source field in teams payload; Q&A allows id-only).

**SECUA (all):** no blockers/majors. Persistence try/catch degrades silently. No Roster wording left in Terminal/Processes empty states.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

M1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-15T21:51:39.316Z todo → wip (system)
- 2026-07-15T21:51:40.983Z wip → testing (system)
- 2026-07-15T21:51:46.572Z testing → done (system)
