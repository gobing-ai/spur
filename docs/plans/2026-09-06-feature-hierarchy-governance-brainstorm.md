---
date: 2026-09-06
status: proposed
needs_design: true
run_id: 4517c98a-b3e3-48d2-8eb5-0a183212cfb7
---

# Feature hierarchy governance and lifecycle — discovery and proposal

## Recommendation

Repair the existing feature subsystem and its guidance, then reconcile Spur's tree through a
reviewed mapping. ADR-063 already establishes mandatory operator consent for new roots; enforce
and distribute that decision instead of inventing a second policy. Extend the existing shared
feature service and lifecycle checks to account for child features as well as directly linked tasks.

Treat root nodes as durable system/product modules with explicit ownership boundaries. Module
means a coherent product capability, not a repository folder, sprint, post-mortem, or temporary
roadmap theme. Preserve the distinction between creating a feature plan and executing its tasks.

This is a discovery proposal, not an accepted ADR, a migration authorization, or completed
implementation. The idea pipeline is paused at its declared idea-eval gate.

## Evidence and scope

Source-local CLI: `bun run apps/cli/src/index.ts`, working directory
`/Users/robin/xprojects/spur-new`. Runtime definition:
`apps/cli/config/workflows/idea-pipeline.yaml` (no project-local override).
The runtime projection digest is
`sha256:b4415b7e33f919a21e93c587430ea50cb2ff3494b63dafe09b0539a08da2f2d7`.

All findings below were checked against local source or CLI output on 2026-09-06.
No external API or dependency change is necessary for this proposal.

The read-only inventory returned **129 features, 15 roots**, with **six parents at the nine-child
limit**: D, E, F, H, I, J. Nine done parents contain unfinished direct children:

| Done parent | Unfinished direct children |
| --- | --- |
| D | D6 active |
| E | E2 verifying, E5 verifying, E6 active, E7 backlog |
| E9 | E91 active |
| F2 | F21 backlog |
| F9 | F91 active |
| H | H1 blocked |
| I8 | I81 verifying |
| J9 | J93 backlog |
| M | M3 verifying, M6 backlog |

H is explicitly frozen history; its mismatch needs a historical disposition, not blind reopening.
J93 was being created by concurrent work during discovery. Re-read the corpus before any mutation;
these counts describe the captured snapshot, not an immutable migration input.

## Findings, highest severity first

### 1. High — child state is invisible to parent completion

`FeatureService.deriveFeatureStatus` reads only direct task edges and returns a no-op when there
are no directly linked tasks (`packages/app/src/services/feature-service.ts:373`).
`syncAllFeatures` excludes features without direct tasks (`feature-service.ts:587`).
Create, transition, and move do not reconcile ancestors (`feature-service.ts:174`, :221, :687).

Reproduction: `feature sync D --dry-run --json` and `feature sync J9 --dry-run --json` both propose
done → done, although D6 and J93 are unfinished. `feature check` emits no child-state finding;
F2 and M even pass the current feature check despite unfinished children.

Repair: one shared, bottom-up reconciliation path plus a done-time descendant invariant.
A last-child completion triggers parent verification; it does not manufacture acceptance evidence.
Use the same service from CLI and server handlers, including direct child creation and transition
(`apps/server/src/modules/feature/handlers.ts:59`, :63, :109, :128).

### 2. High — mandatory root consent is weakened or omitted downstream

ADR-063 explicitly requires consent and forbids using the width cap as an escape
(`docs/00_ADR.md:804`; also `docs/04_DESIGN.md:2114`).
The hierarchy guide says operator confirmation is needed only “when unsure”
(`plugins/sp/skills/spur-cli/references/features/hierarchy-mece.md`, Root gate).
Its roadmap-theme wording also permits temporary workstreams too readily.

The idea-pipeline create action advertises a parentless create
(`config/workflows/idea-pipeline.yaml:151`); planning Step 2 leaves parent optional without
running the ownership decision procedure. The source-local create and move help expose no
root-specific acknowledgement. Both default to root allocation when parent is omitted.

Repair: require selection of an existing owner before allocation; unconditional human approval
for root creation or promotion, including initialization's initial module map. Add a minimal
explicit root acknowledgement to the existing create/move surfaces, enforced in the shared service
and represented in the server contract. An acknowledgement records a decision; it is not proof
that a human actually approved, and agents must never supply it merely because --auto is set.
The precise public option/DTO names belong to the subsequent design review.

### 3. High — allocation does not validate parent existence

`allocateId` searches used identifiers but never checks that the requested parent exists
(`packages/app/src/services/feature-service.ts:888`). Create also omits the parent's ID-format
validation performed by move.

