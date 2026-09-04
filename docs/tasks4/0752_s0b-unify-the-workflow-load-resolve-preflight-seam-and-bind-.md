---
schema_version: 1
name: "S0b: Unify the workflow load/resolve/preflight seam and bind resume to the exact definition"
status: done
template: feature-impl
created_at: 2026-09-03T20:27:30.732Z
updated_at: "2026-09-04T00:38:39.664Z"
feature_id: D9
priority: P1
ac_altitude: task-local
---

## 0752. S0b: Unify the workflow load/resolve/preflight seam and bind resume to the exact definition

### Background

`validate`, `run`, `show`, `continue`, the lifecycle adapters, and progress projection do not share one load/resolve/preflight path (`docs/inventory/d8-0729-workflow-contract-inventory.md` §E). Four consequences are live today:

- **F-3** — `makeSvc` (`apps/cli/src/commands/workflow.ts:253-286`) never passes `spurConfig`, though `WorkflowAppService` declares it (`packages/app/src/services/workflow-service.ts:433`) and two code paths read it (`:668` default-agent resolution, `:1278`). Every CLI-driven `workflow run` resolves its default agent as if no config existed.
- **F-4** — `continuePaused` (`:1007`) re-resolves the definition **by name** through `resolveWorkflowDefByName`, which loads with `validateSchema: false` (`:1076`) and compares no digest. A definition edited between pause and resume is silently substituted into a run that started from a different file.
- **Precedence divergence** — `resolveWorkflowFile` is project-first; `make-lifecycle-adapter.ts:24-34` is bundled-first. The same name resolves to different files depending on the caller.
- **ADR-099 partial** — resume never reads the checkpoint, so the freshness contract the ADR describes is not enforced on the resume side.

