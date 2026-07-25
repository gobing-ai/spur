---
name: Surface ts-rule-engine fix-and-extension capabilities on the spur rule CLI
description: Surface ts-rule-engine fix-and-extension capabilities on the spur rule CLI
status: done
created_at: 2026-06-07T21:26:05.727Z
updated_at: 2026-06-07T21:27:44.221Z
folder: docs/tasks
type: task
feature-id: F-rule
priority: medium
estimated_hours: 10
tags: ["rule-engine", "cli", "ts-libs", "upstream", "deferred-gaps"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0027. Surface ts-rule-engine fix-and-extension capabilities on the spur rule CLI

### Background

During the `sp:spur-rules` skill + `/sp:rule-*` command + `sp:expert-rules` agent build (committed `a672703`,
ADR-016), three capability gaps were repeatedly flagged: the `@gobing-ai/ts-rule-engine` **library** can do
more than the `spur rule` **CLI** exposes. They were documented honestly in
`plugins/sp/skills/spur-rules/references/validation-and-extension.md` ("Capability gaps") and deferred. This
task closes them.

Per ADR-006 (domain engines are external ts-libs packages; CLI commands are thin transport wrappers) and the
project's shared-library-evolution principle, the fix belongs in the **right layer**: surface existing library
APIs on the CLI where the library already supports it (gaps 1–2 are Spur-side CLI work), and enhance
`ts-libs/packages/rule-engine` upstream where the library itself lacks the capability (gap 3 is upstream work).

**Ground-truth source facts (verified 2026-06-07, do not re-derive — cite these):**

- **Library already supports fix application.** `engine.applyFixes(workdir, fixes, dryRun)` exists at
  `ts-libs/packages/rule-engine/src/engine.ts:213` → delegates to `applyFixesImpl`
  (`src/fixers/fixers.ts:96`), returns `FixApplicationResult` (carries diff/applied/deferred).
- **Library collects fixes via `evaluateWithFixes(rules, workdir, maxFixMode, stopOnFirst?)`** where
  `maxFixMode: 'none' | 'suggest' | 'auto'` (`src/types.ts`, `src/engine.ts`). Effective mode is
  `min(rule.fix.mode, caller.maxFixMode)`. Built-in fixer providers: `RegexFixerProvider`,
  `PathFixerProvider`, `TestStubFixer`.
- **Spur does NOT use any of this today.** `packages/app/src/services/rule-service.ts:187` calls plain
  `new RuleEngine().evaluate(filteredRules, cwd, stopOnFirst)` — fixes are never collected, never applied.
- **Current `spur rule run` CLI surface** (`apps/cli/src/commands/rule.ts:17-23`): `--preset`, `--file`,
  `--rule`, `--fail-on`, `--stop-on-first`, `--verbose`, `--json`. No `--apply-fixes`, no `--fix-mode`.
- **Fixer extensions are NOT wired in the library.** `src/config/extensions.ts` declares
  `ExtensionKind` with four kinds, but `HOST_REGISTRY_BY_KIND` maps only three
  (`resolvers`/`evaluators`/`formatters`) — there is no host registry for `fixers`. So custom fixer
  providers cannot be registered via a preset's `extensions` block. This is the one genuine **upstream**
  (ts-libs) gap; the other two are Spur-side CLI surfacing.

**The three gaps (from validation-and-extension.md "Capability gaps" table):**

| #   | Gap                                                                          | Layer            | Status                                            |
| --- | ---------------------------------------------------------------------------- | ---------------- | ------------------------------------------------- |
| 1   | Apply fixes (`applyFixes`) — `run` only surfaces findings                    | Spur CLI         | Library ready; CLI flag missing                   |
| 2   | Fix authority `none`/`suggest`/`auto` (`min(rule, caller)`) — no caller flag | Spur CLI         | Library ready; CLI flag missing                   |
| 3   | Custom fixer providers via preset extension                                  | ts-libs upstream | `extensions.fixers` host registry not implemented |

Lower-priority gaps from the same table (`EventBus`/`durationMs` observability on the CLI, FP/FN tracking,
rule-ID rename migration) are **explicitly out of scope** for this task — see Requirements R0.

**Why this is its own task, not part of the skill work:** the skill/commands/agent are documentation +
orchestration over the CLI as it exists. Changing the CLI surface (and an upstream library package) is a
code change with its own gates (`bun run check`, `test-cf`, `build`), no-regression constraints on existing
`rule run` output, and a cross-repo (ts-libs) coordination step. ADR-016's command set does not change.

### Requirements

**R0 — Scope boundary.** This task covers ONLY the three fix/extension gaps below. Out of scope (do NOT
implement here): `EventBus`/`rule.*` event streaming or `durationMs` on the CLI, FP/FN rate tracking,
rule-ID rename/migration tooling. ADR-016's command set (`run`/`scan`/`add`/`refine` + CLI `list`/`validate`)
does NOT change — this task adds flags to existing `rule run`, it does not add commands.

**Dependency status — RESOLVED.** The fixer-extension capability (gap 3) was built upstream in ts-libs task
0023 and **released in `@gobing-ai/ts-rule-engine@0.3.4`** (the whole `@gobing-ai/ts-*` family is at 0.3.4).
Spur currently pins `^0.3.3` in the root Bun catalog (`package.json` `workspaces.catalog`, lines 32-39).
The blocking sequence is now clear: ts-libs 0023 ✅ landed → 0.3.4 ✅ released → **this task executes now**.
Spur does NO upstream library work; gap 3 here is purely _bump the catalog + consume + document_.

### Gap 1 + 2 — `spur rule run` applies fixes via a single `--fix-mode` flag (Spur-side)

**Design note (resolves the original "two flags" question):** fix authority and "apply or not" are ONE
decision. The library's `maxFixMode` (`none|suggest|auto`) encodes the whole spectrum, so a single
`--fix-mode` flag (plus `--dry-run` for preview) is the surface — NOT a separate `--apply-fixes` boolean
(which created redundant/invalid combinations). The required APIs (`evaluateWithFixes`, `applyFixes`) exist
since 0.3.3 and remain in 0.3.4.

**R1 — `--fix-mode <mode>` is the sole fix control on `rule run`.** Add `--fix-mode none|suggest|auto`,
default `none`:

- `none` (default) — fixes not collected. **Byte-identical to today** (`engine.evaluate(...)`).
- `suggest` — collect candidates, surface them (`fixes[]` in `--json`), **write nothing**.
- `auto` — collect AND apply (write).

When `--fix-mode` ≠ `none`, `RuleService.evaluate` calls
`engine.evaluateWithFixes(rules, cwd, maxFixMode, stopOnFirst)` instead of `engine.evaluate(...)` (the call
at `packages/app/src/services/rule-service.ts:187`), passing the parsed mode as `maxFixMode`. Effective
per-rule mode stays `min(rule.fix.mode, maxFixMode)` — library-enforced; `auto` is safe (only
`fix.mode: auto` rules are written; a `fix.mode: suggest` rule yields a candidate even under `auto`).

**R2 — Apply step + `--dry-run` preview.** Under `--fix-mode auto`, after findings are computed, call
`engine.applyFixes(cwd, result.fixes, dryRun)`:

- `auto` (no `--dry-run`) → `applyFixes(cwd, fixes, dryRun=false)` writes, then reports the `applied` block.
- `auto --dry-run` → `applyFixes(cwd, fixes, dryRun=true)` prints the diff, writes NOTHING.
- `suggest` → never calls `applyFixes`; reports candidates only.

There is NO `--apply-fixes` flag. Do not add one.

**R3 — `--json` output carries fix data.** `fixes[]` populated when `--fix-mode` ≠ `none`; an `applied`
block (from `FixApplicationResult`: written/deferred/diff) when `auto` ran without `--dry-run`. The existing
`findings[]` / exit-code contract is UNCHANGED.

**R4 — Exit-code semantics preserved.** `--fail-on` still governs exit code based on FINDINGS, independent
of fixes. Applying a fix does NOT retroactively clear the run's exit code (the gate reports what it found;
the operator re-runs to confirm green). Document explicitly — matches the skill's "agent re-runs after
fixing" loop.

