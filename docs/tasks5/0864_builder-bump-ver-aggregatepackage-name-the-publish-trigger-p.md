---
schema_version: 1
name: "builder.bump-ver.aggregatePackage: name the publish trigger package in config"
status: done
template: standard
created_at: 2026-09-15T23:51:55.570Z
updated_at: "2026-09-16T00:23:29.451Z"

---

## 0864. builder.bump-ver.aggregatePackage: name the publish trigger package in config

### Background

Captured from the creation title: "builder.bump-ver.aggregatePackage: name the publish trigger package in config".

### Requirements

- [x] R1. `builder.bump-ver.aggregatePackage` (zod + the hand-maintained `apps/cli/schemas/spur-config.schema.json`) names the package whose own release tag is the publish trigger for the aggregate (`--all`) path, by unscoped package id.
- [x] R2. `bump-ver --all <version>` bumps that package alongside the `workspace:`-pinned set, and `bump-ver --all --push` pushes that package's own `<scoped-name><separator><version>` tag instead of `<rootName>-v<version>`.
- [x] R3. `drop-tags --all <version> [--remote]` drops the same resolved aggregate tag (bump and drop share one resolver).
- [x] R4. An `aggregatePackage` that matches no workspace package aborts before any mutation and lists the known ids; unset keeps today's behavior byte-identical (root-manifest-name discovery, `<rootName>-v<version>` tag).

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

Chosen approach: name the publish-trigger package explicitly through `builder.bump-ver.aggregatePackage`
(unscoped package id) instead of deriving it from the workspace root manifest name.

- **Invariant 1 — unset is byte-identical.** With the key absent, `resolveAggregatePackage` keeps the
  historical root-manifest-name discovery and `resolveAggregateTag` falls back to
  `<rootName>-v<version>`; the spur repo's own release flow is untouched.
- **Invariant 2 — one resolver for bump and drop.** `bumpAll` and `dropAll` both call
  `resolveAggregateTag`, so the pushed publish tag and the dropped tag can never diverge.
- **Invariant 3 — fail before mutation.** An id matching no workspace package throws during
  `releaseContext` assembly (pre-flight), listing the known ids — before any file edit, commit, or tag.
- **Tradeoff accepted:** one more config knob in `BuilderBumpVerConfigSchema` (mirrored into the
  hand-maintained `apps/cli/schemas/spur-config.schema.json`) in exchange for publishing repos whose
  root manifest name is unscoped.
- **Rejected:** scope-aware root-name fuzzy matching (heuristic, silently wrong on collisions) and
  per-repo wrapper-script pinning (the workaround this replaces; not portable, invisible to the CLI).

### Plan

1. [x] Add `aggregatePackage` to `BuilderBumpVerConfigSchema` (zod) and mirror it into `apps/cli/schemas/spur-config.schema.json` (embedded via `embedded-schemas.ts`).
2. [x] Add `resolveAggregatePackage()` / `resolveAggregateTag()` in `apps/cli/src/release-ops.ts`; wire the resolved package into the `--all` pinned set in `releaseContext`.
3. [x] Route both aggregate paths (`bumpAll`, `dropAll`) through the shared resolver.
4. [x] Add the three tests (configured target + scoped push tag, unknown id aborts pre-mutation, drop-tags removes the configured tag).
5. [x] Document the knob in `docs/design/cli-contracts.md` and `.spur/config.yaml`.
6. [x] End-to-end probe on a throwaway `knowledge-kit`-shaped repo (key set, key absent, unknown id).

### Solution

