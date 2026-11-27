---
schema_version: 1
name: Let a project declare which tests a non-code corpus change affects
status: done
template: feature-impl
created_at: 2026-11-27T18:20:16.898Z
updated_at: "2026-11-27T22:23:01.087Z"
feature_id: H16

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close
---

## 1474. Let a project declare which tests a non-code corpus change affects

### Background

The light (changed-scope) gate selects tests only from code paths: `lightScope`
(`packages/app/src/services/quality-gate.ts:655-726`) maps `<ws>/src/x.ts` → `<ws>/tests/x.test.ts`,
keeps changed test files, and hardcodes one project's corpus knowledge — the `plugins/sp/**` block
(`:671-705`, skill/command prose → `plugins/sp/tests/skill-structure.test.ts`,
`scripts/commands/flag-contract-parity.test.ts`). A change to any other non-code corpus (workflow YAML,
JSON presets, plugin manifests) selects **no test**, so the light/deferred tier certifies it green and
the regression surfaces only at the feature-level full gate.

Observed in knowledge-kit (D9 batch, 2026-11-27): edits under `plugins/kk/workflows/*.yaml` are guarded
only by `apps/cli/tests/kk-news-generate-dag.test.ts`, which the light tier never selected. The
paths named in the Design example exist in that repo (checked 2026-11-27).

Wiring today: the gate receives `builder` config through `QualityGateOptions.builder`
(`quality-gate.ts:138`), set by the CLI from `context.spurConfig?.builder`
(`apps/cli/src/commands/task/gate.ts:37`), and consumed by `planLightChecks` (`:962`). `lightScope`
itself has one production caller (`:946`) and test callers in `quality-gate-receipt.test.ts` and
`quality-gate-affected-scope.test.ts`. Tests run per workspace derived from each test path
(`planLightChecks`, `:798-810`), independent of `scope.workspaces`.

**Refine corrections (2026-11-27)**

- Background held a verbatim copy of the AC block → replaced with the problem statement above.
- "validate the regex at config load" → load is two-layer: Zod (`packages/config/src/index.ts:1187-1201`)
  **and** the hand-mirrored JSON Schema `apps/cli/schemas/spur-config.schema.json`, enforced in production
  by the loader (`packages/config/src/loader.ts:85-90`) and guarded by
  `apps/cli/tests/config/spur-config-schema-parity.test.ts` → Plan now updates both (commit `c6bcde638`
  is the precedent for a key missing from the JSON Schema).
- "the workspace carrying that test is admitted to the plan" → test admission is per test path
  (`:798-810`), not via `scope.workspaces`; adding the test workspace there would also add an unrelated
  typecheck → AC1 now asserts the `test:<ws>` plan, and the map does not touch `scope.workspaces`.
- "document the key in the design doc's config table" → owner is `docs/design/sdlc-actions.md` §3.2
  (`builder.actions` / `builder.preset` binding).
- Plan step "add the entries to knowledge-kit's config" → another repo; out of scope for this task's
  diff → moved to a post-release dogfood note in References, not a Plan step.

### Requirements

- [x] R1. `builder.scopeTestMap` is an optional list of `{ when: string; tests: string[] }` in `.spur/config.yaml`; `when` is a regular expression matched against each repo-relative changed path; `tests` are repo-relative test paths (non-empty list).
- [x] R2. `lightScope` applies every matching entry per changed file, adding each declared test that passes the injected `exists` filter, deduped with all other selections; this runs before (and in addition to) the `plugins/sp/**` block and the generic `src → tests` mapping.
- [x] R3. No `scopeTestMap` (or an empty one) leaves `lightScope` output byte-identical for every existing caller and fixture.
- [x] R4. An invalid `when` regex or an empty `tests` list fails config load with a message naming `builder.scopeTestMap.<i>`; a declared test path that does not exist is silently skipped by `exists`.
- [x] R5. The key is in the JSON Schema (`apps/cli/schemas/spur-config.schema.json`) and documented in `docs/design/sdlc-actions.md` §3.2.

**Out of scope:** migrating the hardcoded `plugins/sp/**` block onto the map (separate behaviour-preserving task); glob syntax; any change to the full tier; editing knowledge-kit's config.

### Acceptance Criteria

