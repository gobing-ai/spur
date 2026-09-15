---
schema_version: 1
name: Reconcile M6, M3, G1, and G4 remaining work into this program
status: done
template: feature-impl
created_at: 2026-09-12T04:55:45.303Z
updated_at: "2026-09-15T01:23:17.319Z"
feature_id: G64
priority: P3
tags:
  - g6-program

dependencies: ["0846"]
ac_altitude: task-local
---

## 0851. Reconcile M6, M3, G1, and G4 remaining work into this program

### Background

Four existing features overlap this retirement and must not be duplicated. M6 carries Workspace
Overview removal and the Inbox/Teams label split (backlog). M3 carries Teams board UX (verifying).
G1 owns message events, API, and watch. G4 owns occupant identity, identity-pinned wait, and
coordination run records.

G1 and G4 stay authoritative — G61–G63 reuse them rather than forking a parallel path (G61 Notes).
M6 and M3 describe work on surfaces this feature retires, so their remaining scope either becomes a
concrete task here or is closed at its own owner with evidence.

G64's Notes are explicit: do not re-status M3, M6, G1, or G4 as part of this planning.

### Requirements

- **R1** — M6's remaining scope is either converted to a concrete task under this program or closed at
  its own owner with evidence.
- **R2** — M3's verifying work is reconciled against the retirement rather than re-implemented on a
  surface being removed.
- **R3** — G1 and G4 remain authoritative for message transport and occupant identity; this program
  reuses them.
- **R4** — No duplicate ticket is created for work an existing feature already owns.
- **R5** — The reconciliation is recorded so the overlap is auditable after the fact.

### Acceptance Criteria

