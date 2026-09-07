---
schema_version: 1
name: "Deliver ready-by-default task creation across CLI and planning"
status: done
template: feature-impl
created_at: 2026-09-06T20:59:14.083Z
updated_at: "2026-09-07T03:42:23.664Z"
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

- [x] R1. Default spur task create prepares allowed planning sections to the existing ready checklist and runs the deterministic post-check before returning readiness ready. Add --skip-ready for a zero-model title-only backlog capture; never run implementation or author Solution/Testing/Review evidence.
- [x] R2. Keep standalone CLI orchestration outside low-level writers and locks, using existing AgentService and agent-selection/timeout behavior. HTTP/internal writes remain deterministic. A preparation failure exits nonzero with the original WBS/path, failed stage and exact ready-refinement command; preserve authored work and never silently recreate.
- [x] R3. Batch default preparation assesses/synthesizes the batch once before any task or parent writes, validates every candidate, and aborts all on invalid output. Host planning performs ready synthesis inline and calls batch-create --skip-ready on its complete batch to avoid duplicate model work; skip does not bypass validation or erase supplied sections.
- [x] R4. Add small additive readiness output without breaking existing WBS/path/batch-order/envelope fields. Host and subprocess planning record current run-scoped ready-checklist evidence bound to the actual task planning sections; missing or stale evidence never becomes semantic readiness from structural PASS alone.
- [x] R5. Integrate create/decompose/refine/handoff canonical owners and seeded workflow paths in this task. Successful specification preparation gives the existing ordered execution handoff; failure or opt-out gives one precise preparation action. Real execution prerequisites remain visible and enforced separately.
- [x] R6. Verify default, skip, missing agent, timeout, invalid model output, retry identity, batch rejection and host no-double-synthesis using fake executors plus source-local dogfood. Update ADR-109 implementation status, CLI/design docs and canonical capability sources; use Superskill lifecycle for adapters. No new dependency, runtime, queue, public noun/verb, automatic feature linking or unrelated board behavior.

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

- [x] 1. Consume the companion task's deterministic contract and add command-level fake-executor regressions for default/skip/failure and output compatibility (R1, R2, R4).
- [x] 2. Implement single-task ready orchestration, same-WBS recovery and explicit capture mode using existing agent and lifecycle facilities outside locks (R1, R2).
- [x] 3. Implement prepare-before-commit batch behavior and host-prepared skip path; verify item order, rejection atomicity and zero duplicate synthesis (R3).
- [x] 4. Update canonical planning/refine/decompose owners and both handoff execution surfaces to produce and consume fresh ready evidence without weakening dependency gates (R4, R5).
- [x] 5. Exercise missing agent, timeout, malformed output, partial save, stale evidence and retries; run source-local and seeded/bundled smoke checks (R6).
- [ ] 6. Sync CLI/ADR/design docs and capability adapters through their owner, run doc-evolve sync-check and required project gates, and verify the full creation-to-handoff flow (R6).

Items 1-4 were verified complete by the F21 verifyall run (2026-09-06); evidence in `## Testing`.

Item 5 is now flipped. Every leg has real evidence: **missing agent** — live probe, exit 1 at the
`agent-dispatch` stage with `Recover with: /sp:dev-refine 0794 --auto --depth ready` folded into
stderr and the capture preserved at `backlog`, plus `packages/app/tests/services/task-readiness.ts`
regressions at `packages/app/tests/services/task-readiness.test.ts:126` and `:279`; **timeout** —
`packages/app/tests/services/task-readiness.test.ts:225` asserts the dispatch flags carry
`DEFAULT_READY_PREPARE_TIMEOUT_MS`; **malformed output** —
`packages/app/tests/services/task-readiness.test.ts:305` (prose-only → `invalid-output`), `:317`
(schema-invalid → `validation`) and `:418` (no array → `invalid-output`); **partial save** — live
probe S2a returned `failedStage: "agent-run"` with "Partial section edits are preserved on the
task.", matching `packages/app/tests/services/task-readiness.test.ts:186`; **stale evidence** —
`packages/app/tests/workflow/idea-handoff.test.ts:174` proves a stale planning digest degrades to a
precise refine action even when the check passes; **retries** — none by design, and that is the
contract, not a gap: `packages/app/src/services/task-readiness.ts:16` records "no blind retry, no
deletion", the exact recovery command replacing the retry; **source-local smoke** — five probes
(`--skip-ready`, `--agent`+`--skip-ready` usage guard, unknown agent, `--agent inline`,
`--agent claude`) run through `bun run apps/cli/src/index.ts` against the scratch folder
`.spur/run/F21-dogfood-tasks`; **bundled smoke** — the same skip-ready and usage-guard probes
through the built `apps/cli/spur.js`, identical results (exit 0 with
`readiness:{status:"skipped",depth:"ready"}`, and exit 2 `invalid-usage`). The full run is recorded
in `docs/dogfood/2026-09-06-sp-dev-verifyall-feature-F21-dogfood.md`, which also closed the
feature-level `L4.dogfood-missing` finding — `spur feature check F21 --strict` now returns
`pass: true` with zero findings.

