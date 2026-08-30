---
schema_version: 1
name: "Upgrade task-pipeline precheck for deterministic low-latency execution"
status: todo
template: issue
created_at: 2026-08-30T19:39:38.243Z
updated_at: "2026-08-30T19:47:59.192Z"
feature_id: D6
priority: P1
dependencies: ["0454", "0487", "0608", "0682", "0683", "0706"]
ac_numbering: task-local
ac_altitude: task-local
---

## 0723. Upgrade task-pipeline precheck for deterministic low-latency execution

### Background
Recent task-pipeline runs pay an unconditional executor doctor probe before any implementation work,
even when `/sp:dev-run` is explicitly using the interactive `--agent inline` surface. The inline
driver still executes host-side workflow actions, so the selector does not bypass `doctor.probe`.
Large tasks can then trigger a second `spur agent doctor` from `task-size-precheck.ts`.

Current-source measurements on 2026-08-30 put `spur task check` at 0.36–0.48 s, the count-only size
check at about 0.25 s, and a concrete single-executor doctor at about 0.4 s. A persisted task-pipeline
trace for run `inline-20260821-083900-0614` recorded 1.702 s in `doctor.probe`, 575 ms in auto feature
sync, and 268 ms in size precheck before implementation. Doctor is not the only possible source of a
long stall, but it is redundant, sometimes duplicated, and cannot prove authentication or quota.

An operator-approved config-only bypass has removed both precheck doctor call sites from
`config/workflows/task-pipeline.yaml` so task work can continue. This task turns that emergency edit
into the permanent, contract-aligned task-pipeline design and proves the released/installed artifact
uses it.
### Requirements
- [ ] **R1.** Make task-pipeline precheck deterministic and doctor-free on inline, named, and headless
      execution surfaces. No precheck action or size check may invoke `spur agent doctor`; executor
      liveness, routing, and native capability attestation remain fail-closed at the existing
      `agent.run` dispatch boundary.
- [ ] **R2.** Preserve readiness and size safety without a new public CLI surface: run the existing
      `spur task check <wbs>` exactly once on the successful precheck path, raise and keep the default
      ceiling at ten Requirements and sixteen Plan items, and make a missing or failed size checker fail closed.
      An explicit raised size limit accepts the larger task; it does not add a second executor-tier
      resolver.
- [ ] **R3.** Keep auto-profile feature reactivation and dirty-tree visibility, but remove hidden or
      duplicate work: reuse the existing bounded feature-sync owner where compatible, surface a
      failed reactivation instead of swallowing it, and ensure each deterministic precheck operation
      executes at most once per run.
- [ ] **R4.** Reconcile every coupled contract in the same change: task-pipeline resilience and
      lifecycle tests, inline-driver fixtures, workflow composition baseline/ownership docs,
      task-pipeline design text, size-precheck tests and drift inventory, while preserving
      `doctor.probe` for workflows such as idea-pipeline that still intentionally use it.
- [ ] **R5.** Prove and activate the upgrade: capture before/after task-pipeline traces, validate and
      dry-run the workflow, pass targeted and full repository gates, rebuild the bundled CLI, release
      and reinstall Spur plus plugin `sp` through the governed surfaces, then verify from a fresh
      coding-agent session that a canary precheck emits no doctor action and reaches implementation.
