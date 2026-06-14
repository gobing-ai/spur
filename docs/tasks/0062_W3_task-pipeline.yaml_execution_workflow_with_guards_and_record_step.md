---
name: "W3: task-pipeline.yaml — execution workflow with guards and record step"
description: "W3: task-pipeline.yaml — execution workflow with guards and record step"
status: Done
created_at: 2026-06-13T01:08:18.984Z
updated_at: 2026-06-14T22:38:41.793Z
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

## 0062. "W3: task-pipeline.yaml — execution workflow with guards and record step"

### Background

Design §6, D01/D05/D06. Orchestration is configuration: existing engine, no new machinery. Pipeline writes only via spur task update.


### Requirements

R1. precheck(task check guard) → implement → test → review → approve(HITL) → verify → record → done/failed, vars: wbs.
R2. record step writes ## Testing/## Review via spur task update --section.
R3. Status transitions requested through the normal verb (lifecycle guards apply).
R4. Run linkage in task_run_links; profile var can skip approve.


### Q&A



### Design

Authority: design §6 (pipeline shape: precheck → implement → test → review → approve(HITL) → verify →
record → done/failed; vars: wbs; profiles via `--var`, never a YAML fork), invariants: the pipeline never
touches files directly (record writes via `spur task update --section`; status transitions via the
normal verb so lifecycle guards apply identically), run linkage in `task_run_links` (kind=pipeline).
Precedent for step kinds: `config/workflows/feature-dev.yaml` (agent.run, rule.check, shell guards).
ADR-022/§3.2 principle: orchestration is configuration — this task ships YAML + zero engine code.


### Solution

1. `config/workflows/task-pipeline.yaml`: states per design §6; precheck guard = shell guard
   `spur task check <wbs>`; implement/test/review/verify = `agent.run` steps carrying `sp:dev-*` command
   inputs; record = shell steps generating section files and calling `spur task update --section`.
2. `approve` state pauses (E3 semantics) unless the profile var skips it.
3. Validation: `spur workflow validate` clean; e2e dry test with a stub agent spec exercising the full
   happy path + precheck-fail path on a temp project.
4. task_run_links row written at run start (hook in WorkflowService or a first shell step). Same commit:
   `04 §7.5`. Gate: `bun run check`.


### Plan

- [x] `config/workflows/task-pipeline.yaml` — full §6 pipeline (states + vars.wbs/profile), zero engine code
- [x] Fix the dead `$schema` ref → `@gobing-ai/spur/schemas/state-machine-workflow.schema.json` (validates clean)
- [x] R1: precheck→implement `shell` guard `spur task check ${wbs}`; fail fall-through to `failed`; agent.run steps for implement/test/review/verify
- [x] R2: record writes `## Testing`/`## Review` via `spur task update --section --from-file` (generates the file in the shell step)
- [x] R3: status transitions via the normal verb (`spur task update ${wbs} wip|testing|done` — lifecycle guards apply)
- [x] R4 (partial): `approve` = `hitl.confirm`, skippable via `--var profile=auto`; `task_run_links` linkage flagged as a WorkflowService hook follow-up (no link-writing CLI verb)
- [x] Tests: bundled-workflow validation (all 5 YAMLs) + 7 task-pipeline structural assertions
- [x] R-doc: `04_DESIGN §7.5` task-pipeline paragraph + R4 follow-up note


### Review

**SECU verdict: FAIL → PASS** (verified + fixed 2026-06-14 via `/rd3:dev-verify 0062 --force --fix all`)

As shipped, `task-pipeline.yaml` was a skeleton stub with a **dead `$schema` ref** (pointing at
`@gobing-ai/ts-dual-workflow-engine/schemas/...` — which ships no schemas dir, so `workflow validate`
FAILED), states using `name:` instead of `id:`, no `vars`, no guards, no actions. R1–R4 effectively
UNMET. Authored the full pipeline during the fix-pass (YAML only — "orchestration is configuration").

**S — Security:** Pipeline never touches files directly; status + section writes go through the `spur task
update` verb (lifecycle guards apply); shell commands interpolate a validated `wbs` var. No injection surface.

**C — Correctness / architecture:**
- R1 ✓ States `precheck → implement → test → review → approve → verify → record → done` (+ `failed`),
  `vars: { wbs, profile }`. `precheck→implement` guarded by a `shell` guard `spur task check ${vars.wbs}`;
  the engine's `firstPassingTransition` falls through to `precheck→failed` (always) on a failing check —
  E2E-verified: a missing task → `failed`; a check-passing task advances past precheck.
