---
schema_version: 1
name: Let a project declare which tests a non-code corpus change affects
status: todo
template: feature-impl
created_at: 2026-11-27T18:20:16.898Z
updated_at: "2026-11-27T18:20:58.087Z"
feature_id: H16

ac_altitude: task-local
ac_numbering: task-local
---

## 1474. Let a project declare which tests a non-code corpus change affects

### Background

```gherkin
@core
Scenario: AC1 — A declared corpus mapping selects its test across workspaces (req: R1, R2)
  Given builder.scopeTestMap declares "^plugins/kk/workflows/.*\\.yaml$" → apps/cli/tests/kk-news-generate-dag.test.ts
  When the light gate scopes a change to plugins/kk/workflows/kk-news-generate.yaml
  Then the selected tests include apps/cli/tests/kk-news-generate-dag.test.ts
  And the workspace carrying that test is admitted to the plan

@core
Scenario: AC2 — The map never widens a project that declares none (req: R3)
  Given a project with no scopeTestMap
  When the light gate scopes the same YAML change
  Then the selection is identical to today's (no tests added, no error)

@edge
Scenario: AC3 — A bad mapping fails config load, a stale one degrades quietly (req: R4)
  Given builder.scopeTestMap declares an invalid regular expression
  When the project config loads
  Then the load fails naming builder.scopeTestMap
  And a declared test path that no longer exists is skipped by the exists filter instead of failing
```

### Requirements

Add a configurable changed-scope test map (builder.scopeTestMap) that lightScope() applies before the generic src→tests filename mapping, dedupes and exists-filters; migrate nothing (opt-in); document the key in the design doc and prove it with affected-scope tests.

### Acceptance Criteria

```gherkin
@core
Scenario: AC1 — A declared corpus mapping selects its test across workspaces (req: R1, R2)
  Given builder.scopeTestMap declares "^plugins/kk/workflows/.*\\.yaml$" → apps/cli/tests/kk-news-generate-dag.test.ts
  When the light gate scopes a change to plugins/kk/workflows/kk-news-generate.yaml
  Then the selected tests include apps/cli/tests/kk-news-generate-dag.test.ts
  And the workspace carrying that test is admitted to the plan

@core
Scenario: AC2 — The map never widens a project that declares none (req: R3)
  Given a project with no scopeTestMap
  When the light gate scopes the same YAML change
  Then the selection is identical to today's (no tests added, no error)

@edge
Scenario: AC3 — A bad mapping fails config load, a stale one degrades quietly (req: R4)
  Given builder.scopeTestMap declares an invalid regular expression
  When the project config loads
  Then the load fails naming builder.scopeTestMap
  And a declared test path that no longer exists is skipped by the exists filter instead of failing
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Shape.** The changed-scope test map is a project-declared list of `{ when, tests }` entries in
`.spur/config.yaml`, beside the existing `builder.actions` bindings:

```yaml
builder:
  scopeTestMap:
    - when: "^plugins/kk/workflows/.*\\.yaml$"
      tests: ["apps/cli/tests/kk-news-generate-dag.test.ts"]
    - when: "^plugins/kk/publish-presets/.*\\.json$"
      tests: ["apps/cli/tests/publish-matrix.test.ts"]
    - when: "^plugins/(generations|publishings|ingestions)/[^/]+/plugin\\.json$"
      tests: ["packages/kk-core/tests/registry.test.ts"]
```

**Consumption.** `lightScope(changedFiles, exists, graph)` gains an optional fourth parameter
carrying the compiled map, so every existing caller keeps today's behaviour. Entries are applied
per changed file, before the `plugins/sp/**` block, with the same `exists()` filter and the same
`Set` dedupe as the rest of the selection. A pattern that matches nothing is not an error — a
project may declare a mapping for a corpus it has not grown yet.

**Validation.** `when` is a regular expression compiled at config load; an invalid pattern fails
config load with the key path (never a silent skip). `tests` entries are repo-relative paths,
validated only by `exists` at selection time (the same latitude the generic mapping takes), so a
renamed test degrades to "not selected" rather than a crash.

**Why config, not code.** The `plugins/sp/**` hardcode is one project's knowledge living in the
engine. Generalizing it is the same amount of code and stops the next project from needing a patch
release; migrating the sp block can follow as a separate, behaviour-preserving change (out of scope
here, so this task cannot alter sp's own gate results).

**Fallbacks.** No map → unchanged behaviour. A changed file that matches both the map and the
generic rule unions both tests (deduped). The full tier remains the safety net.

### Plan

1. Schema first: add `scopeTestMap` to the config schema (`builder.scopeTestMap[]` with `when`,
   `tests`), plus a validation test for a bad regex and an empty `tests` list.
2. Loader: read and compile the map where `builder.actions` is read; pass it into `lightScope`
   (optional arg — default `undefined` keeps every current caller and fixture byte-identical).
3. Selection: apply map entries per changed file before the `plugins/sp/**` block, dedupe, filter
   with the injected `exists`. Tests in `packages/app/tests/services/quality-gate-affected-scope.test.ts`:
   a YAML change selects the declared test from another workspace, a matching-and-generic change
   unions both, and an unmatched pattern selects nothing.
4. Surface: document the key in the design doc's config table (same commit — T3 rule) and note the
   opt-in nature in the release notes.
5. Dogfood: add the three knowledge-kit entries (`plugins/kk/workflows/**`, `plugins/kk/publish-presets/**`,
   `plugins/*/*/plugin.json`) to that project's `.spur/config.yaml` and confirm the DAG-shape suite
   is selected by a YAML-only change (`spur task gate <wbs> light` on a scratch task).
6. `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-27T18:20:58.087Z backlog → todo (system)

