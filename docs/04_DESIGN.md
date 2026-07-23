---
doc: 04_DESIGN
owns: SURFACE — every CLI command, flag, config key, env var, table, DTO
authority: derived
version: 1.3.6
derived_from: [03_ARCHITECTURE, codebase]
owner: Robin Min
updated_at: 2026-07-22
read_before: changing a command, flag, env var, or schema
edit_rules: 99 §6.5
sync: [T3, T9]
---

# 04 Design — Spur

The external, user-facing design surface: every CLI command, the config schema, and the persisted
data shapes. Feature-internal design lives in code.

This doc is the **index** over the `docs/design/` satellites (constitution §4.5): the surface spec
below is the entry point; deep per-area design lives in the satellite files. Edit order is
detail-first then index (§4.5 rule 5 / T9).

## 0. Design satellites (`docs/design/`)

| Satellite | Area | Status |
|-----------|------|--------|
| [`rd3-migration-design.md`](design/rd3-migration-design.md) | Planning layer (`spur task`/`spur feature`) — schemas, lifecycle, corpus migration (ADR-020–023) | finalized; surface in §1.x / §7 |
| [`server-side-adjustment-design.md`](design/server-side-adjustment-design.md) | Server/Web slice — ServerContext, runtime-safe imports, EventBus/JobQueue/Scheduler wiring, oRPC surface | design (in progress) |
| [`server-side-adjustment-feature-finalized.md`](design/server-side-adjustment-feature-finalized.md) | Server/Web — finalized feature decisions for the above | finalized |
| [`spur-team-mode-design.md`](design/spur-team-mode-design.md) | Team mode — agent specs, inbox, `TeamService` | design |
| [`workflow-observability.md`](design/workflow-observability.md) | `spur workflow run` DX — run-start plan preview + live EventBus step progress; board reuse (0114) | implemented |
| [`dev-plan-design-doc-generation.md`](design/dev-plan-design-doc-generation.md) | `/sp:dev-plan` design-doc step — `--design`/`--auto` flags, seam heuristic, satellite + index authoring (0124) | implemented |
| [`dev-agent-flag-and-dogfood-skill.md`](design/dev-agent-flag-and-dogfood-skill.md) | `--agent` on dev-refine/plan/brainstorm (threaded, not theater) + `sp:dogfood-testing` backbone extraction with enhanced report/ledger (0125) | implemented |
| [`e2e-workflow-for-system-development.md`](design/e2e-workflow-for-system-development.md) | End-to-end workflow system for system development — pipeline architecture, design step auto-detection, HITL gate model, doc-sync boundary (0167) | design |
| [`portable-agents-harness-contract.md`](design/portable-agents-harness-contract.md) | `spur init` root `AGENTS.md` seed — complementary Spur/Superskill ownership, portable routing, conditional root `DESIGN.md` | implemented |

> Filenames retain `-design`/`-finalized` suffixes (stable grep anchors referenced across task/plans
> history); the bare-`<slug>.md` convention (§4.5 rule 2) applies to **new** satellites. See
> constitution §8 lesson (2026-06-18).

## 1. CLI Surface

All commands accept `--json` for machine-readable output and return a meaningful exit code. The
binary is `spur` (`apps/cli/src/index.ts`, run under Bun).

### 1.0 CLI grammar

The canonical invocation shape is:

```
spur <noun> [<verb>] [positionals] [--flags]
```

**Noun-verb contract:**

- Every multi-verb noun follows `spur <noun> <verb> …`. The verb is the second positional token.
- `init`, `status`, and `migrate` are the only sanctioned **verb-less** commands. They accept
  flags and optional positionals directly.
- All other nouns require a verb. Commander enforces this: calling `spur workflow` without a verb
  prints commander's help and exits 1.

**Help dispatch:**

| Invocation | Behavior |
|---|---|
| `spur` / `spur help` / `spur --help` | Top-level help: commander's standard flat command listing (alphabetical, with summaries) |
| `spur <noun> --help` | Commander-generated command-scoped help (options, subcommands) |

The CLI surface is built on `commander` + `@commander-js/extra-typings`. Each noun exports a
`registerXxxCommand(program, context)` function from `apps/cli/src/commands/<noun>.ts`. Adding a
noun requires writing its registration function and importing it in `apps/cli/src/index.ts`.
Commander handles option parsing, `--help` rendering, and subcommand dispatch — no custom
help rendering overrides remain.


### 1.1 Committed product commands

#### `spur init [--name <name>] [--force] [--minimal] [--json]`
Scaffold a local Spur project. Writes `.spur/config.yaml` (§2.1) and records the config artifact. Unless
`--minimal`, scaffolds `.spur/` from the default config assets (§2.3): `.spur/rules/` (with the
`recommended-pre-check.yaml` + `recommended-post-check.yaml` presets) and `.spur/workflows/basic.yaml`.
The set of scaffolded files is an explicit reviewed manifest (`scaffold-manifest.ts`) — adding a default
is a one-line manifest edit, not new control flow. Files are read from the resolved config source, not
embedded as string literals. Always creates `.spur/agents/` (with a `.gitkeep`) for team-mode agent
specs, regardless of `--minimal`. On first run it seeds `~/.config/spur/` from the bundled package-root `config/`
assets (existing files are never overwritten), so `spur rule run` resolves a real ruleset from any
project. Re-running is blocked (exit 1) unless `--force` is given, preventing a stray `init` from
clobbering a configured project. `--json` emits
`{ ok, project, config, created[], skipped[], globalConfigSeeded }`.

**Init ownership contract.** Two surfaces collaborate; their cut is strict (task 0188):
- **`spur init` owns file materialization.** Copies every `SCAFFOLD_MANIFEST` entry from
  `bundledConfigRoot()` to `.spur/` (and the `docs/` stubs to the project root). Idempotent;
  `--force` overwrites non-preserve entries, never overwrites preserve-marked docs; `--minimal`
  skips `.spur/rules` + `.spur/workflows`. The manifest is pure data — adding a default is a
  one-line edit, no control-flow change. **AGENTS.md** (`preserve: true`): when scaffolding a
  *new* file from `config/templates/AGENTS.md`, init substitutes `{project-name}` (from `--name`
  or cwd basename) and `{project-description}` (stub: `local Spur project`) so fresh projects
  never ship residual brace tokens (task 0242). The seed names Spur and Superskill as complementary
  first-class harness tools, routes each operation to its owning plane, and conditionally makes a
  repository-root `DESIGN.md` authoritative for UI/UX work without colliding with this doc's surface
  ownership (task 0312; [portable contract](design/portable-agents-harness-contract.md)). Existing
  customized AGENTS.md is never overwritten.

- **`/sp:spur-init` owns content adaptation only.** Calls `spur init` as its first step, then
  performs three classes of adaptation. Its scaffold step invokes `spur init --json` exactly once,
  retains the result envelope, reports one concise created/skipped summary, and reuses
  `result.project` for customization without replaying the human transcript. Two probes sit between
  scaffold and customization:
  - *Functional probe (Phase 1.5):* `spur status`, `spur task create`, `spur workflow validate`.
  - *Rule glob adaptation (Phase 1.6):* the `recommended-pre-check` preset ships globs calibrated
    to Spur's monorepo (`apps/**/*.ts` etc.). On any other layout these match zero files and `rg`
    exits 2, surfacing as `kind: "error"` findings. The command detects the project layout
    (monorepo / single-package / flat / polyglot) and writes adapted overrides under
    `.spur/rules/<category>/` — local-layer shadowing (first-layer-wins by relative path), not
    scaffold materialization. The probe `spur rule run --preset recommended-pre-check` must then
    report zero `kind: "error"` findings. Adapted rule files are customization overlays, analogous
    to the Phase 2 doc edits — NOT `SCAFFOLD_MANIFEST` entries.
  - *Doc customization (Phase 2):* routes every doc touch through `sp:doc-evolve` (project naming,
    stack detection, PRD/ADR drafts).
  The command NEVER creates `SCAFFOLD_MANIFEST` files itself — it edits content the CLI already
  wrote, or writes local-layer overlays the CLI never owned.

**Scaffold-variant parity invariant.** `SCAFFOLD_MANIFEST` ships exactly one
`templates/task/<variant>.md` entry per `TASK_VARIANTS`
(`standard·feature-impl·issue·review·brainstorm·meta`); enforced by
`apps/cli/tests/commands/init.test.ts` to prevent template/manifest drift.

#### `spur agent run <prompt> [--agent <name>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--drain] [--json]`
**The single LLM execution surface.** Every model invocation in Spur routes through this verb — sp
skills that generate prose (AC, decompositions, reviews), workflow `agent.run` actions, and team-mode
runs all call `spur agent run`; Spur owns no other path that reaches a model (it is not a BYOK LLM
platform — ADR/PRD). This keeps agent resolution, auth, slash-command translation, and team identity in
one place, and is the seam where a future remote/SSE execution channel attaches without touching callers.
Execute a prompt or slash command via a coding agent. `--agent` (default `auto`) resolves via the
`agent` config block (0126): the prompt's slash command yields a **phase** — recognized in every
per-agent surface form, since `spur agent run` may receive an already-translated prompt (`/sp:dev-run`
claude, `/sp-dev-run` opencode/gemini/hermes/grok (default dialect), `/skill:sp-dev-run` pi/omp,
`$sp-dev-run` codex, plus the `rd3` variants → all `dev-run`); a configured `agent.default-by-phase[phase]`
selects a named `agent.executors` profile (`{ name, agent, model? }`) — its `model` becomes the run's
model **unless** the user passed an explicit `--model` (explicit wins). A configured phase mapping is
authoritative: an unknown executor exits 2, a known-but-unusable executor exits 1, and neither falls
back. With no phase match, `agent.default` is resolved as an executor selector (then a legacy agent
name); on miss, the static Tier-1 priority resolver picks the first usable Tier-1 agent — the legacy
behavior preserved when no `agent` config is present. `current` reads `SPUR_AGENT` env var; an
explicit name resolves directly and never consults phase config.
`--continue` resumes the previous session. `--mode text|json` (default `text`) passes output format
to the agent CLI (Grok maps `text` → `--output-format plain`). `--cwd` sets the working directory.
`--json` emits a machine-readable envelope
(`{ exitCode: number|null, stdout, stderr, signal?, durationMs }`). Slash commands like
`/plugin:command` are translated per-agent (claude pass-through, codex `$`, pi/omp `/skill:…`,
others including grok/hermes/opencode → `/plugin-command`).
Team identity (purpose, tags, system prompt) is sourced from the agent **spec** (`agent create`
flags below), not from `run` flags. `--drain` resolves the addressed `--agent <id>` as an **agent
spec id** (a different namespace from the coding-agent type), folds that spec's pending inbox
messages into the prompt, and rewrites `--agent` to the spec's underlying type before dispatch
(Phase 1-3 has no live stdin, so prepending is how deferred messages reach the agent).
Exit 0 on success, 1 on agent-not-found, 2 on invalid arguments, 3 on agent execution failure.

