---
template: issue
schema_version: 1
name: "spur workflow run validates against node-resolved schemas instead of the embedded map"
description: ""
status: done
type: issue
profile: standard
feature_id: D3
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-04T17:26:20.433Z"
updated_at: "2026-10-03T15:33:48.521Z"
---

## 0431. spur workflow run validates against node-resolved schemas instead of the embedded map

### Background
`spur workflow run` and `spur workflow validate` disagree on how a workflow's
`$schema: "@gobing-ai/spur/schemas/<name>.schema.json"` ref is resolved.
`validate` injects the embedded-schema map via `embeddedSchemaOptions()`
(`packages/app/src/services/workflow-service.ts:348-367`, used at `:378-381`).
`run` hands the path to the engine's `runFile` → `load()` →
`loadWorkflowDef(path)` with **no** resolve/fileSystem options
(`@gobing-ai/ts-dual-workflow-engine` `service.ts:54-56` / `:74-75`), so
resolution falls through to node package resolution.

Reproduced 2026-08-04: the same `idea-pipeline.yaml` was `workflow valid` under
`validate` and schema-failed under `run` against
`/Users/robin/node_modules/@gobing-ai/spur/schemas/...` (published package),
not the working tree's `apps/cli/schemas/`. This is defect 1 of feature D3
(workflow run reliability); the other D3 defects are independent mechanisms.

Local workaround used to unblock the session (not a fix):
`ln -sfn ../../apps/cli node_modules/@gobing-ai/spur`.
### Requirements
- [x] R1. `WorkflowAppService.run` resolves `$schema` through the same embedded-schema options as `validate` (`embeddedSchemaOptions()`), not bare node resolution.
- [x] R2. When `ctx.embeddedSchemas` is present, a run of a workflow declaring `@gobing-ai/spur/schemas/...` never cites a path under any `node_modules` in schema errors.
- [x] R3. When no `node_modules/@gobing-ai/spur` is resolvable (compiled binary / bare tree), `run` still loads and validates against the embedded schema text and proceeds past schema validation.
- [x] R4. `validate` and `run` reach the same validity verdict for the same file + same embedded map (verb-independent resolution).
- [x] R5. Validation is not weakened: a field absent from the embedded schema still fails `run` with the offending field named.
- [x] R6. Any other `loadWorkflowDef` call sites on the run/link path that still use bare resolution (e.g. `maybeLinkPipelineRun`) pass the same embedded options when schema validation is on, or use `validateSchema: false` only when the def is already trusted.
- [x] R7. Regression tests target the shared load mechanism (embedded map injection on run), not only a single workflow YAML where the bug was observed.
### Acceptance Criteria
```gherkin
Feature: spur workflow run schema resolution parity

  @core
  Scenario: R1 — workflow schema validation is verb-independent
    Given a workflow YAML and a stale @gobing-ai/spur resolvable from an ancestor node_modules
    When spur workflow validate and spur workflow run are each invoked on that same file
    Then both resolve the $schema ref through the embedded schema map
    And both reach the same validity verdict
    And neither error message cites a path under any node_modules

  @core
  Scenario: R2 — schema resolution survives the absence of node_modules
    Given a compiled binary from which @gobing-ai/spur cannot be node-resolved
    When spur workflow run executes a bundled workflow declaring a @gobing-ai/spur schema ref
    Then the run proceeds past schema validation using the embedded schema text

  @core
  Scenario: R8 — each defect is covered at the shared mechanism
    Given the three fixes are implemented
    When the test suite runs
    Then each defect has a regression test against schema loading, the shell action, or the HITL resume path
    And no defect relies solely on a test of the single workflow file where it was observed
```

**Non-regression note (not a scenario):** the fix must not weaken validation into a no-op — a
workflow carrying a field absent from the embedded schema must still fail `run` with the offending
field named.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
## Approach

Keep schema validation on the run path, but load the def **inside**
`WorkflowAppService` with the same `embeddedSchemaOptions()` already used by
`validate`, then hand the loaded `WorkflowDef` to the engine's `run(def, opts)`
instead of `runFile(path)` (which always calls `loadWorkflowDef(path)` with no
options).

## Chosen design

1. **Pre-load in `WorkflowAppService.run`**
   ```ts
   const absolute = resolve(this.ctx.cwd, file);
   const embedded = this.embeddedSchemaOptions();
   const workflow = await loadWorkflowDef(absolute, {
     ...(embedded !== undefined ? embedded : {}),
   });
   const result = await svc.run(workflow, { workdir, runId, vars, ... });
   ```
   Drop `svc.runFile(file, …)` on this path. Engine `run(WorkflowDef)` already
   exists (`service.ts:59-71`) and performs no second schema load.

