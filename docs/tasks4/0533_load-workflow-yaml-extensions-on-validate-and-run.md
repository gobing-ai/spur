---
template: feature-impl
schema_version: 1
name: "Load workflow YAML extensions on validate and run"
description: ""
status: done
type: task
profile: standard
feature_id: D4
parent_wbs: null
priority: P1
tags: ["workflow", "extensions"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T06:19:08.017Z"
updated_at: "2026-08-13T15:50:42.143Z"
---

## 0533. Load workflow YAML extensions on validate and run

### Background

`loadWorkflowExtensionsIntoHost` exists in `@gobing-ai/ts-dual-workflow-engine` but `WorkflowAppService.createEngineService` never calls it. `spur workflow run` therefore cannot use kinds listed only in YAML. Rule presets already declare `extensions.evaluators: [./file.ts]` and load them. After ts-libs C1 adds `extensions.actions` / `extensions.guards` to WorkflowDef, this task is the CLI consumer.

Implements: A listed action module is registered for the same file; A listed guard module is registered for the same file; validate and run fail closed on a bad extension; dry-run and continue use the same loaded host; Absolute and parent-traversal paths are rejected; Surface docs land with the code.

Depends on: ts-libs feature C1 (engine schema + collectWorkflowExtensions). Bump the catalog after C1 ships.

Rubric: E1 D1 L1 C1 R1 = 5 → one task (same host-build file surface).

### Requirements
- [x] R1. After loadWorkflowDef, collect extensions.actions / extensions.guards with baseDir = dirname(workflow file) and register them via loadWorkflowExtensionsIntoHost.
- [x] R2. validate, run (including --dry-run), and continue share that load path.
- [x] R3. When the YAML lists any extension, allowExtensions is true; a missing or invalid module fails the command before any step.
- [x] R4. Absolute paths and `..` are rejected with no import.
- [x] R5. The embedded $schema map and apps/cli/schemas copies include the new field (0431 parity).
- [x] R6. docs/04_DESIGN.md and the workflow extension skill reference document the block in the same commit (T3).

### Acceptance Criteria

```gherkin
Feature: Load workflow YAML extensions on validate and run

  Scenario: R1 — A listed action module is registered for the same file
    Given a workflow YAML lists extensions.actions: ["./exts/audit.ts"]
    And that module default-exports an action kind audit-log
    When spur workflow run executes a step with kind audit-log
    Then the host runs the extension action

  Scenario: R2 — A listed guard module is registered for the same file
    Given a workflow YAML lists extensions.guards: ["./exts/flag.ts"]
    And that module default-exports a guard kind feature-flag
    When a transition guard has kind feature-flag
    Then the host evaluates the extension guard

  Scenario: R3 — validate and run fail closed on a bad extension
    Given extensions.actions names a missing file or a module without actions[]
    When spur workflow validate or run is invoked
    Then the command fails before any workflow step

  Scenario: R4 — dry-run and continue use the same loaded host
    Given a workflow with a custom guard listed under extensions.guards
    When spur workflow run --dry-run or spur workflow continue runs
    Then the extension guard is registered and evaluated

  Scenario: R5 — Absolute and parent-traversal paths are rejected
    Given an extensions entry that is absolute or contains ..
    When validate or run is invoked
    Then the command fails and no import is attempted

  Scenario: R6 — Surface docs land with the code
    Given the implementing commit
    When 04_DESIGN.md and the workflow extension skill reference are read
    Then they document extensions.actions and extensions.guards
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: in createEngineService / the post-load path used by validate and run, call collectWorkflowExtensions then loadWorkflowExtensionsIntoHost with moduleLoader = import and node realPath. Trust: a project workflow YAML already runs shell; listing a relative module next to that file is the same trust class. The YAML declaration is the allowExtensions signal.

Rejected: --allow-extensions flag (extra surface; declaration is the gate); loading from ~/.spur or absolute paths; registering kk product plugins as builtins.

Invariants: same host for dry-run and continue; fail before first step; 0431 validate/run schema map stays aligned.

### Plan

1. Bump @gobing-ai/ts-dual-workflow-engine once ts-libs C1 is published/catalogued.
2. Add load-extensions helper used by validate, run, and continue.
3. Tests: temp YAML + temp extension module; happy path action/guard; missing module; abs/`..`; dry-run.
4. Refresh bundled schemas + 04 + skill reference.
5. bun test / lint green.

### Solution
Committed `2bf0fdb5` (8 files, +610/−72). Change map:

- **`packages/app/src/services/workflow-service.ts`** — R1/R2/R4 core:
  - `loadWorkflowExtensions(host, workflow, file)` (private) at `packages/app/src/services/workflow-service.ts:1079` — `collectWorkflowExtensions(workflow.name, dirname(file), workflow.extensions)` then `loadWorkflowExtensionsIntoHost(host, refs, { allowExtensions: true, moduleLoader: (p) => import(p), realPath: nodeFs.realPath })`. The YAML declaration is the allowExtensions gate (R3); the shared loader rejects abs/`..` paths before any import (R4) and throws on a missing/mis-shaped module.
  - `createEngineService` opts gain `extensions?: { workflow, file }`; loaded onto the host after `registerSpurBuiltins`, before the service is constructed — so `run` and `continue` execute on a host carrying YAML extensions (R2).
  - `run()` reorders def-load before service creation and passes `extensions` (dry-run uses the same host, R4).
  - `continuePaused` resolves the def + source path via `resolveWorkflowDefByName` (now returns `{ workflow, path }`) before building the service, and looks up the paused run via `RunDao.traceRowById` instead of a throwaway engine service (R4 same-host). Early `row?.status !== 'paused'` preserves the old error contract.
  - `validate()` loads extensions onto a bare `createDefaultWorkflowEngineHost()` inside the try — a bad extension surfaces as a validation error (R3 fail-closed) with the same load path.
- **`apps/cli/schemas/{state-machine,transition-flow}-workflow.schema.json`** — R5: top-level `extensions` property (`actions`/`guards` arrays) + `$defs.relativeExtensionPath`, mirroring the preset schema (0431 parity).
- **`bunfig.toml`** — `coveragePathIgnorePatterns` gains `**/spur-wf-ext-*/**` for the temp extension fixtures.
- **Docs (R6, T3 same-commit):** `docs/04_DESIGN.md` workflow section (YAML extensions bullet); `plugins/sp/skills/spur-cli/references/workflows.md` gotcha #5 (CLI loads YAML-declared extensions; declaration is the gate); `workflows/validation-and-extension.md` (YAML block syntax, CLI capability rows updated from `—` to ✅).

Key decisions: the YAML declaration is the trust signal (no `--allow-extensions` flag — rejected in design); paths resolve against the workflow file's own directory, never `~/.spur` or absolute; `validate` uses a bare host so the import+shape check happens without builtins/DB.
### Testing
Verification commands (all from repo root, main, commit `2bf0fdb5`):

| Command | Result |
| --- | --- |
| `bun run lint` (biome + 7-workspace typecheck) | pass |
| `bun run test` | 4978 pass / 0 fail across 277 files |
| `bun run build` | pass |
| `bun run corpus-check` | OK (0 new, 0 stale) |

Coverage claim (per-file line gate ≥ 90%):
- `packages/app/src/services/workflow-service.ts` — 99.47% lines; 8 new tests in `packages/app/tests/services/workflow-service.test.ts` under "workflow YAML extensions (0533 / D4)":
  - R1 action happy path — `extensions.actions: ["./exts/audit.ts"]` + module default-exports `{name, actions:[{kind:'audit-log',…}]}`; run reaches `done` and the action writes a marker file into the run workdir.
  - R2 guard happy path — `extensions.guards: ["./exts/flag.ts"]` + `{name, guards:[{kind:'feature-flag', evaluate: true}]}`; transition guard evaluated → `done`.
  - R3 validate fail-closed — missing module → `valid:false` with the module path in errors.
  - R3 run fail-closed — module without `actions[]` → rejects with `/actions\[\]/`.
  - R4 dry-run same host — guard registered + evaluated under `--dry-run` (guards run even when actions are skipped).
  - R4 continue same host — pausing workflow whose resume transition is gated by the extension guard; `continuePaused` re-registers it and resumes to `done` (would fail with unknown guard otherwise).
  - R4 abs path + `..` traversal — `validate` and `run` both reject with no import (`/relative|absolute/`, `/traversal|\.\./`).

Behavioral notes:
- Guard evaluation is not dry-run-gated (verified in `state-machine.ts` — only onEnter/onExit actions are skipped), which is what makes the R4 dry-run test meaningful.
- The shared loader enforces path guards at load time (`assertRelativeExtensionPath`) in addition to the schema superRefine — defense in depth; tests exercise the load-time path via `validate`.
- Temp extension fixtures (`spur-wf-ext-*` under OS tmp) are excluded from the per-file coverage gate via `bunfig.toml` — bun attributes dynamically-imported fixture coverage inconsistently across runs (80% vs 100% for identical source depending on resume-path attribution).
### Review
**SECUA + traceability review (2026-08-13). Verdict: PASS — ship.**

| Prio | Finding | Status |
| --- | --- | --- |
| P1 | None. R1–R6 satisfied with test evidence (8 new WorkflowAppService tests + schema + docs). | — |
| P2 | `continuePaused` switched its paused-run lookup from `svc.listPausedRuns()` to `RunDao.traceRowById` + `row?.status !== 'paused'`. Same error contract (verified by the existing E3 "not paused / unknown run" test); avoids a throwaway engine service before the def is resolved. | accepted |
| P2 | `validate` loads extensions onto a bare default host (no builtins/DB). Extension registration is only a shape+import check there; override-warning behavior differs from run (bare host has no builtins to warn about). Harmless for validation semantics. | accepted |
| P3 | `loadWorkflowExtensions` is private to WorkflowAppService — library consumers still call `loadWorkflowExtensionsIntoHost` directly with `allowExtensions: true`. Documented in the skill reference. | accepted |
| P3 | `allowExtensions: true` is unconditional when refs exist — the YAML declaration is the trust gate per the design. No `--allow-extensions` flag, matching the rejected-option record. | accepted |
| P4 | Workspace pre-existing dirt excluded from commit: `bun.lock`/`package.json` ts-libs 0.4.31 bump, `docs/help/*` regen, `occupant-wait.ts` WaitError tsdoc, satellite intro edit, `learnings.md` — concurrent-session/0530 leftovers left unstaged. | excluded |
| P4 | No new CLI noun, no schema divergence (R5 parity via embedded map + JSON copies), T3 same-commit docs. | — |

**Traceability (R1–R6):**
- R1 ✓ — action module registered for the same file; test `R1: a listed action module…`.
- R2 ✓ — guard module registered + evaluated; test `R2: a listed guard module…`.
- R3 ✓ — validate + run fail closed (missing module, mis-shaped module); tests.
- R4 ✓ — dry-run and continue use the same loaded host; abs/`..` rejected with no import; tests.
- R5 ✓ — both workflow JSON schemas carry `extensions` + `relativeExtensionPath` $def.
- R6 ✓ — `docs/04_DESIGN.md` + workflow extension skill reference updated same-commit.

**Disposition:** PASS. Residual risk low: extension loading is a per-run import behind the YAML declaration; path guards + fail-closed shape checks are enforced by the shared loader (defense in depth with the schema superRefine).
### References

D4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-13T15:50:03.336Z todo → wip (system)
- 2026-08-13T15:50:03.547Z wip → testing (system)
- 2026-08-13T15:50:35.351Z testing → done (system)