#### `spur agent list [--json] [--specs]`
Detect installed agents; prints `ok|missing <name> [version]`. Backed by `ts-ai-runner`
`AgentDetector` / `DISPLAY_ORDER`. Canonical agents (0.4.8+): `claude`, `codex`, `gemini`, `pi`,
`omp`, `opencode`, `antigravity-cli`, `openclaw`, `hermes`, `grok` (`antigravity` is a deprecated
alias of `antigravity-cli`). With `--specs`, lists the team agent specs under `.spur/agents/` instead
(`<id> <type> <purpose>`; `--json` includes the spec path).

#### `spur agent doctor [agent] [--json]`
Readiness check per agent (same `DISPLAY_ORDER` as list). Text mode prints an aligned table —
`<✓|✗> <usable|missing> <agent> <tier> <auth:yes|no|?> <version>` with a
`STATUS AGENT TIER AUTH VERSION` header and an `N usable, M missing (tier-1)` footer; `--json`
emits `{ agents: [...] }`. Auth is informational (its own column, not a state label —
liveness-only gate, ADR/0127). For **grok**, auth is tri-state from `XAI_API_KEY` and/or
non-empty `~/.grok/auth.json` (no CLI auth-status verb). Exit 1 if any **tier-1** agent is not
usable. Backed by `ts-ai-runner` `DoctorRunner`.

#### `spur agent create <id> --type <agent-type> [--json] [flags]` · `spur agent edit <id>` · `spur agent delete <id> [--force]`
Manage team agent specs under `.spur/agents/<id>.yaml` (backed by `ts-ai-runner` agent-spec helpers
and the app-layer `TeamService`).
- `create` — write a spec. `--type` is a canonical coding-agent id (e.g. `claude`, `codex`, `omp`,
  `grok`, … — same set as list/doctor). Flags: `--name`, `--workspace`, `--purpose`, `--tags <a,b>`,
  `--model`, `--autonomy`, `--system-prompt`, `--no-identity-preamble`, `--auto-start`. The id is
  validated (`[a-z][a-z0-9_-]{1,63}`); a duplicate id is refused. An empty `--purpose` falls back to
  `"<type> agent"` so the written YAML round-trips. `--json` emits `{ ok, spec }`.
- `edit` — open the spec in `$EDITOR`, or print its path when `$EDITOR` is unset. Errors if missing.
- `delete` — remove the spec; refuses (exit 2) without `--force`; errors (exit 1) if missing.

#### `spur message send --to <id> <body> [--from <id>] [--json]` · `spur message inbox --agent <id> [--json]` · `spur message reply <msg-id> <body> [--json]` · `spur message watch --agent <id> [--interval <ms>] [--json]`
Durable inter-agent messaging over the SQLite `inbox_messages` table (backed by `TeamService` →
`ts-ai-runner` `MessageService` → `ts-db` `InboxMessageDao`).
- `send` — enqueue a message; `--from` defaults to `operator`. Prints `queued <id> → <to>`.
- `inbox` — list messages addressed to `--agent` (`<id> <status> <from> <body> <createdAt>`); reports
  "No messages" when empty.
- `reply` — look up the original message, address the reply back to its `from_id`, and thread it via
  `in_reply_to`. Rejects an unknown id, or an operator-originated message (null sender) with no peer.

#### `spur team assign <task-id> <agent-id>` · `spur team status [--json]` · `spur team start <agent-id> [--server <url>] [--json]` · `spur team stop <agent-id> [--server <url>] [--json]`
Team coordination (backed by `TeamService`).
- `assign` — set `assignee: <agent-id>` in the YAML frontmatter of `docs/tasks/<task-id>_*.md`
  (replacing any existing assignee). Errors if no matching task file is found.
- `status` — list every spec under `.spur/agents/` with its run status; `--json` emits `{ agents: [...] }`.
- `start` / `stop` — POST to `<server>/team/agents/<id>/(start|stop)` (default server `http://localhost:3000/api`; `--server` overrides). `--json` returns the raw server payload; otherwise `start` prints `started <id> (pid=<pid>, status=<status>)`, `stop` prints `stopped <id>`. Exit 1 on transport failure or server-side error.

#### `spur rule run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <severity>] [--stop-on-first [<severity>]] [--fix-mode <mode>] [--dry-run] [--verbose] [--json]`
Evaluate constraint rules over the working tree. `--preset` (default `recommended-pre-check`) or
`--file` for an ad-hoc rule file; `--rule <id>` filters to one rule. `--fail-on error|warning|info` (default
`error`) sets the exit-1 threshold. `--stop-on-first [<severity>]` (default `error` when bare) stops
evaluation after the first rule with findings at or above the given severity — this controls
**traversal** (when to stop), orthogonal to `--fail-on` which controls **verdict** (what to fail on).
They compose: stop early, then threshold the partial findings via `--fail-on`. Omitting
`--stop-on-first` preserves the default exhaustive scan.

`--fix-mode none|suggest|auto` (default `none`) controls fix collection and application:
- `none` — fixes not collected. Byte-identical to the pre-`--fix-mode` behavior.
- `suggest` — collect candidate fixes, surface them (`fixes[]` in `--json`), **write nothing**.
- `auto` — collect AND apply. Effective per-rule mode is `min(rule.fix.mode, maxFixMode)`.
  `--dry-run` previews the diff without writing.

Exit code is governed by `--fail-on` based on **findings** alone; applying a fix does NOT retroactively
clear the exit code (the operator re-runs to confirm green). `--verbose` streams per-rule progress with
execution time to stderr (e.g. `✓ passed - 0.12s`). Rule roots resolve highest-priority-first:
`SPUR_RULES_PATH`, local `.spur/rules`, the user-global `~/.config/spur/rules`, then the generic demo
rules bundled with `ts-rule-engine` as a fallback so a preset's categories resolve before `spur init`
seeds the global layer. A run that resolves **zero rules** exits 1. Setting `SPUR_GLOBAL_RULES_DIR`
overrides the global root and suppresses the bundled fallback for a hermetic run. Backed by
`ts-rule-engine`.

#### `spur rule validate [--file <path>|--preset <name>|<path>] [--json]` · `spur rule list [--preset <name>] [--json]` · `spur rule trace [run-id] [--preset <name>] [--status <s>] [--since <date>] [--last <n>] [--json]`
- `validate` — load and normalize a rule file or preset without evaluating it.
- `list` — list the effective rule-file inventory grouped by source layer and category (`local`, `global`,
  and any `SPUR_RULES_PATH` override, deduped by relative path); with `--preset`, list the resolved preset
  rules.
- `trace` — query persisted rule run history from SQLite. No argument: list recent runs (default last 20,
  newest first) with filters `--preset`, `--status` (`done`|`failed`), `--since` (ISO date), `--last` (positive
  integer). With `<run-id>`: per-run detail showing summary metadata and per-rule evaluation rows in
  execution order with finding counts, duration, and status. `--json` returns structured DTOs.
  Runs are persisted inline by `spur rule run` when a DB is available (direct writes from the
  `ts-rule-engine` `RulePersistenceAdapter`; Spur writes via `DbRulePersistenceAdapter`).
Backed by `ts-rule-engine`. Help dispatch per §1.0.

#### `spur workflow validate <workflow.yaml> [--json] [--no-schema]` · `spur workflow run <workflow.yaml> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan] [--json]` · `spur workflow continue [run-id] [--yes] [--json]` · `spur workflow list [--json]` · `spur workflow trace [run-id] [--workflow <name>] [--status <s>] [--since <date>] [--last <n>] [--json]`
- `validate <file>` — load + Zod-validate a workflow definition.
- `run <file> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan]` — execute; prints `<status>: <name> -> <finalState>`;
  exit 1 unless `done`. `--vars` takes a JSON object of per-run variable overrides
  (e.g. `--vars '{"taskId":"0042"}'`), merged over the workflow's `vars` for `${vars.*}` resolution.
  `--dry-run` validates the definition and walks the transition graph without executing actions
  — useful for verifying workflow structure before committing side effects.
  **Observability (0114, synchronous human runs only):** before executing, prints a run-start plan
  preview (`plan: <state> → … → <terminal>`, from the parsed definition) and then streams live
  per-step progress from the workflow EventBus (`▶ <state> [<status>]`, `→ <node>: <kind>…`,
  `✓ <status> (<duration>)`). Suppressed under `--json` (envelope stays byte-identical) and on the
  detached `--async` path (ignored stdio → use `spur workflow trace`); `--no-plan` suppresses only
  the preview. Mechanism: [`design/workflow-observability.md`](design/workflow-observability.md).
  `--async` starts the run in a detached background process and returns the run id immediately.
- `continue [run-id] [--yes]` — resume a paused (HITL) run (E3, design §6 / D04). Omit `run-id` to
  discover the most-recent paused run and confirm (skipped with `--yes`). Resolves the run's
  `workflow_name` back to its YAML, then `resumeRun`. Works for both lifecycle and pipeline runs;
  exit 1 if no paused run, the run isn't paused, or it doesn't resolve to `done`. (A state pauses when
  it declares `pause: true`; the workspace schema supports `pause`.)
- `list` — list available workflow YAML files across project (`.spur/workflows/`) and global
  (`~/.config/spur/workflows/`) layers, grouped by source.
- `trace` — query persisted workflow run history. No argument: list recent runs (default last 20,
  newest first) with filters `--workflow`, `--status`, `--since`, `--last`. With `<run-id>`:
  per-run timeline of state entries, transitions, and action executions interleaved by `created_at`.
  Action lines include the action kind, duration when finalized, and an in-flight/success/failure marker.
  **Per-step cost (0311):** `agent.run` lines also carry token cost + cache-hit joined from imported
  history ETL rows — ` · $X.XXX · cache Y%` for an exact session-id join (R1a), ` · ~$…` when the
  time-window heuristic was used (R1b estimate), and ` · cost n/a` when no imported usage matches
  (never `$0.00` — 0281/0284 never-fabricate). An unjoined step appends a footer hinting
  `spur history import`. `--json` gains a nullable per-action `cost` object (`costUsd`, input/output +
  cache token dims, `cacheHitRatio`, `estimated`), additive so existing consumers are unaffected. Cost
  is read from already-imported ETL; `trace` never triggers an import. Join + math:
  `packages/domain/src/analytics/run-cost.ts`.
Backed by `ts-dual-workflow-engine` (`WorkflowService` + `DbWorkflowPersistenceAdapter`).