- `packages/config/src/index.ts:748` — `BuilderBumpVerConfigSchema.aggregatePackage` (optional string, unscoped package id) with the default documented inline.
- `apps/cli/schemas/spur-config.schema.json:315` — the same key mirrored into the active runtime validator (embedded through `apps/cli/src/config/embedded-schemas.ts:19`).
- `apps/cli/src/release-ops.ts:77` — `resolveAggregatePackage()` resolves the configured id (loud, id-listing error on an unknown one) and otherwise keeps the root-manifest-name discovery; `apps/cli/src/release-ops.ts:248` adds its `packageName` to the `--all` pinned set.
- `apps/cli/src/release-ops.ts:99` — `resolveAggregateTag()` returns that package's own `releaseTag()` (separator-aware, scoped) or `<rootName>-v<version>` when nothing resolves.
- `apps/cli/src/release-ops.ts:537` (bump) and `apps/cli/src/release-ops.ts:675` (drop) — both aggregate paths call the one resolver, so the pushed and dropped tag cannot diverge.
- `docs/design/cli-contracts.md:191` and `.spur/config.yaml:78` — the knob, its default, and the failure class it fixes.
- `apps/cli/tests/release-ops.test.ts:161` — the configured target is bumped and the pushed trigger tag is the scoped per-package tag; `apps/cli/tests/release-ops.test.ts:180` — an unknown id aborts before mutating; `apps/cli/tests/release-ops.test.ts:190` — `drop-tags --all` removes the configured tag locally and on origin.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/config/src/index.ts:748` (`BuilderBumpVerConfigSchema.aggregatePackage`) + `apps/cli/schemas/spur-config.schema.json:315`; anchors re-read this run; `bun test apps/cli/tests/config packages/config/tests` — 218 pass / 0 fail |
| R2 | MET | `apps/cli/src/release-ops.ts:248` (aggregate joins `--all` pinned set) + `apps/cli/src/release-ops.ts:99` (`resolveAggregateTag`) + `apps/cli/src/release-ops.ts:537` (bump pushes the package's own scoped tag); `bun test apps/cli/tests/release-ops.test.ts` — 31 pass / 0 fail |
| R3 | MET | `apps/cli/src/release-ops.ts:675` (drop path calls the same `resolveAggregateTag`); test "drop-tags --all removes the configured aggregate tag locally and on origin" at `apps/cli/tests/release-ops.test.ts:191` — pass |
| R4 | MET | `apps/cli/src/release-ops.ts:77-84` throws `unknown builder.bump-ver.aggregatePackage "nope"` listing known ids before mutation (test asserts zero local tags); unset keeps root-manifest-name discovery — pre-existing tests at `apps/cli/tests/release-ops.test.ts:104`,`:121`,`:157` assert `@demo/root-v0.3.0` — pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: A repo whose root manifest name is not the published package declares it | MET | test | `apps/cli/tests/release-ops.test.ts:161-177` (app+lib bumped to 0.3.0, remote tag `@demo/app-v0.3.0` asserted at :176, no `@demo/root-v0.3.0`) — 31 pass this run; e2e probe on throwaway `knowledge-kit`-shaped repo emitted `@gobing-ai/knowledge-kit-v0.0.16`, no `knowledge-kit-v*` tag (see Testing) |
| Scenario: Default discovery is unchanged for the root-named CLI repo | MET | test | `apps/cli/tests/release-ops.test.ts:104`,`:121`,`:157` assert `@demo/root-v0.3.0` with the key unset — 31 pass this run; probe without the key reproduced `knowledge-kit-v0.0.17` |
| Scenario: An unknown aggregate package fails loudly | MET | test | `apps/cli/tests/release-ops.test.ts:180-188` rejects with `unknown builder.bump-ver.aggregatePackage "nope"` (:186) and asserts `localTags` empty — pass |
| Scenario: drop-tags --all removes the configured trigger tag | MET | test | `apps/cli/tests/release-ops.test.ts:190-201` asserts `@demo/app-v0.3.0` removed locally and on origin after `drop-tags --all 0.3.0 --remote` (:199-200) — pass |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-16T00:07:54.657Z backlog → todo (system)
- 2026-09-16T00:07:54.857Z todo → wip (system)
- 2026-09-16T00:08:03.820Z wip → testing (system)
- 2026-09-16T00:21:39.068Z testing → done (system)

