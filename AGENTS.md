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

| Need                                                   | Route to                                                                       | Avoid                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| Plan a feature (intake → AC → tasks)                   | `/sp:dev-plan`, `/sp:dev-idea`                                                 | Freeform feature files without gates               |
| Drive one task end-to-end                              | `/sp:dev-run <wbs>` or **`sp:super-planner`**                                  | Implement with no task / no pipeline               |
| Batch or parallel task runs                            | `/sp:dev-runall` (host sequential; **`sp:super-planner`** explicit/parallel), `/sp:dev-parallel` | Unordered multi-task thrash                        |
| Batch-refine tasks under a feature                     | `/sp:dev-refineall --feature <id> --auto`                                      | Hand-looping `/sp:dev-refine` per WBS              |
| Multi-step corpus CLI (tasks/features/rules/workflows) | **`sp:expert-spur`**                                                           | Raw Write/Edit on corpus files                     |
| Look up `spur` verbs / flags / `--json`                | Skill **`sp:spur-cli`**                                                        | Inventing flags from memory                        |
| Create/edit/list tasks or features                     | **`spur task` / `spur feature`** (`--section --from-file`)                     | Direct-writing task/feature corpus files           |
| Verify requirements / AC                               | `/sp:dev-verify`                                                               | Self-reported “done”                               |
| Review (SECUA + traceability + architecture)           | `/sp:dev-review` or **`sp:super-reviewer`**                                    | Unstructured “LGTM”                                |
| Tests / coverage                                       | `/sp:dev-unit`                                                                 | Untested production paths as done                  |
| Constraint gate / rule authoring                       | **`spur rule`**; `/sp:rule-scan`, `/sp:rule-add`, `/sp:rule-refine`            | Skipping `spur rule run`                           |
| Workflow author / run                                  | **`spur workflow`**; `/sp:workflow-add`, `/sp:workflow-refine`                 | Ad-hoc shell as the lifecycle                      |
| Docs drift / sync / lessons                            | Skill **`sp:doc-evolve`** + `docs/99_PROJECT_CONSTITUTION.md`                  | Patching derived docs over authority               |
| Wrap completed work                                    | `/sp:dev-wrap`, `/sp:dev-wrapall`                                              | Skipping learnings / doc sync                      |
| Session index / memory                                 | Skill **`sp:indexed-context`** + `.spur/context/`                              | Full-tree re-reads every turn                      |
| Install / sync a plugin across coding agents           | **`superskill install <plugin>`**                                              | Hand-copying per-platform adapters                 |
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
6. **Run dev skills inline by default** — direct model-bearing `/sp:dev-*` commands execute in the
   current coding-agent session. Interactive `/sp:dev-run --mode full` and sequential
   `/sp:dev-runall` with omit/`--agent inline` interpret `task-pipeline.yaml` in-session; `--agent
   auto`, a name, parallel/headless execution, direct `spur agent run`, and engine-driven workflow
   `agent.run` remain subprocess surfaces.

**Task lookup fast path:** Given a WBS, do not search `docs/tasks*` or guess `--folder`. Use
`spur task show <wbs> --json` for task metadata and content; its response also includes `filePath`.
Use `spur task path <wbs> --json` only when a filesystem consumer needs the absolute path. Both
commands resolve across configured task folders. Reuse the first `show` response within the run.

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

**Inter-agent coordination (ADR-057 — waves 1–2 landed; wave 3 follow helper landed):** Agents talk
only through Spur (`spur message`, `spur agent`). Occupant pin + `coordination_runs` + caller env
(`SPUR_SPEC_ID` / `SPUR_RUN_ID` / `SPUR_TEAM_ID` / `SPUR_SERVE_URL`) are shipped, as are
identity-pinned `agent wait` and atomic `message send --wait` (0530) and snapshot-then-follow
over `system_events` (`followSystemEventsAfter`, 0531). Do not scrape terminals, inject
keystrokes, or add a third IPC socket. First-class `blocked` remains accepted design. Shapes:
`docs/design/inter-agent-control-plane.md`.

---

## Design system

**Conditional contract:** If repository-root `DESIGN.md` exists, leverage it dynamically as the industry-standard SSOT for UI design documentation — visual language, color tokens, typography, component specs, layout, micro-animations, accessibility, and responsive patterns. Read it before planning or implementing any UI changes, and keep affected work consistent with it. If `DESIGN.md` is absent, ignore it and continue with the project's established UI conventions.

**Boundary distinction:** Root `DESIGN.md` owns UI/UX design guidance; `docs/04_DESIGN.md` owns non-UI surface design by default (command signatures, flags, config schemas, DTOs, and system boundaries). When working with design teams, choose `DESIGN.md` for UI/UX visual design and `docs/04_DESIGN.md` for non-UI API/schema surfaces.

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

