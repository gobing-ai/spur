---
doc: 00_ADR
owns: WHY — cross-cutting decisions, one-line reasons
authority: authoritative
version: 1.0.0
owner: Robin Min
updated_at: 2026-06-12
read_before: any structural change; before diverging from a decision
edit_rules: 99 §6.1
sync: [T1, T2]
---

# 00 ADR — Spur

The single source of truth for Spur's cross-cutting **decisions**. Each `ADR-NNN` records *what was
decided* and *the one-line reason*; mechanism and consequences live in `03`/`04` via the `Detail:`
pointer. Entry format and maintenance rules: `99 §6.1` (append-only; dated amendments and
superseding entries only; gaps stubbed, never reused; the template binds new entries — historical
entries are not restructured). There is no `06_DECISIONS.md`.

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

**Decision.** Repo-root `./config/{rules,workflows,plugins}` is the **single source of truth** for all
Spur default config files, separating config assets from source code. The build copies `./config` into
`apps/cli/dist/config` and ships it via the package `files` array; runtime resolves bundled defaults
from `dist/config`, lazily seeds them into `~/.config/spur/` on first `spur init` (never overwriting),
and `spur init` scaffolds a project's `.spur/` from that seeded layer. The three-layer resolution model
(`bundled` > global `~/.config/spur` > local `.spur`) is unchanged; **no symlinks** participate in the
install or init flow.

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
`dist/config`; it relies on the `~/.config/spur` seed. The published global install
(`bun install -g`, runs `dist/index.js`) reads `dist/config` directly, so this is the primary path.

**Detail:** asset layout, init flow, and preset vocabulary in `04 §2.3 Default config assets` and
`04 §1.1` (`spur init`, `spur rule run`); cross-repo cleanup sequenced so ts-libs preset deletion lands
only after Spur's centralization is green. Trust-ladder `bundled` plugins (ADR-012) gain their home at
`./config/plugins`.

---

## ADR-016: Slash Commands Only Where the LLM Adds Value Over the CLI

**Status:** Accepted · **Date:** 2026-06-07

**Decision.** A Spur slash command (`plugins/*/commands/*.md`) is justified **only** when it converts
**non-deterministic intent into a reliable sequence** the CLI cannot express as one verb. Do **not**
add a command that merely forwards flags to an existing deterministic CLI verb — the CLI is the robust
interface, and an equivalent wrapper adds a translation layer, a drift surface, and no value. The
decision test, applied per candidate:

| Candidate | Verdict |
|-----------|---------|
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

**Status:** Accepted (design) · **Date:** 2026-06-11

**Decision.** Task and feature status lifecycles are workflow definitions executed through
`spur workflow` (`@gobing-ai/ts-dual-workflow-engine`) — not a hand-rolled FSM or transition table
inside the task domain. Lifecycle definitions are YAML under `./config/workflows` (ADR-015 home);
gates (e.g. `spur task check` before Testing) are workflow guards; customization rides the
engine's EventBus pub/sub seam (`on_transition` / `on_guard_fail` / `on_complete`) — balancing
state mutation against maximal reuse of existing engine functionality. The planning layer is
thereby the engine's **first demanding first-party consumer**: capability gaps (long-lived,
externally-triggered lifecycles; pause/continue; HITL approval) are closed **upstream** per the
shared-library evolution rule, never by re-implementing locally. One invariant: the markdown
file's frontmatter `status` remains the single source of truth; engine persistence is derived and
rehydratable from the files (no second authority).

**Why.** Building a lifecycle engine beside an owned workflow engine would duplicate the exact
capability the engine exists to provide — and being its first user is what pushes it to mature.

**Detail:** `03 §12.2–12.3`; upstream gaps tracked as ts-libs tasks before the dependent waves.

