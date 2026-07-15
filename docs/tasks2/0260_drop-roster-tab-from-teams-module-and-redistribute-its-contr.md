---
template: feature-impl
schema_version: 1
name: "Drop Roster tab from Teams module and redistribute its controls"
description: ""
status: todo
type: task
profile: standard
feature_id: M1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-15T05:35:23.327Z"
updated_at: "2026-07-15T05:57:35.807Z"
---

## 0260. Drop Roster tab from Teams module and redistribute its controls

### Background
From the M1 wayfind decisions (grilling 2026-07-14):

The Roster tab (introduced in 0254) served two roles:
- Live status + bulk controls (Up/Down for teams, Start/Stop per member, autostart hints).
- Selection driver for Terminal and Messages tabs.

This created a counter-intuitive UX: users had to select a member in Roster, then switch tabs to see its terminal. The feature owner decided to drop the Roster tab entirely.

Controls and status must be redistributed:
- Per-member selection + status moves into the Terminal toolbar (cascading dropdowns).
- Bulk controls and process watch will live in the new Processes tab (0262).
- Messages becomes unfiltered (global view for now).

This task owns the tab removal, default tab change, and high-level redistribution plan. Concrete control migration lives in sibling tasks.

See M1 Notes → "Decisions so far" and R4.
### Requirements
R1. Remove the Roster entry from `TEAMS_TABS` and its import in `apps/web/src/modules/teams/tabs.ts` (append-only contract means we only delete, never reorder existing ids).

R2. Update `TeamsShell.tsx` so the default `activeId` is no longer the first tab if it was Roster; prefer 'terminal' (or 'processes' once added).

R3. Remove or nullify all `useTeamsSelection` usage that was only for Roster-driven selection (Terminal and Messages will become self-sufficient per M1 decisions).

R4. Audit and remove references to RosterTab across the web app (tests, discover, etc.).

R5. Document the redistribution of Roster capabilities:
   - Team/member status → Terminal toolbar + Processes tab.
   - Up/Down bulk actions → Processes tab (or dedicated control surface).
   - Per-member Start/Stop → keep or move to Processes rows + Terminal.

R6. Ensure no compile/runtime breakage after removal (the tab contract is data-driven).
### Acceptance Criteria
```gherkin
@core
Scenario: R4 Roster tab is completely removed from the Teams module
  Given the Teams module (TeamsShell + TEAMS_TABS)
  When the tab strip is rendered
  Then the "Roster" tab does not appear
  And the tab ids are exactly ["terminal", "messages", "activity"]
  And the default active tab (initial state) is "terminal"

@core
Scenario: No runtime or compile breakage after Roster removal
  Given the web app builds and tests run
  When we remove Roster registration and references
  Then `bun run check` (lint + typecheck + unit tests for web) passes
  And no references to RosterTab or data-roster-* remain in the delivered bundle

@edge
Scenario: Redistribution notes are in place for sibling tasks
  Given M1 scope
  Then the Plan / comments in 0259 and 0262 reference that bulk controls and per-member status formerly in Roster are now their responsibility
  And M1 R4 AC comment points to this task
```
### Q&A
**Q: Should we delete the physical RosterTab.tsx file or just unregister it?**

A: Delete the file (and its tests that only exercise Roster). The tab contract is registration-based; once removed from TEAMS_TABS it is dead code. Keeping the file would leave confusing dead code and data-roster-* attributes in the tree. We clean it up in the same change.

**Q: What happens to TeamsContext / useTeamsSelection after this removal?**

A: The context was the mechanism that let Roster drive selection for Terminal and Messages. 
- Terminal will own local state (task 0259).
- Messages becomes unfiltered (M1 decision).
For this task we leave the `<TeamsProvider>` wrapper in TeamsShell (no-op if unused). A later cleanup (after 0259 + 0261) can remove the selection-related parts of the context or the provider entirely if nothing consumes it.

**Q: Why default to 'terminal' instead of 'processes'?**

A: 'terminal' is the primary attach surface the whole M1 effort is optimizing for. Processes (0262) is the watch list / control surface that absorbs the old Roster bulk actions. Defaulting to Terminal gives the user the "direct attach" experience immediately. We can change the default later when Processes is richer.

**Q: The Plan mentions a prose prerequisite on 0262. Do we need a hard frontmatter dependency?**

A: The L4 advisory complains that the prose mention of 0262 is not in `dependencies[]`. We attempted to set it; if the frontmatter update doesn't take for array fields we document the ordering in the Plan and in M1. The practical dependency is soft (redistribution notes).