### Acceptance Criteria
```gherkin
Feature: Deterministic low-latency task-pipeline precheck

  @core
  Scenario: R1 — Inline execution performs no doctor preflight
    Given a valid todo task and an interactive task-pipeline run with --agent inline
    When precheck completes
    Then no doctor.probe action is entered
    And no child command invokes spur agent doctor
    And executor usability and capabilities are checked only when agent.run resolves the stage

  @core
  Scenario: R2 — Readiness and size gates remain fail closed
    Given a malformed task, a task above ten Requirements or sixteen Plan items, or an unavailable size-check owner
    When task-pipeline evaluates precheck
    Then the run reaches the failed terminal before implementation
    And a valid task within the doubled ceiling runs spur task check exactly once and may enter implementation

  @core
  Scenario: R3 — Auto feature reactivation is bounded and observable
    Given a todo task linked to a completed feature and profile auto
    When precheck reactivates the feature
    Then the existing bounded feature-sync path runs at most once
    And a real reactivation failure is reported and blocks implementation
    And dirty-tree diagnostics remain advisory

  @core
  Scenario: R4 — Workflow contracts describe the shipped graph
    Given the doctor-free task-pipeline definition
    When workflow, composition, lifecycle, resilience, inline-driver, and drift tests run
    Then every assertion and baseline entry matches the new precheck action order and semantics
    And idea-pipeline doctor behavior remains covered and unchanged

  @core
  Scenario: R5 — Installed fresh session uses the upgraded workflow
    Given the source-local gates and before-after trace comparison pass
    When the bundled Spur release and plugin sp are installed and the coding agent starts a new session
    Then version and artifact provenance identify the new build
    And a canary task-pipeline precheck contains no doctor action or doctor subprocess
    And the canary reaches implementation without a precheck regression
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-08-30T19:47:58.795Z

#### Q&A entry — 2026-08-30

**Operator decision:** Double the task-pipeline size ceiling because the original five-Requirement /
eight-Plan-item defaults repeatedly blocked otherwise valid implementation tasks. The temporary
workflow and permanent upgrade therefore use ten Requirements and sixteen Plan items. This changes
the default boundary only; per-run overrides remain available and task readiness still fails closed.
### Design
Use the existing task-pipeline state machine; do not add a parallel workflow or public command.

1. Permanently remove `doctor.probe` from task-pipeline precheck and remove the `--executor` path
   from the task-size script. Keep the doctor built-in registered because idea-pipeline still owns an
   intentional executor-election preflight.
2. Keep task readiness at the existing `spur task check` guard. Double the default size ceiling from
   five Requirements/eight Plan items to ten/sixteen, then keep enforcement as a deterministic
   count-only operation; delete executor-tier inference and doctor coupling from both the application
   evaluator and plugin script. Further raised limits become an explicit size override, while actual
   dispatch still enforces resolved executor availability and `requiresCapabilities`.
3. Change the size-check fallback from silent PASS to FAIL. Preserve the dirty-tree advisory. Reuse
   `feature-sync-bounded.ts` for auto reactivation if its current contract supports precheck; otherwise
   keep one direct sync call but propagate its failure. Do not introduce another wrapper.
4. Update positional workflow baselines and tests atomically with the definition. Record a trace
   comparison using the existing workflow observability data rather than adding timing telemetry.
5. Activate only after source-local validation: bundle/release Spur, reinstall plugin `sp` through
   Superskill, verify binary/plugin provenance, and start a fresh agent session before the canary.

The deliberate simplification is that precheck no longer predicts whether a selected model tier can
finish an operator-approved oversized task. The doubled deterministic size ceiling remains the
default boundary; an operator who raises it owns the larger dispatch, and the authoritative runtime
checks remain at `agent.run`.
### Plan
- [ ] Add focused failing tests for a doctor-free task-pipeline, count-only size enforcement,
      fail-closed missing checker, bounded feature reactivation, and unchanged idea-pipeline doctor.
- [ ] Finalize the temporary YAML bypass: remove transitional wording, make size fallback fail closed,
      and make auto feature reactivation single-shot and observable.
- [ ] Remove executor/doctor coupling from the application size evaluator and plugin size script;
      update their focused tests and drift inventory without adding a CLI verb.
- [ ] Reconcile lifecycle/resilience/inline-driver tests, composition baseline, workflow ownership,
      task-pipeline design text, and plugin references with the new graph.
- [ ] Validate and dry-run task-pipeline, capture the after trace against the recorded before trace,
      then run targeted tests, `bun run spur-check`, and one `bun run corpus-check`.
- [ ] Rebuild the bundled CLI, execute the governed Spur release/install and Superskill plugin-sp
      reinstall, and record version plus artifact provenance.
- [ ] Start a fresh coding-agent session and run a minimal canary through precheck to confirm no
      doctor action/subprocess and successful transition to implementation.
### Root Cause
`config/workflows/task-pipeline.yaml` declares `doctor.probe` as its first precheck action and gates
the precheck-to-implement transition on a WBS-scoped doctor status file. The inline driver executes
all non-model workflow actions in the host session, so `--agent inline` never implied that this probe
would be skipped.

The size checker adds a second coupling: when the task exceeds the default thresholds and an
executor is supplied, `plugins/sp/scripts/task-size-precheck.ts` shells to `spur agent doctor` only to
read `capabilityTier`. This duplicates startup/detection work and places model-tier prediction in a
task-shape check. Meanwhile, current `doctor.probe` classifies only installed/version usability;
authentication and quota were removed as unreliable by tasks 0682–0683. Actual `agent.run`
resolution already performs the authoritative liveness and capability checks at dispatch.

The emergency removal exposes coupled residue: task-pipeline resilience and lifecycle tests still
require doctor status, and `config/workflow-composition-baseline.json` keys actions by positional
`precheck:onEnter:<n>`. Those contracts must move with the final graph. The current size-script
fallback also writes PASS when the plugin script is absent, which is incompatible with a fail-closed
readiness gate.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- `config/workflows/task-pipeline.yaml` — live workflow and temporary config-only bypass.
- `packages/app/src/workflow/actions/doctor-probe.ts` — usability-only doctor action retained for
  intentional callers.
- `packages/app/src/services/task-size-precheck.ts` — shared size evaluator.
- `plugins/sp/scripts/task-size-precheck.ts` — plugin-local size gate and second doctor call.
- `packages/app/src/services/agent-service.ts` — authoritative dispatch resolution and capability
  attestation.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` — host-side action semantics.
- `plugins/sp/tests/task-pipeline-resilience.test.ts`
- `packages/domain/tests/planning/lifecycle-drift.test.ts`
- `packages/app/tests/workflow/composition-baseline.test.ts`
- `config/workflow-composition-baseline.json`
- `docs/design/workflow-shell-ownership.md`
- `docs/04_DESIGN.md` task-pipeline precheck and size-gate contract.
- Tasks 0454 and 0487 — original size and size-versus-tier gates.
- Tasks 0608, 0682, and 0683 — doctor action ownership and removal of unreliable auth/health work.
- Task 0706 — dispatch-time executor capability attestation.
- Trace `inline-20260821-083900-0614` — persisted before evidence for precheck action timings.
### History
- 2026-08-30T19:42:42.695Z backlog → todo (system)