**Addendum (2026-06-15): Pipeline-pause integration deferred.** The `task-pipeline.yaml` approve
gate uses `hitl.confirm` (interactive), not `pause: true`. The workspace schema
(`apps/cli/schemas/state-machine-workflow.schema.json:38`) already supports `pause: true`, and
`spur workflow continue` + `WorkflowService.continuePaused` are shipped and tested (task 0063). The
blocker is that a user's **globally installed** `@gobing-ai/spur` may be a stale version whose
bundled schema lacks `pause` — adding `pause: true` to the shipped `task-pipeline.yaml` now would
make `spur workflow validate` fail for those users. **Trigger to flip:** when the global
`@gobing-ai/spur` package is refreshed to ship the `pause`-aware schema, change the `approve` state
to `pause: true` and re-point the pipeline's HITL gate at `spur workflow continue`. Until then,
the working `hitl.confirm` gate stays in place. Task 0071 R4 tracks this.

## ADR-023: rd3 Migration — Dividing Line, Fat Skills, Design Collectively / Implement in Phases

**Status:** Accepted · **Date:** 2026-06-11

**Decision.** Three rules govern the migration.
**(1) Dividing line:** code that executes, validates, stores, or coordinates moves into Spur
(`apps/`, `packages/`, ts-libs). Already replaced — never migrate: `rd3:orchestration-v2`,
`rd3:verification-chain`, `rd3:run-acp` (→ `spur agent run` is the single LLM execution surface).
**(2) Fat Skills, thin others:** agent-facing behavior centralizes in `plugins/sp` **skills**,
which are the SSOT and may be arbitrarily rich — slash commands and subagents are thin wrappers
*of skills* (extending ADR-016). Rationale: every supported coding agent understands skills, while
command/subagent support varies — cross-agent portability forces centralization there. Skills
delegate deterministic execution to CLI verbs where they exist, but are **not** limited to CLI
wrapping.
**(3) Working model:** all work — architecture adjustments and features, listed or not — is
planned and **designed collectively first**, then **implemented in phases**. This supersedes the
2026-06-10 "minimal structural change only" premise: the evidence review already demands redesign
(schema, templates, write path, lifecycle), so porting first and re-foundationing later would pay
the migration cost twice. Deferral of the meta-tooling/research/context groups stands — they stay
live in cc-agents until the core stabilizes, so deferring them breaks nothing.

**Why.** The dividing line keeps scope refutable item-by-item; Fat Skills keeps one SSOT across
seven agents; collective design prevents mechanically porting models the data already rejected.

**Detail:** triage in `docs/plans/2026-06-10-rd3-migration-feature-list.md`; phase placement in
`02 §Phase 1.5`.

## ADR-024: Anti-Hallucination Guard Engine Leaves Spur; Spur Adds `response.validate` Action and Answer Capture

**Date:** 2026-06-18.

**Decision.** The anti-hallucination guard engine (verification protocol, source-citation checks, confidence-level enforcement) is owned by the `superskill` repo (task 0041), not Spur. Spur provides two workflow primitives that 0041's re-developed launchers consume: (1) `AgentService.runCapture` — an opt-in capture path that returns `{ exitCode, answer }` without streaming or diagnostics; (2) `response.validate` — a workflow action that accepts a `ResponseValidateEngine` via constructor DI (same pattern as `rule.check`) and maps `{ ok, reason, issues }` to `ActionResult`. The engine is injected in `builtins.ts` via `SpurWorkflowBuiltinsOptions.responseValidateEngine`; the concrete engine is provided by the externally-installed `cc:anti-hallucination` skill (superskill 0041) and wired by the caller via a thin adapter over its published surface.

**Amendment (2026-06-20).** The migration to superskill is complete: the in-repo copy `plugins/sp/skills/anti-hallucination/` has been **removed** from Spur. The skill is now `cc:anti-hallucination`, owned and installed externally. The `ResponseValidateEngine` seam in `builtins.ts` is unchanged (DI-only; the concrete wiring was always deferred to 0041 — never an in-repo import), so removal is non-breaking. References that previously pointed at `plugins/sp/skills/anti-hallucination/scripts/ah_guard.ts` now point at the installed `cc:anti-hallucination` skill.

**Why.** The guard protocol is agentic answer-verification, not a dev-workflow — it belongs in superskill by charter. Spur's role is to provide the workflow primitives (capture + validate action) that the superskill workflow YAML assembles. This keeps the boundary explicit: Spur owns the harness plumbing, superskill owns the verification logic.

