---
schema_version: 1
name: SDLC action config schema and shared resolver
status: done
template: feature-impl
created_at: 2026-10-17T04:04:39.228Z
updated_at: "2026-10-17T17:18:24.772Z"
feature_id: A92
priority: P1
tags:
  - config
  - builder
estimate_hours: 4

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1222-verdict.json
---

## 1222. SDLC action config schema and shared resolver

### Background

Feature A92 (ADR-139, docs/design/sdlc-actions.md §3.1–3.2). Spur needs a closed reserved-action vocabulary bound per project through .spur/config.yaml builder.preset + builder.actions, resolved by one service shared by the CLI and the quality gate. Covers R2 and the resolution half of R11.

**Refine corrections (2026-10-16)**
- Design said the bun preset binds rules-pre/rules-post to the stack-neutral `spur rule run` bodies → today's light tier runs `bun run test-pre-check` / `bun run test-post-check` (packages/app/src/services/quality-gate.ts:557-558), and spur-new's test-post-check also runs coverage-provenance-check first (package.json:82) → the bun preset binds them to `bun run test-pre-check` / `bun run test-post-check`; the `spur rule run` bodies become the preset `none` defaults (satellite §3.1 corrected).
- formatCmd (config/workflows/task-pipeline.yaml:195) is a fourth bun default not listed earlier → the `format` reserved action and its preset entry cover it (consumed in 1224).

### Requirements

- [x] R1. BuilderConfigSchema (packages/config/src/index.ts:917) accepts `preset: bun|none` (default `bun`) and `actions: Record<name, string | string[]>`; `bump-ver` is unchanged.
- [x] R2. Load rejects a malformed action name, a composite step that resolves to no action, a composite cycle (error names the cycle path), a placeholder outside lint-changed/typecheck-changed/test-changed, and an empty string or empty list; each error names the key path (`builder.actions.<name>`).
- [x] R3. `packages/app/src/services/sdlc-actions.ts` exports `RESERVED_ACTIONS`, `BUN_PRESET`, `resolveAction`, `listActions` and `renderScoped`; `renderScoped` quotes each substituted item with `shQuote` (quality-gate.ts:520).
- [x] R4. With no builder block, every reserved action resolves to today's exact command (bun preset, satellite §3.1 table), including `rules-pre` → `bun run test-pre-check` and `rules-post` → `bun run test-post-check`.
- [x] R5. Under `preset: none`, `rules-pre`/`rules-post` resolve to `spur rule run --preset recommended-pre-check|recommended-post-check --fail-on warning --no-logo`, and every other undeclared reserved action is `unbound`.
- [x] R6. config.example.yaml and the generated config JSON schema document `builder.preset` and `builder.actions`.

Out of scope: the CLI verb (1223), engine/workflow consumers (1224), init seeding (1225), any runtime stack detection.

### Acceptance Criteria

- [x] AC1 — Project config binds actions to stack-specific commands
- [x] AC2 — Existing bun projects keep working without config changes

Requirement map: AC1 → R1, R2, R3, R5, R6; AC2 → R4. Test layer: packages/config schema tests + packages/app resolver table test (pure functions, no mocked collaborators).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:52.387Z

- Action names drop the operator's `cmd-` prefix: the `actions` map already scopes them (ADR-139).
- Custom names are allowed and exec-only; the reserved set is closed in code.
- Composites list action names, not raw commands, so each command is defined once.

#### Q&A entry — 2026-10-17T04:16:41.327Z

- Action names drop the operator's `cmd-` prefix: the `actions` map already scopes them (ADR-139).
- Custom names are allowed and exec-only; the reserved set is closed in code.
- Composites list action names, not raw commands, so each command is defined once.
- Bun preset keeps rules-pre/rules-post on the legacy scripts (closed 2026-10-16: byte-identity and coverage-provenance precondition outrank stack-neutral defaults under `bun`).

### Design

WHAT: config schema + one pure resolver module shared by the CLI verb (1223) and the quality gate (1224).
WHERE: `packages/config/src/index.ts` (schema, next to BuilderBumpVerConfigSchema), `packages/app/src/services/sdlc-actions.ts` (new), `config.example.yaml`.

