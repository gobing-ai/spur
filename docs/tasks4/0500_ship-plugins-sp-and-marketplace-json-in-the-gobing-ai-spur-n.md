---
template: feature-impl
schema_version: 1
name: "Ship plugins/sp and marketplace.json in the @gobing-ai/spur npm tarball for superskill install"
description: ""
status: done
type: task
profile: standard
feature_id: H
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T16:46:26.837Z"
updated_at: "2026-08-10T18:56:06.193Z"
---

## 0500. Ship plugins/sp and marketplace.json in the @gobing-ai/spur npm tarball for superskill install

### Background
End users who install Spur from the registry (`bun install -g @gobing-ai/spur` /
`npm i -g @gobing-ai/spur`) get the CLI binary but **not** the `sp` plugin content.
Today the only supported install path for the plugin is a **repo checkout**:

```bash
# from a clone of this monorepo
superskill install sp --marketplace .claude-plugin
# or the maintainer convenience script
bun run refresh-plugin
```

That fails for real registry installs: the published package is `apps/cli`
(`@gobing-ai/spur`), and its `files` array is only:

```json
["spur.js", "config", "schemas", "web", "README.md"]
```

`plugins/sp` and `.claude-plugin/marketplace.json` live at the **monorepo root**. npm packs
only paths under the package directory, so adding bare `files` entries for them packs
**nothing** and fails silently (measured in superskill task 0113 / release notes). Staging is
wired to `prepublishOnly` (`bun run build:bundle`), which npm runs on `npm publish` only —
`npm pack` never stages, so pack-based verification can pass for the wrong reason (or pack
nothing). The CI publish helper `scripts/commands/publish.ts:88` separately spawns
`bun run build:bundle` before `npm publish`, so today's release path does stage; that only
hides the gap from `npm pack` and from a bare `npm publish`.

**Goal (mirror superskill 0113 T4 for this repo):** after `bun install -g @gobing-ai/spur`
(or `npm i -g @gobing-ai/spur`), an end user can install the bundled `sp` plugin to all
supported coding agents via:

```bash
superskill install sp --marketplace <spur-package-root>
```

where `<spur-package-root>` is the installed `@gobing-ai/spur` package directory (global
or local `node_modules`). The package root must be a valid Claude Code marketplace root
(`.claude-plugin/marketplace.json` + `source: ./plugins/sp` resolving under that root).
superskill accepts the package root directly: it probes `<root>/marketplace.json`, then
`<root>/.claude-plugin/marketplace.json` (`findMarketplaceManifest`,
`superskill/packages/core/src/marketplace.ts:62`).

**Proven pattern (superskill `@gobing-ai/superskill` 0.3.13, task 0113 T4 + re-audit):**

1. Build-time copy monorepo `plugins/` and `.claude-plugin/` into `apps/cli/`.
2. List the copy destinations in `files`.
3. Gitignore the copies (build artifacts — never hand-edit). Proven safe: npm reads ignore
   files inside the package directory only, and `apps/cli/` has no `.npmignore`, so the
   repo-root `.gitignore` never reaches the pack filter.
4. Stage on **`prepack`** (runs for both `npm pack` and `npm publish`), not only
   `prepublishOnly`.
5. Prune non-distribution content from the staged copy. **Adapt, do not copy, superskill's
   rule here** — its `find plugins -type d -name tests -prune` only removes `tests/`
   *directories*, which in this repo misses five `*.test.ts` files that live outside any
   `tests/` dir (four under `plugins/sp/hooks/`, one under `plugins/sp/evals/`). See R4.
6. Verify by **extracting the packed tarball** into a temp dir — never by inspecting the
   repo tree, never through a `bun link` symlink.

**Measured at HEAD (0.3.41):** `plugins/` 2.4M on disk; `plugins/sp/tests` 352K;
`plugins/sp/evals` 24K → ship surface ≈ 2.0M raw, well within npm limits.

**Out of scope for this task** (explicitly deferred):

- Remote marketplace locators / GitHub fetch for spur (superskill 0113 T2/T3) — already on
  the superskill side; spur only needs to *ship* the marketplace content.
- CLI self-location inside the `spur` binary for plugin install. superskill's
  `resolveInstalledPackageRoot` probes **superskill's own** installed package root (which
  ships plugin `cc`), not spur's — so a spur user must pass `--marketplace`, or register the
  path in `superskill.jsonc`. Optional DX follow-up: a documented `npm root -g` recipe or a
  `spur plugin-path` helper — not required to ship content.
- Shipping `magents/` (superskill-specific; spur has no `magents/` tree).
- Changing the `sp` plugin runtime contract, command surface, or version scheme.

**Authority already in place:**

- `scripts/commands/release.ts:139` `syncMarketplaceAndPlugins` already keeps
  `.claude-plugin/marketplace.json` and `plugins/sp/plugin.json` versions in lockstep with
  the CLI release ("the plugin ships alongside the CLI, not independently").
- Marketplace manifest: `name: "spur"`, plugin `name: "sp"`, `source: "./plugins/sp"`,
  version aligned with `apps/cli/package.json` (currently `0.3.41`).