```gherkin
@core
Scenario: AC1 — A declared corpus mapping selects its test across workspaces (req: R1, R2)
  Given builder.scopeTestMap declares "^plugins/kk/workflows/.*\\.yaml$" → apps/cli/tests/kk-news-generate-dag.test.ts and that test exists
  When lightScope scopes a change to plugins/kk/workflows/kk-news-generate.yaml
  Then scope.tests includes apps/cli/tests/kk-news-generate-dag.test.ts
  And planLightChecks yields a test:apps/cli plan carrying tests/kk-news-generate-dag.test.ts
  # layer: packages/app/tests/services/quality-gate-affected-scope.test.ts

@core
Scenario: AC2 — The map never widens a project that declares none (req: R3)
  Given a project with no scopeTestMap
  When lightScope scopes the same YAML change
  Then the selection is identical to today's (no tests added, no error)
  # layer: packages/app/tests/services/quality-gate-affected-scope.test.ts

@edge
Scenario: AC3 — A bad mapping fails config load, a stale one degrades quietly (req: R4, R5)
  Given builder.scopeTestMap declares an invalid regular expression
  When the project config loads
  Then the load fails naming builder.scopeTestMap
  And a declared test path that no longer exists is skipped by the exists filter instead of failing
  # layer: packages/config/tests (Zod parse) + apps/cli/tests/config/spur-config-schema-parity.test.ts (JSON Schema mirror)
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T20:21:30.384Z

- **Closed — regex vs glob:** regex (`when`), matching the existing `TEST_FILE_PATTERN`-style code; no glob dependency.
- **Closed — admit test workspace into `scope.workspaces`?** No. Tests plan per test path (`quality-gate.ts:798-810`); widening `scope.workspaces` would add an unrelated typecheck.
- **Closed — compile where:** validate with `new RegExp` in a Zod `superRefine` at load; construct the `RegExp` again at use (no transform, so `BuilderConfig` stays plain JSON for the JSON Schema mirror).
- **Deferred — migrate `plugins/sp/**` onto the map:** separate task, owner operator; only when this lands and sp's own config can declare equivalent entries.

### Design

**Frozen names.** Config key `builder.scopeTestMap`; entry fields `when` (string regex) and `tests`
(string[]); exported type `ScopeTestMapEntry` from `packages/config`; `lightScope` fourth parameter
`scopeTestMap?: readonly ScopeTestMapEntry[]`.

```yaml
builder:
  scopeTestMap:
    - when: "^plugins/kk/workflows/.*\\.yaml$"
      tests: ["apps/cli/tests/kk-news-generate-dag.test.ts"]
```

**Schema (`packages/config/src/index.ts:1187-1201`).** Add
`scopeTestMap: z.array(z.object({ when: z.string().min(1), tests: z.array(z.string().min(1)).min(1) })).default([])`
to `BuilderConfigSchema`, and extend its `superRefine` with a `new RegExp(when)` try/catch that adds an
issue at path `['scopeTestMap', i, 'when']` with message `invalid regular expression: <err>` — the loader
already joins issue paths into the error (`loader.ts:610-616`). Mirror the key in
`apps/cli/schemas/spur-config.schema.json` under `builder.properties` (array of objects, `when` string,
`tests` string array `minItems: 1`).

**Selection (`quality-gate.ts:655`).** `lightScope(changedFiles, exists, graph, scopeTestMap = [])`.
Compile once at function entry (`scopeTestMap.map(e => ({ re: new RegExp(e.when), tests: e.tests }))`).
At the top of the per-file loop — before the `plugins/sp/` branch, whose `continue` would otherwise skip
it — for each entry whose `re.test(file)`, add each `t` with `exists(t)` to `tests`. Do not touch
`workspaces`. Pass `options.builder?.scopeTestMap` from `runLightGate` (`:946`).

**Precedence.** Union, not override: a file matching the map still gets its generic/sp mapping. An entry
matching nothing is not an error.

**Anti-patterns.** No glob library; no new CLI flag or verb; no edit to the `plugins/sp/**` block; no
`RegExp` stored in config (keeps JSON Schema parity); no change to `planLightChecks` or the full tier;
no validation of `tests` paths at load (a renamed test degrades to "not selected", R4).

**Files.** `packages/config/src/index.ts`, `apps/cli/schemas/spur-config.schema.json`,
`packages/app/src/services/quality-gate.ts`, `docs/design/sdlc-actions.md` §3.2, tests per AC. No
`dependencies[]`; no dependents. Concurrency: worktree `spur-new-runall-1464-1472-aedfe887` touches none
of these files (2026-11-27); no `wip` tasks. 1473 also edits `quality-gate.ts` (`runDeferredGate`,
`:886-896`) — disjoint hunks; land sequentially.

### Plan

0. Precondition: tree clean of other tasks' changes; `bun install` matches the lockfile.
1. AC3 tests first: Zod parse of `builder.scopeTestMap` with a bad regex fails naming `builder.scopeTestMap.0.when`; empty `tests` fails; a valid map parses (in `packages/config/tests`, beside the existing builder schema tests).
2. Schema: add `scopeTestMap` + `superRefine` regex check; export `ScopeTestMapEntry`; mirror in `apps/cli/schemas/spur-config.schema.json`; run `(cd apps/cli && bun test tests/config/spur-config-schema-parity.test.ts)`.
3. AC1/AC2 tests in `packages/app/tests/services/quality-gate-affected-scope.test.ts`: declared YAML mapping selects the cross-workspace test and `planLightChecks` emits `test:apps/cli`; matching-and-generic change unions both; unmatched pattern and missing test path select nothing; no map → identical output.
4. Selection: add the parameter and loop step in `lightScope`; pass `options.builder?.scopeTestMap` at `:946`.
5. Docs: add the key to `docs/design/sdlc-actions.md` §3.2 (same commit, T3).
6. Focused: `(cd packages/app && bun test tests/services/quality-gate-affected-scope.test.ts tests/services/quality-gate-receipt.test.ts)`, `(cd packages/config && bun test)`; then `bun run spur-check`.

### Solution

One optional config key, applied where the light tier selects tests. No CLI surface, no engine change, no
new dependency (the regex is `RegExp`, not a glob library).

| Changed file | Change and why |
| --- | --- |
| `packages/config/src/index.ts:1185` | `ScopeTestMapEntrySchema` (`when` non-empty string, `tests` non-empty string list) and the exported `ScopeTestMapEntry` type; `builder.scopeTestMap` defaults to `[]` at `:1236`, so every existing config parses unchanged (R1, R3). |
| `packages/config/src/index.ts:1198` | `refineScopeTestMap` compiles each `when` at load and raises `builder.scopeTestMap.<i>.when: invalid regular expression: …` on failure; `tests` paths are deliberately not filesystem-checked, so a renamed test degrades to "not selected" instead of failing load (R4). |
| `apps/cli/schemas/spur-config.schema.json:679` | The hand-written JSON Schema mirror (`array` of `{when, tests}`, `minItems: 1`) that the loader enforces and the parity test compares against Zod (R5). |
| `packages/app/src/services/quality-gate.ts:659` | `lightScope` takes a fourth `scopeTestMap` parameter, compiles the patterns once, and applies every matching entry per changed file *before* the `plugins/sp/` branch — whose `continue` would otherwise skip it — admitting each declared test that passes the injected `exists` filter, deduped with all other selections. `scope.workspaces` is untouched (R2). |
| `packages/app/src/services/quality-gate.ts:964` | `runLightGate` passes `options.builder?.scopeTestMap`, the same `builder` object the CLI already supplies from `context.spurConfig?.builder` (R2 wiring). |
| `docs/design/sdlc-actions.md:143` | §3.2 documents the key, the union semantics, the no-widening rule and the load-time failure (R5, same commit — T3). |
| `packages/config/tests/builder-actions-schema.test.ts:120` | Zod parse: default `[]`, a valid map, an invalid regex naming `scopeTestMap.0.when`, an empty `tests` list and a blank `when` (R4). |
| `apps/cli/src/commands/self/init.ts:291` | The one production caller that builds a partial `BuilderConfig` literal now carries the defaulted `scopeTestMap: []`, so `resolveAction` keeps accepting it after the key became part of the type. Same for the two test files that assert on such literals (`apps/cli/tests/commands/self/init.test.ts:385`, `packages/app/tests/services/sdlc-actions.test.ts:205`). |
| `packages/app/tests/services/quality-gate-affected-scope.test.ts:244` | AC1 (a declared YAML mapping selects a cross-workspace test and `planLightChecks` emits `test:apps/cli` carrying it, with `workspaces` still empty), AC2 (no map ⇒ byte-identical selection), and the union/dedupe and unmatched/stale cases (R2, R3). |

**Deliberate omissions.** No `scope.workspaces` widening (test admission is per test path, so a widening would add
an unrelated typecheck); no glob syntax; no `RegExp` stored in config (it would break the JSON Schema mirror); no
validation of `tests` paths at load; no change to `planLightChecks`, the full tier, or the hardcoded
`plugins/sp/**` block — migrating that block onto this key is the deferred follow-up named in the task's Q&A.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/config/src/index.ts:1185` declares `ScopeTestMapEntrySchema` (`when`: non-empty string, `tests`: non-empty `string[]`) and exports `ScopeTestMapEntry`; `:1236` binds it as `builder.scopeTestMap` with a `[]` default, so `.spur/config.yaml` accepts the declared list and every existing config parses unchanged. Pinned by `packages/config/tests/builder-actions-schema.test.ts:120` (default + a valid mapping round-trip). |
| R2 | MET | `packages/app/src/services/quality-gate.ts:659` takes the map as a fourth parameter, `:665` compiles the patterns once, and `:668` applies every matching entry per changed file *before* the `plugins/sp/` branch (whose `continue` would skip it), adding each declared test that passes the injected `exists` and deduping into the existing set; `:964` passes `options.builder?.scopeTestMap` from the same builder object the CLI already supplies. Pinned by `packages/app/tests/services/quality-gate-affected-scope.test.ts:244` (AC1 selects a cross-workspace suite and `planLightChecks` emits `test:apps/cli` carrying it; the union/dedupe case at `:277`). |
| R3 | MET | No map ⇒ the fourth parameter defaults to `[]`, no entry can match, and the function body is otherwise unchanged; the AC2 test asserts `lightScope(changed, exists, graph, [])` is `toEqual(lightScope(changed, exists, graph))` plus 40 passing `quality-gate-receipt` tests on the unchanged selection path (`packages/app/tests/services/quality-gate-affected-scope.test.ts:262`). Existing callers keep their 3-argument form. |
| R4 | MET | `packages/config/src/index.ts:1198` compiles each `when` at load and raises `builder.scopeTestMap.<i>.when: invalid regular expression: …` (asserted at `packages/config/tests/builder-actions-schema.test.ts:135`); the `tests` list is deliberately not filesystem-checked, and the stale-path case is asserted to select nothing (`packages/app/tests/services/quality-gate-affected-scope.test.ts:290`). |
| R5 | MET | `apps/cli/schemas/spur-config.schema.json:679` mirrors the key (array of `{when, tests}` with `minItems: 1`); the Zod↔JSON-Schema parity test passes (`cd apps/cli && bun test tests/config/spur-config-schema-parity.test.ts` → 1 pass). `docs/design/sdlc-actions.md:143` documents the key, union semantics, the no-widening rule and the load-time failure in the same commit (T3). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A declared corpus mapping selects its test across workspaces (req: R1, R2) | MET | test | `packages/app/tests/services/quality-gate-affected-scope.test.ts:244` (`lightScope` selects `apps/cli/tests/kk-news-generate-dag.test.ts` for the declared YAML change, `workspaces` stays empty, and `planLightChecks` yields a `test:apps/cli` plan naming it) — 22 pass / 0 fail in that file. |
| AC2 — The map never widens a project that declares none (req: R3) | MET | test | `packages/app/tests/services/quality-gate-affected-scope.test.ts:265` asserts equality with the pre-change selection for an absent map; the untouched `quality-gate-receipt` suite (40 pass) exercises the same selection path through `runLightGate`. |
| AC3 — A bad mapping fails config load, a stale one degrades quietly (req: R4, R5) | MET | test | `packages/config/tests/builder-actions-schema.test.ts:120` (invalid regex names `scopeTestMap.0.when`; empty `tests` and blank `when` rejected) — 18 pass / 0 fail; `apps/cli/tests/config/spur-config-schema-parity.test.ts` 1 pass for the mirrored key; the stale path case is asserted at `packages/app/tests/services/quality-gate-affected-scope.test.ts:290`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature H16.
- `docs/design/sdlc-actions.md` §3.2 — builder binding owner.
- Post-release dogfood (not part of this diff): add `plugins/kk/workflows/**`, `plugins/kk/publish-presets/**`, `plugins/*/*/plugin.json` entries to knowledge-kit's `.spur/config.yaml` and confirm `spur task gate <wbs> light` selects the DAG suite on a YAML-only change.

### History

- 2026-11-27T18:20:58.087Z backlog → todo (system)
- 2026-11-27T22:17:24.198Z todo → wip (system)
- 2026-11-27T22:22:54.375Z wip → testing (system)
- 2026-11-27T22:23:01.054Z testing → done (system)