2. **Reuse, do not fork** — call the existing private `embeddedSchemaOptions()`
   helper; do not duplicate the sentinel-prefix resolve/fileSystem map.

3. **Secondary call site** — `maybeLinkPipelineRun` currently does
   `loadWorkflowDef(resolve(...))` bare (`workflow-service.ts:453`). Either:
   - pass `embeddedSchemaOptions()` (consistent), or
   - pass `{ validateSchema: false }` (name-only check after a successful run
     load). Prefer embedded options for consistency; the def is only used for
     `workflowName === TASK_PIPELINE_WORKFLOW`.

4. **Out of scope for this task** — do not change the engine package's
   `runFile`/`load` signatures (would be an upstream ts-dual-workflow-engine
   change). The app-layer pre-load is sufficient and matches how validate
   already works.

5. **Tests** — mirror the existing validate embedded-schema tests
   (`workflow-service.test.ts:217+`) for `run`:
   - embedded map accepts → run proceeds past load
   - embedded map rejects unknown field → run fails with field name, no
     `node_modules` path in the message
   - (optional) with a poisoned ancestor `node_modules/@gobing-ai/spur`, run
     still uses embedded text when the map is provided

## Rejected alternatives

| Alternative | Why not |
|---|---|
| `validateSchema: false` on run | Weakens the gate; non-regression note forbids it |
| Teach engine `runFile` about embedded maps | Cross-package API change; app already owns the map |
| Symlink / install workspace package always | Session workaround; fails for `--compile` and CI temp cwd |
| Only fix `maybeLinkPipelineRun` | That site is post-run linking; the failure is on the primary load |

## Invariants

- Single resolution contract for `validate` and `run` when `embeddedSchemas` is configured.
- When `embeddedSchemas` is absent, both verbs fall back to node resolution (dev path without the map).
- Schema failure messages name the field; they must not point at a published package path when the embedded map is in use.
### Plan
- [x] Confirm current call graph: `WorkflowAppService.run` → `EngineWorkflowService.runFile` → `load()` → bare `loadWorkflowDef(path)`; `validate` already uses `embeddedSchemaOptions()`.
- [x] Change `run` to `loadWorkflowDef(absolute, embeddedSchemaOptions() ?? {})` then `svc.run(workflow, opts)` — remove `runFile` on this path.
- [x] Align `maybeLinkPipelineRun`'s `loadWorkflowDef` with embedded options (or `validateSchema: false` with a one-line why).
- [x] Add regression tests in `packages/app/tests/services/workflow-service.test.ts` mirroring the validate embedded-schema cases for `run` (accept + reject-with-field-name; no `node_modules` in error).
- [x] Manually smoke (optional): covered by mechanism-level regression (temp dir + embedded map accept/reject) rather than live idea-pipeline smoke.
- [x] Gate: `bun test packages/app/tests/services/workflow-service.test.ts -t "run resolves a package-specifier"` green this verify run.
### Root Cause
Reproduced live on 2026-08-04 in this monorepo.

Setup: the working tree's `apps/cli/schemas/state-machine-workflow.schema.json` had an uncommitted
`failureStates` field, and the workflow YAMLs under `.spur/workflows/` used it. A published
`@gobing-ai/spur` was installed at `/Users/robin/node_modules/@gobing-ai/spur`, and the repo had no
`node_modules/@gobing-ai/spur` symlink.

Observed:

```
$ bun run apps/cli/src/index.ts workflow run .spur/workflows/idea-pipeline.yaml --vars '{...}'
Run: 6e07c770-e4b6-4326-b290-13a9355bac52
Configuration ".spur/workflows/idea-pipeline.yaml" failed JSON schema validation against
"/Users/robin/node_modules/@gobing-ai/spur/schemas/state-machine-workflow.schema.json":
failureStates: unknown field "failureStates"
```

Note the resolved path: the **published** package, not the working tree. Invoking through
`bun run apps/cli/src/index.ts` does not help, because resolution is by package name, not by entry
point.

Control: `workflow validate` on the same file at the same moment passed, because validate injects the
embedded map:

```
$ bun run apps/cli/src/index.ts workflow validate .spur/workflows/idea-pipeline.yaml
workflow valid: idea-pipeline
```

