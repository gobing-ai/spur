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
updated_at: "2026-08-04T18:34:14.011Z"
---

## 0431. spur workflow run validates against node-resolved schemas instead of the embedded map

### Background



### Requirements
`spur workflow run` resolves a workflow's `$schema: "@gobing-ai/spur/schemas/<name>.schema.json"`
ref through ordinary node resolution instead of the embedded-schema map that `spur workflow validate`
uses. The run path calls `loadWorkflowDef(resolve(this.ctx.cwd, file))` with **no options**
(`packages/app/src/services/workflow-service.ts:441`), while validate passes
`this.embeddedSchemaOptions()` (`packages/app/src/services/workflow-service.ts:378-379`).

Two consequences:

1. **A `--compile` binary cannot run any bundled workflow.** `embeddedSchemas` exists precisely
   because a compiled binary has no `node_modules` at runtime (documented at
   `packages/app/src/services/workflow-service.ts:313-319`). `validate` honors that contract; `run`
   does not, so schema resolution fails outright wherever `node_modules` is absent.
2. **In a dev tree, `run` silently validates against a stale published schema.** If any ancestor
   directory carries an installed `@gobing-ai/spur`, resolution walks up to it and validates against
   that package's schema rather than the working tree's `apps/cli/schemas/`. Uncommitted schema
   extensions are invisible to `run`, and the resulting error reads as an authoring bug in the
   workflow YAML.

Fix the asymmetry: the run path must pass the same embedded-schema options the validate path passes,
so a single resolution contract covers both verbs.
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

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

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
