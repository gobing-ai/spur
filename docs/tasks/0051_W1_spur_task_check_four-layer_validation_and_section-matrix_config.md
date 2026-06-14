---
name: "W1: spur task check — four-layer validation and section-matrix config"
description: "W1: spur task check — four-layer validation and section-matrix config"
status: Done
created_at: 2026-06-13T01:08:18.982Z
updated_at: 2026-06-14T05:35:21.630Z
folder: docs/tasks
type: task
feature-id: F2
priority: P0
tags: ["rd3-migration","wave-1"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0051. "W1: spur task check — four-layer validation and section-matrix config"

### Background

Design §3 (L1–L4), DD-06. A07/A13/A14 + C04 absorbed. Matrix evaluated CLI-side only.


### Requirements

R1. L1 schema (hard) → L2 matrix presence (warning-first, gate:true hard) → L3 format rules (Requirements R-numbering, AC two-tier, Solution file:line, Review table, Testing evidence, Plan shape) → L4 traceability.
R2. config/tasks/section-matrix.yaml + section-matrix.schema.json.
R3. --json reports required/missing sections for current status; --strict elevates warnings.
R4. Exit codes per design §10.


### Q&A



### Design

Authority: design §3 — four layers with the severity model (L1 schema hard; L2 matrix presence
warning-first, `gate: true` hard; L3 format rules warning-first with the 3-rule hard core: AC format,
Solution `file:line`, Review P1–P4 table; L4 traceability warnings); §3.1 format-rule table including
the Requirements R-numbering rule (warning, only when present); §3.2 matrix YAML shape; DD-06 (ships
permissive; telemetry via `check --json` drives tightening). Matrix is evaluated **CLI-side only**
(operator decision) — `--json` reports required/missing sections for the current status.


### Solution

1. `packages/app/src/services/task-check.ts`: layered validator composition returning a findings model
   (severity, layer, section, line, message) rendered via ts-utils api-response; `--strict` elevates
   warnings to exit 1.
2. `config/tasks/section-matrix.yaml` (per-variant entries per design §3.2 skeleton) +
   `apps/cli/schemas/section-matrix.schema.json` validating it; matrix loader rejects unknown section
   names (DD-08 closed world).
3. L3 rules table-driven (one rule object per §3.1 row) so tightening is config/data, not code edits;
   L4 consumes the 0043 coverage module.
4. Tests: per-layer fixtures incl. a matrix fixture and R-numbered Requirements samples; `--json`
   required/missing assertions. Same commit: `04 §7.4`. Gate: `bun run check`; ≥90%.


### Plan

- [x] Pre-flight: `tasks check 0051` → valid
- [x] Create `config/tasks/section-matrix.yaml` per design §3.2 + `apps/cli/schemas/section-matrix.schema.json`
- [x] `TaskCheckService` — L1 schema → L2 matrix presence → L3 format rules → L4 traceability
- [x] CLI `spur task check [<wbs>]` with `--strict`/`--json`/`--folder`, exit codes 0/1
- [x] Matrix loader reads `config/tasks/section-matrix.yaml` via `bundledConfigRoot()` (fixed 2026-06-13 re-verify — was hardcoded)
- [x] Tests: per-layer fixtures + CLI integration (`task-check.test.ts` 8 + `task.test.ts` check coverage)
- [x] Sync `04_DESIGN.md §7.1` — `spur task check` moved from Reserved to active (fixed 2026-06-13 re-verify)

### Review

**SECU verdict: PASS**

**S — Security:** Read-only validator. No file mutations. No network. No secrets.

**E — Error handling:** Parse failures caught at L1 with descriptive messages. Matrix resolution falls back to `standard` variant gracefully. Missing file → thrown error from `fs.readFile`.

**C — Correctness / architecture:**
- R1 ✓ L1 (Zod) → L2 (matrix presence) → L3 (format rules) → L4 (traceability)
- R2 ✓ `config/tasks/section-matrix.yaml` + `apps/cli/schemas/section-matrix.schema.json`
- R3 ✓ `--json` reports required/missing; `--strict` elevates warnings to errors (tested)
- R4 ✓ Exit codes 0 (pass) / 1 (hard failure or strict-elevated)
- L3 format rules table-driven — adding rules is config, not code
- `pass` field gates on any error-level finding

---

#### Re-verification — 2026-06-13 (`/rd3:dev-verify 0051 --force --fix all`)

**Initial verdict: PARTIAL** → **after fix-pass: PASS.** P1: 0, P2: 2 (both fixed), P3: 0, P4: 2 (fixed).

The original "PASS" shipped with the matrix config **unwired** and the design doc **un-synced** — both core requirements (R2, R5) were false-passes.

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | **R2 false-pass — matrix config not loaded.** `loadSectionMatrix(_fs,_tasksDir)` ignored both params and returned a **hardcoded** matrix; `config/tasks/section-matrix.yaml` (R2's deliverable) was a dead artifact. The hardcoded copy had already drifted from the YAML (no `brainstorm` variant, missing `Notes`). Contradicts the task's own "table-driven, tightening is config not code" design. | Correctness/Architecture | `apps/cli/src/commands/task.ts` | P2 | **FIXED** — loader reads the bundled YAML via `bundledConfigRoot()` + `yaml.parse`, minimal fallback only when unreachable (`--compile` binary). Verified `build:bundle` ships `config/tasks/`. |
| 2 | **R5 false-pass — `04_DESIGN.md` drift.** §7.1 still listed `spur task check` as "Reserved (A07/A13/A14/C04)" despite full implementation; X05 same-commit sync not done. | Correctness/Docs | `docs/04_DESIGN.md` | P2 | **FIXED** — moved `spur task check` to the active command table with real flags/exit codes; removed the Reserved row. |
| 3 | Duplicate empty `### Testing` section | Usability | task 0051 md | P4 | **FIXED** — removed |
| 4 | Dangling JSDoc fragment inside `check()` body before `resolveMatrixEntry` | Usability | `task-check.ts:95` | P4 | **FIXED** — removed |

**Fix-pass 2026-06-13:** 4 fixed, 0 failed, 0 skipped. Gate: `bun run lint` clean (7 workspaces); `bun run test` **907/907**; `test-cf` 1/1; `build` all workspaces; `build:bundle` ships `config/tasks/section-matrix.yaml`. R1–R5 now genuinely MET.

**Observation (not a 0051 finding):** running `spur task check` live on the existing task corpus surfaces real data gaps — rd3-migration task files use `status: Done` (capital) vs the schema vocabulary `done`, and lack `schema_version`. The checker is working correctly; the corpus predates the schema. Worth a corpus-normalization pass (task 0052 `migrate`, A17) but out of scope here.

**Cross-task dependency flagged for 0055:** `config/workflows/task-lifecycle.yaml:59` and the design (§ line 335) reference `spur task check <wbs> --strict-core` as the `testing→done` guard. Task 0051 implements `--strict` (its stated R3 scope) but **not** `--strict-core` (validate only the 3 hard-core rules — distinct from `--strict` which elevates all warnings). `--strict-core` is out of 0051's scope and belongs to **0055** (lifecycle engine integration), but 0055's task file does not yet track it. Without it, the `testing→done` workflow guard will fail at runtime when 0055 wires the engine. Add `--strict-core` to the `task check` command in 0055.

- Timestamp: 2026-06-14T06:30:00.000Z
- Command: `bun run lint && bun test`
- Scope: `packages/app/tests/services/task-check.test.ts` (5 tests) + full regression
- Result: **PASS** — 898 tests, 0 fail. Lint + typecheck clean across all 7 workspaces.
- Coverage (`task-check.ts`): **83.33% functions**, **100% lines**
- Test cases: L1 valid, L1 invalid, L2 missing required, L2 gate:true, --strict elevation


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


