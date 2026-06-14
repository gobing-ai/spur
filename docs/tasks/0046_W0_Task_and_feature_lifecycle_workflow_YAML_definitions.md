---
name: "W0: Task and feature lifecycle workflow YAML definitions"
description: "W0: Task and feature lifecycle workflow YAML definitions"
status: Done
created_at: 2026-06-13T01:08:18.981Z
updated_at: 2026-06-13T13:45:00.000Z
folder: docs/tasks
type: task
feature-id: F4
priority: P0
tags: ["rd3-migration","wave-0"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0046. "W0: Task and feature lifecycle workflow YAML definitions"

### Background

Design §2.3/§5.1, ADR-022, DD-13. Lifecycles are engine configuration, not code.


### Requirements

R1. config/workflows/task-lifecycle.yaml: §2.3 task graph, guards at wip→testing (check) and testing→done (strict core + Testing evidence), reopen with warning.
R2. config/workflows/feature-lifecycle.yaml: §2.3 feature graph incl. verifying (DD-13) with its guards.
R3. Both validate against the engine schemas; spur workflow validate clean.
R4. Same-commit 04_DESIGN §7.5 sync.


### Q&A



### Design

Authority: design §2.3 (both lifecycle graphs + guard placement), §5.1 (state-machine skeleton), ADR-022
(lifecycles are engine configuration — no local FSM), DD-13 (`verifying`). Engine syntax precedent:
`config/workflows/feature-dev.yaml` (states/onEnter/transitions/guards) and the two engine JSON schemas
in `apps/cli/schemas/`.

Shape: states = the §2.3 statuses; transitions = the §2.3 graphs; guards = shell/CLI guards invoking
`spur task check` (wip→testing warning-first; testing→done strict core + Testing evidence) and
`spur feature check` (verifying entry/exit per DD-13). `terminalStates: [cancelled]`; `done` re-enterable
(reopen, warned).


### Solution

1. `config/workflows/task-lifecycle.yaml` + `config/workflows/feature-lifecycle.yaml`, `kind:
   state-machine`, validated by `spur workflow validate` against the existing engine schemas.
2. Guards reference the check verbs by CLI string; since 0051/0057 land later in W1/W2, wire guard steps
   now with the exact final commands — structural validation passes today, behavioral wiring activates as
   the verbs ship (no YAML rework).
3. Status names in YAML are the lowercase canon (DD-01) — these files and the 0041 enums must never
   drift: add a test that parses both YAMLs and asserts state sets == the schema unions.
4. Same commit: `04_DESIGN.md §7.5` lifecycle shapes (X05). Gate: `bun run check` + workflow validate.


### Plan
1. Created `config/workflows/task-lifecycle.yaml` — `kind: state-machine`, 7 states matching `TASK_STATUSES`, `initialState: backlog`, `terminalStates: [cancelled]`. Transitions encode the full §2.3 graph: forward (backlog→todo→wip→testing→done), reopen (done→wip), blocked↔(todo/wip/testing), cancel from all non-terminals. Guards: `wip→testing` runs `spur task check ${vars.wbs}` (shell guard); `testing→done` runs `spur task check ${vars.wbs} --strict-core`. All other transitions use `always` guard (externally-driven via `requestTransition`).
2. Created `config/workflows/feature-lifecycle.yaml` — `kind: state-machine`, 6 states matching `FEATURE_STATUSES` (incl. `verifying` per DD-13), same initial/terminal pattern. Transitions: forward (backlog→active→verifying→done), rework (verifying→active), blocked↔active, cancel from all non-terminals. Guards: `active→verifying` runs `spur feature check ${vars.featureId}`; `verifying→done` runs `spur feature check ${vars.featureId} --strict`.
3. Created `packages/domain/tests/planning/lifecycle-drift.test.ts` — 16 tests asserting YAML state sets == `TASK_STATUSES`/`FEATURE_STATUSES` unions, initial/terminal correctness, DD-13 transitions (verifying), re-enterable `done`, no-cancel-egress.
4. Updated `04_DESIGN.md` — added §7.5 with lifecycle table, guard placements, drift-prevention note, validation instructions.
5. Both YAMLs validated via `spur workflow validate` — full JSON-Schema validation passes. The `$schema` ref points at `@gobing-ai/spur/schemas/state-machine-workflow.schema.json` (the schema the CLI ships and exports), which resolves from `config/workflows/`. (Dev-verify 2026-06-13 corrected the original dead `@gobing-ai/ts-dual-workflow-engine/...` ref, which never resolved; `feature-dev.yaml` was fixed in the same pass.)

### Review
- R1 ✅: `config/workflows/task-lifecycle.yaml` — §2.3 task graph encoded. Guards at `wip→testing` (`spur task check`, warning-first) and `testing→done` (`spur task check --strict-core`). Reopen `done→wip` allowed with warning. `cancelled` terminal.
- R2 ✅: `config/workflows/feature-lifecycle.yaml` — §2.3 feature graph including `verifying` (DD-13). Guards at `active→verifying` and `verifying→done` (`--strict`). Rework `verifying→active` allowed.
- R3 ✅: Both validate via `spur workflow validate` (full JSON-Schema, no `--no-schema`). Engine semantic validator passes: all transition endpoints declared, no terminal state has outgoing transitions, unguarded transitions are last (none — all use `always`/`shell` guards).
- R4 ✅: `04_DESIGN.md §7.5` updated same-commit with lifecycle table, guard placements, drift-prevention note.
- Drift prevention ✅: `lifecycle-drift.test.ts` (16 tests) asserts YAML state sets == schema unions. The YAMLs and 0041 enums cannot drift silently.
- Design note: unconditional transitions use the engine's built-in `always` guard because lifecycle FSMs are externally-driven via `requestTransition` (not auto-advance). The engine's semantic validator treats bare (unguarded) transitions as unconditional auto-advance, requiring them to be declared last — using explicit guards avoids this constraint while preserving correct semantics.

#### Dev-Verify — 2026-06-13 (`--force --fix all`, full SECU + traceability)

**Verdict: PASS** — 0 P1, 0 P2, 0 P3, 0 P4; 4/4 requirements MET. (One P3 found and **fixed** in the same pass — see below.)

Phase 8 — Requirements traceability (verified live):

- [x] **R1** → **MET** | `config/workflows/task-lifecycle.yaml:18-32` (7 states == `TASK_STATUSES`), `:50-59` (shell guards `spur task check` / `--strict-core`), `:62-66` (done→wip reopen). Test `lifecycle-drift.test.ts:38-60`.
- [x] **R2** → **MET** | `config/workflows/feature-lifecycle.yaml:24-27` (`verifying`, DD-13), `:42-57` (shell guards `spur feature check` / `--strict`), `:60-64` (verifying→active rework). Test `lifecycle-drift.test.ts:97-111`.
- [x] **R3** → **MET** | Both return `workflow valid` under `spur workflow validate` with **full JSON-Schema validation** (re-ran live, no `--no-schema`).
- [x] **R4** → **MET** | `docs/04_DESIGN.md` §7.5 — table, guard placements, drift-prevention note, validation instructions (updated this pass).

Phase 7 — SECU (config YAML + test; minimal attack surface):

- Security: no secrets; guard commands are static templates with engine-controlled var interpolation (`${vars.wbs}`), no user-controlled shell input. Correctness: graphs match canonical unions exactly (drift test enforced). Efficiency/Usability: N/A / well-documented.
- **P3 (Info) — FIXED:** the `$schema` ref pointed at `@gobing-ai/ts-dual-workflow-engine/schemas/…`, a package that isn't installed at root and ships no `schemas/` dir — the ref was dead and full JSON-Schema validation silently fell back to needing `--no-schema`. Repointed to `@gobing-ai/spur/schemas/state-machine-workflow.schema.json` (the schema the CLI actually owns/ships/exports). Now resolves; full validation passes. Same dead ref in the pre-existing `feature-dev.yaml` was corrected in the same pass for consistency.

Gate: `bun run lint` clean (211 files, 7/7 workspaces typecheck); drift suite 16/16 pass; all three `config/workflows/*.yaml` pass full `spur workflow validate`. Status `Done` confirmed correct.


### Testing
Full suite: `bun run spur-check` — lint clean (211 files), 7/7 workspaces typecheck, 752 pass / 0 fail.
Pre-check: 21/21 rules pass. Post-check: 2/2 rules pass.
Workflow validate: both YAMLs pass `spur workflow validate` with full JSON-Schema validation (schema-ref resolves; semantic invariants: state/transition integrity, no terminal-egress, template vars resolve).

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| impl | `config/workflows/task-lifecycle.yaml` | main | 2026-06-13 |
| impl | `config/workflows/feature-lifecycle.yaml` | main | 2026-06-13 |
| test | `packages/domain/tests/planning/lifecycle-drift.test.ts` | main | 2026-06-13 |
| docs | `docs/04_DESIGN.md` §7.5 | main | 2026-06-13 |

### References
- Design §2.3: `docs/design/rd3-migration-design.md` L137-175 (canonical statuses + lifecycle graphs)
- Design §5.1: `docs/design/rd3-migration-design.md` L317-337 (lifecycle definitions skeleton)
- ADR-022: `docs/00_ADR.md` (lifecycles are engine configuration)
- DD-13: feature `verifying` status (design §2.3 L158-171, §15 L630)
- Schema unions: `packages/domain/src/planning/schema.ts` (`TASK_STATUSES`, `FEATURE_STATUSES`)
- Engine schema: `apps/cli/schemas/state-machine-workflow.schema.json`
- Engine validation: `~/xprojects/ts-libs/packages/dual-workflow-engine/src/config.ts` (`validateStateMachine`)
- Engine guard types: `~/xprojects/ts-libs/packages/dual-workflow-engine/src/host.ts` (built-in `always`, `never`, `action-ok`, `shell` guards)