### Requirements
- **R1 — Published tarball ships plugin + marketplace at package root.** The published
  `@gobing-ai/spur` package (from `apps/cli/`) includes both `plugins/sp/**` (plugin content)
  and `.claude-plugin/marketplace.json` (marketplace manifest with `source: ./plugins/sp`)
  at the **package root**, next to `spur.js` / `config` / etc. Marketplace-root invariant:
  `source: ./plugins/sp` and `dirname(manifest) → .claude-plugin → package root` both resolve
  so the extracted package root is a valid superskill/Claude Code marketplace. The staged
  `plugins/sp/` must retain at least one of `skills/ commands/ agents/ hooks/ hooks.json` —
  superskill rejects a plugin root without them
  (`superskill/packages/core/src/marketplace.ts:180`).
- **R2 — Staging is a build-time copy, not bare `files` paths.** Because `plugins/` and
  `.claude-plugin/` live at the monorepo root while the published package is `apps/cli/`,
  npm cannot pack them via bare `files` entries (silent empty pack — superskill 0113
  measured). Staging MUST copy `../../plugins` → `apps/cli/plugins` and
  `../../.claude-plugin` → `apps/cli/.claude-plugin` (mirroring existing
  `bundle-config` / `bundle-web` patterns). Copy destinations are gitignored build
  artifacts; never hand-edit `apps/cli/{plugins,.claude-plugin}`. The gitignore + `files`
  combination is proven, not assumed: superskill ignores `/apps/cli/plugins/` and
  `/apps/cli/.claude-plugin/` (`superskill/.gitignore:159-160`) while listing both in
  `files`, and `apps/cli/` carries no `.npmignore` — npm reads ignore files inside the
  package directory only, so the repo-root `.gitignore` never reaches the pack filter.
- **R3 — Staging runs on `prepack` (and remains correct for `npm publish`).** `npm pack`
  never runs `prepublishOnly`. Staging that lives only on `prepublishOnly` packs stale or
  absent copies (superskill 0113 re-audit defect). Move or dual-wire staging so **`prepack`**
  always produces a fresh tarball. Two facts constrain the wiring:
  - npm's publish order is `prepublishOnly` → `prepack` → `prepare` → `postpack` → publish.
    A `prepublishOnly` gate therefore runs **before** staging and must read repo-root
    sources, never the staged copies (this is exactly how superskill's
    `check-publish-manifest` behaves — see R6).
  - `scripts/commands/publish.ts:88` already spawns `bun run build:bundle` in the package
    dir before `npm publish`, so the CI publish path stages today; `prepack` is still
    required so `npm pack` and a bare `npm publish` stage too.
- **R4 — Prune non-distribution content from the staged plugin tree.** The staging filter
  MUST drop, from the staged copy only:
  - every `tests/` directory (`plugins/sp/tests/**`, ~352K);
  - every `*.test.ts` file **anywhere in the tree** — five live outside any `tests/` dir:
    `plugins/sp/hooks/{careful-guard,task-write-guard,context-hooks,token-estimate}.test.ts`
    and `plugins/sp/evals/judge.test.ts`. Superskill's
    `find plugins -type d -name tests -prune -exec rm -rf {} +` misses all five; do **not**
    copy that one-liner verbatim;
  - `plugins/sp/evals/` — monorepo-only (its sole consumer is the root `package.json`
    `eval` script, `bun run plugins/sp/evals/run-eval.ts`);
  - OS junk (`.DS_Store`), matching `bundle-config`'s existing `EXCLUDE` regex.
  Rationale beyond tarball weight: the root suite is
  `bun test --reporter=dots ./apps/cli ./apps/server ./apps/web ./packages ./plugins ./scripts`.
  `bun test` scans `./apps/cli` recursively and does **not** honor `.gitignore`, so any
  `*.test.ts` surviving into `apps/cli/plugins/` is discovered a second time from a second
  root — a gate defect that only appears after a build has run. Implement as a `cp` filter
  in the style of `scripts/commands/bundle-config.ts`, not as post-hoc `find … -exec rm`.
- **R5 — `files` array lists the staged destinations.** `apps/cli/package.json` `files`
  includes `"plugins/"` and `".claude-plugin/"` in addition to the existing entries
  (`spur.js`, `config`, `schemas`, `web`, `README.md`). Dot-directories **do** pack when
  listed (superskill ships `.claude-plugin/` this way today — no `.npmignore` workaround).
- **R6 — Version consistency on the published surface.** Packed
  `.claude-plugin/marketplace.json` plugin version and `plugins/sp/plugin.json` version
  MUST equal `apps/cli/package.json` `version` at pack time. Release already syncs these via
  `syncMarketplaceAndPlugins` (`scripts/commands/release.ts:139`) — this task must not break
  that path, and the pack/extract verification must assert version equality. Optional
  hardening (in-scope if cheap): a drift guard modelled on superskill
  `findMarketplaceVersionDrift` (`superskill/scripts/builder.ts:347`), wired into `apps/cli`
  `prepublishOnly`, reading the **repo-root** `.claude-plugin/marketplace.json` against
  `apps/cli/package.json` `version` (per R3, a `prepublishOnly` guard cannot see staged
  copies). Note the existing drift this would have caught: root `README.md:14` still
  advertises marketplace version `0.3.18` against package `0.3.41` — fix or drop that
  literal under R8.