#### `spur history import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--dry-run] [--json]`
Import agent conversation JSONL. `--source` ∈ {pi, claude, codex, gemini, opencode, antigravity,
openclaw}. `--mode` ∈ {full, incremental, force-file} (defaults: `incremental` for root scans,
`force-file` when `--file` is given). Reports scanned files, processed lines, imported/duplicate
records, parse/validation errors; exit 1 if any errors. Backed by `ts-llm-jsonl-importer`.

#### `spur history analyze [--since <iso-date>] [--json]`
Aggregate imported ETL records into token/cost analytics (totals + per-source + per-model + daily).
Reads `history_etl_*` tables; estimates cost from per-model pricing.

#### `spur history report [--json]`
Reserved CLI surface for richer history reports. Currently prints a TODO marker so migration can
stabilize before the report implementation is designed.

### 1.2 Supporting utilities

| Command | Behavior |
|---------|----------|
| `spur status [path] [--json]` | Project health: `ok`/exit 0 requires a valid `.spur/config.yaml`; `packageJson` is an independent optional fact. Also reports Git context, team agent spec ids under `.spur/agents/`, and optional path metadata (size, isFile, isDirectory). |
| `spur serve [--port <n>] [--host <addr>] [--no-open] [--cwd <path>] [--json]` | Start the web server (local fallback) and serve the Spur Board SPA when static assets resolve. Options: `--port` (env PORT, default 3000), `--host` (env HOST, default localhost), `--no-open` skip browser, `--json` print {port,url,pid}. Board assets ship in the npm package as `web/` next to `spur.js` (`resolveWebDistPath`); without them `/board` returns JSON 404 and the server logs a warning. |
| `spur migrate [--json]` | Temporary helper: apply CLI-owned schema migrations; reports `{ ok, applied }`. |
| `spur --help` / `spur --version` | Commander-rendered usage / binary version (ADR-014). |

### 1.3 Agent command surface — commands as SSOT (feature O, ADR-032)

The `plugins/sp` agent-facing command surface (28 Claude Code `/sp:dev-*` slash wrappers) is
**hand-authored** — each `commands/<name>.md` is the authoritative, directly-editable source.
Per-platform adapters are **install-time output** owned by `superskill` (`superskill install sp`)
and never committed in plugin `sp` (ADR-032).

| Artifact | Role |
|----------|------|
| `plugins/sp/commands/<name>.md` | Hand-editable SSOT — frontmatter + invocation syntax + delegation line only |
| `plugins/sp/scripts/validate-commands.ts` | Thin-wrapper contract validator: (a) heading whitelist, (b) frontmatter schema, (c) target resolution, (d) allowed-tools coherence |
| `plugins/sp/tests/command-contract.test.ts` | Contract test — validates the same four gates against the live corpus + negative-path coverage |

Invariants: wrappers carry invocation syntax + the delegation line only — lifecycle semantics live
in the dispatched skill/workflow/procedure (0283 R4). The thin-wrapper contract is enforced by
validation, not generation — commands are hand-editable; the validator catches drift. A fresh
session is required to trust an in-session dogfood of a just-edited wrapper (platforms snapshot
command bodies at session start). The command index is owned by `plugins/sp/README.md`.
Supersedes the 0308 generated-adapter approach (ADR-032 records the decision).

## 2. Configuration

### 2.1 Project config — `.spur/config.yaml` (ADR-017)
Written by `spur init`. Single YAML config surface; the legacy `.spur/config.json` project marker is
retired. Resolution order: project `.spur/config.yaml` (cwd) → fallback `~/.config/spur/config.yaml`.

Two top-level concerns:
- **Portable `bootstrap:` block** — consumed by `@gobing-ai/ts-infra` `runNodeApplication`. Shared across
  `spur-cli` and (future) `spur-server`. Keys map 1:1 to ts-infra's `LoggingOptions` /
  `TelemetryOptions` / `DatabaseOptions` / `SchedulerOptions`.
- **Spur app section** — everything except `bootstrap:`, validated by the single merged
  `spurConfigSchema` in `@gobing-ai/spur-config` (ADR-027; the former CLI-local `SpurAppConfigSchema`
  was folded in). Keys are agent/rules/workflows/redaction/version/name, plus the planning-layer
  `tasks:`/`features:` blocks: `tasks.folders` (path → `{baseCounter, label?}`), `tasks.active`,
  `features.dir`. The folder fields tolerate a blank/`null` value (an empty YAML key) and coerce to
  the canonical default. `@gobing-ai/spur-config` is the SSOT; `apps/cli/schemas/spur-config.schema.json`
  mirrors it for editor/CI validation.

```yaml
version: "1"
name: <project-name>
bootstrap:
  logging:
    enabled: true
    level: info           # debug | info | warn | error
    console: true
    json: true
  telemetry:
    enabled: false        # CLI: off by default (per-invocation latency)
    serviceName: spur-cli
    environment: development
  database:
    enabled: true
    driver: bun-sqlite
    url: .spur/spur.db    # ${DATABASE_URL} interpolation supported
  scheduler:
    enabled: false        # CLI is run-once; no scheduler
agent:
  default: pi
rules:
  paths:
    - .spur/rules/**/*.yaml
workflows:
  paths:
    - .spur/workflows/
redaction:
  enabled: false
tasks:
  folders:
    docs/tasks: { baseCounter: 0, label: Core }   # legacy folders/base_counter absorbed
  active: docs/tasks                               # default folder for `spur task create`
features:
  dir: docs/features
```

`${ENV_VAR}` interpolation works via `ts-runtime` `interpolateTree` (used inside
`runNodeApplication`).

### 2.2 App config — `@gobing-ai/spur-config` (Zod)
Env-derived config (`ln(env)`), consumed by both the CLI context and the server Bun entry:

| Key | Env var | Default |
|-----|---------|---------|
| `database.url` | `DATABASE_URL` | `:memory:` |
| `server.port` | `PORT` | `3000` |
| `server.host` | `HOST` | `localhost` |
| `server.openBrowser` | — | `true` (spur serve only) |
| `server.webDistPath` | — | `null` (auto-resolve: cwd `dist/web`, package `web/` next to `spur.js`, binary-adjacent `web/`, monorepo `dist/web`) |
| `telemetry.enabled` | `SPUR_TELEMETRY_ENABLED` | `false` |
| `telemetry.endpoint` | `SPUR_TELEMETRY_ENDPOINT` | — |
| `logging.level` | `SPUR_LOG_LEVEL` | `info` (debug\|info\|warn\|error) |

Boolean env vars are parsed strictly (`true/1/yes/on` vs `false/0/no/off`); other values throw.

### 2.3 Default config assets — repo-root `./config` (ADR-015)

Repo-root `./config` is the single source of truth for all Spur default config, separated from source
code:

```
config/
  rules/
    recommended-pre-check.yaml      # default preset for `spur rule run`
    recommended-post-check.yaml     # stricter dev gate (coverage)
  workflows/
    basic.yaml                      # canonical implement → check → fix loop
    feature-dev.yaml                # agent-driven feature loop with pre/test/post gates
    task-lifecycle.yaml             # task status state-machine (ADR-022)
    feature-lifecycle.yaml          # feature status state-machine (ADR-022)
    task-pipeline.yaml              # task execution pipeline with guards
    planning-pipeline.yaml          # front-half planning pipeline (task 0088); companions sp:spur-plan
  tasks/
    section-matrix.yaml             # Section-Status-Matrix for `spur task check` (§7.4)
  templates/                        # task/feature/bdd/docs body templates (§8); CLI never hardcodes body content (DD-11)
    task/{standard,feature-impl,issue,review,brainstorm,meta}.md   # one per TASK_VARIANTS entry (§7.3.1); SSOT alignment invariant enforced by init.test.ts
    feature/default.md
    bdd/{gherkin,checklist}.md
    docs/{99_PROJECT_CONSTITUTION,00_ADR,01_PRD,02_ROADMAP,03_ARCHITECTURE,04_DESIGN,05_FEATURES}.md  # doc stubs (task 0088)
  plugins/
    .gitkeep                        # home for future bundled plugins (ADR-012)
```

**Build → install → init flow:**

| Stage | Action |
|-------|--------|
| Build (`build:bundle`) | Copy repo-root `./config` → package-root `apps/cli/config` via `bundle-config`; shipped via the package `files` array as top-level `config/`. |
| Install (`bun install -g`) | Package-root `config/` ships inside `@gobing-ai/spur` — no `postinstall` (unreliable for global installs). Legacy installs may still have `spur-cli/config/` (pre-0.3.9); `bundledConfigRoot()` accepts both. |
| First run / `spur init` | `seedGlobalConfig()` copies bundled `config/{rules,workflows,tasks,…}` (YAML/JSON) → `~/.config/spur/` (never overwrites). |
| `spur init` scaffold | Full-tree seed of every bundled asset into project `.spur/` (natural paths: `rules/**`, `workflows/**`, `tasks/**`, `templates/**`, `plugins/**`), then the `scaffold-manifest.ts` pass for remaps (`templates/task` → `tasks/templates`), root-scoped `docs/` + `AGENTS.md`, and `preserve`-marked entries (never overwritten, even with `--force`). |
| Runtime resolution | `bundled` (package `config/` + ts-rule-engine demo rules) > global (`~/.config/spur`) > local (`.spur`). |

**Ownership split.** `@gobing-ai/ts-rule-engine` ships only generic demo rules (one per builtin
evaluator) + a generic `example.yaml` preset for its own tests. Spur owns its presets and workflows
here. The bare `recommended` preset is removed; `recommended-pre-check` is the default (BREAKING, ADR-015).

**`--compile` caveat.** The compiled binary (`dist/cli/spur`) cannot read a sibling package `config/`;
it relies on the `~/.config/spur` seed. The published global install (`spur.js` + package-root
`config/`) reads the bundled tree directly and is the primary path.