**Workflow YAML (monorepo self-dev):** edit **`config/workflows/`** only (tracked SSOT).
Invoke shipped definitions by bare name (for example, `spur workflow run task-pipeline.yaml`): an
explicit project path wins, then the CLI falls back to bundled `config/workflows/`. There is no
project workflow seed or symlink. **Do not** hand-`cp` into `apps/cli/config/` (gitignored
`build:bundle` artifact). Refresh that package tree only with `build:bundle` / `bundle-config` when
testing the published layout. Details: `docs/04_DESIGN.md` §2.3 monorepo path model.

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
bun run test       # bun test (all workspaces; coverage via bun run test:coverage)
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

**Real-data history validation must use a source-local binary (task 0504 R4).** A rebuilt CLI
silently loses to a stale global `spur` on PATH — the 2026-08-10 backfill ran old code for ~83 s
that way. The contract:

- Invoke `bun run apps/cli/src/index.ts …` or the built `apps/cli/spur.js` directly for
  `spur history import --mode full --dry-run` / write validation runs. Never a bare global `spur`.
- Every `spur history import` invocation prints a provenance header (`binary:` + resolved
  `@gobing-ai/ts-llm-jsonl-importer@<version>`); record it in the transcript before each
  dry-run/write. `--json` embeds the same `provenance` field.
- After rebuilding ts-libs importer changes, republish + `bun update` the dependent workspaces so
  the resolved importer version reflects the rebuild; the header is the proof either way.

---

## Spur CLI surface

**Not the verb catalog.** `task` / `feature` / `rule` / `workflow` → **`sp:spur-cli`**. Lifecycle →
`/sp:dev-*` / **`sp:super-planner`**. Multi-noun corpus campaigns → **`sp:expert-spur`**.

```bash
spur <noun> <verb> … --json
bun run apps/cli/src/index.ts <noun> <verb> … --json   # monorepo dev
spur <noun> --help
```

| Noun       | Purpose                                          |
| ---------- | ------------------------------------------------ |
| `agent`    | Run / list / doctor / agent specs                |
| `builder`  | Release plumbing: `bump-ver` / `drop-tags` (promoted from spur-dev, ADR-051) |
| `feature`  | Feature tree + AC gates → **`sp:spur-cli`**      |
| `history`  | Import / analyze agent history                   |
| `message`  | Inter-agent messages                             |
| `projects` | Multi-project registry                           |
| `rule`     | Constraints → **`sp:spur-cli`**                  |
| `self`     | Self-management verbs: `init` / `migrate` / `serve` / `status` (legacy top-level forms remain hidden aliases) |
| `team`     | Assign / start / stop / status                   |
| `task`     | Task corpus → **`sp:spur-cli`**                  |
| `workflow` | Engine + run progress/follow → **`sp:spur-cli`** |

**Adding a script/command? Four surfaces, one rule (ADR-051, amended 2026-08-20 — feature A3/0613):**

| Surface | Audience | Gate |
| --- | --- | --- |
| `spur` CLI (`apps/cli/src/commands`) | **Public** — end-user harness; stays simple and easy to use. Default home for anything a Spur end user would run. **First layer = nouns only** (`task check`, `rule run`) so similar actions group; verbs/flags are the expansion mechanism — a new noun is justified only when no existing noun can host the action. | Adding/changing/removing any noun or verb requires **explicit operator consent** with design context. Present the surface choice + options first; never land a CLI surface change unilaterally. |
| `scripts/commands` (via `scripts/spur-dev.ts`) | **Internal** — Spur self-dev only: packaging/release (`publish`, `bundle-*`, `verify-pack`, `check-marketplace-version`), building Spur itself (`build-cli`, `build-binaries`, `dev-all`), monorepo gates (`link-check`). | No consent gate; one module per command + test sibling + `bundle-*`-style verb naming. |
| `package.json` scripts | **Repo developers** — entrypoints invoked by name (`bun run …`); compose existing binaries, add no logic; the script name is the contract. | No consent gate; keep entries composable and logic-free. |
| `plugins/sp/scripts` | **Plugin-shipped** — actions that must run on agent machines that only have the plugin, not the monorepo. | Entrypoint contract owned by **ADR-065** (`.mjs` twins, `config/plugin-scripts.json` declaration, no repo-relative paths); cross-referenced, not restated here. |

Selection condition: identify the **audience** (end user / self-dev / repo developer / plugin-only
agent machine); the audience selects the surface; only the first surface crosses the consent gate.
Operational view: `docs/design/harness-surface-governance.md`. Feature A3 consent record (six
public-surface changes): ADR-051 amendment 2026-08-20.

