---
schema_version: 1
name: Reconcile superseded authority across ADRs, architecture, and templates
status: done
template: feature-impl
created_at: 2026-09-12T04:55:45.303Z
updated_at: "2026-09-15T01:23:17.043Z"
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

**Q: What is the portable artifact R4 is about?** `config/config.example.yaml`. `apps/cli/src/commands/init.ts:170-179` seeds it
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

**Allocated ADR number:** **116** (`docs/00_ADR.md:1668`) — the ceiling re-checked immediately before
writing showed ADR-115 as the last entry (`docs/00_ADR.md:1639`), so no renumbering was needed.

**Where.** ADR-052's status line flipped (`docs/00_ADR.md:500`), ADR-116 appended
(`docs/00_ADR.md:1668`), a supersession test added (`apps/cli/tests/adr-supersession.test.ts`), §14 of
the architecture rewritten to project scope (`docs/03_ARCHITECTURE.md:496-568`), satellites bannered,
the fleet data contract added to `docs/design/project-switcher.md` §3.1, `04_DESIGN` rows + the
`spur team` deprecation block, `01_PRD`'s board-composition row, six `help2/` pages, and both seeded
config templates.

**Final file list — R5's proof, not a claim.** 21 paths changed (`git status --porcelain`): 20
deliverables plus this task file. In the Design's owner inventory: `apps/cli/tests/adr-supersession.test.ts`,
`config/config.example.yaml`, `docs/00_ADR.md`, `docs/01_PRD.md`, `docs/03_ARCHITECTURE.md`,
`docs/04_DESIGN.md`, `docs/design/{board-module-boundaries,inbox-board-module,project-switcher,workspace-design}.md`,
`docs/help2/{agent,daily-development-workflow,index,message,serve,team}.md`. Added by a recorded
deviation: `config/config.global.yaml`, `docs/design/{cli-contracts,spur-team-mode-design}.md` (the
portable global template and two further satellites that still presented the retired noun as current).
Present but fingerprinted-input-neutral: `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md`
(one AC scenario) and this task file. Nothing else is staged or untracked.

**Deviations, each with its trigger.**

- **G64's AC gained `Scenario: R8 — History is preserved`.** The `record → done` guard failed
  `L4.uncovered-task-scenario`: this task's second scenario had no feature-level counterpart. G64's
  `## Scope` already names "Do not rewrite historical ADRs or feature receipts" as in-scope, so the
  feature AC was incomplete, not the task over-reaching; flipping 0850's `ac_altitude` to `task-local`
  would have declared a real ship criterion task-local. The scenario sits at R6's altitude and is
  `@core`. Verified: `spur feature check G64` passes with the error gone.
- **R4's premise corrected.** `apps/cli/src/commands/init.ts:170-179` seeds the bundled
  **`config.global.yaml`** (`BUNDLED_GLOBAL_CONFIG`, `packages/config/src/bundled-config.ts:120`) as
  `~/.config/spur/config.yaml` on first run — the comment at `apps/cli/src/commands/init.ts:170` still says
  `config.example.yaml`, which is where the failure mode in this task's Q&A came from.
  `config/config.example.yaml` is the checked-in project template. Both are portable artifacts and both
  now describe the fleet; `spur init` into a clean HOME + project was run and seeds the fleet text with
  zero occurrences of the retired `spur team up` teaching string.
- **Three extra files joined the banner/template set** (review pass 1 P4s, judgement confirmed by
  inspection): `docs/design/spur-team-mode-design.md` (status line → Superseded, banner naming
  ADR-116 and the fleet), `docs/design/cli-contracts.md` (deprecation note on the `spur team` section
  pointing at the per-verb table), `config/config.global.yaml` (stale claim that `agent.team` is a
  project-shaped key). Bodies are otherwise untouched.
- **Plan step 10 needed no edit.** 0848 had already re-pointed `team.md`, `agent.md`, `tasks.md`,
  `message.md`, `self.md`, and `projects.md`; `plugins/sp/skills/parallel-execution/references/dispatch-surface.md`
  carries no `spur team` noun reference. Verified by inspection, so R5 forbids touching them.

