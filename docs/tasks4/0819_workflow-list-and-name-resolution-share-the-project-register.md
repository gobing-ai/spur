---
schema_version: 1
name: Workflow list and name resolution share the project, registered and shared layers
status: todo
template: feature-impl
created_at: 2026-09-10T22:18:37.281Z
updated_at: "2026-09-11T15:56:11.411Z"
feature_id: I21
priority: P2
tags:
  - workflow
  - cli

ac_numbering: task-local
---

## 0819. Workflow list and name resolution share the project, registered and shared layers

### Background

`spur workflow list` labels the installed package folder `project`, never shows the real `.spur/workflows` folder, and reads `workflows.paths`, which name resolution ignores. The catalog agents select from is therefore not what runs. This task makes listing and resolution share one ordered layer set (ADR-113).

Implements:
- R1 — workflow list labels the installed package folder as the shared layer
- R2 — workflow list always includes the project layer
- R3 — registered extra workflow folders are listed as their own layer
- R4 — list and resolution share one layer vocabulary
- R9 — every shared workflow has a catalog intent (the `description` field and parity test; the selection procedure lives in the spur-composer task)

Ordering: first. The spur-composer/spur-doctor task reads the `list --json` fields this task adds.

Rubric: E7 D1 L3 C0 R1 = 12 → own task: its own subsystem (app + CLI TypeScript), its own review lens (public CLI surface), and a different risk profile from the markdown-only plugin tasks.

### Requirements

- [ ] R1. `spur workflow list --json` labels the installed package's `config/workflows` folder (`bundledConfigRoot()/workflows`) as layer `shared`, and no `project` layer points outside the project.
- [ ] R2. The `project` layer (`<cwd>/.spur/workflows`) is always listed, in `--json` `layers` and as a human-output header, even when the folder is missing or empty.
- [ ] R3. Each `workflows.paths` entry that is not the project or shared folder is listed as a `registered` layer with its absolute path, in config order, deduped by normalized absolute path. Its entries carry `source: "registered"`, and the `~/.config/spur/` `global` mirror is removed.
- [ ] R4. One application function returns the ordered layers for both `WorkflowService.list` and bare-name resolution. The layer union is `project | registered | shared`, `spur workflow show <name> --json` carries `source: {layer, path}`, and readers of persisted `definitionSource.layer` map legacy `bundled` to `shared`.
- [ ] R5. Each `list --json` entry carries its definition's top-level `description` (or `null`), and a parity test fails when a `config/workflows/*.yaml` definition has no non-empty `description`.

### Acceptance Criteria

