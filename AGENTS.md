# AGENTS.md

Entry point for AI coding agents. `CLAUDE.md` and `GEMINI.md` symlink here.

**Read first every session.** Lean: harness routing + this monorepo’s facts + where depth lives.
Does **not** restate skill runbooks or the full `spur` / `superskill` verb catalogs.

Portable harness sections (any Spur-managed project) are the pattern in
`config/templates/AGENTS.md` (seeded by `spur init`). **This file is the Spur monorepo instance** —
self-contained for agents; keep portable wording aligned with that template when the contract changes.

---

## Project

**Spur** — local-first harness toolkit for mainstream coding agents (Claude Code, Codex, Gemini CLI,
pi, omp, OpenCode, Antigravity, OpenClaw, Hermes, Grok). Not a coding agent and not a BYOK LLM
platform: it wraps agents you already run, adding discipline, constraints, workflows, history
analytics, and ops visibility.

**This monorepo is Spur.** Develop it with the complementary first-class harness pair: `spur` CLI +
`/sp:dev-*` commands + `sp:*` subagents/skills for project lifecycle, constraints, and docs hygiene;
`superskill` for cross-agent plugin installation and capability authoring/quality lifecycle.

---

## Harness-first contract

Default: all product work goes through the harness unless the operator explicitly overrides.

### Harness tool routing

Agents need not know “plugin packing.” Use these **entry surfaces**:

| Need                                                   | Route to                                                            | Avoid                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------- |
| Plan a feature (intake → AC → tasks)                   | `/sp:dev-plan`, `/sp:dev-idea`                                      | Freeform feature files without gates     |
| Drive one task end-to-end                              | `/sp:dev-run <wbs>` or **`sp:super-planner`**                      | Implement with no task / no pipeline     |
| Batch or parallel task runs                            | `/sp:dev-runall`, `/sp:dev-parallel` → **`sp:super-planner`**        | Unordered multi-task thrash              |
| Batch-refine tasks under a feature                     | `/sp:dev-refineall --feature <id> --auto`                           | Hand-looping `/sp:dev-refine` per WBS    |
| Multi-step corpus CLI (tasks/features/rules/workflows) | **`sp:expert-spur`**                                                | Raw Write/Edit on corpus files           |
| Look up `spur` verbs / flags / `--json`                | Skill **`sp:spur-cli`**                                             | Inventing flags from memory              |
| Create/edit/list tasks or features                     | **`spur task` / `spur feature`** (`--section --from-file`)          | Direct-writing task/feature corpus files |
| Verify requirements / AC                               | `/sp:dev-verify`                                                    | Self-reported “done”                     |
| Review (SECUA + traceability + architecture)           | `/sp:dev-review` or **`sp:super-reviewer`**                         | Unstructured “LGTM”                      |
| Tests / coverage                                       | `/sp:dev-unit`                                                      | Untested production paths as done        |
| Constraint gate / rule authoring                       | **`spur rule`**; `/sp:rule-scan`, `/sp:rule-add`, `/sp:rule-refine` | Skipping `spur rule run`                 |
| Workflow author / run                                  | **`spur workflow`**; `/sp:workflow-add`, `/sp:workflow-refine`      | Ad-hoc shell as the lifecycle            |
| Docs drift / sync / lessons                            | Skill **`sp:doc-evolve`** + `docs/99_PROJECT_CONSTITUTION.md`       | Patching derived docs over authority     |
| Wrap completed work                                    | `/sp:dev-wrap`, `/sp:dev-wrapall`                                   | Skipping learnings / doc sync            |
| Session index / memory                                 | Skill **`sp:indexed-context`** + `.spur/context/`                   | Full-tree re-reads every turn            |
| Install / sync a plugin across coding agents           | **`superskill install <plugin>`**                                   | Hand-copying per-platform adapters       |
| Capability authoring / quality lifecycle               | **`superskill <noun> --help`** (`agent`, `skill`, `command`, `hook`, `magent`) | Bypassing the noun's validation / evaluation gates |

**Non-negotiable (unless operator overrides):**

1. **CLI-gated corpus writes** — `spur task update` / `spur feature update` (etc.). Never direct-write
   task/feature corpus files (hooks enforce).