Read-only reproduction: `feature move F31 --parent Z --dry-run --json` succeeds with
`F31 → Z1` although the captured corpus has no Z. It reports four linked archived tasks
(0356–0359), confirming why reference-preserving moves must use the corpus service.

Repair: validate parent syntax, existence, admissible state, and capacity under the allocation
lock for create and move; add orphan-parent checks for existing data. Preserve the current
cycle and collision protections. Cancelled parents cannot silently accept new work.

### 4. Medium — feature-template edits do not affect feature creation

`config/templates/feature/default.md` exists, but `FeatureService.templateContent` builds its
own string (`packages/app/src/services/feature-service.ts:933`). Updating only the template
would leave the actual create path unchanged. Both contain a generic, unnumbered Basic acceptance
scenario. The docs template labels F1 as a root, contradicting DD-14
(`config/templates/docs/05_FEATURES.md:30`).

Repair: use the existing template-resolution/rendering capability for feature creation, keep one
owning default, and test the actual rendered output. Teach project-independent module selection in
the portable guidance; do not pre-seed Spur's own module letters into arbitrary projects.
Re-init must retain customized documents, as the scaffold manifest already requires
(`apps/cli/src/config/scaffold-manifest.ts:54`).

### 5. Medium — current documentation has competing tree and lifecycle descriptions

`docs/05_FEATURES.md:16` says one feature leaf maps to one task, while the planning pipeline
supports a task batch per feature. Its root summary still lists only A–H (:32), and its parallel
headline tables repeat lifecycle claims outside the generated inventory. The actual feature
service refreshes `docs/features/INDEX.md`, not those narrative tables.

The CLI facade says sync never rewrites task tables, but sync now refreshes after any applied hop,
including partial progress (`feature-service.ts:561`). It also describes “one active goal” too
broadly: the actual rule applies only to P0 features in active
(`packages/app/src/services/feature-check.ts:363`).

Repair: make 05 a concise module-ownership guide and pointer to the generated index; remove
duplicated live-state assertions and the one-task-per-leaf restriction. Keep historical ADR
entries intact and append only the actual new decisions. Correct lifecycle and output claims
against live code.

### 6. Medium — the corpus expert still requests a routine full-corpus sweep

`plugins/sp/agents/expert-spur.md`, Process step 6, requires `task check --corpus` after every
task/feature batch. This conflicts with constitution T11's affected-input discipline.
The wrapper also does not explicitly route hierarchy mutations through the existing hierarchy
reference.

Repair: link the ownership/root checklist and use affected-feature/task checks. Keep the agent a
thin sequencer; put the portable procedure in its backing skills. A stricter checker change
still requires the explicit unsuppressed T10 audit.

### 7. Existing verification debt must remain visible

The requested read-only `feature check --json` audit exited **1**:
**73 passed, 56 failed**. Error findings include 41 dogfood-missing, 55
evidence-not-recoverable, 232 scenario-unverified, 27 verdict-rows-match-no-scenario,
and two BDD findings. Findings are not unique-feature counts.

These failures predate this proposal and are different from the missing hierarchy invariant.
Do not declare the corpus healthy, regenerate acceptance baselines, fabricate evidence, cancel
work to turn checks green, or demote findings. The implementation must reconcile failures exposed
by its new policy under T10, with actual evidence or an explicit, justified scope disposition.

## Refined portable rules

1. **Durable modules at the root.** Roots partition the project's major product responsibilities.
   Initialization proposes that module map for explicit operator approval. Later root creation,
   promotion, or module-boundary restructuring needs approval with rejected candidate parents.
   Ordinary child creation under an approved owner proceeds without another root approval.
2. **Extend before allocating.** Reuse an existing Goal; otherwise create the smallest independently
   verifiable child. Siblings have comparable granularity and distinct outcomes. A task describes
   implementation; a feature describes an outcome and can map to multiple tasks.
3. **Width is a modeling signal.** Keep DD-14 and the nine-child limit. A full parent calls for
   a meaningful deeper grouping or a corrected owner, never a new root solely for capacity.
4. **A done ancestor cannot conceal admitted unfinished work.** Creating, moving in, reopening,
   or linking unfinished work reopens done ancestors through legal lifecycle transitions.
   Apply this to tasks and child features; move evaluates both old and new ancestor chains.
   Verifying ancestors return to active for rework. Do not silently reactivate cancelled history.
5. **Readiness propagates; evidence still gates closure.** When the last unfinished child closes,
   reconcile upward. A parent reaches done only if its required children, direct tasks, and own
   applicable acceptance/verification gates pass. Groups may delegate AC to children per the
   existing group convention, but cannot ignore unfinished descendants.
6. **Cancellation is not success.** Mixed done/cancelled work can proceed only if the surviving
   scope and AC are still satisfied. All-cancelled and empty work sets never prove completion.
   Historical frozen branches receive explicit migration dispositions.
