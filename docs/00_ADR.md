---
doc: 00_ADR
owns: WHY — cross-cutting decisions, one-line reasons
authority: authoritative
version: 1.2.0
owner: Robin Min
updated_at: 2026-08-01
read_before: any structural change; before diverging from a decision
edit_rules: 99 §6.1
sync: [T1, T2]
---

# 00 ADR — Spur

The single source of truth for Spur's cross-cutting **decisions**. Each `ADR-NNN` records *what was
decided* and *the one-line reason*; mechanism and consequences live in `03`/`04` via the `Detail:`
pointer. Entry format and maintenance rules: `99 §6.1` (append-only; dated amendments and
superseding entries only; gaps stubbed, never reused; the template binds new entries — historical
entries are not restructured). There is no `06_DECISIONS.md`. Only real cross-cutting decisions
belong here — not implementation notes, not feature status, not how-to guidance. Entries that grow
past decision + reason are carrying mechanism that belongs in `03`/`04`; link it instead of inlining it.

---

## ADR-001: Greenfield Re-Foundation

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Re-found Spur as a clean Bun-workspace monorepo scaffolded from `ts-base` conventions,
rather than extracting the debt-laden `@spur/*` tree from the original starter. No `@spur/*` scope
exists here; apps depend only on `@gobing-ai/ts-*` packages plus two thin local packages
(`contracts`, `config`).

**Why.** Extracting the old code as-is would carry its accumulated debt forward.

**Amendment (2026-06-11) — package inventory drifted.** "Two thin local packages" is stale: the
repo owns four (`app`, `contracts`, `config`, `domain`). The greenfield decision stands; the
current inventory lives in `03 §1`, and the apps-are-wrappers principle it implies is canonized by
ADR-021.

**Detail:** `03 §1 Topology`.

---

## ADR-002: Bun Workspaces, No Turborepo

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Orchestrate tasks with Bun workspace filtering (`bun run --filter '*'`). Do not adopt
Turborepo or any remote-cache layer (`turbo.json` forbidden). Revisit only if package count grows
substantially.

**Why.** ~3 apps + ~2 local packages is well below the ~20-package threshold where Turborepo earns
its ceremony.

**Detail:** `03 §1 Topology`.

---

## ADR-003: Shared TypeScript Tooling from ts-base

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Import `ts-base` conventions for Biome, Lefthook, and the shared tsconfig presets
(`tooling/typescript/` — base/server/react). The lint gate is `biome check` + per-workspace
`tsc --noEmit`; style drift is a gate failure, not a review nit.

**Why.** Consistent tooling with sibling `ts-base`/`ts-libs` projects.

**Detail:** style rules in `AGENTS.md` (Code style); preset wiring in `03 §1 Topology`.

---

## ADR-004: ts-libs as External Dependencies, Not Workspace Members

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Consume `@gobing-ai/ts-*` packages by npm semver; they are not members of this repo's
`workspaces` array. `workspace:*` is invalid for these deps and must never appear in a committed
manifest. `bun link` is temporary inner-loop tooling only — unlink, publish, and pin to semver
before a task's gate.

**Why.** The Spur ↔ ts-libs boundary becomes an `import` line, enforceable in review.

**Detail:** `03 §1.1 External dependency boundary`.

---

## ADR-005: oRPC as the Type Seam

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Use oRPC (`@orpc/*@1.14.x`) as the server↔web type seam: contracts in
`packages/contracts` (transport DTOs only), server binds handlers via `implement(contract)`, OpenAPI
generated from the contract, web client typed via `OpenAPILink`. The old `@hono/zod-openapi` +
`Equals<A,B>` pattern is retired and must not return.

**Why.** Makes contract↔handler drift a compile error instead of a runtime surprise.

**Detail:** `03 §4 Type Seam`; concrete surface in `04 §5 Server/Web`.

---

## ADR-006: Domain Engines Are External ts-libs Packages, Not a Local Kernel

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** The reusable engines are standalone, independently-versioned ts-libs packages
(`ts-ai-runner`→`spur agent`, `ts-rule-engine`→`spur rule`, `ts-dual-workflow-engine`→`spur
workflow`, `ts-llm-jsonl-importer`→`spur history`), each owning its types and schema. The old
`@spur/kernel` monolith is gone; CLI commands are thin transport wrappers.

**Why.** Engines stay reusable by other projects; Spur is a thin consumer with only its domain glue
local.

**Detail:** `03 §1.1 External dependency boundary` and the per-domain sections `03 §5–7`.

---

## ADR-007: Package-Owned Database Schema

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Each domain package exports its own schema SQL; the CLI composes them with its own
domain tables into `CLI_SCHEMA_SQL` and applies them through an isolated journal
(`__spur_cli_migrations`). The migrator only loads top-level `drizzle/*.sql` files containing the
`_spur_cli_` marker; `drizzle-kit` is not the CLI's migration runtime.

**Why.** Schema ownership follows code ownership instead of coupling every table to one migration set.

**Detail:** `03 §8 Data & Storage`; table shapes in `04 §3.1 Tables`.

---

## ADR-008: History — Raw Stays in Files, DB Holds Only Validated ETL

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** `@gobing-ai/ts-llm-jsonl-importer` validates before persist (only Zod-validated
records reach the DB), keeps raw JSONL as the canonical store (no `history_raw_*` tables), is
incremental by `(source, source_file)` checkpoint, idempotent via post-redaction SHA-256, and models
each source as one `SourceDefinition` variant over a generic pipeline.

**Why.** The old importer stored raw JSON in DB columns (hit SQLite limits), re-imported everything
each run, and re-implemented splitting per platform.

**Detail:** `03 §7 History Import & Analytics`; `SourceDefinition` shape in `04 §3.2`.

---

## ADR-009: Dual-Mode Workflow Engine

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** `@gobing-ai/ts-dual-workflow-engine` provides two execution models behind one host: a
state-machine driver (FSM — linear/looping) and a transition-flow driver (DAG with conditional
branching). Definitions are Zod-validated YAML with variable interpolation; persistence is via an
adapter (SQLite through ts-db; in-memory for tests).

**Why.** One dependency covers both simple dev-task loops and complex orchestration without a second
engine.

**Detail:** `03 §6 Workflows`.

---

## ADR-010: CLI Is the Primary Surface; Local-First by Default

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** The CLI (`apps/cli`) is the primary entry point and writer of record; server/web are a
thin, read-oriented inspection surface (also runnable on Cloudflare Workers). SQLite + local files
are the default store. Every command supports `--json`. Committed product commands: `init`, `agent`,
`history`, `rule`, `workflow`; supporting utilities: `status`, `migrate`. Commands beyond this set
are deferred until their need and design are re-confirmed — not ported speculatively.

**Why.** Spur is a single-machine developer tool with no network requirement in the Phase-1 core loop.

**Amendment (2026-06-11) — shipped surface drifted past this entry.** Team-mode commands
(`spur message send|inbox|reply`, `spur team assign|status|start|stop`,
`spur agent create|edit|delete`) and the trace surfaces (`spur rule trace`,
`spur workflow trace`) shipped without updating this decision; they are hereby recorded as
committed surface. The planning layer extends the set further per ADR-020. The read-oriented
server/web clause stands until the server/web design task (see ADR-021 consequence b) refines it.

**Detail:** `03 §2 Runtime Model`; command surface in `04 §1 CLI Surface`.

