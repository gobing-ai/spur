---
schema_version: 1
id: H1
name: spur-dev umbrella skill
status: active
priority: P1
tags: [rd3-migration, wave-3]
created_at: 2026-06-12T23:45:00.000Z
updated_at: "2026-08-10T06:39:45.583Z"
---

# H1: spur-dev umbrella skill

## Goal

The Spur daily-workflow skill suite: a **thin orchestration spine** (`sp:spur-dev`) that drives the
planning→execution lifecycle and **dispatches deep, functionally-decomposed competency skills**
(`sys-architecture`, `code-implementation`, `code-testing`, `code-verification`, `spec-decomposition`,
with `test-driven-development` as a referenced discipline), plus a `sp:spur-cli` CLI facade — backing the `sp:dev-*`
command family and the `expert-spur` / `super-coder` subagents (ADR-028).

## Scope

**In scope:**
- The orchestration spine (`sp:spur-dev`) and the `phase → skill` binding in `task-pipeline.yaml`.
- The functional competency skills (`sys-architecture`, `code-implementation`, `code-testing`,
  `code-verification`, `spec-decomposition`) and `test-driven-development` as a referenced discipline.
- The `sp:spur-cli` CLI facade (one reference per noun) and the `expert-spur` / `super-coder` subagents.
- The ADR-016-filtered `sp:dev-*` command subset (byte-stable surface).

**Out of scope:**
- Companions and the write-guard hook (H2).
- The gate-level rules engine (C).
- Parallel/worktree batch execution (H1 task 0142, separately tracked).

## Acceptance Criteria

