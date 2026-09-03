---
schema_version: 1
name: "S0c: Repair action options, run-id confinement, nested composition, and dry-probe escalation noise"
status: todo
template: feature-impl
created_at: 2026-09-03T20:27:31.022Z
updated_at: "2026-09-03T21:15:08.544Z"
feature_id: D9
priority: P1
ac_altitude: task-local
---

## 0753. S0c: Repair action options, run-id confinement, nested composition, and dry-probe escalation noise

### Background
Four independent defects share the property that a declared control has no effect, or a declared path cannot execute (`docs/inventory/d8-0729-workflow-contract-inventory.md` §F):

- **F-1** — `command-gate.ts:157` spreads `timeoutMs` into `ProcessOptions`, but the executor contract declares `timeout` (`@gobing-ai/ts-runtime/dist/process-executor.d.ts:58`). Every `command.gate` timeout ever written has been silently dropped; a hung gate command runs unbounded.
- **F-6** — `apps/cli/src/commands/workflow.ts:424` and `:512` accept `options.runId` unvalidated and hand it straight to path construction. A run ID containing `..` or a separator escapes its confinement directory.
- **F-2** — `feature-dev.yaml` attempts a nested `spur workflow run pr-review.yaml` that the `SPUR_WORKFLOW_RUN_ACTIVE` child guard refuses. The integration-review step has never reached a real decision; `softFail` can hide that it never ran.
- **ADR-098 escalation noise** — 59 human-inspect escalation packets were emitted across the 65-run dry sweep (`docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §F). An escalation channel that fires on probes is an escalation channel nobody reads.

D8 decision **D1** (accepted with its default unchanged) resolves F-2 by replacing the nested spawn with a non-spawning check rather than allowing a guarded nested level — no new nesting, smallest diff.

A fifth item is documentation-only: **F-14** — `workflow validate` / dry-run is smoke, not run-readiness evidence. No consumer may cite it as proof a workflow will run.
### Requirements
- [ ] R1. A `command.gate` timeout is enforced: the option reaches the executor under the name the executor's contract declares, and a command exceeding the deadline is terminated and does not report PASS.
- [ ] R2. Run IDs are validated at the CLI entry point before any path is constructed. A run ID containing a path separator, a traversal segment, or an absolute path is rejected with a named error.
- [ ] R3. `feature-dev`'s integration review reaches a real decision without spawning a nested workflow run (D8 decision D1): the nested `spur workflow run` is replaced with a non-spawning check.
- [ ] R4. Dry-run probes emit no human-inspect escalation packet. Escalation emission distinguishes a probe from a real blocked or failed run.
- [ ] R5. No consumer or document cites `workflow validate` or a dry run as run-readiness evidence (F-14); where one does, it is corrected to describe smoke coverage.
- [ ] R6. Each of R1-R4 has a regression test that fails against the pre-repair code.
### Acceptance Criteria
```gherkin
Feature: Effective workflow action options, confinement, and composition

  @core
  Scenario: R1 — A command gate timeout actually fires
    Given a workflow step whose command.gate declares a timeout
    And a command that runs longer than that deadline
    When the step executes
    Then the process is terminated at the deadline
    And the step does not report PASS.

  @core
  Scenario: R2 — Run IDs cannot escape their confinement directory
    Given a workflow run invoked with a run ID containing a path separator, a traversal segment, or an absolute path
    When the CLI parses the invocation
    Then the run ID is rejected with a named error
    And no path is constructed from it.

  @core
  Scenario: R3 — feature-dev's integration review reaches a real decision
    Given a feature-dev run reaching its integration-review step
    When the step executes
    Then the review check runs without spawning a nested workflow run
    And the step produces a pass or fail decision rather than being skipped or soft-failed.

  @core
  Scenario: R4 — Dry probes emit no human-inspect escalation
    Given a dry-run sweep across the shipped workflow definitions
    When the sweep completes
    Then no escalation packet is emitted for a dry probe
    And a genuinely blocked or failed real run still emits one.

  @edge
  Scenario: R5 — Dry-run is described as smoke, not run-readiness
    Given the observability and composition design documents and any consumer citing workflow validate
    When they are inspected for run-readiness claims
    Then dry-run and validate are described as smoke coverage
    And no consumer treats either as evidence that a workflow will run.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**R1 is one word, but check the callers first.** `timeoutMs` → `timeout` at `command-gate.ts:157`. Before editing, grep for other `timeoutMs` spreads into `processExecutor.run` — if the same mistake exists in a sibling action, this is the seam and all of them get fixed here, not just the one the register names. The test must assert the *deadline fires*, not that the option is present.

**R2 — validate at the boundary, once.** Both `:424` and `:512` route into the same construction, so add one validator and call it at CLI parse time for both, rather than sanitizing at each path join. Reject rather than sanitize: a silently rewritten run ID breaks the correlation between the ID the operator typed and the directory that appears. Accept the shape the generated IDs already use (UUID-like: alphanumerics and dashes) and reject everything else.

**R3 — non-spawning check (D8 decision D1).** Replace the nested `spur workflow run pr-review.yaml` step with a direct invocation of the same review check that pr-review's step performs, called in-process rather than as a child workflow. Do not relax `SPUR_WORKFLOW_RUN_ACTIVE` — the guard is correct; the composition was wrong. Also remove any `softFail` that was masking the refusal; a review that cannot run must fail loudly.

**R4 — suppress at emission, not at read.** The escalation emitter needs to know the run is a probe. The run already carries dry-run state; thread that into the emission decision so the packet is never written. Filtering downstream would leave the noise in the ledger.

**R5 is documentation.** Correct the claims where they appear (`docs/design/workflow-observability.md` posture, and any consumer that cites validate as readiness). No code change.

**Tradeoff:** R1 will start terminating gate commands that previously ran unbounded. Some workflow whose gate quietly took longer than its declared deadline will now fail. That is the declared contract finally taking effect; if a declared deadline is wrong, the fix is to correct the deadline, not to keep the option inert.

**Not in this task:** proof integrity (0751) and the resolve/resume seam (0752), which are sibling S0 tasks.
### Plan
- [ ] Grep every `timeoutMs` spread into the process executor across the action surface; fix the whole set, not only `command-gate.ts`.
- [ ] R1: correct the option name; add a deadline-fires regression test.
- [ ] R2: add one run-id validator at the CLI boundary covering both invocation sites; add the traversal-rejection test.
- [ ] R3: replace the nested `feature-dev` review with a non-spawning check; remove the masking `softFail`; add a test that the step reaches a decision.
- [ ] R4: thread probe state into escalation emission; add a dry-sweep-emits-nothing test and a real-failure-still-emits test.
- [ ] R5: correct the dry-run/validate posture claims in the observability design doc and any consumer citing them as readiness.
- [ ] Run the workflow-action and CLI suites from inside their workspaces; then `bun run spur-check`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §3 (R3 seams S3/S6/S8 + escalation-noise ops row), §9.3 decision D1
- Defect register: `docs/inventory/d8-0729-workflow-contract-inventory.md` §F-1, §F-2, §F-6, §F-14
- Measurement: `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §F (59 packets across the 65-run dry sweeps)
- ADR-098 (escalation packets) — amended by this slice
- Code: `packages/app/src/workflow/actions/command-gate.ts:157`; `apps/cli/src/commands/workflow.ts:424,512`; `config/workflows/feature-dev.yaml`; `@gobing-ai/ts-runtime/dist/process-executor.d.ts:58`
### History