- **R7 — End-user install path works from the extracted tarball.** From a **throwaway temp
  directory** that is not the monorepo and not the extract, with marketplace pointed at the
  extracted package root:
  `superskill install sp --marketplace <extracted-pkg-root> --dry-run --verbose`
  prints `Plugin root: <extracted-pkg-root>/plugins/sp` and exits 0, with no clone and no
  network. Four verified constraints on this command:
  - `--marketplace <package-root>` is correct — superskill probes `<root>/marketplace.json`
    then `<root>/.claude-plugin/marketplace.json`
    (`superskill/packages/core/src/marketplace.ts:62`, `findMarketplaceManifest`).
  - `--verbose` is **required**: `Plugin root: …` is emitted only under verbose
    (`superskill/apps/cli/src/commands/install.ts`, step 1). Without it the run proves
    nothing about resolution.
  - `--dry-run` is **not write-free**: `mapPluginToRulesync` writes `.rulesync/` into CWD
    before any `dryRun` gate. Run from a disposable temp CWD and delete it; never run this
    check from the monorepo root.
  - The negative control must use a name absent from **both** marketplaces. Resolution falls
    through to superskill's own installed package root
    (`resolveInstalledPackageRoot` → its bundled marketplace, which ships plugin `cc`), so
    `cc` is not a valid negative control; use something like `nope-not-a-plugin`.
  Prerequisite: `superskill` ≥ 0.3.13 on PATH (verified: 0.3.13 at `~/.bun/bin/superskill`).
  Record `superskill --version` in Testing. A live `bun install -g @gobing-ai/spur` smoke
  stays a post-release manual step, not a merge gate.
- **R8 — Docs same-commit with surface.** Update the surfaces that actually exist:
  - `apps/cli/README.md:19` (`bun install -g @gobing-ai/spur`) — add the plugin-install step.
    This is the primary end-user surface.
  - root `README.md` Install section, and the stale `README.md:14` marketplace version
    literal (`0.3.18` vs package `0.3.41`).
  - `docs/help/how_to_use_spur_for_daily_software_development.md` install section
    (~lines 39-71) — today it installs only the CLI. Note: contrary to the first draft, this
    file does **not** currently document
    `superskill install sp --marketplace .claude-plugin`; the only place that string appears
    is the root `package.json` `refresh-plugin` script (a maintainer repo-checkout
    convenience, left as-is) and `plugins/sp/README.md:354` (generic mention).
  - `docs/04_DESIGN.md` build/publish-surface tables (~lines 767 and 789) — enumerate
    `apps/cli/plugins/` and `apps/cli/.claude-plugin/` as `build:bundle` artifacts alongside
    `apps/cli/config/`. Same-commit with the surface change (constitution T3).
  - Optional: a short `docs/help/release.md` documenting the prepack staging contract and
    the extract-tarball recipe. Spur has no such file today — if added, register it in
    `docs/help/index.md`. Do not invent a second release process.
- **R9 — Gates stay green.** `bun run lint`, `bun run test`, `bun run build`, and
  `bun run spur-check-new` pass (`spur-check-new` is the gate that includes `corpus-check`;
  plain `spur-check` does not). At least one `bun run test` must run **after** a staging
  step, to prove `apps/cli/plugins/` contributes zero discovered tests (R4). No skipped
  tests to go green.