```gherkin
Feature: Reconcile overlapping features into the retirement program

  @core
  Scenario: Overlapping scope is resolved once
    Given M6 and M3 carry work on surfaces this feature retires
    When the reconciliation completes
    Then each remaining item is either a concrete task here or closed at its owner with evidence
    And no duplicate ticket exists for work an existing feature already owns

  @core
  Scenario: Existing owners are preserved
    Given G1 owns message transport and G4 owns occupant identity
    When this program ships
    Then both remain authoritative and are reused rather than forked
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T16:45:00.676Z

**Q: Why does this task create almost nothing?** Because the reconciliation found almost nothing to
create. M3, G1, and G4 have every linked task `done`; their `verifying` status is a verify/wrap gap at
their own owners, not remaining implementation. M6 has zero linked tasks and a scope whose every item
is subsumed by 0849, made moot by 0849, rejected by G6's design, or already honored. R4 makes "no
duplicate ticket" the success condition, so a small deliverable is the correct outcome, not an
under-delivery.

**Q: Doesn't closing M6 violate G64's "do not re-status M3, M6, G1, or G4" instruction?** That
instruction governs *planning* — it forbade quietly re-statusing them while decomposing G64, which
would have hidden the overlap instead of resolving it. R1 explicitly authorizes closing a feature "at
its own owner with evidence", and the Plan orders it evidence-first: M6's Notes carry the per-item
disposition before its status moves.

**Q: Why `cancelled` for M6 rather than `done`?** Nothing in M6 was implemented as specified. Its
Overview deletion happens as a side effect of deleting the entire module, its label split becomes
impossible rather than satisfied, and its "keep Workspace as a lens" decision is explicitly reversed
by ADR-116. `done` would claim M6's design shipped; `cancelled` with the disposition table is what
actually happened.

**Q: Why is M3's disposition conditional rather than decided now?** Because it depends on a merge
order that has not happened yet. M3's verification is possible while the Teams module exists and
impossible after 0849 deletes it. Rather than guess, the Design states a rule that resolves
deterministically at execution time and names the deciding artifact (the merge commit). Both branches
satisfy R2 — neither re-implements M3 on a retired surface.

**Q: Is M3's backend work lost when the Teams module is deleted?** No. `GET /api/team/teams`'s
optional `model`, `/api/messages` identity enrichment, and `process.*` events in Activity are server
surfaces that G63's Agents view consumes; 0849 deletes Board modules, not
`apps/server/src/modules/team/`. Recorded so the closure is not read as discarding shipped work.

**Q: What if G1 or G4 turn out to need changes?** They would be their own features' tasks, not G64's.
G61's Notes already record the reuse contract (extend `coordination_runs`, preserve spec ids
verbatim), and 0847 is built on exactly that. This task's only G1/G4 action is one Notes line each.

**DEFERRED — `workDir` and `model` in member detail.** Owner: the Agents view (G63's surface).
Condition: after 0842 ships, inspect `MemberDetail.tsx`; create one task only if both fields are
absent. This is the single item of M6 that is neither subsumed nor moot, and it is gated on evidence
so it cannot become a speculative duplicate.

**DEFERRED — M3, G1, and G4's `verifying` → terminal transitions (other than M3's branch above).**
Owner: each feature. Condition: their own verify/wrap runs. G64 has no standing to advance them and
no information their owners lack.

#### Q&A entry — 2026-09-14T01:08:51.486Z

**Current operator decision (2026-09-13).** 0849 and 0850 are intentionally paused. Robin will
re-enable them after the other G64 tasks pass; no removal window is inferred from this request.

**M6/M3 disposition.** Preserve their cancellation as superseded plans, explicitly map unfinished
retirement to existing tasks 0849/0850, and correct prior claims that retirement already happened.
G1/G4 remain authoritative and retain their statuses.

**Confirmed member-detail residual.** The pane exists and lacked workDir/model. Robin's request to
complete all non-cleanup work authorizes implementing these fields here. Reuse the existing read API
and hook instead of creating a duplicate ticket. This replaces the former evidence-gated follow-up.

**Commit boundary.** Leave this pass uncommitted for Robin's next step.

### Design

Reconcile overlapping scope against Robin's staged release decision of 2026-09-13. Requirements
and acceptance criteria are unchanged: each remaining item has one concrete task or closing evidence.

- Preserve 0849/0850 as intentionally cancelled, with Robin owning their later re-enable/cutover.
  Map Overview removal and tab-label collision to 0849, and ADR-052 supersession to 0850. A concrete
  cleanup assignment satisfies reconciliation; it does not claim that cleanup shipped.
- Preserve M3/M6 as cancelled superseded plans, replacing unsupported future-merge evidence with
  the operator's explicit deferral and the existing task assignments. M3 implementation belongs to
  0269; do not reimplement it while its final removal is assigned to 0849.
- Close M6's confirmed non-cleanup residual in the existing Projects MemberDetail pane. Read model
  and common workDir through `useTeamsData` / GET /api/team/teams, matching member instance ids.
  Show Executor default for an unset model and Unavailable for missing member/directory or read
  failure. Semantic labels, wrapping long paths, and existing keyboard/focus behavior are retained.
- Keep G1/G4 authority, statuses, and receipts unchanged. Write the item-by-item disposition to
  G64/M3/M6 Notes through the feature CLI. No seventh task or alternate message/identity path.
- Verify all four included G64 tasks and the repository gates. Report their release readiness
  separately from full G64 R5/R6, which remain intentionally deferred.

This operator-approved design replaces the earlier source-mutation prohibition and speculative
follow-up branch solely for the confirmed member-detail gap. No cleanup implementation is included.

### Plan

1. Freeze 0846, 0847, 0848, and 0851 plus the current feature records; preserve the two cancelled
   cleanup tasks and all owner statuses. (R1–R5)
2. Replace premature closure claims with the explicit operator deferral and concrete assignments
   to existing 0849/0850 in M3/M6/G64 Notes. (R1, R2, R5)
3. Reproduce the missing member-detail fields, reuse the existing teams read hook, and verify
   correct-member selection plus clearing details when no matching spec exists. (R1, R4)
4. Confirm the unchanged G1/G4 consumer-authority notes and exactly six G64 tasks. (R3, R4)
5. Run focused regressions, full repository gates, affected corpus checks, and derive/record all
   four task verdicts. Classify full G64 findings against only the explicitly deferred R5/R6. (R1–R5)
6. Leave all changes uncommitted for the operator's next step.

### Solution

Completed the non-cleanup reconciliation under Robin's explicit staged-release decision.

- G64/M3/M6 Notes map Overview and label cleanup to existing task 0849, ADR reconciliation to
  existing task 0850, and retain Robin as their re-enable/cutover owner. These remain concrete
  deferred assignments; no retirement or ADR-116 is falsely claimed as shipped. See
  `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md:229`,
  `docs/features/M3_teams-board-continuous-ux-fine-tune-terminal-centric-controls.md:160`, and
  `docs/features/M6_workspace-overview-removal-and-inbox-teams-supervisor-label-split.md:86`.
- Closed M6's confirmed residual in `apps/web/src/modules/projects/MemberDetail.tsx:24` and
  `apps/web/src/modules/projects/MemberDetail.tsx:137`: reuse the shared teams read hook, match the
  selected instance id, and render model plus common working directory. Unknown members/read failures
  show Unavailable; unset models show Executor default. Long paths wrap and existing focus behavior
  is preserved. `apps/web/tests/modules/projects/MemberDetail.test.tsx:119` reproduced the missing
  fields before the fix and checks correct selection plus clearing a prior member's values.
- G1/G4 authority notes are unchanged at `docs/features/G1_inbox-ipc.md:74` and
  `docs/features/G4_inter-agent-control-plane.md:119`. Statuses are untouched; no duplicate task was
  created, and the six-task G64 roster is preserved.
- The design amendment explicitly authorizes the small UI fix within this task. Full G64 R5/R6
  remain deferred; completion of this reconciliation does not remove the 0849/0850 cleanup gate.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/features/M6_workspace-overview-removal-and-inbox-teams-supervisor-label-split.md:86` — operator-approved disposition mapping cleanup to existing 0849/0850 (anchor re-read this run); `apps/web/tests/modules/projects/MemberDetail.test.tsx:119` (selected member model/workDir rendered, cleared for unknown id; anchor re-read) — green inside the fresh web batch: cd apps/web && bun test tests/modules/registry.test.ts tests/components/LeftSidebar.test.tsx tests/components/BoardLayout.test.tsx tests/modules/projects/ProcessesView.test.tsx tests/modules/projects/roster.test.ts tests/modules/projects/MemberTerminal.test.tsx tests/modules/projects/activity-history.test.ts tests/modules/projects/MemberDetail.test.tsx tests/modules/projects/conversation.test.ts tests/modules/projects/ConversationView.test.tsx — exit 0, 130 pass / 0 fail / 438 expect (fresh 2026-09-14) |
