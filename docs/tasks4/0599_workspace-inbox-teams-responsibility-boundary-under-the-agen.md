---
schema_version: 1
name: "Workspace / Inbox / Teams responsibility boundary under the agent-role mechanism"
status: done
template: brainstorm
created_at: 2026-08-18T22:01:30.748Z
updated_at: "2026-08-19T03:50:00.726Z"
feature_id: I6
done_forced: "true"
done_reason: "Doc-authoring batch: module boundary design delivered - Teams/Inbox/Workspace dispositions with reasons and migration costs (Teams-absorbs-both rejected on M4 D1 split evidence), SupervisorTab stub/duplication resolved with path:line evidence, role-mechanism redundancy/necessity analysis grounded in M5, target IA specified, role-noun recommendation recorded against map open question 4; task check PASS (4 pre-existing gate-language warnings, corpus debt); zero source files modified."
---

## 0599. Workspace / Inbox / Teams responsibility boundary under the agent-role mechanism

### Background
`wayfinder:research` — ticket on map **[I6]** (Spur harness self-improvement program).

#### The sharp question
**After the agent-role mechanism, what are Workspace, Inbox, and Teams actually for — and which of the
three should still exist?**

#### Ground truth established at charting (do not re-derive)
- `apps/web/src/modules/workspace/` — **240 lines**, 3 components (`WorkspaceShell`, `OverviewTab`, index).
- `apps/web/src/modules/inbox/` — **514 lines**, 5 components (`InboxShell`, `SupervisorTab`, `AgentTab`,
  `AllTab`, index).
- `apps/web/src/modules/teams/` — **1,931 lines**, 7 components including `TerminalTab`,
  `MemberTerminal`, `ActivityTab`, `SupervisorTab`, `ProcessesTab`.
- **`SupervisorTab` exists in both `inbox/` and `teams/`.** That is the overlap, in the file listing,
  before anyone opens a file.
- Feature history already circles this: **M4** (Inbox board module, unified agent message plane),
  **M5** (Teams declared by role — a member is a role plus an executor), **M1/M2/M3** (Teams fine-tune
  passes). Read those before proposing anything; several answers may already be half-decided there.

#### The operator's ruling (settled at charting)
**Full latitude, including deletion.** Modules may be merged or removed outright if the role mechanism
makes them redundant. Teams absorbing Workspace and Inbox is a live outcome, not a straw man — the line
counts make it the obvious hypothesis to test first.

#### What to produce
1. **Concept boundary, before any UI.** One sentence each for what Workspace / Inbox / Teams *is*, such
   that no two overlap. If a clean sentence cannot be written for one of them, that is the finding —
   say so and recommend deletion or absorption.
2. **Overlap evidence.** Where the three modules read the same data, render the same thing, or share
   duplicated components (start with the two `SupervisorTab`s). Cite `path:line`.
3. **How the role mechanism changed the foundation.** Concretely: what `spur agent run`'s roles made
   redundant, what they made newly necessary, and what M5's "a member is a role plus an executor"
   implies for the other two modules.
4. **A disposition per module** — keep / merge into X / delete — each with its reason and its migration
   cost, plus the target information architecture (nav entries, tabs, what each answers).
5. **A recommendation on open question 4**: does this need a first-class `role` noun on the `spur` CLI?
   Recommend with reasoning; adding a noun is ADR-051-gated and the operator decides.

#### Out of scope for this ticket
Writing React or moving files. Anything under `spur task` (F92, concurrent agent).
### Requirements