No symlinks participate in install or init — config propagates by copy-and-resolve only. (The
monorepo may symlink `.spur/{rules,workflows,…}` → repo-root `config/` to avoid duplication during
Spur's own development; that is a monorepo convenience only.)

### 2.4 Config loader — single facade in `@gobing-ai/spur-config` (ADR-027)

`.spur/config.yaml` has exactly one loader. The package splits into two entry points so the
dependency graph stays Workers-safe:

| Entry | Imports | Exports | Consumed by |
|-------|---------|---------|-------------|
| `@gobing-ai/spur-config` (core) | zod only — no `yaml`, no `node:fs` | `spurConfigSchema`, `DEFAULT_TASKS_DIR`/`DEFAULT_FEATURES_DIR`, all config types (`SpurConfig`, `TaskFoldersConfig`, …) | server (Cloudflare Workers bundle), any runtime-agnostic consumer |
| `@gobing-ai/spur-config/loader` (node) | `yaml`, `node:fs`, ts-runtime | `loadSpurConfig(cwd)`, `resolveConfigFile(cwd)`, `resolvePlanningFolders(fs)`, embedded-schema resolution | CLI, `packages/app` services (on Bun) |

- `loadSpurConfig(cwd, opts?)` returns a fully-typed, validated `SpurConfig`. Missing file → schema
  defaults; invalid YAML/schema → throws (fail fast). `validateJsonSchema` defaults on outside tests;
  pass `embeddedSchemas` so the `$schema` ref resolves inside a `bun --compile` binary (the CLI passes
  `EMBEDDED_SPUR_SCHEMAS`).
- `resolvePlanningFolders(fs)` derives the active + registered task/feature folders, degrading to
  defaults on any error (a broken config must not wedge folder resolution). `@gobing-ai/spur-app`
  re-exports it so app/CLI consumers import from the application layer, not the config package.
- **Type ownership.** `TaskFoldersConfig`/`TaskFolderEntry` are defined once in the loader; services
  re-export, never redefine, so the loader↔service seam shares one identity.
- **Guardrail.** `config/rules/boundary/config-loading-ownership.yaml` blocks `loadStructuredConfig`
  outside `packages/config` and any reference to the retired `docs/.tasks/config.jsonc`.

## 3. Data Shapes

### 3.1 Tables (composed package-owned schema, ADR-007)

| Table | Owner | Purpose |
|-------|-------|---------|
| `workspaces` | CLI | Static workspace binding (name, root, purpose, default agent) |
| `runs`, `phase_runs`, `transition_runs`, `workflow_states` | CLI + workflow engine | Workflow run model |
| `artifacts` | CLI | Captured output references |
| `history_import_ledger` | importer | One row per imported record (hash, source, file, line) |
| `history_import_checkpoint` | importer | Incremental position, composite PK `(source, source_file)` |
| `history_etl_<source>` | importer | Validated per-source ETL rows (`payload_json`, `imported_at`) |
| `inbox_messages` | ts-db (`InboxMessageDao`) | Durable inter-agent message queue; indexed on `(to_id, status)`. Added by migration `0001_spur_cli_team_inbox`; composed into `CLI_SCHEMA_SQL` via `INBOX_MESSAGES_SCHEMA_SQL`. |
| `rule_runs`, `rule_eval_runs` | ts-rule-engine (≥0.3.15) | Persisted rule-run history powering `spur rule trace`; added by migration `0002_spur_cli_rule_history`. `applied_fix_count` is re-stamped by Spur after `applyFixes`. |

### 3.2 SourceDefinition (history import)
One config object per source: `source` discriminant, `displayName`, `filePatterns`, `defaultRoots`,
`splitConfig` (one-to-one | one-to-many | custom), `fieldMap` (raw→canonical), optional
`fieldTransforms`, and a Zod `schema` validating canonical fields. Adding a source = one variant.

### 3.3 Analytics records
`CostRecord` (source, date, model, input/output tokens, costUsd) aggregated into `AnalyticsSummary`
(totals + bySource + byModel + daily). Pricing is per-model USD per 1M tokens.

## 4. Output Conventions

- Human mode: terse, line-oriented, tab-separated where tabular.
- JSON mode (`--json`): a single JSON document to stdout, stable keys for automation.
- Errors go to the error sink with context (what failed, path/identifier); exit codes are meaningful.

## 5. Server/Web Surface (current slice)

| Endpoint | Source |
|----------|--------|
| `GET /api/health` | oRPC `health` procedure → `{ status, timestamp, service, version }` |
| `GET /openapi.json` | Generated from the oRPC contract |
| `GET /` | Redirect to `/api/health` |

Web (`apps/web`) renders live health from the typed oRPC client. Deeper read surface is Phase 4.

### 5.1 Bootstrap (ADR-019)

The server bootstraps through `@gobing-ai/ts-infra` using a runtime-aware split:

| Entry | Bootstrap | Subpath | Workers-Safe? |
|-------|-----------|---------|---------------|
| `src/index.ts` (Bun) | `runNodeApplication` | `ts-infra/application-node` | No (uses `node:fs`) |
| `src/worker.ts` (CF Workers) | `runApplication` | `ts-infra/application` | Yes |

**Shared seam (`src/bootstrap.ts`):**

| Export | Role |
|--------|------|
| `serverBootstrapConfig(env)` | Common `logging`/`telemetry`/`events` block with test-mute guard |
| `createApp(appRt?)` | Hono app factory; optional `ApplicationRuntime` threads `logger`/`events`/`db` into Hono context + oRPC handler `context` |

The Worker entry uses a **lazy singleton** (`let rtPromise`) — no top-level await, `runApplication`
initialized on first `fetch`. The Bun entry uses `runNodeApplication` mirroring the CLI (ADR-017).
## 6. Plugin System (Removed — ADR-012 amended 2026-06-09)

> **Amendment (2026-06-09):** The standalone `@gobing-ai/spur-plugin-sdk` is deleted. The bare
> lifecycle core (`Plugin` + `PluginHost`) lives upstream in `@gobing-ai/ts-infra` (shipped in
> `0.3.6`). Capability registries, trust ladder, manifest-driven discovery, and the server route
> seam are **deferred** — re-addable later on top of the ts-infra `Plugin` interface when a real
> plugin consumer exists. Mechanism lives in `03 §11`.

### 6.1 Current state

Spur consumes the ts-infra `Plugin` interface directly:

```ts
import type { Plugin, PluginHost } from '@gobing-ai/ts-infra/application';
```

The `Plugin` interface provides lifecycle hooks only: `onLoad`, `onStart`, `onStop`, `onUnload`,
plus `failFast`. The `PluginHost` drives registration and lifecycle fan-out (load → start →
stop → unload) with fail-fast load, fail-soft start/stop/unload in reverse registration order.

The `runApplication` / `runNodeApplication` bootstrap accepts `plugins`/`pluginHost` options
and drives the plugin lifecycle natively — no Spur-side host wiring needed.

### 6.2 Deferred (not permanently rejected)

| Concern | Status | Notes |
|---------|--------|-------|
| Manifest (`plugin.yaml`) | Removed | Re-addable as YAML + Zod on the ts-infra `Plugin` interface |
| Capability registries | Removed | 9 registries (api, command, event, harness, provider, rule, skill, ui, worker) — re-addable |
| Trust ladder | Removed | 4-tier (`bundled` > `curated` > `local` > `untrusted`) — re-addable as registration-time gating |
| CLI plugin command | Removed | `spur plugin list|info` — re-addable when plugin discovery returns |
| Server route seam | Removed | `mountPluginRoutes` / `collectPluginOpenApiPaths` — re-addable when plugins exist |
| Plugin config override | Removed | Per-plugin `.spur/plugins/<name>.yaml` — re-addable |
| Event registry | Removed | Glob-pattern + rate-limiting wrapper over `EventBus` — re-addable |

## 7. Planning Layer Surface (reserved — ADR-020; filled by Roadmap §1.5 Stage D)

Landing zone for the rd3-migration design output, reserved now so the system design has a defined
home and lands as subsection fills, not doc restructuring. Nothing below is invokable until
shipped (`05 §9` tracks status).

| Subsection | Will own | Design input until filled |
|------------|----------|---------------------------|
| 7.1 `spur task` commands | Verbs, flags, exit codes — CRUD, WBS, `--section --from-file`, list/kanban, check, batch-create, resolve, migrate | triage doc Group A |
| 7.2 `spur feature` commands | Verbs/flags — CRUD, INDEX refresh, task-links, check, goal derivation | triage doc Group B + the feature-file design spec (`cc-agents/docs/plans/2026-06-10-rd3-tasks-operator-feedback.md`) |
| 7.3 Frontmatter schemas | Zod field tables for task + feature files incl. `schema_version`, `parent_wbs`, `feature-id`, status enums | same design spec + triage A18/X02 | `packages/domain/src/planning/schema.ts`; `taskFrontmatterSchema`, `featureFrontmatterSchema`, `TaskStatus`, `FeatureStatus` (DD-01/02/03/07/10/13/14). |
| 7.4 Section-Status-Matrix + format rules | Config file shapes under `./config` (ADR-015); warning-first enforcement core | triage A13/A14; `03 §12.3` |
| 7.5 Lifecycle workflow definitions | `config/workflows/` task/feature lifecycle YAML shapes + guard wiring | ADR-022; `03 §12.2` |
| 7.6 Task DTOs | oRPC contract shapes for the board | server/web design task (ADR-021.b) |
| 7.8 `sp:dev-*` command operations | Dev-* operation map (13 ops: 9 `Skill()`-backed + 4 inline; `implement` is a sub-mode of `run`; `dev-dogfood` → `sp:dogfood-testing`) | `plugins/sp/skills/spur-dev/references/dev-operations.md` |

### 7.1 `spur task` commands

Core CRUD and utility verbs. Every subcommand supports `--json` (ADR-010 invariant).
Source: delivery §1.1, design §10.

| Command | Flags | Exit | Notes |
|---------|-------|------|-------|
| `spur task` | — (noun help) | 0 | Lists subcommands if no subcommand given. |
| `spur task create <title>` | `--feature <id>` `--parent <wbs>` `--template <variant>` `--folder <path>` `--json` | 0/1/2 | Race-safe WBS allocation; `--feature` enables B09 Goal→Background derivation; `--template` selects a section-matrix variant (`standard·feature-impl·issue·review·meta·brainstorm`; default `feature-impl` when `--feature`, else `standard`); unknown variant → exit 2. |
| `spur task show <wbs>` | `--folder <path>` `--json` | 0/1 | Frontmatter is a top-level field in `--json` output. |
| `spur task update <wbs> <status>` | `--section <name> --from-file <path>` `--feature <id>` `--priority <p>` `--folder <path>` `--json` | 0/1/2 | Status transition runs lifecycle guard; `--section` reads body from file; `--feature`/`--priority` set the scalar frontmatter field on an existing task (the only post-create path, allow-listed to `feature_id`/`parent_wbs`/`priority`). |
| `spur task list` | `--status <s>` `--phase <p>` `--parent <wbs>` `--feature <id>` `--folder <path>` `--json` | 0/1 | `--phase` is a legacy alias for `--status`; `--feature` filters to tasks carrying that `feature_id` edge (exact match) — the enumeration primitive for feature-level execution loops. Filters combine (AND). |
| `spur task refresh` | `--folder <path>` `--json` | 0/1 | Re-scan the task corpus and report counts. The generated `kanban.md` artifact was retired in the A17 cutover (task 0192) once the web task-kanban board (task 0191) became the daily driver — this verb no longer writes any file. `--json`: `{folders, tasks}`. |
| `spur task refresh-roster <wbs>` | `--folder <path>` `--json` | 0/1 | Regenerate a parent's sub-task roster block inside its `## Plan` (the generator half of the 0121 roll-up gate, task 0123). Scans `parent_wbs` children, renders a WBS·title·status table between `refresh-roster` auto-gen markers, and writes it idempotently — inserting the block (preserving hand-written Plan content) when absent, rewriting it in place when present. Zero children → clean no-op (`written:false`); no `## Plan` → error. `--json`: `{wbs, childCount, written}`. |
| `spur task migrate` | `--dry-run` `--folder <path>` `--json` | 0/1 | Run the A17 task corpus normalization pass over the active task folder or `--folder`. `--dry-run` computes the full per-file report with zero writes; apply writes through the corpus migrator's atomic write path. Idempotent: a second run over a migrated corpus is a no-op. The live `docs/tasks2/` corpus was migrated 2026-07-04 (task 0192). |
| `spur task batch-create --file <json>` | `--folder <path>` `--json` | 0/1 | Create many tasks from validated JSON — all-or-nothing for child creation; validated against `apps/cli/schemas/task-batch.schema.json` (A08/C03). After children land, every distinct `parent_wbs` is wired best-effort: parent roster refresh + `todo→wip` lifecycle transition. `--json`: `{created, wbs, parentsWired:[{wbs, rostered, transitionedTo, errors[]}]}`. |
| `spur task resolve <file-path>` | `--folder <path>` `--json` | 0/1 | Maps a path to owning task (WBS + file). Returns 1 if no match. Strategies: direct match, filename WBS parse, walk-up (A10). |
| `spur task check [<wbs>]` | `--strict` `--strict-core` `--folder <path>` `--json` | 0/1 | Four-layer validation (§3). L4 traceability: `feature_id`/`parent_wbs`/`dependencies` edge resolution + **AC coverage** (DD-09: task scenarios must be a subset of the linked feature's AC by normalized title — warnings by default) + **parent↔child roll-up** (ADR-020 amendment 2026-06-25, task 0121: for a decomposition parent, warn when the parent is `done` with an open child, when all children are closed but the parent is still open, or when the parent `## Plan` lacks a sub-task roster table — all warnings, `--strict` elevates; inert for tasks with no children). Validates all tasks when `<wbs>` omitted; `--strict` elevates ALL warnings; `--strict-core` is the `testing→done` gate variant (fails only on hard-core errors — Solution `file:line`, Review P1–P4, and `gate:true` required-section misses — without the blanket elevation). Matrix loaded from `config/tasks/section-matrix.yaml`. |
| `spur task verdict <wbs>` | `--from-answer <path>` `--folder <path>` `--json` | 0/1 | Derive the PASS/PARTIAL/FAIL/UNKNOWN gate verdict from the verify-step answer file and write `.spur/run/<wbs>-verdict.json`. Parses requirement rows, AC rows, and checks rows; behavior-bearing CORE AC rows marked `MET` without `test`/`command` evidence are downgraded to `PARTIAL` and surfaced via `evidence-rule-failed`. The deterministic replacement for grep-over-prose in the pipeline verify step (0109). Consumed by the completion gate and by `spur task record`. |
| `spur task record <wbs>` | `--verdict-file <path>` `--solution-from-diff` `--transition <status>` `--folder <path>` `--json` | 0/1 | Write Testing/Review from verify verdict; optional Solution backfill from `git diff` and status transition. Preserves `acceptanceCriteria[]` evidence rows in Testing when present. Never transitions to `done` — the gate stays in the workflow (0108). |

**Exit codes:** 0 success, 1 error, 2 invalid usage. Follows the design §10 `api-response` envelope
for `--json` output (`{ ok, data? }`).

### 7.2 `spur feature` commands

Core feature verbs over `PlanningWriteService` (same write path as tasks). Features use
position-encoding hierarchical IDs (DD-14): single-letter top-level groups, children append one
digit 1–9 per level; ID length = depth; parent = drop the last character; **no `parent_id` field**.
Every subcommand supports `--json` (ADR-010 invariant). Source: delivery §1.2, design §2.2/§2.4.

| Command | Flags | Exit | Notes |
|---------|-------|------|-------|
| `spur feature` | — (noun help) | 0 | Lists subcommands if no subcommand given. |
| `spur feature create <name>` | `--parent <id>` `--folder <path>` `--json` | 0/1 | ID allocated under the create-lock (R1): `--parent` → next free child digit 1–9; no parent → next free group letter A–Z. |
| `spur feature show <id>` | `--folder <path>` `--json` | 0/1 | Returns the feature summary + content; 1 if not found. |
| `spur feature update <id> [status]` | `--field <key> --value <v>` `--section <name> --from-file <path>` `--folder <path>` `--json` | 0/1/2 | `<status>` runs the lifecycle transition (guarded, §7.5); `--field/--value` sets a scalar frontmatter field; `--section/--from-file` replaces an existing feature section body using the same body-only contract as `spur task update --section`. Section, field, and status updates may be composed in one invocation and apply in that order. 2 if an option pair is incomplete. |
| `spur feature advance <id>` | `--to <status>` `--folder <path>` `--json` | 0/1 | Walk a feature through the legal forward lifecycle path (`backlog→active→verifying→done`, default target `done`). Runs the same feature checks the old wrapup shell ladder used before guarded hops (`active→verifying` non-strict, `verifying→done` strict), verifies observed status after each transition, and returns `{id,status,hops}` in `--json`. |
| `spur feature list` | `--status <s>` `--priority <p>` `--folder <path>` `--json` | 0/1 | Lists features sorted by ID; optional status/priority filters. |
| `spur feature check [<id>]` | `--strict` `--folder <path>` `--json` | 0/1 | Four-layer validation (§3): L1 schema, L2 section-matrix, L3 BDD AC (shared 0043 module) + one-active-P0-goal over {active,verifying} + ≤9-children (DD-14, corpus-derived), L4 incoming `feature_id` edges + orphan-scenario warnings + **AC coverage** (DD-09: feature scenarios covered by no linked task = warnings) + verifying-readiness (linked tasks not done/cancelled). Validates all features when `<id>` omitted; `--strict` elevates warnings. |
| `spur feature refresh` | `--folder <path>` `--json` | 0/1 | Regenerate `INDEX.md` (deterministic ID-encoded tree, per-node status badge + relative link, §4.3) and repopulate each feature's `## Tasks` auto-gen marker region from task `feature_id` edges. Only the marker region is rewritten; the rest of the feature file and all task files are byte-preserved. |
| `spur feature move <id> --parent <id>` | `--parent <id>` `--dry-run` `--folder <path>` `--json` | 0/1 | Cascade-rename (DD-14): re-IDs the node + all descendants (ID encodes position), renames their files, rewrites each `id` frontmatter + appends a move History line, and updates every task `feature_id` edge. Validates the full old→new plan first (collision / ≤9 / not-into-own-subtree); applies atomically with best-effort rollback. `--dry-run` returns the old→new map + affected tasks with zero writes. Omit `--parent` to move to a top-level group. |

ID rules (DD-14): valid IDs match `^[A-Z][1-9]*$`. The `## Tasks` auto-gen markers are
`<!-- AUTO-GENERATED by spur feature refresh -->` … `<!-- END AUTO-GENERATED -->` (recognized by
`MarkdownDocument.replaceMarkerRegion`). The full `spur feature` surface
(create/show/update/advance/list/check/refresh/move) is now live.

### 7.3 Frontmatter schemas

Task and feature files share a `schema_version: 1` strictness gate (DD-03) and are written only
through `PlanningWriteService` (§7.5). Canonical field tables below; authority is the Zod schemas
in `packages/domain/src/planning/schema.ts` (`taskFrontmatterSchema`, `featureFrontmatterSchema`).

### 7.3.1 Task frontmatter — `taskFrontmatterSchema`
Mirrors `docs/design/rd3-migration-design.md` §2.1. Exported by
`@gobing-ai/spur-domain` from `packages/domain/src/planning/schema.ts`.

| Field           | Zod type | Req | Notes |
|-----------------|----------|-----|-------|
| `schema_version`| `z.literal(1)` | ✔ | Strictness gate; future evolution (DD-03). |
| `name`          | `z.string().min(1)` | ✔ | Title; used in slug. |
| `description`   | `z.string().optional()` | — | No `description == name` default (DD-10). |
| `status`        | `z.enum(TASK_STATUSES)` (transform → lowercase) | ✔ | See §7.3.3; aliases accepted on input only. |
| `type`          | `z.enum(['task','brainstorm']).default('task')` | — | `brainstorm` retained for corpus compat. |
| `profile`       | `z.enum(PROFILES).optional()` | — | Single key (DD-02); legacy `preset` collapsed. |
| `feature_id`    | `z.string().regex(/^[A-Z][1-9]*$/).nullable().optional()` | — | Single traceability edge (DD-07). |
| `parent_wbs`    | `z.string().regex(/^\d{4}$/).nullable().optional()` | — | Single sub-task convention (X02). |
| `priority`      | `z.enum(['P0','P1','P2','P3']).optional()` | — | Aligned with the feature priority scale. |
| `tags`          | `z.array(z.string()).optional()` | — | Free-form filtering. |
| `dependencies`  | `z.array(z.string()).optional()` | — | Soft WBS refs; `check` warns on dangling. |
| `created_at`    | ISO 8601 string | ✔ | Write-service-owned. |
| `updated_at`    | ISO 8601 string | ✔ | Written **only** by the write service. |

Removed from the legacy schema (A17): `impl_progress` (frozen-state problem), `folder` (derivable from
file location), `preset` (collapsed into `profile`).

### 7.3.2 Feature frontmatter — `featureFrontmatterSchema`

Mirrors `docs/design/rd3-migration-design.md` §2.2. No `parent_id` field (DD-14): the parent is derived
by dropping the last character of `id`.

| Field           | Zod type | Req | Notes |
|-----------------|----------|-----|-------|
| `schema_version`| `z.literal(1)` | ✔ | Same evolution mechanism as tasks. |
| `id`            | `z.string().regex(/^[A-Z][1-9]*$/)` | ✔ | Position-encoding hierarchical ID (DD-14). |
| `name`          | `z.string().min(1)` | ✔ | |
| `status`        | `z.enum(FEATURE_STATUSES)` (transform → lowercase) | ✔ | See §7.3.3; `verifying` is canonical. |
| `priority`      | `z.enum(['P0','P1','P2','P3']).optional()` | — | Optional for parity with tasks; consumers default a missing value to `P2`. The P0 feature in `active`/`verifying` is the project goal (B09). |
| `tags`          | `z.array(z.string()).optional()` | — | |
| `created_at`    | ISO 8601 string | ✔ | Write-service-owned. |
| `updated_at`    | ISO 8601 string | ✔ | Write-service-owned. |

### 7.3.3 Canonical status vocabularies

Lowercase canonical values (DD-01); display layers capitalize. Input is case-insensitive and
alias-tolerant. The legacy alias map is preserved as input normalization — never as storage.

| Domain    | Canonical values |
|-----------|------------------|
| `TaskStatus`    | `backlog · todo · wip · testing · blocked · done · cancelled` |
| `FeatureStatus` | `backlog · active · verifying · blocked · done · cancelled` (DD-13) |

Input normalization (excerpt, full map lives in `normalizeTaskStatus` / `normalizeFeatureStatus`):
`completed → done`, `in-progress / in_progress / in progress → wip (task) or active (feature)`,
`dropped / canceled / cancel → cancelled`, `review / in-review / in_review → verifying` (feature only),
`pending / new → backlog`, mixed case accepted via `.trim().toLowerCase()`. Storage is always the
lowercase canonical form; aliases never persist.

**Status icon SSOT (R1).** `TASK_STATUS_ICONS` and `FEATURE_STATUS_ICONS` in
`packages/domain/src/planning/schema.ts` map each canonical status to a presentation emoji.
Consumed by the board toggle group, swimlane headers, and CLI `spur task show`/`list` output.
Storage values stay lowercase canonical (DD-01); the icon is presentation-only and never persisted.

### 7.4 Section-Status-Matrix + planning event catalog

**Section-Status-Matrix.** Source: `config/tasks/section-matrix.yaml` (schema:
`apps/cli/schemas/section-matrix.schema.json`). The YAML declares a root `$schema` ref and is loaded
+ validated by the standard `loadStructuredConfig` path (`loadSpurConfig` in
`apps/cli/src/config/loader.ts`, with the schema embedded for `--compile` binaries) — a typo'd section
name or status key fails loud at load instead of becoming a dead rule. (The Zod `sectionMatrixSchema`
in domain remains the typed contract + unit-test surface.) Each **template variant**
(`standard·feature-impl·issue·review·meta·brainstorm` — the unified
`TASK_VARIANTS` axis selected by a task's `template:` frontmatter, defaulting to `standard`) maps a
status → { required, optional, forbidden } section lists, evaluated by `spur task check` /
`spur feature check` (the L2 layer, design §3.2). `spur task check` resolves the variant from
`fm.template ?? 'standard'` (not `type`). Ships permissive (warning-first); the hard-gate core is the
`done` status (Solution + Testing + Review required, `gate: true`) plus the AC/Solution/Review format
rules. Authority for matrix semantics: design §3 (the L2 layer), delivery §3.2.

**Matrix-driven creation (single producer).** The same matrix drives which sections a *new* task
file carries, **per variant**. `spur task create` / `batch-create` render the body via the canonical
`buildTaskSkeleton` (`packages/domain/src/planning/task-skeleton.ts`) from the matrix entry for the
chosen variant + creation status — there is no second, inline section list in `task-service.ts` (the
removed drift that shipped empty `Requirements`/`Q&A` headings). Per-variant section **bodies** (e.g.
`review`'s `#### Review Findings` input table under Background) come from the scaffold template files
(`config/templates/task/<variant>.md`), extracted by `extractTemplateBodies` and merged under the
task-specific bodies (Background/Requirements) — so variant boilerplate is **data, never hardcoded**.
Each remaining unfilled section gets an invisible HTML guidance comment (skipped by the L3 format
rules via `isPlaceholderBody`). **Creation status (§2.3 semantics):** a spec'd task (a `--feature`
link, or a batch item with `background`/`requirements`) is created at **`todo`** ("ready to execute"
— the HITL review gate, so Acceptance Criteria + Design + Plan are present); a bare capture is created
at **`backlog`** ("still preparing" — Background only). `Solution` is the implementation change-map
and first appears at `wip`; the L3 `file:line` rule only fires once it has real content.
`History`/`References`/`Notes` are universally allowed by the closed-world check (structural, present
throughout the lifecycle).

**Planning event catalog (X04).** The six planning events on `PlanningEventMap` + three engine-seam
events. All planning events are emitted by `PlanningWriteService` (design §7) and persisted to the
`planning_events` table (append-only ledger, rehydratable from `## History`). SSOT for the names is
the code: `packages/app/src/services/planning-write-service.ts` (`PlanningEventName` union) and
`packages/app/src/services/planning-events.ts` (`PlanningEventMap`). Document, never invent.

| Event | Fired when |
|---|---|
| `task.created` | A task file is created (including each item of a `batch-create`). |
| `task.updated` | Any non-status write to a task (section edit, frontmatter change). |
| `task.transitioned` | A task status change completes through the lifecycle workflow (includes cancellation). |
| `feature.created` | A feature file is created. |
| `feature.updated` | Any non-status write to a feature. |
| `feature.transitioned` | A feature status change completes (includes cancellation). |

Engine-seam events (from `ts-dual-workflow-engine`, per lifecycle/pipeline run — ADR-022):

| Event | Fired when |
|---|---|
| `on_transition` | A workflow run moves between states — the seam planning events derive from. |
| `on_guard_fail` | A guard (e.g. `spur task check` pre-gate) blocks a transition. |
| `on_complete` | A workflow run reaches its terminal state. |

### 7.5 Lifecycle workflow definitions

Source: `config/workflows/task-lifecycle.yaml`, `config/workflows/feature-lifecycle.yaml`.
Authority: ADR-022 (lifecycles are engine configuration — no local FSM); design §2.3 (graphs +
guard placements), §5.1 (skeleton). Both are `kind: state-machine` definitions validated against
the engine schema shipped by the CLI, referenced as
`@gobing-ai/spur/schemas/state-machine-workflow.schema.json` (the schema file lives at
`apps/cli/schemas/state-machine-workflow.schema.json` and is exported via the package's
`./schemas/*` map).

| File | States (§2.3) | Initial | Terminal | Guards |
|------|---------------|---------|----------|--------|
| `task-lifecycle.yaml` | `backlog · todo · wip · testing · blocked · done · cancelled` | `backlog` | `[cancelled]` | `wip→testing`: `spur task check <wbs>`; `testing→done`: `spur task check <wbs> --strict-core` |
| `feature-lifecycle.yaml` | `backlog · active · verifying · blocked · done · cancelled` (DD-13) | `backlog` | `[cancelled]` | `active→verifying`: `spur feature check <id>`; `verifying→done`: `spur feature check <id> --strict` |

Guard commands reference the check verbs (tasks: 0051/0057). The engine integration is **live**:
`spur task update <wbs> <status>` (0055) and `spur feature update <id> <status>` (0059) drive these
graphs through the dual-workflow engine via `LifecycleAdapter` / `FeatureLifecycleAdapter`
(create-or-attach a durable run keyed `task:<wbs>` / `feature:<id>`, file-wins re-seed per DD-04,
then `requestTransition` — a denied guard aborts the write with its report). The feature
`active→verifying` guard is non-blocking (warns when linked tasks aren't all done/cancelled, DD-13);
`verifying→done` is blocking (`feature check --strict`); `verifying→active` is rework (mandatory
History entry). Unconditional transitions use the engine's `always` guard (externally-driven via
`requestTransition`, not auto-advance). `done` is re-enterable (reopen, warned); `cancelled` is
truly terminal (no outgoing transitions).

**Status normalization invariant (0152):** the raw frontmatter `status` is case-normalized
(`normalizeTaskStatus` / `normalizeFeatureStatus`) at the `PlanningWriteService` boundary before
`requestTransition`, so the file-wins re-seed always receives a canonical lowercase state even when
the stored value is capitalized (`Backlog`), aliased (`completed`), or otherwise non-canonical. This
service-boundary normalization is the sole production entry into the engine transition path; removing
it re-introduces the `FSMError: Cannot reseed run … to undeclared state` crash for any case-drifted
task. See `packages/app/src/services/planning-write-service.ts:326,367`.

**Drift prevention:** `packages/domain/tests/planning/lifecycle-drift.test.ts` parses both YAMLs
and asserts state sets == the `TASK_STATUSES` / `FEATURE_STATUSES` unions from `schema.ts`. The
YAML files and the 0041 enums can never drift silently.

Validate: `spur workflow validate config/workflows/task-lifecycle.yaml` — full JSON-Schema
validation resolves the `@gobing-ai/spur` workspace package and passes (no `--no-schema`
needed). `feature-dev.yaml` uses the same resolvable ref.

**Task execution pipeline** — `config/workflows/task-pipeline.yaml` (design §6, ADR-022
"orchestration is configuration": YAML over the existing engine, zero engine code). `kind:
state-machine`, `vars: { wbs, profile }`, shape `precheck → implement → test → review → approve(HITL)
→ verify → record → done` (precheck failure short-circuits to `failed`). Invariants: it never touches
files directly — `precheck` is a `spur task check <wbs>` shell guard; `implement/test/review/verify` are
`agent.run` steps carrying `sp:dev-*` inputs; status moves use the normal `spur task update <wbs>
`spur task record` (0108); `approve` is a `hitl.confirm` gate skippable with `--vars '{"profile":"auto"}'`.
`spur task update --section`; `approve` is a `hitl.confirm` gate skippable with `--vars '{"profile":"auto"}'`.
**Step→command mapping (ADR-026):** `implement` → `/sp:dev-run --mode implement` (NOT `/sp:dev-run --mode full` — that
would drive this pipeline, so calling it in full mode inside recurses); `test` → `/sp:dev-unit`; `review` →
`/sp:dev-review` (→ `sp:super-reviewer` → `sp:code-verification` + `sp:functional-review` + `sp:code-improvement`;
the review step fans out to three dimensions — SECUA / functional / architecture — via the super-reviewer agent, task 0227); `verify` → `/sp:dev-verify` (→ `sp:code-verification` verify mode). **Completion gate (ADR-026):** the `verify` step emits
`.spur/run/<wbs>-verdict.json`; the `verify → record` transition is a shell guard asserting
`jq -r .verdict … = PASS`, with a sibling `verify → failed` on the negation — so a PARTIAL/FAIL/missing
verdict blocks `done`. This is the spur-native replacement for rd3's default-on `--postflight-verify`.
**Follow-up:** `task_run_links` linkage (kind=pipeline, R4) needs a small `WorkflowService` run-start hook
— there is no link-writing CLI verb to call from a shell step, so it can't live in pure YAML.
**Step timeout (ADR-026 amendment, 2026-06-23, task 0107):** each `agent.run` step carries a
`timeoutMs: ${vars.stepTimeoutMs}` option (default `"600000"` — 10 min). On elapse the ts-libs
`ProcessExecutor` kills the subprocess (never abandons it); the agent step exits non-zero
→ `ok:false` → pipeline routes to `failed`. Overridable per run via
`--vars '{"stepTimeoutMs":"120000"}'`. The `agent.run` action surface accepts `timeoutMs`
(number parsed from the workflow option or CLI string flag `--timeout`), forwarded through
`AgentService.executeRun` → `AiRunner.runPromptCommand` → `ProcessExecutor.run({ timeout })`.

**Pipeline section-ownership model (ADR-026 amendment, 2026-06-23, task 0106):** every
`done`-required section ([Solution, Testing, Review]) is owned by exactly one pipeline step:

| Required section | Owning step | When |
|------------------|-------------|------|
| `Solution` (change-map) | `/sp:dev-run --mode implement` | After writing code — the implement agent authors a markdown table of changed files with `file:line` + `what/why`. Idempotent (upsert via `replaceSection`); writes only when the section is bare (absent, empty, or a placeholder). |
| `Testing` (verdict table) | `record` | Post-verify — transcribes the per-requirement verdict + evidence from `.spur/run/<wbs>-verify-answer.txt` and `.spur/run/<wbs>-verdict.json`. |
| `Review` (P1–P4 findings) | `record` | Post-verify — transcribes SECU findings from the verify output. |

The `record` step provides a **Solution safety-net**: if the implement step didn't write
`## Solution`, `record` backfills a minimal change-map from `git diff --name-only`. A
`sectionIsBare` predicate (in `packages/app/src/services/task-service.ts`) detects absent,
empty/whitespace, or placeholder sections — the single reusable mechanism behind all three
writes.

**Done gate:** the `record → done` transition runs a shell guard `spur task check <wbs>`
with a `record → failed` sibling on negation — mirroring the `verify → record` verdict gate
exactly. The guard passes because every required section was guaranteed upstream; a genuinely
non-compliant task routes to `failed` instead of a silent bad `done`.

**Pipeline section-ownership model (ADR-026 amendment, 2026-06-23, task 0106):** every
`done`-required section ([Solution, Testing, Review]) is owned by exactly one pipeline step:

| Required section | Owning step | When |
|------------------|-------------|------|
| `Solution` (change-map) | `/sp:dev-implement` | After writing code — the implement agent authors a markdown table of changed files with `file:line` + `what/why`. Idempotent (upsert via `replaceSection`); writes only when the section is bare (absent, empty, or a placeholder). |
| `Testing` (verdict table) | `record` | Post-verify — transcribes the per-requirement verdict + evidence from `.spur/run/<wbs>-verify-answer.txt` and `.spur/run/<wbs>-verdict.json`. |
| `Review` (P1–P4 findings) | `record` | Post-verify — transcribes SECU findings from the verify output. |

The `record` step provides a **Solution safety-net**: if the implement step didn't write
`## Solution`, `record` backfills a minimal change-map from `git diff --name-only`. A
`sectionIsBare` predicate (in `packages/app/src/services/task-service.ts`) detects absent,
empty/whitespace, or placeholder sections — the single reusable mechanism behind all three
writes.

**Done gate:** the `record → done` transition runs a shell guard `spur task check <wbs>`
with a `record → failed` sibling on negation — mirroring the `verify → record` verdict gate
exactly. The guard passes because every required section was guaranteed upstream; a genuinely
non-compliant task routes to `failed` instead of a silent bad `done`.

**Planning pipeline** — `config/workflows/planning-pipeline.yaml` (task 0088; design §6). Front-half
of the dev workflow: `phasing(HITL) → feature-id → design-gen → design-approval(HITL) → handoff`.
`kind: state-machine`, `vars: { slug, profile, feature }`, same engine as `task-pipeline.yaml`
(ADR-022 — zero new engine code). Companions the `sp:spur-plan` skill (how-to-think for the
non-deterministic steps: phasing judgment, feature-ID derivation, design-doc authoring). HITL gates
use `hitl.confirm`, skippable with `--vars '{"profile":"auto"}'` (Q4). Doc-write discipline (Q3):
auto-writes derived docs (`docs/design/*`, `docs/features/*`); **stages** `02_ROADMAP`/`04_DESIGN`
index edits to `docs/plans/` for human commit. Every authoritative-doc touch invokes `sp:doc-evolve`
(§5 sync triggers). Terminal at `handoff` (drafted feature list → `sp:spur-dev` steps 7–12) or
`cancelled`. Validates against the workspace state-machine schema.
### 7.6 Task DTOs (oRPC contract)

Transport DTOs live in `packages/contracts/src/task.ts` and are the single source of truth for the
wire shape. Domain types stay in `@gobing-ai/spur-domain`; transport DTOs belong in `packages/contracts`.

| DTO | Key fields | Notes |
|---|---|---|
| `taskSummarySchema` | `wbs, name, status, priority?, featureId?, parentWbs?, type?, filePath, updatedAt?` | List response. `type` and `priority` are extracted from frontmatter by the server handler. `priority` is a free-form `z.string()` (not the `PRIORITIES` enum) because the corpus mixes `P0–P3` with `high/medium/low`; the raw value is passed through. |
| `taskCreateInputSchema` | `title, featureId?, parentWbs?, folder?, template?` | `template` selects a `TASK_VARIANTS` scaffold (R8); defaults to `standard` or `feature-impl` (when `featureId` set). |
| `taskActionInputSchema` | `wbs, action, channel?, skipDeps?` | `action` ∈ `refine\|plan\|run\|verify\|decompose\|evaluate`. `channel` ∈ `claude\|codex\|gemini\|pi\|opencode\|antigravity\|openclaw`; `skipDeps` is persisted in the queued job metadata for dependency-bypass-aware runners (R9). |
| `taskFolderSchema` | `path, label?` | Folder entry from `docs/.tasks/config.jsonc` (R6). |

### 7.7 Workflow action primitives for anti-hallucination (ADR-024)

Two primitives back the anti-hallucination migration (superskill task 0041):

| Primitive | Surface | Description |
|---|---|---|
| `AgentService.runCapture` | `packages/app/src/services/agent-service.ts` | Opt-in capture path: returns `{ exitCode, answer }` without streaming or diagnostics. Uses buffered output mode. |
| Workflow `agent.run` | `packages/app/src/workflow/actions/agent-run.ts` | Always dispatches through `AgentService.runTraced`: buffered output, non-interactive stdin, and a sanitized resolved invocation persisted in `ActionResult.data`. `capture: true` only surfaces buffered stdout as `data.answer`. Direct `spur agent run` keeps its TTY-aware `run` / `runCapture` paths. |
| `response.validate` action | `packages/app/src/workflow/actions/response-validate.ts` | Reads `text` from options, calls injected `ResponseValidateEngine.validate()`, maps `{ ok, reason, issues }` to `ActionResult`. Engine injected via `SpurWorkflowBuiltinsOptions.responseValidateEngine` in `builtins.ts`. |

**Engine seam:** `ResponseValidateEngine` interface (`{ validate(text: string): { ok, reason, issues? } }`) is the contract. The concrete engine is owned by superskill 0041 and provided by the externally-installed `cc:anti-hallucination` skill; the caller wires a thin adapter over its surface. The in-repo copy (`plugins/sp/skills/anti-hallucination/`) was removed once the migration completed (ADR-024 amendment, 2026-06-20); the seam itself is DI-only and unchanged.

**Retry/deny pattern:** transition-flow spike (`packages/app/tests/fixtures/anti-hallucination-spike.yaml`) confirms `validate → ok:done | fail:generate(bounded) | exhausted:denied` is expressible. `iterationBound` caps retries; a proper retry-count guard (checking `vars.__retryCount`) is future work (R3.1).

### 7.8 `sp:dev-*` command operations

The `sp:dev-*` commands back onto the orchestration spine plus competency skills
(`sp:spur-dev`, `sp:code-implementation`, `sp:code-testing`, `sp:code-verification`,
`sp:functional-review`, `sp:code-improvement`, `sp:doc-evolve`, `sp:brainstorm`, `sp:dogfood-testing`) or define their procedure inline. The
authoritative reference for all 13 operations — purpose, inputs, backing, behavior contract — is
[`plugins/sp/skills/spur-dev/references/dev-operations.md`](../plugins/sp/skills/spur-dev/references/dev-operations.md).
The `runall` operation (#13) is the batch entry — it delegates the driver loop to the
`sp:super-coder` agent per [`execution-batch.md`](../plugins/sp/skills/spur-dev/references/execution-batch.md).
The `review` operation resolves to deterministic modes: WBS mode runs functional traceability (`sp:functional-review`), SECUA framework (`sp:code-verification`), and architectural depth (`sp:code-improvement`), writing findings to the task's `## Review` section; Path mode runs advisory SECUA and architecture with no task mutation. `--fix` and `--next` are deprecated (no-op + warning; route remediation → `/sp:dev-verify --fix`, progression → `/sp:dev-next`).
The `handover` operation writes the durable handover SSOT to `docs/handover/<YYYY-MM-DD>-<slug>.md` and appends a pointer link into the task's `References` / `Notes` without clobbering existing content.
See [`dev-operations.md`](../plugins/sp/skills/spur-dev/references/dev-operations.md).

| Pattern | Operations | Backing |
|---------|-----------|---------|
| `Skill()` delegation | implement, unit, review, verify, run, refine, plan, docs, brainstorm, dogfood, runall, debug, daily | `sp:code-implementation`, `sp:code-testing`, `sp:code-verification`, `sp:functional-review`, `sp:code-improvement`, `sp:spur-dev`, `sp:doc-evolve`, `sp:brainstorm`, `sp:dogfood-testing`, `sp:sys-debugging`, `sp:daily-summary` |
| Inline procedure | changelog, gitmsg, fixall, handover | git CLI + `spur` CLI + agent reasoning |

**Brainstorm artifact exits.** `dev-brainstorm` runs the grilling interview → ideation, then lands an
artifact via one of two **mutually exclusive** exits:

- `--task [<feature-id>]` — one `todo` task via `spur task create` (the fast path for a single unit
  of work; skips feature/AC ceremony on purpose).
- `--feature [<parent-id>]` — the **front-half entry**: `spur feature create`, then author Goal/Scope
  and BDD acceptance criteria from the decision trace through
  `spur feature update --section <name> --from-file <path>`, then loop
  the `spur feature check` gate to exit 0. Lands a validated feature and hands off to
  `/sp:dev-plan --feature <ID>` for schema-gated decomposition. Passing both exits is an error.

> **`dev-new-task` retired (2026-06-25).** The standalone single-task command was a thin wrapper over
> `spur task create` + intake; its use cases are absorbed by `dev-brainstorm --skip-discovery --task`
> (same result, seeds Background/Requirements/Plan). Operation count dropped 12 → 11.

**Pipeline step→command mapping (ADR-026):** `implement` → `/sp:dev-run --mode implement`, `test` → `/sp:dev-unit`,
`review` → `/sp:dev-review`, `verify` → `/sp:dev-verify` (§7.5). The remaining commands are
operator-invoked, not pipeline-driven.

### 7.8a Process inventory (Observability → Processes)

Task **0243**. The Processes tab is a **read-only** serve-rooted runtime inventory — not the
team control plane (`/api/team/*`).

| Surface | Contract |
| --- | --- |
| `GET /api/observability/processes` | Snapshot of the serve PID tree + supervisor overlay |
| Success body | `{ processes: ProcessInventoryRow[], rootPid: number, capturedAt: string }` |
| Row fields | `pid`, `ppid`, `depth`, `source` (`serve` \| `supervisor` \| `descendant`), `label`, optional `agentId`, `command` (may be truncated), `status`, `rssBytes`, `elapsedSeconds`, `startedAt` |
| Unsupported OS | `501` + `{ error, code: "UNSUPPORTED_PLATFORM" }` (macOS + Linux only in v1) |
| Team APIs | Unchanged — `GET /api/team/processes` remains supervised-agents-only for control clients |

**Mechanism:** `ProcessInventoryService` (`packages/app`) walks OS processes via a
`ProcessInspector` port (default: `ps -axo pid=,ppid=,rss=,etime=,command=`), filters to
descendants of `process.pid`, and overlays `SupervisorService.list()` by pid for agent labels.
Board UI polls every ~3s. Threads/%CPU, host-wide shell `spur` CLIs, and ProcessExecutor live
registry enrichment are deferred.

### 7.8b Tool-use ledger (Observability → Tool Using)

Tasks **0245** / **0246** / **0247** / **0248**. The Tool Using tab is a **read-only** tail of the
project token ledger written by indexed-context hooks (task 0232) — not a second event store and not
a control plane.

| Surface | Contract |
| --- | --- |
| `GET /api/observability/tool-use?limit=&before=` | Newest-first page; `before` = exclusive ISO cursor for older pages |
| Query | `limit` default **200** max **1000**; optional `before` |
| Success body | `{ events, count, limit, truncated, path, capturedAt, sparseToolActivity, nextBefore }` |
| `nextBefore` | Oldest `ts` in page when more older events exist; else `null` (load-more cursor) |
| Event fields | `seq` (0=newest in page), `ts`, `session`, `type`, optional `file`, `summary`, `tokens`, `action`, `totals`, `sessionId`, `agent`, `model` |
| Types | `session_start` / `session_end` / `read` / `write` / `bash` / `grep` / `glob` (Edit → `write` + `action=edit`) |
| Token semantics | Present only when estimated; **omit** when unknown (UI shows `—`). Cascade: response → Write input → Edit strings → Read stat; Bash/Grep/Glob from **capped** response size only |
| Capture tools | PostToolUse matcher `Bash\|Grep\|Glob\|Read\|Write\|Edit` — no `*` / MCP without allowlist |
| Redaction | Summary only (command / pattern / glob, ≤~200 chars); never full stdout; cap estimate input **4 KiB**; strip secret-like patterns |
| `GET /api/observability/tool-use/stream` | SSE: `connected` then `tool-use` frames when the JSONL grows (`fs.watch` + byte poll) |
| Missing file | `200` + empty `events` (calm empty UI — not an error) |
| Hard I/O failure | `500` + `{ error }` |
| Write path | Hooks append JSONL only; Board never writes; no HTTP from hooks |
| UI | Live prefers **SSE** (poll fallback if `EventSource` missing); **Load older** uses `before=nextBefore`; columns Time \| Type \| **Target** (file basename or summary) \| Action \| Tokens \| Session \| Agent? \| Model? |

**Mechanism:** `TokenLedgerService` reverse-tails with optional `before` filter; `TokenLedgerWatcher`
fans out appends to SSE subscribers. The Node-only watcher loads only when a local SSE request has a
`ServerContext`; Worker bootstrap does not import its `node:fs` graph. The `connected` frame follows
watcher subscription, so an immediate append cannot race initialization. Hooks stay file-append only
with privacy default **summary over body**.

### 7.9 System Event catalog

The `System Events` tab on the observability board subscribes to events on the
canonical server `EventBus<ServerEventMap>` exposed by `ServerContext.eventBus()`.
Only events registered in `SYSTEM_EVENT_CATALOG` (`packages/app/src/services/event-names.ts`)
are persisted to `system_events` and pushed over `/api/events/planning`. The catalog
is the single source of truth — both the tap (`registerSystemEventTap`) and the SSE
module derive their subscriptions from it.

**Tier rules (task 0221 R5).**

| Tier        | Meaning                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `default`   | Persisted and streamed on the SSE channel without extra runtime config.                                          |
| `diagnostic` | Persisted and streamed only when `SPUR_DIAGNOSTIC_EVENTS=1` (or `true`) is set on the server runtime.            |
| (out of catalog) | Emit is not part of the board contract — CLI-local buses, browser store notifications, raw Node signals.    |

The `SPUR_DIAGNOSTIC_EVENTS` flag ships through `serverBootstrapConfig(env).events.diagnostic`
(`apps/server/src/bootstrap.ts`) and is consulted in two places: the system-event tap
(`registerSystemEventTap(bus, dao, logger, { diagnosticEnabled })`) and the SSE module when
building the stream name list. Diagnostic entries remain in the catalog so the UI can
filter them by `tier` once the toggle is enabled — no CLI restart required.

**Source families (task 0221 R2).** `SystemEventSource` is the producer family
(`planning | queue | scheduler | message | process | workflow | rule | agent | bus | api`).
The catalog declaration order is the canonical order; `SYSTEM_EVENT_PREFIXES` is derived
and powers the UI prefix filter.

**Event-name alias policy (task 0221 R4).** Where upstream and canonical names diverge
(e.g. engine `workflow.action.start` vs. observability adapter `workflow.action.started`),
the engine-native names are catalog-canonical and the alternates get their own row — one
per logical moment — to avoid silently collapsing two lifecycle moments into one row.
The persistence-side `ObservableWorkflowAdapter` continues to feed live consumers via
its own typed bus; it produces a separate `system_events` row only if the engine did not.

**Producer invariant (R3).** Board-visible server work receives the canonical bus,
directly or through a typed adapter. Each app service has an optional `events?()`:

| Service                                          | Wiring                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `AgentService.run()` / `runCapture()` (0219 + 0221) | `AiRunner({ events: bridge(events), processEvents: bridge(events) })`                                 |
| `RuleService.evaluate()` / `evaluateVerbose()`    | `RuleEngine({ events: bridge(events) })` plus a forwarding subscription over the verbose local bus. |
| `WorkflowAppService.run()`                        | `EngineWorkflowService.runFile({ events: bridgeEngineEvents(events) })` via `createEngineService`. |
| `TaskActionJob` (server-side queued job)         | `new AgentService({ events: ctx.eventBus(), ... })` in `serve.ts:runTaskActionJob`.                  |
| `JobQueue` / `QueueConsumer` (0190)              | Already wired via `createServerContext` (forwards `queue.*`).                                       |

**Server-context integration tests (0219 AC).** `apps/server/tests/context.test.ts`
proves that `task.*` events flow through the canonical bus into `system_events`;
analogous tests for `rule.run.start`, `agent.invoke.start`, and `workflow.run.started`
are added in 0221 by emitting the upstream event through a service constructed with
`events: ctx.eventBus()` and asserting `dao.query({ name })` returns a row.


## Team + Message HTTP Routes (0256)

The board's team supervision and inter-agent messaging surface is **raw Hono handlers** (not oRPC).
oRPC stays the planning-CRUD convention; the live board/streaming surface is raw + SSE (which oRPC
can't express). Web consumes via `fetchWithTimeout` + `resolveApiUrl` and native `EventSource`.

### Team routes (`apps/server/src/modules/team/index.ts`)

| Method | Path | Body / Query | Response | Notes |
|--------|------|-------------|----------|-------|
| GET | `/api/team/processes` | — | `{ processes: [{agentId, pid, status, startedAt, exitCode}], count }` | List supervised processes (0243). |
| POST | `/api/team/agents/:id/start` | — | `{ ok, pid, status }` (201) or `{ error }` (400) | Spawn a supervised agent. |
| POST | `/api/team/agents/:id/stop` | — | `{ ok }` or `{ error }` (400) | Stop a supervised agent. |
| POST | `/api/team/processes/:id/stdin` | `{ line: string }` | `{ ok }` or `{ error }` (400) | Forward a line to the process stdin. |
| GET | `/api/team/processes/:id/stream` | — | SSE stream of `{stream, ts, line, seq}` frames | Ring-buffer replay + live tail. Heartbeat every 15s. |
| GET | `/api/team/teams` | — | `{ teams: [{teamId, name, members: [{id, type, status, pid?}]}], count }` | Teams grouped by `team:<id>` tag + config (0256 R2). |
| POST | `/api/team/:team/up` | `?check=true` (dry-run) | `{ materialized: {upserted, orphaned, written}, started: [{id, ok, pid?}] }` | Materialize + best-effort start (0256 R3/R5). |
| POST | `/api/team/:team/down` | `?purge=true` | `{ stopped: string[], purged: string[] }` | Stop members + optional purge (0256 R3). |
| GET | `/api/team/health` | — | `{ ok: true }` | Liveness probe for CLI `team up` best-effort start (0256 R4). |

### Message routes (`apps/server/src/modules/messages/index.ts`)

| Method | Path | Body / Query | Response | Notes |
|--------|------|-------------|----------|-------|
| GET | `/api/messages/inbox` | `?agent=<id>&limit=<n>` | `{ messages: [{id, fromId, body, status, createdAt, inReplyTo}], count }` | One agent's inbox queue. |
| GET | `/api/messages` | `?limit=<n>` | `{ messages: [...], count }` | Global message feed (all agents). |
| POST | `/api/messages` | `{ fromId, toId, body, inReplyTo? }` | `{ msgId, toId, status: 'queued' }` (201) | Enqueue a message. |
| POST | `/api/messages/:id/reply` | `{ fromId, body }` | `{ msgId, toId, status: 'queued' }` (201) | Reply to a message. |

**Convention:** response envelopes use `{ data…, count }` for lists and `{ ok, ... }` for mutations,
matching the existing board routes. Error shape: `{ error: string }` with the appropriate HTTP status.
All team routes are Bun-gated (require `ServerContext`); they return 503 on the Cloudflare Workers path.
