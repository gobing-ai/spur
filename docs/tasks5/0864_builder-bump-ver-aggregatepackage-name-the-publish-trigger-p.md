---
schema_version: 1
name: "builder.bump-ver.aggregatePackage: name the publish trigger package in config"
status: testing
template: standard
created_at: 2026-09-15T23:51:55.570Z
updated_at: "2026-09-16T00:08:03.820Z"

---

## 0864. builder.bump-ver.aggregatePackage: name the publish trigger package in config

### Background

Captured from the creation title: "builder.bump-ver.aggregatePackage: name the publish trigger package in config".

### Requirements

- R1. `builder.bump-ver.aggregatePackage` (zod + the hand-maintained `apps/cli/schemas/spur-config.schema.json`) names the package whose own release tag is the publish trigger for the aggregate (`--all`) path, by unscoped package id.
- R2. `bump-ver --all <version>` bumps that package alongside the `workspace:`-pinned set, and `bump-ver --all --push` pushes that package's own `<scoped-name><separator><version>` tag instead of `<rootName>-v<version>`.
- R3. `drop-tags --all <version> [--remote]` drops the same resolved aggregate tag (bump and drop share one resolver).
- R4. An `aggregatePackage` that matches no workspace package aborts before any mutation and lists the known ids; unset keeps today's behavior byte-identical (root-manifest-name discovery, `<rootName>-v<version>` tag).

### Acceptance Criteria

- Scenario: A repo whose root manifest name is not the published package declares it
  Given a workspace root named `knowledge-kit` and a published workspace package `@gobing-ai/knowledge-kit` (`knowledge-kit`)
  When `builder.bump-ver.aggregatePackage: knowledge-kit` is set and `bump-ver --all 0.0.15 --push` runs
  Then `@gobing-ai/knowledge-kit` carries 0.0.15 and the pushed trigger tag is `@gobing-ai/knowledge-kit-v0.0.15`
  And no `knowledge-kit-v0.0.15` aggregate tag is created

- Scenario: Default discovery is unchanged for the root-named CLI repo
  Given the root manifest name equals the published package full name
  When `--all` runs with `aggregatePackage` unset
  Then the aggregate tag is `<rootName>-v<version>` and only that tag is created for that package

- Scenario: An unknown aggregate package fails loudly
  Given `aggregatePackage: nope` and no workspace package with that id
  When `bump-ver --all 0.3.0` runs
  Then it aborts with `unknown builder.bump-ver.aggregatePackage "nope"` before committing or tagging

- Scenario: drop-tags --all removes the configured trigger tag
  Given a repo released with `aggregatePackage` set
  When `drop-tags --all <version> --remote` runs
  Then the configured aggregate tag is deleted locally and on origin

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

- `packages/config/src/index.ts:748` — `BuilderBumpVerConfigSchema.aggregatePackage` (optional string, unscoped package id) with the default documented inline.
- `apps/cli/schemas/spur-config.schema.json:315` — the same key mirrored into the active runtime validator (embedded through `apps/cli/src/config/embedded-schemas.ts:19`).
- `apps/cli/src/release-ops.ts:77` — `resolveAggregatePackage()` resolves the configured id (loud, id-listing error on an unknown one) and otherwise keeps the root-manifest-name discovery; `apps/cli/src/release-ops.ts:248` adds its `packageName` to the `--all` pinned set.
- `apps/cli/src/release-ops.ts:99` — `resolveAggregateTag()` returns that package's own `releaseTag()` (separator-aware, scoped) or `<rootName>-v<version>` when nothing resolves.
- `apps/cli/src/release-ops.ts:537` (bump) and `apps/cli/src/release-ops.ts:675` (drop) — both aggregate paths call the one resolver, so the pushed and dropped tag cannot diverge.
- `docs/design/cli-contracts.md:191` and `.spur/config.yaml:78` — the knob, its default, and the failure class it fixes.
- `apps/cli/tests/release-ops.test.ts:159` — three tests: the configured target is bumped and the pushed trigger tag is the scoped per-package tag; an unknown id aborts before mutating; `drop-tags --all` removes the configured tag locally and on origin.

### Testing

- Unit — `bun test apps/cli/tests/release-ops.test.ts`: **31 pass / 0 fail**, including the three new cases at `apps/cli/tests/release-ops.test.ts:159` (configured target is bumped and the pushed trigger tag is `@demo/app-v0.3.0`; unknown id aborts with no local tag; `drop-tags --all --remote` removes the configured tag locally and on origin). The pre-existing `--all`/root-named-CLI cases still assert `@demo/root-v0.3.0`, covering the unchanged default.
- Config surface — `bun test apps/cli/tests/config packages/config/tests`: **218 pass / 0 fail** (the embedded `apps/cli/schemas/spur-config.schema.json` copy the loader validates against).
- Config-level end-to-end probe (`/tmp/kk-aggregate-probe`, a throwaway repo shaped like knowledge-kit: unscoped root `knowledge-kit`, CLI `@gobing-ai/knowledge-kit`, pinned `@gobing-ai/kk-core`), driven by this repo's CLI:
  - with `builder.bump-ver.aggregatePackage: knowledge-kit` → `bump-ver --all 0.0.16` committed `bump knowledge-kit + kk-core to 0.0.16` and emitted `@gobing-ai/knowledge-kit-v0.0.16` (trace `@gobing-ai/kk-core-v0.0.16`); no `knowledge-kit-v*` tag.
  - the same command on the same repo before the key existed, and again after removing the builder block → `bump kk-core to 0.0.17` and `knowledge-kit-v0.0.17` (the old, silently unpublished shape) — default behavior is unchanged.
  - an id that matches no package (`aggregatePackage: nope`) aborts pre-flight with `unknown builder.bump-ver.aggregatePackage "nope"` and no commit/tag.
- Gates: `biome check` clean on the four changed source/schema files; `typecheck` clean for `@gobing-ai/spur` and `@gobing-ai/spur-config`; `rule run --preset recommended-pre-check` 45 rules pass, `recommended-post-check` 2 rules pass.
- Full suite `bun run test`: **8365 pass / 1 fail** — the single failure is a 5s timeout in `plugins/sp/tests/feature-dev-precheck.test.ts` under suite load; that file passes in isolation (**27 pass / 0 fail**). `apps/server/tests/serve.test.ts` typecheck errors and the modified `apps/server/tests/serve.test.ts` / `plugins/sp/lib/idea-handoff.generated.mjs` in the tree belong to a concurrent writer, not this task.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-16T00:07:54.657Z backlog → todo (system)
- 2026-09-16T00:07:54.857Z todo → wip (system)
- 2026-09-16T00:08:03.820Z wip → testing (system)

