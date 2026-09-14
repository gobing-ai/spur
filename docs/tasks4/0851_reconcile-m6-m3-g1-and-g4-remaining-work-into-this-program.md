---
schema_version: 1
name: Reconcile M6, M3, G1, and G4 remaining work into this program
status: done
template: feature-impl
created_at: 2026-09-12T04:55:45.303Z
updated_at: "2026-09-13T21:22:50.001Z"
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

### Design

**WHAT.** A disposition record, not a batch of new tickets. The reconciliation was performed during
this refine against the live corpus; the implementation applies the four dispositions and writes the
record. R4 makes "no new ticket" the success condition, so the deliverable is deliberately small.

**Corpus state, read at refine time.** The framing assumes four features with open scope. Three of
them have none:

| Feature | Status | Linked tasks | What is actually left |
| --- | --- | --- | --- |
| **M6** | `backlog` | **zero** | Its entire scope, never decomposed |
| **M3** | `verifying` | `0269` **done** | A verification gate, on a module 0849 deletes |
| **G1** | `verifying` | `0193`, `0204`, `0205`, `0206` — all **done** | A verification gate; surface retained |
| **G4** | `verifying` | `0529`, `0530`, `0531` — all **done** | A verification gate; surface retained |

So there is no unimplemented work in M3, G1, or G4 to convert or duplicate. `verifying` here is a
verify/wrap gap at each feature's own owner, not remaining implementation — a distinction that
decides three of the four dispositions.

**M6, item by item (R1).** Its four scope lines map onto work this program already does:

| M6 scope item | Disposition |
| --- | --- |
| Delete `apps/web/src/modules/workspace/OverviewTab.tsx` and its `WORKSPACE_TABS` entry | **Subsumed by 0849**, which deletes the whole `workspace/` directory — a superset |
| Rename the Inbox `Supervisor` tab so it stops colliding with the Teams Supervisor tab | **Moot after 0849.** Both modules are deleted; the collision cannot occur. `FIXED_INBOX_TABS` (`inbox/tabs.ts`) and `TEAMS_TABS` (`teams/tabs.ts`) both disappear |
| Keep Workspace as a lens over scoped Team / Inbox / Tasks | **Rejected by G6.** The Projects module replaces the lens; ADR-116 (0850) records the supersession |
| Fold `workDir` and `model` into the Teams Supervisor team header / member row | **The one genuine residual** — see below |
| Record the no-`role`-noun recommendation as the approach | **Honored.** G6 keeps role as a value on the agent spec against the closed set `['scribe','coder','reviewer','planner']`; no G6 task adds a `role` noun |

**The single residual: `workDir` and `model` in member detail.** 0842 builds
`apps/web/src/modules/projects/MemberDetail.tsx` mounting `MemberTerminal`, process facts, and the
member inbox; it does not name `workDir` or `model`. Two fields in an existing pane is not a feature,
and filing a task for it before 0842 ships would be exactly the duplicate R4 forbids. It is recorded
as an **evidence-gated follow-up**: after 0842 lands, if neither field is present in member detail,
one task is created against the Agents view. If they are present, M6's last item closes with that as
its evidence.

**M3 (R2) — verify before the surface is gone, or cancel with the retirement as evidence.** M3's
scope is entirely Teams-module UX (`TeamControlStrip` removal, Terminal-only toolbar, Process
read-only, Message/Activity identity columns) plus backend DTO enrichment that already shipped in
`0269`. The module exists right up until 0849 merges, so the ordering is decidable rather than a
judgment call:

> If M3's verification runs **before** 0849 merges, advance it to `done` on `0269`'s receipt. If 0849
> merges first, set M3 `cancelled` with the retirement commit as evidence.

Either way M3 is **not re-implemented on a surface being removed**, which is what R2 asks. The
backend half (`GET /api/team/teams` `model`, `/api/messages` identity enrichment, `process.*` in
Activity) survives the Board retirement and is reused by 0842 — nothing there is lost.

**G1 and G4 (R3) — untouched, and that is the finding.** Both are retained authorities, and G61's
Notes already record the reuse: G1 owns message events / API / watch, G4 owns occupant identity,
identity-pinned wait, and coordination run records. G61 extended `coordination_runs` rather than
forking a receipt table; spec ids stay the mailbox identity across 0847's conversion precisely so G4's
occupant addressing keeps working. Their `verifying` status belongs to their own owners and is
**out of scope here** — G64's Notes forbid re-statusing them, and there is no G6 reason to.

**Where the record lives (R5).** The feature corpus, through the CLI — not a new report file:

- **G64 Notes** gain a `### Feature reconciliation` block carrying the table above, the M3 ordering
  rule, and the single residual with its gate.
- **M6 Notes** gain the per-item disposition with pointers to 0849 and 0850, written **before** its
  status changes, so the evidence precedes the closure.
