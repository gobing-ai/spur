---
schema_version: 1
name: Reconcile superseded authority across ADRs, architecture, and templates
status: todo
template: feature-impl
created_at: 2026-09-12T04:55:45.303Z
updated_at: "2026-09-13T20:15:14.583Z"
feature_id: G64
priority: P3
tags:
  - g6-program

dependencies: ["0848", "0849"]
---

## 0850. Reconcile superseded authority across ADRs, architecture, and templates

### Background

ADR-052 records team-scoped composition, which this program replaces with project-scoped fleets.
Leaving it unsuperseded leaves two contradictory authorities in the tree, which the constitution's
"fix authority first, then derived docs" rule forbids.

Neighbouring ADRs stay: ADR-037 (registry) and ADR-057 (control-plane boundary) remain correct, and
ADR-022 keeps task lifecycle. Historical ADRs and feature receipts are not rewritten — supersession is
recorded, not retconned.

Derived owners then follow: `docs/03_ARCHITECTURE.md`, the owning design satellites, CLI references
under `plugins/sp/skills/spur-cli/references/`, init templates, and plugin callers.

### Requirements

- **R1** — ADR-052's supersession is recorded in `docs/00_ADR.md` with its replacement decision.
- **R2** — ADR-037, ADR-057, and ADR-022 are explicitly retained; no historical ADR or feature receipt
  is rewritten.
- **R3** — `docs/03_ARCHITECTURE.md`, owning design satellites, CLI references, init templates, and
  plugin callers match the shipped surface.
- **R4** — Portable changes propagate to init templates, not just this repository's docs.
- **R5** — Only owners whose facts changed are touched.

### Acceptance Criteria

```gherkin
Feature: Reconcile superseded authority

  @core
  Scenario: Superseded authority is corrected at its owner
    Given ADR-052's team-scoped composition no longer holds
    When this feature completes
    Then the supersession is recorded in docs/00_ADR.md with its replacement
    And architecture, design satellites, CLI references, and init templates match the shipped surface

  @core
  Scenario: History is preserved
    Given historical ADRs and feature receipts
    When the supersession is recorded
    Then no historical decision or receipt is rewritten
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T16:43:10.661Z

**Q: Which ADR number?** **ADR-116.** `docs/00_ADR.md` ends at ADR-115 (`:1639`), and no ADR has been
allocated for the G6 program — G61, G62, and G63 all shipped without one, which is why R1 had no
"replacement" to point at until now. Plan step 1 re-verifies the ceiling before writing, because
another feature could land 116 first.

**Q: Doesn't recording a supersession contradict "no historical ADR is rewritten" (R2)?** No. A status
line is metadata about the decision's current authority, not the decision itself. The file already
does exactly this at `:122`, `:357`, `:385`, `:642`, and `:1070`. Plan step 4(c) asserts the diff
touches only ADR-052's status line and the appended ADR-116.

**Q: Why aren't ADR-037, ADR-057, and ADR-022 edited to say they are retained?** Because they are
correct as written, and R5 restricts edits to owners whose facts changed. Retention is recorded in
ADR-116's `Retains:` line, where a reader looking for what G6 did and did not replace will actually
look.

**Q: Should `spur team`'s CLI reference and help page be deleted?** No — and this is the sequencing
trap in the task's framing. 0848 ships a deprecation warning and keeps all six verbs working until
Robin's cutover window. Deleting the docs now would make them contradict the shipped CLI. They get a
deprecation header and a replacement table; deletion belongs to the cutover commit.

**Q: Why extend `project-switcher.md` instead of writing a G6 design satellite?** It already owns the
project registry and Board-switching surface, which is what the fleet attaches to; a new satellite
would restate its project-identity and registry sections to reach the same place. Recorded as a
rejected alternative with a revisit condition rather than left implicit.

**Q: What is the portable artifact R4 is about?** `config/config.example.yaml`. `init.ts:170` seeds it
as `~/.config/spur/config.yaml` on first run, so its `agent.team` template block is inherited by every
new project. Updating this repo's docs while leaving that block would keep teaching the retired
concept to new installs — which is precisely the gap R4 names.

**Q: Do `docs/tasks*/` and `docs/features/` get updated?** No. They are receipts of what was decided
and done at the time. The `spur team` references in `docs/tasks/0007`, `docs/tasks2/0209`, and their
neighbours are historical records, not authority.

**DEFERRED — deleting the superseded satellites and the `spur team` reference files.** Owner: the
cutover commit after Robin's window. Condition: `spur team` no longer registers as a CLI noun. Until
then a banner is the correct state: the surface still exists, and its documentation says what replaced
it.

**DEFERRED — whether G61/G62/G63 need ADRs of their own.** Owner: Robin. Condition: a reader finds a
structural decision from those features that ADR-116 does not cover. ADR-116 is deliberately scoped to
the composition unit — the thing ADR-052 got wrong — not to the whole program; inventing three more
ADRs retroactively for shipped work would be the retconning R2 forbids.

### Design

**WHAT.** Record ADR-052's supersession, author its replacement, and update exactly the derived owners
whose facts the G6 program changed. Nothing is rewritten; the supersession is additive.

**The replacement decision — ADR-116.** `docs/00_ADR.md` currently ends at **ADR-115** (:1572–1639),
so **116 is the next free number** and no G6 ADR exists yet. This task allocates it. Frozen shape,
matching the file's existing format (`:500`, `:390`, `:932`):

```markdown
## ADR-116: Project-Scoped Fleet Composition Replaces Team-Scoped Board Composition