---

## ADR-011: ts-db Consumed as a Facade; Tables Are a Single Source of Truth

**Status:** Accepted · **Date:** 2026-06-01

**Decision.** As a consumer of `@gobing-ai/ts-db` (drizzle-free facade), Spur confines `ts-db` and
`drizzle-orm` to `packages/domain` (drizzle only inside `src/schema/`), defines tables via
`defineTable` (never bare `sqliteTable`), derives all DDL from `createTableSql` (no hand-written
`CREATE TABLE` for Drizzle-backed tables, no `.sql` text-imports), and keeps raw SQL out of apps.

**Why.** Makes table/DDL/zod drift structurally impossible and keeps the storage engine swappable
and apps SQL-free.

**Detail:** `03 §8 Data & Storage`; enforced by `.spur/rules/boundary/dao-boundary.yaml`.

---

## ADR-012: Plugin System Is the Foundational Substrate (Sandboxing Out of Scope)

**Status:** Accepted (design) · **Date:** 2026-06-03

**Decision.** Adopt a plugin substrate — standalone SDK (`@gobing-ai/spur-plugin-sdk`, depending only
on `ts-infra`), manifest-driven discovery, capability registries, and a four-tier trust ladder
(`bundled` > `curated` > `local` > `untrusted`) — designed from day one to carry first-party
primitives, but built as **gated, independently-shippable slices**. Key constraints: built-ins are
pre-registered through the same `register()` path (not special-cased); core/bundled plugins load
**fail-fast**, `local`/`curated` **fail-soft**; `bundled` capabilities are never gated; the harness
seam needs **no upstream change** (Spur-side overlay over the structural `AgentShim` interface); all
plugin files are YAML validated by a per-file Zod schema. Trust ships as **registration-time
gating** only — runtime sandboxing (fs/net/shell isolation) is **accepted out of scope**; the
`untrusted` tier is not loaded at all (fail-closed). No plugin code ships from this decision.

**Why.** Spur is a single-machine, local-first tool (ADR-010) where every installed plugin is already
operator-trusted, so OS-level isolation solves a threat model that does not yet exist; the substrate
must still be load-bearing because first-party primitives will migrate onto it later.

**Supersedes earlier framing:** the "blocked on upstream `BaseHarness`" and "manifest in TOML"
readings are withdrawn. **Scope authority:** sandboxing-out-of-scope follows `01_PRD §5.4`.

**Detail:** `03 §11 Plugin Substrate` (mechanism, two-class loading, trust engine, harness overlay);
manifest/config schemas and the trust ladder in `04 §6 Plugin System`.

**Addendum (2026-06-03) — Phase 5d (harness overlay) deferred; "no upstream change" scoped to
resolution only.** The original decision claimed the harness seam "needs no upstream change." On
implementation review (task 0015) this holds for **resolution** — a Spur-side overlay
`Map<string, AgentShim>` checked before `getAgentShim` resolves a plugin shim with no upstream edit —
but **not for execution**: `@gobing-ai/ts-ai-runner`'s `AiRunner.runPromptCommand(agent: AgentName, …)`
accepts only the closed `AgentName` union and re-resolves via `getAgentShim` internally, so it cannot
run an injected plugin shim. Executing a plugin harness therefore requires *either* an upstream
`AiRunner` change to accept an injected `AgentShim`, *or* Spur re-implementing the subprocess +
identity-preamble path (duplicating the runner). **Decision:** defer Phase 5d. Its only real consumer
is the unscheduled **5f** built-in-harness migration, and no committed PRD surface (the 7 supported
agents in `01_PRD §1`/`§5.1`) needs user-defined agent types. 5d is reactivated only when 5f is
scheduled or a concrete product need for plugin-defined harnesses appears; the upstream `AiRunner`
injection is its prerequisite, not an optional nicety. Tracked in task 0015 (status `Blocked`).

**Amendment (2026-06-09) — Substrate home moves to ts-infra; SDK deleted; registries deferred.**
The `@gobing-ai/spur-plugin-sdk` package (~945 LOC of capability registries, trust engine,
event registry, manifest schema) had zero real consumers (no `plugin.yaml` on disk, no
registry methods called from production code). Per Q&A 0029 (2026-06-08), the decision record
is amended to reflect the new shape:

- **Substrate home: ts-infra, not a standalone Spur SDK.** A bare `Plugin` (lifecycle-only:
  `onLoad`/`onStart`/`onStop`/`onUnload` + `failFast`) and `PluginHost` (register, lifecycle
  fan-out with fail-fast load, fail-soft start/stop/unload in reverse registration order) were
  upstreamed to `@gobing-ai/ts-infra` (ts-libs tasks 0025–0028, ADRs 015–018), shipping in
  `0.3.6`. The `runApplication` / `runNodeApplication` bootstrap drives the plugin lifecycle
  natively via `plugins`/`pluginHost` options.
- **`packages/plugin-sdk` is deleted.** Spur imports `Plugin`, `PluginHost`, and
  `PluginSummary` from `@gobing-ai/ts-infra/application`.
- **Capability registries (api, command, event, harness, provider, rule, skill, ui, worker)
  are deferred — not permanently rejected.** They can be re-added later on top of the ts-infra
  `Plugin` interface when a real plugin consumer exists. The four-tier trust ladder
  (`bundled` > `curated` > `local` > `untrusted`) is likewise deferred.
- **Server plugin routes (`apps/server/src/plugins.ts` + its `ApiRegistry`/`mountPluginRoutes`
  seam) are removed.** They had no consumer beyond their own tests.

This amendment **supersedes** the original ADR-012 decision text for substrate home, SDK
scope, and deferred mechanism. The harness-overlay addendum (Phase 5d) is unaffected.

**Detail:** `03 §11 Plugin Substrate`, `04 §6 Plugin System` — updated to point at ts-infra
core and mark Spur registries/trust as removed.

---

## ADR-013: CLI Help Is Command-Scoped

**Status:** Superseded by ADR-014 · **Date:** 2026-06-04

**Decision.** Keep one executable CLI layer, but require every top-level command module to export a
dedicated `helpText()` usage renderer registered in the dispatcher help registry via aliased imports.
`spur <command> --help`, `spur <command> help`, and `spur help <command>` are equivalent. Global help
remains only the compact command index in `apps/cli/src/index.ts`.

**Why.** A one-layer CLI still needs command-local usage; falling back to global help hides command
contracts and causes migration drift.

**Detail:** concrete command surfaces in `04 §1 CLI Surface`.

---

## ADR-014: CLI Dispatch and Help via Commander

**Status:** Accepted · **Date:** 2026-06-06

**Decision.** Build the CLI surface on `commander` + `@commander-js/extra-typings` (added to the
root Bun catalog as a CLI-only shared dep). Each noun exports
`registerXxxCommand(program, context)`; `apps/cli/src/index.ts` builds a single `Command`, registers
all 10 nouns, and runs `parseAsync`. Commander owns option parsing, subcommand dispatch, `--help`
rendering, and the noun-verb grammar (`spur <noun> <verb> …`; `init`/`status`/`migrate` verb-less;
all other nouns require a verb). Exit codes propagate through a mutable `context.setExitCode` ref
captured in `main()` because Bun's `process.exit` cannot be intercepted by commander's `exitOverride`.