Frozen names:
- `RESERVED_ACTIONS: readonly ReservedAction[]` = build, dev, clean, format, autofix, lint, typecheck, test, test-full, test-heavy, rules-pre, rules-post, check, check-full, check-feature, lint-changed, typecheck-changed, test-changed.
- `type ActionSource = 'config' | 'preset' | 'default' | 'unbound'`.
- `type ResolvedAction = { name: string; reserved: boolean; source: ActionSource } & ({ kind: 'command'; command: string } | { kind: 'composite'; steps: string[] } | { kind: 'unbound' })`.
- `resolveAction(builder: BuilderConfig | undefined, name: string): ResolvedAction`
- `listActions(builder: BuilderConfig | undefined): ResolvedAction[]` (reserved first in vocabulary order, then declared custom names sorted).
- `renderScoped(command: string, values: { files?: string[]; paths?: string[]; workspace?: string }): string` — `{files}`/`{paths}` → space-joined shQuote'd items; `{workspace}` → one shQuote'd item.
- `BUN_PRESET: Readonly<Record<ReservedAction, string>>` — the satellite §3.1 bun column verbatim; `typecheck-changed` = `cd {workspace} && bun run typecheck`, `test-changed` = `cd {workspace} && bun test {paths}`, `lint-changed` = `bunx biome check {files}`.

Algorithm: `builder.actions[name]` → (preset bun) `BUN_PRESET[name]` → (preset none) stack-neutral rules default → unbound. Cycle detection: DFS over composite steps at schema superRefine time; report the first cycle as `a → b → a`.

Why: one table holds every bun literal, so 1224 can delete them from the engine; byte-identity under the bun preset is what keeps superskill/knowledge-kit green with no config edit.

Anti-patterns: do not shell out or touch the filesystem in the resolver (pure); do not merge preset and declared composites (a declared entry replaces the preset entry whole); do not accept raw commands inside composite lists; do not import sdlc-actions from packages/config (dependency direction is app → config).

Handoff: 1223 and 1224 consume `resolveAction`/`listActions`/`renderScoped` unchanged; 1225 writes config that this schema validates.

### Plan

1. Write the failure-mode list (malformed name, dangling step, self-cycle, 2-cycle, stray placeholder, empty value, wrong type) as test cases in packages/config/tests (isolated schema parsing is the one permitted unit layer here).
2. Extend BuilderConfigSchema with preset + actions + superRefine (R1, R2).
3. Add sdlc-actions.ts with RESERVED_ACTIONS, BUN_PRESET, resolver, lister, renderScoped (R3–R5).
4. Pin R4 with a table test asserting every BUN_PRESET entry equals the satellite §3.1 bun column and today's quality-gate literals.
5. Document both keys in config.example.yaml; regenerate the config JSON schema (R6).
6. `(cd packages/config && bun test)`, `(cd packages/app && bun test)`, then `bun run spur-check`.

### Solution

One table-driven resolver module holds every bun literal, so 1224 can delete them from the
engine; the schema makes the binding load-validated before any consumer sees it.