- **Status:** Accepted · **Date:** <ship date> · **Feature:** G6 · **Supersedes:** ADR-052
- **Decision:** A project — one worktree path — is the composition unit. Its agent roster is a
  **fleet** declared in `<projectPath>/.spur/fleet.json` (task 0835) and resolved by `FleetService`;
  the Projects Board module owns Conversation, Agents, and Work; `agent.team.<teamId>` and the
  Workspace / Inbox / Teams modules are retired. Spec ids stay the mailbox identity and occupant
  address, preserved verbatim across conversion.
- **Why:** `agent.team.<teamId>` made the roster a config-global keyed by a name the project does not
  own, so two teams could claim one worktree and a project had no single roster. Keying on the
  worktree path removes the ambiguity and makes the fleet addressable from the project registry that
  already exists (ADR-037).
- **Retains:** ADR-037 (project registry), ADR-057 (control-plane boundary), ADR-022 (task lifecycle).
- **Detail:** `docs/plans/2026-09-11-project-agent-fleet-brainstorm.md`;
  `docs/design/project-switcher.md` § fleet; features G61–G64.
```

ADR-052's own line (`docs/00_ADR.md:500`) changes from `**Status:** Accepted` to
`**Status:** Superseded by ADR-116`, date and body untouched — the same edit ADR-041 got at `:357`
and ADR-078's predecessor at `:642`. That is the whole of R1 and it does not violate R2, because the
decision text, its Why, and its Detail links stay exactly as written.

**Scope discipline for R2/R5 — what is explicitly NOT touched.** `docs/tasks*/**` and
`docs/features/**` are receipts; `docs/memo.md` and `docs/plans/**` are historical. Every other ADR
keeps its text. ADR-037, ADR-057, and ADR-022 are retained **by being named in ADR-116's Retains
line**, not by editing them — editing a correct ADR to say it is still correct is the churn R5
forbids.

**Owner inventory (R3), verified against the tree at refine time.** Each row was located, not
assumed; anything not on this list stays untouched.

| Owner                                                                                      | Change                                                                                                                                                | Trigger |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `docs/00_ADR.md:500`                                                                       | status → `Superseded by ADR-116`                                                                                                                      | R1      |
| `docs/00_ADR.md` (append)                                                                  | ADR-116 as frozen above                                                                                                                               | R1      |
| `docs/03_ARCHITECTURE.md` §14 (`:496` heading, `:530` §14.3, `:534`, `:555`, `:658`)       | retitle §14 to project-scoped composition; replace the `teamId` scope description and the Workspace ⊃ Tasks embed rule with the Projects tab contract | R3      |
| `docs/04_DESIGN.md:62,67,75`                                                               | satellite rows for Inbox / Workspace / board-boundaries marked superseded                                                                             | R3      |
| `docs/04_DESIGN.md:143`                                                                    | `spur team` verb block gains the deprecation note and the 0848 replacements                                                                           | R3      |
| `docs/design/workspace-design.md` · `inbox-board-module.md` · `board-module-boundaries.md` | **superseded banner at the head only**; bodies untouched                                                                                              | R2 + R3 |
| `docs/design/project-switcher.md`                                                          | new § describing `.spur/fleet.json` and fleet resolution; `owns:` widened                                                                             | R3      |
| `docs/01_PRD.md:65,96`                                                                     | capability rows naming `spur team` → the owning nouns                                                                                                 | R3      |
| `plugins/sp/skills/spur-cli/references/team.md`                                            | deprecation header + per-verb replacement table                                                                                                       | R3      |
| `…/references/agent.md:94,179,219,226` · `self.md:98,108` · `message.md:132`               | cross-references to `spur team up/start/stop`                                                                                                         | R3      |
| `…/references/projects.md`                                                                 | `--fleet`, and `migrate` if 0846's consent row was granted                                                                                            | R3      |
| `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:131`                  | supervisor→member dispatch row                                                                                                                        | R3      |
| `docs/help2/{team,index,agent,serve,message,daily-development-workflow}.md`                | end-user help; hand-maintained, no generator                                                                                                          | R3      |
| `config/config.example.yaml:183-184`                                                       | the `agent.team` template block → fleet                                                                                                               | **R4**  |

**R4's one real portable artifact is `config/config.example.yaml`.** `apps/cli/src/commands/init.ts:170`
seeds it as `~/.config/spur/config.yaml` on first run, so its `# Declarative teams (feature M) —
materialize with \`spur team up <teamId>\``comment at`:183` is what every new project inherits.
Leaving it is how a retired concept keeps being taught to new installs.

**Sequencing correction — the noun still exists when this task runs.** 0848 ships a _deprecation
warning_, not a removal: the six verbs keep working until Robin's cutover window. This task therefore
**documents the deprecation with replacements**, and does not delete `team.md` or the `spur team`
help page. Deleting them here would make the references contradict the shipped CLI, which is the
exact failure R3 exists to prevent.

**Why `project-switcher.md` absorbs the fleet section instead of a new satellite.** It already owns
the project registry and Board switching surface (`feature_id: K1`, `owns: SURFACE + mechanism for
multi-project Spur Board switching`), which is the surface the fleet hangs off. A new satellite would
duplicate its project-identity and registry sections to say the same thing. Rejected alternative:
`docs/design/project-agent-fleet.md` — revisit only if the fleet section outgrows its host.

**Anti-patterns — do not implement.**

- Do not edit ADR-052's Decision, Why, or Detail. Only its status line moves.
- Do not edit ADR-037, ADR-057, or ADR-022. Naming them in ADR-116 is the retention.
- Do not rewrite or delete `docs/design/workspace-design.md` or `inbox-board-module.md`; banner only.
- Do not touch `docs/tasks*/`, `docs/features/`, `docs/plans/`, or `docs/memo.md`.
- Do not delete `spur team`'s CLI reference or help page — the noun still ships, deprecated.
- Do not allocate an ADR number other than 116, and do not renumber anything.
- Do not update an owner that says nothing about the changed facts, to satisfy a checklist.

**Handoff.** 0851 is the last task; it closes M6 and records the disposition of M3, G1, and G4 against
this program. Nothing in 0851 depends on this task's text beyond ADR-116 existing.

### Plan

1. **Re-verify the ADR ceiling before allocating.** `grep -n "^## ADR-" docs/00_ADR.md | tail -1` must
   still show ADR-115. If another feature has landed 116 in the meantime, take the next free number
   and update every reference in this task's Design in the same edit. _(R1)_
2. **Flip ADR-052's status line** at `docs/00_ADR.md:500` to `**Status:** Superseded by ADR-116`,
   leaving date, feature, `Supersedes: ADR-042`, Decision, Why, and Detail byte-identical. _(R1, R2)_
3. **Append ADR-116** exactly as frozen in the Design, with the ship date filled in and the Retains
   line naming ADR-037, ADR-057, and ADR-022. _(R1, R2)_
4. **Test intent — the supersession is machine-checkable.** A docs test asserting (a) ADR-052's status
   line reads `Superseded by ADR-116`, (b) ADR-116 exists with a `Supersedes: ADR-052` field, and
   (c) no ADR before 116 changed in this commit (`git diff --stat docs/00_ADR.md` touches only the two
   known line ranges). (c) is what makes R2 an assertion rather than a promise. _(R1, R2)_
5. **Rewrite `docs/03_ARCHITECTURE.md` §14** — retitle the heading at `:496` and replace §14.3's
   accepted-boundary text (`:530-534`) and the Workspace ⊃ Tasks embed rule (`:555`) with the
   project-scoped equivalent: fleet resolution, the Projects tab contract from 0840, and the Inbox
   `mergeTimeline` note at `:658` re-pointed at the Conversation tab. _(R3)_
6. **Banner the three superseded satellites** — `workspace-design.md`, `inbox-board-module.md`,
   `board-module-boundaries.md` — with a one-line head note naming ADR-116 and the replacement
   surface. Do not edit their bodies. _(R2, R3)_
7. **Extend `docs/design/project-switcher.md`** with the fleet section (`.spur/fleet.json` shape from
   0835, `FleetService` resolution, the Projects module's three tabs) and widen its `owns:` line to
   cover the project fleet. _(R3)_
8. **Update `docs/04_DESIGN.md`** rows `:62`, `:67`, `:75` to mark the superseded satellites, and the
   `spur team` verb block at `:143` to carry the deprecation plus the replacement shapes 0848 shipped.
   _(R3)_
9. **Update `docs/01_PRD.md:65,96`** so the capability rows name the owning nouns instead of
   `spur team`. Touch nothing else in the PRD. _(R3, R5)_
10. **Update the plugin references** — `team.md` (deprecation header + per-verb replacement table),
    the cross-references in `agent.md:94,179,219,226`, `self.md:98,108`, `message.md:132`,
    `projects.md` (`--fleet`, plus `migrate` only if 0846's consent row was granted), and
    `parallel-execution/references/dispatch-surface.md:131`. _(R3)_
11. **Update `docs/help2/`** — `team.md` gains the deprecation and replacement table; `index.md`,
    `agent.md`, `serve.md`, `message.md`, and `daily-development-workflow.md` get their `spur team`
    references re-pointed. These are hand-maintained; there is no generator to re-run. _(R3)_
12. **Update the init template** at `config/config.example.yaml:183-184`: replace the
    `# Declarative teams (feature M) — materialize with \`spur team up <teamId>\``block with the
