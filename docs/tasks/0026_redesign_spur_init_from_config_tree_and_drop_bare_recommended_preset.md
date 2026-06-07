---
name: redesign spur init from config tree and drop bare recommended preset
description: redesign spur init from config tree and drop bare recommended preset
status: Done
created_at: 2026-06-07T05:20:55.349Z
updated_at: 2026-06-07T06:18:18.386Z
folder: docs/tasks
type: task
feature-id: 
priority: high
estimated_hours: 5
dependencies: ["0025"]
tags: ["config","adr-015","init","breaking"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
preset: complex
---

## 0026. redesign spur init from config tree and drop bare recommended preset

### Background

Per ADR-015 and task feedback, after config centralization (0024, 0025) the 'spur init' command is redesigned 'structured-but-explicit': it scaffolds .spur/ from the resolved ./config defaults driven by a small reviewed manifest, with no embedded TS string literals. Separately, the bare 'recommended' preset is eliminated and 'recommended-pre-check' becomes the default for 'spur rule run'. This is a BREAKING CHANGE for scripts using --preset recommended. Blast radius (verified): production sites rule.ts:17,26,168; ~16 test assertions in rule-service.test.ts, rule.test.ts:157, migrate-stubs.test.ts:29, init.test.ts:44; rule-service.ts:303-310 comment. The bundled fallback at rule-service.ts:336 is name-independent and survives. Deliverable: the new init behavior + preset vocabulary.


### Requirements

Each item is independently verifiable. This task is **breaking** (drops the bare `recommended` preset) and **deletes** the embedded config strings — both gated on 0025 having wired resolution/seed.

1. **Add `scaffold-manifest.ts`.** `apps/cli/src/config/scaffold-manifest.ts` exports an explicit, reviewed list of the defaults `init` scaffolds into `.spur/` (each entry: source-relative path + target-relative path). Adding a future default = a one-line manifest edit, not new control flow. Verify: the manifest enumerates `rules/recommended-pre-check.yaml`, `rules/recommended-post-check.yaml`, `workflows/basic.yaml`.
2. **Rewrite `init.ts` to read from resolved config.** `init` scaffolds `.spur/` by iterating the manifest, reading each file from the resolved source (seeded `~/.config/spur`, fallback `bundledConfigRoot()` → `dist/config`), writing unless present or `--force`. Verify: `spur init` in a tmp project produces the same `.spur/` file set as before (golden-path parity).
3. **Delete the embedded strings.** Remove `RECOMMENDED_PRESET`, `SPUR_DEV_PRESET`, `BASIC_WORKFLOW` (init.ts:18-99, ~80 lines). Verify: `rg "RECOMMENDED_PRESET|SPUR_DEV_PRESET|BASIC_WORKFLOW" apps/cli/src` returns nothing.
4. **Drop the bare `recommended` default → `recommended-pre-check`.** Change all 4 production sites: `rule.ts:17` (BOTH the help text `default: recommended` and the option default value `'recommended'`), `rule.ts:26`, `rule.ts:168`. Update the `rule-service.ts:308` comment to reference `recommended-pre-check`. Verify: `rg "'recommended'|\"recommended\"|default: recommended" apps/cli/src packages/app/src | rg -v "recommended-(pre|post)"` returns nothing.
5. **Update preset-invocation test assertions only.** Change the ~13 `preset: 'recommended'` assertions (rule-service.test.ts:95,110,119,171,208,240,260,330,341,375,417,471,509; rule.test.ts:157; migrate-stubs.test.ts:29) → `recommended-pre-check`. **Do NOT** touch the inline fixture bodies `'name: recommended\nextends:\n  - boundary\n'` at rule-service.test.ts:554,642 — those are self-contained ad-hoc presets for a file-resolution test, unrelated to the bundled default (see Q&A note). Verify: those two fixture lines are unchanged in the diff.
6. **Fix the init seed assertion.** `init.test.ts:44` currently asserts `recommended.yaml` exists in the global dir; change it to assert the new seeded files (`recommended-pre-check.yaml` + `recommended-post-check.yaml` + `workflows/basic.yaml`) per the 0025 seed. Verify: the test asserts the post-0025 seeded set.
7. **Docs already updated; confirm sync.** ADR-015 + `04 §2.3` / §1.1 already reflect this change (committed in the design pass). Verify: no further `04_DESIGN.md` default-preset drift (`rg "default .recommended.\b" docs/04_DESIGN.md` finds only `recommended-pre-check`).

**Acceptance:** full gate green — `bun run lint && bun run test && bun run build`; `spur init` scaffolds from the manifest with no embedded strings; `spur rule run` with no `--preset` uses `recommended-pre-check`; no bare `recommended` preset reference in production code; the two inline test fixtures (554/642) untouched. Commit carries a `BREAKING CHANGE:` footer citing ADR-015.


### Q&A

**Constraints (synthesized — refine `--auto`):**

**Technical:**
- **BREAKING CHANGE.** Removing the bare `recommended` preset breaks any script using `spur rule run --preset recommended`. Commit message MUST carry a `BREAKING CHANGE:` footer citing ADR-015. Acceptable pre-1.0.
- **Two distinct `recommended` usages in tests — do not conflate.** (a) `preset: 'recommended'` *invocation assertions* → rename to `recommended-pre-check` (req #5). (b) inline fixture **bodies** `'name: recommended\nextends: [boundary]'` at rule-service.test.ts:554,642 → **leave alone**; they define a local ad-hoc preset for a file-resolution test and have nothing to do with the bundled default. A blanket find-replace is WRONG.
- **Pre-existing fixture mismatch (out of scope).** At 554/642 the file is written to `recommended-pre-check.yaml` but its YAML `name:` says `recommended`. This inconsistency predates this task; do NOT "fix" it here — it would expand scope and risk the test's intent. Flag for a separate cleanup if desired.
- **`init` parity.** The rewritten `init` must produce a byte-identical `.spur/` scaffold to the pre-refactor behavior (the extracted files are byte-faithful per 0024). Verify via golden-path comparison, not just "it runs".
- **Manifest, not control flow.** Defaults live in `scaffold-manifest.ts` as data; `init` iterates it. Adding a default must NOT require editing `init`'s logic.

**Boundary / surgical scope:**
- This task owns the init redesign + preset-name change ONLY. It consumes `bundledConfigRoot()` + `seedGlobalConfig` from 0025; it does NOT re-implement resolution, the build copy, or seeding.
- Does NOT touch `@gobing-ai/ts-rule-engine` — that cleanup is ts-libs task 0022, sequenced AFTER this is green.

**Dependency / sequencing:**
- Blocked on 0025 (needs `bundledConfigRoot()` + `seedGlobalConfig` wired). Last spur-new task in the chain. ts-libs 0022 unblocks only after this lands green.

**Risk:** highest blast radius of the three spur-new tasks (3 production files + ~15 test edits + ~80-line deletion + breaking). Land as one reviewable commit; full gate is the safety net.


### Design

- Scope: redesign `spur init` to scaffold from the config tree via a manifest; drop bare `recommended` preset; delete embedded TS string literals.
- Key decisions:
  - **Manifest-driven scaffold.** `scaffold-manifest.ts` is pure data — an explicit list of `{source, target}` entries. Adding a new default = one-line edit, no control-flow change in init.
  - **Source resolution via `bundledConfigRoot()`.** Init reads file content from the resolved config root (repo-root `config/` in dev, `dist/config/` in built), not from embedded TS template literals.
  - **BREAKING: bare `recommended` → `recommended-pre-check`.** All 4 production sites in `rule.ts` + `rule-service.ts` comment updated. Scripts using `--preset recommended` will break.
  - **Surgical test updates.** Only preset-invocation assertions changed; inline fixture bodies at rule-service.test.ts:557/645 left untouched (they test file-resolution, not the default preset name).
- Boundaries: `apps/cli/src/config/scaffold-manifest.ts` (new), `apps/cli/src/commands/init.ts` (rewrite scaffold, delete strings), `apps/cli/src/commands/rule.ts` (default preset name), `packages/app/src/services/rule-service.ts` (comment only), 3 test files.
- Risks: breaking change to `--preset recommended` users. Mitigated by pre-1.0 status.

### Solution

1. **New `scaffold-manifest.ts`.** Exports `SCAFFOLD_MANIFEST: readonly ScaffoldEntry[]` — three entries mapping bundled config paths to `.spur/` targets. Adding a future default = appending one entry.
2. **Rewrite init.ts scaffold loop.** Replaced hardcoded `writeIfNew(context, path, TEMPLATE_LITERAL, ...)` calls with a `for (entry of SCAFFOLD_MANIFEST)` loop that reads content from `bundledConfigRoot()` + `entry.source`. Falls back gracefully if `bundledConfigRoot()` returns `null`.
3. **Delete ~83 lines of embedded strings.** `RECOMMENDED_PRESET`, `SPUR_DEV_PRESET`, `BASIC_WORKFLOW` removed from init.ts. Also removed now-unused `LOCAL_RULES_DIR` and `LOCAL_WORKFLOWS_DIR` constants.
4. **Drop bare `recommended`.** Changed `rule.ts:17` (option default + help text), `rule.ts:26` (fallback), `rule.ts:168` (resolveSource fallback). Updated `rule-service.ts:308` comment.
5. **Test assertions updated.** ~15 `preset: 'recommended'` → `preset: 'recommended-pre-check'` across rule-service.test.ts, rule.test.ts, migrate-stubs.test.ts. Fixture bodies at 557/645 untouched.
6. **Init seed assertion expanded.** init.test.ts now asserts both ts-rule-engine bundled rules (`recommended.yaml`, `quality/*.yaml`) AND the new config seed files (`rules/recommended-pre-check.yaml`, `rules/recommended-post-check.yaml`, `workflows/basic.yaml`).

### Plan

- [x] Create `scaffold-manifest.ts` with explicit entry list
- [x] Rewrite init.ts scaffold to iterate manifest, reading from bundledConfigRoot
- [x] Delete embedded string constants (RECOMMENDED_PRESET, SPUR_DEV_PRESET, BASIC_WORKFLOW)
- [x] Remove unused LOCAL_RULES_DIR/LOCAL_WORKFLOWS_DIR constants
- [x] Drop bare `recommended` → `recommended-pre-check` in rule.ts (4 sites)
- [x] Update rule-service.ts comment
- [x] Update ~15 test assertions in rule-service.test.ts, rule.test.ts, migrate-stubs.test.ts
- [x] Fix init.test.ts seed assertion
- [x] Add scaffold-manifest.test.ts
- [x] Verify: `bun run spur-check` — all 21 rules pass
- [x] Verify: 549 tests pass, 0 fail
- [x] Verify: no bare `recommended` in production code
- [x] Verify: fixtures at 557/645 untouched

### Review

Verdict: **PASS** — independent re-verification 2026-06-07 (`/rd3:dev-verify 0026 --force --fix all`).

**Mode:** verify (Phase 7 SECU + Phase 8 traceability) · **Channel:** inline · **Gate:** `bun run lint` pass · `bun run test` → **549 pass / 0 fail** · `bun run build` → exit 0 (all workspaces, compiled binary built).

### Requirements traceability

- [x] **R1** `scaffold-manifest.ts` → **MET** | 3 entries (`rules/recommended-pre-check.yaml`, `rules/recommended-post-check.yaml`, `workflows/basic.yaml`); pure data, init iterates it. 3/3 manifest tests pass.
- [x] **R2** init reads from resolved config + **golden-path parity** → **MET** | Ran `spur init` in a clean tmp project with isolated global seed: scaffolded `.spur/rules/*` + `.spur/workflows/basic.yaml` are **byte-identical** to `config/` source (diff -q clean on all 3). Seed flow end-to-end: 6 rule files + 3 config files seeded.
- [x] **R3** embedded strings deleted → **MET** | `rg "RECOMMENDED_PRESET|SPUR_DEV_PRESET|BASIC_WORKFLOW" apps/cli/src` → empty. Unused `LOCAL_RULES_DIR`/`LOCAL_WORKFLOWS_DIR` also removed.
- [x] **R4** bare `recommended` dropped → **MET** | all 4 production sites (rule.ts:17 ×2, :26, :168) + rule-service.ts:308 comment updated; `rg` for bare recommended in `apps/cli/src`+`packages/app/src` → empty.
- [x] **R5** test edits surgical (the fixture-vs-invocation trap) → **MET** | inline fixtures at rule-service.test.ts:557,645 still read `name: recommended` (untouched, as required); no bare `preset: 'recommended'` invocation assertion remains. The blanket-rename footgun was correctly avoided.
- [x] **R6** init seed assertion → **MET** | init.test.ts asserts new config-seed files (lines 29-31, 48-50) AND retains the ts-rule-engine bundled `recommended.yaml` assertion (line 44) — correct until ts-libs 0022 removes that demo file.
- [x] **R7** docs sync → **MET** | `04_DESIGN.md:115` shows `default recommended-pre-check`; no bare-default drift.

### Findings

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | BREAKING CHANGE not yet committed | Usability/Process (P3) | working tree (uncommitted) | **OPEN — needs operator action.** Acceptance requires the change land with a `BREAKING CHANGE:` footer citing ADR-015. Work is staged but uncommitted (recent commits are unrelated `fix(rule-engine)` entries). Suggested commit: `feat(cli)!: drop bare 'recommended' preset; scaffold init from ./config manifest` + body + `BREAKING CHANGE: 'spur rule run --preset recommended' is removed; use recommended-pre-check (ADR-015).` Cannot auto-commit (operator gates commits). |

**SECU scan:** no Security/Efficiency/Correctness findings. init's manifest loop reads bundled files via `bundledConfigRoot()` with graceful `null` fallback; no injection/secret/unsafe-I/O. The breaking-change risk is product-intended (ADR-015), not a defect.

**Net:** all 7 functional requirements MET; golden-path parity proven byte-for-byte; the critical R5 fixture trap was handled correctly (unlike a naive blanket rename). The one open item is the BREAKING CHANGE commit footer — a process gate requiring an operator-approved commit, not a code change.


### Testing

- Command: `bun run spur-check` (lint + typecheck + pre-check rules + tests + post-check rules)
- Scope: full suite — 549 tests across 71 files including 3 new scaffold-manifest tests
- Result: **pass** — 549 pass, 0 fail, 1252 expect() calls
- Coverage: 99.80% functions, 99.47% lines aggregate
- Evidence: new `scaffold-manifest.test.ts` verifies manifest entries, target identity, and count. Existing init/rule tests pass with new default preset name. Fixture bodies at 557/645 verified unchanged.
- Next action: none — clean

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| source | apps/cli/src/config/scaffold-manifest.ts (new) | lord-robb | 2026-06-07 |
| source | apps/cli/src/commands/init.ts (rewrite + delete strings) | lord-robb | 2026-06-07 |
| source | apps/cli/src/commands/rule.ts (default preset rename) | lord-robb | 2026-06-07 |
| source | packages/app/src/services/rule-service.ts (comment) | lord-robb | 2026-06-07 |
| test | apps/cli/tests/config/scaffold-manifest.test.ts (new) | lord-robb | 2026-06-07 |
| test | packages/app/tests/services/rule-service.test.ts (assertions) | lord-robb | 2026-06-07 |
| test | apps/cli/tests/commands/rule.test.ts (assertion) | lord-robb | 2026-06-07 |
| test | apps/cli/tests/commands/migrate-stubs.test.ts (assertion) | lord-robb | 2026-06-07 |
| test | apps/cli/tests/commands/init.test.ts (seed assertions) | lord-robb | 2026-06-07 |
### References


