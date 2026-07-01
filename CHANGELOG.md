# Changelog

## [0.2.11] — 2026-07-01

### Added

- **Parallel execution mode for batch task runs.** `sp:super-coder` gains an optional
  parallel fan-out — default sequential, enters parallel only on explicit request when
  the fan-out checks (dependency, file-overlap, token-budget) pass. `/sp-dev-runall`
  accepts `--mode <sequential|parallel>`. Two new invariants guard the seam: R28
  (workflow schema ref + HITL pause) and R29 (parallel batch contract consistency).
- **Four new dev skills: debug, review, branch, parallel.** `sp:sys-debugging`
  (5-phase debugging protocol), `sp:code-review` (pre-commit self-review + SECUA agent
  review), `sp:branch-workflow` (branch lifecycle, worktrees, merge prep), and
  `sp:parallel-execution` (fan-out patterns, result synthesis) ship as backing skills.
  The thin `dev-branch` / `dev-debug` / `dev-review-req` command wrappers were added
  and dropped within this cycle — invoke the skills directly.
- **`/sp-dev-parallel` command** wrapping the parallel-execution skill with
  `$ARGUMENTS` passthrough.
- **Task-type-aware pipeline dispatch in `/sp-dev-run`**, routing by task type.
- **L4 advisory suffix in `/sp-dev-refine` SKIP verdicts**, surfacing the next-level
  check when a section is skipped.
- **`feature_id` advisory on `spur task done`.** When a task reaches `done` without a
  `feature_id`, prints a human-only nudge (skipped under `--json`) linking the task to
  its feature for traceability.

### Changed

- **Config loading cached; schema refs resolve from disk.** `loader.ts` adds
  `spurConfigCache`, `planningFoldersCache` (WeakMap on `FileSystem`), and `cacheKey()`
  so repeated `loadSpurConfig` / `resolvePlanningFolders` calls skip re-reads; failed
  loads evict from cache. `resolveSchemaSpecifier()` resolves
  `@gobing-ai/spur/package.json` to the workspace manifest on disk in dev, fixing JSON
  Schema validation in the monorepo. `task.ts` adds `sectionMatrixCache` for
  `loadSectionMatrix`. Three loader tests cover schema-ref resolution, global fallback
  parity, and planning-folders caching.
- **`task-pipeline.yaml` enables `pause: true` on the `approve` state (E3 HITL)**,
  removing the stale deferred comment about the global schema. `basic.yaml` adds a
  `$schema` ref.
- **Skill polish across the sp plugin.** `code-verification` gains section-write
  guidance for the Testing field; `secu-review` gains a pre-completion checklist;
  `spur-dev/dev-operations` codifies the L4 advisory in the SKIP contract;
  `spur-dev/execution-batch` documents the parallel execution path;
  `code-implementation/implementation-patterns` adds context-reuse guidance;
  `spur-cli` and `sys-architecture` fix unquoted YAML descriptions. R24–R27
  invariants cover description quoting and cross-ref integrity.

### Fixed

- **Planning-core YAML scalars and table-format file:line citations.**
  `markdown-document.ts` adds `normalizeYamlScalars()` (Date→ISO) and `yamlSafeValue()`
  to quote-unsafe scalars on write. `task-check.ts` adds `hasAdjacentFileLineColumns()`
  so L3 accepts markdown table rows with `file:line` in adjacent columns (P3 from task
  0166). Three regression tests cover the table-format detection.

### Misc

- New models added to `.spur/config.yaml`.
- `.tmp-*` directories ignored.
- Tracking docs updated for the 0161–0166 task cycle.

## [0.2.10] — 2026-06-30

### Added

- **Functional skill split — competency skills + thin spine (ADR-028).** The monolithic `sp:spur-dev`
  skill is decomposed into a thin orchestration spine that dispatches five deep competency skills:
  `sp:code-implementation` (task-driven implementation, root-cause debugging, Solution change-maps),
  `sp:code-testing` (coverage measurement, gap analysis, per-stack adapters for Bun/TS, Go, Python),
  `sp:code-verification` (requirements-traceability verdict + SECUA review),
  `sp:sys-architecture` (ADR judgment, module boundaries, build-vs-extend decisions), and
  `sp:spec-decomposition` (feature→task-batch decomposition). The four `spur-<noun>` skills
  consolidate into a single `sp:spur-cli` CLI facade with per-noun references. Five noun-experts
  retire in favor of `sp:expert-spur`. The `sp:super-coder` agent broadens to drive single-task
  end-to-end pipelines in addition to batches.