```gherkin
Feature: Workflow list and name resolution share the project, registered and shared layers

  Scenario: R1 — workflow list labels the installed package folder as the shared layer
    Given the installed spur package ships its workflows under config/workflows
    When `spur workflow list --json` runs in any project
    Then the layer whose path is the package workflows folder has id "shared"
    And no layer with id "project" points at a folder outside the project

  Scenario: R2 — workflow list always includes the project layer
    Given a project with no `.spur/workflows` folder
    When `spur workflow list --json` and `spur workflow list` run
    Then both list a layer with id "project" and path `<cwd>/.spur/workflows`
    And no workflow entry is attributed to that layer

  Scenario: R3 — registered extra workflow folders are listed as their own layer
    Given `workflows.paths` in the project or global config registers an extra folder
    When `spur workflow list --json` runs
    Then that folder appears as its own layer with its absolute path
    And its workflows are listed with that layer as their source
    And a registered path equal to the shared or project folder is not listed twice

  Scenario: R4 — list and resolution share one layer vocabulary
    Given a workflow name present in both the project and the shared layer
    When `spur workflow list --json` and `spur workflow show <name> --json` run
    Then both surfaces name layers with the same ids
    And name resolution picks the project copy
    And a persisted run whose layer is "bundled" still resumes as "shared"

  Scenario: R5 — every shared workflow has a catalog intent
    Given the shared workflow definitions in config/workflows
    When the catalog parity check runs
    Then every config/workflows definition has a non-empty top-level description
    And a definition without one fails the parity test
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-10T22:20:18.211Z

- **Public CLI consent: granted.** The operator consented to the layer model at idea-eval, and to `description`, `show --json` `source`, `bundled` → `shared` and the global-mirror removal at design-approval (2026-09-10).
- **Seeded `~/.config/spur/workflows` copy: not a layer.** It stays inert unless registered (ADR-113, D1), because a stale seeded copy would shadow shipped workflows.
- **Rule layers: not renamed.** Rules are per-project samples and outside I21 (D2).
- **Deferred:** stopping `seedGlobalConfig()` from copying workflows. It is a separate cleanup and not needed for R1–R5.
- **Decomposition:** the pre-batch-create quiz gate was auto-skipped under `--auto`. The rubric line is in Background.

### Design

**Approach.** Extend the existing resolver seam in `packages/app/src/workflow/workflow-resolver.ts` with one layer function. Both `WorkflowService.list` (`packages/app/src/services/workflow-service.ts:1380`) and bare-name resolution consume it, so `list` shows exactly the folders a name can resolve from (ADR-113; `docs/design/spur-artifact-evolution.md` §1, §6).

```ts
interface WorkflowLayer { id: 'project' | 'registered' | 'shared'; path: string }
function workflowLayers(opts: { cwd: string; registered: readonly string[] }): WorkflowLayer[];
```

**Rejected.**
- Relabeling inside `list` only: `list` and resolution would stay divergent.
- A fixed `global` tier at `~/.config/spur/workflows`: a stale seeded copy would shadow shipped workflows, and configuration-contracts already rules it out as a runtime tier.
- `registered:<n>` ids: the indexes shift whenever the config changes, and `path` already tells layers apart.

**Invariants.**
- Explicit file paths resolve first and keep the `project` label.
- `project` is always listed. `shared` is absent only when the package tree does not resolve (compiled binary).
- Dedupe compares normalized absolute paths after `bundled:` expansion, without a trailing slash. Legacy `.spur/workflows/`, `bundled:workflows` and an absolute package path collapse into project or shared.
- Rule layers keep their own vocabulary (`bundled` stays there).
- JSON changes are additive only (`description`, the `show` `source`). `layers`, `entries` and `totalFiles` keep their shape.

**Consent.** The operator consented to these public-surface changes: the layer model at idea-eval; `description`, `show --json` `source`, `bundled` → `shared` and the global-mirror removal at design-approval (2026-09-10).

### Plan

1. Resolver: add the layer function, probe the layers in order, rename the union to `project | registered | shared` (`workflow-resolver.ts:20`, `:30`, `:78`), and fix the stale ADR-099 citation (`:124`) to ADR-113. Extend `packages/app/tests/workflow/workflow-resolver.test.ts` (missing project folder, registered dedupe, shared absent, project shadows shared).
2. `WorkflowService.list`: scan the layers, drop the `global` mirror, set entry `source` to the layer id, and add `description`. Extend `packages/app/tests/services/workflow-service.test.ts`.
3. `apps/cli/src/commands/workflow.ts`: `resolveWorkflowPaths` (:370) returns registered extras only, `formatListHuman` prints empty layer headers, and `show --json` (:1218) adds `source`.
4. Legacy alias: `packages/domain/src/dao/run-dao.ts:18` and `packages/app/src/services/inline-run-setup.ts:70` read `bundled` as `shared`. Update the other `definitionSource` readers (`rg -n definitionSource apps packages` finds `apps/cli/src/history-refresh.ts`), and let typecheck surface any remaining consumer of the union.
5. `config/config.global.yaml`: drop `bundled:workflows` (:144) from `workflows.paths`.
6. Parity test: every `config/workflows/*.yaml` has a non-empty top-level `description`.
7. Run `bun link` in `apps/cli`, then `bun run --filter @gobing-ai/spur build:bundle`. Check `spur workflow list --json` here and in a temp project without `.spur/workflows`, then run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
