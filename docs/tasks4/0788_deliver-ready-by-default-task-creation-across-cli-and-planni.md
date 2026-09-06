---
schema_version: 1
name: "Deliver ready-by-default task creation across CLI and planning"
status: todo
template: feature-impl
created_at: 2026-09-06T20:59:14.083Z
updated_at: "2026-09-06T21:02:12.737Z"
feature_id: F21
priority: P1
dependencies: ["0787"]
---

## 0788. Deliver ready-by-default task creation across CLI and planning

### Background

The existing sp-dev-refine --depth ready checklist verifies premises, explicit requirements, frozen design names/seams, file targets, executable AC, ordered plan and dependency handoffs. Single task create does not invoke it. AgentService already provides captured/traced execution; planning skills already synthesize batch content inline. finalizeIdeaHandoff currently treats task check exit 0 as readiness. These are the reuse points for the approved one-action creation experience, not reasons to add a new runtime.

Implements feature scenarios R4 — Default creation prepares a task and skip-ready captures intent; R5 — Preparation failure preserves task identity and a recovery action; R6 — Batch preparation validates all candidates before commit; R7 — Planning handoff distinguishes specification readiness from execution eligibility; R8 — Shared HTTP and internal task writers remain deterministic. Single/batch orchestration, failure recovery and their planning callers must be reviewed together. Depends on task 0787, the companion F21 deterministic creation/check task; dependencies[] records that WBS.

Sizing: approximately 8–12 hours, one creation-to-ready outcome across app/CLI/plugin seams, medium risk and sequential ownership. Cohesion combines the former three orchestration/integration tasks. No separate test/doc/recovery tasks or umbrella task.

### Requirements

- [ ] R1. Default spur task create prepares allowed planning sections to the existing ready checklist and runs the deterministic post-check before returning readiness ready. Add --skip-ready for a zero-model title-only backlog capture; never run implementation or author Solution/Testing/Review evidence.
- [ ] R2. Keep standalone CLI orchestration outside low-level writers and locks, using existing AgentService and agent-selection/timeout behavior. HTTP/internal writes remain deterministic. A preparation failure exits nonzero with the original WBS/path, failed stage and exact ready-refinement command; preserve authored work and never silently recreate.
- [ ] R3. Batch default preparation assesses/synthesizes the batch once before any task or parent writes, validates every candidate, and aborts all on invalid output. Host planning performs ready synthesis inline and calls batch-create --skip-ready on its complete batch to avoid duplicate model work; skip does not bypass validation or erase supplied sections.
- [ ] R4. Add small additive readiness output without breaking existing WBS/path/batch-order/envelope fields. Host and subprocess planning record current run-scoped ready-checklist evidence bound to the actual task planning sections; missing or stale evidence never becomes semantic readiness from structural PASS alone.
- [ ] R5. Integrate create/decompose/refine/handoff canonical owners and seeded workflow paths in this task. Successful specification preparation gives the existing ordered execution handoff; failure or opt-out gives one precise preparation action. Real execution prerequisites remain visible and enforced separately.
- [ ] R6. Verify default, skip, missing agent, timeout, invalid model output, retry identity, batch rejection and host no-double-synthesis using fake executors plus source-local dogfood. Update ADR-109 implementation status, CLI/design docs and canonical capability sources; use Superskill lifecycle for adapters. No new dependency, runtime, queue, public noun/verb, automatic feature linking or unrelated board behavior.

### Acceptance Criteria