2. **Gates before done** — `spur task check` / `spur feature check` / `spur rule run`; pipeline done
   needs a real verify **PASS**.
3. **`--json` for machines** — parse CLI with `--json`.
4. **Route, don’t invent** — execute high-frequency verbs directly from **`sp:spur-cli`** reference files (`references/{tasks,features,rules,workflows}.md`); use `spur <noun> --help` only as a last resort for unlisted long-tail nouns or version skew. Lifecycle → `/sp:dev-*` / `sp:super-planner`; multi-noun corpus → `sp:expert-spur`; review → `sp:super-reviewer`; docs process → `sp:doc-evolve`.
5. **Keep tool ownership explicit** — project lifecycle/corpus/gates → Spur; plugin installation and
   capability lifecycle → Superskill. Do not hand-maintain per-platform adapters Superskill generates.

**Platform fallback:** Platforms without slash commands and/or subagents still use the harness.
Install the plugin through Superskill for the target platform, then use skills `sp:spur-dev`,
`sp:spur-cli`, `sp:code-verification` (and related) plus the `spur` CLI. Do not invent a parallel
process because `/sp:dev-*` is unavailable.

Invoke CLI: `spur …` on PATH, or in this monorepo `bun run apps/cli/src/index.ts …`.

---

## Documentation

**Process SSOT:** `docs/99_PROJECT_CONSTITUTION.md`. Operate with **`sp:doc-evolve`**
(`drift-audit`, `sync-check`, `contract-verify`, `lesson-append`).

**Conflict rule:** lower number wins on content (`00` decisions, `01` scope, `99` process). Fix
authority first, then derived docs, then this file.

### Doc map (constitution §4.1 / §4.4)

| Doc                               | Owns                            | Authority                | When                                            |
| --------------------------------- | ------------------------------- | ------------------------ | ----------------------------------------------- |
| `docs/00_ADR.md`                  | **WHY**                         | Authoritative (content)  | Structural change; dated entry before diverging |
| `docs/01_PRD.md`                  | **WHAT**                        | Authoritative on scope   | New feature/command                             |
| `docs/02_ROADMAP.md`              | **WHEN**                        | Derived                  | Phase placement                                 |
| `docs/03_ARCHITECTURE.md`         | **HOW**                         | Derived (ADR wins)       | Cross-module / seam / schema                    |
| `docs/04_DESIGN.md`               | **SURFACE** (+ `docs/design/`)  | Derived                  | Same commit as surface code (T3)                |
| `docs/05_FEATURES.md`             | **STATUS** (+ `docs/features/`) | Derived                  | Feature status (T4)                             |
| `docs/99_PROJECT_CONSTITUTION.md` | **PROCESS**                     | Authoritative on process | Before editing numbered docs                    |
| `AGENTS.md` (this file)           | **ENTRY**                       | Derived                  | First every session                             |

**Routing:** decision → `00`; scope → `01`; mechanism → `03`; surface → `04`; phase → `02`;
feature status → `05`. Working layers §4.2; audits §7; satellites §4.5.

---

## Design system

**Conditional contract:** If repository-root `DESIGN.md` exists, read it before planning or
implementing any change to UI, styling, interaction, accessibility, or responsive behavior. Treat
it as the project source of truth for visual and interaction design — tokens, components, patterns,
and UX constraints — and keep affected work consistent with it. If it is absent, continue with the
project's established UI conventions.

Root `DESIGN.md` owns UI/UX guidance; `docs/04_DESIGN.md` still owns command, config, schema, and DTO
surface shapes under the doc map above.

---

## Stack & layout

Bun + TypeScript + Biome monorepo (**Bun workspaces, no Turborepo**):

```
apps/
  cli/          # Spur CLI — commander dispatch (ADR-014)
  server/       # Hono / Cloudflare Worker; oRPC OpenAPI
  web/          # Astro + Cloudflare; typed oRPC client
packages/
  app/          # Application services
  contracts/    # oRPC transport DTOs only
  config/       # zod config + env
  domain/       # DAOs / schema / analytics (sole ts-db consumer)
plugins/
  sp/           # Harness packaging (commands, subagents, skills) — use entry surfaces above
tooling/typescript/
drizzle/        # active CLI migrations + _legacy_reference/ (inert)
docs/           # 00–05 + 99 + plans/features/design
```

