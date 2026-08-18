---
template: feature-impl
schema_version: 1
name: "Wire Processes Attach to TerminalTab local selection"
description: ""
status: done
type: task
profile: standard
feature_id: M2
parent_wbs: null
priority: P1
tags: ["teams", "terminal", "processes"]
dependencies: []
created_at: "2026-07-15T23:03:21.117Z"
updated_at: "2026-08-18T04:42:47.433Z"
---

## 0265. Wire Processes Attach to TerminalTab local selection

### Background

ProcessesTab dispatches CustomEvent teams:attach-process with agentId, but TerminalTab never listens. Attach is a no-op for operators. M1 Q&A deferred full wiring until Terminal local selection was stable (0259 done).

### Requirements
R1. TerminalTab (or TeamsShell) listens for teams:attach-process.
R2. On event, resolve teamId containing the agentId from live /api/team/teams (or cached teams data).
R3. Set local teamId + memberId so MemberTerminal mounts for that agent.
R4. Optionally switch the active tab to Terminal when Attach is clicked from Processes.
R5. Persist selection via existing localStorage path.
R6. Tests cover event → selection + MemberTerminal mount.
### Acceptance Criteria
```gherkin
@core
Scenario: Attach from Processes selects member in Terminal
  Given a supervised running member is listed in Processes
  When the operator clicks Attach
  Then Terminal shows that team and member selected
  And MemberTerminal mounts for that agentId

@edge
Scenario: Attach for unknown agentId is a no-op with no crash
  Given an attach event with an agentId not in /api/team/teams
  When the listener handles the event
  Then selection is unchanged and no uncaught error occurs
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Terminal listens for `teams:attach-process` and applies local selection**

- ProcessesTab already dispatches `CustomEvent('teams:attach-process', { detail: { agentId } })`.
- TerminalTab owns `teamId`/`memberId` state + localStorage persist (0263).
- Implementation options (prefer A):
  - **A.** TerminalTab `useEffect` adds `window`/`globalThis` listener; looks up team containing member id in loaded teams list; `setTeamId` + `setMemberId`; writePersistedSelection.
  - **B.** Lift selection to TeamsShell context (avoid — fights M1 local-selection decision).
- Optional: Processes Attach also navigates active tab to `terminal` via shell tab state if accessible without tight coupling.
- Resolve team: scan `teams[].members[]` for `m.id === agentId`.
### Plan
1. Add listener in TerminalTab for teams:attach-process; resolve team+member from teams state.
2. Set selection + rely on existing persist effect.
3. Optional: expose tab switch callback from TeamsShell if easy.
4. Tests: fire CustomEvent after teams loaded → MemberTerminal for agentId.
5. spur task check 0265; bun test teams components.
### Solution
**Attach intent bus + Terminal consume + shell tab switch** (Design option A, amended).

**Design deviation (documented).** Option A as written — a `teams:attach-process` listener living
only in TerminalTab — cannot satisfy the `@core` AC. `apps/web/src/modules/teams/TeamsShell.tsx:47` renders only the active tab
(`{Active ? <Active /> : null}`), so TerminalTab is **unmounted** at the moment the operator clicks
Attach in Processes. The CustomEvent fired with no listener registered and was dropped; transient
events are not replayed to components that mount later. Verified by driving the real path
(components.test.tsx:907), which fails against the original implementation.

Option B (lift selection into TeamsShell context) stays rejected — selection remains local to
TerminalTab per the M1 wayfind decision. The amendment only makes the *intent* outlive the
dispatch→mount gap, and moves *tab* state (already TeamsShell's own concern) with it.

- `apps/web/src/modules/teams/attach-bus.ts` — new. `requestAttach(agentId)` sets a module-scope
  pending intent and dispatches `ATTACH_EVENT`; `consumePendingAttach()` reads-and-clears it so a
  stale intent cannot hijack a later manual selection.
- `apps/web/src/modules/teams/ProcessesTab.tsx:4,177` — Attach now calls `requestAttach(agentId)`
  instead of dispatching the raw CustomEvent.
- `apps/web/src/modules/teams/TeamsShell.tsx:14-21` — listens for `ATTACH_EVENT` → `setActiveId('terminal')`.
  This is **R4, and it is load-bearing, not optional**: mounting Terminal is what lets it consume the
  intent, and without the switch Attach would resolve into a tab the operator cannot see.
- `apps/web/src/modules/teams/TerminalTab.tsx:140-147` — `applyAttach(agentId)` resolves the team
  owning that member from `teamsRef` and sets `teamId`/`memberId` (R2, R3).
- `apps/web/src/modules/teams/TerminalTab.tsx:156-157` — the 0263 restore effect consumes a pending
  attach once teams load; an Attach outranks the persisted selection (most recent operator intent).
  This also closes the previously-"accepted" race where an event arriving before teams load was lost.
- `apps/web/src/modules/teams/TerminalTab.tsx:173-187` — live listener retained for re-attach while
  Terminal is already the active tab.
- R5 persistence unchanged — the existing `[teamId, memberId]` effect (0263) covers attached
  selections; no duplicate write.

**Correction to the prior Solution note:** it stated `teamsRef` is "already maintained by
`useTeamsData`". No such hook exists in this file — the ref is assigned during render
(`apps/web/src/modules/teams/TerminalTab.tsx:117-118`). Extracting `useTeamsData` is task 0268.
### Testing
**Re-verification (`/sp:dev-verify 0265 --force --fix all`, 2026-07-15)**

Verdict: **PASS** (post-fix). The pre-fix verdict of PASS was **incorrect** — the `@core` AC failed
through the operator's real path. See Solution for the design deviation this required.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/web/src/modules/teams/TerminalTab.tsx:173-187` — live `ATTACH_EVENT` listener; `apps/web/src/modules/teams/TerminalTab.tsx:156-157` — mount-time consume |
| R2 | MET | `apps/web/src/modules/teams/TerminalTab.tsx:140-147` — `applyAttach` scans `teamsRef.current` for the team owning `agentId` |
| R3 | MET | `components.test.tsx:907` — asserts `[data-member-terminal="planner"]` mounts via the shell path |
| R4 | MET | `apps/web/src/modules/teams/TeamsShell.tsx:14-21` — `ATTACH_EVENT` → `setActiveId('terminal')`. Reclassified from "optional/deferred": the @core AC cannot pass without it |
| R5 | MET | `components.test.tsx:948-952` — localStorage equals `{teamId:'alpha',memberId:'planner'}` after Attach |
| R6 | MET | 3 tests: `components.test.tsx:809` (isolated), `:862` (edge), `:907` (real shell path) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| @core — Attach from Processes selects member in Terminal | MET | test | `components.test.tsx:907` — clicks the real Attach button on the Processes tab, asserts Terminal becomes active and MemberTerminal mounts. Confirmed to **fail** against the pre-fix source (regression-proving). |
| @edge — Attach for unknown agentId is a no-op with no crash | MET | test | `components.test.tsx:862` — `ghost-agent` dispatch: no throw, prompt still shown, no MemberTerminal, localStorage untouched |

