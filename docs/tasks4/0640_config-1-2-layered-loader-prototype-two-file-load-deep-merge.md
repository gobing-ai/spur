---
schema_version: 1
name: "Config 1.2: layered loader prototype (two-file load, deep merge, post-merge validation)"
status: done
template: brainstorm
created_at: 2026-08-23T20:51:10.785Z
updated_at: "2026-08-23T22:50:40.409Z"
feature_id: A4
dependencies: ["0639"]
---

## 0640. Config 1.2: layered loader prototype (two-file load, deep merge, post-merge validation)

### Background
**Wayfinder ticket** (`wayfinder:prototype`) under map **[A4 Spur config 1.2: global + project
layered configuration](../features/A4_spur-config-1-2-global-project-layered-configuration.md)**.
**Blocked by 0639** — it implements 0639's merge table.

`resolveConfigFile` (`packages/config/src/loader.ts:152`) chooses one file: if
`.spur/config.yaml` exists the global `~/.config/spur/config.yaml` is never read. ADR-015 already
granted every other bundled asset the `bundled → global → local` ladder; `config.yaml` is the one
that never received it. This ticket is the rough end-to-end take that proves the layered contract.

Operator rulings this must honor: one schema for both layers; total automatic deep merge;
`agent.executors` merged by `name`; **validation runs once, on the merged result**. That last one is
load-bearing — validating each layer separately would force executor `agent` to become optional,
which moves a misrouted-dispatch failure from config-load to run time.
### Requirements
- [x] R1. Replace `resolveConfigFile`'s either/or (`loader.ts:152`) with a resolution that returns both
  layers when both exist, preserving today's behavior when only one does.
- [x] R2. Load both layers as raw YAML and deep-merge per 0639's classification table, project over
  global, then validate the merged object once with `spurConfigSchema`.
- [x] R3. Decide and implement where `loadStructuredConfig`'s JSON Schema validation runs
  (`loader.ts:307` runs it per file today) — it cannot stay per-file if each layer is a legal subset.
- [x] R4. Extend the cache key to cover both files' mtimes; `loadSpurConfig` (`loader.ts:212`) keys on one
  today, so editing the global file would serve a stale merged config.
- [x] R5. Define and implement `SPUR_SKIP_GLOBAL_CONFIG=true` under merge — today it means "do not fall
  back"; under layering it must mean "project layer only".
- [x] R6. Drop `"required": ["version", "name"]` from `apps/cli/schemas/spur-config.schema.json:7`, and
  confirm the executor (`:113`) and team (`:163`) item-level `required` still hold against the
  merged result.
- [x] R7. Config-load errors must name the layer a key came from; a merged-shape error with no
  provenance is not actionable across two files.
- [x] R8. Check the 8 known consumers of `loadSpurConfig` / `resolveConfigFile` still compile and pass:
  `apps/cli/src/index.ts`, `apps/cli/src/commands/workflow.ts`, `apps/cli/src/config/embedded-schemas.ts`,
  `apps/cli/src/history-refresh.ts`, `apps/server/src/serve.ts`,
  `packages/app/src/services/team-service.ts`, `packages/app/src/services/workflow-service.ts`.
### Acceptance Criteria
```gherkin
Feature: Layered config loading

  Scenario: A project fragment overrides one field of a global executor
    Given a global config declaring executor "omp" with agent "omp" and tier "standard"
    And a project config declaring only "- name: omp" with "model: volc/glm-5.2"
    When the config is loaded
    Then the merged executor "omp" has agent "omp", tier "standard", and model "volc/glm-5.2"

  Scenario: A fragment that never gains a required field still fails load
    Given neither layer supplies an "agent" field for executor "ghost"
    When the config is loaded
    Then loading fails with an error naming the executor and the missing field

  Scenario: Editing the global file invalidates the cache
    Given a merged config has been loaded and cached
    When only the global config file is modified
    Then the next load reflects the change rather than the cached value

  Scenario: Project-only mode ignores the global layer
    Given SPUR_SKIP_GLOBAL_CONFIG is "true"
    And both layers exist
    When the config is loaded
    Then the result equals the project layer parsed alone

  Scenario: Only one layer present behaves as it does today
    Given no global config file exists
    When the project config is loaded
    Then the result is unchanged from the pre-layering behavior
```
### Q&A
**Open (operator) — does `version: "1.2"` gate anything mechanically?** Nothing is keyed on `version`
today; `packages/config/src/index.ts:668` says so explicitly. Options are label-only with a warning
below `1.2`, a real `spur self migrate` step, or a hard load error. A4 map open question 1.

**Deferred with a stated default.** If unruled when this task runs, implement label-only: the loader
accepts `1`, `1.1`, and `1.2` identically and neither warns nor migrates. Layering must not depend on
a version bump — an existing `1.1` project config merges under a global config correctly, and making
the merge conditional on a version label would strand every project until it is edited.

**Open (operator) — how does a project remove a global executor?** `merge-by-key:name` has no
deletion primitive; a `disabled: true` field was offered during charting and not taken. A4 map open
question 2. This task does **not** invent one — if the answer is "it can't yet", that is a known,
recorded one-way property of the merge, not a gap to fill unilaterally.