- **Verify acceptance criteria guard with typed evidence ladder.** The `sp:dev-verify` command now
  automatically evaluates acceptance criteria when present, with typed evidence
  (`test`/`command`/`static-ref`/`manual-review`/`llm-judge`/`n/a`) so weak proof is visible.
  Objective AC cannot be certified by `llm-judge` alone. AC statuses and blocker/major findings
  fold into the aggregate PASS/PARTIAL/FAIL verdict. The verdict schema contract now carries an
  `acceptanceCriteria` array.
- **Dogfood Monitor Ledger with deterministic cache methodology.** Every dogfood report now requires
  a mandatory `### 3. Monitor Ledger` table as the audit trail, with a deterministic `cache%` formula
  computed from per-row Fresh/Cached Token sums and a mandatory Basis column. An anti-fiction rule
  prevents invented cache percentages.
- **Plugin structural invariants locked in test suite.** Seven new invariant tests (R13, R16a–d,
  R20–R23) guard the functional skill split: cross-cutting.md single-SSOT, disjoint trigger surfaces
  across skills, no dangling cross-skill references, no retired entity names, no vendors/rd3
  references in shipped plugin files, mandatory AC guard semantics in verify path, mandatory monitor
  ledger in dogfood path, and no unscoped ignore rules that hide plugin entrypoints.

### Changed

- **Full lifecycle scaffold in task templates.** All six task templates (`standard`, `feature-impl`,
  `issue`, `review`, `meta`, `brainstorm`) now carry the complete lifecycle section scaffold with
  guidance comments. The section matrix replaces forbidden section lists with broadly-permissive
  optional lists so templates can pre-include all sections without check failures.
- **Task template tightening.** The `feature-impl` template auto-populates `{{ FEATURE_ID }}` in the
  References section when created with `--feature`. The `review` template drops a redundant
  `template: review` frontmatter line (the creation path always sets it).
- **`sp:spur-plan` skill stub removed.** The thin placeholder carried no active consumers — its
  planning narrative has always lived in `sp:spur-dev`. References in `sp:spur-dev` and `spur-init`
  updated accordingly.
- **`plugins/README.md` regenerated** from the live `plugins/sp/` file tree with accurate skill
  versions, expanded reference-file directory layout, corrected relationship diagram, and updated
  migration scorecard.
- **Scaffold paths migrated** from `.spur/config/` nested layout to `.spur/` flat paths
  (workflows → `.spur/workflows/`, templates → `.spur/templates/`).

### Fixed

- **Vendors protection.** The `protected-files.yaml` no-modification rule now excludes `vendors/`.
- **Spur-cli gitignore scoped to repo root.** The `spur-cli` ignore patterns are now anchored so
  they don't hide plugin skill entrypoints in nested paths.
- **Missing review checklist item.** The review template Plan checklist now includes "Fix all the
  remaining findings if any."
- **Hook error handling.** The task-write-guard hook error path is hardened.
- **Daily-summary and task-write-guard tests** use spy-based stubs instead of PATH-shim mutations
  for improved portability.

## [0.2.9] — 2026-06-29

### Added

- **Board module auto-discovery (web).** Board-registry modules are now discovered automatically at
  build time and wired to the runtime registry; bare `/board` redirects to the default module.
- **Batch task execution — `/sp:dev-runall` + `sp:super-coder`.** Run a set of tasks through their
  pipelines in dependency-correct order, with a batch report emitted at the end.
- **`spur workflow cancel <run-id>`.** Cancel a running workflow with pid-tracked subprocess kill.
- **SECUA framework for `sp:dev-review` / `sp:dev-verify`.** The review and verify commands are
  extended to the SECUA review framework.
- **`sp:dev-gitmsg` per-file summarization.** Commit-message generation now groups changes by
  concern and summarizes per file.