**Tree history — recorded, not hidden.** The change set was implemented in the `--worktree` tree
(`../spur-new-run-0850-5f6382`, branch `sp/run-0850-5f6382` @ `4430b54bf`, retained) and cherry-picked
into the main checkout for certification, because `bun run spur-check` cannot go green inside a git
worktree on this machine: `scripts/commands/bundle-plugin-lib.test.ts` compares the committed
`plugins/sp/lib/idea-handoff.generated.mjs` against a fresh bundle and the minified identifiers differ
between the main checkout and a worktree install (46 renames, no semantic difference; main reproduces
the committed bytes exactly, a worktree does not, and renaming the worktree path changes nothing).
Both trees collected the identical proof digest, since the fingerprint is content-based. The three
review-remediation files (`config/config.global.yaml`, `docs/design/cli-contracts.md`,
`docs/design/spur-team-mode-design.md`) exist only here — the retained branch stops at the original
18-path change set and is kept for recovery, not as a complete copy.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Corrected anchors (0854's additive amendments shifted ADR-052/116 lines; re-derived fresh this run): `docs/00_ADR.md:506` — ADR-052 status line reads `Superseded by ADR-116 · Date: 2026-08-11 · Feature: G3 · Supersedes: ADR-042`; `docs/00_ADR.md:1695` — `## ADR-116: Project-Scoped Fleet Composition Replaces Team-Scoped Board Composition`; `:1697` — status Accepted 2026-09-14 with `Supersedes: ADR-052 (and ADR-042 via it)`; `:1707` — `Retains: ADR-037 / ADR-057 / ADR-022`. Ceiling claim re-anchored: ADR-115 heading at `docs/00_ADR.md:1666`, so 116 was the next free number. Machine check fresh: adr-supersession suite inside cd apps/cli && bun test tests/commands/projects.test.ts tests/commands/team-retirement.test.ts tests/adr-supersession.test.ts tests/commands/agent-spec-flag.test.ts tests/commands/agent.test.ts — exit 0, 95 pass / 0 fail / 344 expect (fresh 2026-09-14) |
| R2 | MET | Additivity re-derived against the committed record: `git show 7db3fb9ba --numstat -- docs/00_ADR.md` → 17 added / 1 removed (the single removal is ADR-052's old status line); 0854's follow-up `git show a1c647eae --numstat` → 29 added / 2 removed (two replacement status lines). ADR-037/057/022 unmodified and retained by name at `docs/00_ADR.md:1707` (re-read this run). The four bannered satellites keep their bodies with head notes (`docs/design/workspace-design.md:9-11`, `inbox-board-module.md:9-11`, `board-module-boundaries.md:9-12`, `spur-team-mode-design.md:3-8` — re-read this run). Guard tests green inside the fresh CLI batch (95 pass). |
| R3 | MET | Derived surface matches the shipped tree, re-verified this run: `docs/03_ARCHITECTURE.md:496-502` names the five live modules (re-read); modules dir listing fresh — no workspace/inbox/teams; `mergeTimeline` → 0 hits under apps/web/src (exit 1, fresh); replacements exist (`apps/web/src/modules/projects/conversation.ts:111` parseInboxMessages — re-read); redirects at `apps/web/src/router.tsx:14-19` (re-read); `FleetDeclarationSchema` at `packages/config/src/index.ts:537` and FleetService methods at `packages/app/src/services/fleet-service.ts:136,173,250,317,442` match `docs/design/project-switcher.md:64-102` (anchors re-read); `docs/01_PRD.md` retains zero `spur team` occurrences (fresh grep, exit 1); deprecation surfaces present at `docs/04_DESIGN.md:145-159`, `docs/help2/team.md:3-11`, `docs/design/cli-contracts.md:520-524` (re-read this run) |
| R4 | MET | Premise holds in code, re-verified this run: `apps/cli/src/commands/init.ts:31` (GLOBAL_CONFIG_EXAMPLE = BUNDLED_GLOBAL_CONFIG), `:170-179` seed block, `packages/config/src/bundled-config.ts:120` — anchors re-read. Outcome re-proven fresh: clean-HOME `bun apps/cli/src/index.ts init --minimal` from a fresh project dir → `~/.config/spur/config.yaml` written and byte-identical to `config/config.global.yaml` (diff empty), carrying the fleet text at `config/config.global.yaml:22-23`; `rg -n 'spur team up' config/config.global.yaml config/config.example.yaml` → no match (exit 1); fleet block present at `config/config.example.yaml:183-205` (re-read) |
| R5 | MET | Ownership discipline now committed: `git status --porcelain` → clean tree; the 16 Design-inventory deliverables + 3 recorded deviation files landed across the G64 commits (7db3fb9ba, e23efdaaa, a1c647eae); every touch was an owner whose facts changed. Plugin reference tree carries the 0848 deprecation (`plugins/sp/skills/spur-cli/references/team.md:3,8`, `agent.md:262,268` — re-read this run); `config/transition-shims.json:26` intact (re-read) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Superseded authority is corrected at its owner | MET | test | Supersession recorded at `docs/00_ADR.md:506` + ADR-116 at `:1695-1707` (anchors re-read and corrected this run); adr-supersession guard tests green inside the fresh CLI batch (95 pass / 0 fail); derived owners match the shipped tree (R3 re-derivations above) |
| Scenario: History is preserved | MET | command | `git show 7db3fb9ba --numstat -- docs/00_ADR.md` → 17/1 (the one deletion is the replaced status line); `git show a1c647eae --numstat` → 29/2; no historical decision text moves; no `docs/tasks*/` receipt modified by either commit (name-only listings verified this run) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0850 · pass 3 (post second remediation hop)

**Scope:** task `docs/tasks4/0850_reconcile-superseded-authority-across-adrs-architecture-and-.md`, requirements R1–R5 and both Gherkin scenarios, against the working diff — 21 paths (`git status --porcelain`, 20 deliverables + this task file) vs HEAD `f2f0bb234`.
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS — no P1/P2; one P3 introduced by this hop (finding #1), carried for closure

**Fresh evidence, captured in this order.**

- `bun run spur-check` (re-run after the hop) → **8481 pass / 0 fail**, 34641 expect() calls, 476 files (205.26s); `recommended-pre-check` → "All 45 rules passed", `recommended-post-check` → "All 2 rules passed" (`.spur/run/0850-test-gate.log:26-27,380-381`; `.spur/run/0850-test-gate.status` = `PASS`).
- Proof digest recomputed independently this pass: `bun .spur/run/proof-digest.ts <task> <feature>` → `sha256:99e50d04b385398d832611f4ac845e77544ff6b289cd21be8b80840bf6904cff` — byte-identical to `.spur/run/0850-test-gate.log:382` and `/tmp/0850-digest-main`. Scope verified in code, not assumed: the spec half is `Background, Requirements, Acceptance Criteria, Design, Plan` (`packages/app/src/workflow/proof-input-fingerprint.ts:100`), and the tree half excludes `docs/tasks*`, so this pass's `Solution`/`Q&A` writes sit outside the fingerprint; the digest moved only because `docs/help2/serve.md:34` changed.
- Change set since pass 2 enumerated, not asserted: `find . -newermt "2026-09-14 09:22:30" -type f` (excluding `.git`, `.spur`) → `docs/help2/serve.md`, this task file, plus the gate's own regenerated artefacts (`plugins/sp/lib/*.generated.mjs`, `.coverage/lcov.info`). No other source file moved.
- `bun test apps/cli/tests/adr-supersession.test.ts` → 4 pass / 0 fail (32 assertions).
- `bun test plugins/sp/tests/cli-surface-parity.test.ts plugins/sp/tests/command-flag-parity.test.ts` → 99 pass / 0 fail (405 assertions).
- `spur task check 0850 --as done` → **PASS** with one `L4` warning; `spur task check 0850 --strict-core` → PASS, same single warning, exit 0.
- `spur feature check G64 --json` → PASS; only the two expected `L4.scenario-unverified` warnings for R6/R8, which clear at this run's verify stage.
- Retained branch re-checked: `sp/run-0850-5f6382` @ `4430b54bf` (checked out at `../spur-new-run-0850-5f6382`), working tree clean, `fleet` count 0 in its `config/config.global.yaml`, banner/deprecation counts 0 in its `docs/design/{cli-contracts,spur-team-mode-design}.md`.

**The three claimed changes, verified one by one.**

- `docs/help2/serve.md:34` — `- **Web UI** — task kanban, workflow runs, history analytics, project fleet status.` Real fix, not a rewording: the shipped surface is the Projects module's roster reading `GET /api/project/fleet` (`apps/web/src/modules/projects/AgentsView.tsx:9,84-85`), and the retired `teams` route now redirects there (`apps/web/src/router.tsx:14-18`).
- `Solution` count → "21 paths … 20 deliverables plus this task file": accurate. `git status --porcelain | wc -l` = 21 with no `??` entry; the enumeration is 16 inventory paths + 3 recorded deviations + the G64 feature file = 20 deliverables, plus this task file.
- `apps/cli/src/commands/init.ts:170-179` anchor: resolves and names the right subject — those ten lines are the `GLOBAL_CONFIG_EXAMPLE` → `GLOBAL_CONFIG_FILE` seed block (`apps/cli/src/commands/init.ts:31,34,170-179`). The tree-history sentence is also true as written, verified against the branch above.
- `Q&A` anchor qualification: **not achieved** — see finding #1. The original bare anchor survives and the fix also duplicated the entry.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | traceability | **New this hop.** The Q&A "anchor qualification" landed as an append, not a replace: `--section "Q&A"` appends a timestamped entry by design (`apps/cli/src/commands/task.ts:434-435`), so the complete 2026-09-12 entry now exists twice — copy A verbatim with the stale bare `init.ts:170` (`:93`), copy B with the qualified anchor (`:150`) nested under a new, otherwise empty `2026-09-14T16:23:25.232Z` wrapper (`:112`). `diff` between the two copies is exactly that one anchor line; 44 lines are duplicated. Net effect: the anchor the edit targeted still reads bare in the live record, and a reader meets the whole refinement Q&A twice. Closure fix: `spur task update 0850 --section Q&A --from-file <body starting with \`<!-- qa:replace -->\`>` (documented at `apps/cli/src/commands/task.ts:435`), or accept the duplication explicitly. | `docs/tasks4/0850_…md:112-162` (duplicate), `:93` (stale copy) |
| 2 | P4 (advisory) | correctness | The single remaining `L4.stale-line-anchor` warning is `init.ts:170` cited **in prose inside the Solution**, not in the Plan: the corrected R4 bullet cites the full path at `:330` and then refers back to it with the bare form at `:332`. Accepted — see the acceptance note below. The attributed section is not part of the proof fingerprint, so it is fixable without a digest loop, and the checker classes it `warning` (exit 0 under both `--as done` and `--strict-core`). | `docs/tasks4/0850_…md:332` |
| 3 | P4 (advisory) | correctness | Carried from pass 2 (#5). The approved Design still sends a reader to the wrong portable artifact — `config/config.example.yaml` is named as the file `init.ts:170` seeds — and Plan step 12 repeats it; the Q&A now carries both the stale sentence and the corrected copy, which muddies the reader path instead of annotating it. The recorded deviation in the Solution is the sanctioned path, so this is advisory on the reader path only. | `docs/tasks4/0850_…md:222`, `:289`, also `:93` |
| 4 | P4 (advisory) | consistency | Carried from pass 2 (#6). ADR-086 still presents `agent.team.<id>.members` as the roster config layer and prescribes the commented-in `agent.team.demo` example — the teaching artefact this task replaced in `config/config.example.yaml`. ADR-116's retention line names ADR-037/057/022, so ADR-086 is neither superseded nor declared retained. Not false today (the legacy key still parses) and R5 justifies leaving authority alone, so this belongs to the cutover commit. | `docs/00_ADR.md:1116`, `:1124`, `:1144` |
| 5 | P4 (advisory) | consistency | Carried from pass 1 (#3 rider) and pass 2 (#7). The R8 scenario insert left a double blank line inside G64's AC fence. Does not affect the scenario's parse or `spur feature check G64` (PASS). | `docs/features/G64_…md:106-107` |

##### Prior pass disposition

One table covering both earlier passes. Pass 1's verbatim report is preserved at `.spur/run/0850-review-pass1.md`; pass 2's report was superseded in place by this section — the `Review` section is replace-on-write, not archived — and is dispositioned row by row below rather than quoted. `git show :docs/tasks4/0850_…md` is not a pass-2 snapshot: it is an older index revision that still holds the pre-`Solution` state and the legacy SECU review block.

| Pass | Finding | Priority | Status now | Evidence |
|------|---------|----------|-----------|----------|
| 1 | 1 — stale `### Testing` FAIL table contradicting the Review | P2 (major) | **RESOLVED** | `### Testing` still carries the pending note naming why the table was removed (`docs/tasks4/0850_…md:358-364`); the only `UNMET`/`Verdict: FAIL` string left in the file is inside this disposition table's own text (`:402`); `spur task check 0850 --as done` → PASS. The section's subject belongs to the verify stage. |
| 1 | 2 — `### Solution` empty | P3 (minor) | **RESOLVED** | Solution holds the ADR number, the WHERE map, the 20-path list and four triggered deviations (`:300-356`). |
| 1 | 3 — G64 R8 deviation recorded nowhere in-tree | P3 (minor) | **RESOLVED** (substance); cosmetic rider open (finding #5) | Rationale and trigger in the Solution; `spur feature check G64 --json` → PASS with no `L4.uncovered-task-scenario`. |
| 1 | 4 — R4's stated premise is false | P3 (minor) | **RESOLVED**; reader path open (finding #3) | Correction at `:329-334`; seeded global layer fixed (`config/config.global.yaml:19-25`); root cause anchored at `apps/cli/src/commands/init.ts:31`. |
| 1 | 5 — live seeded global layer still listed `agent.team` | P4 (advisory) | **RESOLVED** | `config/config.global.yaml:19-25` — roster is `.spur/fleet.json`, legacy key parses, noun deprecated. |
| 1 | 6 — `cli-contracts.md` team block carried no deprecation note | P4 (advisory) | **RESOLVED** | `docs/design/cli-contracts.md:520-524` — "Deprecated (0848, feature G64)" with the per-verb pointer and the `team-noun-retired` removal condition. |
| 1 | 7 — team-mode satellite presented `spur team` as current | P4 (advisory) | **RESOLVED** | `docs/design/spur-team-mode-design.md:3-9` — banner plus the status line flipped to "Superseded (ADR-116)"; body untouched. |
| 1 | 8 — ADR-test `(c2)` goes vacuous once committed | P4 (advisory) | **ACCEPTED AS RECORDED** | Documented in-line at `apps/cli/tests/adr-supersession.test.ts:84-88`; `(c1)` remains the durable guard and is green. |
| 1 | 9 — tree switch recorded for retention but not the cherry-pick | P4 (advisory) | **RESOLVED** | The tree-history paragraph names the worktree, branch, commit, retention and the bundle-plugin-lib reason (`:347-356`). |
| 2 | 1 — stale headline count ("18 paths" against a 20-path list) | P3 (minor) | **RESOLVED** | Now "21 paths … 20 deliverables plus this task file" (`:312-313`); `git status --porcelain` = 21, no `??`. |
| 2 | 2 — bare `init.ts:170` anchor, reported as `L4.stale-line-anchor` | P3 (minor) | **PARTIAL** — qualified copy added, stale copies survive; a duplicate was introduced | `:330` now cites `apps/cli/src/commands/init.ts:170-179`, but the same bullet keeps a bare form at `:332` (finding #2), the Plan copy at `:289` is untouched, and the original Q&A copy at `:93` survives because the Q&A write appended instead of replacing (finding #1, new this pass). |
| 2 | 3 — `docs/help2/serve.md` still advertised "team status" | P3 (minor) | **RESOLVED** | `docs/help2/serve.md:34` → "project fleet status", verified accurate against the live roster fetch (`AgentsView.tsx:9,84-85`) and `RETIRED_ROUTES` (`apps/web/src/router.tsx:14-18`). |
| 2 | 4 — tree-history paragraph described only the pass-1 transfer | P3 (minor) | **RESOLVED** | The added sentence names the three review-remediation files and states the branch stops at the original 18-path set — both verified this pass against the clean branch at `4430b54bf`. |
| 2 | 5 — Design/Q&A/Plan still assert the corrected R4 premise, unannotated | P4 (advisory) | **STILL OPEN** (finding #3) | Design `:222` and Plan `:289` unchanged; the Q&A now holds both versions, so the ambiguity widened rather than closed. |
| 2 | 6 — ADR-086 presents the retired mechanism as current | P4 (advisory) | **UNCHANGED, by design** (finding #4) | Owner is the cutover commit; no edit since pass 2. |
| 2 | 7 — double blank line inside G64's AC fence | P4 (advisory) | **STILL OPEN** (finding #5) | `docs/features/G64_…md:106-107`. |

##### Traceability — R1–R5

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `docs/00_ADR.md:500` — ADR-052's status line reads `Superseded by ADR-116` with date, feature, `Supersedes: ADR-042` intact. `docs/00_ADR.md:1668` — ADR-116 appended, `**Supersedes:** ADR-052` at `:1670`, `**Retains:**` at `:1680`; the pre-append ceiling was ADR-115 (`:1639`), so 116 was the next free number and nothing was renumbered. Machine-checked: `apps/cli/tests/adr-supersession.test.ts` → 4 pass / 0 fail this pass. |
| R2 | MET | `git diff HEAD --numstat -- docs/00_ADR.md` = 17 added / 1 removed in exactly two hunks (`@@ -497,7 +497,7 @@`, `@@ -1664,3 +1664,19 @@`) — the status line and the append, nothing else. Test `(c1)` asserts ADR-052 is the only pre-116 ADR carrying the pointer; `(c2)` asserts the removed line is the old status line. ADR-037, ADR-057 and ADR-022 are unmodified and retained by name at `:1680`. The superseded satellites stay banner-only (`docs/design/workspace-design.md:9`, `inbox-board-module.md:9`, `board-module-boundaries.md:9`, `spur-team-mode-design.md:3-9`, `cli-contracts.md:520-524`) with bodies untouched. No `docs/tasks*/` receipt is modified. |
| R3 | MET | §14 retitled and rewritten to project scope with the live module inventory (`docs/03_ARCHITECTURE.md:496-502`); fleet data contract in `docs/design/project-switcher.md:64-102` with `owns:` widened (`:4`) and `FleetService`'s five methods named (`packages/app/src/services/fleet-service.ts:136,173,250,317,442`) against `FleetDeclarationSchema` (`packages/config/src/index.ts:530-538`); deprecation surfaces per-verb (`docs/help2/team.md:3-14`, `docs/design/cli-contracts.md:520-524`, `docs/04_DESIGN.md:143-160`); plugin references verified already correct and deliberately untouched; the one help-page miss from pass 2 is fixed and now matches the shipped roster (`docs/help2/serve.md:34`). |
| R4 | MET | Both portable artefacts carry the fleet rather than the retired noun: `config/config.example.yaml:183-205` (shape shown, "Materialized at `spur serve` start", legacy key parses) and `config/config.global.yaml:19-25` (roster is `.spur/fleet.json`, not a config key). Seeding path re-anchored and correct: `apps/cli/src/commands/init.ts:31,170-179` with `BUNDLED_GLOBAL_CONFIG` (`packages/config/src/bundled-config.ts:120`). The clean-HOME `spur init` proof was collected at pass 2 and is unchanged since — no config file appears in this pass's mtime diff. |
| R5 | MET | 21 porcelain paths, none untracked; each maps to a Plan step or a recorded deviation, and the headline count now matches the enumeration. The three deviation files (`config/config.global.yaml`, `docs/design/cli-contracts.md`, `docs/design/spur-team-mode-design.md`) are recorded with triggers, and the G64 feature file is the recorded R8 deviation. |

##### Scenario verdicts

| Scenario | Status | Evidence type | Evidence |
|----------|--------|---------------|----------|
| Superseded authority is corrected at its owner | MET | command | Status flip + ADR-116 (`docs/00_ADR.md:500`, `:1668-1680`); architecture, satellites, design index, CLI references and both seeded templates verified against the shipped surface above; `spur task check 0850 --as done` → PASS; `spur task check 0850 --strict-core` → PASS. |
| History is preserved | MET | command | `git diff HEAD -- docs/00_ADR.md` = the two allowed hunks only; `apps/cli/tests/adr-supersession.test.ts` (c1)/(c2) green; ADR-037/057/022 unmodified and retained by name; the four bannered satellites have untouched bodies; no receipt under `docs/tasks*/` is touched. |

##### Judgment calls

**The residual `L4.stale-line-anchor` warning — accepted, but the stated attribution needs correcting.** `spur task check 0850 --json` reports the warning in **section `Solution`**, triggered by the bare `init.ts:170` at `docs/tasks4/0850_…md:332` — not by the Plan's prose. Both sections carry the bare form (Solution `:332`, Plan step 12 `:289`, plus the stale Q&A copy at `:93`), but the checker only scans `Testing` and `Solution` (`packages/app/src/services/task-check.ts:1447-1460`), so the Plan occurrence costs nothing at all. The "fingerprinted section, left untouched to avoid another certification loop" rationale therefore does not hold as stated in either direction: the Plan is fingerprinted but is not scanned, and the Solution *is* scanned but is **not** fingerprinted (`proof-input-fingerprint.ts:100`), so fixing `:332` would not move the digest. Verdict on acceptance: yes — accept the warning as non-blocking. It is `warning`-class (exit 0 under both `--as done` and `--strict-core`), it is prose referring back to the fully-qualified anchor one line above it at `:330`, and R1–R5 and both scenarios are unaffected. If anything is done at closure, the cheap and correct move is to qualify `:332` (no digest loop, no gate re-run needed) rather than to leave it and cite the Plan; otherwise record the acceptance explicitly with the corrected attribution.

**The Q&A duplication is the only defect introduced since pass 2, and it is a record defect, not a requirement miss.** Root cause is the writer's semantics, not the edit's intent: `spur task update --section "Q&A"` appends a timestamped entry (`apps/cli/src/commands/task.ts:434-435`), and the staging file `/tmp/0850-qa.md` (09:23 local, matching this run's `updated_at` `2026-09-14T16:23:25.233Z`) is the whole section body with no wrapper heading — exactly what an append cannot consume. Rated P3 (minor) because it is localized to the task record, contradicts no requirement, fails no checker, and touches no shipped artefact; it nevertheless must be dispositioned (fix, or accept 44 duplicated lines) rather than left implicit, since the intended qualification only half-landed. P1/P2 are unaffected either way: no requirement verdict changes.

**Tree switch (worktree → main) — still faithful, re-verified independently.** The branch `sp/run-0850-5f6382` @ `4430b54bf` is clean and predates the review-remediation edits (0 occurrences of the fleet text or banners in the three files), which is what the new tree-history sentence claims; the certified tree is main and it is the tree the gate, the digest and this review describe. `git status` shows no untracked path, so nothing beyond the enumerated 21 leaks into the proof.

**ADR-116 allocation and R2's diff boundary — checkable, and they check out.** Two hunks, 17 added / 1 removed, ADR-052's Decision/Why/Detail byte-identical, ADR-116 at `:1668` with `Supersedes` and `Retains` present. Test `(c2)`'s commit-time vacuity remains the one accepted-by-design guard gap (pass-1 #8).

**Architecture, security, efficiency, usability — no material findings, unchanged from pass 2.** The change set is documentation, two config templates and one repo-invariant test; no runtime module, API or data path is touched, so the deepening lens has nothing to bite on. `apps/cli/tests/adr-supersession.test.ts` remains the right seam for a doc invariant (sibling tests own this class), and its only subprocess call is `execFileSync('git', ['diff', …])` with literal arguments — no injection surface. The one usability-visible artefact changed this pass (`docs/help2/serve.md:34`) is now accurate and reader-first.

##### Residuals and owners

| Residual | Owner |
|----------|-------|
| Finding #1 — duplicated Q&A entry (44 lines), stale bare anchor still in the surviving copy | **0850's own closure** — `--section Q&A --from-file` with `<!-- qa:replace -->`, or explicit acceptance |
| Finding #2 — the single `L4.stale-line-anchor` warning at `Solution:332` | **0850's own closure** if fixed (accepted for now, one-line change, no digest impact); the Plan copy at `:289` needs nothing |
| Finding #3 — Design `:222` / Plan `:289` (and the surviving Q&A copy) still name `config/config.example.yaml` as the seeded artefact | **0850's own closure** (annotate in place) or accepted as the recorded deviation |
| Finding #5 — double blank line inside G64's AC fence | **0850's own closure** (cosmetic) |
| `### Testing` holds a pending note rather than a verdict | Pipeline verify stage, scheduled after approve — the correct state now, not a gap |
| Pass 2's verbatim report body is no longer stored anywhere (the `Review` section is replace-on-write) | Process/acceptance, **not 0850's implementation** — the mitigation is the per-finding disposition table above; if verbatim retention matters, the writer would have to archive to `.spur/run/` as pass 1 did |
| Finding #4 — ADR-086 still presents `agent.team.<id>.members` and the `agent.team.demo` example as current | The **cutover commit** that removes the noun — same owner as the deferred satellite/reference deletions recorded in this task's Q&A. Not 0852/0853: both are Board-reachability/ownership tasks |
| Retired Board surfaces: the process watch list (executions + 0267 filters) and the three Teams supervisor facets (uptime, live last-activity, team up/down) | **0852** and **0853** respectively (both backlog under G64, created from the 0849 review). Outside 0850's R3: no doc in this change set asserts those facets exist — `docs/help2/*.md`, `docs/03_ARCHITECTURE.md` and `docs/04_DESIGN.md` contain no surviving claim about uptime or live activity as a Board capability |
| Bundle-plugin-lib determinism: `bun run spur-check` cannot go green inside a git worktree on this machine (46 minified-identifier renames in `plugins/sp/lib/idea-handoff.generated.mjs`) | **Unassigned / not 0850's** — a harness residual that forced the tree switch and will recur for any `--worktree` run of a plugin-lib-touching task |
| Deferred by design per the task's Q&A: deleting the superseded satellites and the `spur team` reference/help files; whether G61–G63 need their own ADRs | Robin — the cutover commit, and Robin respectively (unchanged) |

**Disposition.** R1–R5 and both Gherkin scenarios are MET on evidence collected this pass; no P1 or P2 remains, so nothing blocks approve → verify. The hop's three claims verify — `serve.md:34` is corrected and accurate, the count now says 21/20 as the tree shows, the `init.ts:170-179` anchor is the right subject, and the tree-history clause matches the branch — with one exception: the Q&A qualification appended a duplicate instead of replacing, leaving the stale anchor in place (finding #1, P3, the only new defect since pass 2). Of the residuals, three belong to 0850's own closure (findings #1, #3, #5, plus #2 if the operator prefers fixing the warning over accepting it), one to the cutover commit (#4), two to backlog tasks 0852/0853 in scope that does not overlap this one, and the worktree gate determinism issue to no task at all. The acknowledged residual `L4.stale-line-anchor` warning is **accepted** as non-blocking, with the attribution corrected to the Solution section. **Next:** record PASS and let the closure items be fixed or explicitly accepted at 0850 closure.

### References

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Authority owners: `docs/00_ADR.md` (ADR-052 superseded; ADR-037, ADR-057, ADR-022 retained)
- Derived owners: `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md` and `docs/design/`, `plugins/sp/skills/spur-cli/references/`, init templates
- Process: `docs/99_PROJECT_CONSTITUTION.md` placement guard

### History

- 2026-09-13T15:10:10.486Z todo → cancelled (system)
- 2026-09-14T15:01:38.382Z todo → wip (system)
- 2026-09-14T16:38:47.887Z wip → testing (system)
- 2026-09-14T16:38:54.165Z testing → done (system)

