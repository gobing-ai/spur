---
schema_version: 1
name: Move dev workflow isolation and visible planning ahead of comprehensive checks
status: done
template: standard
created_at: 2026-09-08T23:49:06.040Z
updated_at: "2026-09-09T02:57:40.286Z"

ac_altitude: task-local
ac_numbering: task-local
feature_id: D6
priority: P1
---

## 0814. Move dev workflow isolation and visible planning ahead of comprehensive checks

### Background

Robin requested one implementation task covering earlier worktree isolation, deterministic readiness, earlier workflow plans, readable labels, and native todo progress across the existing dev commands, skills, and workflows. This task is the complete planning deliverable; implementation remains pending.

#### Evaluation

Recommendation: refine and proceed. Necessity 4/5: shared instructions currently disagree about startup order. Urgency 3/5: the delay is visible and affects collaboration, but this investigation establishes no production outage or measured latency baseline. Source observations were made on 2026-09-08.

- The matrix Robin remembered is `.spur/tasks/section-matrix.yaml`: variant plus status determines required, optional, and forbidden sections. `plugins/sp/skills/next-router/references/routing-table.md` Tables A/C provide status routing and lightweight section probes. These are complementary authorities, not interchangeable readiness tables.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` currently reads YAML in setup step 1 and projects its CLI todo list in step 5. It already mandates stage-boundary todo reconciliation, but explicitly forbids per-action refreshes.
- `plugins/sp/skills/spur-dev/references/execution-batch.md` says to isolate before selector resolution while its zero-task rule forbids creating a worktree for an empty filtered set. Resolve this ordering conflict in the shared owner.
- `config/workflows/task-pipeline.yaml` already has a doctor-free deterministic precheck after task 0723. It still mixes status/section checking with feature mutation, size/evidence checks, and route artifacts. The change must separate responsibilities without reinstating executor probes or removing guards.
- The source-local `workflow show config/workflows/idea-pipeline.yaml --no-logo --format todo --json` succeeds and returns version, definitionDigest, and declared steps with branch/loop/pause/terminal markers. The CLI parses and validates YAML internally. The benefit is avoiding early YAML ingestion and reconstruction by the coding agent, not eliminating YAML parsing.
- Current worktree-capable commands are dev-run (full mode), dev-runall (sequential mode), dev-refineall, and dev-verifyall. Batch refine/verify are skill loops; they have no independent batch workflow YAML to show.

#### Scope and alternatives

Choose the existing shared startup procedure, matrix/checker, workflow projection, and host progress contracts. This has the smallest ownership change and preserves current execution surfaces. Rewriting every command separately is shorter initially but perpetuates drift. A new bootstrap workflow, progress service, public CLI verb, persistent validation cache, or speculative cross-agent adapter framework adds a second authority and is rejected.

The task owns startup and progress consistency, including the minimal existing-code changes and regression checks needed to make the contract executable. It does not add worktree flags to more commands, enable unsupported worktree/mode combinations, change merge/delete authorization, enable dormant fast execution, redesign the engine, add dependencies, or implement this proposal during ideation. Existing D6 owns the cost/readiness concern; task-local AC describe this follow-up without rewriting completed D61 history.

One task is intentional, as requested: ordering, isolation, readiness, and progress share the same driver contracts and must be verified together. Use the Plan's bounded implementation steps instead of separate phase tasks.

### Requirements

- [x] R1. Establish one shared startup contract for applicable dev commands: expose a short bootstrap checklist immediately; perform quick deterministic readiness; when --worktree is valid, create/adopt and switch to the execution tree; obtain and publish the selected workflow's CLI plan; then load execution detail, perform applicable comprehensive checks, and execute. Identify workflow-backed versus skill-only commands and preserve their execution surface and flag semantics.
- [x] R2. Implement command-aware, read-only quick readiness using the existing status routing, selected section matrix, and content-policy checker. Resolve valid targets, status eligibility, filtered empty sets, and cheap local section findings without LLM dispatch, full tests/lint, live-data probes, feature mutation, or corpus-wide relational checking. Return structured actionable findings; distinguish runnable, needs-refinement, blocked, skipped, and invalid outcomes without making every refinement gap an error.
- [x] R3. Move all four existing worktree entry points into the selected tree immediately after quick readiness and required Git safety checks. Preserve create/reuse/resume, ownership, dirty-tree, empty-batch, branch/base, and terminal retention contracts; use the selected tree for subsequent tools, agents, task/feature writes, and run artifacts. Reject stale target inputs and competing ownership without silently reselecting work or discarding partial changes.
- [x] R4. Obtain workflow inventories through spur workflow show <resolved-file> --no-logo --format todo --json before the host reads full YAML or starts comprehensive/model work. Bind the inventory and later execution to the same resolved definition identity. Preserve the existing JSON schema, step IDs, metadata, and no-action semantics; fail closed on unresolved/invalid definitions or identity drift. Skill-only operations display their owned procedure without inventing a YAML file.
- [x] R5. Present stable A, B, C labels for simple plans and A1, A2, B1 labels for visible children in complex plans. Keep labels separate from workflow IDs, reset child numbers per parent, extend past Z as AA/AB, preserve identity on retry/resume, and expand only the active task/stage to bound display size. Expose conditional/failure/loop semantics and never imply all declared states will execute.
- [x] R6. Use the actual host's available native todo/plan tool and keep it synchronized at plan creation, visible item start/completion, stage/task transitions, retries, pauses, failures, resume, and finalization. If no suitable tool exists or it fails, use an explicit Markdown fallback with the same labels and truth. Completion requires observed success; failed, skipped, blocked, and unattempted items must not be falsely checked off.
- [x] R7. Retain comprehensive checks after the plan is visible and after isolation when requested. Preserve full task/feature integrity, size, declared evidence-channel, provenance, capability, dependency, quality, review, and verification gates at their owning boundaries. Prefer deterministic checks and invoke semantic model work only for an identified unresolved requirement/design/evidence question; record its reason. Reuse results only while their relevant inputs remain unchanged.
- [x] R8. Demonstrate startup and progress behavior with matched before/after evidence: event ordering, time to first visible checklist and workflow inventory, time to confirmed execution cwd, CLI/process/model invocation counts, and output volume. Quick readiness and plan projection must dispatch zero models and execute zero workflow actions. Record unavailable measurements as unknown and avoid hardware-specific latency promises or invented savings.
- [x] R9. Update canonical commands, skills, affected workflow definitions, existing scripts/services, and owning surface documentation together; regenerate adapters/bundled assets only through their owners. Add focused behavioral regression coverage for startup order, matrix variants, worktree safety, plan identity/labels, and truthful progress, then run applicable project gates and record real implementation verification evidence.

### Acceptance Criteria

```gherkin
Feature: Early dev workflow isolation and truthful visible progress

  Scenario: R1 — Startup exposes preparation and defers expensive work
    Given an applicable workflow-backed dev command with valid inputs
    When the host starts it
    Then the bootstrap checklist is visible before expensive checks
    And quick readiness precedes requested isolation
    And the workflow inventory is visible before host YAML ingestion and comprehensive checks

  Scenario: R2 — Quick readiness respects operation and matrix semantics
    Given standard, issue, review, and meta tasks with valid or incomplete sections
    When run, refine, or verify readiness is evaluated against the selected matrix
    Then schema and operation-invalid inputs produce actionable findings
    And incomplete planning sections remain eligible refinement work
    And verify force retains re-verification semantics
    And no model, whole-corpus check, lint, test, or live-data probe is launched

  Scenario: R3 — Worktree isolation is early and preserves safety
    Given each of the four worktree-capable commands and a fresh, reusable, or resumable target
    When quick readiness and required Git checks succeed
    Then all subsequent checks, agents, corpus writes, and artifacts use the confirmed execution tree
    And invalid or empty input creates no tree or marker
    And unsupported modes, ambiguous ownership, and stale target inputs stop without discarding work
    And later failure retains the tree with recovery information

  Scenario: R4 — The plan is a projection of the execution definition
    Given project or bundled definitions in either supported workflow dialect
    When the host requests the todo JSON projection before reading full YAML
    Then its declared IDs, version, digest, and conditional markers remain intact
    And projection executes no workflow actions or guards
    And definition drift or projection failure prevents execution with a misleading plan
    And skill-only refine and verify batches use their existing procedure without a fabricated workflow

  Scenario: R5 — Labels remain readable and stable
    Given a simple inventory with more than 26 steps and a batch with repeated task stages
    When visible plan views are rendered and later retried or resumed
    Then top-level labels extend from Z to AA
    And child numbering restarts under each parent
    And canonical workflow IDs and public JSON fields are unchanged
    And active detail is bounded to two visible levels with stable per-view labels

  Scenario: R6 — Progress follows observed outcomes
    Given a host with a supported native todo tool or an unavailable or failing tool
    When visible items start, finish, retry, pause, fail, or are skipped
    Then native progress or an explicit Markdown fallback updates before the next visible item starts
    And failed, blocked, skipped, conditional, and unattempted work is not falsely completed
    And the final report reconciles all known outcomes without leaving a finished item active

  Scenario: R7 — Faster admission preserves comprehensive gates
    Given inputs with an unmet dependency, invalid required evidence, or changed readiness inputs
    When the visible plan advances into comprehensive checking or execution
    Then existing owning gates still refuse invalid progression
    And in-set dependencies run in the frozen dependency order
    And cached observations are reused only while relevant inputs remain unchanged
    And semantic model work names the unresolved question requiring it

  Scenario: R8 — Performance claims have comparable evidence
    Given matched before and after simple, batch, and failed-start inputs
    When startup and progress evidence is recorded
    Then it includes event order, executable provenance, elapsed times, invocation counts, and output volume
    And quick readiness and projection dispatch zero models
    And unavailable token and cost measurements are unknown
    And no simulated run is presented as a real verified outcome

  Scenario: R9 — Canonical surfaces and execution evidence agree
    Given the final scoped implementation and regenerated owned artifacts
    When focused regressions, workflow and plugin checks, and required project gates run
    Then all four worktree entry points follow the shared startup contract
    And workflow-backed and skill-only plan behavior matches the documented owners
    And the task records genuine requirement-level verification evidence before completion