fleet equivalent, since`init.ts:170` seeds this file into every new install. _(R4)_
13. **Test intent — parity.** Run the existing plugin-surface parity suite (ADR-053) so the
    `sp:spur-cli` references, the spine step table, and `AGENTS.md` are diffed against the live CLI;
    a reference that now describes a verb the CLI does not expose fails there rather than in review.
    _(R3)_
14. **Prove R5 by diff, not by claim.** `git diff --name-only` must list only the files in the
    Design's owner inventory. Any extra path is either added to the inventory with its trigger, or
    reverted. _(R5)_
15. **Gate.** `bun run spur-check`, then `spur task check 0850`. Record the final file list and the
    ADR number actually allocated in the Solution section.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

**Pipeline verify results**

- Verdict: FAIL (from verdict artifact)

| Requirement | Status  | Evidence                                                                                                                                                                                                                                                                         |
| ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1          | UNMET   | `docs/00_ADR.md:500` — ADR-052 is Accepted; ADR-116 is absent; refreshed local verification scratch `.spur/run/0850-verify-answer.txt` lines 1-37 and derived `.spur/run/0850-verdict.json`; repository gate separately FAILs on three concurrent taste-refactoring skill checks |
| R2          | PARTIAL | Existing historical ADRs remain, but no replacement decision explicitly records the planned retained authorities                                                                                                                                                                 |
| R3          | PARTIAL | Migration and fleet startup surfaces are documented; the planned retirement/supersession is absent, so retirement-era authority reconciliation is incomplete                                                                                                                     |
| R4          | PARTIAL | No retirement template migration is present; cancelled task did not execute its portable reconciliation plan                                                                                                                                                                     |
| R5          | MET     | This audit preserves historical ADRs and changes only the owners of repaired runtime facts                                                                                                                                                                                       |