**Q: Any impact on the tab append-only contract or persisted tab state?**

A: The contract is respected (we only delete the 'roster' entry; surviving ids and order of the others are unchanged). Any persisted "last tab" UI state that pointed at 'roster' will simply fall back to the new first tab. No migration needed.
### Design
**Minimal removal + redistribution**

The change is surgical on the tab registration and shell default, plus cleanup of references. No new functionality is added in this task — it only removes the Roster surface and ensures the other tabs continue to function (with selection and controls redistributed to sibling tasks 0259 and 0262).

Changes:

1. `apps/web/src/modules/teams/tabs.ts`
   - Remove `import RosterTab from './RosterTab';`
   - Remove the `{ id: 'roster', ... }` entry from `TEAMS_TABS`.
   - The array remains append-only for the remaining tabs (terminal, messages, activity). Ids stay stable.

2. `apps/web/src/modules/teams/TeamsShell.tsx`
   - Change the initial state from `TEAMS_TABS[0]?.id` (which was 'roster') to a stable default of `'terminal'`.
   - Keep the generic tablist + tabpanel rendering logic (it already works on the array).
   - The `<TeamsProvider>` wrapper stays for now (other tabs or future code may still reference context; full cleanup of selection context can happen after 0259/0261 land).

3. Cleanup references
   - `apps/web/tests/modules/teams/tabs.test.ts`: update expected ids array (remove 'roster').
   - `apps/web/tests/modules/teams/components.test.tsx`: remove or comment tests that mount `<RosterTab />` directly (or gate them under a feature flag if we keep the file temporarily).
   - Search for `data-roster-*`, `RosterTab`, `from './RosterTab'` and remove.
   - `apps/web/src/modules/teams/RosterTab.tsx` itself can remain in the tree for now (dead code) or be deleted in the same change. Prefer deletion to keep the tree clean; if tests or other references exist outside the web package, note them.

4. TeamsContext impact
   - The context was primarily the glue for "select in Roster → see in Terminal/Messages".
   - After this task + 0259:
     - Terminal will own its own local state (see 0259).
     - Messages will become unfiltered (per M1).
   - For this task we can leave the provider in place (it is a no-op if nothing consumes `useTeamsSelection` for selection). A follow-up cleanup (after 0259/0261) can remove the selection parts of the context or the provider entirely if unused.

5. Redistribution documentation (in code comments + M1)
   - Add TODO / comment in the new Processes tab (0262) and in TerminalTab (0259) pointing back to this removal.
   - Update M1 AC comment for R4.

6. Verification
   - `bun run check` (web lint + typecheck + tests)
   - Manual smoke in the board: Roster tab gone, default tab is Terminal, no broken imports.
   - `spur task check 0260`

**Trade-offs & invariants**
- We do **not** delete the physical RosterTab.tsx in a way that would break git history if someone wants to recover the old implementation; however for cleanliness we remove the file.
- Tab contract is respected (we only remove, never reorder or rename surviving tabs).
- No behavioral change to Messages or Activity in this task.
- The removal is the enabling step for the "direct Terminal" UX in 0259.

**Files touched (expected)**
- apps/web/src/modules/teams/tabs.ts
- apps/web/src/modules/teams/TeamsShell.tsx
- apps/web/src/modules/teams/RosterTab.tsx (delete)
- apps/web/tests/modules/teams/tabs.test.ts
- apps/web/tests/modules/teams/components.test.tsx
- (any other discover/registry if they hardcode tabs)
- M1 feature AC comment update (via feature refresh after)

This task is a pure removal + hygiene change. The interesting new UI lives in 0259 (Terminal toolbar) and 0262 (Processes).
### Plan
1. Edit `apps/web/src/modules/teams/tabs.ts`: remove RosterTab import and the 'roster' entry from TEAMS_TABS array.
2. Update `TeamsShell.tsx`: change initial `useState` default from TEAMS_TABS[0] to a stable 'terminal' (or 'processes' after 0262 lands). Keep the tablist rendering logic.
3. Remove direct dependencies on RosterTab from any other modules/tests (search for RosterTab and data-roster-*).
4. Audit TeamsContext usage: decide whether to keep the provider (Messages and Terminal may no longer need shared selection) or simplify it.
5. Add a note or TODO in the Processes tab task (0262) and Terminal toolbar task (0259) to absorb the control surface that Roster previously owned.
6. Run `bun run check` (or equivalent lint+test for web) and `spur task check 0260`.
7. Update M1 feature AC comments to mark R4 as covered by this task.
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