```

Verification entry points (implementation must extend these existing suites):

- `cd plugins/sp && bun test tests/batch-preflight.test.ts tests/dogfood-testing/execution-batch-contract.test.ts` — R1, R2, R3, R7, R9 plus the adjacent host-progress fixture selected during implementation.
- `cd packages/app && bun test tests/services/task-readiness.test.ts tests/workflow/step-reporter.test.ts` — R2, R4, R5, R6, R7.
- `cd apps/cli && bun test tests/commands/workflow.test.ts --test-name-pattern 'workflow show'` — R4, R5 and machine-output compatibility.
- Matched local command/host event traces under `.spur/run/0814-*` — R1, R3, R6, R8; capture actual tools/cwd and treat unavailable host-specific coverage as untested.
- `bun run spur-check`, `bun run test-cf`, `bun run build`, and affected `spur workflow validate <file> --json` checks — R9; no whole-corpus audit unless checker policy actually changes.

These are future implementation acceptance checks, not claims that this planning-only task has already implemented or passed them.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-08T23:54:30.801Z

Planning review completed on 2026-09-08. Robin explicitly requested evaluation, autonomous refinement, and one task covering the whole proposal; this record authorizes no implementation, deployment, or integration. The idea/design evaluation is embedded in this task for review. No engine-driven idea pipeline or implementation verify PASS is claimed.

| Ready-depth check | Planning evidence |
| --- | --- |
| Requirements | Nine bounded requirements cover the four requested enhancements and their performance, stability, and observability constraints. |
| Design | Existing checker, projection, batch/worktree, and native progress owners are identified; no new public surface, dependency, or engine is needed. |
| Plan | Eight ordered implementation steps; one cohesive task as requested. The size check passes with 9 R-items and 8 Plan items. |
| AC | Nine requirement-numbered scenarios plus executable verification entry points, including negative and fallback behavior. |
| Decisions | Matrix reuse, command-aware eligibility, early isolation, CLI-first projection, presentation-only labels, and visible-item updates are selected; duplicate orchestration is rejected. |
| Dependencies | No unfinished prerequisite task is required. Existing work from 0723, 0695/0696, 0727, 0768, and 0496/0701 is reused rather than reimplemented. D6 is the existing feature link; AC remain task-local. |
| Premises | Source-local workflow projection succeeds. Matrix/content-policy and worktree-order conflicts were inspected in source. Native todo capability varies by host; this session exposes none, so fallback behavior is mandatory. Actual latency savings remain to be measured. |

The projected todo structural check returned PASS with no findings. This is specification readiness, not implementation completion. Required runtime checks, before/after performance evidence, and a real implementation verdict remain acceptance work for task 0814.

### Design

#### Design Summary

Move work and visibility earlier by reordering existing owners. The host startup procedure owns quick readiness and worktree setup; the workflow definition continues to own execution states/actions/guards; the CLI projection owns workflow inventory; the host owns its native todo projection. Quick readiness is an admission decision for the requested operation, not an implementation certificate. Comprehensive checking remains deterministic unless semantic judgment is required.

#### Startup order and source selection

1. Parse inputs and discover the actual native plan capability. Publish a compact bootstrap procedure while quick checks run. These setup rows are labelled as host preparation, not copied workflow states.
2. For named worktree reuse or resume, resolve the existing target and ownership identity read-only first. Check the target's actual task snapshot, not a stale invoking-tree copy. For fresh creation, use the invoking tree's committed base; existing dirty-base refusal applies. Resolve the selector/status filter sufficiently to reject invalid or empty work before creating a worktree.
3. Apply operation eligibility and content checks below. Preserve a batch's candidate membership; unfinished dependencies selected within the batch are ordering edges, not a reason to reject the batch. Do not require every future task to be implement-ready before a refine batch can run. Graph-wide/comprehensive checks move after isolation; direct missing references and obvious input errors can fail early.
4. Run the required Git safety checks and create or adopt the tree using existing WT-1 through WT-7 mechanics. Confirm absolute cwd, branch, base SHA, and target ownership. All subsequent tool calls use this cwd explicitly; one shell's cd alone does not change other tools or agent invocations. No task mutation, feature reactivation, proof capture, or model dispatch precedes isolation.
5. Resolve and show the selected workflow using the same project/bundled resolver as execution. Use a verified available CLI executable with the execution cwd, publish the inventory immediately, and retain its existing version/digest. Prefer showing before a fresh worktree's dependency installation when the available CLI permits it. If the CLI itself needs setup, keep that bounded setup visible in the bootstrap checklist; do not read YAML or invent the plan to bypass a failed projection.
6. Load the same YAML only after displaying its inventory; compare identity before execution. Fill active-stage details lazily, perform dependency installation/comprehensive checks in the target, register run/proof identity through existing seams, then execute. If a workflow contains a precheck state, its result updates that state; do not execute a shadow copy of the state in the host.

Without --worktree, omit isolation and use the current tree. Preserve any command's existing input/permission requirements. For this planning-only task, no workflow or execution code is changed yet.

#### Quick versus comprehensive readiness

| Concern | Quick readiness | Later owner |
| --- | --- | --- |
| Inputs and status | Command flags/modes; task/feature existence; real schema status; command eligibility; empty status-filtered set | Existing command's status/lifecycle semantics |
| Sections | Selected variant/status matrix and deterministic L1/L2/L3 content-policy findings | Full persisted task check and relational/feature evidence |
| Dependencies | Read direct metadata; classify missing/out-of-set blockers; retain in-set unfinished ordering edges | Frozen graph/topological ordering and recheck immediately before dependent execution |
| Git | Resolve reuse/resume identity and preserve required dirty/base/ownership checks | Dependency setup, mutations, proof, execution, integration/retention |
| Semantic meaning | No model call; record the concrete gap | Refine/design/review skill only if that operation needs judgment |
| Tests, size, evidence, executor | No lint/test/full corpus/live-data/doctor startup sweep | Existing size and declared evidence gates; dispatch-time capability validation; quality/verify gates |

Reuse `TaskCheckService.checkContentPolicy` in `packages/app/src/services/task-check.ts` with the selected matrix and cached task raw content for local section checks. It already runs L1/L2/L3 without filesystem-dependent L4 traversal. Do not implement another section parser or hard-code required sections. The existing `plugins/sp/scripts/batch-preflight.ts` is the internal callable entry to extend where an executable startup helper is needed; keep its current callers compatible and delegate checking to the app service, following existing bundled script-library ownership. Any extra input/output fields belong to this internal helper, not a new public Spur command or flag. Do not call full task check for every candidate and merely discard its L4 output while claiming a cheap path.

The existing run-only preflight cannot be reused unchanged for refine/verify. Define operation context in the shared procedure/helper, with these semantics:

- dev-run full and sequential dev-runall preserve their status/resume and dependency rules. Missing implementation sections produce a needs-refinement outcome before implementation; blocked/cancelled/invalid targets are not launched. Existing done handling is preserved.
- dev-refineall defaults to backlog/todo and honors its explicit status filter. Missing or incomplete planning sections are work to do, not an admission failure. Standard/auto may skip L3-clean planning sections; ready depth still applies its seven-part checklist.
- dev-verifyall preserves already-verified skip and --force re-verification, eligible terminal evidence inspection, per-task verdicts, and shippable policy. Its --force must never become a dirty-tree bypass.
- dev-run --mode implement plus --worktree, and dev-runall --mode parallel plus --worktree, remain rejected. Unknown flags remain errors rather than silently disappearing.

Retain matrix severity and full completion policy. Section presence or task-check exit 0 does not establish semantic ready-depth evidence or a verify PASS. Reuse a result within the same invocation only for the same task content, effective status, matrix, relevant dependency snapshot, and cwd. After branch/tree changes, task writes, dependency completion, or resume, refresh the affected inputs. Freeze membership once; surface missing/drifted targets rather than silently replacing the set. Do not add a persistent cache.

#### Worktree safety and early-exit behavior

Preserve portable Git ownership semantics and all required WT checks. A missing/ambiguous reuse target, detached target, unsupported mode, invalid selector, or empty set creates no worktree, branch, or run marker. A reused tree may contain the retained partial work belonging to this run; unrelated active ownership prevents adoption. A creation failure retains actionable context and never authorizes force deletion as recovery. Preserve dependency install lockfile and hook protections. After a later failed check, halt, non-fast-forward integration, or failed evidence persistence, retain the tree and report absolute recovery paths. Re-entry uses the existing marker/run identity and does not replay completed mutations. Cleanup/merge still requires the applicable existing authorization; earlier isolation does not expand it.

The invoking branch is not necessarily main. Never switch the shared invoking checkout to the new branch. Runtime corpus/evidence writes stay in the execution tree, with only the existing invoking-tree coordination markers and terminal evidence persistence exceptions. This makes the main checkout available sooner without pretending that worktrees also isolate all shared Git metadata or external resources.

#### Plan projection and labels

Use the real CLI's existing output. `apps/cli/src/commands/workflow.ts` resolves the definition and returns `steps`, `version`, and `definitionDigest`; `packages/app/src/workflow/step-reporter.ts` supplies the shared declared-step builder. Preserve these machine fields and canonical IDs. Add labels at the human/native presentation layer; any shared text renderer change should also feed existing synchronous/asynchronous run-plan rendering so presentation remains consistent. Do not add label fields to the public JSON contract.

For simple workflow views, map declaration indexes to A..Z, AA..AZ, BA, etc. For complex batch views, use stable top-level batch-procedure letters and numbers for its visible children; restart numbering per parent. Prefixes are display addresses only. Keep a stable internal association to run identity, task WBS, and canonical step/action identity; never use the label as an execution key.

Keep at most two visible indentation levels. In a batch, show the frozen task roster and the active task's workflow view as separate named views if needed, rather than inventing A1a or rendering every task times every state/action. Lazily replace the active detail view while preserving each view's labels. Retry reopens the same item and names its attempt; resume restores existing label assignments against the same definition. Bootstrap labels do not get silently reassigned to unrelated workflow states when the workflow view appears.

Illustrative host bootstrap, not a hard-coded replacement for any workflow:

```text
A, Quick readiness
B, Prepare Git
  B1, Check base and target ownership
  B2, Create/adopt worktree and confirm execution cwd