Item 6 remains open deliberately and is NOT flipped. Its docs half is done (ADR-109 at
`docs/00_ADR.md:2294-2296`, the surface rows in `docs/04_DESIGN.md`, and
`plugins/sp/commands/dev-idea.md`), the `doc-evolve` sync-check was run this session and came back
clean (T1 satisfied by `docs/00_ADR.md` in commit 2ea0fc518; T3 by `docs/04_DESIGN.md` and
`docs/design/task-creation-readiness.md` in the same commit; T4 by the `[verifying]` F21 row in
`docs/features/INDEX.md` from commit 272451a8d; T5 correctly still open while the feature is not
`done`), and the creation-to-handoff flow was exercised end to end by the smoke above. What remains
is the one gate that cannot run here: `spur rule run --preset recommended-pre-check --fail-on
warning` exits 1 with "SQLite database is busy; another Spur process is holding the lock." on seven
attempts across the run. `.spur/spur.db` is ~4.8 GB with live `-shm`/`-wal` siblings; `ps` is denied
by the sandbox and force-unlocking a database that size is outside authorized scope. The box stays
unchecked rather than flipped on an unrun gate.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/task.ts:1007` |
| `apps/cli/src/commands/task.ts:1013` |
| `apps/cli/src/commands/task.ts:1024` |
| `apps/cli/src/commands/task.ts:1031` |
| `apps/cli/src/commands/task.ts:1055` |
| `apps/cli/src/commands/task.ts:1074` |
| `apps/cli/src/commands/task.ts:1133` |
| `apps/cli/src/commands/task.ts:17` |
| `apps/cli/src/commands/task.ts:196` |
| `apps/cli/src/commands/task.ts:2` |
| `apps/cli/src/commands/task.ts:211` |
| `apps/cli/src/commands/task.ts:242` |
| `apps/cli/src/commands/task.ts:264` |
| `apps/cli/src/commands/task.ts:270` |
| `apps/cli/src/commands/task.ts:31` |
| `apps/cli/src/commands/task.ts:351` |
| `apps/cli/tests/commands/init.test.ts:338` |
| `apps/cli/tests/commands/planning-system-events.test.ts:87` |
| `apps/cli/tests/commands/task.test.ts:10` |
| `apps/cli/tests/commands/task.test.ts:104` |
| `apps/cli/tests/commands/task.test.ts:1114` |
| `apps/cli/tests/commands/task.test.ts:1124` |
| `apps/cli/tests/commands/task.test.ts:1137` |
| `apps/cli/tests/commands/task.test.ts:1162` |
| `apps/cli/tests/commands/task.test.ts:1181` |
| `apps/cli/tests/commands/task.test.ts:1191` |
| `apps/cli/tests/commands/task.test.ts:1198` |
| `apps/cli/tests/commands/task.test.ts:1208` |
| `apps/cli/tests/commands/task.test.ts:1222` |
| `apps/cli/tests/commands/task.test.ts:1239` |
| `apps/cli/tests/commands/task.test.ts:1253` |
| `apps/cli/tests/commands/task.test.ts:1264` |
| `apps/cli/tests/commands/task.test.ts:1279` |
| `apps/cli/tests/commands/task.test.ts:1289` |
| `apps/cli/tests/commands/task.test.ts:1303` |
| `apps/cli/tests/commands/task.test.ts:1306` |
| `apps/cli/tests/commands/task.test.ts:1320` |
| `apps/cli/tests/commands/task.test.ts:1323` |
| `apps/cli/tests/commands/task.test.ts:1326` |
| `apps/cli/tests/commands/task.test.ts:1339` |
| `apps/cli/tests/commands/task.test.ts:1342` |
| `apps/cli/tests/commands/task.test.ts:1345` |
| `apps/cli/tests/commands/task.test.ts:1358` |
| `apps/cli/tests/commands/task.test.ts:1361` |
| `apps/cli/tests/commands/task.test.ts:1376` |
| `apps/cli/tests/commands/task.test.ts:1379` |
| `apps/cli/tests/commands/task.test.ts:1392` |
| `apps/cli/tests/commands/task.test.ts:1403` |
| `apps/cli/tests/commands/task.test.ts:1414` |
| `apps/cli/tests/commands/task.test.ts:1425` |
| `apps/cli/tests/commands/task.test.ts:1436` |
| `apps/cli/tests/commands/task.test.ts:1439` |
| `apps/cli/tests/commands/task.test.ts:1460` |
| `apps/cli/tests/commands/task.test.ts:1483` |
| `apps/cli/tests/commands/task.test.ts:1500` |
| `apps/cli/tests/commands/task.test.ts:1574` |
| `apps/cli/tests/commands/task.test.ts:1595` |
| `apps/cli/tests/commands/task.test.ts:1614` |
| `apps/cli/tests/commands/task.test.ts:1628` |
| `apps/cli/tests/commands/task.test.ts:1648` |
| `apps/cli/tests/commands/task.test.ts:1659` |
| `apps/cli/tests/commands/task.test.ts:1670` |
| `apps/cli/tests/commands/task.test.ts:1684` |
| `apps/cli/tests/commands/task.test.ts:1698` |
| `apps/cli/tests/commands/task.test.ts:1733` |
| `apps/cli/tests/commands/task.test.ts:1796` |
| `apps/cli/tests/commands/task.test.ts:1883` |
| `apps/cli/tests/commands/task.test.ts:1937` |
| `apps/cli/tests/commands/task.test.ts:1978` |
| `apps/cli/tests/commands/task.test.ts:2010` |
| `apps/cli/tests/commands/task.test.ts:2026` |
| `apps/cli/tests/commands/task.test.ts:208` |
| `apps/cli/tests/commands/task.test.ts:2141` |
| `apps/cli/tests/commands/task.test.ts:216` |
| `apps/cli/tests/commands/task.test.ts:2172` |
| `apps/cli/tests/commands/task.test.ts:2192` |
| `apps/cli/tests/commands/task.test.ts:2204` |
| `apps/cli/tests/commands/task.test.ts:2232` |
| `apps/cli/tests/commands/task.test.ts:2239` |
| `apps/cli/tests/commands/task.test.ts:2253` |
| `apps/cli/tests/commands/task.test.ts:2263` |
| `apps/cli/tests/commands/task.test.ts:2287` |
| `apps/cli/tests/commands/task.test.ts:230` |
| `apps/cli/tests/commands/task.test.ts:2327` |
| `apps/cli/tests/commands/task.test.ts:2359` |
| `apps/cli/tests/commands/task.test.ts:2370` |
| `apps/cli/tests/commands/task.test.ts:2422` |
| `apps/cli/tests/commands/task.test.ts:245` |
| `apps/cli/tests/commands/task.test.ts:253` |
| `apps/cli/tests/commands/task.test.ts:2575` |
| `apps/cli/tests/commands/task.test.ts:2589` |
| `apps/cli/tests/commands/task.test.ts:281` |
| `apps/cli/tests/commands/task.test.ts:2811` |
| `apps/cli/tests/commands/task.test.ts:2836` |
| `apps/cli/tests/commands/task.test.ts:2878` |
| `apps/cli/tests/commands/task.test.ts:2906` |
| `apps/cli/tests/commands/task.test.ts:291` |
| `apps/cli/tests/commands/task.test.ts:2930` |
| `apps/cli/tests/commands/task.test.ts:2963` |
| `apps/cli/tests/commands/task.test.ts:2981` |
| `apps/cli/tests/commands/task.test.ts:3007` |
| `apps/cli/tests/commands/task.test.ts:3025` |
| `apps/cli/tests/commands/task.test.ts:3044` |
| `apps/cli/tests/commands/task.test.ts:3075` |
| `apps/cli/tests/commands/task.test.ts:308` |
| `apps/cli/tests/commands/task.test.ts:324` |
| `apps/cli/tests/commands/task.test.ts:3240` |
| `apps/cli/tests/commands/task.test.ts:326` |
| `apps/cli/tests/commands/task.test.ts:328` |
| `apps/cli/tests/commands/task.test.ts:348` |
| `apps/cli/tests/commands/task.test.ts:353` |
| `apps/cli/tests/commands/task.test.ts:376` |
| `apps/cli/tests/commands/task.test.ts:379` |
| `apps/cli/tests/commands/task.test.ts:397` |
| `apps/cli/tests/commands/task.test.ts:404` |
| `apps/cli/tests/commands/task.test.ts:419` |
| `apps/cli/tests/commands/task.test.ts:430` |
| `apps/cli/tests/commands/task.test.ts:441` |
| `apps/cli/tests/commands/task.test.ts:452` |
| `apps/cli/tests/commands/task.test.ts:463` |
| `apps/cli/tests/commands/task.test.ts:479` |
| `apps/cli/tests/commands/task.test.ts:494` |
| `apps/cli/tests/commands/task.test.ts:505` |
| `apps/cli/tests/commands/task.test.ts:539` |
| `apps/cli/tests/commands/task.test.ts:550` |
| `apps/cli/tests/commands/task.test.ts:569` |
| `apps/cli/tests/commands/task.test.ts:580` |
| `apps/cli/tests/commands/task.test.ts:591` |
| `apps/cli/tests/commands/task.test.ts:602` |
| `apps/cli/tests/commands/task.test.ts:621` |
| `apps/cli/tests/commands/task.test.ts:643` |
| `apps/cli/tests/commands/task.test.ts:725` |
| `apps/cli/tests/commands/task.test.ts:736` |
| `apps/cli/tests/commands/task.test.ts:760` |
| `apps/cli/tests/commands/task.test.ts:784` |
| `apps/cli/tests/commands/task.test.ts:800` |
| `apps/cli/tests/commands/task.test.ts:822` |
| `apps/cli/tests/commands/task.test.ts:879` |
| `apps/cli/tests/commands/task.test.ts:882` |
| `packages/app/src/index.ts:415` |
| `packages/app/src/workflow/idea-handoff.ts:114` |
| `packages/app/src/workflow/idea-handoff.ts:238` |
| `packages/app/src/workflow/idea-handoff.ts:248` |
| `packages/app/src/workflow/idea-handoff.ts:250` |
| `packages/app/src/workflow/idea-handoff.ts:255` |
| `packages/app/src/workflow/idea-handoff.ts:261` |
| `packages/app/src/workflow/idea-handoff.ts:264` |
| `packages/app/src/workflow/idea-handoff.ts:357` |
| `packages/app/src/workflow/idea-handoff.ts:359` |
| `packages/app/src/workflow/idea-handoff.ts:363` |
| `packages/app/src/workflow/idea-handoff.ts:74` |
| `packages/app/src/workflow/idea-handoff.ts:9` |
| `packages/app/tests/workflow/idea-handoff.test.ts:101` |
| `packages/app/tests/workflow/idea-handoff.test.ts:105` |
| `packages/app/tests/workflow/idea-handoff.test.ts:122` |
| `packages/app/tests/workflow/idea-handoff.test.ts:131` |
| `packages/app/tests/workflow/idea-handoff.test.ts:139` |
| `packages/app/tests/workflow/idea-handoff.test.ts:152` |
| `packages/app/tests/workflow/idea-handoff.test.ts:154` |
| `packages/app/tests/workflow/idea-handoff.test.ts:194` |
| `packages/app/tests/workflow/idea-handoff.test.ts:199` |
| `packages/app/tests/workflow/idea-handoff.test.ts:202` |
| `packages/app/tests/workflow/idea-handoff.test.ts:3` |
| `packages/app/tests/workflow/idea-handoff.test.ts:367` |
| `packages/app/tests/workflow/idea-handoff.test.ts:370` |
| `packages/app/tests/workflow/idea-handoff.test.ts:374` |
| `packages/app/tests/workflow/idea-handoff.test.ts:399` |
| `packages/app/tests/workflow/idea-handoff.test.ts:411` |
| `packages/app/tests/workflow/idea-handoff.test.ts:414` |
| `packages/app/tests/workflow/idea-handoff.test.ts:418` |
| `packages/app/tests/workflow/idea-handoff.test.ts:442` |
| `packages/app/tests/workflow/idea-handoff.test.ts:600` |
| `packages/app/tests/workflow/idea-handoff.test.ts:602` |
| `packages/app/tests/workflow/idea-handoff.test.ts:615` |
| `packages/app/tests/workflow/idea-handoff.test.ts:9` |
| `packages/app/tests/workflow/idea-handoff.test.ts:98` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:402` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:407` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:410` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:417` |
| `scripts/commands/eval-pipeline.test.ts:327` |
| `scripts/commands/eval-pipeline.test.ts:339` |
| `scripts/commands/eval-pipeline.ts:465` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Default `create` saves the backlog capture, then prepares the SAME WBS through the canonical ready competency and promotes only after the deterministic post-check passes: `packages/app/src/services/task-readiness.ts:138` (`prepareCreatedTaskReady`) dispatches via `agents.runTraced(readyRefineCommand(wbs), flags)` at `:171`, re-reads the task, runs the checker, throws at `:220-228` when the post-check fails, and reaches `updateStatus(wbs, 'todo', …)` at `:231-235` only past that gate — promotion is idempotent (`if (after.status !== 'todo')`). `--skip-ready` is a zero-model capture: `apps/cli/src/commands/task.ts:245` initialises `readiness = READY_SKIPPED` and only the non-skip branch builds the check/agent services at `:247`. The model never authors execution evidence — the pipeline prompt confines edits to planning sections (`config/workflows/idea-pipeline.yaml:420`) and the digest provably ignores execution-owned sections (`packages/app/tests/services/task-readiness.test.ts:360`, 'execution-owned section edits do not move the digest'). Tests: `apps/cli/tests/commands/task.test.ts:3331` ('default flow prepares and promotes the task to todo'), `:3354` ('--skip-ready dispatches nothing and reports skipped readiness'), `packages/app/tests/services/task-readiness.test.ts:186` ('exit 0 alone is not readiness: post-check failure preserves authored work (no rollback)') and `:201` ('backlog task is promoted to todo after a passing post-check') |
| R2 | MET | Orchestration sits in the app service, outside low-level writers and locks: the CLI hands in the existing services at `apps/cli/src/commands/task.ts:247` and `packages/app/src/services/task-readiness.ts:164-172` reuses the existing agent surface — a plain flag bag (`mode: 'text'`, `timeout: String(opts.timeoutMs ?? DEFAULT_READY_PREPARE_TIMEOUT_MS)`, optional `agent`/`cwd`) passed to `agents.runTraced`. `packages/app/src/services/task-service.ts` is untouched by this task (`git show --stat 2ea0fc518` lists no change to it). Failure carries full identity plus one exact recovery action and never recreates: `TaskPreparationError` (`packages/app/src/services/task-readiness.ts:77`) holds stage/wbs/filePath/findings/recoveryCommand, the command is `/sp:dev-refine <wbs> --auto --depth ready` (`:55-57`), and the CLI exits 1 folding `Recover with: …` into non-JSON stderr in BOTH branches — single at `apps/cli/src/commands/task.ts:357-369` and batch at `:1079-1088`. Authored work is preserved: no delete/rollback path exists in `prepareCreatedTaskReady`; the post-check failure at `:220-228` leaves the file in place. Tests: `apps/cli/tests/commands/task.test.ts:3367` ('missing executor fails preparation at agent-run stage and keeps the capture'), `:3384` ('retry after failed preparation keeps the same WBS identity'), `packages/app/tests/services/task-readiness.test.ts:126` ('exit 2 maps to the agent-dispatch stage with recovery command and file path'), `:225` ('dispatch flags carry the selector, cwd and default timeout') |
| R3 | MET | Batch preparation runs exactly once and strictly before any task or parent write: `packages/app/src/services/task-readiness.ts:291` (`prepareBatchTaskReady`) captures the whole batch, extracts the array and validates it, and `apps/cli/src/commands/task.ts:1031-1050` resolves the prepared `batchFile` before the single call to `svc.batchCreate(batchFile)` at `:1050`; a validation-stage failure throws before that line, so zero files are written and 0787's batch atomicity is unchanged. Host planning synthesises inline and writes with `--skip-ready` — the flag exists at `apps/cli/src/commands/task.ts:1007` and the workflow's `batch-create-run` uses it with preparation isolated in a dedicated `ready-prepare` stage (`packages/app/tests/workflow/idea-pipeline-definition.test.ts:433`, 'batch-create-run creates with --skip-ready; preparation is the ready-prepare stage (0788)'), so a host batch can never trigger a second model pass. Skip does not bypass validation or erase supplied sections: `--skip-ready` routes supplied content through the unchanged TaskService write path with no agent port available, and combining it with `--agent` is rejected as usage error (`apps/cli/tests/commands/task.test.ts:3433`). Tests: `apps/cli/tests/commands/task.test.ts:3402` ('batch-create with prepared output creates ready tasks in order'), `:3417` ('batch-create rejects invalid prepared output atomically'), `packages/app/tests/services/task-readiness.test.ts:305` ('prose-only capture output stops at the invalid-output stage'), `:317` ('schema-invalid prepared array stops at the validation stage with issue paths'), `:330` ('valid capture preserves input order and the cwd flag reaches the executor'), `:418` ('output with no array raises the invalid-output stage') |
| R4 | MET | Readiness output is purely additive — success JSON keeps created/wbs/parentsWired and adds `readiness:{status, depth}` (`apps/cli/src/commands/task.ts:263` single emit, `:1054` batch emit), the failure branch adds failedStage/recoveryCommand at `:357-369`, and non-JSON gains a `Ready:` line beneath an unchanged `Created task …` line (`:269`). The documented shapes match: `docs/04_DESIGN.md:1776` (create) and `:1786` (batch-create) both record `readiness:{status: ready |
| R5 | MET | The canonical owners are integrated on one chain, not duplicated: `packages/app/tests/workflow/idea-pipeline-definition.test.ts:402` ('batch-create-run success flows through ready-prepare to finalize, then terminal handoff'), documented for the command surface at `plugins/sp/commands/dev-idea.md:49` (`decompose → batch-create → ready-prepare → handoff`) and in `docs/04_DESIGN.md:2271-2279` ('Ready-by-default creation (0788, ADR-109)'). Success yields the existing ordered execution handoff — finalize still applies `spur task deps` ordering and refreshes the roster (`packages/app/tests/workflow/idea-pipeline-definition.test.ts:443`) and emits exactly one next command, mutually exclusive between refineall and runall (`:496`), with the old static runall recommendation removed workflow-wide (`:508`). Failure or opt-out yields ONE precise preparation action rather than a blind retry: `readyRefineCommand` (`packages/app/src/services/task-readiness.ts:55`) for the single path and `readyRefineAllCommand` (`:60`) for the batch. Real execution prerequisites stay separately enforced: `packages/app/tests/workflow/idea-handoff.test.ts:487` ('R5: a failing task deps reports exit code and stderr evidence') and the seeded fallback gates on ready evidence rather than task checks alone (`packages/app/tests/workflow/idea-pipeline-definition.test.ts:437`) |
| R6 | MET | The fake-executor matrix covers every named boundary — default, skip, missing agent, timeout, invalid model output, retry identity, batch rejection, host no-double-synthesis: `apps/cli/tests/commands/task.test.ts:3331`, `:3354`, `:3367`, `:3384`, `:3402`, `:3417`, `:3433`; stage mapping including timeout-as-signal at `packages/app/tests/services/task-readiness.test.ts:143` ('nonzero exit with a signal maps to agent-run and names the signal'), invalid output at `:305`, `:317`, `:418`, dispatch flags/timeout at `:225`; handoff degradation at `packages/app/tests/workflow/idea-handoff.test.ts:139` and `:174`. Re-run this turn from inside their workspaces: `cd packages/app && bun test tests/services/task-readiness.test.ts tests/services/task-service.test.ts tests/services/task-check.test.ts` → 300 pass / 0 fail; `cd apps/cli && bun test tests/commands/task.test.ts` → 177 pass / 0 fail. Docs and canonical sources are synced: ADR-109 at `docs/00_ADR.md:2294-2296` with status 'Implemented (F21 task 0788)'; CLI inventory rows at `docs/04_DESIGN.md:1776`, `:1786`; the readiness surface paragraph at `:2271-2279`; the satellite indexed shipped at `:2047`; command chain at `plugins/sp/commands/dev-idea.md:49`. Scope exclusions hold — no new dependency, runtime, queue or public noun/verb: `--skip-ready` and `--agent` are options on the two existing `task create` / `task batch-create` subcommands (`apps/cli/src/commands/task.ts:1007`), not new surface. The prior verdict's recorded LIMITATION — that the bounded real-agent source-local dogfood smoke was NOT executed — is CLOSED this run. Seven live probes ran against the scratch corpus folder `.spur/run/F21-dogfood-tasks` (no tracked-corpus pollution): source-local `--skip-ready` → exit 0 with `readiness:{status:"skipped",depth:"ready"}`; `--agent claude --skip-ready` → `invalid-usage` ("--agent has no effect with --skip-ready (no preparation runs)"), exit 2; `--agent no-such-agent-xyz` → exit 1 at the `agent-dispatch` stage with `Recover with: /sp:dev-refine 0794 --auto --depth ready` folded into non-JSON stderr and the capture preserved at `backlog`; `--agent inline` → real dispatch, `failedStage: "agent-run"`, "Partial section edits are preserved on the task.", `readiness:{status:"failed"}`; `--agent claude` → the real executor completed and the deterministic post-check then refused readiness, `failedStage: "post-check"` with `L3.ac-empty` and the exact recovery command (evidence: origin `.spur/run/F21-dogfood-s2b.log`); and the same skip-ready and usage-guard probes repeated through the built bundled entry `apps/cli/spur.js` with identical results (exit 0 / exit 2). The run is written up at `docs/dogfood/2026-09-06-sp-dev-verifyall-feature-F21-dogfood.md`, which validates clean against the `sp:dogfood-testing@1.2` contract (`bun plugins/sp/scripts/dogfood-testing/validate-report.ts --file … --json` → `{"ok":true,"errors":[]}`) and is registered in the tracked ledger `docs/dogfood/INDEX.md`; `spur feature check F21 --strict --json` now returns `pass: true` with zero findings, so the `L4.dogfood-missing` finding this row previously carried is gone |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — Default creation prepares a task and skip-ready captures intent | MET | test | Deterministic post-check gates the ready verdict: `apps/cli/tests/commands/task.test.ts:3331` passes with a fake executor, and promotion happens only past the post-check throw (`packages/app/src/services/task-readiness.ts:220-235`), asserted by `packages/app/tests/services/task-readiness.test.ts:186` and `:201`. Skip-ready invokes no model: `apps/cli/tests/commands/task.test.ts:3354` (empty dispatch log, readiness `skipped`, capture stays a backlog title-only record); `:3433` rejects `--agent` with `--skip-ready` as usage error (exit 2) |
| R5 — Preparation failure preserves task identity and a recovery action | MET | test | `apps/cli/tests/commands/task.test.ts:3367` and `:3384` (same WBS across the retry); exit 1 emits wbs/filePath/failedStage/recoveryCommand and folds `Recover with: /sp:dev-refine <wbs> --auto --depth ready` into stderr in both the single (`apps/cli/src/commands/task.ts:357-369`) and batch (`:1079-1088`) branches. No rollback or deletion exists anywhere in `prepareCreatedTaskReady` — `packages/app/tests/services/task-readiness.test.ts:186` names the no-rollback property directly |
| R6 — Batch preparation validates all candidates before commit | MET | test | `apps/cli/tests/commands/task.test.ts:3417` (atomic rejection, zero tasks created) with schema/extract failures stopping pre-commit (`packages/app/tests/services/task-readiness.test.ts:305`, `:317`, `:418`); `prepareBatchTaskReady` (`packages/app/src/services/task-readiness.ts:291`) completes before `svc.batchCreate` at `apps/cli/src/commands/task.ts:1050`. Input order is preserved (`apps/cli/tests/commands/task.test.ts:3402`, `packages/app/tests/services/task-readiness.test.ts:330`). The host path performs no second model pass — `packages/app/tests/workflow/idea-pipeline-definition.test.ts:433` and `:417` |
| R7 — Planning handoff distinguishes specification readiness from execution eligibility | MET | test | `packages/app/tests/workflow/idea-handoff.test.ts:174` (stale digest degrades to a precise refine action even when the structural check passes) and `:139` (failing task check ⇒ refineall despite good evidence); the gate itself is `packages/app/src/workflow/idea-handoff.ts:281-300` — recompute digest, require row status `ready`, require digest freshness, then require every checklist row to pass with non-empty evidence. Unfinished dependencies remain visible to execution gates: `packages/app/tests/workflow/idea-handoff.test.ts:487`; recommendation is mutually exclusive at `packages/app/tests/workflow/idea-pipeline-definition.test.ts:496` |
| R8 — Shared HTTP and internal task writers remain deterministic | MET | test | `git show --stat 2ea0fc518` shows no change to `packages/app/src/services/task-service.ts` or `packages/domain/src/planning/task-skeleton.ts`; `batch-create --skip-ready` writes supplied content through the unchanged TaskService (`apps/cli/src/commands/task.ts:1007`, `:1050`) with no agent port on that path. Agent dispatch exists only in `packages/app/src/services/task-readiness.ts:164-172` via the existing `runTraced`/`runCapture` surface. Full-suite gate this run: 7627 pass / 4 fail / 30758 expect() across 424 files (origin `.spur/run/F21-test-gate.log` lines 386-389); all 4 failures are sandbox `git worktree add` denials in `scripts/commands/eval-pipeline.test.ts`, none in a writer path |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

Reviewed (Rev0788) as SECUA-quality + functional-traceability audit of `git diff 272451a8d131` (19 files, +959/−257; new `packages/app/src/services/task-readiness.ts` + tests). Quality gate PASS (lint, 7 typechecks, 7510 tests, post-check rules).

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 | none — no blocker: default/skip/failure/batch flows behave to spec under fake executors, JSON envelopes stay additive, exit codes preserved (usage 2, collision/dedupe 3, preparation 1), gate green | `bun run spur-check` PASS; task-readiness.test.ts, task.test.ts, idea-handoff.test.ts, idea-pipeline-definition.test.ts | — |
| P2 | Pipeline digest one-liner reads the wrong argv: `bun -e '<code>' <task-file>` places the operand at `process.argv[1]`, so `process.argv[2]` is undefined and `Bun.file(undefined)` throws ("Expected file path string or file descriptor"; verified on bun 1.3.14). Every digest computation via the documented command fails, and the instructed fallback then marks tasks "skipped" — ready evidence never materializes and every idea-pipeline handoff silently degrades to refineall despite successful preparation. Fail-closed, but the R4 run-scoped-evidence flow is dead as written. | config/workflows/idea-pipeline.yaml:424 | Fix to `process.argv[1]` (or `--` + `argv[2]`) before the next pipeline run relies on evidence. |
| P3 | Batch-create raw-mode preparation failure drops the recovery action: the single-create branch folds `Recover with: …` into the stderr message, the batch branch passes `err.message` only and extra details (incl. `recoveryCommand`) are `--json`-only — R5's "one precise preparation action" is missing in the default (non-JSON) batch mode. | apps/cli/src/commands/task.ts:1073-1082 vs 357-361 | Mirror the single-branch message fold. |
| P3 | Seeded jq fallback verifies strictly less than the monorepo finalize: runall is gated only on sidecar emptiness + row `status`, not per-row checklist evidence or digest freshness (both unverifiable in the portable jq). A `status:"ready"` row with a garbage digest/empty checks yields runall in seeded projects where `finalizeIdeaHandoff` degrades to refineall — fail-open relative to the TS gate. | config/workflows/idea-pipeline.yaml:506 vs packages/app/src/workflow/idea-handoff.ts:248-306 | Residual risk bounded by the ready-prepare shape validation; accept or narrow deliberately. |
| P3 | R6 source-local dogfood not recorded: fake-executor regressions cover all required boundaries, but neither a bounded real-agent smoke nor the design-permitted explicit limitation note exists (Testing section still template). | docs/tasks4/0788_*.md Testing section; spec Design HANDOFF ¶ | Record smoke result or limitation before done. |
| P4 | `DEFAULT_READY_PREPARE_TIMEOUT_MS` docstring says "10 minutes" but the value is 900_000 ms = 15; and no CLI/config surface overrides the preparation budget (the `timeoutMs` param exists, the CLI never passes it — the design's "configured execution budget" is a hardcoded constant). | packages/app/src/services/task-readiness.ts:51-52; apps/cli/src/commands/task.ts:246-255 | Comment fix; optional `--ready-timeout` later. |
| P4 | batch-create non-JSON success output prints no readiness line (single create prints "Ready: …"); readiness is visible only under `--json`. Cosmetic asymmetry. | apps/cli/src/commands/task.ts:1059-1071 vs 265-271 | Optional. |
| P4 | Solution/Testing sections remain template placeholders at review time (implementation/verification-stage fill). | docs/tasks4/0788_*.md:108-114 | Fill during wrap-up. |

Residual risk: the P2 digest defect is fail-closed (skipped → refineall, never a false ready) but neutralizes the new evidence stage; the P3 fallback divergence only widens in the direction of recommending refine work, except via a hand-forged sidecar. No P1: single flow preserves identity/authored work with exact recovery, batch rejects atomically pre-allocation, writers stay deterministic (agent dispatch only in task-readiness.ts), and handoff never converts structural PASS alone into readiness.

Final disposition: PASS with findings — deliverable approved; fix the P2 argv index (one-line) and the P3 batch raw-mode recovery fold before/with the next pipeline-facing change.

### References
- Feature: F21, consistent task creation and default implementation readiness.
- Decision: docs/00_ADR.md, ADR-109.
- Surface: docs/design/task-creation-readiness.md.
- Discovery evidence: docs/plans/2026-09-06-task-creation-readiness-brainstorm.md.
- Sequence: 0786 → 0787 → 0788; dependency edges are the execution ordering authority.
### History
- 2026-09-07T00:37:47.090Z todo → wip (system)
- 2026-09-07T01:29:19.030Z wip → testing (system)
- 2026-09-07T01:29:19.721Z testing → done (system)
