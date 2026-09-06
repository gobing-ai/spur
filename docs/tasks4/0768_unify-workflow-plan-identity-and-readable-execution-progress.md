---
schema_version: 1
name: "Unify workflow plan identity and readable execution progress"
status: done
template: feature-impl
created_at: 2026-09-05T05:21:56.897Z
updated_at: "2026-09-06T14:24:49.109Z"
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

- [x] **R1.** Planning and execution share workflow identity: route show/list/run/resume through resolveWorkflowDefinition; add the frozen identity fields below without removing existing JSON fields. Optional opaque version strings remain backward-compatible in both dialects. Planning performs no guards/actions/probes or run mutations; digest drift still denies resume.

- [x] **R2.** Progress is readable and truthful across execution surfaces: display the same declared-step plan before inline/sync/async work, then reconcile actual states/actions/retries/skips/outcome using existing reporters/projections. Native host todo when available, Markdown fallback otherwise. Preserve machine stdout and quiet/silent/no-plan semantics and retain full redacted detail in artifacts.

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

- packages/domain/src/dao/run-dao.ts: `stampRunIdentity(runId, definitionDigest, workflowVersion)` — single json_set write (RFC-7396 json_patch would DELETE a null-valued key; known-unversioned rows must record `workflowVersion` as JSON null).
- packages/app/src/services/workflow-service.ts:177-200 `withRunIdentityRecording`: stamps at createRun + createOrAttachRun; persistence is hard-fail (failed stamp aborts run creation before any action). `WorkflowRunResult` now types `definitionDigest?: string | null` and `version?: string | null`; `run()` echoes resolved digest + literal; `continuePaused` (:1041-1121) classifies eras by `metadata.workflowVersion` key presence — matching digest continues, drift prompts, stamped-null-digest refuses ("no recorded definition digest"), legacy rows keep the null-skip path; result echoes persisted identity.
- packages/app/src/workflow/step-reporter.ts: `renderRunPlan` renders the declared inventory as a checklist (`plan (kind) — declared inventory, not a predicted route:`) with conditional/loop markers via shared `buildWorkflowSteps`; todo/plan parity guaranteed by construction.
- packages/app/src/workflow/progress-projection.ts: progress reconciliation reads recorded visits; unvisited branches stay unvisited; blocked/cancelled never render as done.
- apps/cli/src/commands/workflow.ts: show/list/run/resume route through `resolveWorkflowDefinition` (resolve-once for run: plan, stamp, engine, steering share one object/digest); async worker receives expected digest via env and refuses before actions on mismatch; run-scoped plan artifact pre-spawn with redacted step detail (`redactAndBound` … 512); show `--format todo|mermaid` envelopes gain `definitionDigest` + `version` additively; planPreview remains human-branch-only (machine stdout unchanged).
- Tests: domain `run-dao-identity.test.ts` (null preservation + sibling-metadata merge); app workflow-service.test.ts 103 pass (incl. run-identity-3 negative test: stamp failure aborts creation with no transitions; legacy-1; nostamp refusal); step-reporter + progress-projection 33 pass; cli workflow.test.ts 125 pass (envelope digests pinned, plan-header updated).
- Verification: `bun run spur-check` rc=0 (lint + typecheck + full suite; /tmp/t0768-gate.txt). Eval-pipeline nesting-guard 5s timeout is a standalone-pass flake.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | show/list/run/resume/traced all resolve through the shared resolver: apps/cli/src/commands/workflow.ts:1177 (show), packages/app/src/services/workflow-service.ts:1372 (list entries carry definitionDigest+version), :1484 (run stamps identity at creation via RunDao.stampRunIdentity json_set), :1041-1119 (resume persists-digest classification with three states). Envelopes gain definitionDigest and version without removing fields (apps/cli/tests/commands/workflow.test.ts 125 pass). Empty version rejected, unknown literal opaque (workflow-service list tests). Planning is pure rendering with no guards/actions/run mutations; stamp failure now fails run creation with negative test run-identity-3. |
| R2 | MET | Same declared-step checklist plan before sync (workflow.ts:770) and async (workflow.ts:588 artifact pre-spawn with expected-digest worker gate :224). Step-reporter renders state/action/retry/skip lines with transition detail (packages/app/src/workflow/step-reporter.ts:69); progress projection reconciles recorded visits (packages/app/src/workflow/progress-projection.ts). Machine stdout preserved: planPreview human-branch only; quiet/silent/no-plan suppress display while identity still stamps. Artifact detail redacted via redactAndBound (workflow.ts:252). 136 app tests + 125 cli tests pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R6 — Progress is readable and truthful across execution surfaces | MET | test | Scenario-level roll-up of the row evidence below: readable progress (step-reporter renders state/action/retry/skip with transition detail, step-reporter.ts:69; projection marks unvisited/blocked truthfully) + truthful identity (run stamps persisted definitionDigest+version via RunDao.stampRunIdentity; stamp failure fails run creation, run-identity-3 negative test). Tests: step-reporter.test.ts + progress-projection.test.ts 33 pass; workflow.test.ts 125 pass. |
| R5 — Planning and execution share workflow identity | MET | test | Show envelopes carry definitionDigest + version for todo and mermaid formats; list entries validated with digest equal to resolveWorkflowDefinition().digest; run result echoes persisted identity; resume classifies by metadata.workflowVersion key presence, never re-resolution. workflow-service.test.ts legacy-1, nostamp, run-identity-3; workflow.test.ts show envelope assertions (125 pass) |
| R5 — empty version rejected, unknown literal opaque, plan executes no actions | MET | test | List test asserts invalid empty-version entry valid=false with error; opaque literal kept verbatim; renderRunPlan is pure with no engine or DB access; show is read-only through the same resolver. workflow-service.test.ts list entries |
| R6 — operator identifies state, actions, retries, skips, outcome | MET | test | Step reporter emits started/finished/heartbeat lines with attempt counts; transition detail gated by render detail; projection marks unvisited branches unvisited and blocked/cancelled not done. step-reporter.test.ts + progress-projection.test.ts 33 pass |
| R6 — native todo when available, Markdown fallback, conditional states not inevitable | MET | test | renderWorkflowTodo and renderRunPlan share buildWorkflowSteps with conditional/loop markers; parity test proves todo equals plan steps; inline-driver guidance consumes show --format todo --json once. step-reporter.test.ts parity |
| R6 — machine stdout and quiet/silent/no-plan compatible | MET | command | planPreview written only in the human branch; JSON envelopes additive; --no-plan suppresses display while service-side stamping persists identity; artifact detail redacted via redactAndBound. bun test tests/commands/workflow.test.ts 125 pass; full gate spur-check rc=0 |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Discovery and eleven-workflow inventory](../plans/2026-09-04-workflow-upgrade-brainstorm.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0765 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History

- 2026-09-06T05:02:27.226Z todo → wip (system)
- 2026-09-06T05:02:58.858Z wip → done (system)