**Detail:** `agent.run` action gains a `capture: true` option that switches to `runCapture` and surfaces `data.answer`. The `response.validate` action reads `text` from options (templated from prior step data, e.g. `{{ steps.generate.answer }}`). A transition-flow spike (`packages/app/tests/fixtures/anti-hallucination-spike.yaml`) confirms the engine can express validate → retry → deny with `iterationBound` as the backstop; a proper retry-count guard is future work (R3.1).

---

## ADR-025: Web Interaction Libraries — dnd-kit for DnD, @uiw/react-md-editor for Markdown Editing

**Date:** 2026-06-22.

**Decision.** Adopt `@dnd-kit/core` + `@dnd-kit/sortable` as the drag-and-drop library and
`@uiw/react-md-editor` as the markdown editor for the Spur web task-kanban board, both
as apps/web-only package-private literals. Retain the Astro-island shell for the board.

**Why.**
(a) **Astro-island shell retained** — the current Astro + React Island architecture (ADR-002, ADR-005)
is stable and fit for purpose; no framework migration is warranted.
(b) **dnd-kit over @hello-pangea/dnd** — dnd-kit is the actively-maintained successor, is lighter, has
first-class keyboard/accessibility sensors (`KeyboardSensor`, `PointerSensor`), and renders cleanly
inside React islands without the `@hello-pangea/dnd` style-wrapper constraints. The HTML5 native DnD
currently on the board lacks animation primitives, drop-zone feedback, and overlay support — the exact
gaps that task 0096 (DnD polish) must close (gap-analysis §2: Drag & Drop = Medium).
(c) **@uiw/react-md-editor for markdown editing** — the legacy board used this editor for inline task
body editing (live/preview modes with Save/Cancel). The migrated board hides the task body entirely
(gap-analysis §2: Inline Editing = High). Tasks 0091 (inline editing) and 0093 (new-task panel) depend
on this editor being present. A heavier full WYSIWYG is overkill for task-body markdown.

**Cross-link:** `docs/analysis/task-kanban-gap-analysis.md` §1 (Technical Stack) and §3.1 (Wave 0).

**Right-panel collapse bug (R5 triage).** The legacy breakdown referenced a right-panel collapse bug.
Tested against the current board: collapse/expand toggle, resize persistence (`localStorage`),
and restore-on-mount all pass (`apps/web/tests/components/BoardLayout.test.tsx`). Gap-analysis §2
rates Task Detail Layout parity as **None** — the legacy fixed-modal overlay was replaced by the
native resizable 3-column layout, which has no reproducible collapse defect. No fix is scheduled.

**Detail:** Dependency versions in `apps/web/package.json`; version-SSOT rule per `AGENTS.md`:
these are apps/web-only → package-private literals; promote to root `workspaces.catalog` only if a
sibling workspace later needs them.

**Consequence — single UI import seam (enforcement mechanism, not a new decision).** Because these
libraries are apps/web-only, their imports are confined to a single seam: `apps/web/src/ui.ts`
re-exports them (and the daisyUI component-class authoring is confined to `apps/web/src/components/ui/`).
This boundary is enforced by the `config/rules/ui/` preset (tasks 0103 author@warning, 0104
promote→error + wire into `recommended-pre-check`): `ui-import-seam-only` forbids raw UI-lib imports
outside `ui.ts`; `no-daisyui-class-leak` forbids daisyUI component classes outside `components/ui/`.
Mechanism detail: `docs/05_FEATURES.md §4`.

---

## ADR-026: Verification Is a Companion Skill; the Pipeline Completion Gate Is a Workflow Guard

**Date:** 2026-06-23.

**Decision.** (a) Verify/review logic lives in a `sp:code-verification` companion skill (not the
`sp:spur-dev` umbrella), backing `/sp:dev-verify` and `/sp:dev-review`. (b) The pipeline gates
`verify → record` on a shell guard reading `.spur/run/<wbs>-verdict.json`: `verdict: PASS` clears to
`done`, any non-PASS routes to `failed`. (c) The `implement` step calls `/sp:dev-run --mode implement`, never
`/sp:dev-run` (which *drives* the pipeline).