**Closed.** Validation runs once on the merged result; both layers share one schema; the merge is
total and automatic. Operator rulings, 2026-08-23.
### Design
**WHAT.** Turn `resolveConfigFile`'s either/or into a two-layer merge: read both
`~/.config/spur/config.yaml` and `.spur/config.yaml`, deep-merge per 0639's table, validate the
merged object once. Rough end-to-end take that proves the contract, not a polished release.

**WHY.** ADR-015 (`docs/00_ADR.md:116`) already granted every bundled asset the ladder
`bundled → global → local`; `config.yaml` is the one asset that never received it, so every project
re-declares the whole `agent` block. Making the layer merge is the single change A4's other tickets
are downstream of.

**WHERE.** Primary: `packages/config/src/loader.ts` (`resolveConfigFile:152`, `loadSpurConfig:212`,
`loadSpurConfigFile:287`). Secondary: `apps/cli/schemas/spur-config.schema.json:7`. Tests under
`packages/config/tests/`.

**Frozen names.**
- `loadSpurConfig(cwd, opts) → Promise<SpurConfig>` — signature **unchanged**. Seven external
  consumers call it; a signature change turns a loader task into a repo-wide refactor.
- New: `resolveConfigLayers(cwd?) → { global?: string; project?: string }`. `resolveConfigFile`
  survives as a thin wrapper over it (project path, else global) so any consumer wanting one path
  keeps compiling.
- Env var stays `SPUR_SKIP_GLOBAL_CONFIG`; under merge it means *project layer only*.
- The merge helper is local to `loader.ts` and unexported.

**CF-safe boundary (hard constraint).** The merge lives in `packages/config/src/loader.ts`, never in
`packages/config/src/index.ts`. The Cloudflare Workers bundle imports only the core; the loader pulls
`yaml` + `node:fs`, which crash miniflare. `loader.ts:1-14` states this contract — honor it.

**Precedence and algorithm.** Resolve layers → parse each as raw YAML (no per-layer zod, no per-layer
JSON Schema) → merge project over global per 0639's strategy column → `spurConfigSchema.parse()` once
on the result → `expandTeamTildes`. JSON Schema validation moves off the per-file path at
`loader.ts:307` for the same reason: each layer is a legal subset, so a per-file check that requires
`version`/`name` rejects a valid global file.

**Cache.** The key at `loader.ts:216` embeds one file's `mtimeMs`. Extend it to both layers' mtimes,
using a stable sentinel for an absent layer, so editing the global file invalidates the merged entry.

**Anti-patterns — do not.**
- Do **not** make `AgentExecutorConfigSchema.agent` (`index.ts:206`) or the `TeamConfigSchema`
  required fields (`index.ts:288-291`) optional. That is the trap validate-after-merge exists to
  avoid: it admits `{name: omp}` with no agent in *either* layer, moving a misroute from config-load
  to dispatch. The operator ruled explicitly against it.
- Do not add a second, lenient "partial config" schema. One schema, one parse.
- Do not change `loadSpurConfig`'s exported signature or delete `resolveConfigFile`.
- Do not add a deep-merge dependency. The 0639 table has five strategies; hand-writing them is
  smaller than the adapter a library would need for `merge-by-key:name`.
- Do not implement a global-layer key whitelist. Out of scope by operator ruling.

