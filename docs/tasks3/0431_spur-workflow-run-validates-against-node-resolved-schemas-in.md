---
template: issue
schema_version: 1
name: "spur workflow run validates against node-resolved schemas instead of the embedded map"
description: ""
status: todo
type: issue
profile: standard
feature_id: D3
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-04T17:26:20.433Z"
updated_at: "2026-08-04T21:39:35.450Z"
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
- [ ] R1. `WorkflowAppService.run` resolves `$schema` through the same embedded-schema options as `validate` (`embeddedSchemaOptions()`), not bare node resolution.
- [ ] R2. When `ctx.embeddedSchemas` is present, a run of a workflow declaring `@gobing-ai/spur/schemas/...` never cites a path under any `node_modules` in schema errors.
- [ ] R3. When no `node_modules/@gobing-ai/spur` is resolvable (compiled binary / bare tree), `run` still loads and validates against the embedded schema text and proceeds past schema validation.
- [ ] R4. `validate` and `run` reach the same validity verdict for the same file + same embedded map (verb-independent resolution).
- [ ] R5. Validation is not weakened: a field absent from the embedded schema still fails `run` with the offending field named.
- [ ] R6. Any other `loadWorkflowDef` call sites on the run/link path that still use bare resolution (e.g. `maybeLinkPipelineRun`) pass the same embedded options when schema validation is on, or use `validateSchema: false` only when the def is already trusted.
- [ ] R7. Regression tests target the shared load mechanism (embedded map injection on run), not only a single workflow YAML where the bug was observed.
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
- [ ] Confirm current call graph: `WorkflowAppService.run` → `EngineWorkflowService.runFile` → `load()` → bare `loadWorkflowDef(path)`; `validate` already uses `embeddedSchemaOptions()`.
- [ ] Change `run` to `loadWorkflowDef(absolute, embeddedSchemaOptions() ?? {})` then `svc.run(workflow, opts)` — remove `runFile` on this path.
- [ ] Align `maybeLinkPipelineRun`'s `loadWorkflowDef` with embedded options (or `validateSchema: false` with a one-line why).
- [ ] Add regression tests in `packages/app/tests/services/workflow-service.test.ts` mirroring the validate embedded-schema cases for `run` (accept + reject-with-field-name; no `node_modules` in error).
- [ ] Manually smoke (optional): `workflow validate` + `workflow run` on a workflow that uses a working-tree-only schema field, with an ancestor published `@gobing-ai/spur` present — both should agree.
- [ ] Gate: `bun run lint` + `packages/app` workflow-service tests green.
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
