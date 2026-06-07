---
name: centralize spur default config into repo-root config tree
description: centralize spur default config into repo-root config tree
status: Done
created_at: 2026-06-07T05:20:33.299Z
updated_at: 2026-06-07T05:43:03.673Z
folder: docs/tasks
type: task
feature-id: 
priority: high
estimated_hours: 3
dependencies: ["0023"]
tags: ["config","adr-015","refactor"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: done
  testing: done
preset: simple
---

## 0024. centralize spur default config into repo-root config tree

### Background

Per ADR-015, default config (rules/workflows/plugins) has no single home: spur-specific presets live in the generic @gobing-ai/ts-rule-engine package, and workflows/presets are hardcoded as TypeScript string literals in apps/cli/src/commands/init.ts (lines 18-99). This subtask creates the repo-root ./config single source of truth and extracts the embedded strings into real files, separating config assets from source code. Deliverable: the canonical ./config asset tree.


### Requirements

Each item is independently verifiable. Extraction must be **byte-faithful** — the new files reproduce the exact YAML the embedded strings emit today (init.ts is the source of truth until task 0026 deletes it).

1. **Create the asset tree.** `./config/rules/`, `./config/workflows/`, and `./config/plugins/` exist at repo root. Verify: `test -d config/rules && test -d config/workflows && test -d config/plugins`.
2. **Extract `recommended-pre-check.yaml`.** `config/rules/recommended-pre-check.yaml` reproduces the `RECOMMENDED_PRESET` string (init.ts:18-28) byte-for-byte (including the leading comment block and `extends: [typescript, structure, quality]`). Verify (this is a **preset** — `name`+`extends`, not a rule file — so validate via preset resolution, NOT `--file`): place it on a rules root and run `SPUR_RULES_PATH=<dir> spur rule validate --preset recommended-pre-check` → resolves a non-empty ruleset. (`--file` is for ad-hoc *rule* files with `id`/`evaluator` and will correctly reject a preset.)
3. **Extract `recommended-post-check.yaml`.** `config/rules/recommended-post-check.yaml` reproduces the `SPUR_DEV_PRESET` string (init.ts:31-37) byte-for-byte. Verify (preset, as in R2): `SPUR_RULES_PATH=<dir> spur rule validate --preset recommended-post-check` → resolves a non-empty ruleset.
4. **Extract `basic.yaml`.** `config/workflows/basic.yaml` reproduces the `BASIC_WORKFLOW` string (init.ts:44-99) byte-for-byte. Verify: `spur workflow validate config/workflows/basic.yaml` exits 0.
5. **Seed the plugins dir.** `config/plugins/.gitkeep` exists so the (currently empty) directory is tracked.
6. **No behavior change in this task.** `init.ts` still reads its embedded strings; the extracted files are not yet wired into resolution or build (that is tasks 0025/0026). Verify: `git diff apps/cli/src/commands/init.ts` is empty, and `bun run test` stays green.

**Acceptance:** all six checks pass; the only diff is new files under `./config` (plus this task's doc updates).


### Q&A

**Technical:**
- **Byte-faithful extraction only** — do NOT "improve", reformat, or re-indent the YAML while extracting. The strings in init.ts are the live source until task 0026 removes them; any drift creates a silent behavior change. Diff the extracted file against the embedded string to confirm equality.
- **No symlinks** — `./config` propagates by copy-and-resolve only (ADR-015 D7). Do not create `.spur/* -> config/*` links.
- **Surgical scope** — this task creates files only. Do NOT touch `init.ts` control flow, `bundled-config.ts`, the build script, or any test in this task; those belong to 0025/0026. The init.ts diff must be empty.

**Boundary:**
- Spur-owned presets/workflows only. Rule *evaluator* demo files remain owned by `@gobing-ai/ts-rule-engine` and are NOT copied here (ADR-015 D2).
- `./config/plugins` is a placeholder for future bundled plugins (ADR-012); no plugin content ships in this task.

**Dependency:**
- Blocks 0025 (resolution/build) and 0026 (init redesign) — they consume `./config`. Must land first.


### Design

- Scope: create `./config/{rules,workflows,plugins}` at repo root; extract 3 embedded YAML strings from `apps/cli/src/commands/init.ts` into real files.
- Key decision: byte-faithful extraction — no reformatting. init.ts is the source of truth until task 0026 removes the embedded strings.
- Boundaries affected: filesystem only (new files under `./config`). No source code changes, no test changes, no build changes.
- Risks: none beyond normal regression risk (files are inert until wired by 0025/0026).

### Solution

1. Create directories `config/rules/`, `config/workflows/`, `config/plugins/`.
2. Extract `RECOMMENDED_PRESET` (init.ts:18-28) → `config/rules/recommended-pre-check.yaml`.
3. Extract `SPUR_DEV_PRESET` (init.ts:31-37) → `config/rules/recommended-post-check.yaml`.
4. Extract `BASIC_WORKFLOW` (init.ts:44-99) → `config/workflows/basic.yaml`.
5. Add `config/plugins/.gitkeep` for directory tracking.
6. No changes to any existing file.

### Plan

- [x] Create `config/{rules,workflows,plugins}` directories
- [x] Extract `recommended-pre-check.yaml` (byte-faithful from init.ts:18-28)
- [x] Extract `recommended-post-check.yaml` (byte-faithful from init.ts:31-37)
- [x] Extract `basic.yaml` (byte-faithful from init.ts:44-99)
- [x] Add `config/plugins/.gitkeep`
- [x] Verify byte-faithful extraction via diff
- [x] Verify init.ts untouched
- [x] Run `bun run test` — must stay green
- [x] Run `bun run lint` — must stay clean

### Review

Verdict: **PASS** (implementation) — independent re-verification 2026-06-07 (`/rd3:dev-verify 0024 --force --fix all`).

**Mode:** verify (Phase 7 SECU + Phase 8 traceability) · **Channel:** inline · **Gate:** `bun run lint` → pass (biome + typecheck clean, 5 workspaces).

### Requirements traceability

- [x] **R1** asset tree exists → **MET** | `config/{rules,workflows,plugins}` all present.
- [x] **R2** `recommended-pre-check.yaml` byte-faithful → **MET** | embedded 339b == disk 339b (exact match vs `RECOMMENDED_PRESET`). Resolves as preset (`SPUR_RULES_PATH=… rule validate --preset recommended-pre-check` → non-empty ruleset).
- [x] **R3** `recommended-post-check.yaml` byte-faithful → **MET** | 240b == 240b (vs `SPUR_DEV_PRESET`). Resolves as preset.
- [x] **R4** `basic.yaml` byte-faithful → **MET** | 1438b == 1438b (vs `BASIC_WORKFLOW`). `spur workflow validate config/workflows/basic.yaml` → `workflow valid: basic`.
- [x] **R5** `config/plugins/.gitkeep` → **MET**.
- [x] **R6** no behavior change → **MET** | `git diff apps/cli/src/commands/init.ts` empty; lint/typecheck clean.

### Findings

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | R2/R3 verify command was wrong (`--file` vs preset) | Correctness (P3, requirement defect — not impl) | task 0024 Requirements R2/R3 | **FIXED** — `--file` validates ad-hoc rule files (`id`/`evaluator`) and correctly rejects a preset (`name`/`extends`). Corrected the acceptance command to preset resolution via `SPUR_RULES_PATH` + `--preset`. Implementation needed no change; the extracted files are byte-identical to what `init.ts` ships today and resolve correctly at runtime. |

**SECU scan:** no Security/Efficiency/Usability findings — task creates inert YAML assets only, no executable code, no secrets, no I/O paths. The single Correctness finding was in the *task requirement*, now fixed.

**Net:** implementation is correct and byte-faithful; the only defect was a mis-specified verify command in the requirement, fixed under `--fix all`. No source or config-file changes required.


### Testing

- Command: `bun run test`
- Scope: full test suite (542 tests across 69 files)
- Result: **pass** — 542 pass, 0 fail, 1234 expect() calls
- Coverage: 99.79% functions, 99.52% lines aggregate
- Evidence: no regressions; init.ts coverage unchanged at 100% functions / 99.21% lines
- Next action: none — clean

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| config | config/rules/recommended-pre-check.yaml | lord-robb | 2026-06-07 |
| config | config/rules/recommended-post-check.yaml | lord-robb | 2026-06-07 |
| config | config/workflows/basic.yaml | lord-robb | 2026-06-07 |
| config | config/plugins/.gitkeep | lord-robb | 2026-06-07 |

### References