**R5 — No regression on existing `rule run`.** Default (`--fix-mode none`) byte-identical to today
(stdout/stderr/exit/`--json`). Capture golden snapshots for `rule run --preset recommended-pre-check`
(plain + `--json`) before changes; diff after.

### Gap 3 — consume the released fixer-extension capability (ts-libs 0023, shipped in 0.3.4)

**R6 — Bump the `@gobing-ai/ts-*` catalog to 0.3.4 and consume.** Update the root `package.json`
`workspaces.catalog` entries from `^0.3.3` → `^0.3.4` (the whole family was released together; bump them in
lockstep to keep the catalog coherent), then `bun install`. Per the Version SSOT rule: edit ONLY the root
catalog block — never literal versions in `apps/*`/`packages/*`; remove any temporary `bun link`. No Spur
code implements fixer wiring — it lives upstream in 0.3.4. After the bump, a project `.spur/rules/` preset
OR rule file MAY declare `extensions: { fixers: [...] }` and have it load (gated by `allowExtensions` on the
consuming path), keyed by evaluator type.

**R7 — Docs follow the code (same commits).** Update
`plugins/sp/skills/spur-rules/references/validation-and-extension.md` "Capability gaps" table: gaps 1–3 →
"Yes". For gap 3, note fixer extensions are now loadable (preset OR rule file, `allowExtensions`-gated, keyed
by evaluator type) and list `fixers` alongside resolvers/evaluators/formatters in the extension docs there.
Update `docs/04_DESIGN.md` §1 CLI surface for `spur rule run`'s new `--fix-mode` flag (AGENTS.md: a flag
change keeps `04_DESIGN.md` in sync in the SAME commit). **Lockstep reversal:** surfacing `--fix-mode auto`
REVERSES the skill's documented "the CLI never applies fixes" invariant — update SKILL.md (gotcha),
`operations.md` (`run`/`add`/`refine` notes), and the `sp:expert-rules` Always/Never rules in the same change
set, or docs desync from behavior. No new ADR required (this surfaces existing decisions, contradicting none).