**Why.** (a) Verification is a distinct concern from planning — keep it out of the fat skill (mirrors
rd3 `task-runner`↔`code-verification`). (b) `spur task check` validates section *presence*, not
content, so a FAIL must block `done` via an explicit verdict artifact — the spur-native replacement
for rd3's `--postflight-verify`. (c) The loop is `task-pipeline.yaml`, not a ported `task-runner`
(ADR-022); `implement` calling `/sp:dev-run` recursed, letting agents skip test/review/verify.
Trigger: dogfood finding, task 0105 — the `sp` migration ported the command shells but dropped the
backing skills.

**Relates:** extends ADR-022, ADR-023. Resolves SECU-backronym drift to rd3-canonical
S/E/C/U (was "Security/Error-handling/Conventions/Untested-paths" in `dev-review.md`).

**Detail:** `03`/`04_DESIGN.md §7.5`; verdict shape in
`plugins/sp/skills/code-verification/references/verdict-schema.md`; status in `05_FEATURES.md §9`.

**Amendment (2026-06-23) — done-gate + section-ownership (task 0106).** The `record → done`
transition gate mirrors the `verify → record` verdict gate: a shell guard asserting `spur task check`
(exit 0) with a `record → failed` sibling on negation — so `done` is certified only when the
section-status matrix passes. Every `done`-required section ([Solution, Testing, Review]) is owned by
a single pipeline step that has the knowledge to write it: implement owns `Solution` (change-map),
record transcribes `Testing`/`Review` from the verify output. Section writes are idempotent (upsert)
with a `sectionIsBare` detection predicate (absent, empty/whitespace, placeholder). A bare `Solution`
is safety-net-backfilled from `git diff`. Trigger: dogfood finding, task 0106 — task 0101 reached
`done` while FAILING its own `spur task check`. Relates: extends ADR-026; matches the verify→record
guard pattern exactly.

## ADR-027: Config Loading Is `spur-config`-Owned; Core/Loader Package Split; Legacy `docs/.tasks/config.jsonc` Retired

**Date:** 2026-06-26.

**Decision.** `.spur/config.yaml` has one loader: `loadSpurConfig` in `@gobing-ai/spur-config`. (a)
The package splits into two entry points — a dependency-free **core** (`.`: schemas, `DEFAULT_TASKS_DIR`/
`DEFAULT_FEATURES_DIR`, all config types) and a node-only **loader** (`./loader`: `loadSpurConfig`,
`resolveConfigFile`, `resolvePlanningFolders`, embedded-schema resolution). (b) The merged
`spurConfigSchema` owns every section (`tasks`, `features`, `agent`, `rules`, `workflows`,
`redaction`) — the former CLI-local `SpurAppConfigSchema` is folded in. (c) Config shape types have a
single owner: `TaskFoldersConfig`/`TaskFolderEntry` live in the loader; consumers re-export, never
redefine. (d) The legacy rd3 `docs/.tasks/config.jsonc` read is removed; the server `task.folders`
endpoint derives from `ctx.planningFolders()`.

**Why.** `packages/config` shipped schemas but no loader, so each surface rolled its own (five
parallel paths: CLI `loadStructuredConfig`, app raw-yaml `resolvePlanningFolders`, CLI
`resolveConfigFile`, server inline literals, server JSONC read) — the drift behind the
phase-folder bugs. The core/loader split is forced by the Cloudflare Workers bundle: importing
`yaml`/`node:fs` crashes miniflare, so the server imports only the dependency-free core; that
replaces the prior "inline the literals" hack with a real boundary. Blank/`null` folder values
coerce to defaults (a broken config degrades, never wedges loading). Trigger: task 0129.