```gherkin
Feature: spur-dev umbrella skill

  Scenario: Every LLM output is CLI-gated before write
    Given the planning half generates a feature with AC
    When the feature check gate fails
    Then the skill loops on the findings
    And nothing reaches the corpus until the gate passes

  Scenario: Decomposition lands atomically
    Given a generated decomposition JSON
    When it violates task-batch.schema.json
    Then batch-create writes nothing and returns findings

  Scenario: Commands are thin wrappers
    Given any shipped sp:dev-* command
    When its definition is inspected
    Then it parameterizes sp:spur-dev and contains no pipeline logic

  # ── Batch execution (task 0141 — /sp:dev-runall + sp:super-coder) ──
  Scenario: R1.1 Run an explicit WBS list
    Given a set of tasks
    When the operator selects them by explicit WBS list
    Then exactly those tasks are resolved

  Scenario: R1.2 Run a status pseudo-list
    Given tasks with a given status
    When the operator selects that status pseudo-list
    Then every task with that status is resolved

  Scenario: R1.3 Run a feature-scoped selection
    Given a feature with linked tasks
    When the operator selects feature:<id>
    Then every task on that feature edge is resolved

  Scenario: R1.4 Run the "ready" pseudo-list
    Given tasks in todo/backlog with mixed dependency readiness
    When the operator selects the ready pseudo-list
    Then only dependency-satisfied tasks are resolved

  Scenario: R2.1 The selected set is frozen at kickoff
    Given a resolved set
    When statuses change mid-batch
    Then the working set is not re-queried

  Scenario: R2.2 Tasks run in topological dependency order
    Given an in-set dependency edge
    When the batch runs
    Then the dependency runs before its dependent

  Scenario: R2.3 A dependency cycle aborts the batch
    Given a dependency cycle in the set
    When the batch is planned
    Then it aborts before running any task

  Scenario: R2.4 An unmet out-of-set dependency blocks the dependent subtree
    Given an unmet out-of-set dependency
    When the batch runs
    Then the dependent subtree is blocked, independents still run

  Scenario: R2.5 A satisfied out-of-set dependency is allowed
    Given a done out-of-set dependency
    When the batch runs
    Then the dependent is treated as satisfied and runs

  Scenario: R3.1 First pipeline failure halts the batch
    Given a task pipeline ends in failed
    When the default failure policy applies
    Then the batch halts and remaining tasks are not attempted

  Scenario: R3.2 --keep-going skips the failed subtree and continues
    Given a task fails under --keep-going
    When independents remain
    Then the failed subtree is skipped and independents run

  Scenario: R4.1 Each task runs through the standard pipeline
    Given a task in the plan
    When the batch runs it
    Then it uses task-pipeline.yaml verbatim with no new FSM

  Scenario: R4.2 --auto propagates the HITL profile to each task run
    Given --auto is passed
    When each task runs
    Then profile=auto is set per run

  Scenario: R4.3 --agent pins the per-task step executor, not the orchestrator
    Given --agent is passed
    When each task runs
    Then agent is merged into per-task vars and the orchestrator is unchanged

  Scenario: R5.1 super-coder drives between runs, never inside a step
    Given sp:super-coder is the orchestrator
    When the batch runs
    Then it acts between runs and never inside a pipeline step

  Scenario: R5.2 Batch report is emitted at completion
    Given the batch finishes
    When it terminates
    Then a structured batch report is emitted

  # ── Functional decomposition (task 0161 — ADR-028: split the umbrella by function) ──
  Scenario: R1 ADR records the functional split before any file changes
    Given the functional split is not yet recorded in any ADR
    When the restructure begins
    Then a dated ADR entry supersedes the one-fat-skill posture of ADR-016/ADR-023
    And no skill, agent, or command file is modified before that entry is committed

  Scenario: R2 spur-cli is a CLI facade with one reference per noun
    Given the spur CLI has the nouns tasks, features, rules, and workflows
    When spur-cli is created
    Then it has one reference file per noun and routes invocation guidance only
    And it contains no competency logic

  Scenario: R3 the four noun-skills are retired without content loss
    Given spur-tasks, spur-features, spur-rules, and spur-workflows exist
    When their content is re-homed into spur-cli reference files
    Then the four noun-skills are removed and every reference to them points to spur-cli
    And each retired skill's substantive guidance has a home in spur-cli

  Scenario: R4 expert-spur replaces the four noun experts
    Given expert-tasks, expert-features, expert-rules, and expert-workflows exist
    When expert-spur is created loading spur-cli
    Then the four noun experts are retired and references point to expert-spur
    And expert-spur's trigger does not collide with the dev-workflow agents

  Scenario: R5 super-coder absorbs the single-task lifecycle and expert-dev is retired
    Given expert-dev and super-coder both delegate to the dev workflow
    When the overlap is resolved
    Then expert-dev is removed and super-coder drives both a single task end-to-end and a batch
    And its triggers cover both without ambiguity against the /sp:dev-* commands

  Scenario: R6 R7 R8 the competency skills exist on the functional axis
    Given the fat skill owns design, implementation, and testing under one trigger
    When the competencies are extracted
    Then sys-architecture, code-implementation, and code-testing each exist as standalone skills
    And each has a distinct trigger and owns its re-homed reference files

  Scenario: R9 test-driven-development remains a referenced discipline skill
    Given two mature systems disagree on whether TDD is its own skill
    When the split is complete
    Then test-driven-development remains a thin discipline skill referenced by code-implementation and code-testing
    And it is not absorbed into either

  Scenario: R10 spec-decomposition is extracted after the binding is proven
    Given composition is fused to the orchestration spine today
    When the spine-to-competency binding has been proven end-to-end
    Then spec-decomposition is extracted as a standalone skill carrying its re-homed references
    And the spine no longer inlines decomposition

  Scenario: R12 the spine dispatches competencies and never inlines them
    Given task-pipeline.yaml drives execution
    When a task runs through the pipeline
    Then each phase is bound to its competency skill and receives the WBS plus advisory payload
    And spur-dev acts only as the dispatching spine

  Scenario: R13 cross-cutting rules remain a single source of truth
    Given cross-cutting.md is read by the spine and every competency
    When the split is complete
    Then exactly one cross-cutting.md exists and every competency links to it

  Scenario: R15 the /sp:dev-* command surface is byte-stable
    Given the dev-* commands are thin delegating wrappers
    When delegation is re-pointed to the new owning skills
    Then every command keeps its name and flags and only its delegation target changes

  Scenario: R16 skills have disjoint trigger surfaces with resolving links
    Given the spine, competencies, and spur-cli all carry triggers
    When the assertion suite runs
    Then no two skills share ambiguous trigger vocabulary
    And exactly one cross-cutting.md exists, every cross-skill link resolves, and no retired name is still referenced

  Scenario: R17 no cross-competency dependency leaks past the shared link
    Given the split is complete
    When any competency is operated end to end
    Then it requires no step or reference owned by another competency
    And the only cross-skill dependency is the shared cross-cutting.md link

  Scenario: R19 the verification gate stays green after the restructure
    Given all waves are complete
    When the full verification gate runs
    Then bun run lint, bun run test (incl. the new assertions), and bun run build all pass with no skips
    And git status shows only intentional changes

  Scenario: R20 the sp plugin is self-contained
    Given the restructure re-homes content derived from rd3 and vendor references
    When the plugin tree is scanned
    Then no skill, agent, command, reference, config, or doc inside plugins/sp references vendors/ or the rd3 plugin path
    And the self-containment assertion passes in the test gate

  # ── R1: flag surface ──

  Scenario: R1.1 The three batch commands accept --worktree
    Given the sp plugin command documents
    When I inspect dev-runall, dev-refineall, and dev-verifyall
    Then each declares --worktree in its frontmatter argument-hint
    And each lists --worktree in its Argument Flags table with default off
    And each shows --worktree in its Usage block

  Scenario: R1.2 dev-next does not accept --worktree
    Given the dev-next command document
    When I inspect its argument-hint and flag table
    Then --worktree is absent
    And the exclusion rationale is recorded in the sp:spur-dev batch reference

  # ── R2: creation ──

  Scenario: R2.1 A clean run creates one worktree before any task work
    Given a clean main working tree on base ref "feat/example"
    When I run a batch command with --worktree
    Then exactly one git worktree is created on a new branch cut from "feat/example"
    And the worktree directory follows the sibling-directory convention
    And the batch loop executes with the worktree as its process cwd

  Scenario: R2.2 The base ref is the current ref, not literally main
    Given the main tree is checked out on "feat/example"
    When I run a batch command with --worktree
    Then the worktree branch is cut from "feat/example"
    And the recorded base ref is "feat/example"

  # ── R3: dirty-tree precheck ──

  Scenario: R3.1 A dirty main tree aborts before any worktree is created
    Given the main working tree has uncommitted modifications
    When I run a batch command with --worktree
    Then the command aborts before creating a worktree
    And the output names the uncommitted files
    And the output instructs the operator to commit or stash
    And no task work has run

  Scenario: R3.2 --force proceeds past a dirty tree with a warning
    Given the main working tree has uncommitted modifications
    When I run a batch command with --worktree --force
    Then a divergence warning is emitted naming the uncommitted files
    And the worktree is created and the batch proceeds

  # ── R4: success path ──

  Scenario: R4.1 A fully successful batch fast-forward-merges and cleans up
    Given a batch run with --worktree in which every task succeeded
    And the base ref has not moved since the worktree was created
    When the batch completes
    Then the worktree branch is fast-forward-merged onto the base ref
    And the worktree directory is removed
    And the worktree branch is deleted
    And the state marker records the terminal status "merged"

  Scenario: R4.2 A moved base ref falls through to retention, never a conflict resolve
    Given a batch run with --worktree in which every task succeeded
    And the base ref has advanced so fast-forward is impossible
    When the batch completes
    Then no rebase, merge commit, or conflict resolution is attempted
    And the worktree and branch are retained
    And the report names the divergence and the three operator commands

  # ── R5: failure path ──

  Scenario: R5.1 A halted batch retains the worktree intact
    Given a batch run with --worktree that halts at the third of seven tasks
    When the run ends
    Then the worktree directory and branch still exist
    And the work committed by the first two tasks is present in the worktree
    And nothing was merged onto the base ref

  Scenario: R5.2 The retention report names path, branch, cause, and three commands
    Given a batch run with --worktree that failed or halted
    When the report is emitted
    Then it names the worktree path, the branch, and the base ref
    And it names the halt cause in the flag-glossary halt-report shape
    And it prints a resume command, a merge command, and a discard command

  Scenario: R5.3 No flag combination auto-deletes a failed run's worktree
    Given a batch run with --worktree that failed or halted
    When the run ends under any combination of --auto, --force, and --keep-going
    Then the worktree directory and branch are retained

  # ── R6: crash-safe marker ──

  Scenario: R6.1 A marker is written under .spur/run at creation
    When a --worktree batch creates its worktree
    Then a marker file is written under .spur/run
    And it records marker id, worktree path, branch, base ref, and base SHA
    And it records originating command, task selector, created-at, and status

  Scenario: R6.2 A killed session leaves a recoverable marker
    Given a --worktree batch whose session is killed mid-run
    When the operator inspects .spur/run afterwards
    Then the marker identifies the worktree path, branch, and base ref
    And the retained worktree can be resumed, merged, or discarded from it

  # ── R7: --continue ──

  Scenario: R7.1 --continue re-enters the existing worktree
    Given an interrupted batch started with --worktree
    When I re-run the command with --continue --worktree
    Then the existing worktree is re-entered via its marker
    And no second worktree is created

  Scenario: R7.2 --continue without a resolvable marker fails loudly
    Given no resolvable worktree marker for the batch
    When I run the command with --continue --worktree
    Then the command fails with a message naming the missing marker
    And it does not silently run in the main working tree

  # ── R8: scope exclusions ──

  Scenario: R8.1 --worktree with --mode parallel is rejected
    Given a batch command invoked with --worktree --mode parallel
    When the flags are validated
    Then the combination is rejected
    And the message points to task 0142 for per-task parallel isolation

  # ── R9/R10: docs and portability ──

  Scenario: R9.1 The flag glossary documents --worktree
    When I read spur-dev/references/flag-glossary.md
    Then it carries a --worktree section in the established per-flag format
    And execution-batch.md describes the worktree lifecycle for the sequential loop

  Scenario: R10.1 The mechanism is portable git, not a Claude-Code-only tool
    When I inspect the implementation guidance
    Then it uses portable git worktree commands
    And it does not depend on the EnterWorktree or ExitWorktree tools
    And it reuses branch-workflow/references/worktree-patterns.md for git mechanics

  # ── 0479: verification-loop gate holes ──

  Scenario: R1 A verdict artifact with no requirement rows blocks done
    Given a task at "testing" whose verdict artifact has an empty requirements array
    When the testing-to-done transition is attempted
    Then the transition is refused
    And the failure names the malformed verdict artifact
    And a verdict recorded as UNKNOWN is refused on the same path


  Scenario: R2 Evidence anchors authored from the skill pass the checker
    Given an agent authoring a Testing section directly from sp:code-verification
    When it records file:line evidence following the skill text
    Then the paths are repo-relative from the project root
    And spur task check --strict-core reports 0 L4.stale-line-anchor findings
    And the issue-finding skill's citation example is repo-relative


  Scenario: R3 Non-subset task AC warns at write time
    Given a task with a feature_id whose parent feature AC lacks the task's scenarios
    When the task Acceptance Criteria section is written via spur task update
    Then the command warns that the scenarios are not a feature-AC subset
    And the operator learns this without running task check --strict-core


  Scenario: R4 The sp suite is cwd-independent
    Given the sp plugin test suite
    When it runs from the repository root and again from plugins/sp
    Then both runs report the same pass and fail counts
    And neither reports a path containing plugins/sp/plugins/sp


  Scenario: R5 A task needs at most two full-suite executions
    Given a task whose verification requires the full test suite
    When the suite is run and reports failures
    Then the failure list is parsed from that run's retained output
    And the suite is not re-executed solely to enumerate failures


  Scenario: R6 The sandbox baseline is documented and actionable
    Given spur-check exits non-zero in the restricted sandbox
    When an agent consults the gate checklist
    Then it finds the known environmental failure count and its cause class
    And it finds the file-triage step that distinguishes environmental from real failures

  # ── 0478: pipeline bottlenecks ──

  Scenario: R1.1 Orchestrator warns before launch when plan items exceed cap
    Given a task with 11 Plan items and the pipeline default cap of 8
    When the operator invokes /sp:dev-run <wbs> --mode full
    Then the skill surfaces a warning before any spur workflow run call
    And suggests the --vars override or plan reduction
    And prompts the operator to confirm (unless --auto is set)

  Scenario: R1.2 --auto bypasses the prompt but logs the override
    Given the same task with 11 Plan items and --auto set
    When the operator invokes /sp:dev-run <wbs> --mode full --auto
    Then the skill adds maxImplementPlanItems to vars automatically
    And launches the pipeline without an interactive pause
    And emits a single-line notice about the override

  Scenario: R2.1 A pipeline verify run produces a parseable verdict
    Given a verify stage running as a subprocess executor
    When it writes the answer file to .spur/run/<wbs>-verify-answer.txt
    Then the file carries an explicit Verdict line
    And a per-requirement table with at least one requirement row
    And spur task verdict --from-answer exits 0 with PASS or FAIL, never UNKNOWN

  Scenario: R2.2 An unparseable answer file still fails the pipeline
    Given a verify agent that wrote prose instead of the contracted tables
    And the task status is already done
    When verify/shell runs spur task verdict --from-answer
    Then the verdict is UNKNOWN and the step exits non-zero
    And the pipeline routes to failed
    And the run is not treated as a pass on account of the task's status

  Scenario: R3.1 Typecheck runs exactly once per test stage
    Given a clean working tree
    When the test stage executes qualityGateCmd
    Then typecheck is invoked exactly once, inside spur-check
    And the test stage wall time decreases versus the two-typecheck baseline

  Scenario: R3.2 Lint and format coverage is unchanged
    Given the updated qualityGateCmd default
    When a file with a lint violation is in the working tree
    Then the test stage still catches the violation and fails

  Scenario: R3.3 The shared autofix script is untouched
    Given the change is scoped to the pipeline's qualityGateCmd default
    When package.json is inspected
    Then the autofix script still runs format followed by typecheck for its other callers

  # ── E1 batch forensics (task 0482 — reachable escalation, precheck wiring, fix-hop scope) ──
  Scenario: R1 — a pinned executor still escalates on resource exhaustion
    Given the implement step pins a concrete executor (not the literal `auto`)
    And the prompt resolves to the `implement` stage whose model_policy declares a resource-exhaustion fallback
    When the dispatch exits non-zero with a 429 quota body
    Then the run escalates to the next eligible tier and re-dispatches
    And the escalation is reported naming the failed executor, the signal, and the target tier
    And the run does not terminate at `failed` with only a partial-work artifact

  Scenario: R2 — the size precheck resolves spur regardless of shell PATH
    Given a workflow shell whose environment has no user PATH (bare `spur` unresolvable)
    When the size precheck runs
    Then the pipeline passes `--spur-bin "$spurBin"` to the script
    And the precheck reports PASS rather than `could not fetch task <wbs> via spur`

  Scenario: R3 — a single gate finding costs one fix dispatch
    Given the quality gate fails with exactly one finding carrying a file:line anchor
    When the test-fix hop dispatches its fix agent
    Then the agent input names that finding's file:line
    And the gate goes green within one dispatch rather than consuming the step timeout

  Scenario: R4 — a dead agent's handoff points at its transcript
    Given an agent.run step fails and writes a partial-work artifact
    When an operator opens that artifact to resume
    Then it contains a resume-context block naming the agent session directory
    And that path resolves to the dead agent's transcript

  Scenario: R5 — executor-exhaustion guidance exists once and is true
    Given the `--agent` execution-surface SSOT anchor
    When an operator selects a default executor for a batch run
    Then the anchor states that any executor can exhaust and that the pipeline escalates
    And no document claims an executor has no hard quota
    And no document instructs reading quota state from `spur agent doctor`
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0064 | W3: sp:spur-dev umbrella skill — planning and execution halves | done |
| 0065 | W3: sp:dev-* slash command subset and subagents | done |
| 0141 | Batch task execution — /sp:dev-runall + dependency-ordered driver + sp:super-coder orchestrator | done |
| 0142 | Batch execution v2 — parallel runs (worktree isolation) + interactive within-step escalation | blocked |
| 0161 | Split sp:spur-dev at the lifecycle-half seam into planning (sp:spur-plan) and execution (sp:spur-dev) | done |
| 0162 | Strengthen sp dev-verify with mandatory Acceptance Criteria guard | done |
| 0227 | enhance the review capability in plugin sp | done |
| 0228 | fix review section double-write and stale pipeline descriptions | done |
| 0229 | bind structured-input tool calls in dev-brainstorm and brainstorm | done |
| 0230 | bind structured-input tools and centralize up-front questionnaires across dev commands | done |
| 0231 | migrate reverse-engineering skill and dev-reverse command from rd3 to sp | done |
| 0408 | Extract the flag glossary out of dev-operations.md into its own reference | done |
| 0477 | Batch worktree isolation --worktree for dev-runall dev-refineall dev-verifyall | done |
| 0478 | Fix pipeline bottlenecks from task 0477 run: size-gate surprise, verify-answer format mismatch, duplicate typecheck in test stage | done |
| 0479 | Fix verification-loop gate holes and discovery costs found in the 0477 re-verify session | done |
| 0480 | Comprehensive cleanup of the --agent execution-surface contract: collapse duplicated definitions to one SSOT and purge ADR-041/046-era stale | done |
| 0481 | 0475-verify retrospective: worktree deps install, worktree-local spur CLI, merge commit-type contract, lifecycle transition chain, merge side-effect hygiene | done |
| 0482 | E1 batch waste: unreachable tier-fallback, precheck spurBin, fix-hop scope | done |
| 0483 | Fix H1 pipeline contract defects: implement scope, agent pin, review table, fixall repeats | done |
| 0485 | Agent executor exhaustion failover: classifier coverage, implementAgent injection, failover semantics | done |
| 0496 | Extend --worktree to accept an existing worktree name for batch reuse | done |
<!-- END AUTO-GENERATED -->

## Notes
The umbrella skill is decomposed by **function**, not by lifecycle phase (ADR-028, task 0161): a thin
spine dispatches deep competency skills and never inlines them. A phase split (planning vs. execution)
was considered and rejected — a phase boundary is temporal and relocates coupling rather than reducing
it. The functional decomposition mirrors the migration origin's own architecture (~50 functional
skills + thin spine); evidence reviewed at design time only (see task 0161), never a shipped
dependency — `plugins/sp` is self-contained (ADR-028d). dev-* names continue for muscle memory; subset
decided per candidate by the ADR-016 test (task 0065).



**Do not close H1 yet.** Linked task `0142` (tasks2) remains **blocked** — deferred parallel worktree batching + mid-step interactive escalation. Sync correctly refuses `done` and proposes `blocked` while 0142 is non-terminal.

- `task list --feature H1` only shows active-folder tasks by default (tasks3); archive folder tasks2 still count for feature edges.
- H81/H82/H83 are separate features; closing them does not close the H1 umbrella.
- When 0142 is cancelled (if superseded by H51/parallel work) or completed, re-run `spur feature sync H1`.
## History

- 2026-06-12 — created (rd3-migration feature finalizing)
- 2026-08-08T20:21:45.518Z backlog → active (system)
