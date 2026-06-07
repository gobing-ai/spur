---
name: wire config resolution build pipeline and global seed for spur
description: wire config resolution build pipeline and global seed for spur
status: Done
created_at: 2026-06-07T05:20:44.115Z
updated_at: 2026-06-07T05:58:52.269Z
folder: docs/tasks
type: task
feature-id: 
priority: high
estimated_hours: 4
dependencies: ["0024"]
tags: ["config","adr-015","build","seed"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: done
  testing: done
preset: standard
---

## 0025. wire config resolution build pipeline and global seed for spur

### Background

After ./config exists as SSOT (task 0024), the CLI must resolve those defaults at runtime and the build must ship them. Today rules resolve via @gobing-ai/ts-rule-engine's bundledRulesRoot() (import.meta.dirname walk) and seedGlobalRules (init.ts:138) copies bundled rules to ~/.config/spur/rules. Per ADR-015 the build copies ./config into apps/cli/dist/config (shipped via the package files array), runtime resolves bundled defaults from dist/config, and seeding generalizes to rules+workflows. The published 'bun install -g' path runs dist/index.js and reads dist/config directly; the --compile binary relies on the ~/.config/spur seed (documented caveat). Deliverable: default config assets are reachable at runtime and seeded to the user-global layer.


### Requirements

Each item is independently verifiable. Resolution must work in a **built** CLI (`dist/index.js`), not just under `bun run src` — the dev path and the shipped path resolve assets differently.

1. **Add `bundled-config.ts`.** `apps/cli/src/config/bundled-config.ts` exports `bundledConfigRoot(): string | null` and `listBundledConfigFiles(): string[]`, mirroring `ts-rule-engine/src/host/bundled-rules.ts` (cached `import.meta.dirname` walk to the `config` dir, YAML/JSON filter, `/`-joined relative paths). Verify: unit test resolves the root from a built layout and lists the seeded files.
2. **Build copies assets.** `apps/cli` `build:bundle` copies `./config` → `apps/cli/dist/config`. Verify: after `bun run build`, `test -f apps/cli/dist/config/rules/recommended-pre-check.yaml && test -f apps/cli/dist/config/workflows/basic.yaml`.
3. **Assets ship in the package.** `apps/cli/package.json` `files` includes the path that carries `dist/config` (currently `files: ["dist", "README.md"]` already covers `dist/` — confirm the copied tree lands under `dist/` so no `files` edit regresses publish). Verify: `bun pm pack --dry-run` (or `npm pack --dry-run`) lists `dist/config/**`.
4. **Generalize the seed.** Rename/extend `seedGlobalRules` (init.ts:138) → `seedGlobalConfig`, copying `dist/config/{rules,workflows}` → `~/.config/spur/{rules,workflows}`, never overwriting existing files, honoring `SPUR_GLOBAL_RULES_DIR`/equivalent test override. Verify: a test with a tmp home seeds both `rules/` and `workflows/` on first run and is a no-op on second run.
5. **Resolution works from the built CLI.** In a built CLI, `spur rule run --preset recommended-pre-check` resolves a real ruleset and `spur workflow validate <seeded basic.yaml>` exits 0, sourcing defaults from `dist/config` (not from the deleted-later embedded strings). Verify: run both against `dist/index.js`.
6. **Bundled fallback intact.** The `bundledRulesRoot()` layer appended at `rule-service.ts:336` (priority 20) still resolves preset *categories* (`typescript`/`quality`/`structure`) from the ts-rule-engine demo rules — this is name-independent and must keep working. Verify: existing `rule-service` tests stay green; `--preset recommended-pre-check` resolves its `extends:` categories with no local/global layer present.
7. **`--compile` caveat is honored, not "fixed".** The `bun build --compile` binary (`dist/cli/spur`) does NOT gain a sibling `dist/config`; it resolves defaults from `~/.config/spur` (the seed). Verify: `bundledConfigRoot()` returns `null` under the compiled binary and the code path falls back to the seeded global layer without error — do NOT add compiled-binary asset embedding in this task.

**Acceptance:** all seven checks pass; `bun run lint && bun run test && bun run build` green; `init.ts`'s embedded-string *content* is unchanged in this task (only the seed function is generalized — the string-deletion + init redesign is task 0026).


### Q&A

**Constraints (synthesized — refine `--auto`):**

**Technical:**
- **Two build modes resolve assets differently.** `build:bundle` → `dist/index.js` (published, reads sibling `dist/config`). `build --compile` → `dist/cli/spur` (single binary, no sibling files, relies on `~/.config/spur` seed). Requirements #5 and #7 must both hold; do not collapse them.
- **Do NOT add `--compile` asset embedding** in this task. The seed fallback is the accepted design (ADR-015). Embedding is explicitly out of scope.
- **Never overwrite** existing `~/.config/spur` files when seeding (preserve user customizations + `--force` re-init semantics).
- **`files` array:** confirm `dist/config` lands under the already-shipped `dist/` so no publish regression; only add an entry if the copy target sits outside `dist/`.

**Boundary / surgical scope:**
- This task wires resolution, build, and seed only. It does NOT redesign `init`'s scaffold flow, delete the embedded TS strings, or change the default preset name — those are task 0026. The embedded-string *content* in `init.ts` stays byte-identical here; only the seed function is generalized.
- Rule *evaluator* demo files stay owned by `@gobing-ai/ts-rule-engine` (ADR-015 D2); the `bundledRulesRoot()` fallback consumes them, this task does not move them.

**Dependency:**
- Blocked on 0024 (`./config` tree must exist to copy from). Blocks 0026 (init redesign consumes `bundledConfigRoot()` + `seedGlobalConfig`).

**Verification baseline:** primary path is `bun install -g` → `dist/index.js`. The compiled binary is the secondary path and is validated only for graceful fallback (req #7), not full asset parity.


### Design

- Scope: wire config resolution, build asset copy, and global config seeding.
- Key decisions:
  - `bundled-config.ts` lives in `packages/config/` (not `apps/cli/`) because `packages/app` (`rule-service.ts`) needs it and cannot import from `spur-cli`.
  - Walk-up resolution validates `config/rules` + `config/workflows` subdirs to avoid false-positive on coincidentally named directories.
  - New `bundled-config` layer at priority 15 in `rule-service.ts`, between global (10) and ts-rule-engine bundled (20).
  - `seedGlobalConfig` copies `rules/` and `workflows/` from bundled config root to `~/.config/spur/`, sharing the same `SPUR_GLOBAL_RULES_DIR` override for test isolation.
  - Build: `build:bundle` copies `../../config` → `dist/config`. The `build` (compile) path does NOT copy — compiled binary relies on `~/.config/spur` seed per ADR-015.
- Boundaries affected: `packages/config/src/bundled-config.ts` (new), `packages/config/src/index.ts` (re-export), `apps/cli/src/commands/init.ts` (seed generalization + new import), `packages/app/src/services/rule-service.ts` (new resolution layer), `apps/cli/package.json` (build:bundle copy step).
- Risks: `bundledConfigRoot()` returns `null` under compiled binary — all consumers must handle gracefully. Verified: `seedGlobalConfig` returns 0, `rule-service` skips the layer.

### Solution

1. **New `packages/config/src/bundled-config.ts`**: mirrors `ts-rule-engine`'s `bundled-rules.ts` pattern — cached `import.meta.dirname` walk-up to find `config/` dir with `rules/` + `workflows/` validation. Exports `bundledConfigRoot()`, `listBundledConfigFiles()`, `resetBundledConfigCache()`.
2. **Re-export from `@gobing-ai/spur-config`**: added to `packages/config/src/index.ts`.
3. **`build:bundle` asset copy**: `apps/cli/package.json` `build:bundle` now appends `&& cp -r ../../config dist/config`.
4. **`seedGlobalConfig` in `init.ts`**: new function copies all YAML/JSON from `bundledConfigRoot()` to `~/.config/spur/`, never overwriting. Called alongside existing `seedGlobalRules` (ts-rule-engine demo rules).
5. **`rule-service.ts` bundled config layer**: new layer `id: 'bundled-config'` at priority 15 resolves `config/rules/` from the bundled config root.
6. **Embedded string content**: unchanged (byte-verified). Only the seed function was generalized and a new call added.

### Plan

- [x] Create `packages/config/src/bundled-config.ts` with walk-up resolution
- [x] Re-export from `@gobing-ai/spur-config`
- [x] Update `build:bundle` to copy `config/` → `dist/config/`
- [x] Add `bundled-config.test.ts` (4 tests)
- [x] Add `seedGlobalConfig` to `init.ts`; call alongside `seedGlobalRules`
- [x] Add `bundled-config` resolution layer to `rule-service.ts` at priority 15
- [x] Fix lint issues (import ordering, unused import, non-null assertion)
- [x] Verify: `bun run lint && bun run test && bun run build:bundle` all green
- [x] Verify: `dist/config/` contains rules + workflows
- [x] Verify: `bun pm pack --dry-run` lists `dist/config/**`
- [x] Verify: embedded strings byte-identical to extracted files

### Review

Verdict: **PASS (with 1 P2 bug found + fixed)** — independent re-verification 2026-06-07 (`/rd3:dev-verify 0025 --force --fix all`).

**Mode:** verify (Phase 7 SECU + Phase 8 traceability) · **Channel:** inline · **Gate:** `bun run lint` pass + `bun run test` → **546 pass / 0 fail**.

### Requirements traceability

- [x] **R1** `bundled-config.ts` → **MET** (relocated to `packages/config/src/` per Design rationale — `packages/app` needs it, can't import from cli; sound deviation). Walk-up validates `rules/`+`workflows/` subdirs; returns `null` when absent. 4/4 unit tests pass.
- [x] **R2** build copies assets → **MET** | after `build:bundle`, `dist/config/rules/recommended-pre-check.yaml` + `dist/config/workflows/basic.yaml` present.
- [x] **R3** assets ship → **MET (after fix)** | `bun pm pack --dry-run` lists clean `dist/config/{rules,workflows,plugins}` under already-shipped `dist/`.
- [x] **R4** seed generalized → **MET** | `seedGlobalConfig` (init.ts:162) copies `rules/`+`workflows/` to `~/.config/spur/`, no-overwrite guard (line 175), honors `SPUR_GLOBAL_RULES_DIR`, returns 0 on null root. init tests green.
- [x] **R5** resolution from built CLI → **MET** | `bun dist/index.js rule run --preset recommended-pre-check` resolves (findings:[]); `workflow validate dist/config/workflows/basic.yaml` → `workflow valid: basic`.
- [x] **R6** bundled fallback intact → **MET** | new `bundled-config` layer at priority 15 (between global 10 and ts-rule-engine 20), rule-service.ts:341. rule-service tests 27 pass / 0 fail.
- [x] **R7** `--compile` caveat honored → **MET** | `bundledConfigRoot()` returns `null` (no sibling `config/`), consumers degrade gracefully (`seedGlobalConfig`→0, rule-service skips layer). No asset embedding added.

### Findings

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | `cp -r` non-idempotent → `dist/config/config/` double-nest on rebuild | Correctness/Packaging (P2) | apps/cli/package.json `build:bundle` | **FIXED** — `cp -r ../../config dist/config` copies the *directory* (not contents) when target exists, producing `dist/config/config/` on any rebuild without clean. Since `prepublishOnly` → `build:bundle` skips `clean`, `bun publish` could ship the broken nested tree AND `bundledConfigRoot()`/seed would walk the duplicate. Added `&& rm -rf dist/config` before the copy → idempotent. Verified: 2 consecutive builds now yield a single clean tree. |

**Note (doc drift, not a defect):** Artifacts table lists the test at `apps/cli/tests/config/bundled-config.test.ts`; it actually lives at `packages/config/tests/bundled-config.test.ts` (consistent with R1 relocation). Self-review's "546/546" and lint-clean claims independently confirmed.

**SECU scan:** no Security/Efficiency/Usability findings. `bundled-config.ts` resolution is bounded (walks to fs root, cached), no injection/secret/I/O-hot-path concerns. The one Correctness finding (build idempotency) is fixed.

**Net:** implementation sound; the self-review's single-build happy-path masked a rebuild/publish idempotency bug, now fixed under `--fix all`. Gate green post-fix.


### Testing

- Command: `bun run test`
- Scope: full test suite (546 tests across 70 files) including 4 new `bundled-config` tests
- Result: **pass** — 546 pass, 0 fail, 1242 expect() calls
- Coverage: 99.79% functions, 99.46% lines aggregate
- Evidence: new `bundled-config.test.ts` validates root resolution, file listing, exclusion filter, and cache reset. Existing init tests pass with new `seedGlobalConfig` call. `rule-service` tests pass with new layer.
- Next action: none — clean

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| source | packages/config/src/bundled-config.ts | lord-robb | 2026-06-07 |
| source | packages/config/src/index.ts (updated re-export) | lord-robb | 2026-06-07 |
| source | apps/cli/src/commands/init.ts (seed generalization) | lord-robb | 2026-06-07 |
| source | packages/app/src/services/rule-service.ts (new layer) | lord-robb | 2026-06-07 |
| source | apps/cli/package.json (build:bundle copy) | lord-robb | 2026-06-07 |
| test | apps/cli/tests/config/bundled-config.test.ts | lord-robb | 2026-06-07 |
### References