Apps are thin transports; logic lives in `packages/app` (ADR-021).

Domain engines are external `@gobing-ai/ts-*` from `~/xprojects/ts-libs/`:

| Package                              | Role                                                |
| ------------------------------------ | --------------------------------------------------- |
| `@gobing-ai/ts-utils`                | output, errors, api-response, cursor, date, access  |
| `@gobing-ai/ts-infra`                | logger, EventBus, telemetry, scheduler, job-queue   |
| `@gobing-ai/ts-runtime`              | runtime context, FS, ProcessExecutor, config loader |
| `@gobing-ai/ts-db`                   | DbAdapter, BaseDao, migrations, QueueJobDao         |
| `@gobing-ai/ts-ai-runner`            | doctor / AiRunner (`spur agent`)                    |
| `@gobing-ai/ts-rule-engine`          | RuleEngine (`spur rule`)                            |
| `@gobing-ai/ts-dual-workflow-engine` | FSM + transition-flow (`spur workflow`)             |
| `@gobing-ai/ts-llm-jsonl-importer`   | history import (`spur history`)                     |

- **Runtime:** Bun `1.3.14` — prefer `bun:*` over `node:*`.
- **Lint/format:** Biome `2.4.16` — no ESLint/Prettier.
- **Seam / HTTP / Web / DB:** oRPC `1.14.x`, Hono, Astro, SQLite via ts-db.
- **Pins:** `.prototools` (proto). **Hooks:** Lefthook.

No new runtime, package manager, linter, formatter, or Turborepo.

> **Deps:** released `@gobing-ai/ts-*` by semver; temporary `bun link` only while validating unreleased
> fixes. Shared multi-workspace deps: root `workspaces.catalog` + `"catalog:"` only. Prefer fixing
> ts-libs facades over Spur workarounds.

---

## Code style (`biome.json`)

- 4-space indent, `lineWidth` 120; single quotes; semicolons; trailing commas.
- `interface` for objects; `type` for unions/intersections.
- Imports auto-sorted by Biome.
- `any` is an error; justify with `// biome-ignore` only when unavoidable.
- Imports: `@gobing-ai/*` — never deep relative paths into sibling packages.

---

## Build & repo commands

Monorepo scripts (not product verbs):

```bash
bun run lint       # biome + per-workspace tsc --noEmit
bun run format     # biome --write
bun run test       # bun test --coverage (all workspaces)
bun run test-cf    # Cloudflare Workers Vitest against the real Worker entry
bunx wrangler deploy --dry-run --config apps/server/wrangler.toml  # Worker bundle + dist/web asset-path gate
bun run clean && bun run build
bun run check      # lint + test
bun run dev        # all workspace dev
```

### Local `spur` CLI on PATH (dev)

Published npm `spur` can lag this monorepo (missing new verbs like `task run-link`). While developing
Spur itself, point PATH at the monorepo CLI:

```bash
# from repo root
cd apps/cli && bun link                  # registers @gobing-ai/spur
bun run --filter @gobing-ai/spur build:bundle   # rebuild apps/cli/spur.js after CLI source changes
spur task run-link --help                # smoke: new verbs must appear
```

If `spur task …` still looks stale: confirm `which spur` resolves under the linked package, re-run
`build:bundle`, or fall back to `bun run apps/cli/src/index.ts …` for the current tree.

---

## Spur CLI surface

**Not the verb catalog.** `task` / `feature` / `rule` / `workflow` → **`sp:spur-cli`**. Lifecycle →
`/sp:dev-*` / **`sp:super-planner`**. Multi-noun corpus campaigns → **`sp:expert-spur`**.

```bash
spur <noun> <verb> … --json
bun run apps/cli/src/index.ts <noun> <verb> … --json   # monorepo dev
spur <noun> --help
```

| Noun       | Purpose                           |
| ---------- | --------------------------------- |
| `init`     | Scaffold a Spur project           |
| `agent`    | Run / list / doctor / agent specs |
| `history`  | Import / analyze agent history    |
| `rule`     | Constraints → **`sp:spur-cli`**   |
| `workflow` | Engine + run progress/follow → **`sp:spur-cli`** |
| `message`  | Inter-agent messages              |
| `team`     | Assign / start / stop / status    |
| `task`     | Task corpus → **`sp:spur-cli`**   |
| `feature`  | Feature tree → **`sp:spur-cli`**  |
| `status`   | Project / Git status              |
| `migrate`  | CLI schema migrations             |
| `serve`    | Local web server                  |