### Acceptance Criteria
```gherkin
Feature: Ship sp plugin + marketplace in the @gobing-ai/spur npm tarball

  Scenario: AC1 — files array declares the staged destinations
    Given apps/cli/package.json is the published package manifest
    When its "files" array is read
    Then it includes "plugins/" and ".claude-plugin/"
    And the existing entries (spur.js, config, schemas, web, README.md) remain

  Scenario: AC2 — prepack stages fresh, pruned monorepo copies into apps/cli
    Given a clean apps/cli tree with no staged plugins/ or .claude-plugin/
    When prepack (or the documented pack path) runs
    Then apps/cli/plugins/sp/plugin.json exists
    And apps/cli/plugins/sp contains at least one of skills/, commands/, agents/, hooks/, hooks.json
    And apps/cli/.claude-plugin/marketplace.json exists
    And no directory named tests exists anywhere under apps/cli/plugins
    And no file matching *.test.ts exists anywhere under apps/cli/plugins
    And apps/cli/plugins/sp/evals does not exist
    And apps/cli/plugins and apps/cli/.claude-plugin are gitignored (git status --porcelain lists neither)

  Scenario: AC3 — npm pack tarball contains plugin + marketplace (extract verification)
    Given prepack has staged the copies
    When npm pack runs in apps/cli and the resulting .tgz is extracted to a temp dir
    Then <extract>/package/plugins/sp/plugin.json exists
    And <extract>/package/.claude-plugin/marketplace.json exists
    And marketplace.json lists plugin name "sp" with source "./plugins/sp"
    And plugins/sp/plugin.json version equals apps/cli/package.json version
    And marketplace.json plugin version equals the same package version
    And no tests directory and no *.test.ts file exist anywhere under <extract>/package/plugins
    # Never certify by inspecting the monorepo tree or a bun-link symlink alone

  Scenario: AC4 — superskill install resolves sp from the extracted package root
    Given the AC3 extracted package root <pkg>
    And superskill >= 0.3.13 is on PATH
    And CWD is a disposable temp directory (not the monorepo, not <pkg>) — the run writes .rulesync/ there
    When superskill install sp --marketplace <pkg> --dry-run --verbose runs
    Then stdout contains "Plugin root: <pkg>/plugins/sp"
    And the command exits 0 with no network and no clone
    And a control run with plugin name "nope-not-a-plugin" exits non-zero
    # "cc" is NOT a valid control: superskill falls back to its own installed package
    # root, whose bundled marketplace ships plugin "cc" (resolveInstalledPackageRoot)

  Scenario: AC5 — release version sync path remains intact
    Given scripts/commands/release.ts syncMarketplaceAndPlugins
    When a release bump is dry-run or the unit coverage for it runs
    Then .claude-plugin/marketplace.json and plugins/sp/plugin.json stay version-locked to the CLI
    And the pack/extract assertion from AC3 would still pass after a bump

  Scenario: AC6 — docs describe the zero-clone install path
    Given the surface change is committed
    When apps/cli/README.md, root README.md, and the docs/help install guide are read
    Then they document: install @gobing-ai/spur via bun/npm, then
      superskill install sp --marketplace <spur-package-root>
    And they no longer imply a git clone is required to obtain the sp plugin
    And README.md no longer advertises a stale marketplace version literal
    And docs/04_DESIGN.md build/publish-surface tables list apps/cli/plugins/ and apps/cli/.claude-plugin/

  Scenario: AC7 — root test suite does not double-discover staged plugin tests
    Given the staging step has run and apps/cli/plugins exists
    When bun run test runs from the repo root
    Then the reported test-file count equals the pre-staging count
    And no test id resolves under apps/cli/plugins

  Scenario: AC8 — project gates green
    When bun run lint, bun run test, bun run build, and bun run spur-check-new run
    Then each exits 0
    And git status shows only intentional changes
```
### Q&A
**Closed decisions (for implementer — derived from superskill 0113 T4, verified against this
repo at 0.3.41 on 2026-08-10):**

- **Copy, don't re-root the package.** Keep publishing from `apps/cli/`. Do not move the
  published package to the monorepo root just to make `files` reach `plugins/`.
- **Stage on `prepack`.** Required so `npm pack` and `npm publish` both get fresh content.
  Fold the plugin copy into `build:bundle` and add `prepack: bun run build:bundle`. Keep
  `prepublishOnly` for a publish-only gate (R6) or drop it — it must not be the sole staging
  hook.
- **Staging lives in `scripts/commands/`, not an inline shell chain.** Matches
  `bundle-config` / `bundle-web`, and makes the R4 prune filter unit-testable (the root suite
  already globs `./scripts`).
- **Prune by content type, not by directory name.** `tests/` dirs **and** `*.test.ts` files
  anywhere **and** `evals/`. Superskill's `find -type d -name tests -prune` is insufficient
  here — five test files sit outside any `tests/` dir. Getting this wrong is not just tarball
  bloat: `bun test ./apps/cli` re-discovers them from the staged tree (AC7).
- **Ship whole `plugins/` tree (pruned), not only `plugins/sp` by name.** The marketplace
  `source` is `./plugins/sp`; shipping `plugins/` preserves that relative path and matches
  superskill. Additional plugin siblings later ship unless deliberately excluded.
- **Keep `plugins/sp/scripts/`.** Hooks dispatch via `superskill hook run sp <id>`, and
  superskill's mapper copies the scripts tree — pruning it would break installed hooks.
- **No `magents/`.** Spur has no magents authoring tree; do not invent one.
- **No spur-CLI self-location for plugin install this round.** superskill's
  `resolveInstalledPackageRoot` probes superskill's own package, not spur's, so
  `--marketplace` (or a `superskill.jsonc` `plugins[]` entry) is the user's handle. A later
  task may add `spur plugin-path` DX.
- **Verify with `--dry-run --verbose` from a throwaway CWD.** `Plugin root:` prints only
  under verbose, and `--dry-run` still writes `.rulesync/` into CWD (`mapPluginToRulesync`
  runs before any dryRun gate). Never run the check from the monorepo root.
- **Negative control must be a name in neither marketplace.** Not `cc` — superskill's own
  bundled marketplace ships it and would resolve.
- **Publish-surface content review before the first pack that includes plugins.**
  `plugins/sp` becomes published content for every registry user. Sweep for personal data,
  credentials, absolute local paths, and repo-foreign content (checklist step, human
  judgment — same class as superskill `docs/help/release.md` step 1).

**Deferred:**

- Auto-detecting the global `@gobing-ai/spur` install path inside `superskill install`
  without `--marketplace` (superskill-side feature, not spur packaging).