| Requirement | Change (`file:line`) |
| --- | --- |
| R1 — `BuilderConfigSchema` accepts `builder.preset` (`bun` default) and `builder.actions`; `bump-ver` untouched | `packages/config/src/index.ts:1051` |
| R2 — load rejects malformed names, unresolved composite steps, cycles (`a → b → a`), misplaced placeholders and empty values, each naming `builder.actions.<name>` | `packages/config/src/index.ts:975-977` |
| R3 — `RESERVED_ACTIONS`/`BUN_PRESET`/`resolveAction`/`listActions`/`renderScoped`, quoting via the moved `shQuote` | `packages/app/src/services/sdlc-actions.ts:105` |
| R3 — `shQuote` relocated to a shared module; `quality-gate.ts` imports it (behavior identical) | `packages/app/src/services/shell-quote.ts:11` |
| R4 — bun preset byte-identity: today's exact commands for all 18 reserved actions | `packages/app/src/services/sdlc-actions.ts:22` |
| R5 — `preset: none` binds the stack-neutral `spur rule run` presets + `rules-pre`/`rules-post`, everything else unbound | `packages/app/src/services/sdlc-actions.ts:44-49` |
| R5 — resolution order `config → preset → default → unbound`, declared entry replaces whole | `packages/app/src/services/sdlc-actions.ts:68` |
| R6 — `config.example.yaml` documents `builder.preset` + `builder.actions` | `config/config.example.yaml:238` |
| R6 — the config JSON schema documents `builder.preset` and `builder.actions` | `apps/cli/schemas/spur-config.schema.json:344-366` |
| R1/R2 — schema cases (preset default, valid string/list, malformed name, unresolved step, cycle path, misplaced placeholder, empty value, wrong type) | `packages/config/tests/builder-actions-schema.test.ts:10` |
| R3/R4/R5 — resolver table (bun identity vs the light-gate plan lines, `preset: none`, custom action, replacement, `renderScoped` quoting) | `packages/app/tests/services/sdlc-actions.test.ts:21` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/config/src/index.ts:1064-1071` — `BuilderConfigSchema` gains `preset` (enum of the two preset names, `.default('bun')` at `:1068`) and `actions` (record of string-or-string-array, `.default({})` at `:1070`), with `'bump-ver'` unchanged beside them at `:1066`; the 18-name vocabulary and preset list live at `packages/config/src/index.ts:922-971`. Tests: `packages/config/tests/builder-actions-schema.test.ts:11-15` (bare block → `preset:'bun'`, `actions:{}`), `:17-33` (string command + composite list + `preset:'none'` accepted), `:34-37` (`preset:'python'` rejected; `bump-ver` knob still parsed). Fresh run `(cd packages/config && bun test packages/config/tests/builder-actions-schema.test.ts)` → 13 pass / 0 fail. |
| R2 | MET | Validation lives in `packages/config/src/index.ts:992-1055`: name grammar `:1008`, empty string `:1012`, placeholder vs the three `*-changed` actions `:1019`, empty list `:1025`, composite step that resolves to no action `:1032`, cycle walk reporting `a → b → a` `:1039-1054`; every issue is added with path `['actions', name]` plus the `builder.actions.<name>` message text. Unit layer `packages/config/tests/builder-actions-schema.test.ts:48-95` covers all six classes plus a non-string value. Real loader, both `validateJsonSchema` paths, over a temp project `.spur/config.yaml`: each case rejected naming the key path — `builder.actions.Bad Name is not a valid action name`, `builder.actions.check lists step "lint", which resolves to no action`, `builder.actions.a forms a cycle: a → b → a`, `builder.actions.lint uses placeholder {files}`, `builder.actions.build must not be empty`, `builder.actions.ci must not be an empty list`. |
| R3 | MET | `packages/app/src/services/sdlc-actions.ts:13,22,66,84,103` export `RESERVED_ACTIONS`, `BUN_PRESET`, `resolveAction`, `listActions`, `renderScoped`; `renderScoped` substitutes only through `shQuote` (`packages/app/src/services/sdlc-actions.ts:112,118`) imported from `packages/app/src/services/shell-quote.ts:11` (relocated verbatim; `packages/app/src/services/quality-gate.ts:58` now imports it from there). Quoting pinned at `packages/app/tests/services/sdlc-actions.test.ts:167-198` (space, embedded quote, `$&` inserted literally, missing value throws) and `packages/app/tests/services/shell-quote.test.ts:4-16`. Fresh run `(cd packages/app && bun test packages/app/tests/services/sdlc-actions.test.ts packages/app/tests/services/shell-quote.test.ts)` → 13 pass / 0 fail (84 expect calls). |
| R4 | MET | `packages/app/src/services/sdlc-actions.ts:22-41` holds the bun column of the satellite table line for line, including `rules-pre` → `bun run test-pre-check` and `rules-post` → `bun run test-post-check` (`docs/design/sdlc-actions.md:99-118`), and `format` → `bun run format` = the pipeline default `formatCmd` (`config/workflows/task-pipeline.yaml:195`). Pinned twice: an independent transcription over all 18 reserved actions with `builder === undefined` (`packages/app/tests/services/sdlc-actions.test.ts:32-57`) and rendered `lint-changed`/`typecheck-changed`/`test-changed` compared to the live plan lines `packages/app/src/services/quality-gate.ts:546,554,567` (`:59-86`). Both pass in the 13-pass run above. |
| R5 | MET | `packages/config/src/index.ts:964-967` defines the stack-neutral defaults (single-sourced by 1228; `packages/app/src/services/sdlc-actions.ts:48` aliases them) (`spur rule run --preset recommended-pre-check --fail-on warning --no-logo` and its `recommended-post-check` twin) and `:65-81` implements resolution order config → preset → stack-neutral default → unbound. Tests `packages/app/tests/services/sdlc-actions.test.ts:88-119` assert both defaults with `source:'default'` and that the other 16 reserved actions resolve `source:'unbound', kind:'unbound'`. Probe over all 18 reserved actions under `preset:'none'`: exactly `rules-pre`/`rules-post` resolve outside config (drift 0). |
| R6 | MET | `config/config.example.yaml:238-254` documents `builder.preset` (bun default vs none) and the full `builder.actions` shape with a worked example incl. a composite and a custom action; `apps/cli/schemas/spur-config.schema.json:348-366` documents both keys — enum + `"default": "bun"` for `preset`, `propertyNames` pattern, `oneOf` string/array with `minItems: 1`, and the reserved vocabulary in the description. The example block itself parses (`BuilderConfigSchema` success on the transcribed block), and `(cd apps/cli && bun test apps/cli/tests/config/embedded-schemas.test.ts apps/cli/tests/config/scheduler-jobs-schema.test.ts)` → 10 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Project config binds actions to stack-specific commands | MET | command | Real-loader probe over a temp project config (`preset: none` with `build: make build`, `lint: ruff check .`, `test: pytest -q`, `check: [lint, test]`, custom `release`) on both validation paths: load succeeded and returned `builder={"preset":"none","actions":{...}}`, with `resolveAction` giving `source:'config'` for every declared name and `kind:'composite'` for the list. Test layer: `packages/config/tests/builder-actions-schema.test.ts:17-33` (binding accepted) and `packages/app/tests/services/sdlc-actions.test.ts:121-165` (declared command wins, composite replaces whole, custom action resolves) — 13 pass / 0 fail each. |
| AC2 — Existing bun projects keep working without config changes | MET | test | Byte-identity over all 18 reserved actions with no `builder` block (`packages/app/tests/services/sdlc-actions.test.ts:45-57`) plus the three scoped actions rendered and compared to the live light-gate plan lines (`packages/app/tests/services/sdlc-actions.test.ts:59-86`) — 13 pass / 0 fail. Second half: this repository's own `.spur/config.yaml:98` (a `builder` block with `bump-ver` only) loads on both validation paths with `builder.preset='bun'`, `builder.actions={}`, and all 18 reserved actions resolving `source:'preset'` (loader probe). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — task 1222 (SDLC action config schema and shared resolver)
**Scope:** uncommitted change set of task 1222 — 6 modified (incl. the task file) + 5 untracked = 11 files; `packages/config/src/index.ts`, `packages/app/src/services/{sdlc-actions,shell-quote,quality-gate}.ts`, `apps/cli/schemas/spur-config.schema.json`, `config/config.example.yaml` + 4 test files
**Dimensions:** functional traceability (R1–R6, AC1–AC2), SECUA (correctness/security/efficiency/usability), architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | `renderScoped` substitutes an empty list as an empty string, so the command silently widens (`bunx biome check ` → whole repo; `cd ws && bun test ` → whole workspace) — the exact failure the function's own doc comment says the throw exists to prevent, which only covers a *missing* value, not an empty array. No consumer passes an empty scope yet (the light gate guards on `files.length > 0` at `packages/app/src/services/quality-gate.ts:544`), so it is latent until 1223/1224 hand the resolver a zero-length scope | `packages/app/src/services/sdlc-actions.ts:105-121` | FIXED(61964c383) — `[]` now throws like a missing value; no consumer relies on widening |
| 2 | P3 (minor) | architecture | The same fact — which reserved actions resolve under `preset: none` — lives twice across the package boundary: the schema's resolvable set (`SDLC_PRESET_ACTIONS.none`) and the resolver's `STACK_NEUTRAL_DEFAULTS` (not exported). If a later task adds a stack-neutral default in the app layer only, the schema rejects a composite that names it (`builder.actions.ci lists step …, which resolves to no action`) even though the resolver would resolve it — a spurious load failure with no test to catch the drift | `packages/config/src/index.ts:957` and `packages/app/src/services/sdlc-actions.ts:47` | FIXED(3f1d46da3) — the set lives once in `packages/config`; the drift is pinned by exactly that assertion |
| 3 | P4 (advisory) | efficiency | The cycle check enumerates every simple path (no visited memo), so a dense composite DAG is exponential on the config-load path: measured 5 ms / 82 ms / 630 ms at 20 / 26 / 30 two-edge composites (≈ Fibonacci growth, ~7 s at 35). Real configs hold a handful of composites, so this is a hazard, not a defect; a per-root visited set flattens it to O(V+E) | `packages/config/src/index.ts:1026-1041` | ACCEPTED |
| 4 | P4 (advisory) | usability | The JSON-schema surface documents only part of what zod enforces — it has no way to express the `superRefine` rules (dangling step, cycle, misplaced placeholder) and accepts whitespace-only values where zod rejects them (`minLength: 1` vs the `trim()` check). The repo's established discipline is a round-trip test per new schema surface (`packages/config/tests/loader.test.ts:836-863` for `agent.roles`, `:879-899` for `agent.executors`); `builder` got none. Low risk: zod always runs after the JSON-schema pre-pass (`packages/config/src/loader.ts:668-680`) and stays SSOT | `apps/cli/schemas/spur-config.schema.json:344-366` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — `preset: bun\|none` (default `bun`) + `actions: Record<name, string \| string[]>`; `bump-ver` unchanged | MET | `packages/config/src/index.ts:1051-1062` (`z.enum(SDLC_PRESETS).default('bun')` at `:951`, `z.record(z.string(), z.union([z.string(), z.array(z.string())]))`); `bump-ver` untouched at `:1053`; probe: `BuilderConfigSchema.parse({'bump-ver':{ghRunListLimit:2}, preset:'none'})` returns the full bump-ver defaults beside `preset:'none'` |
| R2 — load rejects malformed name, dangling composite step, cycle (path named), misplaced placeholder, empty string/list, each naming `builder.actions.<name>` | MET | `packages/config/src/index.ts:979-1042`: grammar `:993`, empty value `:998-1006`, placeholder vs `SDLC_SCOPED_ACTIONS` `:1001-1010`, dangling step vs `resolvable` (preset ∪ declared) `:984,1013-1019`, cycle walk `:1026-1041`; every issue carries `path: ['actions', name]` plus the `builder.actions.<name>` text. Probes: 3-node cycle from a non-cycle entry → `builder.actions.x forms a cycle: x → y → z → x`; diamond `a:[b,c], b:[a], c:[a]` → reported once; reserved self-cycle `check:['check']` → `check → check`. Real loader: `builder.actions.Bad Name is not a valid action name` on both validation paths |
| R3 — `sdlc-actions.ts` exports `RESERVED_ACTIONS`, `BUN_PRESET`, `resolveAction`, `listActions`, `renderScoped`; `renderScoped` quotes with `shQuote` | MET | `packages/app/src/services/sdlc-actions.ts:13,22,68,86,105`; `shQuote` relocated to `packages/app/src/services/shell-quote.ts:11` and used at `:113,118` with a function replacer (so `$&` in a path is literal — pinned by `packages/app/tests/services/sdlc-actions.test.ts:166`); `quality-gate.ts:58` imports it; `rg shQuote` finds no other importer, and `packages/app` is `"private": true` (`packages/app/package.json:5`), so dropping the old re-export breaks nothing |
| R4 — no `builder` block ⇒ every reserved action = today's exact command, incl. `rules-pre`/`rules-post` on the legacy scripts | MET | `BUN_PRESET` `sdlc-actions.ts:22-41` matches satellite §3.1 (`docs/design/sdlc-actions.md:99-118`) line for line, and matches the light-gate literals `quality-gate.ts:546,554,567`; pinned twice in `packages/app/tests/services/sdlc-actions.test.ts:21-86`: an independent transcription of the satellite table over all 18 names, plus rendered `lint-changed`/`typecheck-changed`/`test-changed` compared to live `planLightChecks()` output |
| R5 — `preset: none` ⇒ `rules-pre`/`rules-post` = `spur rule run --preset recommended-*-check --fail-on warning --no-logo`, everything else undeclared unbound | MET | `sdlc-actions.ts:47-50` + resolution order `:68-83`; `packages/app/tests/services/sdlc-actions.test.ts:88-107` asserts both defaults and that the other 16 reserved actions resolve `{source:'unbound', kind:'unbound'}` |
| R6 — `config.example.yaml` and the config JSON schema document both keys | MET | `config/config.example.yaml:233-254`; `apps/cli/schemas/spur-config.schema.json:344-366` (`preset` enum + default, `actions` `propertyNames` pattern, `oneOf` string/array, reserved-name list in the description). The documented block itself validates — probe: feeding the example's uncommented `builder` block to `BuilderConfigSchema` prints `ACCEPTED` |
| AC1 — project config binds actions to stack-specific commands | MET | Same schema evidence as R1/R2 plus the resolver path: probe of a `preset: none` config (`build: make build`, `check: [lint, test]`, …) loads through the real loader on both validation paths and yields `builder={"preset":"none","actions":{...}}`; `resolveAction` returns those strings as `source:'config'` (`sdlc-actions.test.ts:109-131`) |
| AC2 — existing bun projects keep working with no config change | MET | This repository's own `.spur/config.yaml:98` (a `builder` block with `bump-ver` only) loads on both validation paths and the parsed builder is `{"preset":"bun","actions":{}}` — defaults, no edit required; the R4 byte-identity tests are the second half (no command text moves) |

##### Fresh verification evidence (this review run)

```
cd packages/config && bun test
  273 pass / 0 fail (19 files)          # includes the 13 new schema cases