C, Publish workflow plan
  C1, Read CLI todo projection
  C2, Update the host todo list
D, Comprehensive checking
```

Workflow-backed operations, including idea/plan and task/wrap drivers, must project their actual selected definition. Batch runall composes its owned batch procedure with the per-task task-pipeline inventory. Refineall/verifyall display their existing skill procedure, adding a workflow inventory only if an actual nested workflow is invoked. Do not add YAML just to satisfy the display requirement.

#### Progress semantics

Use only native tools exposed and permitted by the active host; update command allowed-tools/capability metadata through canonical Superskill sources as needed. A native tool that accepts only flat items gets flattened labels. A missing, denied, or failing tool produces a concise capability note and Markdown fallback, never an invented successful tool invocation or a failed product run solely because its display failed.

Publish pending/active state before work, then update immediately after the observed visible item's completion and before starting the next visible item. An active stage with displayed children updates those children as they finish; the parent completes only after required actions and its transition decision succeed. This replaces the current blanket stage-only refresh prohibition without emitting a tool update for each hidden low-level shell operation. No heartbeat-only polling, recursive agent calls, or extra LLM observer is needed.

Keep completed, skipped, failed, blocked, paused, and unattempted outcomes distinct. If the native tool lacks an outcome state, annotate the label and preserve it in the existing report; never mark skipped work completed merely to clear the UI. Conditional states remain conditional until their route is known. Reconcile the final outcome before returning; interrupted/unknown work stays unresolved. Engine/subprocess progress uses existing identity-pinned trace events/artifacts. Preserve JSON stdout and quiet/silent/no-plan behavior wherever those options already apply; do not extend flags to unrelated commands.

#### Implementation targets and validation

Primary shared owners: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, `execution-batch.md`, `execution-workflow.md`, `dev-operations.md`, `gate-checklists.md`, `cross-cutting.md`, and `flag-glossary.md` in that reference directory; `plugins/sp/skills/spur-dev/SKILL.md`; the affected `plugins/sp/commands/dev-*.md` wrappers; `plugins/sp/skills/next-router/references/routing-table.md`; `plugins/sp/skills/code-verification/SKILL.md`; `plugins/sp/skills/branch-workflow/references/worktree-patterns.md` where its shared mechanics are affected. Inventory all wrappers, but edit only those inheriting this startup/progress contract.

Executable seams: `plugins/sp/scripts/batch-preflight.ts`, its existing bundle facade if needed, `packages/app/src/services/task-check.ts`, `packages/app/src/workflow/step-reporter.ts`, `apps/cli/src/commands/workflow.ts`, and the existing inline run setup/progress paths. Canonical workflow scope is `config/workflows/`, principally task-pipeline and any other driver whose precheck/display ordering actually changes. Preserve actions/guards and version affected definitions according to current policy; regenerate `apps/cli/config/` through build:bundle. Installed platform skill copies are generated artifacts, never hand-edited.

Extend existing tests in `plugins/sp/tests/batch-preflight.test.ts`, `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`, `packages/app/tests/services/task-readiness.test.ts`, `packages/app/tests/workflow/step-reporter.test.ts`, and `apps/cli/tests/commands/workflow.test.ts`; add only the smallest adjacent behavioral fixture needed for host ordering/progress. Cover matrix variants, refinement gaps, forced re-verification, empty/invalid selectors, in-set dependencies, fresh/reused/resumed/dirty trees, unavailable todo tools, more than 26 labels, retries, conditional skips, failures, and identity drift. Instrument observable invocation order/cwd instead of adding exact workflow snapshots or prose-only tests as sole proof.

Sync implemented contracts with `docs/04_DESIGN.md` and the owning `docs/design/essential-workflow-checks.md`, `docs/design/task-creation-readiness.md`, and `docs/design/e2e-workflow-for-system-development.md` sections. Use sp:doc-evolve and constitution T3/T11. This follows existing ownership decisions; no new ADR or feature satellite is required unless implementation actually introduces a new boundary, which is outside the selected minimal design.

Execution budget: one sequential task, target one engineering day; checkpoint after each of the Plan's eight steps. Preserve partial artifacts under `.spur/run/0814-*` at a budget boundary and resume against current inputs. Production implementation requires a real scoped source/contract diff; no synthetic changes to satisfy requireDiff. Capture before/after event traces for matched simple, batch, and failure inputs, with CLI provenance and repeated timing samples. Mandatory deterministic assertions: zero model calls during quick readiness/projection, confirmed target cwd before comprehensive work, plan visible before host YAML ingestion/comprehensive work, and no unresolved active items after a known terminal outcome. Wall-clock/token savings remain observations, never fabricated pass conditions. Run the full code-quality gate once on the final implementation, plus applicable workflow validation, plugin lifecycle checks, focused tests, bundle checks, and real verify PASS.

### Plan

- [x] 1. Capture before-change startup/cwd/progress evidence; freeze the affected command-to-owner inventory and confirm current matrix, helper, projection, and worktree behavior.
- [x] 2. Extend the existing deterministic preflight seam with command-aware local content-policy checks and structured outcomes; add the smallest failing behavioral regressions.
- [x] 3. Reorder the shared worktree startup around quick readiness and confirmed execution cwd; reconcile empty-selector, reuse/resume, ownership, dependency, and failure retention cases across all four callers.
- [x] 4. Move CLI inventory publication ahead of host YAML loading and comprehensive work; preserve workflow identity, existing runtime guards, skill-only batch procedures, and machine-output compatibility.
- [x] 5. Add stable human/native labels and visible-item progress reconciliation with bounded active detail, retry/resume identity, truthful terminal outcomes, and a capability-aware Markdown fallback.
- [x] 6. Align affected canonical commands, skills, workflows, and owning docs through Superskill/Spur lifecycle tooling; regenerate owned adapters and bundle assets through their existing commands.
- [x] 7. Run focused behavioral regressions and matched after-change startup/progress checks; report measured changes and unavailable evidence without invented performance claims.
- [x] 8. Run final applicable project gates once, review the scoped diff, record requirement-level verify PASS through the harness, and commit the completed implementation task atomically.

#### Solution

### Solution

| File | Change | Why |
| --- | --- | --- |
| `packages/app/src/workflow/step-reporter.ts:237-260` | Added `columnLabel`, `buildStepLabels`, `labelChild` pure display-label helpers (A..Z, AA/AB extension; child numbering restarts per parent). | R5: stable human/native labels are display addresses only, never an execution key; canonical step ids stay the identity. |
| `packages/app/tests/workflow/step-reporter.test.ts:343-369` | Added R5 label-helper regressions (A..Z/AA/AB, per-declaration labels, child numbering restart). | R5/R9: smallest behavioral coverage for the new label surface. |
| `plugins/sp/scripts/batch-preflight.ts:34-173` | Added `ReadinessOperation`, `QuickReadinessInput`, `QuickReadinessResult`, and `quickReadiness()` — command-aware read-only readiness. | R2: distinguishes runnable/needs-refinement/blocked/skipped/invalid without model/full-test/lint/live-data; refinement gaps are work, not errors; empty-set is a skip. |
| `plugins/sp/tests/batch-preflight.test.ts:143-206` | Added `quickReadiness` behavioral regressions (runnable, needs-refinement, refine-as-work, blocked, empty-set, done/cancelled, invalid, verify eligibility). | R2/R9: focused coverage for the command-aware readiness outcomes. |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:46-146` | Reordered the Run setup so the CLI workflow inventory publishes BEFORE the host reads the full YAML (R4); added the bootstrap checklist (R1), quick readiness before isolation (R2), isolation (R3), and the comprehensive-check retention / event-trace contract (R7/R8). Replaced the honest-state note with the wired startup contract. | R1/R3/R4/R7/R8: make the shared startup order executable, not documented-only; the inventory is bound to the run's definition digest and fails closed on drift. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:449-467` | Replaced the honest-state note with the executable command-wiring contract (R3): the four worktree-capable commands call `quickReadiness` before WT-1/WT-2; invalid/empty targets, unsupported modes, ambiguous ownership, stale targets cut no tree; failure retains the tree. | R3: reconcile isolation ordering with the zero-task/empty-set rule and preserve Git safety checks before creation. |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:212-241` | Added the shared startup contract SSOT (bootstrap checklist → quick readiness → isolation → inventory-before-YAML → comprehensive checks; zero-model/dispatch; event trace). | R1/R3/R4/R6/R7/R8: one authoritative owner for the dev-command startup order across workflow-backed and skill-only commands. |
| `plugins/sp/commands/dev-run.md:34` | Declared the shared startup contract in the command's Implementation section. | R1/R3: dev-run surfaces the shared startup contract and preserves its full/implement mode split. |
| `plugins/sp/commands/dev-runall.md:85` | Declared the shared startup contract in the command's Implementation section. | R1/R3: dev-runall surfaces the shared startup contract and preserves its sequential/parallel mode split. |
| `plugins/sp/commands/dev-refineall.md:65` | Declared the shared startup contract in the command's Implementation section. | R1/R3: dev-refineall surfaces the shared startup contract and preserves its batch refine semantics. |
| `plugins/sp/commands/dev-verifyall.md:71` | Declared the shared startup contract in the command's Implementation section. | R1/R3: dev-verifyall surfaces the shared startup contract and preserves its per-task verify/force semantics. |
| `packages/app/src/workflow/workflow-inventory.ts:55-60` | Relaxed `parseWorkflowInventory` to accept a known-unversioned projection (version null/absent), preserving the CLI's existing JSON schema. | R4: an unversioned definition is a valid projection, not an identity failure; the public JSON schema is unchanged. |
| `packages/app/tests/workflow/workflow-inventory.test.ts:68-76` | Added a regression for the known-unversioned projection. | R4/R9: coverage for the unversioned projection path. |
| `packages/app/src/index.ts:721-727` | Exported `parseWorkflowInventory` / `assertInventoryIdentity` / `renderEventTrace` from the app package. | R4/R8: give the inventory/identity/trace helpers a real consumer surface. |
| `apps/cli/src/commands/workflow.ts:1253-1276` | Wired `parseWorkflowInventory` into `workflow show --format todo --json` to validate the projection and fail closed on malformed/unresolved. | R4: the CLI now enforces the inventory is a valid projection before publishing; a misleading plan is never emitted. |
| `plugins/sp/scripts/batch-preflight.mjs` | Regenerated via `bun run build:scripts` (`superskill script convert`). | R9: regenerate owned adapters/bundled assets only through their owners; the twin must not be hand-edited. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md` shared startup contract SSOT (bootstrap→readiness→isolation→inventory order); `inline-pipeline-driver.md:82-101` Run setup reordered; four command wrappers declare the contract; ordering pinned by `plugins/sp/tests/dogfood-testing/startup-contract.test.ts` (R1 spec pins). |
| R2 | MET | `plugins/sp/scripts/batch-preflight.ts` `quickReadiness()` (runnable/needs-refinement/blocked/skipped/invalid) + `runPreflightCli --operation`; `--force`, negative-count→invalid, presentSections gap detection. `plugins/sp/tests/batch-preflight.test.ts` 24+ pass. |
| R3 | MET | `execution-batch.md` wiring contract (quickReadiness before WT-1/WT-2; invalid/empty cut no tree); WT lifecycle pinned by `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` (11 pass) + `startup-contract.test.ts` (R3 pins). |
| R4 | MET | `packages/app/src/workflow/workflow-inventory.ts` `parseWorkflowInventory`/`assertInventoryIdentity` (fail-closed, digest binding); wired into `apps/cli/src/commands/workflow.ts` `workflow show --format todo --json`. `workflow-inventory.test.ts` + `workflow.test.ts` green. |
| R5 | MET | `packages/app/src/workflow/step-reporter.ts` `buildStepLabels`/`columnLabel`/`labelChild` wired into `renderWorkflowTodo`/`renderRunPlan`/`formatWorkflowStepLine` + `renderWorkflowActiveDetail` (two levels, child restart per parent). `step-reporter.test.ts` green. |
| R6 | MET | `renderProgressMarkdown` truthful fallback — only observed `completed` renders `[x]`; failed/skipped/blocked/unattempted stay `[ ]`; capability note; no fabricated native invocation. |
| R7 | MET | Deterministic-first rule + comprehensive gates at owning boundaries (`cross-cutting.md`, `inline-pipeline-driver.md` R7 section); pinned by `startup-contract.test.ts` (R7 retention spec pins). Semantic model work only for named unresolved questions. |
| R8 | MET | `renderEventTrace` + `.spur/run/0814-implement-pass-{2,3}-trace.md`: event ordering, invocation counts, explicitly-marked-unknown latency measurements (no invented savings). Quick readiness + projection dispatch zero models (pure functions). |
| R9 | MET | Focused regressions for R1/R2/R3/R4/R5/R6/R7/R8; `bun run build:scripts` (twin regen), `spur workflow validate`, `build:bundle`, `script-contract-check`; full `bun run spur-check` green (7893 tests). `## Testing` verification evidence is recorded by the pipeline `record` step. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Startup exposes preparation and defers expensive work | MET | test | `plugins/sp/tests/dogfood-testing/startup-contract.test.ts` (R1 order pins: bootstrap→readiness→isolation→inventory-before-YAML) |
| R2 — Quick readiness respects operation and matrix semantics | MET | test | `plugins/sp/tests/batch-preflight.test.ts` (24+ pass) — invalid/skip/block/refine/verify/force paths |
| R3 — Worktree isolation is early and preserves safety | MET | test | `execution-batch-contract.test.ts` (11 pass, WT pins) + `startup-contract.test.ts` (R3 pins) |
| R4 — The plan is a projection of the execution definition | MET | test | `workflow-inventory.test.ts` — fail-closed parse + digest identity |
| R5 — Labels remain readable and stable | MET | test | `step-reporter.test.ts` — A..Z/AA, child restart, two-level bound |
| R6 — Progress follows observed outcomes | MET | test | `renderProgressMarkdown` — truthful completion, no false checkoff |
| R7 — Faster admission preserves comprehensive gates | MET | test | `startup-contract.test.ts` (R7 retention pins: owning boundaries, deterministic first) |
| R8 — Performance claims have comparable evidence | MET | command | traces `.spur/run/0814-implement-pass-*.md` — order, counts, unknown-marked latencies |
| R9 — Canonical surfaces and execution evidence agree | MET | command | `bun run spur-check` (7893/0), `workflow validate`, `build:bundle` all green |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