- Shipping plugin content via a separate npm package (rejected: release already treats
  plugin version as lockstep with the CLI).
- Reconciling `CLAUDE.md`'s verification-gate wording, which says `corpus-check` "runs inside
  `spur-check`" — it does not; only `spur-check-new` chains it. Out of scope here; noted so
  the implementer pins `spur-check-new` (R9) rather than trusting the doc.
### Design
**Approach.** Reuse the superskill 0113 T4 packaging pattern on spur's existing
`apps/cli` publish surface, with the prune rule adapted to this repo's test layout (R4).

**Surfaces to change**

| Surface | Change |
| --- | --- |
| `scripts/commands/stage-plugins.ts` (new) | `cp` with filter: repo-root `plugins/` → `apps/cli/plugins`, `.claude-plugin/` → `apps/cli/.claude-plugin`; prunes `tests/`, `*.test.ts`, `evals/`, `.DS_Store` |
| `scripts/spur-dev.ts` | Register `stage-plugins` in the dispatch switch + header usage block |
| `apps/cli/package.json` `files` | Add `"plugins/"`, `".claude-plugin/"` |
| `apps/cli/package.json` scripts | `build:bundle` gains `&& bun run ../../scripts/spur-dev.ts stage-plugins`; add `"prepack": "bun run build:bundle"` |
| `.gitignore` | `/apps/cli/plugins` and `/apps/cli/.claude-plugin` (alongside existing `/apps/cli/config`, `/apps/cli/web`) |
| `scripts/commands/stage-plugins.test.ts` (new) | Prune-filter unit coverage (root suite already globs `./scripts`) |
| Docs | Install (R8) + `docs/04_DESIGN.md` publish-surface tables + optional release checklist |
| Verification script | Pack → extract → assert paths/versions/no-tests; dry-run `superskill install` |

**Why a `scripts/commands/` module, not an inline shell chain.** `bundle-config` and
`bundle-web` already set this pattern, each with a `.test.ts` sibling picked up by the root
suite (`bun test … ./scripts`). The filter is the load-bearing part of R4 and must be unit
tested; superskill's inline `find … -exec rm` one-liner cannot be. Model the filter on
`scripts/commands/bundle-config.ts`'s `EXCLUDE` regex + `cp({ filter })`.

**Recommended script shape**

```text
scripts/commands/stage-plugins.ts:
  EXCLUDE = /(^|\/)(\.DS_Store|tests|evals)($|\/)|\.test\.ts$/
  rm -rf apps/cli/plugins apps/cli/.claude-plugin
  cp ../../plugins        -> apps/cli/plugins        (filter: !EXCLUDE)
  cp ../../.claude-plugin -> apps/cli/.claude-plugin

apps/cli/package.json:
  build:bundle:   bundle-web && bun build … spur.js && bundle-config config && stage-plugins
  prepack:        bun run build:bundle
  prepublishOnly: (optional) repo-root marketplace version drift guard — R6
```

