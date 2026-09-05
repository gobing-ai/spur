---
schema_version: 1
name: "Unify workflow plan identity and readable execution progress"
status: todo
template: feature-impl
created_at: 2026-09-05T05:21:56.897Z
updated_at: "2026-09-05T05:51:15.150Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P4"]
dependencies: ["0765"]
---

## 0768. Unify workflow plan identity and readable execution progress

### Background
D61 implementation package P4, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

D9/0756 already supplies optional non-empty opaque version validation in both shipped JSON schemas and the shared resolver. workflow show --format todo already exists, but show independently loads definitions. Sync run has a plan preview; renderRunPlan currently arrow-joins the declared inventory. WorkflowAppService lives in packages/app/src/services/workflow-service.ts and already records definitionDigest.

Dependencies: 0765. Detailed inputs and handoffs are frozen below.
### Requirements
- [ ] **R1.** Planning and execution share workflow identity: route show/list/run/resume through resolveWorkflowDefinition; add the frozen identity fields below without removing existing JSON fields. Optional opaque version strings remain backward-compatible in both dialects. Planning performs no guards/actions/probes or run mutations; digest drift still denies resume.

- [ ] **R2.** Progress is readable and truthful across execution surfaces: display the same declared-step plan before inline/sync/async work, then reconcile actual states/actions/retries/skips/outcome using existing reporters/projections. Native host todo when available, Markdown fallback otherwise. Preserve machine stdout and quiet/silent/no-plan semantics and retain full redacted detail in artifacts.

Out of scope: new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.
### Acceptance Criteria