| Acceptance Criteria                                      | Status | Evidence Type | Evidence                                                                                     |
| -------------------------------------------------------- | ------ | ------------- | -------------------------------------------------------------------------------------------- |
| Scenario: Superseded authority is corrected at its owner | UNMET  | command       | `docs/00_ADR.md:500` — Accepted remains; search for ADR-116 returned no replacement decision |
| Scenario: History is preserved                           | MET    | command       | git diff of docs/00_ADR.md is empty; historical decision bodies preserved                    |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: FAIL)

| Priority | Dimension          | Location | Finding                                                                                                                                                                      |
| -------- | ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4       | spur task check    | —        | task check passed                                                                                                                                                            |
| P4       | design-conformance | —        | NOT DONE: ADR-052 supersession, replacement decision, and retirement template reconciliation. Cancellation does not establish supersession.                                  |
| P4       | scoped-checks      | —        | G64 focused tests, bun run typecheck, bun run test-cf, bun run build — exit 0 this run; full repository gate separately failed on concurrent taste-refactoring skill changes |
| P4       | task-check         | —        | spur task check 0850 --strict-core --json — exit 0                                                                                                                           |
| P4       | secua-review       | —        | Authority supersession required by G64 R6 is missing; cancelled task remains cancelled pending an explicit disposition.                                                      |
| P4       | evidence-rule-pass | —        | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral.                                                                                      |

### References

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Authority owners: `docs/00_ADR.md` (ADR-052 superseded; ADR-037, ADR-057, ADR-022 retained)
- Derived owners: `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md` and `docs/design/`, `plugins/sp/skills/spur-cli/references/`, init templates
- Process: `docs/99_PROJECT_CONSTITUTION.md` placement guard

### History

- 2026-09-13T15:10:10.486Z todo → cancelled (system)
