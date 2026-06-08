# 00 ADR — Spur

**Status:** Authoritative · **Last Updated:** 2026-06-06 · **Owner:** Robin Min

The single source of truth for Spur's cross-cutting **decisions**. Each `ADR-NNN` records *what was
decided* and *the one-line reason* — the mechanism, rationale-in-depth, and consequences live in
`03_ARCHITECTURE.md` (or concrete shapes in `04_DESIGN.md`), reached via the `Detail:` pointer.

Rules: entries are append-only and never renumbered (cross-references depend on the number). When
another doc conflicts with an entry here, this file wins — flag the drift. Supersede a decision with
a new dated entry that names the one it replaces. There is no `06_DECISIONS.md`.

---

## ADR-001: Greenfield Re-Foundation

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Re-found Spur as a clean Bun-workspace monorepo scaffolded from `ts-base` conventions,
rather than extracting the debt-laden `@spur/*` tree from the original starter. No `@spur/*` scope
exists here; apps depend only on `@gobing-ai/ts-*` packages plus two thin local packages
(`contracts`, `config`).

**Why.** Extracting the old code as-is would carry its accumulated debt forward.

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