```gherkin
Feature: Unify workflow plan identity and readable execution progress

  @core
  Scenario: R1 — Planning and execution share workflow identity
    Given a versioned or unversioned definition in either supported workflow dialect
    When it is shown, listed, run, traced, or resumed
    Then the existing surfaces report the applicable version identity consistently
    And plan, execution, and resume use the same resolved definition digest
    And an empty version is rejected and an unknown non-empty literal remains opaque
    And producing a plan executes no workflow actions or guards


  @core
  Scenario: R2 — Progress is readable and truthful across execution surfaces
    Given an inline, synchronous, asynchronous, or resumed workflow run with branches or retries
    When the plan and subsequent state-boundary updates are presented
    Then the operator can identify the current state, active actions, retries, skips, and final outcome
    And a native todo tool is used when available with a Markdown fallback otherwise
    And conditional states are not falsely reported as an inevitable path or completed work
    And machine stdout and quiet, silent, and no-plan behavior remain compatible

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-05T05:42:37.560Z

Closed: metadata.workflowVersion stores original identity; public version absent=legacy unknown, null=known unversioned. Async artifact path is run-scoped and created before actions. Keep existing version schema and CLI flags; no model-based planning or global cache.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.

#### Q&A entry — 2026-09-05T05:51:15.149Z

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-05T05:42:37.560Z

Closed: metadata.workflowVersion stores original identity; public version absent=legacy unknown, null=known unversioned. Async artifact path is run-scoped and created before actions. Keep existing version schema and CLI flags; no model-based planning or global cache.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.

#### Q&A entry — 2026-09-05 (refineall --depth ready)

Closed: identity stamping is required, not best-effort. The existing digest-recording proxy swallows its merge failure and resume skips comparison on a null digest, which would let R1 pass vacuously; run creation now fails when the identity merge fails, and an absent digest on a post-change run denies resume. Pre-change rows keep the null-skip path and the 'unknown' label, distinguished by the presence of metadata.workflowVersion. The blast radius (a previously silent write becomes a hard creation failure) is accepted and carries its own negative test.
### Design
Extend packages/app/src/workflow/{workflow-resolver,step-reporter,progress-projection}.ts, packages/app/src/services/workflow-service.ts and apps/cli/src/commands/workflow.ts. No new public noun/verb/flag, planner service, schema registry, DB migration, execution engine or progress channel. Reuse resolveWorkflowDefinition, buildWorkflowSteps, renderWorkflowTodo, renderRunPlan, projectWorkflowProgress, withDefinitionDigestRecording and the existing async worker startup seam.

Freeze identity fields: show JSON for either format and valid WorkflowListEntry gain version: string|null and definitionDigest: string; each step gains its optional description without removing action/state fields. Invalid list entries remain valid=false with error and no invented valid identity. Run result/trace/progress gain optional version and definitionDigest read from run metadata. Persist metadata.workflowVersion as literal or null at new run creation beside existing metadata.definitionDigest. An old row with no workflowVersion keeps the public version field absent and human label 'unknown'; explicit null means a known unversioned definition. Never substitute today's YAML version for an old run, or confuse it with steering/envelope versions. Preserve all unrelated metadata when merging.

Identity persistence is not best-effort. withDefinitionDigestRecording (packages/app/src/services/workflow-service.ts:162) currently swallows its mergeMetadata failure, and continueRun skips drift comparison whenever persistedDigest is null (packages/app/src/services/workflow-service.ts:1022); a silently dropped stamp therefore yields a run that resumes unguarded and reads as legacy. R1 is unenforceable under that seam, so stamp definitionDigest and workflowVersion in one merge at run creation and fail run start when that merge fails, instead of starting an unidentifiable run. This converts a currently silent best-effort write into a hard creation failure for every workflow run; cover it with an explicit negative test rather than leaving the change implicit.

Resume classifies exactly three states: a matching persisted digest continues; a differing digest keeps the existing drift prompt and refusal; an absent digest on a run created after this change is a drift failure, not a skip. Pre-change rows keep the current null-skip path and the human label 'unknown'. Distinguish the two eras by the presence of the metadata.workflowVersion key, never by re-resolving today's definition against an old run.

Show uses the same resolver precedence as run/validate/continue (explicit path, project, bundle); resolver errors preserve existing CLI error envelope. The public show projection is read-only. For actual runs, resolve once and use that same object/digest for plan and engine; if async crosses a process boundary, send expected digest and fail before actions if worker resolution differs. Continue uses persisted digest validation before progress reconciliation. Reject empty/non-string versions; accept arbitrary non-empty literal, with no semver interpretation.

Declared plans are inventories, not predicted routes: render bullets/checkboxes with conditional/loop markers rather than a linear arrow chain. Unvisited branches stay unvisited; blocked/cancelled states are not done; retries display attempt count from recorded visits; active actions come from existing action events. No extra model calls. Inline-driver guidance calls workflow show --format todo --json once, adapts steps to the actual host todo API, and uses Markdown if that API is absent; update at state boundaries using existing progress, never reread full YAML or invent a tool.

Async startup creates .spur/run/<runId>-workflow-plan.json before worker actions, using the show-compatible todo projection plus runId. Store metadata.planArtifactPath and return that path with async startup JSON. Use existing artifact/write/redaction facilities; artifact-write or expected-digest failure must not start actions. This is actual-run bookkeeping, not a side effect of show. Human sync/async summaries reference the artifact/progress; no full YAML/success log dump. --no-plan suppresses display, not required identity recording; JSON has no prose. Preserve existing quiet/silent distinctions and sync fallback behavior, with equivalent plan guarantees if fallback occurs.

Input: 0765 normal check contract; existing D9 version/progress owners. Output to 0769/0770/0771: stable plan/metadata contract. Those tasks tag their owned YAMLs; this task does not bump all definitions. Canonical inline driver/facade guidance in plugins/sp changes alongside docs/04_DESIGN.md.

Verification targets: From packages/app: bun test tests/workflow/workflow-resolver.test.ts tests/workflow/step-reporter.test.ts tests/workflow/progress-projection.test.ts tests/workflow/progress-follow.test.ts tests/services/workflow-service.test.ts. From apps/cli: bun test tests/commands/workflow.test.ts tests/commands/workflow-version.test.ts. Extend plugins/sp/tests/inline-pipeline-driver.test.ts and parity tests. Spy actions/guards/doctor/DB writes to prove show is side-effect-free; exercise async/resume, not only rendering snapshots.

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under .spur/run/d61-<wbs>-before.json; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.
### Plan
1. [ ] R1: Add resolver/identity parity fixtures for both dialects, project/bundle precedence, opaque/missing/invalid versions and legacy run records.

2. [ ] R1: Route show/list and run planning through shared resolution; persist metadata identity without overwriting existing fields; test digest mismatch before any action on resume/async, a failing identity merge that must abort run creation, and an absent post-change digest that must deny resume.

3. [ ] R2: Replace misleading plan rendering and enrich existing progress with actual active-action/retry/outcome information; preserve JSON/output-mode tests.

4. [ ] R1/R2: Wire async plan artifact/startup metadata before dispatch; test artifact failure, worker digest drift and existing synchronous fallback.

5. [ ] R2: Update canonical inline driver and spur-cli workflow reference for native todo/Markdown adaptation and state-boundary updates; synchronize 04 surface docs.

6. [ ] R1/R2: Run focused service/CLI/inline tests, applicable final gate, normal task check and real verification; leave the identity contract ready for YAML owners.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

**Status (batch halt, 2026-09-05):** task 0768 is **not-attempted** at the batch level — the batch halted at task 0766 (deferred) with stop-the-batch default. The remaining 6 tasks (0767-0772) inherit the halted-batch state and require a follow-up session to drive per the topo order (0767/0768 after 0766, 0769/0770 after 0766/0767/0768, 0771 after 0767/0768, 0772 last).

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Discovery and eleven-workflow inventory](../plans/2026-09-04-workflow-upgrade-brainstorm.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0765 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