7. **Preserve guard semantics.** Respect the P0 active-goal constraint, lifecycle edges, task
   evidence, and dogfood requirements. If reopening would violate a guard, reject admission before
   writing the child where feasible; otherwise return an explicit recoverable partial result.
   No silent successful operation may leave a done ancestor hiding unfinished work.
8. **Deterministic and inspectable.** Reconciliation is bottom-up, idempotent, bounded to affected
   ancestor chains, and reports applied transitions and blocked reasons. Dry-run writes nothing.
   Refresh remains a projection operation; sync owns lifecycle movement.
9. **Stable history, deliberate migration.** Moves use the CLI and a persisted old→new mapping.
   Preserve task links across active/archive folders, scenario identity, status history, and
   referenced evidence. ID-based dogfood filenames and prose references need explicit inspection;
   a cascade rename of task frontmatter alone does not repair every reference.
10. **One rule owner.** Project decisions live in ADRs; portable operating guidance lives in the
    hierarchy reference; deterministic invariants live in app services/checkers. Templates and
    thin agents link to that guidance rather than growing independent runbooks.

## Current-root disposition proposal

Do not infer that every existing root was created without authorization. Some boundaries are
explicitly documented and should not be erased by a naming heuristic.

| Root(s) | Proposed disposition | Evidence/reason |
| --- | --- | --- |
| A, B, C, D, E, F | Retain Foundation, Agent execution, Rules, Workflows, History, Planning | Durable module responsibilities; fix ancestor state separately |
| G | Retain Collaboration with an explicit runtime/control-plane boundary | Goal owns message/team coordination and G4 |
| I | Retain sp plugin | Goal owns agent-facing skills, commands, hooks and orchestration; distinct from B |
| J | Retain Observability | Operator visibility is a coherent module; clarify History vs live-system observability |
| K | Retain pending F8/K ownership reconciliation | K intentionally owns Board Features and project identity; F8 already owns overlapping Board slices |
| M | Retain pending G/M boundary reconciliation | Teams product/Board has a documented boundary from coordination primitives; not a name-only merge |
| H | Preserve frozen history; triage unresolved H1 under the current B/I boundary | H explicitly prohibits new work; do not silently claim blocked H1 is done |
| L | Keep cancellation and E91 migration provenance; remove as a live-module candidate | Skill-call history belongs to E, already represented by E91 |
| N | Propose relocation beneath the owning plugin/planning capability | A task-numbered post-mortem is not a durable module; inspect mixed historical scope before selecting destination |
| P | Propose relocation under existing workflow/plugin reliability ownership | Its Goal is D61 residual dispatch work, not a new system module |

This is an ownership/disposition review, not an executable ID mapping. F8/K and G/M need
outcome-level partitioning from their current Goals and task links. Do not force the tree back to
the original eight roots. Preserve justified modules; remove temporary workstreams from the
live root vocabulary through reviewed moves. Allocation must use current free slots at apply time.

## Approaches

| Approach | Benefit | Cost / limitation | Confidence |
| --- | --- | --- | --- |
| Documentation repair and one-time manual sync | Smallest immediate change | Existing create/move/sync paths would still permit recurrence | High on feasibility; low on durability |
| **Shared-service enforcement plus guidance and migration** | Covers CLI, API, pipelines and future projects using existing architecture | Requires lifecycle/guard tests and careful handling of existing evidence debt | **High on identified gaps; medium on migration until mappings are reviewed** |
| Replace positional IDs or add a separate feature graph engine | Could remove the width constraint | Breaks identity/reference contracts and expands scope without solving ownership decisions | High confidence this is unnecessary now |

Choose the second approach. Keep DD-14, existing verbs, the existing lifecycle engine,
PlanningWriteService, and installed rendering/locking facilities. No new dependency,
background daemon, generic policy engine, or new CLI noun is justified.

## Design Summary

The proposed owner is **F3 — Feature management CLI**, with a new child for hierarchy governance
and ancestor lifecycle consistency (candidate F32, subject to a fresh allocation). Reuse F31's
hierarchy/restructure work and F82/F4's status/lifecycle mechanisms. F31's existing scope explicitly
excludes automatic status-sync redesign, so silently expanding it would obscure this deliverable.

Put admission and reconciliation in the shared application layer, not CLI-only prompts or a
server-only event subscriber. Compose existing transitions and validation under a safe lock order;
check the entire affected chain, report partial failure honestly, and never use raw status writes.
Child closure initiates existing verification and bounded sync. Add a done-time invariant so a
caller cannot bypass readiness by calling transition/advance directly.

Public create/move acknowledgement and affected-result DTO details are proposed surface changes,
to be ratified in system-design with CLI/API context. Keep root permission distinct from generic
force, auto, and lifecycle-skip options. Do not introduce a new public verb.

