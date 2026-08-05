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
updated_at: "2026-08-05T06:42:27.227Z"
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
**Force re-verify** 2026-08-04 (`/sp-dev-verify 0431 --auto --next --force --focus all --fix all`) — residual polish closed before commit.

**Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `run()` pre-loads via `loadWorkflowDef(absolute, { validateSchema: true, ...embeddedSchemaOptions() })` then `svc.run(workflow, opts)`; `svc.runFile` removed. `packages/app/src/services/workflow-service.ts:452-466` (re-read this run). |
| R2 | MET | Embedded resolver maps `SPUR_SCHEMA_MANIFEST` → sentinel; reject-path test asserts no `node_modules` and uses `embedded-spur`. `packages/app/src/services/workflow-service.ts:370-388`; `packages/app/tests/services/workflow-service.test.ts:328-342`. |
| R3 | MET | Regression test uses `mkdtemp(tmpdir())` outside package tree. Embedded map supplies schema; run completes `status: done`. `packages/app/tests/services/workflow-service.test.ts:288-318`. |
| R4 | MET | Both `validate()` and `run()` call `loadWorkflowDef` with `validateSchema: true` + same `embeddedSchemaOptions()`. `packages/app/src/services/workflow-service.ts:400-404` + `:456-462`. |
| R5 | MET | Explicit `validateSchema: true` on primary run load; rejecting schema fails with field `name` named and `embedded-spur` path. `packages/app/tests/services/workflow-service.test.ts:328-342`. |
| R6 | MET | `maybeLinkPipelineRun` uses `{ validateSchema: false }` after primary load already validated. `packages/app/src/services/workflow-service.ts:490-501`. |
| R7 | MET | Mechanism-level accept+reject test on `run`, not a single production YAML. `packages/app/tests/services/workflow-service.test.ts:283-343`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — workflow schema validation is verb-independent | MET | test | Shared embedded options + `validateSchema: true` on both verbs; reject path no `node_modules`. |
| R2 — schema resolution survives the absence of node_modules | MET | test | `mkdtemp(tmpdir())` + embedded map → `result.status === 'done'`. |
| R8 — each defect is covered at the shared mechanism | MET | test | Shared load mechanism test on `run`. |
| Non-regression: unknown field still fails run | MET | test | Rejecting schema → throw; message matches `/\bname\b/` and `/embedded-spur/`. |

**Command evidence (this run)**

```
$ bun test packages/app/tests/services/workflow-service.test.ts -t "run resolves a package-specifier"
1 pass, 0 fail, exit 0 (6 expect calls)
```

**Design conformance:** 4/4 in-scope claims DONE (pre-load, reuse helper, maybeLink align, regression tests).

**Coverage:** N/A for full-suite %; targeted regression executed this run.

**Fix-pass / residual close-out:**
- `.spur/run/0431-verdict.json` — feature-aligned AC ids
- Reject asserts: field name + no `node_modules` + `embedded-spur`
- Explicit `validateSchema: true` on `run` load (parity with `validate`)
- Requirements/Plan checklists completed; Review P1–P4 table; D3 feature `## Tasks` refreshed (0431 → done)
### Review
**SECUA review** (standalone verify --force) — aggregate: PASS

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P1 | — | — | None |
| P2 | — | — | None |
| P3 | E | `packages/app/src/services/workflow-service.ts:490-501` | `maybeLinkPipelineRun` re-parses YAML for name-only with `validateSchema: false` after the primary load already validated. Acceptable; not a correctness gap. |
| P4 | C | `packages/app/src/services/workflow-service.ts:456-462` | `run` pre-loads with `embeddedSchemaOptions()` + explicit `validateSchema: true` (parity with `validate`). Reject path names the field and uses `embedded-spur`, not `node_modules`. |
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-08-05T03:44:16.689Z todo → wip (system)
- 2026-08-05T03:53:19.286Z wip → testing (system)
- 2026-08-05T03:53:32.959Z testing → done (system)
