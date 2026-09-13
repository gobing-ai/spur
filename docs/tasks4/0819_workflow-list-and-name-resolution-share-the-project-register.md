---
schema_version: 1
name: Workflow list and name resolution share the project, registered and shared layers
status: done
template: feature-impl
created_at: 2026-09-10T22:18:37.281Z
updated_at: "2026-09-13T05:57:03.369Z"
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

- [x] R1. `spur workflow list --json` labels the installed package's `config/workflows` folder (`bundledConfigRoot()/workflows`) as layer `shared`, and no `project` layer points outside the project.
- [x] R2. The `project` layer (`<cwd>/.spur/workflows`) is always listed, in `--json` `layers` and as a human-output header, even when the folder is missing or empty.
- [x] R3. Each `workflows.paths` entry that is not the project or shared folder is listed as a `registered` layer with its absolute path, in config order, deduped by normalized absolute path. Its entries carry `source: "registered"`, and the `~/.config/spur/` `global` mirror is removed.
- [x] R4. One application function returns the ordered layers for both `WorkflowService.list` and bare-name resolution. The layer union is `project | registered | shared`, `spur workflow show <name> --json` carries `source: {layer, path}`, and readers of persisted `definitionSource.layer` map legacy `bundled` to `shared`.
- [x] R5. Each `list --json` entry carries its definition's top-level `description` (or `null`), and a parity test fails when a `config/workflows/*.yaml` definition has no non-empty `description`.

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/workflow.ts:1204` |
| `apps/cli/src/commands/workflow.ts:1208` |
| `apps/cli/src/commands/workflow.ts:1223` |
| `apps/cli/src/commands/workflow.ts:1250` |
| `apps/cli/src/commands/workflow.ts:1275` |
| `apps/cli/src/commands/workflow.ts:1390` |
| `apps/cli/src/commands/workflow.ts:1394` |
| `apps/cli/src/commands/workflow.ts:1401` |
| `apps/cli/src/commands/workflow.ts:1416` |
| `apps/cli/src/commands/workflow.ts:1420` |
| `apps/cli/src/commands/workflow.ts:1424` |
| `apps/cli/src/commands/workflow.ts:16` |
| `apps/cli/src/commands/workflow.ts:29` |
| `apps/cli/src/commands/workflow.ts:356` |
| `apps/cli/src/commands/workflow.ts:364` |
| `apps/cli/src/commands/workflow.ts:44` |
| `apps/cli/src/commands/workflow.ts:591` |
| `apps/cli/src/commands/workflow.ts:746` |
| `apps/cli/tests/commands/init.test.ts:299` |
| `apps/cli/tests/commands/init.test.ts:303` |
| `apps/cli/tests/commands/init.test.ts:77` |
| `apps/cli/tests/commands/workflow.test.ts:146` |
| `apps/cli/tests/commands/workflow.test.ts:155` |
| `apps/cli/tests/commands/workflow.test.ts:2493` |
| `apps/cli/tests/commands/workflow.test.ts:2549` |
| `apps/cli/tests/config-layering.test.ts:175` |
| `apps/cli/tests/config-layering.test.ts:183` |
| `packages/app/src/index.ts:608` |
| `packages/app/src/index.ts:614` |
| `packages/app/src/services/inline-run-setup.ts:220` |
| `packages/app/src/services/inline-run-setup.ts:36` |
| `packages/app/src/services/inline-run-setup.ts:42` |
| `packages/app/src/services/inline-run-setup.ts:74` |
| `packages/app/src/services/workflow-service.ts:1` |
| `packages/app/src/services/workflow-service.ts:1098` |
| `packages/app/src/services/workflow-service.ts:11` |
| `packages/app/src/services/workflow-service.ts:1100` |
| `packages/app/src/services/workflow-service.ts:1106` |
| `packages/app/src/services/workflow-service.ts:1111` |
| `packages/app/src/services/workflow-service.ts:1151` |
| `packages/app/src/services/workflow-service.ts:1388` |
| `packages/app/src/services/workflow-service.ts:1396` |
| `packages/app/src/services/workflow-service.ts:1397` |
| `packages/app/src/services/workflow-service.ts:1399` |
| `packages/app/src/services/workflow-service.ts:1401` |
| `packages/app/src/services/workflow-service.ts:1404` |
| `packages/app/src/services/workflow-service.ts:1558` |
| `packages/app/src/services/workflow-service.ts:1567` |
| `packages/app/src/services/workflow-service.ts:1990` |
| `packages/app/src/services/workflow-service.ts:1993` |
| `packages/app/src/services/workflow-service.ts:2107` |
| `packages/app/src/services/workflow-service.ts:2112` |
| `packages/app/src/services/workflow-service.ts:2148` |
| `packages/app/src/services/workflow-service.ts:2154` |
| `packages/app/src/services/workflow-service.ts:2171` |
| `packages/app/src/services/workflow-service.ts:2174` |
| `packages/app/src/services/workflow-service.ts:2186` |
| `packages/app/src/services/workflow-service.ts:374` |
| `packages/app/src/services/workflow-service.ts:382` |
| `packages/app/src/services/workflow-service.ts:388` |
| `packages/app/src/services/workflow-service.ts:545` |
| `packages/app/src/services/workflow-service.ts:550` |
| `packages/app/src/services/workflow-service.ts:556` |
| `packages/app/src/services/workflow-service.ts:59` |
| `packages/app/src/services/workflow-service.ts:62` |
| `packages/app/src/services/workflow-service.ts:664` |
| `packages/app/src/workflow/workflow-resolver.ts:114` |
| `packages/app/src/workflow/workflow-resolver.ts:124` |
| `packages/app/src/workflow/workflow-resolver.ts:131` |
| `packages/app/src/workflow/workflow-resolver.ts:15` |
| `packages/app/src/workflow/workflow-resolver.ts:179` |
| `packages/app/src/workflow/workflow-resolver.ts:183` |
| `packages/app/src/workflow/workflow-resolver.ts:187` |
| `packages/app/src/workflow/workflow-resolver.ts:189` |
| `packages/app/src/workflow/workflow-resolver.ts:192` |
| `packages/app/src/workflow/workflow-resolver.ts:196` |
| `packages/app/src/workflow/workflow-resolver.ts:2` |
| `packages/app/src/workflow/workflow-resolver.ts:204` |
| `packages/app/src/workflow/workflow-resolver.ts:206` |
| `packages/app/src/workflow/workflow-resolver.ts:211` |
| `packages/app/src/workflow/workflow-resolver.ts:249` |
| `packages/app/src/workflow/workflow-resolver.ts:255` |
| `packages/app/src/workflow/workflow-resolver.ts:259` |
| `packages/app/src/workflow/workflow-resolver.ts:264` |
| `packages/app/src/workflow/workflow-resolver.ts:281` |
| `packages/app/src/workflow/workflow-resolver.ts:284` |
| `packages/app/src/workflow/workflow-resolver.ts:288` |
| `packages/app/src/workflow/workflow-resolver.ts:290` |
| `packages/app/tests/services/workflow-service.test.ts:18` |
| `packages/app/tests/services/workflow-service.test.ts:3285` |
| `packages/app/tests/services/workflow-service.test.ts:3326` |
| `packages/app/tests/services/workflow-service.test.ts:674` |
| `packages/app/tests/services/workflow-service.test.ts:684` |
| `packages/app/tests/services/workflow-service.test.ts:717` |
| `packages/app/tests/services/workflow-service.test.ts:722` |
| `packages/app/tests/services/workflow-service.test.ts:728` |
| `packages/app/tests/services/workflow-service.test.ts:750` |
| `packages/app/tests/services/workflow-service.test.ts:769` |
| `packages/app/tests/services/workflow-service.test.ts:779` |
| `packages/app/tests/services/workflow-service.test.ts:797` |
| `packages/app/tests/workflow/workflow-resolver.test.ts:384` |
| `packages/app/tests/workflow/workflow-resolver.test.ts:6` |
| `packages/app/tests/workflow/workflow-resolver.test.ts:8` |
| `packages/domain/src/dao/index.ts:26` |
| `packages/domain/src/dao/run-dao.ts:35` |
| `packages/domain/src/dao/run-dao.ts:9` |

Re-audit fix (R4, 2026-09-12): `packages/app/src/workflow/workflow-resolver.ts:282` resolves listed names by layer before shared filename fallback. `apps/cli/src/commands/workflow.ts:1207` lets the shared resolver handle registered-only names for show. Regressions: `packages/app/tests/workflow/workflow-resolver.test.ts:486` and `apps/cli/tests/commands/workflow.test.ts:2590`; both reproduced the defect before the fix and pass after it. `docs/design/spur-artifact-evolution.md:19` clarifies name precedence.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Shared layer is last and points to the package folder. `packages/app/src/workflow/workflow-resolver.ts:85`; `packages/app/tests/workflow/workflow-resolver.test.ts:406`. Executed: `bun run spur-check` (exit 0). |
| R2 | MET | Missing project directories retain their layer and human header. `packages/app/src/services/workflow-service.ts:1414`; `packages/app/tests/services/workflow-service.test.ts:805`. Executed: `bun run spur-check` (exit 0). |
| R3 | MET | Registered paths retain config order and deduplicate normalized project/shared paths. `packages/app/src/workflow/workflow-resolver.ts:97`; `packages/app/tests/workflow/workflow-resolver.test.ts:416`. Executed: `bun run spur-check` (exit 0). |
| R4 | MET | Name resolution now honors project/registered/shared precedence; show accepts registered-only names; explicit paths remain pinned. `packages/app/src/workflow/workflow-resolver.ts:283`; `packages/app/tests/workflow/workflow-resolver.test.ts:487`; `apps/cli/tests/commands/workflow.test.ts:2591`. Executed: `bun run spur-check` (exit 0). |
| R5 | MET | Descriptions are exposed and shared catalog intents are checked. `packages/app/tests/services/workflow-service.test.ts:843`; `packages/app/tests/workflow/workflow-catalog-parity.test.ts:13`. Executed: `bun run spur-check` (exit 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — workflow list labels the installed package folder as the shared layer | MET | test | Shared layer is last and points to the package folder. `packages/app/src/workflow/workflow-resolver.ts:85`; `packages/app/tests/workflow/workflow-resolver.test.ts:406`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R2 — workflow list always includes the project layer | MET | test | Missing project directories retain their layer and human header. `packages/app/src/services/workflow-service.ts:1414`; `packages/app/tests/services/workflow-service.test.ts:805`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R3 — registered extra workflow folders are listed as their own layer | MET | test | Registered paths retain config order and deduplicate normalized project/shared paths. `packages/app/src/workflow/workflow-resolver.ts:97`; `packages/app/tests/workflow/workflow-resolver.test.ts:416`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R4 — list and resolution share one layer vocabulary | MET | test | Name resolution now honors project/registered/shared precedence; show accepts registered-only names; explicit paths remain pinned. `packages/app/src/workflow/workflow-resolver.ts:283`; `packages/app/tests/workflow/workflow-resolver.test.ts:487`; `apps/cli/tests/commands/workflow.test.ts:2591`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R5 — every shared workflow has a catalog intent | MET | test | Descriptions are exposed and shared catalog intents are checked. `packages/app/tests/services/workflow-service.test.ts:843`; `packages/app/tests/workflow/workflow-catalog-parity.test.ts:13`. Executed: `bun run spur-check` (exit 0). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Requirements, Design and Plan mapped to current implementations and tests; documented extraction choices preserved. |
| P4 | quality-gate | — | `bun run spur-check` exit 0; final log `.spur/run/I21-verifyall-20260912/spur-check-final.log`. |
| P4 | build-and-cloudflare | — | build:scripts, CLI/server/web builds, build:bundle and test-cf exited 0. |
| P4 | secua-review | — | All five dimensions checked; re-audit fixes on 0819, 0823 and 0825 have red/green regression evidence. |
| P4 | artifact-disclosure | — | Rebuilt `.spur/run/0819-verify-answer.txt:1-41` and `.spur/run/0819-verdict.json` from fresh evidence; Testing rendered by task record. |
| P4 | cli-golden-path-present | — | Source-local workflow show/validate --json invocations and CLI subprocess regression passed. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-11T18:03:37.244Z todo → wip (system)
- 2026-09-11T18:38:43.494Z wip → testing (system)
- 2026-09-11T18:39:01.725Z testing → done (system)