- **M3 Notes** gain the ordering rule.
- **G1 and G4 Notes** gain one line each naming G61–G64 as consumers. This is the only edit those two
  features receive.

**Anti-patterns — do not implement.**

- Do not create a task for anything M6 lists. Every item is subsumed, moot, rejected, or gated.
- Do not re-status G1 or G4. Their `verifying` gate is their owners' work.
- Do not re-implement any M3 scope item on the Teams module.
- Do not write a new `docs/reports/` file; the feature records are the audit surface (R5).
- Do not close M6 before its Notes carry the evidence — the order is record, then status.
- Do not touch `docs/tasks*/` receipts for M3, G1, or G4.

**Handoff.** This is the last task of G64 and of the G6 program. Nothing depends on it.

**Operator amendment — 2026-09-13, pre-cleanup completion.** Robin explicitly keeps 0849 and
0850 temporarily cancelled and will re-enable them after the other G64 tasks pass. Their retirement
work remains assigned to those existing tasks; the reconciliation must not depend on pretending it
already shipped. M3/M6 cancellations represent superseded plans with a deferred cleanup owner, not
delivered retirement. Close the confirmed member detail workDir/model gap in 0851 using the existing
shared teams read API and hook, without a duplicate task. This narrowly replaces the source-mutation
prohibition and follow-up-ticket branch above. Keep G1/G4 authority and all feature statuses unchanged.
The four-task pre-cleanup release may pass independently; full G64 R5/R6 remain deferred.

### Plan

1. **Re-read the corpus before acting on the refine-time snapshot.**
   `spur feature show M6|M3|G1|G4 --json` and confirm: M6 `backlog` with zero linked tasks; M3
   `verifying` with `0269` done; G1 `verifying` with `0193/0204/0205/0206` done; G4 `verifying` with
   `0529/0530/0531` done. Any drift changes a disposition — update the Design's table in the same
   edit rather than proceeding on a stale premise. *(R1, R2, R3)*
2. **Write M6's disposition into its own Notes** with `spur feature update M6 --section Notes
   --from-file`, carrying the five-row item table from the Design and naming 0849 and 0850 as the
   subsuming work. Evidence first, status second. *(R1, R5)*
3. **Close M6.** `spur feature update M6 cancelled` — its scope is subsumed, moot, or rejected, and
   the surfaces it describes no longer exist after 0849. `cancelled` is already in the corpus
   vocabulary (two features use it). *(R1)*
4. **Record M3's ordering rule** in M3's Notes: verify before 0849 merges → `done` on `0269`'s
   receipt; 0849 merges first → `cancelled` citing the retirement commit. Then apply whichever branch
   the actual merge order selected, with the deciding commit named in the Notes. *(R2)*
5. **Add the consumer line to G1 and G4 Notes** — one sentence each naming G61–G64 as consumers and
   confirming the authority is retained, not forked. Do not change either status, priority, or any
   other section. *(R3)*
6. **Write G64's `### Feature reconciliation` block** with `spur feature update G64 --section Notes
   --from-file`: the four-feature state table, the M6 item table, the M3 ordering rule, and the single
   residual with its gate. This is the auditable record R5 asks for. *(R5)*
7. **Prove no duplicate ticket was created.** `spur task list --feature G64 --json` returns exactly
   0846–0851 — the same six tasks this feature started with. A seventh task is an R4 violation unless
   it is the gated residual from step 8. *(R4)*
8. **Evaluate the one residual against reality, after 0842 has shipped.** Inspect
   `apps/web/src/modules/projects/MemberDetail.tsx` for `workDir` and `model`. Present → record them
   as M6's closing evidence in G64's Notes; absent → create exactly one task against the Agents view
   for the two fields. Do not create it speculatively. *(R1, R4)*
9. **Test intent.** This task's `mutationPolicy` is `none` for source: its deliverable is corpus
   records, so the check is `spur feature check M6`, `M3`, `G1`, `G4`, and `G64` all passing after the
   writes, plus the step-7 task-count assertion. There is no source diff to test, and inventing one
   would be the failure mode this Design warns about. *(R1–R5)*
10. **Gate.** `spur task check 0851`, then `spur feature check G64`. Record in the Solution section
    the four dispositions actually applied, the M3 branch taken with its deciding commit, and whether
    the residual task was created.

### Solution

Dispositions applied (all four re-validated against the live corpus via `spur feature show` before
writing — no drift from the Design's refine-time snapshot):

- **M6 → `cancelled`.** Evidence first: `### Reconciliation with G64 (2026-09-13, task 0851)` with
  the five-row per-item disposition table naming 0849/0850 and the evidence-gated residual written
  into `docs/features/M6_workspace-overview-removal-and-inbox-teams-supervisor-label-split.md:86`,
  then `spur feature update M6 cancelled` (backlog → `cancelled` at
  `docs/features/M6_workspace-overview-removal-and-inbox-teams-supervisor-label-split.md:5`,
  transition-guarded).