- [ ] R1 — Write a one-sentence definition of what Workspace, Inbox, and Teams each *is*, such that no two overlap; if no clean sentence exists for one, report that as the finding and recommend absorption or deletion.
- [ ] R2 — Evidence the overlap with `path:line` citations where the three modules read the same data, render the same thing, or duplicate components — starting with the `SupervisorTab` present in both `inbox/` and `teams/`.
- [ ] R3 — State concretely what the `spur agent run` role mechanism made redundant and what it made newly necessary, including what M5's "a member is a role plus an executor" implies for the other two modules.
- [ ] R4 — Read features M, M1, M2, M3, M4, and M5 before proposing anything, and report which questions those features already answered so this ticket does not re-decide them.
- [ ] R5 — Emit a disposition per module (keep / merge into X / delete) with its reason and migration cost, plus the target information architecture: nav entries, tabs, and what each answers.
- [ ] R6 — Recommend, with reasoning, whether the role mechanism warrants a first-class `role` noun on the `spur` CLI, as the input to map open question 4 — recommendation only, since adding a noun is ADR-051-gated.

### Acceptance Criteria

```gherkin
Feature: Workspace Inbox Teams boundary under the role mechanism

  Scenario: R1 — the boundary is stated before any UI is proposed
    Given the three modules exist
    When the concept boundary is written
    Then each module has a one-sentence definition
    And no two definitions overlap

  Scenario: R2 — overlap is evidenced, not asserted
    Given SupervisorTab exists in both the inbox and teams modules
    When the overlap evidence is produced
    Then every overlap claim cites path:line

  Scenario: R3 — the role mechanism's effect is stated concretely
    Given spur agent run introduced roles
    When the impact is assessed
    Then the report names what became redundant and what became newly necessary

  Scenario: R4 — prior feature decisions are not re-decided
    Given features M through M5 already cover parts of this surface
    When the proposal is written
    Then it reports which questions those features already answered

  Scenario: R5 — every module gets an explicit disposition
    Given the boundary and the overlap evidence
    When the disposition is emitted
    Then each of Workspace, Inbox, and Teams is marked keep, merge, or delete with a reason and migration cost
    And the target nav and tab structure is stated

  Scenario: R6 — the CLI noun question is answered as a recommendation
    Given adding a spur CLI noun is ADR-051 gated
    When the role-noun question is addressed
    Then a recommendation with reasoning is given
    And no CLI surface change is made
```

### Q&A
**Closed at charting (operator ruling — do not re-open).**
Full latitude including deletion: modules may be merged or removed outright if the role mechanism makes
them redundant.

**Closed during refine (premise verification).**
- M4 and M5 are both `done` — the role foundation has landed; this is cleanup, not speculative design.
- `SupervisorTab.tsx` in `inbox/` is 50 lines vs `teams/` at 502 — asymmetric, so establish the
  relationship before calling it duplication.
- Role is already a value in the `spur agent run --agent` selector, which narrows open question 4 to
  "promote the value to a noun?" rather than "introduce roles?".

**Deferred to the operator (map open question 4, owner: operator).**
Whether the role mechanism warrants a first-class `role` noun on the `spur` CLI. ADR-051 gates any
noun addition; this task recommends only.

**Open, resolvable by the implementer.**
- Whether a clean three-way boundary exists at all. "No — Teams absorbs both" is a valid and expected
  outcome; so is "yes, here are the three sentences". Both must be *argued*, not asserted.
- Whether the `RightPanel` / `MainWorkspace` shell split constrains the possible information
  architectures. If the shell forces a structure, say so — that is a constraint on R5, not a detail.
### Design
**WHAT.** A boundary specification and a per-module disposition. **No code ships, no files move.**
No new API.

**WHY.** Three modules were built at different times against different assumptions; `spur agent run`'s
role mechanism (features M4, M5 — both `done`) changed the foundation underneath all three. The
question is a concept question first; a UI plan built before the boundary is drawn will re-encode the
overlap.

**WHERE — read set (frozen).**

| Module | Path | Size |
| --- | --- | --- |
| Workspace | `apps/web/src/modules/workspace/` | 240 lines, 3 files |
| Inbox | `apps/web/src/modules/inbox/` | 514 lines, 5 files |
| Teams | `apps/web/src/modules/teams/` | 1,931 lines, 7 files |
| Shell / nav | `apps/web/src/components/{BoardApp,BoardLayout,LeftSidebar,MainWorkspace,RightPanel}.tsx` | — |
| Role vocabulary | `plugins/sp/references/roles.md` — `scribe`/cheap, `coder`/standard, `reviewer`/capable-1, `planner`/capable-2 | — |
| Server | `apps/server/src/modules/**` — the routes each module consumes | — |
| Prior art | features `M`, `M1`, `M2`, `M3`, `M4` (`done`), `M5` (`done`) | — |