- **2026-06-06 — Revert domain-grouped top-level help.** The `configureHelp({ visibleCommands: () => [] })`
  and `renderCommandGroups()` override was removed. Top-level `spur --help` now renders commander's
  standard flat alphabetical command list. The grouped listing was judged inferior to commander's
  built-in rendering. The `COMMAND_GROUPS` table and custom renderer are deleted; `docs/04_DESIGN.md`
  §1.0 help-dispatch table updated accordingly. References in ADR-014 paragraph and task 0021 R5
  are superseded by this entry.

**Why.** The hand-rolled `CommandSpec`/`renderCommandHelp`/`resolveVerb`/`args.ts` approach (and the
ADR-013 per-command `helpText()` + help registry) was a maintenance burden re-implementing what
commander provides natively — the same library the original Spur already used. Migrating removes
bespoke parsing/dispatch/help code in favor of a maintained dependency.

**Supersedes ADR-013** (command-scoped `helpText()` + dispatcher help registry — withdrawn; commander
renders command-scoped help, and `spur <noun> --help` / `spur <noun> help` / `spur help <noun>` stay
equivalent through commander). **Reverses the earlier "no Commander, hand-rolled CLI" constraint**
recorded in task 0021's Design section; the catalog dependency add is the intended consequence.

**Detail:** `04 §1 CLI Surface` (`§1.0 CLI grammar` + help dispatch); migration notes in task 0021.

---

## ADR-015: Default Config Is Spur-Owned at Repo-Root `./config`

**Status:** Accepted · **Date:** 2026-06-07

**Decision.** Repo-root `./config/{rules,workflows,plugins,tasks,templates}` is the **single source of
truth** for all Spur default config files, separating config assets from source code. The build copies
`./config` into the published package as top-level `config/` (via `bundle-config` → `apps/cli/config`,
listed in the package `files` array); runtime resolves bundled defaults from that tree, lazily seeds
them into `~/.config/spur/` on first `spur init` (never overwriting), and `spur init` scaffolds a
project's `.spur/` with a **full-tree copy** of the bundled assets (plus a manifest pass for remaps
and root-scoped docs/AGENTS). The three-layer resolution model (`bundled` > global `~/.config/spur` >
local `.spur`) is unchanged; **no symlinks** participate in the install or init flow.

> **Layout history.** Early releases shipped config as `dist/config`; mid-era packages nested it under
> `spur-cli/config` after the bin moved to package-root `spur.js`. Current releases restore package-root
> `config/` so the install tree matches the monorepo SSOT name. `bundledConfigRoot()` still accepts
> `spur-cli/config` for already-installed legacy packages.

Ownership splits by concern:

- **`@gobing-ai/ts-rule-engine` keeps only generic demo rules** — one example per builtin evaluator
  (`no-biome-suppressions`, `coverage-gate`, `tsdoc-exports`, `test-location`) plus a generic
  `example.yaml` preset its own tests reference. It no longer ships Spur-specific presets.
- **Spur owns its presets and workflows** under `./config` (`recommended-pre-check.yaml`,
  `recommended-post-check.yaml`, `workflows/basic.yaml`), authored as real files — **not** as embedded
  TypeScript string literals in `init.ts`.

**The bare `recommended` preset is removed.** `recommended-pre-check` is the new default for
`spur rule run`. This is a **BREAKING CHANGE** for any script invoking `--preset recommended`.

**Why.** Default config was scattered and cross-repo: spur-specific rule/preset files lived in the
generic rule-engine package, while workflows/presets were hardcoded as TS strings in `init.ts` (a
duplication the code itself flagged as fragile). A generic rule engine has no business owning a
consumer's opinionated presets. Centralizing in `./config` makes the source of truth inspectable,
versioned with the app, and the single input to build → install → init. The rule-engine's bundled-rule
**fallback mechanism** (`rule-service.ts` appends `bundledRulesRoot()` as the lowest-priority layer) is
independent of any preset name and is retained — only the spur-specific *files* and the default *preset
name* change.

**`--compile` caveat.** The `bun build --compile` binary (`dist/cli/spur`) cannot read a sibling
package `config/`; it relies on the `~/.config/spur` seed. The published global install
(`bun install -g`, runs `spur.js`) reads package-root `config/` directly, so this is the primary path.

**Detail:** asset layout, init flow, and preset vocabulary in `04 §2.3 Default config assets` and
`04 §1.1` (`spur init`, `spur rule run`); cross-repo cleanup sequenced so ts-libs preset deletion lands
only after Spur's centralization is green. Trust-ladder `bundled` plugins (ADR-012) gain their home at
`./config/plugins`.

---

**Amendment (2026-07-06) — build-time `config/` vs runtime `.spur/` path convention (task 0217).**
`config/` is the build-time bundled-asset source of truth: the `apps/cli` build copies
`./config/{rules,workflows,plugins,tasks,templates}` into the distributable, and `bundledConfigRoot()`
resolves them at runtime via an upward filesystem walk. `.spur/` is the **runtime configuration
directory** that agent-facing instructions (`plugins/sp/`) and runtime source code (`apps/`, `packages/`)
MUST reference when teaching or composing paths. The `config/(plugins|rules|tasks|templates|workflows)`
literal is forbidden in scope — even in JSDoc and test fixtures — enforced by a standing spur rule
(`config/rules/boundary/sp-runtime-path.yaml`, part of `recommended-pre-check`) at `severity: error`.
The `.spur/ → config/` symlinks within the Spur repo are a development convenience only and do not
change the convention. **Why.** A `plugins/sp/` skill that says `config/workflows/task-pipeline.yaml`
teaches every project created via `/sp:spur-init` the wrong path; the confusion propagates to every
downstream user. The rule turns the convention into an auto-enforced invariant so the mistake cannot
recur.

## ADR-016: Slash Commands Only Where the LLM Adds Value Over the CLI

**Status:** Accepted · **Date:** 2026-06-07

**Decision.** A Spur slash command (`plugins/*/commands/*.md`) is justified **only** when it converts
**non-deterministic intent into a reliable sequence** the CLI cannot express as one verb. Do **not**
add a command that merely forwards flags to an existing deterministic CLI verb — the CLI is the robust
interface, and an equivalent wrapper adds a translation layer, a drift surface, and no value. The
decision test, applied per candidate:

| Candidate | Verdict |
| ----------- | --------- |
| Deterministic + single CLI verb (e.g. `spur rule run`/`validate`/`list`) | **CLI directly — no command.** The skill still drives it in natural language. |
| A complex/multi-step CLI dance the LLM would orchestrate reliably | **Command** — it simplifies a real workflow. |
| Fuzzy human intent → a reliable generated/edited artifact (e.g. NL → validated YAML rule) | **Command** — this is the LLM's value. |

This composes with the **Fat Skill, thin wrapper** rule: the skill (`sp:spur-rules`) owns all logic as
named operations; a command is a ~50-line `Skill()` delegation, never a reimplementation. A **subagent**
(`agents/*.md`) is the same delegation in a separate context window — warranted only when the work is
heavy/multi-step enough to justify context isolation, or when the operator wants to hand off a whole
lifecycle; otherwise prefer a command. Worked application: of six `spur rule` operations,
`run`/`validate`/`list` stay CLI-only; `scan`/`add`/`refine` became the three commands.