cd packages/app && bun test tests/services/sdlc-actions.test.ts tests/services/shell-quote.test.ts
  13 pass / 0 fail (84 expect calls)
cd packages/app && bun test tests/services/quality-gate-receipt.test.ts
  38 pass / 0 fail                      # shQuote move is behaviour-identical
cd apps/cli && bun test tests/config/embedded-schemas.test.ts tests/config/scheduler-jobs-schema.test.ts
  10 pass / 0 fail                      # edited JSON schema still parses/embeds
```

Loader probes against a temp `.spur/config.yaml` (both `validateJsonSchema: true` and `false`): a valid
`preset: none` + `actions` block loads and returns the block; `preset: python` is rejected with
`builder.preset` named; `actions: {"Bad Name": make}` is rejected with `builder.actions.Bad Name` named.
Probe scripts were written to `/tmp` only; no repo file was touched.

##### Explicit evidence gaps

- The light gate was **not** re-run here. The task's `## Testing` records `spur task gate 1222 light` as 7 PASS / 1 FAIL, the failure being `rules:post` → `coverage-artifact: missing — no coverage certification found` from `scripts/commands/coverage-provenance-check.ts` — environmental and pre-existing on this tree (nothing in this diff produces `.coverage/`). This review neither confirms nor clears it.
- The JSON-schema/zod parity claim rests on three probed inputs, not an exhaustive matrix (finding 4).
- R3's exports have no in-repo consumer yet (1223/1224), so they are verified as pure functions only; integration through the CLI verb and the gate is unproven by construction.
- The name grammar `^[a-z][a-z0-9-]*$` matches design §3.2 verbatim but also accepts `foo-` / `a--b`; noted as design-frozen, not raised as a finding.

