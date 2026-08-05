---
schema_version: 1
id: H1
name: spur-dev umbrella skill
status: backlog
priority: P1
tags: [rd3-migration, wave-3]
created_at: 2026-06-12T23:45:00.000Z
updated_at: "2026-08-05T22:38:32.649Z"
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