```gherkin
Feature: Consistent task creation and default implementation readiness

  @core
  Scenario: R4 — Default creation prepares a task and skip-ready captures intent
    Given sufficient project context and an available configured planner
    When spur task create completes without skip-ready
    Then the existing ready-refinement checklist and deterministic post-check both pass before ready success is returned
    And skip-ready invokes no model and leaves a title-only capture at backlog without implementation evidence

  @core
  Scenario: R5 — Preparation failure preserves task identity and a recovery action
    Given a task was saved before its ready preparation failed timed out or was interrupted
    When creation reports the failed preparation
    Then it exits nonzero with the existing WBS path failure stage and exact refinement recovery command
    And it preserves authored content and never silently recreates the task or reports readiness

  @core
  Scenario: R6 — Batch preparation validates all candidates before commit
    Given a batch requiring ready preparation or a host-authored complete batch with skip-ready
    When the batch creation boundary runs
    Then the default path prepares the whole batch once before committing and rejected items cause no task or parent mutations
    And the host-prepared path performs no second model pass and reports preparation as skipped rather than inventing an agent verdict

  @core
  Scenario: R7 — Planning handoff distinguishes specification readiness from execution eligibility
    Given a created batch with run-scoped ready-checklist evidence and declared task dependencies
    When planning finalizes the handoff
    Then it recommends execution only with current successful specification evidence and valid task checks
    And missing stale or failed readiness evidence yields a precise preparation action while unfinished dependencies remain visible to execution gates

  @core
  Scenario: R8 — Shared HTTP and internal task writers remain deterministic
    Given an HTTP or internal caller uses the shared task write service
    When it creates or validates task content
    Then the same deterministic content and serialization rules apply without launching an agent
    And CLI orchestration and host planning reuse existing agent facilities and the canonical ready competency outside file locks
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Read docs/design/task-creation-readiness.md (ADR-109, approved design, not yet shipped). No new dependency, public noun/verb, readiness scoring framework, or implementation during creation. Tests and owning documentation ship with this task. Preserve unrelated edits and use source-local CLI provenance for dogfood.

WHAT/WHY: one preparation experience, built on the first task's deterministic policy and the existing ready competency. Keep single/batch orchestration in packages/app so CLI is thin and low-level TaskService/PlanningWriteService remain deterministic. Do not change the board's standard refine action globally; invoke ready explicitly for creation.

WHERE: apps/cli/src/commands/task.ts; packages/app/src/services/task-service.ts and a task-readiness.ts sibling only if needed to keep shared orchestration out of writers; agent-service.ts through existing runCapture/runTraced, not a new runner; packages/app/src/workflow/idea-handoff.ts; config/workflows/idea-pipeline.yaml and the actual planning call sites; plugins/sp/skills/spur-dev/references/{dev-operations,planning-workflow,cross-cutting}.md, plugins/sp/skills/spec-decomposition/references/decomposition.md, plugins/sp/commands/dev-{idea,plan,refine}.md and spur-cli task references as required by live source discovery. Generated adapters are Superskill-owned. Existing workspace tests cover the changed paths.

FROZEN CLI: add --skip-ready to create and batch-create; add --agent <selector> on both using existing agent selection semantics, with headless omission resolving the configured default. A standalone process cannot execute in its parent host session. Host planning synthesizes inline before invoking the deterministic batch writer with --skip-ready, even for one pre-authored item. --skip-ready bypasses synthesis only: title-only capture stays backlog, a complete supplied batch retains valid todo content. JSON retains ref/wbs/filePath and created/wbs/parentsWired; add readiness: { status: 'ready' | 'skipped' | 'failed', depth: 'ready' } and failure stage/recoveryCommand in existing error details. Existing usage/dedup/collision exits retain their values; preparation failure exits 1. Do not advertise execution eligibility as readiness.

SINGLE FLOW: validate title/links and dedupe before model work, save a backlog capture through TaskService, then prepare that same WBS through the existing ready-refinement competency without --next. Use existing runCapture/runTraced with configured execution budget, inspect the actual task afterward, require successful checklist outcome plus post-check, then promote to todo through the existing lifecycle. Keep command output captured so --json stdout is one document. On missing executor, interruption, timeout or invalid result after creation, return WBS/path and /sp:dev-refine <wbs> --auto --depth ready as recovery; no blind create retry or task deletion. Preserve partial authored sections. Do not accept exit 0 alone as ready evidence.

BATCH FLOW: supplied JSON uses existing taskBatchSchema. Default standalone invocation calls the planner once for assessment and synthesis of the whole batch before entering the allocation boundary, using the same canonical ready checklist on candidate sections. Capture the full JSON array, validate strict schema and every candidate with the shared deterministic validator, preserve input ordering/identity and authored constraints; commit only after all succeed. Rejected model output must not allocate WBS or wire parents. On the host path, decompose already owns synthesis and validates its ready checklist; --skip-ready writes this complete content and returns skipped rather than claiming another agent ran. Keep the existing batch atomicity and no long model call under locks. No per-task nested workflow runs.

EVIDENCE/HANDOFF: use the existing run-scoped idea artifact family: <runId>-idea-ready.json with {runId, depth:'ready', tasks:[{wbs, status:'ready'|'failed'|'skipped', planningDigest, checks:[{id,pass,evidence}]}]}. Checklist IDs are requirements, design, plan, ac, decisions, dependencies, premises. The planning owner writes it after batch WBS mapping/dependency wiring, binding the actual allowed planning-section content plus feature/template/dependencies to a SHA-256 digest using existing digest utilities. Do not include updated_at or execution-owned sections. Handoff recomputes against current tasks and requires every checklist row to pass with nonempty evidence; this is a consistency artifact from synthesis, not a deterministic proof of semantic truth. Existing task checks remain mandatory; finish dependencies at execution time, not by falsifying evidence. If evidence is absent/stale/failed or skip-ready meant unprepared capture, recommend the existing refineall --depth ready command. Preserve one next command, exact run identity and seeded fallback parity. Never use completion-verdict artifacts for preparation.

REUSE/ANTI-PATTERNS: canonical ready prose has one owner; callers invoke it instead of copying a new scoring rubric. No new public noun/verb, no generic planner framework, no weak placeholder fill, no change to feature association policy, no synthetic completion record. CLI names above are fixed; internal function signatures can use existing service/context patterns. This entire creation/handoff seam is one deliverable and must not be split into more tasks.

HANDOFF: requires task 0787 and its deterministic validator/serializer contract. Existing 0782 planning reuse and 0786 canonical-source cleanup land first via dependencies; preserve their behavior. Primary verification is observable command results and no unwanted model calls, not getters. Test all failure boundaries with fake executors and one bounded real source-local smoke on a configured agent; if unavailable, record that limitation distinctly. No unresolved product decision remains.

### Plan

- [ ] 1. Consume the companion task's deterministic contract and add command-level fake-executor regressions for default/skip/failure and output compatibility (R1, R2, R4).
- [ ] 2. Implement single-task ready orchestration, same-WBS recovery and explicit capture mode using existing agent and lifecycle facilities outside locks (R1, R2).
- [ ] 3. Implement prepare-before-commit batch behavior and host-prepared skip path; verify item order, rejection atomicity and zero duplicate synthesis (R3).
- [ ] 4. Update canonical planning/refine/decompose owners and both handoff execution surfaces to produce and consume fresh ready evidence without weakening dependency gates (R4, R5).
- [ ] 5. Exercise missing agent, timeout, malformed output, partial save, stale evidence and retries; run source-local and seeded/bundled smoke checks (R6).
- [ ] 6. Sync CLI/ADR/design docs and capability adapters through their owner, run doc-evolve sync-check and required project gates, and verify the full creation-to-handoff flow (R6).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: F21, consistent task creation and default implementation readiness.
- Decision: docs/00_ADR.md, ADR-109.
- Surface: docs/design/task-creation-readiness.md.
- Discovery evidence: docs/plans/2026-09-06-task-creation-readiness-brainstorm.md.
- Sequence: 0786 → 0787 → 0788; dependency edges are the execution ordering authority.
### History