**Verified during refine — start from these, do not re-derive.**
- `SupervisorTab.tsx` exists in **both** `inbox/` (50 lines) and `teams/` (502 lines). The asymmetry
  matters: this is not symmetric duplication but likely a stub-vs-real pair or a delegation. Establish
  which before calling it duplication.
- **M4 and M5 are both `done`.** M5 ("a member is a role plus an executor") has already landed, so this
  task is post-landing cleanup, not a design running ahead of its foundation.
- Role is **already a first-class value** in the agent selector: `spur agent run --agent <name>` accepts
  "Role, executor, agent binary, auto, or inline". Open question 4 is therefore *not* "should roles
  exist" but "does the existing value-level treatment need promoting to a noun" — a narrower question.

**Output artifact — frozen path:** `docs/design/board-module-boundaries.md`.

**Method — order is load-bearing.** R1 (boundary sentences) before R2 (overlap evidence) before R5
(dispositions). Writing dispositions first produces a rationalization of the current structure. If a
one-sentence definition cannot be written for a module without referencing another, that failure **is**
the finding — record it and let it drive the disposition.

**Operator ruling — full latitude.** Modules may be merged or deleted outright. Teams absorbing
Workspace and Inbox is the obvious hypothesis given 240 + 514 vs 1,931 lines, and must be evaluated
seriously rather than dismissed. "All three survive" is an acceptable conclusion only if R1 produces
three non-overlapping sentences.

**Anti-patterns — do not do these.**
- Do not write React, move files, or change nav.
- Do not re-decide what M4/M5 already settled — report what they settled and build on it.
- Do not propose a `role` CLI noun. R6 recommends; ADR-051 and map open question 4 decide.
- Do not preserve a module because it currently has a nav entry. Latitude includes deletion.
- Do not touch `spur task` (feature F92, concurrent agent in this tree).