- **Actionable `feature_id` warning in `spur task check`**, plus a done-gate regression test.
- **`sp:super-coder` Definition of Done contract** — DoD housekeeping, dogfood persistence, and
  point-of-action enforcement via a terminal gate.

### Changed

- **Portable task-write-guard hook.** The `sp` task-write-guard hook is now portable across installs.

### Fixed

- **Task status normalization before lifecycle transitions.** Opaque `FSMError` on case-drift is
  resolved; task/feature status is normalized at the planning-write boundary.
- **L3 review/plan checks hardened.** The L3 Review rule now handles prose-only and empty-cell
  scaffolds; the L3 Plan check scans all lines with a refine pre-synthesis skip gate.
- **Refine skip-gate scoped to target sections**, with updated Review guidance.
- **Lifecycle gate backstop inlined** and `implement` `onEnter` reordered; project-local workflow
  fallback with a non-strict done-gate.
- **Workflow definitions realigned** with the SECUA rename and the batch delegation contract.
- **GitHub Actions workflows fixed.**
- **Hook error handling fixed.**
- **`sp:dev-dogfood` `--max-retry` default** corrected.

## [0.2.6] — 2026-06-26

A release focused on three surfaces: the **Spur Board web app** (Tasks as the default
module and a documented module-hub pattern), the **`sp` dev-workflow plugin** (the
`--next` step-chain, `--agent` overrides, and feature-level orchestration), and the
**planning layer** (verdict/record/roster verbs and stricter gates).

### New Features

- **Spur Board: Tasks is the default module.** The placeholder landing module is gone;
  opening the board lands on the Tasks kanban. A new *How to Add a UI Plugin to the Spur
  Board* guide documents the module-hub pattern — adding a self-contained React view takes
  one directory and one registry line, with no routing or sidebar wiring.
- **Task Kanban board.** Tasks render as a status-grouped kanban with the active folder
  selectable (not positional), plus a resizable right-dock task-detail panel, a New Task
  slide-out, and inline task-body editing with Save/Cancel.
- **Contextual workflow actions in TaskDetail.** Action buttons and a cancel-confirm modal
  surface human-in-the-loop transitions directly from the board, backed by a new
  `POST /tasks/{wbs}/actions` write API.
- **`sp` dev-workflow `--next` step-chain.** `dev-refine` → `dev-run` → `dev-verify` now
  chain via `--next`, honoring the task-lifecycle FSM (no `--no-lifecycle` in interactive
  chains) and stopping review-pending on guard failure. `dev-run --next` implies
  `--mode implement` instead of erroring on full mode.
- **`--agent` override across dev-* commands.** Dev commands accept an explicit agent, and
  `--agent` auto-resolution is now phase-aware (executor profiles). `spur agent doctor`
  reports readiness with an aligned table, status glyph, and tri-state auth column.
- **Feature-level orchestration.** The dev workflow can plan and run at the feature scope,
  not just the task scope. `sp:spur-plan` and a design-doc generation mode feed planning.
- **New dev skills & commands:** `dev-brainstorm` (grilling discovery with `--task`),
  `/sp:dev-dogfood` (`--full` all-severity reporting), `sp:spur-tdd`, and
  `sp:dev-gitmsg --commit`.

### Improvements

- **Workflow engine flags.** `--async`, `--force`, and `--no-lifecycle` on `spur workflow
  run`; run-start plan preview and live EventBus step progress; `AbortSignal` propagated
  through the agent subprocess chain; `spur workflow clean` finalizes orphaned runs.
- **Centralized config loading (ADR-027).** `.spur/config.yaml` loading is centralized in
  `spur-config`; the legacy `.spur/config.json` references are retired.
- **UI boundary rules promoted to error.** `ui-import-seam-only` and
  `no-daisyui-class-leak` are now `error` and run in the standing pre-check — daisyUI is
  fully routed behind a typed `ui.ts` seam.
- **Section-write guards & done-gate.** The workflow enforces the section matrix at done,
  owns per-status sections, and guards phantom writes; `MarkdownDocument` deduplicates
  sections at parse time.

### Bug Fixes

- **`spur task check` strictness.** `--strict-core` gate on `task check`; section-write
  guard scoped to the exact corpus path via `resolve --strict`; parent-child roll-up gate
  in `task check`; `Review` section accepted at `testing` status.