**Why.** Mirroring every CLI verb as a slash command floods the surface with zero-value forwarders that
drift from the CLI they wrap. Reserving commands for the non-deterministic cases keeps the wrapper layer
small, honest, and aligned with where an LLM actually beats a deterministic tool.

**Detail:** the operation taxonomy and per-operation contracts live in
`plugins/sp/skills/spur-rules/references/operations.md`; this ADR governs the command-vs-CLI-vs-subagent
choice for any future Spur plugin surface.

---

## ADR-017: CLI Bootstrap Standardized on ts-infra runApplication

**Status:** Accepted · **Date:** 2026-06-08

**Decision.** Rewire `spur-cli`'s `main()` to run through `@gobing-ai/ts-infra`'s
`runNodeApplication` (the Node/Bun convenience subpath over the portable `runApplication`).
This standardizes the bootstrap so `spur-server` can reuse the identical wiring later.
Configuration surface consolidates from two parallel files (`.spur/config.json` project marker +
`.spur/config.yaml` app config) to a single `.spur/config.yaml` with a portable `bootstrap:`
section consumed by ts-infra and an app-specific section validated by a local zod schema.
The JSON project marker is retired; `init` writes `.spur/config.yaml`; `status` checks
`.spur/config.yaml`. Resolution order: project `.spur/config.yaml` → fallback
`~/.config/spur/config.yaml`.

**Why.** The bootstrap was hand-rolled per-app with no shared lifecycle. `ts-infra` 0.3.5
introduced `runApplication` / `runNodeApplication` specifically to standardize this — using it
eliminates duplication, gives CLI and server the same logger/telemetry/events/DB wiring, and
makes a future Bun↔Node runtime swap a config change rather than a rewrite. The two-config-file
split (JSON marker + YAML config) was an inconsistency that needed reconciliation.

**Detail:** schema format in `04 §2.1`; bootstrap wiring in `03 §2 Runtime model`.

---

## ADR-018: (number never allocated)

**Status:** Skipped · **Date:** recorded 2026-06-11

The sequence jumped from 017 to 019 (ADRs 015–018 were allocated in the ts-libs repo during the
same period and the number was burned by confusion between the two sequences). Recorded so the
gap is audit-clean. Do not reuse.

---

## ADR-019: Server Bootstrap Splits Portable/Worker vs Node/Bun by Runtime

**Status:** Accepted · **Date:** 2026-06-09

**Decision.** The Spur server runs on two runtimes — `Bun.serve` (`src/index.ts`) and Cloudflare
Workers (`src/worker.ts`). The portable `runApplication` (`@gobing-ai/ts-infra/application`) is
Workers-safe; the Node/Bun convenience `runNodeApplication` (`@gobing-ai/ts-infra/application-node`)
pulls in `node:fs` and is **not** Workers-safe. Therefore each entry uses the bootstrap layer it is
allowed to use: the Bun entry via `runNodeApplication` (mirroring the CLI per ADR-017), and the
Worker entry via the portable `runApplication` behind a lazy singleton (cached bootstrap promise,
no top-level await). The shared `createApp` and `serverBootstrapConfig` live in `src/bootstrap.ts`
so the two entries share config logic and the Hono app factory without coupling to either bootstrap
subpath.

**Why.** The server was the last Spur app with hand-rolled bootstrap. Standardizing on ts-infra's
lifecycle eliminates duplication with the CLI, gives the server structured logging/telemetry/events,
and keeps the Worker bundle free of `node:*` imports by design.

**Detail:** bootstrap wiring in `03 §2 Runtime model`; bootstrap subpath split in `04 §5`.

---

## ADR-020: Planning Layer Joins the Committed Surface (`spur task` / `spur feature`)

**Status:** Accepted (design) · **Date:** 2026-06-11

**Decision.** Extend the committed command set (ADR-010, as amended) with two nouns migrated from
`cc-agents/plugins/rd3`: `spur task` (markdown task CRUD, WBS allocation, section editing,
lifecycle, validation) and `spur feature` (`docs/features/FT-*.md` CRUD, INDEX generation, BDD
acceptance criteria, traceability). **Markdown files are the single source of truth** — SQLite
holds only derived, rehydratable data — mirroring ADR-008. Domain logic is Spur-local in
`packages/` per ADR-021 (it is Spur's own domain glue, not a generic engine per the ADR-006
division); the generic Gherkin-subset validator is upstreamed to ts-libs. Two deliberate
non-additions: the spec pipeline (description → BDD AC → decomposed tasks) is **not a CLI noun** —
it is a fat skill in `plugins/sp` (ADR-016/ADR-023) driving `spur agent run` plus the deterministic
verbs, with CLI validation gating every LLM output before write; and the board launcher
(`spur serve` or otherwise) is **not decided here** — it belongs to the server/web design task
(ADR-021, consequence b). ADR-010's reconfirmation clause is satisfied by the 2026-06-10
evidence-based review.

**Why.** The rd3 task/feature stack is the most-used harness component, and its executable logic
belongs in Spur, not in a Claude Code plugin tree with no shared foundation.

**Detail:** mechanism and invariants in `03 §12 Planning Layer`; scope rows in `01_PRD §5.1`;
per-item dispositions in `docs/plans/2026-06-10-rd3-migration-feature-list.md`; command and schema
shapes land in `04_DESIGN.md` in the same commits the commands ship.

**Amendment (2026-06-25) — parent↔child roll-up gate (task 0121).** `spur task check` gains a
**roll-up** semantic in its L4 traceability layer: for any task that is a decomposition *parent*
(one or more sibling tasks declare `parent_wbs` pointing at it), the parent↔child status
relationship is validated. Three advisory (**warning**) findings, `--strict` elevating per the
established convention: (a) parent `done`/`cancelled` while a child is still open; (b) all children
`done`/`cancelled` while the parent is still open; (c) parent `## Plan` carries no sub-task roster
table (the Tier-1 convention from `decomposition.md`). The check is **inert** for tasks with zero
children — no behavior change there. This is the first `task check` rule that reads *sibling* tasks,
not just the task under check; it does so with one `readDir` + frontmatter scan of the tasks dir
(L4 resolves per-task edges file-by-file — it does not pre-load the corpus, so the children index
cannot reuse an existing pass). Warning (not error) mirrors the DD-09 AC-coverage check: a parent
mid-decomposition is a normal transient state, so the gate nudges rather than blocks. Trigger:
dogfood finding, task 0109 shipped `done`-ready without a sub-task roster, making its completeness
unverifiable. Relates: enforces the Tier-1 doc convention added to `decomposition.md`.

**Amendment (2026-06-25) — roster generator (task 0123).** The roll-up gate above only *warns*
about a missing/stale roster; `spur task refresh-roster <wbs>` is the **generator** half — it
regenerates a parent's sub-task roster table inside its `## Plan` between `refresh-roster` auto-gen
markers, idempotently (insert-when-absent preserving hand-written Plan content; rewrite-in-place when
present). It mirrors `spur feature refresh`'s `## Tasks` marker region, but does region handling in
the service rather than via `MarkdownDocument.replaceMarkerRegion` (which normalizes the label to
"spur feature refresh" and would mislabel a task roster). Zero children is a clean no-op; no `## Plan`
errors. The global `spur task refresh` (kanban.md) is untouched. Relates: closes the 0121 R5 scope-guard
deferral.