**Commands run this turn**

- `bun test tests/modules/teams/components.test.tsx` → **20 pass / 0 fail** (5 consecutive runs, no flake)
- `bun run lint` (biome + tsc --noEmit, all 7 workspaces) → **clean, exit 0**
- `bun test` (apps/web) → 465 pass / **2 fail**, both pre-existing and environmental:
  `tests/lib/rpc-client.test.ts` — `Failed to start server. Is port 0 in use?` (sandbox denies
  `Bun.serve` port binding). Confirmed identical 2 failures at HEAD with all 0265 changes stashed —
  not a regression from this task.

**Method note:** the pre-fix tests passed only because both mounted `<TerminalTab />` directly,
which guarantees the listener exists at dispatch time — a precondition that never holds in the app,
where Attach is reachable only from the Processes tab. The added test drives `<TeamsShell />` as the
operator does, which is what R6 ("event → selection + MemberTerminal mount") actually requires.

Coverage: N/A for the per-file gate (React `.tsx` is excluded from the per-file coverage gate per
`bunfig.toml`); AC evidence is behavioral via the tests above.
### Review
| Priority | Finding | Status |
|----------|---------|--------|
| P1 | None — implementation matches Design option A | N/A |
| P2 | R4 (optional tab switch) deferred — would require lifting TeamsShell `activeId` to context, conflicts with M1 local-selection decision | Deferred (optional in spec) |
| P3 | Race: if event arrives before teams load, listener no-ops silently. Acceptable — ProcessesTab only shows Attach for loaded, supervised members | Accepted |
| P4 | None | N/A |

**Residual risk:** Low. Listener is mount-once with proper cleanup (`removeEventListener` in return). Unknown agentId path is a no-op (no crash). Persist handled by existing 0263 effect — no duplicate write.

**Final disposition:** PASS for R1-R3, R5, R6 + edge AC. R4 deferred (optional).
### References

M2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-15T23:19:20.063Z todo → wip (system)
- 2026-07-15T23:19:26.188Z wip → testing (system)
- 2026-07-15T23:20:02.975Z testing → done (system)