##### SECUA and architecture notes

- **Correctness.** Resolution order matches design §3.2 (`builder.actions` → preset → stack-neutral default → unbound), a declared entry replaces the preset entry whole, and composites are action names only (no raw commands). Cycle detection handles self-, two- and n-cycles, dedupes a diamond to one report, and finds cycles reached through a non-cycle root — all probed.
- **Security.** The resolver is pure (no fs, no shell); the only trust boundary is the project's own config, the same one `package.json` scripts already sit behind. Every substituted path goes through `shQuote` and through a function replacer, so neither a shell metacharacter nor a `$&` in a filename changes the command.
- **Efficiency.** One table for every bun literal; the only hot spot is the path-enumerating cycle walk (finding 3).
- **Usability.** Load errors name the key path; the JSON schema and `config.example.yaml` both carry the reserved vocabulary and the placeholder rule in prose; the resolver-side `renderScoped` throws rather than silently widening *when a value is missing*.
- **Architecture.** Dependency direction is app → config, exactly as the design's anti-pattern forbids the inverse; the vocabulary lives once in `packages/config` and `RESERVED_ACTIONS` aliases it instead of copying; `shQuote` now has one home for the two services that need it (`packages/app/src/services/project-start.ts:70` keeps a deliberately different always-quote variant). The one structural seam worth naming is the config/app split of "which actions resolve under `none`" (finding 2).

**Next:** 1223 and 1224 consume `resolveAction`/`listActions`/`renderScoped` unchanged; close finding 1 (empty scope) and finding 2 (cross-package pin) there.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T04:28:38.795Z todo → wip (system)
- 2026-10-17T04:39:07.729Z wip → testing (system)
- 2026-10-17T04:40:13.164Z testing → done (system)