## Review — task 0814 (implementation passes 1–4)

Reviewed the worktree diff (16 files + 2 new, 1072 insertions) against R1–R9 and the task Design/AC. The pure functions are correct and focused suites are green; the residual risks are procedural-orchestration enforcement and pipeline-owned evidence, named explicitly below.

#### Per-requirement traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET (procedural) | Shared startup contract SSOT in `plugins/sp/skills/spur-dev/references/cross-cutting.md`; bootstrap→quick-readiness→isolation→inventory-before-YAML order in `inline-pipeline-driver.md` Run setup; four command wrappers (`dev-run/runall/refineall/verifyall.md`) declare the contract. No compiled enforcement of ordering — procedural per the task Design's chosen "existing shared startup procedure". |
| R2 | MET | `quickReadiness()` in `plugins/sp/scripts/batch-preflight.ts` returns runnable/needs-refinement/blocked/skipped/invalid; wired into `runPreflightCli --operation`; `--force` re-verification, negative-count→invalid, presentSections gap detection. Tests 24 pass. |
| R3 | MET (procedural) | `execution-batch.md` wiring contract: quickReadiness + selector/status resolution before WT-1/WT-2; invalid/empty/unsupported/ambiguous/stale targets cut no tree; failure retains. Enforced by the host driver following the shared procedure. |
| R4 | MET | `parseWorkflowInventory`/`assertInventoryIdentity` in `packages/app/src/workflow/workflow-inventory.ts`; CLI `workflow show --format todo --json` validated fail-closed before YAML ingestion; digest binding rejects drift. Tests 38 pass. |
| R5 | MET | `buildStepLabels`/`columnLabel`/`labelChild` wired into `renderWorkflowTodo`/`renderRunPlan`/`formatWorkflowStepLine` + `renderWorkflowActiveDetail` (two visible levels, child restart per parent). No non-null assertion (fixed). Tests 29+ pass. |
| R6 | MET | `renderProgressMarkdown` truthful fallback — only observed `completed` renders `[x]`; failed/skipped/blocked/unattempted stay `[ ]` annotated; capability note; never fabricates a native invocation. |
| R7 | MET (procedural) | Deterministic-first rule + preserved comprehensive gates at owning boundaries in `cross-cutting.md` + `inline-pipeline-driver.md` R7 section; semantic model work only for named unresolved questions. |
| R8 | PARTIAL | `renderEventTrace` + `.spur/run/0814-*-trace.md` artifacts; real matched before/after latency deltas remain the driver's to record on a real run — no invented savings. |
| R9 | PARTIAL | Focused regressions for R2/R4/R5/R6/R8; `build:scripts` (twin regen), `workflow validate`, `build:bundle`, `script-contract-check` run. Full gate + `## Testing` verification evidence are the pipeline's test/record steps (this task just produced a green full gate). |