Proposed delivery boundaries for decomposition after approval:

1. **Hierarchy admission and portable guidance:** validate parents/root acknowledgement in the
   shared create/move paths; align ADR-063, CLI/server contracts, expert-spur, hierarchy guidance,
   planning prompts, actual feature templates and initialization output. Include negative-path tests.
2. **Ancestor lifecycle consistency:** extend direct-task sync to children/ancestors, integrate
   mutation callers, protect done-time checks, and test cancelled/empty/P0/partial-failure cases.
   Update lifecycle docs, affected workflow assets, and bounded sync consumers together.
3. **Spur corpus reconciliation and proof:** inventory current links, produce and review the exact
   move map, apply through CLI, repair exposed status/evidence contradictions, regenerate the index,
   and finish documentation parity plus real CLI/API/init dogfood.

These are candidate deliverables, not created tasks. Apply the decomposition rubric before
batch-create; do not split one task per document. Include doc sync in each relevant task.

## Acceptance outline

- Unacknowledged root creation/promotion is rejected without writes; approved roots work.
- Invalid/missing/cancelled parents, cycles, and full parents fail with actionable errors.
- CLI and server child admission beneath done ancestors reopens the legal affected chain.
- Reopen/transition/link/move paths obey the same rule; both move ancestor chains reconcile.
- Last-child completion initiates parent verification; unfinished direct tasks or failed AC prevent done.
- Direct transition/advance cannot bypass the descendant-completion invariant.
- Empty/all-cancelled sets, frozen history, P0 conflicts, and partial failures are covered explicitly.
- Repeated sync is a no-op; dry-run changes no corpus files; history and event attribution survive.
- Real feature creation consumes the owning template; fresh initialization teaches valid roots
  and mandatory consent; re-init preserves customized documents.
- The reviewed live mapping preserves IDs through recorded mappings, task links and evidence;
  generated index and 05 guidance agree with the final module ownership.

## Requested-document coverage and repair order

| Surface | Review result / planned repair |
| --- | --- |
| docs/00_ADR.md | Retain ADR-063; append only lifecycle/module-definition decisions that are new |
| docs/05_FEATURES.md | Remove stale A–H-only summary and one-task-per-leaf claim; use current ownership and generated index |
| plugins/sp/agents/expert-spur.md | Route hierarchy procedure; remove routine corpus-sweep contradiction; stay a thin wrapper |
| plugins/sp/skills/spur-cli | Align unconditional root gate, real sync/refresh behavior, P0 rule, hierarchy/parent checks and move contract |
| plugins/sp/skills/spur-dev | Make ownership selection part of intake; specify admission/reopen and ancestor completion follow-up |
| config/templates | Fix root example, distribute portable policy, connect actual feature rendering, test seeded behavior |
| Additional required owners | 01/03/04 and constitution/AGENTS as required by T1/T2/T3/T6/T7/T9; update workflow assets where their prompts encode the wrong rule |

Workflow changes are part of the proposed repair scope and must be explicit in the approved
design. No workflow files or generated adapters were edited during discovery. Capability changes
use Superskill's supported lifecycle checks; generated per-platform adapters remain tool-owned.

## Verification performed and limits

- Runtime workflow projection and doctor probe: PASS; host execution remained inline.
- Source-local feature inventory and two status-sync dry-runs: successful reads; reproduced omissions.
- Nonexistent-parent move dry-run: exit 0, demonstrating the missing precondition; no move applied.
- Feature check: exit 1, 73/129 pass; full JSON saved under this run.
- Focused existing feature-status-sync tests: **9 pass, 0 fail**. These cover task-based behavior,
  not the missing ancestor behavior.
- No implementation diff exists yet; full lint/type/build/test-CF gates were not run for this
  discovery-only change. Future checker changes require T10's explicit unsuppressed audit.
- Default task-list queries returned no active-folder rows for F3/F31/F82/P. They are not evidence
  of absent archived tasks: move dry-run resolved 0356–0359. Resolve historical WBS via task show.

Starting unrelated change: .run-info.json. Concurrent J93 feature/design artifacts were observed
and preserved. This proposal changes only its own plan and ignored run artifacts.

## Spec self-review and continuation

Self-review: no placeholders, no dependency/toolchain additions, no invented shipped flags,
no automatic acceptance of cancelled work, no root allocation, no feature/task corpus writes.
All proposed behavior is separated from observed behavior. needs_design=true because the change
crosses lifecycle, API/CLI, process and template boundaries.

Approve the idea evaluation to resume this run at feature-create, then author AC and the system
design through the existing pipeline. The --auto flag skips objective gates only; it does not
approve this idea or the later design gate. The idea pipeline ends at a validated task handoff;
execution follows through the task pipelines to fulfill the broader implementation request.