**Long-tail:** Additional `/sp:dev-*` commands (handover, gitmsg, fixall, dogfood, reverse, arch,
…) are indexed in `plugins/sp/README.md`.

**Outside spur-cli:** Nouns not fully documented in `sp:spur-cli` (`agent`, `history`, `message`,
`team`, `status`, `migrate`, `serve`, `init`, …) — use only `spur <noun> --help` and
`docs/04_DESIGN.md`. Never guess flags.

Full shapes: `docs/04_DESIGN.md` (T3 same-commit). Planning depth: ADR-020–023 / ADR-028,
`docs/03_ARCHITECTURE.md §12`, `docs/05_FEATURES.md §9`. Board: web Task Kanban (not `kanban.md`).

---

## Superskill CLI surface

**Ownership boundary:** Superskill is the install-time portability and capability-quality plane;
Spur remains the project lifecycle and deterministic corpus/ops plane.

```bash
superskill install <plugin> --dry-run
superskill install <plugin> --targets <list>
superskill <agent|skill|command|hook|magent> --help
```

Use `superskill <noun> --help` for the current lifecycle verbs and flags. Do not duplicate its full
catalog here or maintain generated per-platform capability copies in the project.

---

## Verification gate

Before “done”:

1. `bun run autofix && bun run spur-check` comprehensive quality gate
2. `bun run lint` clean
3. `bun run test` green (workspaces + `plugins/sp`; no skipped tests to pass)
4. `bun run test-cf` green
5. `bun run build` green
6. `git status` intentional only

Never `--no-verify` / silent `biome-ignore` to force green. Harness task done ⇒ real verify **PASS**
when the task used the pipeline.

---

## Testing

- Location: `<workspace>/tests/**/*.test.ts` (`bun:test`); `plugins/sp` chained in root `test`.
- Coverage: per-file line/function ≥ 90% aggregate (`bunfig.toml`); React `.tsx` excluded from
  per-file gate (happy-dom).
- DAOs: in-memory SQLite (`:memory:`), fresh adapter per test.
- Names describe behavior under conditions; assert the requirement, not the implementation.
- Extension path: `/sp:dev-unit`; evidence path: `/sp:dev-verify`.

---

## oRPC

- Contracts: `packages/contracts/src` only (transport DTOs).
- Server: `implement(contract)` — compile-time contract↔handler.
- OpenAPI from contract generators — never hand-maintained specs.
- Clients consume contract types via `OpenAPILink` only.
- Domain types stay in owning `@gobing-ai/ts-*` packages, never in contracts.

---

## Database / migrations

- Schema SQL owned per domain package; `packages/domain/src/migrations.ts` → `CLI_SCHEMA_SQL`
  (+ history / workflow engine SQL + `_spur_cli_` increments).
- Migrator: top-level `drizzle/*.sql` with `_spur_cli_` marker only.
- History: raw in files; DB holds ETL rows, import ledger, checkpoints.
- `drizzle/_legacy_reference/` inert — never activate.

---

## Conventions & boundaries

- Conventional Commits; `BREAKING CHANGE:` footer when needed.
- Cross-workspace: `@gobing-ai/<pkg>` only.
- `vendors/` and `drizzle/_legacy_reference/` — never modify.
- No secrets / `.env*` in git; agent API keys are the agent’s concern.
- Observability persistence/wire projections receive configured secret values at composition roots
  and redact recursively before payload bounds.
- No `.github/workflows/` edits without approval.
- Surgical diffs only.
- Surface code + `docs/04_DESIGN.md` same commit (T3); use `sp:doc-evolve` sync-check.

---

## Indexed context

`.spur/context/` (gitignored) via **`sp:indexed-context`**:

1. `anatomy.md` — file one-liners + token estimates
2. `learnings.md` — conventions / decisions
3. `pitfalls.md` — do-not-repeat
4. `buglog.md` — bugs
5. `memory.md` — session log
6. `token-ledger.jsonl` — auto; never hand-edit

Absent context dir: continue; do not block.