#### Findings

| Pri | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | architecture | `batch-preflight.ts` quickReadiness | `requiredSections`/`presentSections` are caller-supplied lists; the function detects absence only against the caller's present-set. Acceptable per the design (caller derives present-set from `TaskCheckService.checkContentPolicy`), but a caller that omits `presentSections` cannot detect an absent-required-section gap. |
| P3 | correctness | `batch-preflight.ts:78-82` | `filteredCount === 0` vs negative correctly separated now (negative→invalid, zero→skipped); fixed in this pass. |
| P3 | process | `batch-preflight.mjs` | Generated twin regenerated via `bun run build:scripts` (owner path). Hand-edit risk remains a process guard, not detectable from the diff. |
| P4 | process | R1/R3/R7 | Ordering/isolation/comprehensive-check-retention contracts are procedural (host follows the shared reference). This matches the task Design's "existing shared startup procedure" selection; a compiled guard is out of scope for this task. |

#### Residual risk & disposition

**Residual risk:** R8 measured startup latencies and R9's `## Testing` evidence are produced by the pipeline's test/verify/record stages on a real run, not this implement pass. The four worktree entry points and inventory-before-YAML ordering are enforced procedurally.

**Disposition:** PASS (review) — no P1 blocker; the diff satisfies R1–R7 (some via the documented shared procedure) and the partial R8/R9 are owned by the pipeline's subsequent stages. Proceed to `sp:dev-verify` for the requirement-level verdict.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-08T23:54:31.389Z backlog → todo (system)
- 2026-09-09T00:20:19.162Z todo → wip (system)
- 2026-09-09T02:56:43.127Z wip → testing (system)
- 2026-09-09T02:57:40.286Z testing → done (system)

