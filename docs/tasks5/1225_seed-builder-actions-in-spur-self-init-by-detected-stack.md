---
schema_version: 1
name: Seed builder actions in spur self init by detected stack
status: done
template: feature-impl
created_at: 2026-10-17T04:04:39.232Z
updated_at: "2026-10-17T23:01:06.611Z"
feature_id: A92
priority: P2
tags:
  - init
estimate_hours: 3

dependencies: ["1222"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1225-verdict.json
---

## 1225. Seed builder actions in spur self init by detected stack

### Background

Feature A92 (docs/design/sdlc-actions.md §3.4 init row). Init scaffolds .spur/config.yaml from a template (apps/cli/src/commands/init.ts); it carries no builder block. Covers R9.

**Refine corrections (2026-10-16)**
- Said init scaffolds .spur/config.yaml from a template file → it writes an inline YAML string (apps/cli/src/commands/init.ts:307); SCAFFOLD_MANIFEST (apps/cli/src/config/scaffold-manifest.ts:39) holds rules/templates/docs only → the builder block is appended to that inline string.
- Earlier premise cited init.ts:160 for project config → that block is global-config seeding (seedGlobalConfig) → citation replaced.
- R4 'never overwrite on re-run' → init without --force already converges without rewriting config (init.ts:223); with --force the config is rewritten by existing semantics → R4 restated against that behavior.

### Requirements

- [x] R1. A fresh `spur self init` in a directory with `bun.lock` or `bun.lockb` writes `builder:\n  preset: bun` into .spur/config.yaml.
- [x] R2. With a Makefile and no bun lockfile, init writes `preset: none` plus `builder.actions.<a>: make <a>` for each reserved action name that is a Makefile target.
- [x] R3. With neither (e.g. only pyproject.toml), init writes `preset: none` and a commented `actions:` skeleton listing the reserved names.
- [x] R4. Re-running init without `--force` leaves an existing .spur/config.yaml untouched (existing converge path); `--force` regenerates it with the R1–R3 detection.
- [x] R5. The generated config loads cleanly under the 1222 schema.

Out of scope: detecting npm/pnpm/yarn, poetry, just, cargo; parsing Makefile includes or pattern rules; invoking make.

### Acceptance Criteria

- [x] AC1 — spur init seeds builder.actions for the detected stack

Requirement map: AC1 → R1–R5. Test layer: apps/cli/tests/commands/init.test.ts spawning the real CLI on temp fixtures (E2E).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:55.038Z

- Stack detection happens only at init and is written down for review (ADR-139 rejects runtime detection).
- Makefile targets are parsed with `^([a-z][a-z0-9-]*):`; make is never invoked.

#### Q&A entry — 2026-10-17T04:16:45.744Z

- Stack detection happens only at init and is written down for review (closed: ADR-139).
- Makefile targets are parsed with a regex; make is never invoked (closed).
- When both bun lockfile and Makefile exist, bun wins (closed: spur-new itself has both shapes possible; bun preset is the compatibility default).

### Design

WHAT: init-time stack detection that writes a reviewable builder block.
WHERE: apps/cli/src/commands/init.ts — a pure helper `renderBuilderBlock(files: { bunLock: boolean; makefile: string | null }): string[]` appended to the inline config lines at init.ts:307; tests in apps/cli/tests/commands/init.test.ts (extend).

Detection order: bun lockfile → bun; else Makefile → none + targets; else skeleton. Target parse: lines matching `^([a-z][a-z0-9-]*):(?!=)` (skip `:=` assignments), intersected with RESERVED_ACTIONS from 1222.

Why: ADR-139 allows stack detection only at init, written down for review.

Anti-patterns: no runtime detection anywhere else; no make invocation; no new init flag; do not touch SCAFFOLD_MANIFEST.

Assumes from 1222: RESERVED_ACTIONS export and the schema (R5).

### Plan

1. List failure modes: no manifest, bun lock + Makefile both present (bun wins), Makefile with `:=` assignments, Makefile with no matching targets, re-run without/with --force.
2. Add renderBuilderBlock and append it at init.ts:307 (R1–R3).
3. E2E: run the real `spur self init` on temp fixtures (bun, make, pyproject, re-run, --force) and keep the generated configs as the artifact; load each through the config loader (R4, R5).
4. `bun run spur-check`.

### Solution

Init-time stack detection, written down once (ADR-139) — nothing re-detects at run time.

| Change | Where | Requirement |
| --- | --- | --- |
| Imports the reserved vocabulary (`SDLC_ACTIONS`) as the intersection set | `apps/cli/src/commands/init.ts:4` | R2 |
| Makefile rule-head regex — bare `target:`, never the `target := value` assignment | `apps/cli/src/commands/init.ts:59-60` | R2 |
| `renderBuilderBlock({ bunLock, makefile })` — the pure block renderer (bun / make / skeleton) | `apps/cli/src/commands/init.ts:62-84` | R1, R2, R3 |
| Stack detection in `registerInitCommand`: `bun.lock`/`bun.lockb`, else Makefile contents | `apps/cli/src/commands/init.ts:337-342` | R1, R2 |
| Appends the rendered block to the inline `.spur/config.yaml` lines | `apps/cli/src/commands/init.ts:372` | R1, R2, R3 |
| `initAndParse` — spawns the real CLI on a fixture, then parses the written config through `spurConfigSchema` | `apps/cli/tests/commands/init.test.ts:26-40` | R5 |
| E2E: bun lockfile (both `bun.lock` and `bun.lockb`) → `preset: bun` | `apps/cli/tests/commands/init.test.ts:376-385` | R1 |
| E2E: Makefile with a `:=` assignment, a non-reserved target, and reserved targets → only reserved targets bound | `apps/cli/tests/commands/init.test.ts:388-418` | R2 |
| E2E: pyproject-only → `preset: none` + commented `actions:` skeleton, nothing bound | `apps/cli/tests/commands/init.test.ts:420-432` | R3 |
| E2E: converge re-init leaves the config byte-identical; `--force` re-runs detection | `apps/cli/tests/commands/init.test.ts:434-452` | R4, R5 |

Rationale: the block is generated from two cheap filesystem probes at the one moment the config is
written (`init`, fresh or `--force`), so the binding is reviewable in the committed config rather
than guessed per invocation. A Makefile with no reserved target falls through to the R3 skeleton —
same "nothing bound" outcome as no stack at all. `make` is never invoked.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/init.ts:68-69` — `bunLock` short-circuits to `['builder:', '  preset: bun']`; the probe at `apps/cli/src/commands/init.ts:338-340` tests `bun.lock` then `bun.lockb`. E2E `apps/cli/tests/commands/init.test.ts:376-385` loops both lockfile names and asserts `text` contains `builder:\n  preset: bun` plus `builder === {preset:'bun', actions:{}}`. Re-probed this run: fresh `self init --minimal` in two throwaway dirs (`bun.lock`, `bun.lockb`) each wrote exactly one `builder:` block with `preset: bun`, and `loadSpurConfig` returned `{preset:'bun',actions:{}}`; a full non-`--minimal` init with `bun.lock` also wrote one block and loaded `{preset:'bun',actions:{}}` after a second converged run. |
| R2 | MET | Rule head `apps/cli/src/commands/init.ts:60` (`/^([a-z][a-z0-9-]*):(?!=)/`), reserved-vocabulary intersection at `apps/cli/src/commands/init.ts:73` (`SDLC_ACTIONS.filter`), binding text at `apps/cli/src/commands/init.ts:83` (`${action}: make ${action}`). E2E `apps/cli/tests/commands/init.test.ts:388-418` asserts `preset: none` and `actions === {build:'make build', test:'make test', 'lint-changed':'make lint-changed'}` with `CC := cc` and `deploy:` excluded. Re-probed this run on a Makefile carrying `CC := cc`, `build:`, `test:`, `lint-changed:`, `deploy: build`: the written block bound exactly those three reserved targets and no `deploy`/`CC` entry; a Makefile with only `deploy:` produced the R3 skeleton with `actions:{}`. The file's own target text never reaches a command: no `child_process`/`Bun.spawn` call exists in `apps/cli/src/commands/init.ts` (the only `.exec` at `apps/cli/src/commands/init.ts:71` is the regex), and every bound command is the literal `make <action>` over the closed `SDLC_ACTIONS` list (`packages/config/src/index.ts:922-941`). |
| R3 | MET | `apps/cli/src/commands/init.ts:74-82` emits `preset: none` plus a commented `actions:` skeleton over `SDLC_ACTIONS`. E2E `apps/cli/tests/commands/init.test.ts:420-432` asserts `builder === {preset:'none', actions:{}}`, the `  # actions:` / `  #   build: <command>` lines, and no live `^  actions:` line. Re-probed this run: a `pyproject.toml`-only dir wrote all 18 commented reserved names, no live binding, and loaded `{preset:'none',actions:{}}`. |
| R4 | MET | Converge guard `apps/cli/src/commands/init.ts:253` returns before the single config write at `apps/cli/src/commands/init.ts:376`; that write always rewrites the whole file, so no append path can add a second `builder:` block. E2E `apps/cli/tests/commands/init.test.ts:434-452` asserts byte-identical re-init then `--force` re-detection. Re-probed this run with a hand-edited block (`actions: {build: my custom build}`) plus a newly added `bun.lock`: the converged re-run left the config byte-identical (`builder.actions.build` still `my custom build`), and `self init --minimal --force` rewrote it to `builder:\n  preset: bun` with `{preset:'bun',actions:{}}`. |
| R5 | MET | The schema is the real 1222 one: `builder` → `BuilderConfigSchema` at `packages/config/src/index.ts:1081` wired into `spurConfigSchema` at `packages/config/src/index.ts:1184`. E2E parses every written config through `spurConfigSchema.parse(parseConfigYaml(text))` in `apps/cli/tests/commands/init.test.ts:37`. Re-probed this run through the load path `loadSpurConfig` (`packages/config/src/loader.ts:220`) on all four shapes — bun, bun.lockb, make-bound, and skeleton — each parsed to a resolved `builder` object (`{preset:'bun',actions:{}}`, `{preset:'none',actions:{...three bindings}}`, `{preset:'none',actions:{}}`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — spur init seeds builder.actions for the detected stack | MET | test | Four E2E cases in `apps/cli/tests/commands/init.test.ts:376-452` spawn the real CLI and assert each generated shape both by written bytes and by the schema-parsed `builder`: bun/bun.lockb (`:376-385`), Makefile reserved targets (`:388-418`), no-stack skeleton (`:420-432`), converge plus `--force` re-detection (`:434-452`). `bun test apps/cli/tests/commands/init.test.ts` this run: 24 pass, 0 fail, 130 assertions. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 1225
**Scope:** uncommitted change set of task 1225 — `apps/cli/src/commands/init.ts` (+38/-1), `apps/cli/tests/commands/init.test.ts` (+100/-2), plus the task file's Solution/History fill
**Dimensions:** functional traceability (R1–R5, AC1), SECUA (security, efficiency, correctness, usability), architectural depth
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | architecture | Stack detection is three filesystem probes inlined in the command action closure, so only the pure renderer is testable in isolation; detection is reachable only through the subprocess E2E. A `detectBuilderStack(fs, cwd)` seam would let the bun/Makefile probe be unit-tested, and `renderBuilderBlock` is `export`ed with no importer outside this file (detection at `apps/cli/src/commands/init.ts:338-342`, renderer at `apps/cli/src/commands/init.ts:68-83`). | `apps/cli/src/commands/init.ts:68-83,338-342` | ACCEPTED (the task's Design pins the change to `init.ts`; detection is 6 lines) |
| 2 | P4 (advisory) | correctness | The Solution asserts "a Makefile with no reserved target falls through to the R3 skeleton", but no fixture feeds exactly that input — the `bound.length === 0` branch is covered only via the pyproject-only (no `Makefile`) case. Behavior verified identical by hand (below). | `apps/cli/src/commands/init.ts:74-82` | ACCEPTED |
| 3 | P4 (advisory) | correctness | Documented parse limits: `build :` (space before colon) and mixed-case `BUILD:` never match the rule-head pattern, `include`/pattern-rule targets are out of scope by spec, and the bun-wins precedence when both a bun lockfile and a `Makefile` exist is asserted by the Q&A but has no fixture. All are spec'd exclusions, not defects. | `apps/cli/src/commands/init.ts:60` | ACCEPTED |
| 4 | P4 (advisory) | usability | `--force` regenerates the entire file, silently dropping a hand-edited `builder.actions` (measured below). This is R4's restated pre-existing semantics and not a new clobber path, but the `--force` output prints no "config regenerated" warning. | `apps/cli/src/commands/init.ts:253,334-376` | ACCEPTED |

No P1–P3 findings: in particular, no path can append a second `builder:` block, and a `Makefile`'s contents can never reach an executed command (see R2 evidence).

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/commands/init.ts:68` — `bunLock` first branch renders `['builder:', '  preset: bun']`; probe at `init.ts:338-340` checks both `bun.lock` and `bun.lockb`. E2E: `apps/cli/tests/commands/init.test.ts:376-385` loops both lockfile names; manual run printed a trailing `builder:\n  preset: bun`. |
| R2 | MET | Rule head `apps/cli/src/commands/init.ts:60`, intersection at `init.ts:73` (`SDLC_ACTIONS.filter`), binding at `init.ts:83`. E2E: `apps/cli/tests/commands/init.test.ts:388-418` — `CC := cc` and `deploy:` excluded, `build`/`test`/`lint-changed` bound. Manual fixture with `CC := cc`, `build:`, `test-changed:`, `deploy: build` emitted exactly `build: make build` and `test-changed: make test-changed`. Regex probe: `build:`→build, `lint-changed:`→lint-changed, `CC := cc`→null, `build :`→null, tab-indented recipe line→null, `deploy: build`→deploy (then filtered by the vocabulary). |
| R2 (no make invocation) | MET | `renderBuilderBlock` only builds strings — no `spawn`/`exec`/`child_process` anywhere in `apps/cli/src/commands/init.ts` (grep clean); the only command text written is `make <action>` where `<action>` comes from the closed vocabulary `SDLC_ACTIONS` (`packages/config/src/index.ts:922-941`), never from the file's own target text. Makefile content therefore cannot inject a command (SECUA: no new trust-boundary crossing). |
| R3 | MET | `apps/cli/src/commands/init.ts:74-82` — `preset: none` + commented `actions:` skeleton over `SDLC_ACTIONS`. E2E: `apps/cli/tests/commands/init.test.ts:420-432` asserts the commented skeleton and that no `^  actions:` line exists. Manual pyproject-only run printed the 18 commented entries and parsed back to `{preset: 'none', actions: {}}`. |
| R4 | MET | Converge guard `apps/cli/src/commands/init.ts:253` returns before the single config write at `init.ts:376` — the only `writeFile(configPath, …)` in the file, and it always writes the whole file (no append path), so a second block cannot appear and a hand-edited block cannot be touched. E2E: `apps/cli/tests/commands/init.test.ts:434-452` asserts byte-identical re-init then `--force` re-detection. Manual: after editing an existing `builder` block to `preset: none / actions: {build: my custom build}`, converge left the file byte-identical (`unchanged after converge: true`). |
| R5 | MET | Tests parse the written file through the real load-time schema — `spurConfigSchema` (`packages/config/src/index.ts:1144-1157`, `builder` → `BuilderConfigSchema` at `packages/config/src/index.ts:1051-1060`), not a stub — via `parseConfigYaml` (`packages/config/src/loader.ts:400-402`) at `apps/cli/tests/commands/init.test.ts:31-42`. Manually strengthened beyond the test: `loadSpurConfig(cwd)` (the merged path, `packages/config/src/loader.ts:607` = `spurConfigSchema.parse(merged)`) returned `{preset:'none',actions:{}}` for both the skeleton and the Makefile shapes, and the bun shape parsed to `{preset:'bun',actions:{}}`. |
| AC1 | MET | The four E2E cases above cover all three generated shapes plus the converge/`--force` pair; each shape is asserted by its written bytes **and** by the schema-parsed `builder` object. |

##### Verification evidence (run this review, no coverage flag, tracked files untouched)

- `bun test apps/cli/tests/commands/init.test.ts` → 24 pass, 0 fail, 130 expect() calls (includes the 4 new 1225 tests).
- `bun test packages/config/tests/builder-actions-schema.test.ts` → 13 pass, 0 fail (shared vocabulary/schema unchanged).
- Manual E2E through `main(['init','--minimal'], {cwd})` on three throwaway fixtures (`/tmp`) plus `loadSpurConfig` on each written config; `git status --porcelain` afterwards still lists only the three change-set files.
- `--force` measurement: converge kept `builder.actions.build = my custom build`; `--force` replaced it with `builder:\n  preset: bun`.

##### Residual risk

- Existing projects that already have `.spur/config.yaml` never gain a `builder` block on converge (by R4); they keep resolving the implicit `bun` preset (`packages/config/src/index.ts:1051` default), which is the ADR-139 compatibility default — intended, but it means the seeded block only ever appears in newly initialized projects or under `--force`.
- Detection is cwd-local: a monorepo package initialized from a subdirectory with its lockfile or `Makefile` one level up writes the R3 skeleton. Consistent with R1/R2's "in a directory with …" wording; not exercised.
- The new block is untested against the non-`--minimal` scaffold pass, though code inspection shows no other writer of `.spur/config.yaml` (`init.ts:376` is the sole write site) and the seed list drops the config file (`packages/config/src/bundled-config.ts:159-165`).

**Next:** none blocking — proceed to verify; carry finding 2 (Makefile-with-no-reserved-target fixture) into any future touch of this helper.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T06:42:32.164Z todo → wip (system)
- 2026-10-17T06:52:13.414Z wip → testing (system)
- 2026-10-17T06:52:14.682Z testing → done (system)