- **Dead `--agent` surface removed.** The `current`/`$SPUR_AGENT` `--agent` paths and
  stale dogfood agent docs are removed.
- **Pipeline regression closed.** The rd3→sp dev verify-skill + completion-gate regression
  (0105) is resolved.

### Internal

- Server-side implementation on Hono/oRPC across server and web (EventBus, JobQueue,
  Scheduler, ServerModule registry, health endpoints).
- Task-planning migration from `rd3` into the Spur planning layer (ADR-020–023).
- Test coverage lifted above the 90% line/function threshold across CLI, server, and
  domain; `plugins/sp` tests included in the verification gate.

## [Unreleased]

### Added

- **Web design system + theming + responsive (W4/0085)** — design tokens via Tailwind `@theme` (Spur identity palette, semantic colors, typography), dark mode toggle with daisyUI theme switching, localStorage persistence, and `prefers-color-scheme` first-load respect. Mobile responsive: left sidebar → slide-in drawer, right panel → bottom sheet on viewports <768px. FOUC-prevention inline script in `index.astro`.


- **HITL workflow actions and responders** — three human-in-the-loop action runners (`hitl.confirm`, `hitl.select`, `hitl.input`) plus CLI (`ClackHitlResponder`) and non-interactive (`DefaultHitlResponder`) responders. Answers flow back via engine `setVars` so guards can branch on user input. Responder selected per `isatty(1)`: interactive `@clack/prompts` when attached to a terminal, configured defaults in CI/headless. Wired through `SpurWorkflowBuiltinsOptions`, `WorkflowAppServiceContext`, and `CliContext` with the same injection pattern as `agent.run`/`rule.check`. Engine catalog bumped to `^0.3.10` for `HitlResponder` contract.

### Removed

- **`@gobing-ai/spur-plugin-sdk` package removed.** The plugin substrate moved upstream to a bare `PluginHost` + `Plugin` lifecycle core in `@gobing-ai/ts-infra`, consumed via `runApplication` (ADR-012 amendment). `packages/plugin-sdk` is deleted; the server's unused plugin-route plumbing is removed. The previously published `@gobing-ai/spur-plugin-sdk@0.1.8` remains on npm but receives no further releases. The release script and Publish workflow no longer build or publish it.
- **`spur plugin` placeholder command removed.** Plugin discovery is deferred after the ADR-012 amendment, so the always-empty `plugin list|info` CLI surface is removed until a real plugin consumer exists.

## [0.1.9] — 2026-06-08

### Changed

- **`@gobing-ai/ts-infra` bump to `^0.3.5`** — adds `runApplication` / `runNodeApplication` bootstrap orchestrator subpaths.
- **CLI bootstrap standardized on `runNodeApplication`** (ADR-017) — `spur-cli`'s `main()` now delegates to `ts-infra`'s `runNodeApplication`, providing deterministic logger/telemetry/events/DB lifecycle. `spur-server` can reuse the identical wiring.
- **Single config surface** — `.spur/config.yaml` is now the sole config file. The legacy `.spur/config.json` project marker is retired. Resolution: project `.spur/config.yaml` → fallback `~/.config/spur/config.yaml`. `spur init` writes a minimal `.spur/config.yaml` with a `bootstrap:` block consumed by `ts-infra` and a Spur app section validated by `spurAppConfigSchema`.
- **DB created eagerly** — injected via `runNodeApplication` `services.db`, replacing lazy creation in `createCliContext`.

# Changelog

## [0.1.1] — 2026-06-06

Spur v0.1.1 is the first published release after the re-foundation onto the `spur-new` monorepo.
It bundles the full CLI surface, the plugin SDK, and the application services layer behind
`@gobing-ai/spur-cli` and `@gobing-ai/spur-plugin-sdk`.

### New Features

- **Plugin system** — `@gobing-ai/spur-plugin-sdk` ships with typed capability registries
  (command, rule, skill, harness, provider, event, UI, worker, API), trust-level sandboxing
  (curated / untrusted tiers), and a `PluginLoader` that discovers plugins from bundled,
  user-global (`~/.spur/plugins/`), and project-local (`.spur/plugins/`) roots. Plugin API
  routes mount into the server via Hono with OpenAPI schema generation.