Promoted in task 0502 per ADR-051 noun discipline: corpus validation is `spur task check --corpus`
(NOT a new `corpus` noun); the misplaced spur-dev command is removed. All public CLI nouns are
legitimately public; all other spur-dev commands are correctly internal.

**Long-tail:** Additional `/sp:dev-*` commands (handover, gitmsg, fixall, findconflict, dogfood, reverse, arch,
…) are indexed in `plugins/sp/README.md`.

**Outside spur-cli:** Nouns without a `sp:spur-cli` reference file (`history`, `projects`,
`status`, `migrate`) — use only `spur <noun> --help` and `docs/04_DESIGN.md`. Never guess flags.
(`agent`, `message`, `team`, `serve`, `init` have parity-gated references:
`plugins/sp/skills/spur-cli/references/{agent,message,team,serve,init}.md`.)

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
6. `spur task check --corpus` green (`bun run corpus-check` — **not** part of `spur-check`; it is
   gated behind `bun run spur-check-new`, which is `spur-check` + the corpus sweep. Run the sweep
   before a commit that touches the task/feature corpus; see below)
7. `git status` intentional only

**Two gate variants.** `spur-check` is the fast gate (~72 s: link-check → transition-shim-check →
script-contract-check → lint → test-pre-check → test → test-post-check). `spur-check-new` is that plus `corpus-check`
(~+41 s). The split is deliberate (commit `4b929877`, 2026-08-09) — the corpus sweep costs more than
half the gate again, so it is opt-in. Both run the sub-second checks first so a link, shim, or script-contract
violation fails in ~0.3 s instead of after the 63 s test run.

**`spur task check --corpus` — task/feature corpus, not code.** Sweeps every task and feature and fails on any
structural error outside `config/corpus-baseline.json`. It exists because per-task gates run **once**,
at a transition, and nothing re-validates afterwards — so both a bypassed gate and a tightened rule
go unnoticed indefinitely. The baseline is two-sided: an unlisted error fails, **and** a listed entry
that no longer reproduces fails, so it cannot rot into a silent suppression list. Adding or
tightening a finding code obliges you to reconcile the fallout in the same commit (constitution
**T10**).

**`bun run transition-shim-check` — tracked compatibility shims.** Runs **second** (after
`link-check`, before `lint`) in both `spur-check` and `spur-check-new` (task 0541, ADR-058); it costs
~0.26 s, so it is placed ahead of the 63 s test run to fail fast. Two-sided against `config/transition-shims.json`: an
`@transition-shim(<id>)` marker with no entry fails, **and** a listed entry whose marker is gone
from source fails. Emptying the manifest is the definition of the agent-role transition being
complete. Shapes: `docs/04_DESIGN.md` §2.5.

**`bun run script-contract-check` — plugin script entrypoint contracts.** Runs **third** (after
`transition-shim-check`, before `lint`) in `spur-check` and `spur-check-new` (task 0600, ADR-065). Two-sided
against `config/plugin-scripts.json`: standard scripts must have up-to-date `.mjs` twins, repo-only scripts
must not carry twins, all disk scripts must be declared, and shipped surfaces must not name repo-relative
`bun plugins/sp/scripts/` paths.

**`--no-lifecycle` is bookkeeping, never a guard bypass.** It suppresses lifecycle *run record*
creation (the pipeline is already a run; a nested one would orphan). The structural gate
(`spur task check`) runs on `→ testing` and `→ done` regardless. `--force-done` waives the verify
**verdict** only — never the section matrix.

**Targeted-test-first while iterating:** when a test fails, run the narrow target
`bun test <file> --test-name-pattern <test>` to green before any full-suite gate, and run the full
`spur-check` at most twice per task (task 0436 R2). Do not re-run the whole suite on every
iteration — it is the dominant verification-loop cost.

Never `--no-verify` / silent `biome-ignore` to force green. Harness task done ⇒ real verify **PASS**
when the task used the pipeline.

---

## Testing

- Location: `<workspace>/tests/**/*.test.ts` (`bun:test`); `plugins/sp` chained in root `test`.
- Coverage: per-file line/function ≥ 90% aggregate. **Coverage is always measured** — `bunfig.toml`
  sets `[test] coverage = true` with `coverageThreshold = { lines = 0.9, functions = 0.9 }`, so plain
  `bun run test` measures and enforces it too; `bun run test:coverage` only adds the explicit
  `--coverage` reporter. Instrumentation costs ~1 % of suite wall-clock, so there is no faster
  no-coverage mode to reach for. React `.tsx` and the test-harness preload `tests/setup.ts` are
  excluded from the product-code gate.
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