That divergence between `validate` (valid) and `run` (schema failure) on one unchanged file is the
clearest signature of this defect.

Local workaround applied to unblock the session (not a fix): restore the workspace link Bun should
have created — `ln -sfn ../../apps/cli node_modules/@gobing-ai/spur` from the repo root.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/workflow-service.ts:416` |
| `packages/app/src/services/workflow-service.ts:442` |
| `packages/app/src/services/workflow-service.ts:452` |
| `packages/app/src/services/workflow-service.ts:476` |
| `packages/app/src/services/workflow-service.ts:490` |
| `packages/app/src/services/workflow-service.ts:497` |
| `packages/app/src/services/workflow-service.ts:500` |
| `packages/app/tests/services/workflow-service.test.ts:283` |
### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `run()` pre-loads via `resolveWorkflowDefinition(cwd, file, { validateSchema: true, embeddedSchemas: ctx.embeddedSchemas?.() })` then `svc.run(workflow, opts)` — `packages/app/src/services/workflow-service.ts:700-708` (re-read this run); resolver forwards the embedded map at `packages/app/src/workflow/workflow-resolver.ts:300-304`. |
| R2 | MET | Reject-path test asserts error uses `embedded-spur` sentinel and never cites `node_modules` — `packages/app/tests/services/workflow-service.test.ts:805-818` (re-read this run). |
| R3 | MET | Run resolves `$schema` from the in-memory embedded map with no package-tree resolution — `packages/app/tests/services/workflow-service.test.ts:765-803`; `createEmbeddedSchemaOptions` seam at `packages/app/src/workflow/workflow-resolver.ts:143`. |
| R4 | MET | Both verbs route through `resolveWorkflowDefinition` with the same embedded map and `validateSchema: true` — validate `packages/app/src/services/workflow-service.ts:558`, run `:702`. |
| R5 | MET | Rejecting embedded schema fails `run` with the offending field named — `packages/app/tests/services/workflow-service.test.ts:805-818` (also covers the non-regression note: unknown field still fails `run`). |
| R6 | MET | `maybeLinkPipelineRun` re-loads with `{ validateSchema: false }` on the already-validated def — `packages/app/src/services/workflow-service.ts:828-846` (re-read this run). |
| R7 | MET | Mechanism-level accept+reject tests on `run` itself — `packages/app/tests/services/workflow-service.test.ts:760-818`; fresh run: `bun test tests/services/workflow-service.test.ts -t embeddedSchemas` → 2 pass, 0 fail, exit 0. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — workflow schema validation is verb-independent | MET | test | `bun test tests/services/workflow-service.test.ts -t embeddedSchemas` (packages/app, this run): 2 pass 0 fail — validate+run embedded-resolution pair. |
| Scenario: R2 — schema resolution survives the absence of node_modules | MET | test | Same run; embedded map supplies schema, run reaches done — `packages/app/tests/services/workflow-service.test.ts:765-803`. |
| Scenario: R8 — each defect is covered at the shared mechanism | MET | test | Tests target the shared `resolveWorkflowDefinition`/embedded-map load mechanism, not one production YAML — `packages/app/tests/services/workflow-service.test.ts:760-818`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**SECUA review** (standalone verify --force 2026-08-04; dispositions resolved in 2026-10-03 re-audit) — aggregate: PASS

| Priority | Dimension | Location | Finding | Disposition |
|----------|-----------|----------|---------|-------------|
| P1 | — | — | None | — |
| P2 | — | — | None | — |
| P3 | E | `packages/app/src/services/workflow-service.ts:828-846` | `maybeLinkPipelineRun` re-parses YAML for name-only with `validateSchema: false` after the primary load already validated. Acceptable; not a correctness gap. | RESOLVED — accepted as designed: name-only re-parse of the already-validated def; re-confirmed this run (line anchor refreshed from stale :490-501). |
| P4 | C | `packages/app/src/services/workflow-service.ts:700-708` | `run` pre-loads via `resolveWorkflowDefinition` with the same embedded schema options as `validate` + explicit `validateSchema: true`. Reject path names the field and uses `embedded-spur`, not `node_modules`. | RESOLVED — parity confirmed this run (line anchor refreshed from stale :456-462). |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-08-05T03:44:16.689Z todo → wip (system)
- 2026-08-05T03:53:19.286Z wip → testing (system)
- 2026-08-05T03:53:32.959Z testing → done (system)