- **`spur plugin` commands** — `list`, `info`, `enable`, `disable` subcommands for managing
  installed plugins from the CLI.
- **`spur rule run --stop-on-first`** — new flag stops rule evaluation at the first failure
  (or at a configurable severity threshold), giving fast-fail workflows without running the
  full ruleset.
- **Disabled rules in verbose output** — `spur rule run --verbose` now shows rules skipped
  by the preset filter with a `⊘` marker, so you can see _what_ was excluded.
- **Portable spur rules** — `recommended` and `strict-check` preset rulesets absorbed from
  `@gobing-ai/ts-rule-engine` into the Spur repo as the single source of truth. New rules
  cover DAO boundaries, runtime boundaries, HTTP boundaries, file protection, test location
  enforcement, CLI surface consistency, Bun tooling constraints, and Biome suppression bans.
- **Team-mode agent specs** — `spur agent create|edit|delete` manage agent YAML specs under
  `.spur/agents/`. `spur agent list --specs` enumerates them. Supports identity preamble
  injection (`--purpose`, `--tags`, `--system-prompt`, `--task`) and message draining
  (`--drain`).
- **Inter-agent messaging** — `spur message send|inbox|reply` backed by a durable SQLite
  inbox, enabling asynchronous coordination between team agents.

### Improvements

- **Application services layer** (`packages/app`) — `AgentService`, `RuleService`,
  `WorkflowService`, `HistoryService`, `TeamService`, and `PluginService` extracted into a
  shared `@gobing-ai/spur-app` workspace, decoupling domain logic from CLI I/O.
- **Domain persistence** (`packages/domain`) — analytics, DAOs, migrations, and schema
  extracted into `@gobing-ai/spur-domain` with full test coverage on in-memory SQLite.
- **Rule and workflow engines are now plugins** — both `ts-rule-engine` and
  `ts-dual-workflow-engine` register through the plugin SDK's harness and rule registries,
  making them replaceable without changing CLI code.
- **Canonical documentation** — `docs/00_ADR.md` through `docs/05_FEATURES.md` rewritten
  with single-source-of-truth discipline, an explicit conflict-resolution order, and the
  CLI grammar contract (`spur <noun> [<verb>] [positionals] [--flags]`).
- **CI gate** — GitHub Actions `ci.yml` enforces `bun run check` (Biome lint + `tsc --noEmit`
  across 8 workspaces + 542 tests) on every push and PR.
- **Trusted Publishing ready** — `publish.yml` supports OIDC-based npm publishing via
  `id-token: write`, with tag-triggered (`@gobing-ai/spur-cli-v*`) and manual dispatch
  paths.

### Bug Fixes

- **Migration gaps** — CLI surface commands (`agent team`, `message`, `plugin`, stubs) now
  properly registered in the Commander program, fixing `unknown command` errors at runtime.
- **`spur rule run` error propagation** — `fail-on` and `stop-on-first` flags now correctly
  drive exit codes and halt evaluation.
- **Server plugin route validation** — duplicate or invalid route prefixes are rejected at
  registration time; server lifecycle hooks are fail-soft (a broken plugin no longer takes
  down the server).
- **TypeScript strictness** — `noUncheckedIndexedAccess: true` enforced project-wide.
  `cwdStat` guard hardened; `yaml` import resolved; `vite/client` types scoped to web workspace.
- **`spur rule list`** — refactored to match the noun-verb contract and produce clean tabular
  output.
- **SECU hardening** — ETL query table parameter narrowed to an allowlist union, preventing
  SQL injection through user-controlled identifiers.

### Breaking Changes

- **Re-foundation** — Spur has been rebuilt from the ground up on the `spur-new` monorepo.
  The old `spur` codebase under `drizzle/_legacy_reference/` is frozen and inert. If you had
  a checkout of the original repo, migrate to the new one.
- **`@gobing-ai/spur-cli`** now publishes as a Bun-native binary (entry: `dist/index.js`,
  engines `bun >= 1.3.0`). The old Node.js-based CLI is retired.
- **`.spur/rules/` layout** — preset files renamed and reorganized. `recommended.yaml` is
  now `recommended-pre-check.yaml` + `recommended-post-check.yaml`. Custom rule files
  referencing old preset names need updating.