## History Board surface

The Board's `history` oRPC group exposes `getSummary`, `getTimeline`, `getSessions`, `getInsights`,
`getSources`, and `triggerImport`; DTOs are pure-token only. Indexed live queries fall back whenever
the checkpoint-keyed read models are absent or stale; `HistoryService.analyze()` refreshes them.
`getTimeline` is POST-only with discriminated source-safe session or bounded consolidated input.
Summary includes daily KPI trends, a nullable previous-window baseline, and bucketed skill-token series;
Sources overview includes the nullable last-import timestamp.
Shapes and the canonical nine source ids: `docs/design/history-board-module.md`.

## System Event surface

Persisted and SSE System Event payloads use the canonical v2 envelope built in `packages/app`;
legacy rows are projected on read without rewriting storage. Shape and policy:
`docs/design/actionable-observability-context.md` and `docs/04_DESIGN.md §7.9`.
J91 table cells are human-only (built, task 0605): optional
`presentation.correlators` / `actionLabel` / `agent` — `docs/design/system-events-human-table.md`
(ADR-073/074).

---

## Database / migrations

- Schema SQL owned per domain package; `packages/domain/src/migrations.ts` → `CLI_SCHEMA_SQL`
  (+ history / workflow engine SQL + `_spur_cli_` increments).
- New migrations take `max(prefix)+1` (four-digit numeric prefix, e.g. `0015_...`). If a merge surfaces a duplicate prefix, the incoming branch renumbers to `max(prefix)+1` (the E6 precedent, commit `fa41669c`).
- Migrator: top-level `drizzle/*.sql` with `_spur_cli_` marker only.
- History: raw in files; DB holds typed rows, lazy generic ETL rows, import ledger, and checkpoints.
  Repeated Claude response snapshots share `request_id`; rollups retain the final cumulative row.
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
- **One writer per working tree.** Two agent sessions in one checkout overwrite each other silently
  — the symptom looks like a model regression. Parallel agent work uses git worktree isolation (one
  branch + one tree per agent). Task 0487 R5.
- **Commit per task.** Start a task on a tree clean of other tasks' implementations; a dirty tree
  mixes two tasks' evidence into one diff and is what the implement stage conflates. The pipeline
  precheck warns (never blocks) with the file list. Task 0487 R6.

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

## System Design Best Practices

### Core Principles

- Choose the simplest implementation that fully satisfies the current requirements. Avoid unnecessary abstraction, configuration, indirection, or speculative extensibility.
- Make the smallest necessary change that fixes the root cause. Do not refactor unrelated modules or change strategy semantics unless explicitly requested.
- Grow the system in layers. Start from the smallest working end-to-end version and add new capabilities incrementally. Never replace a working system with unfinished complexity.
- Reuse existing project components before creating new ones. Prefer extending proven modules over introducing parallel implementations.
- Prefer well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear benefit.
- Keep components modular with clearly defined responsibilities. Avoid unnecessary coupling between strategy logic, execution, accounting, replay, and infrastructure.
- Design for long-term maintainability once a feature or strategy has been validated. Do not over-engineer speculative ideas before evidence exists.

### Strategy Development

- Validate hypotheses with historical replay before introducing forward-only logic whenever historical validation is possible.
- Every trading strategy must progress through Replay → Shadow → Canary → Live. Do not skip validation stages.
- Base design decisions on measurable evidence rather than intuition. Optimize only after demonstrating that an edge exists.
- Treat every strategy as an independent contract. Do not silently alter frozen behavior without explicit authorization.

### Existing Systems

- Do not break running Shadow or Live systems for unrelated work.
- Preserve compatibility only when required by active production or validation workflows. Otherwise, remove obsolete code instead of accumulating compatibility layers.
- Reuse existing infrastructure whenever possible, including replay engines, accounting, execution, wallet management, order book handling, logging, monitoring, and daemon frameworks.

### Engineering Standards

- Prefer deterministic behavior over hidden automation.
- Fail loudly when assumptions are violated. Do not silently ignore errors or fall back to unexpected behavior.
- Keep configuration minimal. Introduce new configuration only when behavior genuinely needs to vary.
- Remove dead code instead of leaving unused paths behind.
- Write code that is easy to inspect, replay, test, and reason about.
- Keep implementation consistent with existing project architecture unless an architectural change is explicitly requested.

### Scope Discipline

- Implement only the requested scope.
- Do not introduce unrelated optimizations, redesigns, migrations, or feature expansions.
- Non-blocking findings outside the requested scope may be noted separately but must not be merged into the current task.
- Consider a task complete once its agreed acceptance criteria are satisfied. Treat subsequent improvements as separate work items.