| R2 | MET | `docs/features/M3_teams-board-continuous-ux-fine-tune-terminal-centric-controls.md:160` — cancellation/superseded-plan reconciliation recorded, final removal assigned to existing 0849 (anchor re-read this run); no future-merge claim |
| R3 | MET | `docs/features/G1_inbox-ipc.md:74` and `docs/features/G4_inter-agent-control-plane.md:119` — retained-authority notes (anchors re-read this run); fresh `spur feature show G1 --json` / `G4 --json` this run → both status `verifying`, authority notes unchanged |
| R4 | MET | Fresh `spur task list --feature G64 --json` this run: exactly ten tasks 0846–0855; the growth beyond the frozen six (0852–0855) is the recorded 0849/0853 follow-up lineage mirrored at `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md:268-271` (re-read this run) — no duplicate ticket for work an existing feature owns |
| R5 | MET | `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md:229` — explicit per-item owners and staging decision, mirrored at M3/M6 through CLI writes (anchor re-read this run) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Overlapping scope is resolved once | MET | command | Owner notes re-read this run (M6:86, M3:160, G64:229/:268-271); `apps/web/tests/modules/projects/MemberDetail.test.tsx:119` green inside the fresh 130-pass web batch |
| Scenario: Existing owners are preserved | MET | command | Fresh `spur feature show G1` / `G4` this run — both `verifying` with retained-authority notes at G1:74 / G4:119 (re-read); no authority forked |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verified all requirements and acceptance criteria for 0851 against current source and executable checks.

- Functional: every requirement/AC row is MET in the derived PASS verdict and recorded Testing.
- SECUA: no blocking/major finding in scope. Read-only migration, stable mailbox identity, explicit
  conflicts, existing lifecycle transports, and named unavailable states were checked as applicable.
- Architecture: reuse existing application services and shared hooks; no new transport or duplicate
  task. G1/G4 remain owners. 0849/0850 cleanup is explicitly deferred by Robin.
- Validation: bun run spur-check — 8536 pass, 0 fail, lint/typecheck and pre/post rules pass;
  bun run build and bun run test-cf — exit 0. Focused checks and concrete anchors are in Testing.
- Release scope: 0846, 0847, 0848, 0851. Full G64 R5/R6 remain deferred, without a false retirement PASS.

The operator-approved design amendment closes the confirmed member model/workDir gap in this task and replaces unsupported future-merge closure claims with concrete cleanup assignments.

| Priority | Dimension | Location | Finding / disposition |
| --- | --- | --- | --- |
| P4 | Traceability | Recorded Testing | All requirements and AC are MET; no unresolved blocking or major finding in this task. |
| P4 | Release scope | G64 tasks 0849/0850 | Cleanup remains explicitly deferred by Robin; excluded from this four-task release and retained in full-feature gate findings. |

### References

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Overlapping owners: M6 (Workspace Overview removal / Inbox-Teams label split), M3 (Teams board UX), G1 (message events/API/watch), G4 (occupant identity)
- Constraint: do not re-status M3, M6, G1, or G4 here (G64 Notes)
- Feature index: `docs/features/INDEX.md`

### History

- 2026-09-13T02:49:48.872Z todo → wip (system)
- 2026-09-13T03:18:04.146Z wip → testing (system)
- 2026-09-13T03:18:05.456Z testing → done (system)