**Relates:** completes ADR-015 (config Spur-owned at `./config`) and ADR-017 (bootstrap on
ts-infra). Recurrence guarded by `config/rules/boundary/config-loading-ownership.yaml` (deferred to
task 0129's remaining slice).

**Detail:** loader shape + config keys in `04_DESIGN.md §2`; `spur-config` module boundary in
`03_ARCHITECTURE.md`.

## ADR-028: `plugins/sp` Skills Decompose by Function, Not into a Monolith; Thin Spine Dispatches Competencies

**Status:** Accepted · **Date:** 2026-06-30.

**Decision.** ADR-023 rule (2) ("Fat Skills, thin others") is **refined, not reversed**: skills remain
the cross-agent SSOT and commands/subagents remain thin wrappers of skills — but a skill's *internal
granularity* is decided by **function**, not by collapsing the whole lifecycle into one umbrella.
`sp:spur-dev` grew into an all-in-one skill owning design, implementation, testing, decomposition, and
review under one trigger; this ADR commits to decomposing it along the **functional axis** into deep
competency skills behind a thin orchestration spine. Specifically:

**(a) Competency skills (deep, functional, independently triggerable):** `sys-architecture`
(system-design / ADR judgment), `code-implementation` (implement + stack patterns), `code-testing`
(coverage / gap analysis / extension), `code-verification` (review/verify — already split, kept),
`spec-decomposition` (feature/spec → task batch). `spur-tdd` stays a thin **discipline** skill
referenced by `code-implementation` and `code-testing`, not absorbed.

**(b) Thin spine.** `sp:spur-dev` shrinks to an orchestration spine that owns the lifecycle FSM, the
gates, and the section-write contract, and **binds each pipeline phase to a competency skill** in
`config/workflows/task-pipeline.yaml` (phase → skill). The spine dispatches competencies and **never
inlines** them.

**(c) CLI facade.** A single `sp:spur-cli` skill (router pattern) replaces the per-noun skills
`spur-tasks`/`spur-features`/`spur-rules`/`spur-workflows`, carrying **one reference file per `spur`
noun**; a new noun adds exactly one reference file. The facade is invocation/dispatch guidance only —
it does not absorb competency logic. One subagent `expert-spur` (loading `spur-cli`) replaces the four
per-noun expert subagents; `expert-dev` retires into `super-coder` (which gains the single-task
lifecycle role alongside batch).

**(d) Invariants.** `cross-cutting.md` stays single-SSOT (one physical copy; competencies link to it,
never copy). Skill trigger descriptions must be **mutually disjoint** so routing is unambiguous
(machine-asserted). The `/sp:dev-*` command surface stays byte-stable across the split. The shipped
`plugins/sp` plugin is **self-contained**: no skill, agent, command, reference, or doc inside it may
reference `vendors/` or the external `rd3` plugin (`~/projects/cc-agents/plugins/rd3/`) — those are
research-time evidence only, never a runtime or documentation dependency.

**Why.** The risk in the umbrella skill is **conceptual coupling under one trigger surface**, not
runtime context size (progressive disclosure already bounds that). A phase split (planning vs.
execution) was rejected: a phase boundary is *temporal*, so it relocates coupling into shallow modules
with a fat shared interface rather than reducing it. The functional axis yields deep modules with
narrow interfaces, each reused outside the pipeline. This is the decomposition the migration's own
origin (`rd3`) used — ~50 functional competency skills with a thin `orchestration-v2` spine that binds
phase → skill and never inlines — and the umbrella skill was a regression from it; `code-verification`
was already split by function, so a phase split would have introduced a second, conflicting
decomposition axis into the same plugin. The router-facade pattern (one suite router + per-topic
references) and TDD-as-standalone-discipline are corroborated by external references reviewed at design
time (`vendors/gstack`, `vendors/Superpowers`) — used as evidence only, per invariant (d).

**Supersedes:** the monolith reading of **ADR-023 (2)** — skills stay the SSOT and stay rich, but
"rich" means a coherent competency, not the whole lifecycle. Corrects the dangling "design §12.1"
citation in `spur-dev`'s SKILL.md (§12.1 governs markdown-as-SSOT, not skill granularity).

**Relates:** extends ADR-016 (commands only where the LLM adds value) and ADR-026 (verification is a
companion skill — the first functional split). Realized by task 0161 (feature H1), waved: ADR → CLI
facade + subagent cleanup → competency extraction + spine↔competency binding proof → spine shrink +
composition extraction + command re-point.

**Detail:** destination model + the spine↔competency binding in `03_ARCHITECTURE.md §12`; skill/agent
inventory in `04_DESIGN.md`; status in `05_FEATURES.md §9`.
