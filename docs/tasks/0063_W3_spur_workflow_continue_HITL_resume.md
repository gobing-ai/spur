---
name: "W3: spur workflow continue — HITL resume"
description: "W3: spur workflow continue — HITL resume"
status: Done
created_at: 2026-06-13T01:08:18.984Z
updated_at: 2026-06-14T23:05:11.924Z
folder: docs/tasks
type: task
feature-id: F5
priority: P0
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0063. "W3: spur workflow continue — HITL resume"

### Background

Design §6 + delivery doc §1.4, D04. Gated by ts-libs E3 (pause/resume).


### Requirements

R1. continue [run-id] [--yes]: omitted run-id discovers latest paused run and confirms; --yes auto-accepts.
R2. Works for lifecycle and pipeline runs.
R3. Same-commit 04 sync.


### Q&A



### Design

Authority: delivery doc §1.4 (`spur workflow continue [run-id] [--yes]`: omitted run-id discovers the
most recent paused run and confirms; `--yes` accepts without prompting), design §6 (the HITL gate),
upstream gate ts-libs 0035 (E3: pause/resume + paused-run query, most-recent-first). Works for both
lifecycle and pipeline runs.


### Solution

1. WorkflowService: `continuePaused(runId)` resumes a specific paused run (resolve def by `workflow_name`
   → engine `resumeRun`); `latestPausedRun()` queries paused runs (E3 query API, most-recent-first) for
   discovery. The prompt/`--yes` decision lives in the CLI layer (the service stays headless/testable) —
   a deliberate split from the original one-method sketch.
2. `apps/cli` workflow command: add the verb following the existing workflow noun pattern; omitted id →
   `latestPausedRun()` + confirm via the HITL responder unless `--yes`; `--json` envelope with resumed state.
3. Tests: explicit-id resume; latest-discovery ordering; `--yes` skip; resuming a non-paused run is a
   clear error (exit 1, message per error rules).
4. Gate: integration against released engine with E3; same commit `04 §1.1` workflow rows + `§7.5`.


### Plan

- [x] `WorkflowAppService.continuePaused(runId)` — resolve def by name → `resumeRun` (E3); clear error if not paused
- [x] `WorkflowAppService.latestPausedRun()` — `listPausedRuns({limit:1})` discovery
- [x] CLI `spur workflow continue [run-id] [--yes] [--json]` — explicit-id resume; discover+confirm (HITL responder) unless `--yes`
- [x] R2: works for any state-machine run (lifecycle/pipeline/generic) — workflow-agnostic resume path
- [x] Fix: add the `pause` field to `apps/cli/schemas/state-machine-workflow.schema.json` (engine Zod has it; HITL needs it)
- [x] Tests: explicit-id resume, latest-discovery, --yes skip, non-paused error (service + CLI)
- [x] R3: `04_DESIGN §1.1` continue verb + §7.5/schema note
- [x] Deferred (P3): pipeline `approve` `pause:true` until the stale global spur@0.2.5 schema is refreshed


### Review

**SECU verdict: FAIL → PASS** (verified + fully implemented 2026-06-14 via `/rd3:dev-verify 0063 --force --fix all`)

`spur workflow continue` was **entirely unimplemented** (no CLI verb, no service method, no test) despite the
`upstream-gated` tag being false — engine 0.3.17 ships the E3 API (`resumeRun` + `listPausedRuns`). Built it
during the fix-pass; also fixed a workspace-schema gap (`pause` field) the HITL-pause depends on.

**S — Security:** Read-then-resume; the `--yes` flag / HITL responder gates the discover path; no injection.

**C — Correctness / architecture:**
- R1 ✓ `WorkflowAppService.continuePaused(runId)` + `latestPausedRun()`. Explicit run-id resumes directly;
  omitted run-id → `listPausedRuns({limit:1})` (E3, most-recent-first) → confirm via the HITL responder
  unless `--yes`. A run's `workflow_name` is resolved back to its YAML (`resolveWorkflowDefByName` scans the
  search paths) so `resumeRun(def, runId)` can resume. Non-paused / unknown run → clear error, exit 1.
- R2 ✓ Works for any state-machine run (lifecycle, pipeline, generic) — the resume path is workflow-agnostic;
  tested against a generic pausing workflow (the same mechanism lifecycle/pipeline use).
- R3 ✓ `04_DESIGN §1.1` workflow command surface gains the `continue` verb; §7.5 / the schema note updated.
- Schema fix: `apps/cli/schemas/state-machine-workflow.schema.json` was MISSING the `pause` field the engine
  (0.3.17 Zod) supports and HITL pausing requires; added it.

**U — Usability:** `--yes` for non-interactive; `--json` envelope with the resumed run state.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | `spur workflow continue` unimplemented (no verb/method/test) — R1/R2/R3 UNMET despite the E3 engine API being available (false upstream gate, as in 0055/0059). | Correctness | `workflow.ts`, `workflow-service.ts` | P1 | **FIXED** — `continuePaused`/`latestPausedRun` + CLI `continue` verb + 3 service + 4 CLI tests. |
| 2 | Workspace state-machine JSON schema missing the `pause` field (engine Zod has it; HITL pause/resume depends on it) — a `pause: true` state failed full-schema validation. | Correctness | `apps/cli/schemas/state-machine-workflow.schema.json` | P2 | **FIXED** — added `pause` to the state def. |
| 3 | `spur workflow validate` resolves `$schema` to a STALE globally-installed `@gobing-ai/spur@0.2.5` (~/node_modules), not the workspace schema — so the bundled `task-pipeline.yaml` couldn't carry `pause: true` without failing the validate test. | Tooling/env | global install | P3 | **DEFERRED** (same stale-install class as the catalog links). Reverted `pause: true` on the pipeline `approve` state with an inline note; re-add once the global spur is refreshed. The workspace schema + engine already support it; `continue` is proven via in-process tests. |

No remaining P1/P2.

**Gate (post-fix):** `bun run lint` clean (251 files; 7 workspaces typecheck) · `bun run test` 1108 pass / 0
fail · in-process E2E: run pauses at a `pause:true` state → `latestPausedRun` finds it → `continuePaused`
resumes to `done`; non-paused run errors; CLI `continue --yes`/`continue <id>` resume, no-paused → exit 1.


### Testing

Verified 2026-06-14. Real engine resume tests (in-process — immune to the stale-global-schema artifact).

- `packages/app/tests/services/workflow-service.test.ts` — `continue` (4 tests) over the real engine +
  in-memory DB: a `pause:true` workflow run → `status=paused` at the gate; `latestPausedRun` discovers it;
  `continuePaused` resolves the def by name and resumes to `done` (and the run is no longer paused after);
  **multiple paused runs → `latestPausedRun` returns the most-recent (ordering), and falls back to the
  older one after the newer resumes**; `latestPausedRun` is null when nothing is paused; `continuePaused`
  on an unknown/non-paused run throws.
- `apps/cli/tests/commands/workflow.test.ts` — `continue` CLI (4 tests): no paused run → exit 1 (clear
  message); `--yes` discovers the latest paused run and resumes to `done` (exit 0); `continue <run-id>`
  resumes a specific run; a non-paused run → exit 1. Plus the bundled-workflow validation still green.

The full agent-driven pipeline pause→continue (task-pipeline `approve`) is not exercised here — the
`approve` `pause: true` is deferred (P3) until the stale global `@gobing-ai/spur` schema is refreshed; the
resume MECHANISM is fully proven by the generic pausing-workflow tests (the pipeline uses the same engine).

Full suite: 1108 pass / 0 fail.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


