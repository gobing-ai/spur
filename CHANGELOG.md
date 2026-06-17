# Changelog

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