**npm lifecycle order (drives R3/R6).** `npm publish` runs `prepublishOnly` → `prepack` →
`prepare` → `postpack` → publish. `npm pack` runs `prepack` → `postpack` only. A
`prepublishOnly` guard therefore executes *before* staging and must read repo-root sources
(superskill's `check-publish-manifest` does exactly this — `superskill/scripts/builder.ts:390`).

**Marketplace-root invariant**

```text
apps/cli/                          # package root after install
  spur.js
  config/
  .claude-plugin/
    marketplace.json               # source: "./plugins/sp"
  plugins/
    sp/
      plugin.json
      skills/ commands/ agents/ hooks/ scripts/
```

One root serves:

- `superskill install sp --marketplace <pkg-root>` (or `--marketplace <pkg-root>/.claude-plugin`)
- `claude plugin marketplace add <pkg-root>` (Claude Code layout)

**Hazard the prune rule protects against.** The root suite is
`bun test --reporter=dots ./apps/cli ./apps/server ./apps/web ./packages ./plugins ./scripts`.
`bun test` walks `./apps/cli` recursively and ignores `.gitignore`, so an unpruned
`*.test.ts` under `apps/cli/plugins/` gets discovered from a second root: duplicate runs,
double-counted coverage, and path-relative assertions evaluated from the wrong tree. The
symptom appears only after someone runs a build — i.e. it will not reproduce on a fresh
clone, which is what makes it worth an explicit AC (AC7).

**Size / content notes**

- `plugins/` 2.4M on disk; after pruning `tests/` (352K) and `evals/` (24K) ≈ 2.0M raw.
- `plugins/README.md` is fine to ship; not load-bearing for install.
- `plugins/sp/scripts/` **must** ship — hooks dispatch through `superskill hook run sp <id>`
  and superskill's mapper copies the scripts tree.

**Invariants preserved**

- Release version lockstep (`syncMarketplaceAndPlugins`) remains SSOT for versions.
- No change to plugin runtime layout under `plugins/sp/` in the monorepo.
- `vendors/` and other monorepo-only trees stay unpublished.
- Conventional commits; surgical change set.

**Risk**

| Risk | Mitigation |
| --- | --- |
| Silent empty pack if only `files` is updated | R2 + AC3 extract gate |
| Stale copies via `prepublishOnly`-only staging | R3 + `prepack` |
| Staged `*.test.ts` re-discovered by the root suite | R4 filter + AC2 + AC7 |
| Shipping tests / personal data | R4 prune + human publish-surface review (T5) |
| Version drift between CLI and marketplace | R6 + release sync path + pack assert |
| `superskill install --dry-run` littering `.rulesync/` in the repo | R7: run only from a disposable temp CWD |
### Plan
- [ ] **T1 — Staging module.** Add `scripts/commands/stage-plugins.ts` (`cp` + prune filter
  per R4) plus `scripts/commands/stage-plugins.test.ts` covering the filter; register the
  command in `scripts/spur-dev.ts` dispatch and its header usage block.
- [ ] **T2 — Wire into the publish path and declare it.** Append `stage-plugins` to `apps/cli`
  `build:bundle`; add `"prepack": "bun run build:bundle"` (R3); add `"plugins/"` and
  `".claude-plugin/"` to `files` (R5); add `/apps/cli/plugins` and `/apps/cli/.claude-plugin`
  to `.gitignore`. If cheap, also wire the repo-root marketplace version-drift guard into
  `prepublishOnly` (R6).
- [ ] **T3 — Pack/extract verification.** Run the pack path from `apps/cli`, extract the
  `.tgz` to a temp dir, assert AC3 paths, version equality, zero `tests/` dirs and zero
  `*.test.ts` files. Land it as a script or test so it does not stay manual-only.
- [ ] **T4 — Install dry-run from extract.** From a disposable temp CWD run
  `superskill install sp --marketplace <extract> --dry-run --verbose`; assert the
  `Plugin root:` line and exit 0, plus a `nope-not-a-plugin` control exiting non-zero (AC4).
  Record the exact commands, `superskill --version`, and output in Testing; delete the temp
  CWD (it will contain a `.rulesync/`).
- [ ] **T5 — Publish-surface content review.** Human sweep of what will ship under
  `plugins/sp` (personal data, credentials, absolute local paths, repo-foreign content).
  Fix or deliberately keep; note the outcome in Solution.
- [ ] **T6 — Docs.** Update `apps/cli/README.md`, root `README.md` (including the stale
  `0.3.18` marketplace literal at line 14), the `docs/help` install guide, and the
  `docs/04_DESIGN.md` publish-surface tables (R8/AC6); optionally add `docs/help/release.md`
  and register it in `docs/help/index.md`.
- [ ] **T7 — Gates.** `bun run lint`, `bun run test`, `bun run build`, `bun run spur-check-new`
  green (R9/AC8); run `bun run test` once **after** staging and confirm the test-file count is
  unchanged versus the pre-staging run (AC7); intentional `git status` only.
### Solution
**Change map (all edits, this task's diff):**

| File:line | Change | Req/AC |
| --- | --- | --- |
| `scripts/commands/stage-plugins.ts` (new) | Copy repo-root `plugins/` → `apps/cli/plugins`, `.claude-plugin/` → `apps/cli/.claude-plugin` with EXCLUDE prune (`tests/`, `*.test.ts`, `evals/`, `.DS_Store`) | R2/R4 |
| `scripts/commands/stage-plugins.test.ts` (new) | Prune-filter + staged-tree assertions (7 tests) | R4/AC2 |
| `scripts/commands/check-marketplace-version.ts` (new) | Pre-publish version-drift guard (`findMarketplaceVersionDriftFrom` pure fn + file reader) | R6 |
| `scripts/commands/verify-pack.ts` (new) | Extract tarball → assert AC3 (paths, versions, no tests/evals) | R1/AC3 |
| `scripts/commands/verify-pack.test.ts` (new) | Drift-guard + verifyPackExtract unit coverage | R6/AC3 |
| `scripts/tsconfig.json` (new) | Give `scripts/` LSP type resolution (extends base, `types: ["bun"]`); not referenced by any workspace gate | tooling hygiene |
| `scripts/spur-dev.ts` | Register `stage-plugins`, `check-marketplace-version`, `verify-pack` (imports + header + dispatch) | T1/T3 |
| `apps/cli/package.json` | `files` += `plugins/`, `.claude-plugin/`; `build:bundle` += `&& … stage-plugins`; add `prepack: build:bundle`; `prepublishOnly` = drift guard | R3/R5/R6 |
| `.gitignore` | Add `/apps/cli/plugins`, `/apps/cli/.claude-plugin` | R2 |
| `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:81` | `/Users/robin/node_modules/` → `$HOME/node_modules/` (T5 privacy sweep) | T5 |
| `apps/cli/README.md` | Add "Install the `sp` plugin" subsection (superskill install) | R8/AC6 |
| `README.md:14` | Stale `0.3.18` → `0.3.41` marketplace literal; add plugin-install step | R8/AC6 |
| `docs/help/how_to_use_spur_for_daily_software_development.md` | Add plugin-install step after npm bundle | R8/AC6 |
| `docs/04_DESIGN.md` | `build:bundle` row + Monorepo path table enumerate `apps/cli/plugins/`, `apps/cli/.claude-plugin/` (`stage-plugins`) | R8/AC6 |

**Key decisions:**

- **`prepublishOnly` = pure drift guard; `prepack` = build:bundle (staging).** npm runs
  `prepublishOnly` before `prepack`, so the guard reads repo-root sources (never the staged copies),
  matching superskill's split. `prepack` guarantees both `npm pack` and `npm publish` stage fresh.
- **Prune by content type, not directory name.** Superskill's `find -type d -name tests -prune`
  misses five `*.test.ts` files outside `tests/` dirs (4 in `hooks/`, 1 in `evals/`). EXCLUDE regex
  `/(^|\/)(\.DS_Store|tests|evals)($|\/)|\.test\.ts$/` handles all.
- **`scripts/tsconfig.json`** resolves the LSP scope artifact where `scripts/` (not in any workspace
  tsconfig) failed to resolve `node:*`/`process`/`Bun` types — the same false positives present on
  every committed `scripts/` file. It is not referenced by any workspace `tsc`, so `bun run
  typecheck` behavior is unchanged.
- **T5 content review:** no secrets/credentials/.env in the staged `plugins/`; one absolute local
  path (`/Users/robin/...`) in a repro-log doc generalized to `$HOME` — deliberately kept otherwise
  (the doc explains a real `spur agent run` sandbox failure mode and is load-bearing evidence).

**Not modified (authority):** `plugin.json`, `.claude-plugin/marketplace.json`, workflow YAMLs.
Release version lockstep (`syncMarketplaceAndPlugins`) unchanged.
### Testing
**Verdict: PASS** (re-audit `--force --fix all`, 2026-08-10 — task was `done`, committed `0dc2edd5`)

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | fresh `build:bundle` + `npm pack` → `gobing-ai-spur-0.3.41.tgz` (2.75MB); `verify-pack` OK — `plugins/sp/plugin.json` + `.claude-plugin/marketplace.json` at package root |
| R2 | MET | `stage-plugins.ts` copies `../../plugins` + `../../.claude-plugin` → `apps/cli/`; `git status --porcelain` shows neither (gitignored), re-verified this run |
| R3 | MET | `prepack: bun run build:bundle` runs on pack (observed in this run's pack); `prepublishOnly` = drift guard on repo-root sources |
| R4 | MET | staged tree this run: 0 `*.test.ts`, 0 `tests/` dirs under `apps/cli/plugins`; `stage-plugins.test.ts` 3 tests pass |
| R5 | MET | `files` = spur.js, config, schemas, web, README.md, plugins/, .claude-plugin/ (printed this run) |
| R6 | MET | `check-marketplace-version` → "versions match package version" (0.3.41 across pkg/plugin/marketplace), this run |
| R7 | MET | `superskill 0.3.13 install sp --marketplace /tmp/v0500-extract/package --dry-run --verbose` → `Plugin root: /tmp/v0500-extract/package/plugins/sp`, exit 0; control `nope-not-a-plugin` exit 1; temp CWD deleted |
| R8 | MET | `superskill install sp --marketplace` present in README.md, apps/cli/README.md, help doc (1 each); zero `0.3.18` literals; 04_DESIGN tables reference stage-plugins ×2 |
| R9 | MET | `spur-check-new` exit 0 this run (lint + test 4806 pass/0 fail + rules + corpus-check); `bun run build` exit 0; 7 new unit tests pass |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 files array | MET | command | `python3` print of `files` array (above R5) |
| AC2 prepack stages pruned | MET | command | fresh stage: plugin.json + marketplace.json exist; 0 tests/evals/*.test.ts; gitignored |
| AC3 pack/extract | MET | command | fresh `npm pack` + `verify-pack` OK (versions 0.3.41, source ./plugins/sp, no test content) |
| AC4 superskill install | MET | command | pos exit 0 with `Plugin root:` line; neg exit 1 (`Available: sp`) — /tmp/v0500-pos.log, /tmp/v0500-neg.log |
| AC5 release sync intact | MET | static | `syncMarketplaceAndPlugins` untouched; drift guard green at current lockstep |
| AC6 docs zero-clone | MET | command | grep counts above (R8) |
| AC7 no double-discovery | MET | command | root test log has zero `apps/cli/plugins` matches; staged test-file count = 0; 4806 tests / 267 files / 0 fail |
| AC8 gates green | MET | command | spur-check-new exit 0, build exit 0, this run |

**SECUA Review (re-audit)**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings. Prior P3 (`/Users/robin` abs path) fixed in 0dc2edd5 — confirmed `$HOME` in staged tree. |

**Design-conformance:** 15 files in `0dc2edd5` match the Design surface list; one addition (`scripts/tsconfig.json`, documented in Solution §tooling hygiene). No scope creep — foreign WIP (plugins/sp/README.md, .spur/config.yaml, docs/tasks4/0501) not in the diff.

**Fix-pass:** `--fix all` — no UNMET/PARTIAL rows, no findings; nothing to repair.

**--next:** no-op — task already terminal (done).
Coverage: N/A (docs/packaging); new scripts covered by 7 unit tests. Re-audit verdict artifact updated: `.spur/run/0500-verdict.json`.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Security | `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:81` | Absolute local path `/Users/robin/node_modules/` shipped in the published artifact → generalized to `$HOME` (privacy). Fixed in this task. |
| P4 | Architecture | `scripts/tsconfig.json` | New standalone tsconfig resolves the pre-existing LSP scope artifact on all `scripts/` files; not referenced by any workspace `tsc`, so gate behavior unchanged. Low risk. |
| P4 | — | — | No P1–P2 findings. All AC/R requirements MET with command evidence this run; gates green (lint/test/build/spur-check-new exit 0). |

Residual risk: the packed tarball's plugin content was reviewed once (T5) — a pre-release human re-sweep is recommended before the first public publish that includes plugin content (documented in the task Q&A publish-surface review step). This is a release-checklist item, not a code defect.
### References
- **Prior art (superskill @ 0.3.13 — do not re-spike):**
  - Task: `/Users/robin/xprojects/superskill/docs/tasks/0113_extend-marketplace-to-local-claude-plugin-github-locators-an.md`
    — especially **R5 / T4 / AC3 / AC4** and the re-audit that moved staging to **`prepack`**.
  - Package surface: `/Users/robin/xprojects/superskill/apps/cli/package.json`
    (`files`, `build:bundle`, `prepack`, `prepublishOnly`).
  - Gitignore proof: `/Users/robin/xprojects/superskill/.gitignore:158-161`
    (`/apps/cli/plugins/`, `/apps/cli/.claude-plugin/` ignored yet packed).
  - Drift guard: `/Users/robin/xprojects/superskill/scripts/builder.ts:347`
    (`findMarketplaceVersionDrift`) and `:390` (`check-publish-manifest`).
  - Release checklist: `/Users/robin/xprojects/superskill/docs/help/release.md`.
- **superskill resolution contract (read before writing AC4's command):**
  - `/Users/robin/xprojects/superskill/packages/core/src/marketplace.ts:62`
    `findMarketplaceManifest` — probes `<X>/marketplace.json` then
    `<X>/.claude-plugin/marketplace.json`, so a package root is a valid `--marketplace`.
  - `.../marketplace.ts:180` — plugin root must contain one of
    `skills/ commands/ agents/ hooks/ hooks.json`.
  - `/Users/robin/xprojects/superskill/apps/cli/src/commands/install.ts` —
    `registerInstall` flags (`--marketplace`, `--dry-run`, `--verbose`, `--targets`),
    `executeInstall` step 1 (verbose-only `Plugin root:` echo) and step 2
    (`mapPluginToRulesync` writes `.rulesync/` regardless of `--dry-run`),
    `resolvePluginRoot` fall-through order incl. `resolveInstalledPackageRoot`.
- **This repo — publish surface today:**
  - `apps/cli/package.json` — `files`, `build:bundle`, `prepublishOnly` (no `prepack`).
  - `scripts/commands/publish.ts:88` — CI publish helper; already runs `build:bundle`
    before `npm publish`.
  - `scripts/commands/release.ts:139` — `syncMarketplaceAndPlugins` (version lockstep).
  - `scripts/commands/bundle-config.ts` / `bundle-web.ts` — the monorepo→package copy
    pattern to mirror (`cp` + `EXCLUDE` filter, with `.test.ts` siblings).
  - `scripts/spur-dev.ts` — command dispatch to register `stage-plugins` in.
  - `.claude-plugin/marketplace.json` — marketplace `spur`, plugin `sp`,
    `source: ./plugins/sp`, version `0.3.41`.
  - `plugins/sp/plugin.json` — plugin manifest, version `0.3.41`.
  - `biome.json` — `vcs.useIgnoreFile: true`, so gitignoring the staged copies also keeps
    them out of `bun run lint` (this is why lint needs no extra ignore entry).
  - Root `package.json` — `test` glob (`./apps/cli … ./plugins ./scripts`), `eval`
    (`plugins/sp/evals/run-eval.ts`, the only consumer of `evals/`), `refresh-plugin`
    (repo-checkout install path), `spur-check` vs `spur-check-new`.
- **Docs to update (R8):** `apps/cli/README.md:19`, `README.md` Install section and line 14,
  `docs/help/how_to_use_spur_for_daily_software_development.md` (~39-71),
  `docs/04_DESIGN.md` (~767, ~789), optional new `docs/help/release.md` +
  `docs/help/index.md` entry.
- **User-facing goal:** `bun install -g @gobing-ai/spur` (or npm equivalent) then
  `superskill install sp --marketplace <spur-package-root>` installs the `sp` plugin to all
  supported coding agents without cloning this monorepo.
### History
- 2026-08-10T17:19:19.516Z backlog → todo (system)
- 2026-08-10T18:46:52.786Z todo → wip (system)
- 2026-08-10T18:46:53.118Z wip → testing (system)
- 2026-08-10T18:47:15.096Z testing → done (system)