**Handoff.** The dispositions become the graduated feature(s) under `M` (or `J`/`K` if the answer
reassigns surfaces). Migration cost per disposition is what sequences that work — carry it.
### Plan
- [x] Read features M, M1, M2, M3, M4, M5 and record which boundary questions they already answered (R4)
- [x] Write one non-overlapping sentence per module for Workspace, Inbox, Teams; if one cannot be written without referencing another, record that as the finding (R1)
- [x] Compare `inbox/SupervisorTab.tsx` (50) against `teams/SupervisorTab.tsx` (502); establish stub / delegation / duplication before labelling it (R2)
- [x] Sweep all three modules for shared data sources, duplicated renders, and shared components; cite `path:line` per claim (R2)
- [x] State what the role mechanism made redundant and what it made newly necessary, grounded in M5's landed "role plus executor" model (R3)
- [x] Evaluate the Teams-absorbs-both hypothesis explicitly; accept or reject with reasons (R5)
- [x] Emit a disposition per module — keep / merge into X / delete — each with reason and migration cost (R5)
- [x] Specify the target information architecture: nav entries, tabs, and what each answers (R5)
- [x] Recommend on the `role` CLI noun, framed as promote-value-to-noun or not; mark it a recommendation against map open question 4 (R6)
- [x] Write `docs/design/board-module-boundaries.md` (R1–R6)
- [x] Verification: zero source files modified; every overlap claim carries `path:line`; every module has an explicit disposition
### Solution
Authored the boundary spec at `docs/design/board-module-boundaries.md:1-2` ("# Board module
boundaries — Workspace / Inbox / Teams under the agent-role mechanism"). R1 non-overlapping
sentences land in §2 (finding: Workspace owns no data — it is a composition lens). R2 overlap
evidence in §3 (two `SupervisorTab`s = name collision, not duplication; `useTeamsData` shared feed;
Workspace Overview vs Teams Supervisor roster duplicate). R3 role-mechanism impact in §4. R4
feature-history answers in §1. R5 dispositions in §5 (Teams keep, Inbox keep, Workspace keep-as-lens
with Overview deleted; Teams-absorbs-both rejected). R6 role-noun recommendation in §6 (no `role`
noun; role stays a value under `agent`). Zero source files modified.
### Testing
Coverage: N/A (doc-authoring task; no code shipped, no tests added).

- Zero-source-modified check: PASS — only `docs/design/board-module-boundaries.md` (new) written;
  no file under `apps/`, `packages/`, or `plugins/` touched.
- Per-module disposition completeness: PASS — Teams (keep), Inbox (keep), Workspace
  (keep-as-lens + delete `OverviewTab`) each with a reason and migration cost (§5.2).
- Overlap claims carry `path:line`: PASS — every §3 claim cites a file:line (SupervisorTab name
  collision, `useTeamsData` consumers, roster-row duplication, control/modal mirrors).
### Review
| Priority | Finding | Evidence / Disposition |
| --- | --- | --- |
| P1 | None blocking — no source change, no API/schema/nav change | Doc-only deliverable; dispositions are recommendations for a future graduate feature |
| P2 | Workspace `OverviewTab` is a stale, role-less roster duplicate of Teams Supervisor | `workspace/OverviewTab.tsx:65-76` vs `teams/SupervisorTab.tsx:307-335`; dispose = delete OverviewTab, fold `workDir`/`model` into Teams |
| P2 | Shared `Supervisor` label means two disjoint planes (message filter vs process roster) | `inbox/SupervisorTab.tsx:13-14` vs `teams/SupervisorTab.tsx:94,307`; dispose = rename Inbox tab to "Supervisor traffic" |
| P3 | Intra-Teams control URLs + confirm modals duplicated across Terminal/Supervisor | `teams/SupervisorTab.tsx:16-20,422,462` mirror `teams/TerminalTab.tsx:11-15,336-411`; dispose = extract one control/modal helper |
| P4 | `role` noun question answered as recommendation only (no CLI change) | §6 recommends no noun; ADR-051 consent gate + map open question 4 own the final call |
### References
- Map: [I6](../features/I6_spur-harness-self-improvement-program-dev-spine-cost-event-5w1h-ssot-run-record-consolidation-and-board-module-boundaries.md)
- Prior art (read first): [M](../features/M_teams-declarative-agent-teams-board-module-over-existing-message-drain-supervisor-backbones.md), [M1](../features/M1_fine-tune-teams-module-roster-drop-terminal-ux-processes-watchlist-input.md), [M2](../features/M2_teams-residual-polish-for-release-post-m1.md), [M3](../features/M3_teams-board-continuous-ux-fine-tune-terminal-centric-controls.md), [M4](../features/M4_inbox-board-module-unified-agent-message-plane-all-supervisor-per-agent-tabs.md), [M5](../features/M5_teams-declared-by-role-a-member-is-a-role-plus-an-executor.md)
- ADR-051 — CLI noun/verb consent gate (governs the R6 recommendation)
- ADR-057 — inter-agent control plane; agents talk only through Spur (`spur message`, `spur agent`)
- `docs/design/inter-agent-control-plane.md` — the coordination shapes these modules surface
- `plugins/sp/references/roles.md` — the Layer-1 role→tier table
- CLI: `spur agent run --agent <role|executor|binary|auto|inline>`, `spur team`, `spur message`
- Root `DESIGN.md` if present — UI/UX SSOT for any information-architecture proposal
### History
- 2026-08-19T03:24:43.206Z todo → wip (system)
- 2026-08-19T03:24:43.659Z wip → testing (system)
- 2026-08-19T03:24:44.114Z testing → done (system)