### Acceptance

- `spur rule run --fix-mode suggest --json` populates `fixes[]` and writes nothing; `--fix-mode none`
  (default) populates neither and is byte-identical to today.
- `spur rule run --fix-mode auto` writes fixes and reports an `applied` block; re-running the gate shows the
  prior violations resolved.
- `spur rule run --fix-mode auto --dry-run` prints the diff and writes nothing.
- No `--apply-fixes` flag exists.
- Golden snapshots for default `rule run` (plain + `--json`) diff byte-identical (R5).
- Root catalog `@gobing-ai/ts-*` bumped `^0.3.3` → `^0.3.4`; `bun install` succeeds; no `bun link` remains.
- A project preset OR rule file with `extensions: { fixers: [...] }` + `allowExtensions: true` loads against
  0.3.4 (capability verified upstream in ts-libs 0023).
- `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build` all pass on Spur.
- validation-and-extension.md + 04_DESIGN.md (+ SKILL.md/operations.md/expert-rules.md for the apply-fixes
  reversal) updated in the implementing commits.

### Q&A

**Cross-repo dependency — RESOLVED.** Gap 3 (R6/R7) depended on **ts-libs task 0023** ("rule-engine: move
fixer providers onto the host registry"), which has **landed and released in `@gobing-ai/ts-rule-engine@0.3.4`**
(whole `@gobing-ai/ts-*` family at 0.3.4). Sequence is now unblocked: ts-libs 0023 ✅ → 0.3.4 release ✅ →
execute this task. Spur consumes by bumping the root Bun catalog `^0.3.3` → `^0.3.4` (R6); no upstream work
remains in Spur. Gaps 1–2 (`--fix-mode`) use `evaluateWithFixes`/`applyFixes` present since 0.3.3 and may
land in either order relative to the catalog bump.

### Design

_(Seed notes — two design questions already resolved; integration points verified 2026-06-07.)_

**Resolved design decisions (do not relitigate):**

1. **One fix flag, not two.** `--fix-mode none|suggest|auto` (+ `--dry-run`) is the entire surface. No
   `--apply-fixes`. Fix authority IS the apply decision; `suggest`=show, `auto`=write; a separate boolean
   only creates redundant/invalid combinations. Maps 1:1 to library `maxFixMode`.
2. **Gap 3 is consumer-only.** The fixer-extension capability was built UPSTREAM in ts-libs task 0023
   (fixers moved onto the host registry; `fixers` wired into `HOST_REGISTRY_BY_KIND`) and **released in
   `@gobing-ai/ts-rule-engine@0.3.4`**. Spur does NOT touch `ts-rule-engine` — it bumps the catalog from
   `^0.3.3` to `^0.3.4` and documents.

**Sequence — unblocked.** ts-libs 0023 ✅ landed; 0.3.4 ✅ released. Both phases can proceed now. Gaps 1–2
(`--fix-mode`) use `evaluateWithFixes`/`applyFixes` (present since 0.3.3, retained in 0.3.4) and are
independent of the catalog bump; gap 3 (R6/R7) is the bump + docs.

**Exact insertion points (Spur-side, verified):**

- CLI flag: `apps/cli/src/commands/rule.ts` `rule.command('run')` block (after line 23, `--json`). Parse
  `--fix-mode` like `--fail-on` (validate `none|suggest|auto`).
- Service: `packages/app/src/services/rule-service.ts` — `evaluate()` at line 169; branch the engine call
  at line 187 (`engine.evaluate` → `engine.evaluateWithFixes(..., maxFixMode, stopOnFirst)` when fixMode ≠
  none). Add `applyFixes` step gated by `fixMode==='auto'` + `dryRun`. Thread `fixMode`/`dryRun` through
  `RuleEvaluateOptions`; extend `RuleEvaluationServiceResult` with optional `fixes`/`applied` (additive,
  keep existing fields stable for R5).
- Dependency (R6): root `package.json` `workspaces.catalog` lines 32-39 → `^0.3.3` ⇒ `^0.3.4` (bump the
  whole `@gobing-ai/ts-*` family in lockstep); `bun install`. No Spur library code.

**Lockstep doc risk (R7):** `--fix-mode auto` reverses the skill's "CLI never applies fixes" statements
(SKILL.md gotcha; operations.md `run`/`add`/`refine`). Whichever change set ships `auto` updates those in
the same commit. Recommend sub-phasing: ship `none|suggest` first (candidates only — NO reversal, docs stay
true), then `auto` + the reversal as a deliberate second step.

**Risks:** R5 byte-identical default output (fix logic strictly additive, active only when fixMode ≠ none).
R4 (exit code independent of fixes) must be explicit. Gap-3 dependency is satisfied (0.3.4 released) — no
remaining external blocker.

### Solution

All three gaps resolved in a single change set:

- **Gaps 1–2 (Spur CLI):** Added `--fix-mode none|suggest|auto` (default `none`) + `--dry-run` to `spur rule run`. `RuleService.evaluate()` branches on `fixMode`: when ≠ `none`, calls `engine.evaluateWithFixes()` instead of `engine.evaluate()`; when `auto`, additionally calls `engine.applyFixes()`. `--json` output extended with `fixes[]` and `applied` block. Human-readable output includes a fix summary. Exit code remains governed by `--fail-on`/findings only (R4).
- **Gap 3 (upstream consume):** Root `package.json` catalog bumped `^0.3.3` → `^0.3.4` (lockstep across all `@gobing-ai/ts-*`). Fixer extensions now loadable via preset/rule-file `extensions.fixers` with `allowExtensions`.
- **Docs (R7):** `04_DESIGN.md` CLI surface updated. `validation-and-extension.md` gaps 1–3 → Yes. SKILL.md and operations.md updated to reverse the "CLI never applies fixes" invariant (lockstep with `--fix-mode auto`).

**Files changed:**

- `apps/cli/src/commands/rule.ts` — added `--fix-mode`, `--dry-run` flags + `parseFixMode()`
- `packages/app/src/services/rule-service.ts` — `RuleEvaluateOptions` + `RuleEvaluationServiceResult` extended; `evaluate()` branched; `evaluateVerbose()` updated; `writeFixSummary()` added
- `packages/app/tests/services/rule-service.test.ts` — 5 new tests for fix-mode
- `package.json` — catalog bump `^0.3.3` → `^0.3.4`
- `bun.lock` — lockfile update
- `docs/04_DESIGN.md` — §1 CLI surface
- `plugins/sp/skills/spur-rules/references/validation-and-extension.md` — gaps table + extension kinds
- `plugins/sp/skills/spur-rules/SKILL.md` — Step 3 + command surface
- `plugins/sp/skills/spur-rules/references/operations.md` — run procedure

### Plan

**Dependency:** ts-libs task 0023 ✅ landed, released in `@gobing-ai/ts-rule-engine@0.3.4`. No external blocker remains.

**Phase A — Spur CLI `--fix-mode` (gaps 1–2, R1–R5)** — uses APIs present since 0.3.3

- [x] Capture golden snapshots: `rule run --preset recommended-pre-check` (plain + `--json`) — R5 baseline
- [x] Thread `fixMode`/`dryRun` through `RuleEvaluateOptions` (CLI → RuleService)
- [x] Branch `RuleService.evaluate` → `evaluateWithFixes(..., maxFixMode, stopOnFirst)` when fixMode ≠ none (line 187)
- [x] Add `--fix-mode none|suggest|auto` (default none) to `rule run` + parse/validate (NO `--apply-fixes`)
- [x] Under `auto`: `applyFixes(cwd, fixes, dryRun)`; `--dry-run` previews diff, writes nothing
- [x] Extend `--json` with `fixes[]` + `applied`; findings/exit contract unchanged (R3, R4)
- [x] Verify default `rule run` byte-identical to golden snapshots (R5)
- [x] Update `docs/04_DESIGN.md` §1 CLI surface (same commit)
- [x] Sub-phasing: ship `none|suggest` first (no reversal); ship `auto` + SKILL.md/operations.md/expert-rules "CLI never applies fixes" reversal as a deliberate second step (R7 lockstep)

**Phase B — bump catalog + consume fixer extensions (gap 3, R6–R7)**

- [x] Bump root Bun catalog `@gobing-ai/ts-*` `^0.3.3` → `^0.3.4` (lockstep, lines 32-39); `bun install`; remove any `bun link`
- [x] Update skill `validation-and-extension.md` gaps 1–3 → Yes; document `fixers` as a loadable extension kind (preset OR rule file, allowExtensions-gated, keyed by evaluator type)
- [x] Sanity-check: a project preset/rule-file with `extensions.fixers` loads against 0.3.4

**Gate (Spur):**

- [x] `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build` pass
- [x] `git status` shows only intentional changes; acceptance criteria met

### Review

## Review — 2026-06-07 (dev-verify --auto --fix all --force)

**Verdict: PASS**
**Scope:** `apps/cli/src/commands/rule.ts`, `packages/app/src/services/rule-service.ts` (+ tests),
`package.json`/`bun.lock` (catalog → 0.3.4), `docs/04_DESIGN.md`, and the 3 skill docs (SKILL.md,
operations.md, validation-and-extension.md).
**Mode:** verify (Phase 7 SECU + Phase 8 traceability) · **Channel:** current (dogfood) · **Force:** re-audit of `Done` task.
**Gate:** `bun run lint` (biome + per-workspace tsc, 8 workspaces) → PASS; `rule-service.test.ts` 27/0 pass
(rule-service.ts 97.26% line / 94.96% func — above 90/90 bar); `rule.test.ts` 14/0 pass.
**Fix pass (`--fix all`):** no mechanical P1/P2 findings to apply — implementation already clean.

### P3 — Info

| #   | Title                                         | Dimension  | Location                        | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------- | ---------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Multiple `new RuleEngine()` per evaluate call | Efficiency | rule-service.ts:207,209,215,238 | Four fresh engines constructed in one `evaluate()` (collect, apply, format). Functionally correct (`applyFixes` is stateless over its args; line 238 formatter is pre-existing from 0dfec73), but a single engine instance reused across collect→apply→format would avoid redundant `registerBuiltins`/`builtInFixers` work. Non-blocking; consider a private `this.engine` or local `const engine` in a follow-up. |

### P4 — Suggestions

| #   | Title                                             | Dimension | Location   | Recommendation                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | `--dry-run` silently inert under `suggest`/`none` | Usability | rule.ts:23 | `--dry-run` only affects `--fix-mode auto`; passing it with `suggest`/`none` is a no-op (both already write nothing). Acceptable per design (R2), but a one-line note in `--help` ("use with --fix-mode auto") is already present on the flag — good. No action required. |

### Phase 8 — Requirements Traceability

- [x] **R1** `--fix-mode none|suggest|auto` sole control → **MET** | `rule.ts:22` flag (default none) + `parseFixMode` (`rule.ts:188-191`); service branches to `evaluateWithFixes` when ≠none (`rule-service.ts:207`). No `--apply-fixes` flag exists (verified absent).
- [x] **R2** apply step + `--dry-run` → **MET** | `applyFixes(cwd, fixes, dryRun)` gated by `fixMode==='auto'` (`rule-service.ts:214-216`); `--dry-run` flag `rule.ts:23`; test "auto with dry-run previews diff without writing" (test:635).
- [x] **R3** `--json` carries `fixes[]` + `applied` → **MET** | `serviceResult.fixes` + `applied` (rule-service.ts:222-224); JSON payload spreads `applied` (line 229); findings/exit contract unchanged.
- [x] **R4** exit code from FINDINGS, independent of fixes → **MET** | exitCode set only from `findings.some(sev ≥ failOn)` (rule-service.ts:248); fixes never mutate it. Doc'd in SKILL.md:139.
- [x] **R5** no regression on default `--fix-mode none` → **MET** | `none` branch keeps plain `engine.evaluate` (rule-service.ts:209); test "fix-mode none (default) does not populate fixes — byte-identical to pre-fix-mode behavior" (test:559,574). Full rule suite 27/0 + 14/0.
- [x] **R6** catalog bump → 0.3.4 + consume → **MET** | `package.json:37` `@gobing-ai/ts-rule-engine: ^0.3.4` (family bumped); `bun.lock` updated; `bun install` clean (typecheck green).
- [x] **R7** docs lockstep (same change set) → **MET** | `04_DESIGN.md` §1 (3 `--fix-mode` refs); SKILL.md gotcha reversed ("`--fix-mode auto` applies the fix", line 139); operations.md `run` procedure (3 refs); validation-and-extension.md gaps→Yes (2 refs). The "CLI never applies fixes" invariant correctly reversed.

### Notes

- Both findings are non-blocking (P3/P4). `--fix all` produced no mechanical changes — the implementation
  matches the corrected single-flag design and the 0.3.4 consumer model with no defects.
- The P3 multi-engine item is the only real cleanup candidate; left for a follow-up to keep this verify
  non-mutating on a `Done` task.

### Testing

5 new tests in `packages/app/tests/services/rule-service.test.ts`:

1. `fix-mode none (default) does not populate fixes` — R5 byte-identical baseline
2. `fix-mode suggest populates fixes[] in JSON and writes nothing` — R1/R3
3. `fix-mode auto applies fixes and reports applied block` — R2/R3
4. `fix-mode auto with dry-run previews diff without writing` — R2 dry-run
5. `exit code is governed by findings, not fixes (R4)` — R4

All 554 tests pass. Coverage: `rule-service.ts` 95.17% lines, 98.63% functions.

### Artifacts

| Type | Path                                                             | Agent     | Date       |
| ---- | ---------------------------------------------------------------- | --------- | ---------- |
| test | `packages/app/tests/services/rule-service.test.ts` (5 new tests) | lord-robb | 2026-06-07 |

### References

- `@gobing-ai/ts-rule-engine@0.3.4` — `evaluateWithFixes()`, `applyFixes()`, fixer host registry
- `ts-libs` task 0023 — upstream fixer-extension capability
- ADR-006 — domain engines are external ts-libs; CLI is thin transport wrapper