- R2 ✓ `record` writes `## Testing` + `## Review` ONLY via `spur task update --section --from-file` (the
  shell step generates the section file then updates — never a direct file write).
- R3 ✓ Status transitions use the normal verb: `spur task update ${wbs} wip` (implement), `… testing`
  (record), `… done` (done) — so the 0055 lifecycle guards apply identically.
- R4 ◑ `approve` is a `hitl.confirm` gate, skippable via `--var profile=auto`; **but** the `task_run_links`
  row (kind=pipeline) is NOT written — there is no link-writing CLI verb to call from a shell step, so it
  needs a small `WorkflowService` run-start hook. Documented as a follow-up (Background notes the surface;
  §7.5 records the gap). Zero-engine-code scope (the task's stated principle) precludes adding it here.
- Schema ✓ `$schema` corrected to `@gobing-ai/spur/schemas/state-machine-workflow.schema.json`; validates
  with full JSON-Schema resolution (no `--no-schema`).

**U — Usability:** `--var profile=auto` skips the HITL gate; states carry descriptions.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | Dead `$schema` ref (`@gobing-ai/ts-dual-workflow-engine/schemas/...`) → `workflow validate` failed to resolve the schema (the documented DNR pattern). | Correctness | `task-pipeline.yaml:7` | P1 | **FIXED** — `@gobing-ai/spur` ref; validates clean. Added a bundled-workflow validation test covering all 5 YAMLs to catch regressions. |
| 2 | Skeleton stub: states used `name:` (schema wants `id:`), no `vars`, no guards, no actions — R1–R4 unimplemented. | Correctness | `task-pipeline.yaml` | P1 | **FIXED** — full state graph + precheck shell guard + agent.run + hitl.confirm + record-via-update + status-verb steps. |
| 3 | R4 `task_run_links` linkage (kind=pipeline) not written. Confirmed no CLI verb writes a run link, so the Solution's "first shell step" alternative is not viable; needs a code hook. Note: the pipeline's status-verb steps DO write `task_run_links` rows of kind=`lifecycle` (via the 0055 LifecycleAdapter) during the run, so partial linkage exists — just not the kind=`pipeline` row. | Correctness | `task-pipeline.yaml` / WorkflowService | P3 | **FLAGGED** — the kind=`pipeline` row needs a `WorkflowService` run-start hook (outside zero-engine-code scope); documented in §7.5 + Background. |

No remaining P1/P2.

**Gate (post-fix):** `bun run lint` clean (251 files; 7 workspaces typecheck) · `bun run test` 1100 pass / 0
fail · `spur workflow validate` clean (full schema) · E2E precheck-fail → `failed`; precheck-pass advances.


### Testing

Verified 2026-06-14. Config + structural tests (this task ships YAML, not code).

- `apps/cli/tests/commands/workflow.test.ts` — bundled-workflow validation: all 5 `config/workflows/*.yaml`
  (task-pipeline, task-lifecycle, feature-lifecycle, feature-dev, basic) validate with **full** JSON-Schema
  resolution (no `--no-schema`) — this would have caught the original dead-`$schema` regression.
- `packages/domain/tests/planning/lifecycle-drift.test.ts` — task-pipeline structure (7 tests): R1 states +
  `vars.wbs`; precheck→implement shell guard (`spur task check`) with the fail fall-through ordered after;
  R2 record writes via `spur task update --section` (Testing + Review); R3 status moves via the verb
  (wip/testing/done); R4 approve is `hitl.confirm`; the `$schema` is the resolvable `@gobing-ai/spur` ref
  (not the dead engine ref); all transition endpoints are declared states.

E2E through the real CLI: `spur workflow validate config/workflows/task-pipeline.yaml` → valid; a `workflow
run` with `wbs=0000` (no such task) → precheck shell guard fails → falls through to `failed` (the §6 fail
path); a `workflow run` with a check-passing task advances past precheck.

**Not automatable here — the full agent-driven happy path.** The Solution called for a "stub agent spec"
happy-path test, but `agent.run` invokes the real `AgentService.run` (spawns an actual coding-agent CLI;
`isAgentName` rejects a non-canonical stub `type`), and `--dry-run` still evaluates the `shell` guards (so
it can't skip the precheck check). A complete precheck→…→done walk therefore needs a real agent installed +
a check-passing task + `--var profile=auto` (skips the HITL gate) — an integration/manual test, not a unit
test. The deterministic slices (validate, precheck-fail E2E, precheck-pass guard, structural assertions)
are all covered; the agent middle is verified manually.

Full suite: 1100 pass / 0 fail.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