**Detail:** `04_DESIGN.md §7.1` (`task check` + `task refresh-roster` rows); implementation
`packages/app/src/services/task-check.ts` (`runL4Rollup`), `packages/app/src/services/task-service.ts` (`refreshRoster`).

---

## ADR-021: Functionality Lives in `packages/app`; Apps Are Transport Wrappers

**Status:** Accepted · **Date:** 2026-06-11

**Decision.** Every app (`apps/cli`, `apps/server`, `apps/web`) is a thin transport wrapper; real
functionality — application services, write paths, domain orchestration — lives in `packages/app`
(over `packages/domain` DAOs and the ts-libs engines). This canonizes the existing CLI-only
constraint (`03 §1.1` rule 4) repo-wide. Two consequences: **(a)** the planning layer's write
service lives in `packages/app`, so CLI commands and any future server routes mutate through the
same service — one validated write path and one lock domain **by construction**, never by policy
(the legacy rd3 CLI/HTTP dual-lock file corruption becomes structurally impossible); **(b)** the
server/web reset — what real surface each app exposes once the planning layer gives them content —
is a **separate design task**, deliberately not decided here; until it lands, server/web remain
the thin read-oriented slice of ADR-010, and the board launcher question is settled there.
Amends ADR-001's stale package inventory (four local packages: app, contracts, config, domain).

**Why.** Centralizing functionality once is what makes N transports additive instead of divergent.

**Detail:** `03 §12.2` (write service); `03 §1 Topology`.

---

## ADR-022: Task & Feature Lifecycle Runs on `spur workflow`

**Status:** Accepted · **Date:** 2026-06-11

**Decision.** Task and feature status lifecycles are `spur workflow` YAML definitions backed by
`@gobing-ai/ts-dual-workflow-engine` — not hand-rolled FSMs. Gates are workflow guards;
customization rides the engine's EventBus. The markdown frontmatter `status` field remains the
SSOT; engine state is derived and rehydratable.

**Why.** Building a lifecycle engine beside an owned workflow engine would duplicate the capability
the engine exists to provide.

**Detail:** `03 §12.2–12.3`.

**Amendment (2026-06-15) — pipeline-pause deferred.** The approve gate uses `hitl.confirm`, not
`pause: true`. Flip when the globally-installed `@gobing-ai/spur` ships the pause-aware schema.
Task 0071 R4.

---

## ADR-023: rd3 Migration — Dividing Line, Fat Skills, Design Collectively

**Status:** Accepted · **Date:** 2026-06-11

**Decision.** Three rules: **(1)** Code that executes, validates, stores, or coordinates moves into
Spur; already-replaced agents are never migrated. **(2)** Agent-facing behavior centralizes in
`plugins/sp` skills (SSOT); slash commands and subagents are thin wrappers of skills (extending
ADR-016). **(3)** All work is designed collectively first, then implemented in phases — superseding
the "minimal structural change" premise.

**Why.** Dividing line keeps scope refutable; Fat Skills gives one SSOT across agents; collective
design prevents mechanically porting models the data rejected.

**Detail:** `docs/plans/2026-06-10-rd3-migration-feature-list.md`; `02 §Phase 1.5`.

**Amendment (2026-06-30) — ADR-028 refines (2).** "Fat Skills" means coherent competencies, not a
single lifecycle monolith. See ADR-028.

---

## ADR-024: Anti-Hallucination Guard Moves to Superskill; Spur Adds Capture + Validate Primitives

**Status:** Accepted · **Date:** 2026-06-18

**Decision.** The anti-hallucination guard engine is owned by `superskill`, not Spur. Spur provides
two workflow primitives: `AgentService.runCapture` (returns `{ exitCode, answer }`) and
`response.validate` (DI-injected `ResponseValidateEngine`, same pattern as `rule.check`).

**Why.** The guard protocol is agentic answer-verification — belongs in superskill by charter;
Spur's role is the harness plumbing.

**Detail:** `packages/app/src/builtins.ts` (DI seam). The engine is wired by the installed
`cc:anti-hallucination` skill.

**Amendment (2026-06-20) — migration complete.** In-repo `plugins/sp/skills/anti-hallucination/`
removed. The `ResponseValidateEngine` DI seam is unchanged (never an in-repo import).

---

## ADR-025: Web Interaction Libraries — dnd-kit and @uiw/react-md-editor

**Status:** Accepted · **Date:** 2026-06-22

**Decision.** Adopt `@dnd-kit/core` + `@dnd-kit/sortable` for drag-and-drop and
`@uiw/react-md-editor` for markdown editing on the task-kanban board. Both are apps/web-only
package-private literals. Retain the Astro-island shell.

**Why.** dnd-kit is the actively-maintained successor to @hello-pangea/dnd with first-class
keyboard/accessibility sensors; @uiw/react-md-editor is proven for inline markdown editing.

**Detail:** `apps/web/package.json`; `apps/web/src/ui.ts` (single import seam); UI rules in
`config/rules/ui/`.

---

## ADR-026: Verification Is a Companion Skill; Pipeline Gate Is a Workflow Guard

**Status:** Accepted · **Date:** 2026-06-23

**Decision.** (a) Verify/review lives in `sp:code-verification`, not the `sp:spur-dev` umbrella.
(b) The pipeline gates `verify → record` on a verdict artifact: `PASS` clears to `done`,
non-PASS routes to `failed`. (c) `implement` calls `/sp:dev-run --mode implement`, never the
pipeline-driving `/sp:dev-run`.