**Cross-task.** Assumes from 0639: the per-key strategy column, including the `rules.paths` /
`workflows.paths` verdict. If that verdict is still open at start, use `array-concat` (0639 § Q&A
default) and record the assumption. Leaves for the graduating implementation ticket: the seeding
change (0641's drop set) and the role-SSOT read path (0642) — this task does not touch `init.ts` or
`context.ts`.
### Plan
- [x] Return both layers from config-file resolution (R1)
- [x] Implement raw-YAML load plus deep merge per the 0639 table (R2)
- [x] Relocate JSON Schema validation off the per-file path (R3)
- [x] Key the load cache on both files' mtimes (R4)
- [x] Define project-only mode under merge (R5)
- [x] Drop the top-level required pair from the JSON Schema (R6)
- [x] Add layer provenance to config-load errors (R7)
- [x] Compile and test the seven downstream consumers (R8)
### Solution
**Layer resolution (R1, R5).** `resolveConfigLayers` (packages/config/src/loader.ts:162) returns both layer paths (project `<cwd>/.spur/config.yaml`, global `~/.config/spur/config.yaml`); `SPUR_SKIP_GLOBAL_CONFIG=true` means project layer only. `resolveConfigFile` is now a thin wrapper (`project ?? global`) so single-path consumers compile unchanged.

**Raw read + deep merge (R2).** Each layer is read as raw YAML (`readRawYamlLayer`) and merged by `mergeSpurConfigLayers` (packages/config/src/loader.ts:458) per the 0639 strategy table: maps recurse, scalars and plain arrays replace (project wins), `agent.executors` merge by `name` (packages/config/src/loader.ts:405), `agent.team.*.members` merge by `id ?? executor`, `rules.paths`/`workflows.paths` concatenate with exact-duplicate removal. Bare-string members re-declare wholesale.

**Single merged validation (R2, R3).** `loadMergedConfig` (packages/config/src/loader.ts:606) validates the MERGED object exactly once: `validateDeclaredJsonSchema` (relative `$schema` refs resolve against the project layer directory), then zod parse — never per-file, so legal fragments (executor `agent` from global, rest from project) pass.

**Provenance errors (R7).** zod failures and JSON Schema violations are enriched per issue (`parseMergedWithProvenance` packages/config/src/loader.ts:558, `describeIssueProvenance` packages/config/src/loader.ts:500): by-key array indices are remapped through executor name / member id, and each issue line names the contributing layer (e.g. `executor "ghost" missing in both layers`, `from project layer (key absent there)`); error headers carry both layer paths.

**Cache (R4).** `loadSpurConfig` (packages/config/src/loader.ts:240) keys the cache on both layer paths plus both mtimes; `invalidateSpurConfig` (packages/config/src/loader.ts:274) matches a path at either key position (primary head or global slot).

**Schema (R6).** Dropped `"required": ["version", "name"]` from apps/cli/schemas/spur-config.schema.json (top level); item-level requireds (executor `[name, agent]`, team `[name, work_dir, members]`) unchanged; `version` stays a free string — 1, 1.1, 1.2 all accepted (label-only).

**Tests.** New packages/config/tests/loader-layers.test.ts — 12 scenarios via the hermetic subprocess pattern (HOME redirected to a temp dir): executor fragment merge, merged-passes-but-fragments-fail JSON Schema validation, both provenance error paths, global-layer edit cache invalidation, `SPUR_SKIP_GLOBAL_CONFIG=true` project-only, `rules.paths` concat + dedup, member merge-by-id with stages array-replace, version labels, and single-layer behavior preservation. Full packages/config suite: 155 pass, 0 fail.

**R8 consumers.** Public signatures (`loadSpurConfig`, `resolveConfigFile`, `invalidateSpurConfig`, `loadStructuredSpurConfig`) unchanged; `loadStructuredSpurConfig` now shares `schemaValidationContext` (packages/config/src/loader.ts:326) with the merged path. Workspace lint + test gates run in the Testing stage.

**Diff files:** packages/config/src/loader.ts, apps/cli/schemas/spur-config.schema.json, packages/config/tests/loader-layers.test.ts.
### Testing
**Quality gate (2026-08-23).** `bun run spur-check` PASS end to end: link-check, transition-shim-check, script-contract-check, biome lint, test-pre-check, full test suite (repo-wide), test-post-check (rule sweep: all rules passed, no violations).

**Test evidence.** `cd packages/config && bun test` — 161 pass / 0 fail across 10 files. New coverage: packages/config/tests/loader-layers.test.ts — 18 tests (12 hermetic subprocess layering scenarios + 6 in-process merge-machinery unit tests). Coverage: 100% functions / 97.62% lines aggregate (bun --coverage).

**Typecheck.** `bunx tsc --noEmit` in packages/config — clean.

**Commands (repro):** `bun run spur-check`; `cd packages/config && bun test --coverage`.
### Review
**SECUA self-review (inline review stage, 2026-08-23).**

**Simplicity.** Merge machinery is pure functions over raw YAML objects; no schema-model duplication — strategies dispatch on path shape (by-key via `agent.executors` / `agent.team.*.members` segment match; concat via `rules.paths` / `workflows.paths`), everything else one recursive rule. No speculative config knobs.

**Extensibility.** `ResolvedConfigLayers` + `loadMergedConfig` isolate layering; adding a layer or strategy table row is a local edit. Public signatures (`loadSpurConfig`, `resolveConfigFile`, `invalidateSpurConfig`, `loadStructuredSpurConfig`) unchanged — zero consumer churn (R8).

**Consistency.** House style held: biome 4-space/single quotes clean; TSDoc on all exports (gate-enforced); errors follow the existing "Spur config validation failed" phrasing with layered headers. Shared `schemaValidationContext` removed duplication between merged and structured paths.

**Understandability.** Each merge strategy cites the 0639 table row it implements; provenance walker documented with the by-key remap rationale. Test names state scenario + requirement id.

**Accountability.** Every requirement maps to a test (fragment merge, merged-passes-fragments-fail, provenance errors, cache invalidation, skip-env, concat-dedup, member merge, version labels); errors name executor/member identity and layer, so misconfigurations are actionable without spelunking.

**Findings (none blocking):** 1) `resolveConfigLayers` returns paths, not existence-checked handles — callers re-stat for cache keys; acceptable (single consumer). 2) Subprocess layering tests add ~0.6 s to the suite — bounded by the hermetic pattern already established in loader.test.ts. 3) `RawYamlNode` alias names the pre-parse domain; deep type safety intentionally deferred (zod owns it post-merge).
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-08-23T22:14:13.684Z todo → wip (system)
- 2026-08-23T22:50:40.409Z wip → done (system)