The frozen D8 strategy (`docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §3, R3 seams S1/S2/S4/S5) requires one shared seam rather than four per-caller patches, and puts it before any routing work: the proportional pilots depend on pause/resume being safe.

### Requirements

- [x] R1. One shared resolve/preflight seam serves `run`, `continue`, and `validate`. They agree on the same definition, the same schema-validation posture, and the same digest for a given name and cwd.
- [x] R2. `spurConfig` is threaded through `makeSvc` so CLI-driven workflow runs resolve their default agent from configuration, matching the non-CLI path.
- [x] R3. A resumed run is bound to the exact definition identity it launched from: the resume path compares the persisted `definitionDigest` against the re-resolved definition and refuses on mismatch, or proceeds only on an explicit operator confirmation.
- [x] R4. Definition source precedence is project-first on every surface, including the lifecycle adapter, so a project definition never loses to a bundled one depending on the caller.
- [x] R5. Resume validates checkpoint freshness on the resume side, closing the ADR-099 partial implementation.
- [x] R6. Each of R1-R5 has a regression test that fails against the pre-repair code.

### Acceptance Criteria

```gherkin
Feature: One workflow resolve, preflight, and resume seam

  @core
  Scenario: R1 — run, continue, and validate agree on one definition
    Given a workflow name resolvable from more than one search layer
    When run, continue, and validate each resolve that name from the same working directory
    Then all three select the same file
    And all three report the same definition digest
    And none of them applies a weaker schema-validation posture than the others.

  @core
  Scenario: R2 — a CLI workflow run resolves its default agent from configuration
    Given a spur configuration declaring a default agent
    When a workflow is run through the CLI
    Then the default agent resolves from that configuration
    And the resolution matches what the non-CLI path produces for the same config.

  @core
  Scenario: R3 — A resumed run is bound to the exact definition it launched from
    Given a paused workflow run whose definition file is edited after the pause
    When the run is continued
    Then the digest mismatch is detected before any step executes
    And the resume is refused, or proceeds only after an explicit operator confirmation naming the drift.

  @core
  Scenario: R4 — a project definition wins on every surface
    Given a workflow name present in both the project and the bundled layer
    When it is resolved through the CLI run path and through the lifecycle adapter
    Then both resolve to the project definition.

  @edge
  Scenario: R5 — a stale checkpoint does not silently resume
    Given a paused run whose checkpoint no longer reflects the current run state
    When the run is continued
    Then the resume path reads the checkpoint and reports the staleness
    And the run does not continue from an unvalidated checkpoint.
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**The seam, not four patches.** Extract one internal resolver that every surface calls: given a name-or-path plus cwd, it returns `{ path, workflow, digest, layer }` with a single schema-validation posture. `run` and `validate` already share most of this through `resolveWorkflowFile`; the work is pulling `continuePaused`'s name-based re-resolution and `make-lifecycle-adapter.ts`'s bundled-first walk onto it, then deleting the two divergent paths. Deleting the duplicates is the deliverable — a shared helper that leaves the old paths in place has not fixed the seam.

**R2 is one line plus a test.** `makeSvc` omits a field the service already declares. Thread `spurConfig: () => context.spurConfig?.()` (match the surrounding lazy-getter style used by `getDb`, `ruleService`, `agentService`). Check how `context` exposes config before writing — do not invent an accessor.

**R3 — where the digest comes from.** `computeDefinitionDigest` already exists (`packages/app/src/workflow/composition-baseline.ts:110`) and runs are already stamped with `metadata_json.definitionDigest` (0730 §A). So resume needs no new mechanism: read the stamp off the run row, recompute from the re-resolved file, compare. Refusal is the default; the confirmation path exists only because a legitimate mid-flight fix should not strand a long run. The confirmation must name the old and new digest — an unnamed "continue anyway?" is not consent.

**R3 subsumes version drift.** Because `version` is folded into the digest, this one comparison also catches any future version edit between pause and resume. That is why task 0756 (S4) declares no resume machinery of its own.

**R5 — smallest correct fix.** Read the checkpoint on the resume side and validate it against the run row before handing control to the engine. Do not build a checkpoint repair or migration path; report and refuse.

**Tradeoff:** R3 and R4 change which file some existing runs resolve. Callers relying on the bundled-first accident will see behavior change. That is a correctness repair, and the regression tests pin the intended precedence.

**Not in this task:** proof integrity (0751) and action options / run-id confinement / nested composition (0753), which are sibling S0 tasks.

### Plan

- [x] Map every current definition-resolution call site (`resolveWorkflowFile`, `resolveWorkflowDefByName`, `make-lifecycle-adapter.ts`, projection) and record the set in the Solution before editing.
- [x] R2: thread `spurConfig` through `makeSvc`; add the default-agent-resolution regression test.
- [x] R1/R4: extract the shared resolver, move all call sites onto it, delete the divergent paths; add the three-surface-agreement and precedence tests.
- [x] R3: compare persisted vs recomputed digest at resume; refuse on mismatch with both digests named; add the edited-definition test.
- [x] R5: validate checkpoint freshness on the resume side; add the stale-checkpoint test.
- [x] Run the workflow-service suite from inside its workspace; then `bun run spur-check`.

### Solution

#### Summary

Unified the workflow load/resolve/preflight seam into `packages/app/src/workflow/workflow-resolver.ts` so `run`, `continue`, and `validate` share a single project-first resolution contract, schema-validation posture (`validateSchema: true`), and canonical definition digest. Resumed runs are bound to their launched `definitionDigest` and validate session checkpoint freshness before execution. Threaded `spurConfig` through `makeSvc` in CLI commands. Deleted divergent `resolveWorkflowDefByName` and bundled-first `resolveWorkflowPath`. Tests in `packages/app/tests/workflow/workflow-resolver-seam.test.ts`, `apps/cli/tests/workflow/make-lifecycle-adapter.test.ts`, and `apps/cli/tests/commands/workflow.test.ts` verify all requirements.

#### Call-Site Mapping

- `resolveWorkflowFile`: `WorkflowAppService.validate`, `WorkflowAppService.run`, `WorkflowAppService.maybeRecordTaskRunLink`, `apps/cli/src/commands/workflow.ts` (plan preview, steeringController, workflow show), `apps/cli/tests/commands/init.test.ts`, and `packages/app/tests/services/workflow-service.test.ts`.
- `resolveWorkflowDefByName`: `WorkflowAppService.continuePaused` (now deleted; replaced by `resolveWorkflowDefinition`).
- `makeLifecycleAdapter`: `resolveWorkflowPath` (now deleted; replaced by project-first `resolveWorkflowFile`).
- `progress-projection`: candidate paths with `validateSchema: false` (replaced by `resolveWorkflowDefinition`).

#### Change Map

| File:Line | Change |
| --- | --- |
| `packages/app/src/workflow/workflow-resolver.ts:84` | Extract unified project-first `resolveWorkflowFile` resolver supporting bare names and path patterns |
| `packages/app/src/workflow/workflow-resolver.ts:180` | Implement `resolveWorkflowDefinition` with embedded schemas, schema validation, and digest computation |
| `packages/app/src/services/workflow-service.ts:485` | Move `WorkflowAppService.validate` to `resolveWorkflowDefinition` returning canonical digest |
| `packages/app/src/services/workflow-service.ts:593` | Update `WorkflowAppService.run` to load workflow definition through unified `resolveWorkflowDefinition` |
| `packages/app/src/services/workflow-service.ts:971` | Bind `continuePaused` to launched `definitionDigest` and validate checkpoint freshness before execution |
| `packages/app/src/services/workflow-service.ts:1075` | Implement `validateResumeCheckpointFreshness` checking terminal status, staleness, and run row matching |
| `packages/app/src/workflow/checkpoint-contract.ts:79` | Fix array syntax parsing for empty or inline list in checkpoint artifacts |
| `packages/app/src/workflow/progress-projection.ts:248` | Switch projection definition lookup to unified `resolveWorkflowDefinition` with schema validation |
| `apps/cli/src/commands/workflow.ts:260` | Thread `spurConfig` through `makeSvc` for CLI workflow execution |
| `apps/cli/src/commands/workflow.ts:697` | Add `--force` option to continue command for explicit drift bypass |
| `apps/cli/src/workflow/make-lifecycle-adapter.ts:18` | Replace bundled-first lookup with project-first `resolveWorkflowFile` in lifecycle adapter |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | packages/app/src/workflow/workflow-resolver.ts:180 resolveWorkflowDefinition unified across run, continue, validate |
| R2 | MET | apps/cli/src/commands/workflow.ts:260 threads spurConfig |
| R3 | MET | packages/app/src/services/workflow-service.ts:998-1025 bound to definitionDigest with refusal on drift |
| R4 | MET | packages/app/src/workflow/workflow-resolver.ts:84 project-first precedence; apps/cli/src/workflow/make-lifecycle-adapter.ts:18 |
| R5 | MET | packages/app/src/services/workflow-service.ts:992,1075 validateResumeCheckpointFreshness validates checkpoint |
| R6 | MET | packages/app/tests/workflow/workflow-resolver.test.ts regression tests for R1-R5 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| A resumed run is bound to the exact definition it launched from | MET | test | packages/app/tests/workflow/workflow-resolver.test.ts:168 |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Multi-Dimensional Review

#### Functional Traceability

- R1: One shared resolve/preflight seam serves run, continue, and validate. MET. `resolveWorkflowDefinition` in `workflow-resolver.ts:180` is called by `validate`, `run`, and `continuePaused` with consistent `validateSchema: true` posture and digest calculation.
- R2: `spurConfig` threaded through `makeSvc`. MET. `apps/cli/src/commands/workflow.ts:260` threads `context.spurConfig ?? null` to `WorkflowAppService`.
- R3: Resumed run bound to launched `definitionDigest`. MET. `workflow-service.ts:998-1025` compares persisted vs recomputed digest and refuses on unconfirmed drift naming both hashes.
- R4: Definition source precedence project-first on every surface. MET. `workflow-resolver.ts:84` probes project first; `make-lifecycle-adapter.ts:18` uses `resolveWorkflowFile`.
- R5: Resume validates checkpoint freshness. MET. `workflow-service.ts:992,1075` validates session checkpoint before resuming.
- R6: Regression tests for R1-R5. MET. Automated test suite in `packages/app/tests/workflow/workflow-resolver.test.ts` and CLI integration tests.

#### SECUA Quality

- Security: Clean file path resolution, no arbitrary code execution or unescaped commands.
- Efficiency: Direct existence check fast path; avoids re-reading definitions multiple times.
- Correctness: Canonical digest equality check; terminal status and stale checkpoint refusal.
- Usability: Error and confirmation messages clearly report launched and drifted digests.
- Architecture: Single SSOT resolver; deleted divergent `resolveWorkflowDefByName` and bundled-first `resolveWorkflowPath`.

#### Priority Findings

Verdict: PASS

| Priority | Category | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | correctness | Definition drift handled fail-closed with confirmation fallback | addressed |

- Residual Risk: Low. Existing callers expecting bundled-first resolution on collision will now resolve project copy, which is the intended correctness repair.
- Disposition: PASS.

### References

- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §3 (R3 seams S1/S2/S4/S5), §8 (precedence unify attributed to S0)
- Defect register: `docs/inventory/d8-0729-workflow-contract-inventory.md` §E (divergence), §F-3, §F-4
- ADR-099 (checkpoints freshness-bound resume) — amended by this slice; ADR-070 (progress projection, digest diagnostics)
- Code: `apps/cli/src/commands/workflow.ts:253-286`; `packages/app/src/services/workflow-service.ts:433,668,1007,1076,1278,1690-1707`; `packages/app/src/workflow/make-lifecycle-adapter.ts:24-34`; `packages/app/src/workflow/composition-baseline.ts:110`

### History

- 2026-09-04T00:20:42.292Z todo → wip (system)
- 2026-09-04T00:36:52.762Z wip → testing (system)
- 2026-09-04T00:38:39.664Z testing → done (system)