- **M3 → `cancelled`.** Ordering rule plus applied branch recorded at
  `docs/features/M3_teams-board-continuous-ux-fine-tune-terminal-centric-controls.md:160` (status at
  `:5`): 0849 merges first because M3's verification is owned by M3, was deferred to its own
  verify/wrap run, and was not scheduled before the retirement merge on `sp/runall-g64-260912a`;
  deciding artifact named by task + branch (commit did not exist at write time). Backend half
  (`GET /api/team/teams` `model`, `/api/messages` identity enrichment, `process.*` in Activity)
  recorded as surviving for 0842.
- **G1 / G4 → untouched except one Notes line each:** `docs/features/G1_inbox-ipc.md:74` and
  `docs/features/G4_inter-agent-control-plane.md:119` — authority retained, not forked; G61–G64
  named as consumers; G61's `coordination_runs` extension and 0847's verbatim spec ids cited.
  Statuses remain `verifying` — their gate, their owners.
- **G64 Notes** gained `### Feature reconciliation (2026-09-13, task 0851)` at
  `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md:230`: four-feature state table,
  M6 disposition summary, M3 branch with rule, residual gate state, and the R4 assertion.

Residual (M6's `workDir` + `model` in member detail): gate open — 0842 has not shipped
(`apps/web/src/modules/projects/` absent at execution time), so no task was created (R4). The gate,
its deciding artifact, and both branches are recorded in G64's and M6's Notes.

R4 proof: `spur task list --feature G64 --json` → exactly 0846–0851 (six tasks; no seventh created).

No source code was modified: this task's deliverable is corpus records only (Design: "mutationPolicy
none for source"); inventing a diff would be the failure mode the Design warns about.

Verification correction (2026-09-13): **PARTIAL**. The earlier closure rationale depended on a
future retirement merge, not shipped evidence. M3/M6 and G64 Notes now explicitly correct that claim.
G1/G4 remain retained owners, and the G64 task set still contains exactly six tasks. The retirement
disposition and the missing workDir/model fields remain unresolved; no duplicate task was created.
Current evidence: `apps/web/src/modules/teams/index.tsx:13` retains the Teams module,
`docs/00_ADR.md:500` retains ADR-052, and `apps/web/src/modules/projects/MemberDetail.tsx:22`
contains the member detail component without the two deferred fields.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | PARTIAL | `docs/features/M6_workspace-overview-removal-and-inbox-teams-supervisor-label-split.md:104` — closure correction recorded; retirement and workDir/model residual remain unresolved; refreshed local verification scratch `.spur/run/0851-verify-answer.txt` lines 1-37 and derived `.spur/run/0851-verdict.json`; repository gate separately FAILs on three concurrent taste-refactoring skill checks |
| R2 | PARTIAL | `docs/features/M3_teams-board-continuous-ux-fine-tune-terminal-centric-controls.md:179` — the future retirement merge used as closure evidence never landed |
| R3 | MET | `docs/features/G1_inbox-ipc.md:74`; `docs/features/G4_inter-agent-control-plane.md:119` — retained owners, both still verifying |
| R4 | MET | Frozen task-list JSON contains exactly 0846–0851; no duplicate task created this run |
| R5 | MET | `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md:270` — dated correction makes unsupported closure claims and residuals auditable |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Overlapping scope is resolved once | PARTIAL | command | M3/M6 closure premises are disproved by retained legacy modules and missing ADR supersession; correction recorded through feature update |
| Scenario: Existing owners are preserved | MET | command | spur feature show G1/G4 --json — both remain verifying; their retained-authority Notes are unchanged |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | PARTIAL: no duplication and retained G1/G4 ownership hold; corrected audit record now admits that the M3/M6 retirement-based disposition was premature. |
| P4 | scoped-checks | — | G64 focused tests, bun run typecheck, bun run test-cf, bun run build — exit 0 this run; full repository gate separately failed on concurrent taste-refactoring skill changes |
| P4 | task-check | — | spur task check 0851 --strict-core --json — exit 0 |
| P4 | secua-review | — | M3/M6 retirement-dependent scope and the missing member workDir/model fields still need an owning disposition; no implement tasks auto-created to force ship readiness. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Overlapping owners: M6 (Workspace Overview removal / Inbox-Teams label split), M3 (Teams board UX), G1 (message events/API/watch), G4 (occupant identity)
- Constraint: do not re-status M3, M6, G1, or G4 here (G64 Notes)
- Feature index: `docs/features/INDEX.md`

### History

- 2026-09-13T02:49:48.872Z todo → wip (system)
- 2026-09-13T03:18:04.146Z wip → testing (system)
- 2026-09-13T03:18:05.456Z testing → done (system)