**Why.** Verification is a distinct concern; the verdict artifact is the spur-native postflight
gate (replacing rd3's `--postflight-verify`).

**Detail:** `03`/`04_DESIGN.md §7.5`; verdict schema in `code-verification/references/verdict-schema.md`.

**Amendment (2026-06-23) — done-gate.** `record → done` mirrors `verify → record`: a shell guard
asserting `spur task check` before `done`. Each section is owned by one pipeline step. Trigger:
task 0106 (task 0101 reached `done` while failing its own check).

---

## ADR-027: Config Loading Is `spur-config`-Owned; Core/Loader Split; Legacy Config Retired

**Status:** Accepted · **Date:** 2026-06-26

**Decision.** `.spur/config.yaml` has one loader: `loadSpurConfig` in `@gobing-ai/spur-config`. The
package splits into a dependency-free **core** (schemas, types) and a node-only **loader**
(`loadSpurConfig`, file resolution) — forced by Cloudflare Workers (importing `yaml`/`node:fs`
crashes miniflare). The merged `spurConfigSchema` owns every section; the legacy
`docs/.tasks/config.jsonc` read is retired.

**Why.** Five parallel config-loading paths across surfaces caused phase-folder drift bugs. The
core/loader split gives the server a real boundary instead of inline-literal hacks.

**Detail:** `04_DESIGN.md §2`; `03_ARCHITECTURE.md` (`spur-config` module).

**Relates:** completes ADR-015, ADR-017. Trigger: task 0129.

---

## ADR-028: Skills Decompose by Function; Thin Spine Dispatches Competencies

**Status:** Accepted · **Date:** 2026-06-30

**Decision.** ADR-023 rule (2) refined: skills remain the SSOT, but "fat" means coherent
competency, not lifecycle monolith. `sp:spur-dev` decomposes into functional competency skills
(`sys-architecture`, `code-implementation`, `code-testing`, `code-verification`,
`spec-decomposition`) behind a thin orchestration spine. A single `sp:spur-cli` router-facade
replaces per-noun CLI skills. Subagent `expert-spur` replaces per-noun expert subagents.

**Why.** Functional decomposition yields deep modules with narrow interfaces, reusable outside the
pipeline — the model the rd3 migration's own origin used. The umbrella skill was a regression.

**Detail:** `03_ARCHITECTURE.md §12`; `04_DESIGN.md` (skill/agent inventory); `05_FEATURES.md §9`.

**Supersedes:** monolith reading of ADR-023 (2).

---

## ADR-029: Planning-Pipeline Fate Deferred; `spur feature advance` Added

**Status:** Accepted · **Date:** 2026-07-02

**Decision.** (a) The planning-pipeline's fate (retire / keep / fold into idea-pipeline) is
deferred — an operator call, not resolvable by a single audit wave. (b) `spur feature advance`
replaces a ~20-line shell status ladder in `wrapup-pipeline.yaml` with a tested CLI verb. The
verb walks the legal lifecycle idempotently; `spur feature update` retains its single-step
semantics. Both share `FeatureService.transition`.

**Why.** The deferral is honest; the advance verb centralizes the multi-hop lifecycle walk in
code instead of workflow YAML.

**Detail:** `04_DESIGN.md §1`; `apps/cli/src/commands/feature.ts`.

**Relates:** records F9 outcome of 0176 audit; extends ADR-016.

---

## ADR-030: Bun mock.module Is Process-Global — Shared Full-Surface Mock Pattern

**Status:** Accepted · **Date:** 2026-07-08

**Decision.** Bun's `mock.module()` is process-global, hoisted, and not reverted by
`mock.restore()`. When multiple test files mock the same first-party module with incompatible
surfaces, the last mock wins — causing CI-only, ordering-dependent failures. Three rules:
(a) create a shared full-surface mock helper for any module mocked by ≥2 files; (b) use
`beforeEach` to re-register custom behavior atop the shared baseline; (c) never mock a module
that another test file tests directly.

**Why.** 73 CI failures traced to six files mocking `rpc-client` with incompatible surfaces and
`index.test.tsx` mocking `useTaskParams`/`useTasks` — modules with dedicated test files.

**Detail:** `apps/web/tests/test-helpers/rpc-client-mock.ts`; rules `no-leaky-module-mocks`,
`no-unmocked-module-eval-side-effects`.

## ADR-031: Plugin `sp` Splits Prompts from Executable Code — `scripts/<skill>/` and `tests/<skill>/` at Plugin Level

**Status:** Accepted · **Date:** 2026-07-17

**Decision.** Inside `plugins/sp/`, prompt-layer artifacts (`skills/`, `commands/`, `agents/`) and
executable code are separate trees. Executable TypeScript helpers live at plugin level under
`scripts/<skill>/` (e.g. `scripts/daily-summary/`, `scripts/dogfood-testing/`); their suites live
under `tests/<skill>/` (fixtures included). A skill directory carries `SKILL.md` + prompt-side
companions only (`references/`, `agents/`, `examples/`) — **never** `scripts/` or `tests/`.

**Why.** Two skills had grown embedded `scripts/`+`tests/` (`daily-summary`, then `dogfood-testing`
shipped the same shape in 0276), creating a second layout convention beside the plugin-level
`tests/` tree the README already documented. Embedded code in a prompt directory is wrong on three
axes: (a) the Tier-2 knowledge layer (skills = knowledge, not execution) silently gains an
execution payload with no tier of its own; (b) test discovery, coverage ignores, and rule scopes
must special-case per-skill paths instead of one plugin-level root; (c) a future packaging step
(prompt-only distribution) would have to hunt code out of every skill dir. One convention, one
root per concern.

**Detail:** layout + prose in `plugins/sp/README.md` (Directory layout); enforcement via structural
test `R53` in `plugins/sp/tests/skill-structure.test.ts` (no `scripts/`/`tests/` under
`plugins/sp/skills/*/`).

**Relates:** complements ADR-028 (skill *content* decomposition; this ADR owns artifact *placement*);
ADR-016 extends the same "code where determinism, prompts where judgment" line to file layout.

## ADR-032: Commands Are the SSOT; Adapters Are Install-Time Output Owned by superskill

**Status:** Accepted · **Date:** 2026-07-21

**Decision.** plugins/sp/commands/*.md is the authoritative, hand-editable source for the operator
command surface. Per-platform adapters (Codex, Pi, OpenCode, Antigravity, Hermes, Grok, etc.) are
**install-time output** owned by superskill (superskill install sp) and never committed in
plugin sp. Thin-wrapper correctness is enforced by **validation** (validate-commands.ts), not
generation. The registry (command-registry.ts), generator (generate-adapters.ts), and
committed per-platform adapters (adapters/codex/) introduced in 0308 are deleted.

**Why.** The 0308 shape introduced three problems: (1) command-registry.ts duplicated every field
already present in the command .md frontmatter — a parallel encoding whose sole consumer was its
own generator, requiring a byte-exact drift test as tax for the duplication; (2) superskill
already reads commands/*.md as input to emit per-platform output, so the registry inserted a
second upstream that nothing outside its generator consumed; (3) adapters/codex/ was a single
platform artifact when superskill supports 9 targets — committing one would either be permanent
inconsistency or an obligation to add seven more folders. Generation also blocked direct improvement:
any hand or LLM edit to a command body was a test failure.

**Provenance.** 0283 R4 sanctioned the "generated **or validated**" branch for adapter thinness.
0308 took the "generated" branch and invented new metadata, without recording a design-choice
rationale. This ADR explicitly selects the "validated" branch and supersedes the 0308 approach.

**Detail:** plugins/sp/scripts/validate-commands.ts (four-gate validator),
plugins/sp/tests/command-contract.test.ts (contract test + negative-path coverage),
plugins/sp/README.md section 2 (commands-as-SSOT documentation).

**Amendment (2026-08-01) — dev-command argument contract.** The 28 `dev-*` commands use a
three-layer input contract: syntax-only `argument-hint` frontmatter; a command-local
`Argument Flags` table for public positionals, flags, descriptions, and defaults; and the shared
flag glossary for canonical cross-command semantics. Existing validation and parity tests enforce
the contract across the complete dev-command surface. Command Markdown remains the sole editable
source; no registry or generator is introduced.

**Why.** Native completion hints must stay renderer-safe while defaults and compatibility behavior
remain discoverable and mechanically consistent with their backing contracts.

**Detail:** `docs/design/dev-command-argument-contract.md`; feature H81.

---

## ADR-033: Stage-Registry Driven Adaptive Model Routing

**Status:** Accepted · **Date:** 2026-07-24

**Decision.** Key agent auto-resolution directly on the canonical `stage_id` and consume `model_policy` from the stage registry (`packages/domain/src/stage-registry/`). A stage starts on the cheapest eligible executor matching its `min_tier` (`cheap`, `standard`, `capable-1`, `capable-2`, `capable-3` — 0343 split bare `capable` into quality sub-tiers; legacy `capable` normalizes to `capable-1`) and escalates along the ordered `fallback` chain on objective risk/failure signals (`gate-fail`, `timeout`, `insufficient-evidence`, `retry-exhausted`). Cost-aware floors: `plan` uses `capable-2` (fallback `capable-3`) for Design-at-create by default; `refine` uses `standard` (fallback `capable-2`) as blank-Design fallback; `implement` stays `standard`; `verify`/`dogfood` floor at `capable-1`. Unified `--skip-design` opts out of feature satellite + per-task Design at create. Retain `default-by-phase` as a backward-compatibility shim with a one-time deprecation warning.

**Why.** Coarse prompt-regex phase mapping (`default-by-phase`) hardcoded single executor strings without capability tiers or objective escalation fallback, and failed in non-slash-command mode (e.g. subagents). The stage registry's declarative `model_policy` provides static capability minima and objective fallback triggers without hardcoding model vendor names or price.

**Detail:** `04 §2.1`, `packages/app/src/services/agent-service.ts`, `packages/domain/src/stage-registry/schema.ts`.

---

## ADR-034: Status Vocabulary Is Domain-Owned; Board Owns Its Visual Encoding; Icon-Only Affordances Carry an Accessible Name

**Status:** Accepted · **Date:** 2026-07-25

**Decision.** Three conventions for Board status affordances, established while making the Features
tree status icon-only (feature R2):

1. **Vocabulary vs. encoding.** `packages/domain/src/planning/schema.ts` is the sole owner of the
   canonical status *vocabularies* (`TASK_STATUSES`, `FEATURE_STATUSES`). A Board module must import
   the vocabulary rather than re-declare it, and owns only its *visual encoding* (glyph, label,
   color). Multiple renderings of one vocabulary are legitimate and expected — the domain's emoji
   maps (`FEATURE_STATUS_ICONS`, `TASK_STATUS_ICONS`) serve CLI/terminal output; the Board's SVG map
   serves the web surface. Two renderings are fine; two vocabularies are not.
2. **Semantic color is Spur-token-owned on Spur-token surfaces.** Where a surface's background comes
   from the `--color-spur-*` family, its status foreground must too. Converging onto that family is
   gated on the semantic tokens first gaining light-theme values: `--color-spur-success/warning/error/
   info` are declared once in `@theme` and are theme-invariant, while the daisyUI classes they would
   replace re-resolve per theme. Swap only after contrast is verified against both canvases (≥3:1,
   WCAG 1.4.11); otherwise leave the split and record it.
3. **Icon-only means accessible-name-bearing.** Any affordance that drops its text label must carry
   the human-readable label as an accessible name in the markup (`role="img"` + `<title>`/
   `aria-label`). A tooltip — native `title` or CSS-only — is a visual enhancement and never the sole
   channel, and glyphs must remain distinguishable by shape in greyscale (WCAG 1.4.1).

**Why.** (1) `apps/web/src/modules/features/status-icons.tsx` re-declared `FEATURE_STATUSES` verbatim
from the domain constant — a silent drift hazard with no compiler link, while `KanbanBoard.tsx:2`
already imports `TASK_STATUSES` from the domain, so the correct pattern was present but unapplied.
`apps/web` declares `@gobing-ai/spur-domain` at `package.json:17` and imports its schema in six
places; §5 constraint 3 ("never server internals") does not bar the planning vocabulary, so no new
dependency or layering change is involved. (2) The same file split its six colors 4/2 between Spur
tokens and daisyUI classes, orphaning `--color-spur-success` and `--color-spur-error`; the split is
invisible while a text label carries the meaning, and becomes a contrast risk the moment the label is
removed. (3) Removing a text label promotes shape and color from decoration to sole information
channel, so the accessibility contract has to be explicit or the next icon-only change repeats the
regression — the tree's six glyphs currently put four statuses on a shared circular silhouette.

**Scope note.** This ADR sets the convention; R2 applies it to the Features tree only. The Feature
detail pane and Task Kanban keep labelled affordances by design — a tree is a scanning surface, a
detail pane is a reading surface.

**Outcome (2026-07-26).** Convention (2)'s gate did its job: 0335 added the light-theme semantic
values, measured all six glyphs, and correctly **froze** the swap when `cancelled` came in at 2.30:1
on the light canvas. 0338 cleared it by introducing a dedicated `--color-spur-text-faint` token with
per-theme values rather than darkening `text-muted` globally, then completed the swap — all six
statuses now resolve through `text-spur-*` at 12/12 ≥ 3:1. Convention (3) also produced a reusable
`Tooltip` primitive (`apps/web/src/components/ui/Tooltip.tsx`): a typed wrapper over daisyUI's
CSS-only tooltip that carries no accessible name by design, keeping the name on the wrapped element.

**Detail:** `docs/design/feature-tree-status-affordance.md`,
`docs/plans/2026-07-25-feature-tree-status-icon-brainstorm.md`,
`apps/web/src/modules/features/status-icons.tsx`, `apps/web/src/styles/global.css`.

---

## ADR-035: Workflow Observability Is Read-Only; Steering Uses a Separate Safe-Boundary Controller

**Status:** Accepted · **Date:** 2026-07-28

**Decision.** Keep `WorkflowObservabilityBus` a read-only projection of persisted workflow lifecycle and
correlated agent execution. Live process output is a bounded tee: observers receive redacted chunks while
the canonical buffered answer remains unchanged. Synchronous steering uses a separate in-process command
controller at workflow-declared action boundaries, with command identity, target/version checks,
authorization, deadline, ack/nack, and policy-gated retry. Do not enable cross-process steering until a
durable authenticated, ordered, crash-recoverable command protocol receives its own approval.

**Why.** An EventBus is suitable for low-latency observation but supplies neither command durability nor
cross-process authentication, ordering, idempotency, or crash recovery. Treating passive events as control
requests would let stale or duplicated messages mutate execution history. Conversely, inheriting child
stdio would expose progress but destroy the buffered non-interactive contract used by response validation.
The separate controller and tee preserve both safety boundaries.

**Detail:** `docs/design/workflow-observability.md`,
`docs/design/workflow-steering-control-channel.md`,
`packages/app/src/workflow/steering.ts`, `packages/app/src/observability/agent-execution.ts`.

---

## ADR-036: Cloudflare Workers Use a Dedicated Portable HTTP Composition Root

**Status:** Accepted · **Date:** 2026-07-29

**Decision.** The Bun server and Cloudflare Worker use separate composition roots over shared
portable HTTP primitives; the Worker root exposes only routes whose dependency graph is
Workers-safe and never imports local filesystem, process-control, or Bun SQLite services.

**Why.** A shared eager app factory pulled Bun-only transitive dependencies into the Worker bundle,
making the documented Worker deployment fail before startup.

**Detail:** `docs/03_ARCHITECTURE.md §2`; `docs/04_DESIGN.md §5.1`.

---

## ADR-037: User-Global Project Registry for Multi-Project Board Switching

**Status:** Accepted · **Date:** 2026-07-29

**Decision.** Multi-project Spur Board discovery and lifecycle use a user-global file registry at
`~/.config/spur/projects.json` (`port: 0` = stopped). Local `spur serve` instances register and
deregister themselves (in-process hub); the board switcher lists and can start projects via that
registry. Launchd/daemon supervision is deferred but must reuse the same file contract.

**Why.** Port memorization and per-project terminal sessions are the multi-project pain point; a
cwd-local store cannot coordinate projects, and a full daemon is overbuilt while Spur is still
under active local development.

**Detail:** `docs/design/project-switcher.md`; feature `K1` (`docs/features/K1_project-switcher.md`); parent umbrella `K` Features module (Spur Board).

---

## ADR-038: A `spur` CLI Surface Change Requires a Same-Change `spur-cli` Skill Update

**Status:** Accepted · **Date:** 2026-07-31

**Decision.** Any change to the `spur` CLI surface — a new verb or flag on a covered noun, or the
removal of one — requires a same-change update to the corresponding `plugins/sp/skills/spur-cli`
reference. The coupling is enforced by a parity test
(`plugins/sp/tests/spur-cli-parity.test.ts`) that fails the build when a verb or flag in
`apps/cli/src/commands/*.ts` is absent from its reference (forward direction) or when a reference
documents a verb or flag the CLI no longer provides (reverse/phantom direction). Covered nouns:
task, feature, rule, workflow, agent, message, team, status, init, serve. Excluded Tier C nouns
(history, migrate, projects, help) are skipped via a named ignore-list with a stated reason each.

This ADR also records the **dispatch-surface rule** as a composition over ADR-033: the dispatch-
surface reference (`plugins/sp/skills/parallel-execution/references/dispatch-surface.md`) decides
*which execution surface* carries a unit of work (native subagent vs `spur agent run`); ADR-033
retains ownership of *model-tier selection* through the stage registry `model_policy`. The two
decisions compose — dispatch-surface picks the surface, ADR-033 picks the tier — and neither
duplicates the other.

**Why.** CLI↔skill drift recurred silently before H6: 3 undocumented verbs and 16 uncited flags
accumulated because nothing connected `apps/cli/src/commands/` to the skill that documents it. An
ADR without an enforcement mechanism is a wish; the parity test is the mechanism, and it is
bidirectional so a removed verb does not leave a reference advertising a command that no longer
exists. ADR-013 governs `--help` output shape and is adjacent but not applicable — it does not
govern a documentation artifact in a different tree, so this is a new decision rather than an
amendment.

**Detail:** `plugins/sp/skills/spur-cli/SKILL.md` (noun routing + Tier C exclusions);
`plugins/sp/tests/spur-cli-parity.test.ts` (enforcement); `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` (composition over ADR-033); feature `H6`.

## ADR-039: `--next` is Chain-to-Completion with Propagation — One Glossary Meaning Across All Commands

**Status:** Accepted · **Date:** 2026-07-31

**Decision.** The `--next` flag on `/sp:dev-*` commands is redefined to a single canonical meaning:
on success, hand the task back to `sp:next-router`, which resolves the next dispatch and re-invokes
with `--next` still set, until the work is done or a gate stops it. The definition, stop conditions,
hop bound, and the full shared-flag glossary live in
`plugins/sp/skills/spur-dev/references/flag-glossary.md` § Flag glossary (one entry per shared
flag). `command-flag-parity.test.ts` was extended (task 0403) to assert every shared flag has
exactly one glossary entry and each declaring command references it — the gate that failed silently
under the old four-meaning regime.

This is a **breaking change** for `dev-run --next` invocations that selected implement-only mode;
the replacement spelling is `--mode implement` (which already existed and is what `routing-table.md`
A5 already dispatched). All other declaring commands (`dev-verify`, `dev-verifyall`, `dev-refine`,
`dev-refineall`, `dev-brainstorm`) are subsumed — their old transition becomes the chain's first
hop, so existing invocations keep working. `dev-review`'s deprecated `--next` no-op was removed
rather than redefined. `dev-runall` adopted the flag to chain each task to terminal status with the
wrap hop run **once for the batch**.

**Why.** `--next` carried four incompatible meanings across seven commands for an entire release
while the parity gate (task 0397) stayed green — it asserted flag-presence parity only, never that
a flag meant the same thing across commands. The redefinition makes the router the single owner of
chain progression and the glossary the single source of flag meaning; per-command "what comes after
me" logic (the defect, duplicated seven times) is now forbidden. The hop bound (8) prevents routing
cycles from looping forever under propagation.

This ADR composes with ADR-038 (same-change parity enforcement): ADR-038 governs the `spur` CLI
surface; this decision governs the slash-command flag surface and adds the semantic-anchoring
dimension ADR-038's presence-parity could not enforce.

**Detail:** `plugins/sp/skills/spur-dev/references/flag-glossary.md` § Flag glossary + § `--next`
chain contract; `plugins/sp/skills/next-router/SKILL.md` (chain progression + hop bound);
`plugins/sp/skills/next-router/references/routing-table.md` §5 (chain semantics); feature `H8`
(`docs/features/H8_sp-command-surface-coherence-…md`).

## ADR-040: A Status-Required Section May Not Be Placeholder-Only — Placeholder Is an Unfilled Obligation, Not "Nothing to Validate"

**Status:** Accepted · **Date:** 2026-08-01

**Decision.** `spur task check` gains `L3.required-section-placeholder`, an **error** raised when a
section the section-matrix declares *required at the task's current status* still contains only the
shipped scaffold (empty, HTML-comment-only, or `> TBD`). It covers `Testing` and `Solution`, which
had no such rule; `Requirements` and `Acceptance Criteria` already had equivalents
(`L3.requirements-empty`, `L3.ac-empty`).

The rule is **matrix-keyed, not status-hardcoded**: it consults `entry.required` for the current
status rather than naming `done`, so it stays silent where a placeholder is legitimate (`todo`,
`wip`) and follows the matrix if the requirement set changes.

Severity is error because `testing → done` is gated by `spur task check --strict-core`: this blocks
the transition until the section is filled, rather than surfacing the gap months later. The message
names the remedy — `spur task record <wbs>`, which fills `Testing` from the verdict artifact.

**Why.** `Testing` and `Solution` are normally written by the pipeline's `record` step
(`spur task record`), which renders them from `.spur/run/<wbs>-verdict.json`. Drive a task **inline**
instead of through `task-pipeline.yaml` — now the common case, since `agent.run` fails under a
restricted sandbox — and `record` never runs.

Nothing caught the result, because every other L3 `Testing` rule is guarded by
`!isPlaceholderBody(...)`. That guard is right at `todo`/`wip`, where an empty section is the normal
state, but it left a hole at the far end: a task could reach `done` carrying the verbatim
`<!-- Filled during verification: … -->` scaffold and *every* Testing rule would decline to inspect
it. Feature H8's four tasks (0399/0401/0403/0404) did exactly that, and `spur task check` passed all
four. A corpus scan found the pattern in **25 of 388** `done` tasks (6.4%).

**Blast radius and why error is safe.** All 25 pre-existing instances live in `docs/tasks` and
`docs/tasks2` — historical corpora; the active `docs/tasks3` is at zero. No gate runs `task check`
corpus-wide (`bun run spur-check` is lint + tests), so the new error fires only when someone checks
one of those tasks directly, or on a *new* done transition. Historical records stay readable while
the path forward is closed. They were deliberately **not** backfilled: most predate the
verdict-artifact flow, so there is no artifact to `record` from and filling them would mean
inventing evidence.

**Detail:** `packages/app/src/services/task-check.ts` (rule, adjacent to the `Testing` coverage
check); `packages/config/src/finding-codes.ts` (`L3_REQUIRED_SECTION_PLACEHOLDER`);
`packages/app/src/services/task-record.ts` (`renderTesting` / `renderReview` — what `record` writes);
`.spur/tasks/section-matrix.yaml` (`done: required: [Solution, Testing, Review]`).
