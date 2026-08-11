---
doc: 04_DESIGN
owns: SURFACE — every CLI command, flag, config key, env var, table, DTO
authority: derived
version: 1.22.0
derived_from: [03_ARCHITECTURE, codebase]
owner: Robin Min
updated_at: 2026-08-11
read_before: changing a command, flag, env var, or schema
edit_rules: 99 §6.5
sync: [T3, T9]
---

# 04 Design — Spur

The external, user-facing design surface: every CLI command, the config schema, and the persisted
data shapes. Feature-internal design lives in code.

## UI/UX boundary & DESIGN.md

Repository-root `DESIGN.md` owns all UI/UX design documentation (industry standard visual language, color tokens, typography, component specs, accessibility, and responsive patterns). Read and update it for UI work; keep `docs/04_DESIGN.md` focused on non-UI surface design by default. If `DESIGN.md` is absent, ignore it and follow the project's established UI conventions.

By contrast, `docs/04_DESIGN.md` is our SSOT of non-UI surface design by default — covering CLI command signatures, flags, config schemas, DTOs, tables, and system boundaries.

When collaborating with the design team:

- **UI/UX & Visual Design:** Refer to and update repository-root `DESIGN.md`.
- **Non-UI Surface & API/Schema DTOs:** Refer to and update `docs/04_DESIGN.md` (and `docs/design/<slug>.md` satellites).

## 0. Design satellites (`docs/design/`)

| Satellite                                                                                               | Area                                                                                                                                                                                                  | Status                          |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [`rd3-migration-design.md`](design/rd3-migration-design.md)                                             | Planning layer (`spur task`/`spur feature`) — schemas, lifecycle, corpus migration (ADR-020–023)                                                                                                      | finalized; surface in §1.x / §7 |
| [`server-side-adjustment-design.md`](design/server-side-adjustment-design.md)                           | Server/Web slice — ServerContext, runtime-safe imports, EventBus/JobQueue/Scheduler wiring, oRPC surface                                                                                              | design (in progress)            |
| [`server-side-adjustment-feature-finalized.md`](design/server-side-adjustment-feature-finalized.md)     | Server/Web — finalized feature decisions for the above                                                                                                                                                | finalized                       |
| [`spur-team-mode-design.md`](design/spur-team-mode-design.md)                                           | Team mode — agent specs, inbox, `TeamService`                                                                                                                                                         | design                          |
| [`workflow-observability.md`](design/workflow-observability.md)                                         | Workflow run observability — correlated EventBus projection, human output levels, durable trace follow, producer audit (0114/0310/0365)                                                               | partial                         |
| [`dev-plan-design-doc-generation.md`](design/dev-plan-design-doc-generation.md)                         | `/sp:dev-plan` design-doc step — design by default / `--skip-design` only, seam heuristic (ties lean design), satellite + index authoring (0124)                                                      | implemented                     |
| [`dev-agent-flag-and-dogfood-skill.md`](design/dev-agent-flag-and-dogfood-skill.md)                     | Dev execution surface — unified `--agent <inline\|auto\|name>` selector, interactive task-pipeline host driver (0503), named escalation triggers, and `sp:dogfood-testing` extraction                | implemented                     |
| [`dev-command-argument-contract.md`](design/dev-command-argument-contract.md)                           | `/sp:dev-*` argument surface — syntax-only hints, command-local flag/default tables, full-surface semantic parity (H81; ADR-032 amendment)                                                            | implemented                     |
| [`e2e-workflow-for-system-development.md`](design/e2e-workflow-for-system-development.md)               | End-to-end workflow system for system development — pipeline architecture, design step auto-detection, HITL gate model, doc-sync boundary (0167)                                                      | design                          |
| [`portable-agents-harness-contract.md`](design/portable-agents-harness-contract.md)                     | `spur init` root `AGENTS.md` seed — complementary Spur/Superskill ownership, portable routing, conditional root `DESIGN.md`                                                                           | implemented                     |
| [`feature-tree-status-affordance.md`](design/feature-tree-status-affordance.md)                         | Board Features tree — icon-only leading status indicator, accessible-name contract, glyph silhouettes, semantic-token convergence (ADR-034, feature R2)                                               | implemented                     |
| [`feature-action-progress-transparency.md`](design/feature-action-progress-transparency.md)             | Features detail action progress — F83 job-queue runner, queue.job.\* SSE correlation, floating progress layer (implements F81/0352–0354)                                                              | design                          |
| [`feature-check-strict-ac-satisfaction.md`](design/feature-check-strict-ac-satisfaction.md)             | `spur feature check --strict` — verdict-backed AC satisfaction and malformed-artifact diagnostics (0340/0410)                                                                                         | implemented                     |
| [`project-switcher.md`](design/project-switcher.md)                                                     | Multi-project Spur Board switcher — registry, serve lifecycle, switcher UI (K1)                                                                                                                       | design                          |
| [`inbox-board-module.md`](design/inbox-board-module.md)                                                 | Inbox Board module — shipped unified timeline (M4/0422); accepted message-only boundary under G3 (ADR-052)                                                                                           | transition design               |
| [`workflow-run-log.md`](design/workflow-run-log.md)                                                     | Consolidated per-run workflow run log — all-in-one `.spur/run/RUNID.log`, retain-by-default + `--no-log`, `clean` log retention, `trace --follow --output` source (D2; ADR-045)                       | built                           |
| [`brainstorm-workflow-observability-steering.md`](design/brainstorm-workflow-observability-steering.md) | Brainstorm — tiered `spur workflow run` output, richer lifecycle/execution events, `--json` machine mode, steering axes (0114/0310 foundation)                                                        | brainstorm                      |
| [`workflow-steering-control-channel.md`](design/workflow-steering-control-channel.md)                   | Cross-process workflow steering control channel — durable command record, CAS-versioned, remote/detached steering (ADR-035 keeps the EventBus read-only)                                              | proposed design only            |
| [`workspace-design.md`](design/workspace-design.md)                                                     | Workspace Board module — team-scoped composition over existing Teams, Inbox, and Tasks surfaces (ADR-052, feature G3)                                                                                 | approved design                 |
| [`plugin-surface-parity.md`](design/plugin-surface-parity.md)                                           | `sp:spur-cli` facade / `sp:spur-dev` spine / AGENTS.md noun-table parity harness against the live monorepo CLI (ADR-053/054, feature I2)                                                            | accepted design                 |

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

| Invocation                           | Behavior                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `spur` / `spur help` / `spur --help` | Top-level help: commander's standard flat command listing (alphabetical, with summaries) |
| `spur <noun> --help`                 | Commander-generated command-scoped help (options, subcommands)                           |

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
  _new_ file from `config/templates/AGENTS.md`, init substitutes `{project-name}` (from `--name`
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
  - _Functional probe (Phase 1.5):_ `spur status`, `spur task create`, `spur workflow validate`.
  - _Rule glob adaptation (Phase 1.6):_ the `recommended-pre-check` preset ships globs calibrated
    to Spur's monorepo (`apps/**/*.ts` etc.). On any other layout these match zero files and `rg`
    exits 2, surfacing as `kind: "error"` findings. The command detects the project layout
    (monorepo / single-package / flat / polyglot) and writes adapted overrides under
    `.spur/rules/<category>/` — local-layer shadowing (first-layer-wins by relative path), not
    scaffold materialization. The probe `spur rule run --preset recommended-pre-check` must then
    report zero `kind: "error"` findings. Adapted rule files are customization overlays, analogous
    to the Phase 2 doc edits — NOT `SCAFFOLD_MANIFEST` entries.
  - _Doc customization (Phase 2):_ routes every doc touch through `sp:doc-evolve` (project naming,
    stack detection, PRD/ADR drafts).
    The command NEVER creates `SCAFFOLD_MANIFEST` files itself — it edits content the CLI already
    wrote, or writes local-layer overlays the CLI never owned.

**Scaffold-variant parity invariant.** `SCAFFOLD_MANIFEST` ships exactly one
`templates/task/<variant>.md` entry per `TASK_VARIANTS`
(`standard·feature-impl·issue·review·brainstorm·meta`); enforced by
`apps/cli/tests/commands/init.test.ts` to prevent template/manifest drift.

#### `spur agent run <prompt> [--agent <name>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--stage <id>] [--signal <sig>] [--drain] [--json]`

**The subprocess LLM execution surface.** Every out-of-process model invocation in Spur routes
through this verb: workflow `agent.run` actions, explicit `/sp:dev-* --agent auto|--agent <name>`
subprocess dispatches, and team-mode runs. This keeps subprocess agent resolution, auth, slash-command translation, and team
identity in one place, and is the seam where a future remote/SSE execution channel attaches without
touching callers.

Model-bearing `/sp:dev-*` commands invoked from a live coding-agent session use the host-native
skill/subagent surface inline by default; omitting `--agent` is `--agent inline`. `--agent auto` /
`--agent <name>` force this verb. The four dispatch-surface triggers override inline: a different
model/coding agent,
headless or unattended execution, a durable auditable run record, or workspace/credential isolation.
The applied trigger is named. Inline has no isolated workspace, per-stage subprocess action record,
independent timeout/abort boundary, or tier-selected executor. Interactive `dev-run --mode full`
and sequential `dev-runall` are the ADR-047 control-inversion case: the wrapper reads
`task-pipeline.yaml` as SSOT, interprets its actions/guards in-session, records a pipeline run link,
and appends `stage <id> executed inline in session <session-id>` provenance. Direct
`spur agent run`, headless `spur workflow run`, explicit executor selection, and parallel batches
remain subprocess surfaces.
Execute a prompt or slash command via a coding agent. `--agent` (default `auto`) resolves via the
`agent` config block (0126): the prompt's slash command yields a **phase** — recognized in every
per-agent surface form, since `spur agent run` may receive an already-translated prompt (`/sp:dev-run`
claude, `/sp-dev-run` opencode/gemini/hermes/grok (default dialect), `/skill:sp-dev-run` pi/omp,
`$sp-dev-run` codex, plus the `rd3` variants → all `dev-run`). Routing is stage-registry-first
(ADR-033 / 0452): stage `model_policy` selects a named `agent.executors` profile. With no stage
match, `agent.default` is resolved as an executor selector (then a legacy agent name); on miss,
Tier-1 priority applies. The legacy `current`/`inherit` tokens were removed (ADR-047): they resolve
as unknown executor names (exit 2) — `inline` is the surviving value for "the agent running this
session". Host-agent detection reads `SPUR_AGENT`/`CLAUDE_CODE_ENTRYPOINT`/`TERM_PROGRAM` via
`resolveAgentHint`, not `--agent current`. (`default-by-phase` removed 0452.)
**Explicit `--agent` is executor-aware (0346).** An explicit `--agent <name>` reuses the same
executor-first-then-binary lookup as `agent.default` (`resolveExecutorSelector`, source `explicit`):
if `agent.executors` has an entry whose `name` matches, that profile's `{ agent, model? }` is used
(the profile's `model` becomes the run model unless the user also passed `--model`); otherwise the
name is resolved as a legacy coding-agent binary. Collision precedence: when an executor and an
agent binary share a name, **the executor wins** (to reach the bare binary, remove or rename the
executor entry). An explicit selector never consults phase / `default-by-phase` config (R8).
**Stage-registry routing (ADR-033).** `auto` now resolves primarily on the canonical `stage_id`
(from an explicit `--stage <id>`, else the derived phase): the stage's `model_policy` starts on the
cheapest eligible executor at its `min_tier` (`cheap`/`standard`/`capable-1`/`capable-2`/`capable-3`,
matched against each executor's `tier` field; 0343 split bare `capable` into quality sub-tiers) and
escalates along the ordered `fallback` chain when an objective `--signal`
(`gate-fail`/`timeout`/`insufficient-evidence`/`retry-exhausted`/`resource-exhaustion`/`auth`) is supplied (with
`--from-executor` naming the current tier). Legacy bare `capable` normalizes to `capable-1` during
the deprecation window. The stage-registry schema version is 1.2 (`auth` is an additive enum value).
**Stage floors (cost-aware):** `plan` starts at `capable-2` (escalate to
`capable-3`) so Design is authored at create by default; `refine` floors at `standard` (fallback
`capable-2`) as the blank-Design fallback; `implement` stays `standard`; `verify`/`dogfood` floor at
`capable-1`. Unified `--skip-design` skips feature satellite **and** per-task Design at create.
`default-by-phase` was removed (task 0452 / ADR-033 retirement). Routing uses stage registry
`model_policy` only; migrate legacy configs to `agent.default` + executors + stage tiers.
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
emits `{ agents: [...] }`, each row carrying `capabilityTier` (task 0487 R3 — the executor's
**capability** tier `cheap|standard|capable-*`, distinct from the row's `tier`, which is the agent's
support tier 1/2/3; consumed by the pipeline size precheck). It is the declared
`agent.executors[].tier` when the probed name matches a configured executor, else inferred from the
name. Auth is informational (its own column, not a state label —
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

#### `spur workflow validate <workflow.yaml> [--json] [--no-schema]` · `spur workflow run <workflow.yaml> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan] [--detail <minimal|invocation|full>] [--quiet|--silent|--verbose] [--trace-file] [--steer] [--no-log] [--json]` · `spur workflow continue [run-id] [--yes] [--json]` · `spur workflow list [--json]` · `spur workflow trace [run-id] [--workflow <name>] [--status <s>] [--since <date>] [--last <n>] [--follow] [--poll <ms>] [--output] [--json]` · `spur workflow clean [--older-than <minutes>] [--force] [--logs] [--dry-run] [--json]`

> **Shipped surface (ADR-045 / feature D2, tasks 0426–0429):** `run --no-log` opts out of the
> consolidated `.spur/run/<RUNID>.log` (retained by default otherwise); `trace --follow --output`
> streams that log as a tail -f-equivalent source and is rejected with `--json`; `spur workflow
clean` reclaims retained logs older than `workflow.logRetentionDays` (default 30 days). Shapes:
> [`design/workflow-run-log.md`](design/workflow-run-log.md).

- `validate <file>` — load + Zod-validate a workflow definition.
- `run <file> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan]` — execute; prints `<status>: <name> -> <finalState>`;
  exit 1 unless `done`. `--vars` takes a JSON object of per-run variable overrides
  (e.g. `--vars '{"taskId":"0042"}'`), merged over the workflow's `vars` for `${vars.*}` resolution.
  `--dry-run` validates the definition and walks the transition graph without executing actions
  — useful for verifying workflow structure before committing side effects.
  **Observability (0114/0310/0365, synchronous human runs):** default output prints the run id,
  plan, correlated phase/action lines, resolved agent/model, redacted invocation summary, bounded live
  stdout/stderr, timeout budget, 30-second liveness, duration/outcome, and explicit `usage unavailable`.
  `--detail minimal` retains compact lines; `--detail invocation` is the default; `--verbose`
  implies full correlation and FSM transitions. `--quiet` keeps only the final summary;
  `--silent` suppresses routine output. `--json` emits only the existing result object.
  `--trace-file` appends the schema-versioned redacted stream under
  `.spur/runs/workflow/<run-id>.jsonl` and propagates to the detached child. `--steer` enables
  synchronous in-process `continue|note|retry|abort` commands at an action's declared
  `steeringBoundary`; it conflicts with `--json` and `--async`, and retry additionally requires an
  explicit idempotent `retryPolicy`. `--no-plan` remains orthogonal. Mechanism, backpressure, redaction,
  and control boundaries:
  [`design/workflow-observability.md`](design/workflow-observability.md).
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
  `--follow` requires a run id, replays that durable timeline, polls every `--poll` milliseconds
  (default 1000; minimum 50), emits changed action rows, and exits at terminal status. It is a
  human stream and cannot be combined with `--json`. `--output` (requires `--follow`) swaps the
  follow source to a raw tail of `.spur/run/<RUNID>.log` (tail -f equivalent), also a human stream
  rejected with `--json`; a run started with `--no-log` prints a clear no-log message at terminal
  status instead of hanging.
- `clean [--older-than <minutes>] [--force] [--logs] [--dry-run]` — housekeeping: finalize orphaned
  runs stuck in `running`/`pending` past a staleness threshold (default 30 min) as failed, and
  reclaim retained run logs older than `workflow.logRetentionDays` (`.spur/config.yaml`, default 30
  days). `--logs` scopes to log reclamation only; `--dry-run` lists what would be cleaned without
  writing; `--force` overrides `--older-than`.
  Action lines include the action kind, duration when finalized, and an in-flight/success/failure marker.
  **Per-step cost (0311):** `agent.run` lines also carry token cost + cache-hit joined from imported
  history ETL rows — `· $X.XXX · cache Y%` for an exact session-id join (R1a), `· ~$…` when the
  time-window heuristic was used (R1b estimate), and `· cost n/a` when no imported usage matches
  (never `$0.00` — 0281/0284 never-fabricate). An unjoined step appends a footer hinting
  `spur history import`. `--json` gains a nullable per-action `cost` object (`costUsd`, input/output +
  cache token dims, `cacheHitRatio`, `estimated`), additive so existing consumers are unaffected. Cost
  is read from already-imported ETL; `trace` never triggers an import. Join + math:
  `packages/domain/src/analytics/run-cost.ts`.
  Backed by `ts-dual-workflow-engine` (`WorkflowService` + `DbWorkflowPersistenceAdapter`).

#### `spur history import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--dry-run] [--source-timeout <ms>] [--json]`

Import agent conversation JSONL. `--source` ∈ {pi, claude, codex, gemini, opencode, antigravity,
openclaw, omp, grok, agy, **all**} (default `all`). `--mode` ∈ {full, incremental, force-file}
(defaults: `incremental` for root scans, `force-file` when `--file` is given). Reports scanned files,
processed lines, imported/duplicate records, parse/validation errors. Backed by
`ts-llm-jsonl-importer`.

**Provenance header (task 0504 R4):** every invocation prints a `binary:` line (the actually
invoked entry path — source-local `bun run apps/cli/src/index.ts` / built `spur.js`, or the stale
global `spur` that the header exposes) plus the resolved `@gobing-ai/ts-llm-jsonl-importer@<version>`
before the fan-out result; `--json` embeds the same `provenance` field (`{ binary, importer }`) in
the payload. Real-data history validation must run a source-local binary — never a bare global
`spur` — and record the header before each dry-run/write.

**Fan-out (task 0470):** `--source all` iterates every known source in `SOURCES` order, each in its
own `try` with its own transaction — a throwing or timing-out source is caught, recorded
`status: 'failed'` with its error, and the loop continues; one source can never abort another. A
source that discovers zero files is `status: 'empty'`, never `ok`; a source with checkpoint rows but
zero files now emits a `source-was-nonempty` warning. `--source-timeout <ms>` bounds each source
(default **600000** = 10 min); a source exceeding it is abandoned at its deadline and recorded
`failed`. A single `--source <x>` is the n=1 case of the same contract — there is never a second
import path.

**Degraded status (task 0504 R2):** a source that imported records while skipping malformed or
schema-invalid ones is `status: 'degraded'`, never clean `ok` — parse/validation error counts are
no longer the only signal. The degraded entry carries a `source-degraded` warning with counts, and
bounded file-and-line samples stay in the artifact (overflow to the `.errors.jsonl` sidecar).

**Reconciliation pass-through (task 0505 R1):** on `--mode full` with importer 0.4.25+, each JSON
entry carries the importer's optional `reconciliation` summary (`{ staleTargetRows,
staleLedgerRows, staleCheckpointRows }`) — additive, absent on incremental runs — so a dry-run
preview and its write can be compared count-for-count without manual SQL.

**Single-file full-write guard (task 0506 R2):** `--file <path> --mode full` **without** `--dry-run`
is rejected at the CLI boundary (exit 1) before any database access — full mode treats the file as
the authoritative input for a reconciliation of the real repository DB, which is only safe for an
all-source/source-root full write. The error names both alternatives: add `--dry-run` to preview,
or use `--mode force-file` to import one file. `--file --mode full --dry-run`, `--file --mode
force-file`, and all-source/source-root full writes are unchanged.

**Exit-code contract (R3, amended 0504 R2) — replaced the old "exit 1 if any errors":** `0` every
source ok/empty, `2` at least one failed **and** at least one not (or any source `degraded`), `1`
every source failed. A source is `failed` only if it threw or hit its timeout. Before 0504, parse
and validation errors were counts only (deliberate loss of "parse errors ⇒ exit 1", which under
fan-out cannot distinguish one noisy source from six dead ones); 0504 restores the loud signal for
skipped records at the source level — `degraded` status + non-zero exit — while keeping per-source
isolation intact. The compensating signals remain the artifact's error counts and the `history.*`
events.

#### `spur history daily [--since <iso>] [--until <iso>] [--root <path>] [--source-timeout <ms>] [--json]`

Run-once daily pipeline (task 0470 R6): **import-all → analyze → write artifact → prune** reports
older than 90 days (`REPORT_RETENTION_DAYS`), in a single process that exits when done — never stays
resident (a resident schedule belongs to 0471's launchd agent, not Spur's embedded scheduler). The
**import** step takes no date window and runs `--mode incremental` on every source, relying on
checkpoint resume (R7): a missed night self-heals on the next run with no gap and no double-count.
Only the **analyze** step scopes the report via `--since`/`--until`. `--root <path>` overrides the
per-source history roots (test seam; default is each source's platform dir). `--json` emits the
structured `DailyResult` (`{ fanOut, artifact, pruned }`). Exit code follows the fan-out import
outcome (0/1/2), so `history.daily.failed` and the exit agree.

#### `spur history analyze [--since <iso>] [--until <iso>] [--source <s|all>] [--session <id>] [--run <runId>] [--task <wbs>] [--top <n>] [--out <path>] [--json]`

Aggregate imported history into forensic analytics and write a **versioned JSON artifact** (task 0474).
Aggregation is done in **SQL** over `history_message` / `history_tool_call` (the Q1–Q10 forensic query
set — per-step time/token cost, tool-call counts, repeated-call loop detection, unknown-disposition
drift) — never by loading the corpus into memory. Reads the contract tables populated by the six
converted sources (claude, codex, pi, omp, grok, agy) plus the generic ETL sources.

Six composable `AND` selectors, each resolving against an indexed column: `--since`/`--until`
(`history_message.ts`), `--source <s>` / `all` (`source`; `all` = no source predicate), `--session`,
`--run`, `--task` (`run_id`/`task_wbs` via the `0009_spur_cli_history_message_run_idx`
`(provenance, run_id)` index), and `--top <n>` (default 20; bounds `bySession`/`byTool` only — never
`totals`/`bySource`/`byModel`/`daily`).

Artifact: `.spur/reports/history/<YYYY-MM-DD>/analyze-<selectorDigest>.json` where `selectorDigest` is
the first 8 hex of sha256 over the canonicalized selector (stable for the daily loop). `--out <path>`
overrides; `latest.json` symlinks the newest artifact. `schemaVersion: 1`; additive fields do not bump
it. `coverage[].parseErrors`/`validationErrors` are **counts** plus at most 20 samples per source, with
full detail streamed to `analyze-<digest>.errors.jsonl` (R6). `recordsWithUsage` /
`durationUnmeasured` carry the never-fabricate invariant — a consumer renders `n/a`, never a
fabricated `0`. No artifact flags ⇒ human stdout summary (rendered from the artifact); `--json` ⇒ the
artifact shape.

**Assistant response duration (task 0507 R2):** totals (`assistantDurationMs`,
`assistantDurationUnmeasured`) and per-session stats (`bySession[].assistantDurationMs` /
`assistantDurationUnmeasured`) aggregate the **measured** `history_message.duration_ms` from OMP
assistant responses — role-filtered to `role = 'assistant'`, additive, and distinct from tool-call
`durationMs`/`durationUnmeasured` (which remain computed only from `history_tool_call`). Missing or
non-finite durations count as unmeasured, never as zero. `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1 —
the fields are additive.

#### `spur history report [path] [--json]`

Pure renderer of a previously-generated analyze artifact — never opens the database. Reads the
artifact JSON, asserts `schemaVersion === HISTORY_ARTIFACT_SCHEMA_VERSION`, then renders a stdout
spend rollup (reusing `formatSummary` via `artifactToSummary`) plus forensic sections the spend
summary cannot express: per-tool time/calls/result-bytes, detected loops, session leaderboard, and
per-source coverage. Writes a `.md` sidecar next to the artifact (same basename) so the morning read
needs no CLI invocation.

- `[path]` — explicit artifact JSON path. When omitted, resolves `.spur/reports/history/latest.json`
  (a symlink to the newest artifact, written by `analyze`). An explicit path wins (R6).
- `--json` — emit the parsed artifact shape instead of the human report.
- **Staleness banner (R7):** when the artifact is resolved via the `latest.json` pointer and is older
  than 36 hours, a `⚠ STALE ARTIFACT` banner prints before the report body — the daily loop may have
  stopped. Suppressed for explicit paths (the operator already knows the file's age).
- **Version gate (R4):** an artifact whose `schemaVersion` is not the one this renderer understands is
  refused with a clear message naming the path, the actual version, and the expected version; nothing
  else is emitted. Re-run `spur history analyze` to regenerate.
- **Never-fabricate (R5):** when a tool bucket has calls but every `duration_ms` was NULL
  (`durationUnmeasured === calls`), timing renders `n/a`, never `0` — the same convention
  `formatRatio` uses for unavailable cache-hit ratios.
- Rendering is pure (`packages/domain/src/analytics/render-report.ts`); the FS seam lives in
  `packages/app/src/services/history-service.ts` (`runHistoryReport`).

#### History nightly loop — scheduling surface and observability (task 0471)

The daily pipeline runs on an **external macOS launchd agent**, not Spur's embedded scheduler. The
embedded scheduler (`ts-infra` `NodeSchedulerAdapter.parseInterval`) cannot express `0 2 * * *` — it
silently degrades to a 60-second `setInterval`, needs a daemon the run-once CLI is not, and drives
nothing today (`bootstrap.scheduler.enabled = false`). An external supervisor is the only correct fit.

**Template:** `config/launchd/ai.gobing.spur.history.daily.plist` — `StartCalendarInterval` (daily
wall-clock), `WorkingDirectory` = project root, `StandardOutPath`/`StandardErrorPath` →
`.spur/logs/history-daily.out`/`.err`. Ship-as-template (not an installer verb): one plist + two
documented commands beat a Spur verb that must track macOS launchctl changes.

```bash
# Install (from the project root, after substituting SPUR_BIN and PROJECT_DIR in the template)
cp config/launchd/ai.gobing.spur.history.daily.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.gobing.spur.history.daily.plist

# Uninstall
launchctl bootout gui/$(id -u)/ai.gobing.spur.history.daily
```

**Rejected alternatives** (ADR recorded under task 0464 § R6): Spur's embedded scheduler (cannot
express daily cron, silent 60-s fallback); a `spur history install-schedule` verb (tracks launchctl
changes forever); a fifth detection layer or health-check verb (four already earn their place).

**System events (R1, R2).** Choosing an external scheduler makes the event ledger the only in-harness
evidence the loop ran. Three `history.*` events declared in `packages/app/src/services/event-names.ts`
emit from `apps/cli/src/commands/history.ts` (daily verb) via the existing
`attachSystemEventLedger(bus, context)` bridge:

| Event                       | Renderer          | When                                                        |
| --------------------------- | ----------------- | ----------------------------------------------------------- |
| `history.import.completed`  | `history-import`  | fan-out import finished (regardless of per-source failures) |
| `history.analyze.completed` | `history-analyze` | analyze + artifact write finished                           |
| `history.daily.failed`      | `history-daily`   | the daily command exited non-zero or threw                  |

All three are `metadata-only`, `default` tier — history payloads may carry `cwd`, file paths, and error
text quoting source content; `raw-safe` would persist that. The normalizer
(`normalizeSystemEventPayload`) strips `body`/`content`/`message`/`prompt`/`query`/`response`/`value`
and redacts configured secrets. `await ledger.flush()` runs in a `finally` on **both** the success and
failure paths — without it, a run-once process exits before the async inserts land, reproducing the
exact "0 rows" symptom this task exists to end.

**Four-layer missed-run detection (R5, R6).** No single layer is the sole signal:

| Layer                   | Signal                                           | Detects                                        |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------- |
| 1 — artifact freshness  | `latest.json` older than 36 h ⇒ staleness banner | the whole loop stopped                         |
| 2 — ledger events       | `history.*` rows present / absent                | started-and-failed vs never-started (R6)       |
| 3 — per-source coverage | `coverage[].status` per source                   | one source stopped while others kept working   |
| 4 — launchd error log   | `.spur/logs/history-daily.err`                   | failures before Spur's own logging initializes |

R6 is what layer 2 buys and layer 1 cannot: "no artifact" is ambiguous (launchd never fired vs the run
started and failed). A `history.daily.failed` row ⇒ it ran and failed; **no** `history.*` row in the
window ⇒ it never started. Both are checkable without reading the artifact, which by definition does
not exist in either case.

**Report reachability (R7).** The daily-summary surface (`plugins/sp/scripts/daily-summary/`) resolves
the `.spur/reports/history/latest.json` pointer and emits a `## History Report` section carrying the
newest artifact path — so a completed nightly run reaches the operator through the summary they already
open, with no new notification channel.

#### `spur feature sync [id] [--all] [--dry-run] [--force] [--json]`

Sync feature status with linked task states via conservative forward-only derivation rules (ADR-0322).

- `[id]` — sync a single feature by ID.
- `--all` — evaluate and sync all features with linked tasks.
- `--dry-run` — report proposed status sync transitions without applying writes.
- `--force` — force applying reopen proposals (`done/cancelled -> active` when non-terminal tasks are linked) without confirmation.
- `POST /features/{id}/sync` HTTP endpoint: `pull` direction delegates to `syncFeature` (`{ direction: 'pull', affectedTasks, applied, newStatus }` — `affectedTasks` = number of tasks linked to the feature, `applied` = whether a status transition was applied); `push` direction returns HTTP 501 structured error (not supported; use pull or CLI `spur feature sync`).
- Pipeline integration (task 0328; bounded by 0411): `task-pipeline.yaml`'s post-record step syncs the feature when the task carries a `feature_id`, or appends an orphan proposal to the run report if unlinked; `wrapup-pipeline.yaml`'s feature-transition step syncs `${vars.feature}`. Both prefer the retry-suppressing wrapper `bun plugins/sp/scripts/feature-sync-bounded.ts <id> --spur-bin <bin> --json` and fall back to the plain `spur feature sync <id> --json` verb when that script is absent — `spur init` seeds `.spur/workflows/` but never `plugins/sp/`, so a scaffolded project must not depend on the monorepo-relative path. Both steps are **advisory** (`; exit 0`): feature-status sync is a follow-up, never a completion gate, and must not abort a run that already produced a PASS verdict. Task frontmatter supports `feature_link_declined: true` to record explicit operator deferral.

#### `spur task scaffold-tests <wbs> [--file <path>] [--folder <path>] [--json]`

Scaffold BDD `test.todo` stubs from task Acceptance Criteria into `<workspace>/tests/tasks/<wbs>.test.ts` (or `--file <path>`). Each scenario produces one stub with Given/When/Then steps as AAA comments and a `// @ac:<normalizedTitle>` tag. Expands Scenario Outlines into 1 stub per Examples row. Merges idempotently with existing test files (preserves filled bodies, appends new scenarios, reports drifted scenarios). `--json` returns `{ wbs, targetFile, created, skipped, drifted, driftedScenarios, warnings }`.

### 1.2 Supporting utilities

| Command                                                                       | Behavior                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spur status [path] [--json]`                                                 | Project health: `ok`/exit 0 requires a valid `.spur/config.yaml`; `packageJson` is an independent optional fact. Also reports Git context, team agent spec ids under `.spur/agents/`, and optional path metadata (size, isFile, isDirectory).                                                                                                                                                              |
| `spur serve [--port <n>] [--host <addr>] [--no-open] [--cwd <path>] [--json]` | Start the web server (local fallback) and serve the Spur Board SPA when static assets resolve. Options: `--port` (env PORT, default 3000), `--host` (env HOST, default localhost), `--no-open` skip browser, `--json` print {port,url,pid}. Board assets ship in the npm package as `web/` next to `spur.js` (`resolveWebDistPath`); without them `/board` returns JSON 404 and the server logs a warning. |
| `spur projects [add                                                           | remove                                                                                                                                                                                                                                                                                                                                                                                                     | list | start | stop] [args] [--json]` | Multi-project registry management: `add <path>` registers project, `remove <target>` unregisters, `list` shows registered projects and health status, `start <target>` spawns server on allocated port, `stop <target>` stops server process. `--json` shapes for scripting. |
| `spur migrate [--json]`                                                       | Temporary helper: apply CLI-owned schema migrations; reports `{ ok, applied }`.                                                                                                                                                                                                                                                                                                                            |

| `spur --help` / `spur --version` | Commander-rendered usage / binary version (ADR-014). |

### 1.3 Agent command surface — commands as SSOT (feature H5 (was O), ADR-032)

The `plugins/sp` agent-facing command surface (31 `/sp:dev-*` wrappers; 37 command wrappers total) is
**hand-authored** — each `commands/<name>.md` is the authoritative, directly-editable source.
Per-platform adapters are **install-time output** owned by `superskill` (`superskill install sp`)
and never committed in plugin `sp` (ADR-032).

| Artifact                                    | Role                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/sp/commands/<name>.md`             | Hand-editable SSOT — frontmatter + invocation syntax + delegation line only                                                        |
| `plugins/sp/scripts/validate-commands.ts`   | Thin-wrapper contract validator: (a) heading whitelist, (b) frontmatter schema, (c) target resolution, (d) allowed-tools coherence |
| `plugins/sp/tests/command-contract.test.ts` | Contract test — validates the same four gates against the live corpus + negative-path coverage                                     |

Invariants: wrappers carry invocation syntax + the delegation line only — lifecycle semantics live
in the dispatched skill/workflow/procedure (0283 R4). The thin-wrapper contract is enforced by
validation, not generation — commands are hand-editable; the validator catches drift. A fresh
session is required to trust an in-session dogfood of a just-edited wrapper (platforms snapshot
command bodies at session start). The command index is owned by `plugins/sp/README.md`.
Supersedes the 0308 generated-adapter approach (ADR-032 records the decision).

**H81 contract (task 0412).** Dev-command frontmatter carries syntax-only
`argument-hint`; each body adds `## Argument Flags` immediately before `## Usage`, with exact
`Flag | Description | Default` columns and one canonical glossary reference. The validator enforces
the ordered three-heading contract and five gates (a–e); parity tests derive coverage from all
dev commands. Full shapes:
[`dev-command-argument-contract.md`](design/dev-command-argument-contract.md).

#### 1.3.1 `/sp:dev-find-conflict` — authority-aware conflict audit (feature H11, task 0486)

Thin wrapper over the `sp:conflict-finding` skill. Standalone audit, not a spine pipeline stage.

```text
/sp:dev-find-conflict [<scope>]
    [--pillar <source|tasks|features|authority|all>]   # default all
    [--mode <adaptive|full>]                            # default adaptive
    [--resolve]                                         # default off
    [--agent <inline|auto|name>]                        # default inline
    [--json]                                            # default off
```

Behavior: audits the four pillars (source code, task files, feature files, project authority files)
for within-pillar and cross-pillar semantic conflicts. Authority is resolved per **subject + claim
type** — never by a global `docs > features > tasks > code` ranking; incomparable or missing
authority yields a `needs-authority-decision` item rather than a fabricated winner. Without
`--resolve` the run is read-only with respect to source, corpus, and numbered docs. With `--resolve`
the skill presents a repair set, requires explicit confirmation, revalidates evidence freshness, then
routes each approved repair through its owner surface (`spur task`/`spur feature`, `sp:doc-evolve`,
the Spur dev lifecycle, or the Superskill capability lifecycle).

Result envelope (identical content in Markdown and `--json`):

```text
schema_version, command, scope, mode, pillars, authority_map,
inventory, findings, unresolved, coverage, cost, remediation, errors
```

Each finding carries `id, subject, claim_type, conflict_type, pillars, artifacts,
normative_authority, observed_reality, precedence_reason, evidence, freshness, severity, confidence,
false_positive_check, proposed_repair, repair_owner, status`. `conflict_type` ∈ {`contradiction`,
`stale`, `duplicate`, `omission`, `orphan`, `ambiguous-authority`}; `status` ∈ {`open`,
`needs-authority-decision`, `confirmed`, `repairing`, `resolved`, `failed`}. `coverage.complete`
is `false` whenever a selected pillar was skipped or a preflight tool failed — "comprehensive" may
not be claimed against a false value. v1 adds no production analyzer, index/cache/database,
dependency, CLI noun, workflow, or dedicated subagent. SSOT:
`plugins/sp/skills/conflict-finding/SKILL.md` + its four references.

#### 1.3.2 `/sp:dev-find-next` — feature frontier prioritizer (feature H12, tasks 0497, 0498)

Thin wrapper over the `sp:next-feature` skill. Standalone report, not a spine pipeline stage.
Answers "which feature should we work on now?" — the target-omitted case `sp:next-router`
declares out of v1 (routing-table §0 step 1c); within-target routing stays `/sp:dev-next`'s.

```text
/sp:dev-find-next
    [--task [<feature-id>]]                             # default omitted
    [--agent <inline|auto|name>]                        # default inline
    [--json]                                            # default off
```

Behavior: (0) sync-first precondition — `spur feature sync --all --dry-run --json`; material drift
leads the report with a "sync first" block and ranking uses the post-sync status view. (1) Assemble
the candidate set from `spur feature list --json` (containers and terminal features excluded; the
`group` tag is not a reliable container marker). (2) Gate on actionability — the frontier predicate
is **cited at runtime** from next-router's routing-table row B3, never restated; gated features are
reported with reasons, never ranked. (3) Derive the four measured signals (AC coverage, churn
exposure, dogfood proximity, authority pull) via `spur … --json`, `git`, and `rg`; a signal with a
degenerate spread is reported rejected-with-spread. (4) Rank in **ordinal tiers with per-candidate
evidence** — no numeric scores (the corpus carries no value/effort estimates; the `priority` field
is degenerate and never used as an ordering). (5) Defect pass — rank-distorting tree defects D1–D4
are emitted as proposals conforming to `docs/plans/feature-tree-restructure-map.md`'s schema, each
clearing the `sp:conflict-finding` evidence bar (`false_positive_check` mandatory); silence is a
valid outcome. (6) Report — the command performs no `spur feature move` and writes nothing under
`docs/features/**`; `/sp:dev-featurechange` (dry-run → confirm → apply) is the sole path from a
structure proposal to a changed tree. (7) **`--task` only (task 0498, resolving OQ1 toward the
planning half):** offer the rank-1 candidate (or the id passed to `--task`), take an **explicit**
operator confirmation, then route on the tier step 4 assigned — T3 with valid AC and zero tasks →
`/sp:dev-plan --feature <id>` then `/sp:dev-refineall --feature <id> --auto --depth ready`; T1 →
refineall only (a live frontier already exists; a second decomposition duplicates it); T3 with
invalid AC → stop with next-router's B4 hop, never inventing idea text; T2 (blocked) and T4
(stale-done) → refuse with the reason. The skill **creates no tasks itself** — decomposition and the
`task-batch.schema.json` gate belong to `/sp:dev-plan`. The confirm pauses regardless of `--auto`
(Auto-Decision Principle #5, taste); `--auto` is forwarded only to the dispatched children, and no
`--yes`/`--force` bypass exists. Adds no TypeScript, schema, frontmatter field, CLI verb, or
subagent. SSOT:
`plugins/sp/skills/next-feature/SKILL.md` + its four references
(`signal-derivation`, `ranking-rubric`, `proposal-contract`, `handoff-routing`).

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
  `tasks:`/`features:` blocks: `tasks.folders` (path → `{baseCounter, label?}`), `tasks.active`, `tasks.severity` (finding code → `error` | `warning` | `off`),
  `features.dir`. Every finding emitted by task/feature check carries a stable machine code (e.g. `L3.plan-format`, `L4.feature-not-found`) registered in `packages/config/src/finding-codes.ts`. `tasks.severity` overrides finding severities or drops findings (`off`) before pass gate evaluation; unknown codes fail config validation. The folder fields tolerate a blank/`null` value (an empty YAML key) and coerce to
  the canonical default. `@gobing-ai/spur-config` is the SSOT; `apps/cli/schemas/spur-config.schema.json`
  mirrors it for editor/CI validation.

`version` is a **string** (YAML must quote it: `"1.1"`). Current recommended value is
`"1.1"` (ADR-033 executor tiers + planning blocks). `"1"` remains accepted; there is no hard
migrator yet. Do not use a bare integer (`version: 2` fails Zod `z.string()`).

```yaml
version: "1.1"
name: <project-name>
bootstrap:
  logging:
    enabled: true
    level: info # debug | info | warn | error
    console: false
    json: false
    file: true
    filePath: .spur/logs/spur.log
  telemetry:
    enabled: false # CLI: off by default (per-invocation latency)
    serviceName: spur
    environment: development
  database:
    enabled: true
    driver: bun-sqlite
    url: .spur/spur.db # ${DATABASE_URL} interpolation supported
  scheduler:
    enabled: false # CLI is run-once; no scheduler
agent:
  default: omp # executor selector first, then legacy agent name
  executors: # ADR-033 / 0343 — declare tier (capable-1/2/3 quality ladder)
    - name: omp
      agent: omp
      tier: standard
    - name: claude
      agent: claude
      tier: capable-3
  # default-by-phase:     # REMOVED 0452 — use executor tier + stage model_policy
  #   dev-run: omp
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
    docs/tasks: { baseCounter: 0, label: Core } # legacy folders/base_counter absorbed
  active: docs/tasks # default folder for `spur task create`
  severity:
    L3.plan-format: off # rule severity overrides by code (error | warning | off)
features:
  dir: docs/features
```

`${ENV_VAR}` interpolation works via `ts-runtime` `interpolateTree` (used inside
`runNodeApplication`).

### 2.2 App config — `@gobing-ai/spur-config` (Zod)

Env-derived config (`ln(env)`), consumed by both the CLI context and the server Bun entry:

| Key                  | Env var                   | Default                                                                                                              |
| -------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `database.url`       | `DATABASE_URL`            | `:memory:`                                                                                                           |
| `server.port`        | `PORT`                    | `3000`                                                                                                               |
| `server.host`        | `HOST`                    | `localhost`                                                                                                          |
| `server.openBrowser` | —                         | `true` (spur serve only)                                                                                             |
| `server.webDistPath` | —                         | `null` (auto-resolve: cwd `dist/web`, package `web/` next to `spur.js`, binary-adjacent `web/`, monorepo `dist/web`) |
| `telemetry.enabled`  | `SPUR_TELEMETRY_ENABLED`  | `false`                                                                                                              |
| `telemetry.endpoint` | `SPUR_TELEMETRY_ENDPOINT` | —                                                                                                                    |
| `logging.level`      | `SPUR_LOG_LEVEL`          | `info` (debug\|info\|warn\|error)                                                                                    |

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
  corpus-baseline.json              # accepted errors for `spur task check --corpus` / `bun run corpus-check` (ADR-050)
  templates/                        # task/feature/bdd/docs body templates (§8); CLI never hardcodes body content (DD-11)
    task/{standard,feature-impl,issue,review,brainstorm,meta}.md   # one per TASK_VARIANTS entry (§7.3.1); SSOT alignment invariant enforced by init.test.ts
    feature/default.md
    bdd/{gherkin,checklist}.md
    docs/{99_PROJECT_CONSTITUTION,00_ADR,01_PRD,02_ROADMAP,03_ARCHITECTURE,04_DESIGN,05_FEATURES}.md  # doc stubs (task 0088)
  plugins/
    .gitkeep                        # home for future bundled plugins (ADR-012)
```

**Build → install → init flow:**

| Stage                      | Action                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build (`build:bundle`)     | Copy repo-root `./config` → package-root `apps/cli/config` via `bundle-config`; copy repo-root `plugins/` + `.claude-plugin/` → package-root `apps/cli/plugins` + `apps/cli/.claude-plugin` via `bundle-plugins`; both shipped via the package `files` array as top-level `config/`, `plugins/`, `.claude-plugin/`.                                                                                                                                                                                                         |
| Install (`bun install -g`) | Package-root `config/` ships inside `@gobing-ai/spur` — no `postinstall` (unreliable for global installs). Legacy installs may still have `spur-cli/config/` (pre-0.3.9); `bundledConfigRoot()` accepts both.                                                                                                                                         |
| First run / `spur init`    | `seedGlobalConfig()` copies bundled `config/{rules,workflows,tasks,…}` (YAML/JSON) → `~/.config/spur/` (never overwrites).                                                                                                                                                                                                                            |
| `spur init` scaffold       | Full-tree seed of every bundled asset into project `.spur/` (natural paths: `rules/**`, `workflows/**`, `tasks/**`, `templates/**`, `plugins/**`), then the `scaffold-manifest.ts` pass for remaps (`templates/task` → `tasks/templates`), root-scoped `docs/` + `AGENTS.md`, and `preserve`-marked entries (never overwritten, even with `--force`). |
| Runtime resolution         | `bundled` (package `config/` + ts-rule-engine demo rules) > global (`~/.config/spur`) > local (`.spur`).                                                                                                                                                                                                                                              |

**Ownership split.** `@gobing-ai/ts-rule-engine` ships only generic demo rules (one per builtin
evaluator) + a generic `example.yaml` preset for its own tests. Spur owns its presets and workflows
here. The bare `recommended` preset is removed; `recommended-pre-check` is the default (BREAKING, ADR-015).

**`--compile` caveat.** The compiled binary (`dist/cli/spur`) cannot read a sibling package `config/`;
it relies on the `~/.config/spur` seed. The published global install (`spur.js` + package-root
`config/`) reads the bundled tree directly and is the primary path.

No symlinks participate in install or init — config propagates by copy-and-resolve only.

**Monorepo path model (Spur self-dev — avoid triple-sync thrash):**

| Path                                             | Role                                                       | Agent rule                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `config/workflows/`                              | **Tracked SSOT** for this checkout                         | **Edit here** when changing pipeline/lifecycle YAML                                                                             |
| `.spur/workflows/`                               | **Symlink → `config/workflows/`** in this monorepo         | Runtime / command examples (`.spur/workflows/task-pipeline.yaml`). Do **not** copy between `config/` and `.spur/` — same inodes |
| `apps/cli/config/`                               | **`build:bundle` / `bundle-config` artifact** (gitignored) | Do **not** hand-`cp` or hand-edit. Regenerated on CLI package build for npm ship                                                |
| `apps/cli/plugins/` + `apps/cli/.claude-plugin/` | **`build:bundle` / `bundle-plugins` artifact** (gitignored) | The `sp` plugin + marketplace manifest shipped in the npm tarball. Regenerated on `bundle-plugins`; never hand-edit              |

Wrong pattern (0454/0455 waste): “keep `config/`, `.spur/`, and `apps/cli/config/` in sync” after every YAML edit. Right pattern: edit SSOT once; refresh the package tree only via `bun run --filter @gobing-ai/spur build:bundle` (or `spur-dev bundle-config`) when testing the **published** layout.

### 2.4 Config loader — single facade in `@gobing-ai/spur-config` (ADR-027)

`.spur/config.yaml` has exactly one loader. The package splits into two entry points so the
dependency graph stays Workers-safe:

| Entry                                  | Imports                            | Exports                                                                                                                 | Consumed by                                                       |
| -------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `@gobing-ai/spur-config` (core)        | zod only — no `yaml`, no `node:fs` | `spurConfigSchema`, `DEFAULT_TASKS_DIR`/`DEFAULT_FEATURES_DIR`, all config types (`SpurConfig`, `TaskFoldersConfig`, …) | server (Cloudflare Workers bundle), any runtime-agnostic consumer |
| `@gobing-ai/spur-config/loader` (node) | `yaml`, `node:fs`, ts-runtime      | `loadSpurConfig(cwd)`, `resolveConfigFile(cwd)`, `resolvePlanningFolders(fs)`, embedded-schema resolution               | CLI, `packages/app` services (on Bun)                             |

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

| Table                                                      | Owner                     | Purpose                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces`                                               | CLI                       | Static workspace binding (name, root, purpose, default agent)                                                                                                                   |
| `runs`, `phase_runs`, `transition_runs`, `workflow_states` | CLI + workflow engine     | Workflow run model                                                                                                                                                              |
| `artifacts`                                                | CLI                       | Captured output references                                                                                                                                                      |
| `history_import_ledger`                                    | importer                  | One row per imported record (hash, source, file, line)                                                                                                                          |
| `history_import_checkpoint`                                | importer                  | Incremental position, composite PK `(source, source_file)`                                                                                                                      |
| `history_etl_<source>`                                     | importer                  | Validated per-source ETL rows (`payload_json`, `imported_at`)                                                                                                                   |
| `inbox_messages`                                           | ts-db (`InboxMessageDao`) | Durable inter-agent message queue; indexed on `(to_id, status)`. Added by migration `0001_spur_cli_team_inbox`; composed into `CLI_SCHEMA_SQL` via `INBOX_MESSAGES_SCHEMA_SQL`. |
| `rule_runs`, `rule_eval_runs`                              | ts-rule-engine (≥0.3.15)  | Persisted rule-run history powering `spur rule trace`; added by migration `0002_spur_cli_rule_history`. `applied_fix_count` is re-stamped by Spur after `applyFixes`.           |

### 3.2 SourceDefinition (history import)

One config object per source: `source` discriminant, `displayName`, `filePatterns`, `defaultRoots`,
`splitConfig` (one-to-one | one-to-many | custom), `fieldMap` (raw→canonical), optional
`fieldTransforms`, and a Zod `schema` validating canonical fields. Adding a source = one variant.

### 3.3 Analytics records

`CostRecord` (source, date, model, input/output tokens, cache split, costUsd) is the single-ETL-row cost
shape consumed by `run-cost.ts` attribution. The analyze path no longer folds it in memory: it
aggregates in SQL over `history_message` / `history_tool_call` into a versioned `HistoryArtifact`
(`packages/domain/src/analytics/artifact.ts`), whose core bucket is `TokenTotals` extended with the
forensic dimensions (`messages`, `toolCalls`, `durationMs`, `durationUnmeasured`) and
`cacheWriteTokens` (matching the `history_message.cache_write_tokens` column). Artifact contract:
`schemaVersion`, `generatedAt`, `spurVersion`, `selector`, `coverage`, `totals`, `bySource`,
`byModel`, `daily`, `byTool`, `bySession`, `loops`, `warnings` (0464 R2).

## 4. Output Conventions

- Human mode: terse, line-oriented, tab-separated where tabular.
- JSON mode (`--json`): a single JSON document to stdout, stable keys for automation.
- Errors go to the error sink with context (what failed, path/identifier); exit codes are meaningful.

## 5. Server/Web Surface (current slice)

| Endpoint            | Source                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `GET /api/health`   | oRPC `health` procedure → `{ status, timestamp, service, version }` |
| `GET /openapi.json` | Generated from the oRPC contract                                    |
| `GET /`             | Redirect to `/api/health`                                           |

Web (`apps/web`) renders live health from the typed oRPC client. Deeper read surface is Phase 4.

### 5.1 Bootstrap (ADR-019, ADR-036)

The server bootstraps through `@gobing-ai/ts-infra` using a runtime-aware split:

| Entry                        | Bootstrap            | Subpath                     | Workers-Safe?       |
| ---------------------------- | -------------------- | --------------------------- | ------------------- |
| `src/index.ts` (Bun)         | `runNodeApplication` | `ts-infra/application-node` | No (uses `node:fs`) |
| `src/worker.ts` (CF Workers) | `runApplication`     | `ts-infra/application`      | Yes                 |

**Runtime seams:**

| Export                       | Runtime | Role                                                                                        |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `serverBootstrapConfig(env)` | Shared  | Portable `logging`/`telemetry`/`events` config with test-mute guard                         |
| `createApp(appRt?, opts?)`   | Bun     | Full Hono module registry, oRPC context, and local static assets                            |
| `createWorkerApp(env?)`      | Workers | Health, readiness, project identity, OpenAPI, and explicit 503 for local-runtime API routes |

The Worker entry uses a **lazy singleton** (`let rtPromise`) — no top-level await, `runApplication`
initialized on first `fetch`. Its static asset directory is `../../dist/web`, resolved relative to
`apps/server/wrangler.toml`. The Bun entry uses `runNodeApplication` mirroring the CLI (ADR-017).

## 6. Plugin System (Removed — ADR-012 amended 2026-06-09)

> **Amendment (2026-06-09):** The standalone `@gobing-ai/spur-plugin-sdk` is deleted. The bare
> lifecycle core (`Plugin` + `PluginHost`) lives upstream in `@gobing-ai/ts-infra` (shipped in
> `0.3.6`). Capability registries, trust ladder, manifest-driven discovery, and the server route
> seam are **deferred** — re-addable later on top of the ts-infra `Plugin` interface when a real
> plugin consumer exists. Mechanism lives in `03 §11`.

### 6.1 Current state

Spur consumes the ts-infra `Plugin` interface directly:

```ts
import type { Plugin, PluginHost } from "@gobing-ai/ts-infra/application";
```

The `Plugin` interface provides lifecycle hooks only: `onLoad`, `onStart`, `onStop`, `onUnload`,
plus `failFast`. The `PluginHost` drives registration and lifecycle fan-out (load → start →
stop → unload) with fail-fast load, fail-soft start/stop/unload in reverse registration order.

The `runApplication` / `runNodeApplication` bootstrap accepts `plugins`/`pluginHost` options
and drives the plugin lifecycle natively — no Spur-side host wiring needed.

### 6.2 Deferred (not permanently rejected)

| Concern                  | Status  | Notes                                                                                           |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Manifest (`plugin.yaml`) | Removed | Re-addable as YAML + Zod on the ts-infra `Plugin` interface                                     |
| Capability registries    | Removed | 9 registries (api, command, event, harness, provider, rule, skill, ui, worker) — re-addable     |
| Trust ladder             | Removed | 4-tier (`bundled` > `curated` > `local` > `untrusted`) — re-addable as registration-time gating |
| CLI plugin command       | Removed | `spur plugin list                                                                               | info` — re-addable when plugin discovery returns |
| Server route seam        | Removed | `mountPluginRoutes` / `collectPluginOpenApiPaths` — re-addable when plugins exist               |
| Plugin config override   | Removed | Per-plugin `.spur/plugins/<name>.yaml` — re-addable                                             |
| Event registry           | Removed | Glob-pattern + rate-limiting wrapper over `EventBus` — re-addable                               |

## 7. Planning Layer Surface (reserved — ADR-020; filled by Roadmap §1.5 Stage D)

Landing zone for the rd3-migration design output, reserved now so the system design has a defined
home and lands as subsection fills, not doc restructuring. Nothing below is invokable until
shipped (`05 §9` tracks status).

| Subsection                               | Will own                                                                                                                               | Design input until filled                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 `spur task` commands                 | Verbs, flags, exit codes — CRUD, WBS, `--section --from-file`, list/kanban, check, batch-create, resolve, migrate                      | triage doc Group A                                                                                                   |
| 7.2 `spur feature` commands              | Verbs/flags — CRUD, INDEX refresh, task-links, check, goal derivation                                                                  | triage doc Group B + the feature-file design spec (`cc-agents/docs/plans/2026-06-10-rd3-tasks-operator-feedback.md`) |
| 7.3 Frontmatter schemas                  | Zod field tables for task + feature files incl. `schema_version`, `parent_wbs`, `feature-id`, status enums                             | same design spec + triage A18/X02                                                                                    | `packages/domain/src/planning/schema.ts`; `taskFrontmatterSchema`, `featureFrontmatterSchema`, `TaskStatus`, `FeatureStatus` (DD-01/02/03/07/10/13/14). |
| 7.4 Section-Status-Matrix + format rules | Config file shapes under `./config` (ADR-015); warning-first enforcement core                                                          | triage A13/A14; `03 §12.3`                                                                                           |
| 7.5 Lifecycle workflow definitions       | `config/workflows/` task/feature lifecycle YAML shapes + guard wiring                                                                  | ADR-022; `03 §12.2`                                                                                                  |
| 7.6 Task DTOs                            | oRPC contract shapes for the board                                                                                                     | server/web design task (ADR-021.b)                                                                                   |
| 7.8 `sp:dev-*` command operations        | Dev-\* operation map (13 ops: 9 `Skill()`-backed + 4 inline; `implement` is a sub-mode of `run`; `dev-dogfood` → `sp:dogfood-testing`) | `plugins/sp/skills/spur-dev/references/dev-operations.md`                                                            |

### 7.1 `spur task` commands

Core CRUD and utility verbs. Every subcommand supports `--json` (ADR-010 invariant).
Source: delivery §1.1, design §10.

| Command                                | Flags                                                                                                                                    | Exit    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spur task`                            | — (noun help)                                                                                                                            | 0       | Lists subcommands if no subcommand given.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `spur task create <title>`             | `--feature <id>` `--parent <wbs>` `--template <variant>` `--dedupe-within <seconds>` `--allow-duplicate-name` `--folder <path>` `--json` | 0/1/2/3 | Race-safe WBS allocation; every create rejects an identical case-insensitive title in the same collision scope (same `--feature`, or no feature for unscoped creates) created within 300 seconds by default (exit 3, `duplicate-follow-up`); `--dedupe-within` accepts a positive-integer override; `--allow-duplicate-name` disables the guard. `--feature` enables B09 Goal→Background derivation; `--template` selects a section-matrix variant (`standard·feature-impl·issue·review·meta·brainstorm`; default `feature-impl` when `--feature`, else `standard`); unknown variant or invalid dedup window → exit 2. With `--json`, duplicate errors include `error.code`, `existingWbs`, `existingName`, and `attemptedName`; the success envelope carries additive top-level `wbs`/`filePath` mirrors of `ref.id`/`ref.filePath` so scripts projecting the `task list/show` key vocabulary never read nulls on success.                                                                                                                                                                                                                                                                        |
| `spur task show <wbs>`                 | `--folder <path>` `--json`                                                                                                               | 0/1     | Frontmatter is a top-level field in `--json` output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `spur task update <wbs> <status>`      | `--section <name> --from-file <path>` `--feature <id>` `--priority <p>` `--ac-numbering <mode>` `--folder <path>` `--json`               | 0/1/2   | Status transition runs lifecycle guard; `--section` reads body from file; `--feature`/`--priority`/`--ac-numbering` set the scalar frontmatter field on an existing task (the only post-create path, allow-listed to `feature_id`/`parent_wbs`/`priority`/`ac_numbering`, plus `done_forced`/`done_reason` written by the verdict-guard override). `--force-done` waives the verify **verdict** only — the FSM path still applies, so from an earlier status walk the hops first: `todo → wip → testing → done`, each running the structural `spur task check` (task 0487 R7b). An explicit `--section Solution --from-file` body must carry at least one recognized `file:line` citation (backticked `` `path:line` ``, bare `path.ext:line`, or adjacent file/line table cells) — validated at the write seam with the same predicate as the L3 checker (task 0510 R1), so an invalid authored Solution exits 3 before any mutation instead of being rejected later by `task check`; placeholder creation via templates / `sections init` is unaffected. `--ac-numbering task-local` opts a pre-existing task into the L3 Requirements↔AC coverage check; new tasks receive the field from the task templates.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `spur task list`                       | `--status <s>` `--phase <p>` `--parent <wbs>` `--feature <id>` `--folder <path>` `--json`                                                | 0/1     | `--phase` is a legacy alias for `--status`; `--feature` filters to tasks carrying that `feature_id` edge (exact match) — the enumeration primitive for feature-level execution loops. Filters combine (AND).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `spur task refresh`                    | `--folder <path>` `--json`                                                                                                               | 0/1     | Re-scan the task corpus and report counts. The generated `kanban.md` artifact was retired in the A17 cutover (task 0192) once the web task-kanban board (task 0191) became the daily driver — this verb no longer writes any file. `--json`: `{folders, tasks}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `spur task refresh-roster <wbs>`       | `--folder <path>` `--json`                                                                                                               | 0/1     | Regenerate a parent's sub-task roster block inside its `## Plan` (the generator half of the 0121 roll-up gate, task 0123). Scans `parent_wbs` children, renders a WBS·title·status table between `refresh-roster` auto-gen markers, and writes it idempotently — inserting the block (preserving hand-written Plan content) when absent, rewriting it in place when present. Zero children → clean no-op (`written:false`); no `## Plan` → error. `--json`: `{wbs, childCount, written}`.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `spur task migrate`                    | `--dry-run` `--folder <path>` `--json`                                                                                                   | 0/1     | Run the A17 task corpus normalization pass over the active task folder or `--folder`. `--dry-run` computes the full per-file report with zero writes; apply writes through the corpus migrator's atomic write path. Idempotent: a second run over a migrated corpus is a no-op. The live `docs/tasks2/` corpus was migrated 2026-07-04 (task 0192).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `spur task batch-create --file <json>` | `--folder <path>` `--json`                                                                                                               | 0/1     | Create many tasks from validated JSON — all-or-nothing for child creation; validated against `apps/cli/schemas/task-batch.schema.json` (A08/C03). After children land, every distinct `parent_wbs` is wired best-effort: parent roster refresh + `todo→wip` lifecycle transition. `--json`: `{created, wbs, parentsWired:[{wbs, rostered, transitionedTo, errors[]}]}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `spur task resolve <file-path>`        | `--folder <path>` `--json`                                                                                                               | 0/1     | Maps a path to owning task (WBS + file). Returns 1 if no match. Strategies: direct match, filename WBS parse, walk-up (A10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `spur task check [<wbs>]`              | `--strict` `--strict-core` `--corpus` `--since <ref>` `--folder <path>` `--json`                                                         | 0/1/2   | Four-layer validation (§3). L4 traceability: `feature_id`/`parent_wbs`/`dependencies` edge resolution + **AC coverage** (DD-09: task scenarios must be a subset of the linked feature's AC by normalized title — warnings by default) + **parent↔child roll-up** (ADR-020 amendment 2026-06-25, task 0121: for a decomposition parent, warn when the parent is `done` with an open child, when all children are closed but the parent is still open, or when the parent `## Plan` lacks a sub-task roster table — all warnings, `--strict` elevates; inert for tasks with no children). Without `--corpus`, validates all tasks in the active folder when `<wbs>` is omitted; `--strict` elevates ALL warnings; `--strict-core` is the `testing→done` hard-core gate variant. `--corpus` is mutually exclusive with `<wbs>` and runs the full active-task + feature sweeps in-process (all configured task folders remain visible to cross-folder edge and duplicate checks), reconciles `config/corpus-baseline.json` two-sided, and returns `{observed, baselined, newErrors, staleEntries, ok}` under `--json`; `--since <ref>` scopes its fog range and requires `--corpus`. New/stale findings or an unparseable sweep exit non-zero; invalid flag combinations exit 2. Matrix loaded from `.spur/tasks/section-matrix.yaml` with the bundled matrix fallback. |
| `spur task verdict <wbs>`              | `--from-answer <path>` `--folder <path>` `--json`                                                                                        | 0/1     | Derive the PASS/PARTIAL/FAIL/UNKNOWN gate verdict from the verify-step answer file and write `.spur/run/<wbs>-verdict.json`. Parses requirement rows, AC rows, and checks rows; behavior-bearing CORE AC rows marked `MET` without `test`/`command` evidence are downgraded to `PARTIAL` and surfaced via `evidence-rule-failed`. The deterministic replacement for grep-over-prose in the pipeline verify step (0109). Consumed by the completion gate and by `spur task record`.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `spur task record <wbs>`               | `--verdict-file <path>` `--solution-from-diff` `--transition <status>` `--folder <path>` `--json`                                        | 0/1     | Write Testing/Review from verify verdict; optional Solution backfill from `git diff` and status transition. Preserves `acceptanceCriteria[]` evidence rows in Testing when present. A `--transition done` with a **PASS** verdict auto-walks `wip → testing → done` through the FSM and auto-creates the `pipeline` run-link the provenance gate requires (task 0436 R4); a non-PASS verdict to `done` surfaces a single `GuardDeniedError` instead of a bookkeeping retry loop.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Exit codes:** 0 success, 1 error, 2 invalid usage. Follows the design §10 `api-response` envelope
for `--json` output (`{ ok, data? }`).

### 7.2 `spur feature` commands

Core feature verbs over `PlanningWriteService` (same write path as tasks). Features use
position-encoding hierarchical IDs (DD-14): single-letter top-level groups, children append one
digit 1–9 per level; ID length = depth; parent = drop the last character; **no `parent_id` field**.
Every subcommand supports `--json` (ADR-010 invariant). Source: delivery §1.2, design §2.2/§2.4.

| Command                                | Flags                                                                                        | Exit  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spur feature`                         | — (noun help)                                                                                | 0     | Lists subcommands if no subcommand given.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `spur feature create <name>`           | `--parent <id>` `--folder <path>` `--json`                                                   | 0/1   | ID allocated under the create-lock (R1): `--parent` → next free child digit 1–9; no parent → next free group letter A–Z.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `spur feature show <id>`               | `--folder <path>` `--json`                                                                   | 0/1   | Returns the feature summary + content; 1 if not found.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `spur feature update <id> [status]`    | `--field <key> --value <v>` `--section <name> --from-file <path>` `--folder <path>` `--json` | 0/1/2 | `<status>` runs the lifecycle transition (guarded, §7.5); `--field/--value` sets a scalar frontmatter field; `--section/--from-file` replaces an existing feature section body using the same body-only contract as `spur task update --section`. Section, field, and status updates may be composed in one invocation and apply in that order. 2 if an option pair is incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `spur feature advance <id>`            | `--to <status>` `--folder <path>` `--json`                                                   | 0/1   | Walk a feature through the legal forward lifecycle path (`backlog→active→verifying→done`, default target `done`). Runs the same feature checks the old wrapup shell ladder used before guarded hops (`active→verifying` non-strict, `verifying→done` strict), verifies observed status after each transition, and returns `{id,status,hops}` in `--json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `spur feature list`                    | `--status <s>` `--priority <p>` `--folder <path>` `--json`                                   | 0/1   | Lists features sorted by ID; optional status/priority filters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `spur feature check [<id>]`            | `--strict` `--as <status>` `--folder <path>` `--json`                                        | 0/1   | Four-layer validation (§3): L1 schema, L2 section-matrix, L3 BDD AC (shared 0043 module) + one-active-P0-goal over `active` (0418: `verifying` is terminal-bound and no longer counts as a goal; `--as <status>` evaluates the rule against the post-transition status so lifecycle guards never deny the exit they relieve) + ≤9-children (DD-14, corpus-derived), L4 incoming `feature_id` edges + orphan-scenario warnings + **AC coverage** (DD-09) + verdict-backed AC satisfaction from canonical `id` rows or the `scenario` compatibility alias + bounded malformed-artifact diagnostics + verifying-readiness (linked tasks not done/cancelled). Validates all features when `<id>` omitted; `--strict` elevates warnings. Details: [`feature-check-strict-ac-satisfaction.md`](design/feature-check-strict-ac-satisfaction.md). |
| `spur feature refresh`                 | `--folder <path>` `--json`                                                                   | 0/1   | Regenerate `INDEX.md` (deterministic ID-encoded tree, per-node status badge + relative link, §4.3) and repopulate each feature's `## Tasks` auto-gen marker region from task `feature_id` edges. Only the marker region is rewritten; the rest of the feature file and all task files are byte-preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `spur feature move <id> --parent <id>` | `--parent <id>` `--dry-run` `--folder <path>` `--json`                                       | 0/1   | Cascade-rename (DD-14): re-IDs the node + all descendants (ID encodes position), renames their files, rewrites each `id` frontmatter + appends a move History line, and updates every task `feature_id` edge. Validates the full old→new plan first (collision / ≤9 / not-into-own-subtree); applies atomically with best-effort rollback. `--dry-run` returns the old→new map + affected tasks with zero writes. Omit `--parent` to move to a top-level group.                                                                                                                                                                                                                                                                                                                                                                           |

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

| Field            | Zod type                                                  | Req | Notes                                          |
| ---------------- | --------------------------------------------------------- | --- | ---------------------------------------------- |
| `schema_version` | `z.literal(1)`                                            | ✔   | Strictness gate; future evolution (DD-03).     |
| `name`           | `z.string().min(1)`                                       | ✔   | Title; used in slug.                           |
| `description`    | `z.string().optional()`                                   | —   | No `description == name` default (DD-10).      |
| `status`         | `z.enum(TASK_STATUSES)` (transform → lowercase)           | ✔   | See §7.3.3; aliases accepted on input only.    |
| `type`           | `z.enum(['task','brainstorm']).default('task')`           | —   | `brainstorm` retained for corpus compat.       |
| `profile`        | `z.enum(PROFILES).optional()`                             | —   | Single key (DD-02); legacy `preset` collapsed. |
| `feature_id`     | `z.string().regex(/^[A-Z][1-9]*$/).nullable().optional()` | —   | Single traceability edge (DD-07).              |
| `parent_wbs`     | `z.string().regex(/^\d{4}$/).nullable().optional()`       | —   | Single sub-task convention (X02).              |
| `priority`       | `z.enum(['P0','P1','P2','P3']).optional()`                | —   | Aligned with the feature priority scale.       |
| `tags`           | `z.array(z.string()).optional()`                          | —   | Free-form filtering.                           |
| `dependencies`   | `z.array(z.string()).optional()`                          | —   | Soft WBS refs; `check` warns on dangling.      |
| `created_at`     | ISO 8601 string                                           | ✔   | Write-service-owned.                           |
| `updated_at`     | ISO 8601 string                                           | ✔   | Written **only** by the write service.         |

Removed from the legacy schema (A17): `impl_progress` (frozen-state problem), `folder` (derivable from
file location), `preset` (collapsed into `profile`).

### 7.3.2 Feature frontmatter — `featureFrontmatterSchema`

Mirrors `docs/design/rd3-migration-design.md` §2.2. No `parent_id` field (DD-14): the parent is derived
by dropping the last character of `id`.

| Field            | Zod type                                           | Req | Notes                                                                                                                                        |
| ---------------- | -------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version` | `z.literal(1)`                                     | ✔   | Same evolution mechanism as tasks.                                                                                                           |
| `id`             | `z.string().regex(/^[A-Z][1-9]*$/)`                | ✔   | Position-encoding hierarchical ID (DD-14).                                                                                                   |
| `name`           | `z.string().min(1)`                                | ✔   |                                                                                                                                              |
| `status`         | `z.enum(FEATURE_STATUSES)` (transform → lowercase) | ✔   | See §7.3.3; `verifying` is canonical.                                                                                                        |
| `priority`       | `z.enum(['P0','P1','P2','P3']).optional()`         | —   | Optional for parity with tasks; consumers default a missing value to `P2`. The P0 feature in `active`/`verifying` is the project goal (B09). |
| `tags`           | `z.array(z.string()).optional()`                   | —   |                                                                                                                                              |
| `created_at`     | ISO 8601 string                                    | ✔   | Write-service-owned.                                                                                                                         |
| `updated_at`     | ISO 8601 string                                    | ✔   | Write-service-owned.                                                                                                                         |

### 7.3.3 Canonical status vocabularies

Lowercase canonical values (DD-01); display layers capitalize. Input is case-insensitive and
alias-tolerant. The legacy alias map is preserved as input normalization — never as storage.

| Domain          | Canonical values                                                    |
| --------------- | ------------------------------------------------------------------- |
| `TaskStatus`    | `backlog · todo · wip · testing · blocked · done · cancelled`       |
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

- validated by the standard `loadStructuredConfig` path (`loadSpurConfig` in
  `apps/cli/src/config/loader.ts`, with the schema embedded for `--compile` binaries) — a typo'd section
  name or status key fails loud at load instead of becoming a dead rule. (The Zod `sectionMatrixSchema`
  in domain remains the typed contract + unit-test surface.) Each **template variant**
  (`standard·feature-impl·issue·review·meta·brainstorm` — the unified
  `TASK_VARIANTS` axis selected by a task's `template:` frontmatter, defaulting to `standard`) maps a
  status → { required, optional, forbidden } section lists, evaluated by `spur task check` /
  `spur feature check` (the L2 layer, design §3.2). `spur task check` resolves the variant from
  `fm.template ?? 'standard'` (not `type`). Ships permissive (warning-first); the hard-gate core is the
  `done` status (Solution + Testing + Review required, `gate: true`) plus the AC/Solution/Review format
  rules. `Root Cause` is optional for `meta` tasks because process/chore investigations may retain
  causal evidence without adopting the stricter `issue` template. Authority for matrix semantics:
  design §3 (the L2 layer), delivery §3.2.

**Matrix-driven creation (single producer).** The same matrix drives which sections a _new_ task
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

| Event                  | Fired when                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `task.created`         | A task file is created (including each item of a `batch-create`).                      |
| `task.updated`         | Any non-status write to a task (section edit, frontmatter change).                     |
| `task.transitioned`    | A task status change completes through the lifecycle workflow (includes cancellation). |
| `feature.created`      | A feature file is created.                                                             |
| `feature.updated`      | Any non-status write to a feature.                                                     |
| `feature.transitioned` | A feature status change completes (includes cancellation).                             |

Engine-seam events (from `ts-dual-workflow-engine`, per lifecycle/pipeline run — ADR-022):

| Event           | Fired when                                                                  |
| --------------- | --------------------------------------------------------------------------- |
| `on_transition` | A workflow run moves between states — the seam planning events derive from. |
| `on_guard_fail` | A guard (e.g. `spur task check` pre-gate) blocks a transition.              |
| `on_complete`   | A workflow run reaches its terminal state.                                  |

### 7.5 Lifecycle workflow definitions

Source: `config/workflows/task-lifecycle.yaml`, `config/workflows/feature-lifecycle.yaml`.
Authority: ADR-022 (lifecycles are engine configuration — no local FSM); design §2.3 (graphs +
guard placements), §5.1 (skeleton). Both are `kind: state-machine` definitions validated against
the engine schema shipped by the CLI, referenced as
`@gobing-ai/spur/schemas/state-machine-workflow.schema.json` (the schema file lives at
`apps/cli/schemas/state-machine-workflow.schema.json` and is exported via the package's
`./schemas/*` map).

| File                     | States (§2.3)                                                       | Initial   | Terminal      | Guards                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------- | --------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task-lifecycle.yaml`    | `backlog · todo · wip · testing · blocked · done · cancelled`       | `backlog` | `[cancelled]` | `wip→testing`: `spur task check <wbs>`; `testing→done`: `spur task check <wbs> --strict-core`                                                                                                                                    |
| `feature-lifecycle.yaml` | `backlog · active · verifying · blocked · done · cancelled` (DD-13) | `backlog` | `[cancelled]` | `active→verifying`: `spur feature check <id> --as verifying`; `verifying→done`: `spur feature check <id> --strict --as done` (0418: guards pass the edge target so the one-active-goal rule evaluates the post-transition state) |

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
state-machine`, shape `precheck → implement → test [→ test-fix ↔ test-recheck] → review →
approve(HITL) → verify → record → done` (precheck failure short-circuits to `failed`; `approve`
routes to `failed` on rejection or `cancelled` on cancel). Invariants: it never touches files
directly — status moves use the normal `spur task update <wbs> <status>` verb and section writes go
through `spur task record` (0108) / `spur task update --section`, so the lifecycle guards apply
identically; `approve` is a `hitl.confirm` gate skippable with `--vars '{"profile":"auto"}'`.

**Vars.** `wbs`, `profile`, `spurBin`, `agent`, `implementAgent`, `stepTimeoutMs`, `implementTimeoutMs`,
`maxImplementReqs`, `maxImplementPlanItems`, `qualityGateCmd`, `qualityGateMaxFixAttempts`,
`formatCmd`, `implementScopeGuard`, `__hitlAnswer`. The three command-shaped vars are the per-project override surface:
`qualityGateCmd` (default `bun run autofix && bun run spur-check`) is single-sourced across the soft
probe, the `/sp:dev-fixall` input and the recheck; `formatCmd` (default `bun run format`) is the
post-implement auto-format. `formatCmd` is invoked best-effort (`${vars.formatCmd} ; exit 0`) — a
missing or failing formatter must not abort a run, because `qualityGateCmd` at `test` is the gate
that actually decides. **Implement-only pin (task 0454):** `implementAgent` is used only by the
implement `agent.run` hop; override with `--vars '{"implementAgent":"omp-zai"}'` without retargeting
review/verify. **Agent var precedence (task 0487 R4):** caller `vars.implementAgent` > caller
`vars.agent` > `agent.default` > YAML literal, resolved per var — `--vars '{"agent":"claude"}'`
therefore reaches the implement hop too, where it previously lost to `agent.default`. Precheck logs
one divergence line when the two resolved executors differ. **Precheck auth gate (task 0487 R2):**
precheck probes both `$agent` and `$implementAgent` via `spur agent doctor <exec> --json` and writes
FAIL when either reports `authenticated: "unauthenticated"` or the doctor call exits non-zero;
`unknown` stays soft, and the `spur agent doctor` CLI exit-code contract is unchanged.
**Size precheck (0454, extended 0487 R3):** `maxImplementReqs` (default `5`) and
`maxImplementPlanItems` (default `8`) feed `plugins/sp/scripts/task-size-precheck.ts`, now also
passed `--executor "$implementAgent"`: a task past the **default** caps routed to an executor whose
`capabilityTier` is below `capable-1` fails the gate regardless of raised caps (unknown tier ⇒
`standard` ⇒ blocked). precheck→implement requires `.spur/run/<wbs>-precheck-size.status=PASS`.
**Diff-scope guard (task 0487 R1):** the implement step's `requireDiff` also rejects changes outside
the exact files and explicit directory/glob prefixes backticked in the target task's body, naming
the rogue files; new files beside an exact declared file are allowed, and a task body naming no
paths fails open. The guard snapshots the non-corpus tree before dispatch, so pre-existing dirt is
not attributed to the implementer. Set `--vars '{"implementScopeGuard":"off"}'` to bypass. **Edit surface:** change this YAML under
`config/workflows/task-pipeline.yaml` only (see §2.3 monorepo path model) — no hand-sync to
`.spur/workflows` or `apps/cli/config`.

**Step→command mapping (ADR-026, amended by ADR-043):** `implement` → `/sp:dev-run --mode implement`
(NOT `--mode full` — that drives this pipeline, so calling it here recurses); `test` → **the project
quality gate**, a soft shell probe of `${vars.qualityGateCmd}` plus a bounded pure-slash
`/sp:dev-fixall` loop — _not_ `/sp:dev-unit`, which is the coverage gap-fill competency (router
C3/C5). The gate run is tee'd to `.spur/run/${wbs}-test-gate.log`, and the `test-fix` hop passes
`--gate-log .spur/run/${wbs}-test-gate.log` to `/sp:dev-fixall` so the fix agent starts at the
captured finding's `file:line` anchor rather than re-deriving the failure (task 0482 R3);
`review` → `/sp:dev-review` (→ `sp:super-reviewer` → `sp:code-verification` +
`sp:functional-review` + `sp:code-improvement`; three dimensions — SECUA / functional /
architecture, task 0227); `verify` → `/sp:dev-verify` (→ `sp:code-verification` verify mode).

**Completion gate (ADR-026):** the `verify` step emits `.spur/run/<wbs>-verdict.json`; the
`verify → record` transition is a shell guard asserting `jq -r .verdict … = PASS`, with a sibling
`verify → failed` on the negation — so a PARTIAL/FAIL/missing verdict blocks `done`. This is the
spur-native replacement for rd3's default-on `--postflight-verify`.
**`task_run_links` pipeline linkage (kind=pipeline, R4):** resolved by task 0436 — `spur task record`
now auto-creates the `pipeline` run-link when recording a PASS verdict to `done`, so no link-writing
CLI verb is needed from a shell step.
**Step timeout (ADR-026 amendment, 2026-06-23, task 0107; raised task 0398 R4):** each `agent.run`
step carries a `timeoutMs` option — `${vars.stepTimeoutMs}` for review/verify/test-fix and
`${vars.implementTimeoutMs}` for the heavier implement hop, both defaulting to `"1800000"` (30 min).
On elapse the ts-libs `ProcessExecutor` kills the subprocess (never abandons it); the agent step
exits non-zero → `ok:false` → pipeline routes to `failed`, and a partial-work handoff artifact is
written to `.spur/run/<runId>-<state>-partial.md`. The artifact carries a `## resume context` block
naming the agent session dir (`.spur/run/<runId>/agent-sessions/<executor>/`) and the latched
session sidecar (`.spur/run/<runId>-agent-session.json`), so an operator resumes from the dead
agent's transcript instead of re-deriving it (task 0482 R4). Overridable per run via
`--vars '{"stepTimeoutMs":"120000"}'`. The `agent.run` action surface accepts `timeoutMs`
(number parsed from the workflow option or CLI string flag `--timeout`), forwarded through
`AgentService.executeRun` → `AiRunner.runPromptCommand` → `ProcessExecutor.run({ timeout })`.

**Run status (ADR-044):** terminal states partition into success and failure via an optional
`failureStates` subset of `terminalStates` (declared per workflow; absent ⇒ today's behavior). Landing
in a failure terminal finalizes the run as `status: "failed"` through `lifecycle.fail` — the persisted
run row, the `workflow.run.failed` event, and the CLI exit code all agree, so **`status` alone is
authoritative for pass/fail**. Judge a run by `status === 'done'`, never by string-matching a
`finalState` name the caller does not own. Workflows declaring no `failureStates` still finalize every
terminal as `done` (backward compatible).

**Pipeline section-ownership model (ADR-026 amendment, 2026-06-23, task 0106):** every
`done`-required section ([Solution, Testing, Review]) is owned by exactly one pipeline step:

| Required section          | Owning step                    | When                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Solution` (change-map)   | `/sp:dev-run --mode implement` | After writing code — the implement agent authors a markdown table of changed files with `file:line` + `what/why`. Idempotent (upsert via `replaceSection`); writes only when the section is bare (absent, empty, or a placeholder). |
| `Testing` (verdict table) | `record`                       | Post-verify — transcribes the per-requirement verdict + evidence from `.spur/run/<wbs>-verify-answer.txt` and `.spur/run/<wbs>-verdict.json`.                                                                                       |
| `Review` (P1–P4 findings) | `record`                       | Post-verify — transcribes SECU findings from the verify output.                                                                                                                                                                     |

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

| DTO                     | Key fields                                                                          | Notes                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskSummarySchema`     | `wbs, name, status, priority?, featureId?, parentWbs?, type?, filePath, updatedAt?` | List response. `type` and `priority` are extracted from frontmatter by the server handler. `priority` is a free-form `z.string()` (not the `PRIORITIES` enum) because the corpus mixes `P0–P3` with `high/medium/low`; the raw value is passed through. |
| `taskCreateInputSchema` | `title, featureId?, parentWbs?, folder?, template?`                                 | `template` selects a `TASK_VARIANTS` scaffold (R8); defaults to `standard` or `feature-impl` (when `featureId` set).                                                                                                                                    |
| `taskActionInputSchema` | `wbs, action, channel?, skipDeps?`                                                  | `action` ∈ `refine\|plan\|run\|verify\|decompose\|evaluate`. `channel` ∈ `claude\|codex\|gemini\|pi\|opencode\|antigravity\|openclaw`; `skipDeps` is persisted in the queued job metadata for dependency-bypass-aware runners (R9).                     |
| `taskFolderSchema`      | `path, label?`                                                                      | Folder entry from `docs/.tasks/config.jsonc` (R6).                                                                                                                                                                                                      |

### 7.7 Workflow action primitives for anti-hallucination (ADR-024)

Two primitives back the anti-hallucination migration (superskill task 0041):

| Primitive                  | Surface                                                  | Description                                                                                                                                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentService.runCapture`  | `packages/app/src/services/agent-service.ts`             | Opt-in capture path: returns `{ exitCode, answer }` without streaming or diagnostics. Uses buffered output mode.                                                                                                                                                                                          |
| Workflow `agent.run`       | `packages/app/src/workflow/actions/agent-run.ts`         | Always dispatches through `AgentService.runTraced`: buffered output, non-interactive stdin, and a sanitized resolved invocation persisted in `ActionResult.data`. `capture: true` only surfaces buffered stdout as `data.answer`. Direct `spur agent run` keeps its TTY-aware `run` / `runCapture` paths. |
| `response.validate` action | `packages/app/src/workflow/actions/response-validate.ts` | Reads `text` from options, calls injected `ResponseValidateEngine.validate()`, maps `{ ok, reason, issues }` to `ActionResult`. Engine injected via `SpurWorkflowBuiltinsOptions.responseValidateEngine` in `builtins.ts`.                                                                                |

**Engine seam:** `ResponseValidateEngine` interface (`{ validate(text: string): { ok, reason, issues? } }`) is the contract. The concrete engine is owned by superskill 0041 and provided by the externally-installed `cc:anti-hallucination` skill; the caller wires a thin adapter over its surface. The in-repo copy (`plugins/sp/skills/anti-hallucination/`) was removed once the migration completed (ADR-024 amendment, 2026-06-20); the seam itself is DI-only and unchanged.

**Retry/deny pattern:** transition-flow spike (`packages/app/tests/fixtures/anti-hallucination-spike.yaml`) confirms `validate → ok:done | fail:generate(bounded) | exhausted:denied` is expressible. `iterationBound` caps retries; a proper retry-count guard (checking `vars.__retryCount`) is future work (R3.1).

### 7.8 `sp:dev-*` command operations

The `sp:dev-*` commands back onto the orchestration spine plus competency skills
(`sp:spur-dev`, `sp:code-implementation`, `sp:code-testing`, `sp:code-verification`,
`sp:functional-review`, `sp:code-improvement`, `sp:doc-evolve`, `sp:brainstorm`, `sp:dogfood-testing`) or define their procedure inline. The
authoritative reference for all 13 operations — purpose, inputs, backing, behavior contract — is
[`plugins/sp/skills/spur-dev/references/dev-operations.md`](../plugins/sp/skills/spur-dev/references/dev-operations.md).
The `runall` operation (#13) is the batch entry — interactive sequential omit/inline keeps the
driver loop in the host session; explicit/parallel execution delegates it to `sp:super-planner` per
[`execution-batch.md`](../plugins/sp/skills/spur-dev/references/execution-batch.md).
Model-bearing operations share the single execution-surface selector `--agent <inline|auto|name>`
(`inline` is the default when omitted; the former `--inline`/`--subprocess` flags are collapsed into
it, ADR-041/047). `--agent auto` / `--agent <name>`, or another named dispatch-surface trigger,
selects `spur agent run`; headless workflow operations retain their `agent.run` subprocess actions.
Interactive full task execution uses the YAML-backed host driver defined in
[`inline-pipeline-driver.md`](../plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md).
Interactive omit/`inline` is host-controlled and **non-subprocess** (no `spur agent run`, no
`spur workflow run`), but eligible sequential model-bearing `agent.run` stages dispatch once to a
native platform subagent when the host exposes one with shared-worktree read/write/shell
capability; host fallback covers every ineligible stage, and post-dispatch failures follow the
stage error policy without host replay (ADR-047 amendment, task 0508). Operator confirmation
actions and approve/taste/ask decisions stay host-owned.
The SSOT is
[`cross-cutting.md`](../plugins/sp/skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
The `review` operation resolves to deterministic modes: WBS mode runs functional traceability (`sp:functional-review`), SECUA framework (`sp:code-verification`), and architectural depth (`sp:code-improvement`), writing findings to the task's `## Review` section; Path mode runs advisory SECUA and architecture with no task mutation. `--fix` is deprecated (no-op + warning; route remediation → `/sp:dev-verify --fix`). `--next` was **removed** from `dev-review` (feature H8, task 0401 R3): it had been a deprecated no-op, and once `--next` was redefined as chain-to-completion with propagation (ADR-039) keeping a no-op spelling of a now-meaningful flag would have been the fourth contradictory meaning. Route progression through `/sp:dev-next`.
The `handover` operation writes the durable handover SSOT to `docs/handover/<YYYY-MM-DD>-<slug>.md` and appends a pointer link into the task's `References` / `Notes` without clobbering existing content.
See [`dev-operations.md`](../plugins/sp/skills/spur-dev/references/dev-operations.md).

| Pattern              | Operations                                                                                          | Backing                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Skill()` delegation | implement, unit, review, verify, run, refine, plan, docs, brainstorm, dogfood, runall, debug, daily | `sp:code-implementation`, `sp:code-testing`, `sp:code-verification`, `sp:functional-review`, `sp:code-improvement`, `sp:spur-dev`, `sp:doc-evolve`, `sp:brainstorm`, `sp:dogfood-testing`, `sp:sys-debugging`, `sp:daily-summary` |
| Inline procedure     | changelog, gitmsg, fixall, handover                                                                 | git CLI + `spur` CLI + agent reasoning                                                                                                                                                                                            |

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

| Surface                            | Contract                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/observability/processes` | Snapshot of the serve PID tree + supervisor overlay                                                                                                                                        |
| Success body                       | `{ processes: ProcessInventoryRow[], rootPid: number, capturedAt: string }`                                                                                                                |
| Row fields                         | `pid`, `ppid`, `depth`, `source` (`serve` \| `supervisor` \| `descendant`), `label`, optional `agentId`, `command` (may be truncated), `status`, `rssBytes`, `elapsedSeconds`, `startedAt` |
| Unsupported OS                     | `501` + `{ error, code: "UNSUPPORTED_PLATFORM" }` (macOS + Linux only in v1)                                                                                                               |
| Team APIs                          | Unchanged — `GET /api/team/processes` remains supervised-agents-only for control clients                                                                                                   |

**Mechanism:** `ProcessInventoryService` (`packages/app`) walks OS processes via a
`ProcessInspector` port (default: `ps -axo pid=,ppid=,rss=,etime=,command=`), filters to
descendants of `process.pid`, and overlays `SupervisorService.list()` by pid for agent labels.
Board UI polls every ~3s. Threads/%CPU, host-wide shell `spur` CLIs, and ProcessExecutor live
registry enrichment are deferred.

### 7.8b Tool-use ledger (Observability → Tool Using)

Tasks **0245** / **0246** / **0247** / **0248**. The Tool Using tab is a **read-only** tail of the
project token ledger written by indexed-context hooks (task 0232) — not a second event store and not
a control plane.

| Surface                                          | Contract                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/observability/tool-use?limit=&before=` | Newest-first page; `before` = exclusive ISO cursor for older pages                                                                                                                                                       |
| Query                                            | `limit` default **200** max **1000**; optional `before`                                                                                                                                                                  |
| Success body                                     | `{ events, count, limit, truncated, path, capturedAt, sparseToolActivity, nextBefore }`                                                                                                                                  |
| `nextBefore`                                     | Oldest `ts` in page when more older events exist; else `null` (load-more cursor)                                                                                                                                         |
| Event fields                                     | `seq` (0=newest in page), `ts`, `session`, `type`, optional `file`, `summary`, `tokens`, `action`, `totals`, `sessionId`, `agent`, `model`                                                                               |
| Types                                            | `session_start` / `session_end` / `read` / `write` / `bash` / `grep` / `glob` (Edit → `write` + `action=edit`)                                                                                                           |
| Token semantics                                  | Present only when estimated; **omit** when unknown (UI shows `—`). Cascade: response → Write input → Edit strings → Read stat; Bash/Grep/Glob from **capped** response size only                                         |
| Capture tools                                    | PostToolUse matcher `Bash\|Grep\|Glob\|Read\|Write\|Edit` — no `*` / MCP without allowlist                                                                                                                               |
| Redaction                                        | Summary only (command / pattern / glob, ≤~200 chars); never full stdout; cap estimate input **4 KiB**; strip secret-like patterns                                                                                        |
| `GET /api/observability/tool-use/stream`         | SSE: `connected` then `tool-use` frames when the JSONL grows (`fs.watch` + byte poll)                                                                                                                                    |
| Missing file                                     | `200` + empty `events` (calm empty UI — not an error)                                                                                                                                                                    |
| Hard I/O failure                                 | `500` + `{ error }`                                                                                                                                                                                                      |
| Write path                                       | Hooks append JSONL only; Board never writes; no HTTP from hooks                                                                                                                                                          |
| UI                                               | Live prefers **SSE** (poll fallback if `EventSource` missing); **Load older** uses `before=nextBefore`; columns Time \| Type \| **Target** (file basename or summary) \| Action \| Tokens \| Session \| Agent? \| Model? |

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

| Tier             | Meaning                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `default`        | Persisted and streamed on the SSE channel without extra runtime config.                                  |
| `diagnostic`     | Persisted and streamed only when `SPUR_DIAGNOSTIC_EVENTS=1` (or `true`) is set on the server runtime.    |
| (out of catalog) | Emit is not part of the board contract — CLI-local buses, browser store notifications, raw Node signals. |

The `SPUR_DIAGNOSTIC_EVENTS` flag ships through `serverBootstrapConfig(env).events.diagnostic`
(`apps/server/src/bootstrap.ts`) and is consulted in two places: the system-event tap
(`registerSystemEventTap(bus, dao, logger, { diagnosticEnabled })`) and the SSE module when
building the stream name list. Diagnostic entries remain in the catalog so the UI can
filter them by `tier` once the toggle is enabled — no CLI restart required.

**Payload normalization.** `normalizeSystemEventPayload(entry, payload, secretValues?)` applies
the catalog payload policy before persistence/streaming. Sensitive keys are blanked for non-raw-safe
policies; the 0365 credential pattern and supplied configured secret values are replaced recursively
across primitive strings, objects, and arrays before each string is bounded to 256 characters.
`registerSystemEventTap(..., { secretValues })` and `SystemEventEmitter(..., retention, secretValues)`
carry this optional input. Server and CLI composition roots derive it with
`configuredSecretValues(env)`; callers that omit it still receive credential-pattern redaction.

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

| Service                                             | Wiring                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `AgentService.run()` / `runCapture()` (0219 + 0221) | `AiRunner({ events: bridge(events), processEvents: bridge(events) })`                               |
| `RuleService.evaluate()` / `evaluateVerbose()`      | `RuleEngine({ events: bridge(events) })` plus a forwarding subscription over the verbose local bus. |
| `WorkflowAppService.run()`                          | `EngineWorkflowService.runFile({ events: bridgeEngineEvents(events) })` via `createEngineService`.  |
| `TaskActionJob` (server-side queued job)            | `new AgentService({ events: ctx.eventBus(), ... })` in `serve.ts:runTaskActionJob`.                 |
| `JobQueue` / `QueueConsumer` (0190)                 | Already wired via `createServerContext` (forwards `queue.*`).                                       |

**Server-context integration tests (0219 AC).** `apps/server/tests/context.test.ts`
proves that `task.*` events flow through the canonical bus into `system_events`;
analogous tests for `rule.run.start`, `agent.invoke.start`, and `workflow.run.started`
are added in 0221 by emitting the upstream event through a service constructed with
`events: ctx.eventBus()` and asserting `dao.query({ name })` returns a row.

### 7.10 System event correlation columns (task 0369)

`system_events` carries four nullable correlation columns beside the original five,
so a run- or entity-scoped read is one indexed round trip instead of a client-side
scan of the newest-N window:

| Column        | Type      | Source                                              |
| ------------- | --------- | --------------------------------------------------- |
| `run_id`      | `TEXT`    | 0365 envelope `runId` (`workflow.*`, agent events)  |
| `sequence`    | `INTEGER` | 0365 envelope `sequence` — monotonic within one run |
| `entity_kind` | `TEXT`    | Planning event `entity.kind` (`task`, `feature`)    |
| `entity_id`   | `TEXT`    | Planning event `entity.id`                          |

Indexes: `idx_system_events_run_id` and the pair index `idx_system_events_entity
(entity_kind, entity_id)` — the pair, because entity ids are only unique within a kind.

**Derivation.** `extractSystemEventCorrelation` (`packages/app/src/services/system-event-tap.ts`)
is the single derivation, shared by both write paths — the server tap
(`registerSystemEventTap`) and the CLI planning emitter (`SystemEventEmitter`) — the
same one-canonical-derivation contract `extractSystemEventActor` holds for actor. Every
column is nullable: an event carrying neither run nor entity identity persists nulls.

**Migration.** `0008_spur_cli_system_events_correlation` adds the columns and indexes to
pre-0369 ledgers. It is columns-and-indexes only — no payload rewrite or backfill, so
pre-migration rows keep their `payload_json` and read back with nulls. Fresh databases
get the columns from the `0000` foundation DDL, so the migration carries
`addColumnIfMissing: { table: 'system_events', column: 'sequence' }` and journals itself
without executing the ALTERs (the `runs.external_key` precedent).

**Read surface.** `SystemEventDao.query` accepts `run_id`, `entity_kind`, and `entity_id`
filters, composed with `name`/`since` under AND. `GET /api/events/history` projects the
columns additively as `runId`, `entityKind`, `entityId`, `sequence`; no existing response
field is renamed, dropped, or re-typed.

**Server-side filters + keyset pagination (task 0372).** Filters run in SQL (never by
post-filtering a prefetched page). Order is `occurred_at DESC, id DESC` so a keyset
cursor is a total order under concurrent inserts.

| Surface                   | Contract                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/events/history` | Newest-first page over `system_events`                                                                 |
| Query (v1, preserved)     | `name`, `since`, `limit` (default **100**, max **500**)                                                |
| Query (0372)              | `prefix`, `names` (comma or repeated), `runId`, `actor`, `cursor`                                      |
| Success body              | `{ events, count, catalog, nextCursor, hasMore }` — `nextCursor`/`hasMore` are additive                |
| `nextCursor`              | Opaque base64url keyset of the last returned row when `hasMore`; else `null`                           |
| `prefix`                  | Cataloged family only (`SYSTEM_EVENT_PREFIXES`); unknown → **400** `{ error, code: "UNKNOWN_PREFIX" }` |
| `cursor`                  | Malformed → **400** `{ error, code: "MALFORMED_CURSOR" }` — never falls back to unfiltered             |
| DAO filters               | `prefix` (`LIKE 'prefix.%'`), `names` (`IN`), `actor`, `before: { occurred_at, id }` exclusive keyset  |
| Stability                 | Newer concurrent inserts do not reappear on later pages; rows older than the cursor are not skipped    |

## Workflow run-store read API (0373)

The durable record of what a pipeline did lives in the workflow run store
(`runs`, `phase_runs`, `transition_runs`, `action_runs`, `task_run_links`) —
not in the `system_events` ledger. Task 0373 exposes a **raw Hono** read surface
over that store so the Board (J4 Tasks tabview) can show a task digest with
progress and action log. Query composition and `result_json` redaction live in
`RunStoreService` (`packages/app`); the server module is transport-only and does
not import `ts-db` (ADR-021).

| Surface                     | Contract                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/runs`             | Newest-first list over `runs`                                                                                                                                |
| Query                       | `status`, `limit` (default **50**, max **200**), `cursor` (opaque keyset)                                                                                    |
| Success body                | `{ runs, count, nextCursor, hasMore }`                                                                                                                       |
| List entry                  | `{ id, workflowName, status, mode, agent, startedAt, completedAt }`                                                                                          |
| `cursor`                    | Malformed → **400** `{ error, code: "MALFORMED_CURSOR" }`                                                                                                    |
| Order                       | `started_at DESC, id DESC` exclusive keyset (stable under concurrent inserts)                                                                                |
| `GET /api/runs/:runId`      | One run + ordered `phases`, `transitions`, `actions`                                                                                                         |
| Action fields               | `id, node, kind, status, durationMs, ok, resultSummary, startedAt, completedAt`                                                                              |
| `resultSummary`             | Redacted/bounded projection of `result_json`: sensitive-key blanking plus recursive credential-pattern and configured-secret replacement; never the raw blob |
| Unknown id                  | **404** `{ error, code: "RUN_NOT_FOUND", runId }` — no partial/fabricated object                                                                             |
| `GET /api/runs/by-wbs/:wbs` | Every `task_run_links` row for the WBS with link `kind` + run digest                                                                                         |
| Empty WBS                   | **200** `{ wbs, links: [], count: 0 }` — not an error                                                                                                        |
| Optional query              | `limit` (default **50**, max **200**) on the WBS lookup                                                                                                      |

**Layering.** Domain DAOs own SQL (`RunDao.traceRows` / `traceRowById` with `agent` +
keyset `before`; `PhaseRunDao` / `TransitionRunDao` / `ActionRunDao` /
`TaskRunLinkDao`). `RunStoreService({ getDb, secretValues? })` composes them and redacts.
`summarizeActionResult(resultJson, secretValues?)` owns the trace-safe projection. `runsModule`
maps HTTP ↔ service results only.

## Team + Message HTTP Routes (0256)

The board's team supervision and inter-agent messaging surface is **raw Hono handlers** (not oRPC).
oRPC stays the planning-CRUD convention; the live board/streaming surface is raw + SSE (which oRPC
can't express). Web consumes via `fetchWithTimeout` + `resolveApiUrl` and native `EventSource`.

### Team routes (`apps/server/src/modules/team/index.ts`)

| Method | Path                             | Body / Query            | Response                                                                     | Notes                                                         |
| ------ | -------------------------------- | ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| GET    | `/api/team/processes`            | —                       | `{ processes: [{agentId, pid, status, startedAt, exitCode}], count }`        | List supervised processes (0243).                             |
| POST   | `/api/team/agents/:id/start`     | —                       | `{ ok, pid, status }` (201) or `{ error }` (400)                             | Spawn a supervised agent.                                     |
| POST   | `/api/team/agents/:id/stop`      | —                       | `{ ok }` or `{ error }` (400)                                                | Stop a supervised agent.                                      |
| POST   | `/api/team/processes/:id/stdin`  | `{ line: string }`      | `{ ok }` or `{ error }` (400)                                                | Forward a line to the process stdin.                          |
| GET    | `/api/team/processes/:id/stream` | —                       | SSE stream of `{stream, ts, line, seq}` frames                               | Ring-buffer replay + live tail. Heartbeat every 15s.          |
| GET    | `/api/team/teams`                | —                       | `{ teams: [{teamId, name, members: [{id, type, status, pid?}]}], count }`    | Teams grouped by `team:<id>` tag + config (0256 R2).          |
| POST   | `/api/team/:team/up`             | `?check=true` (dry-run) | `{ materialized: {upserted, orphaned, written}, started: [{id, ok, pid?}] }` | Materialize + best-effort start (0256 R3/R5).                 |
| POST   | `/api/team/:team/down`           | `?purge=true`           | `{ stopped: string[], purged: string[] }`                                    | Stop members + optional purge (0256 R3).                      |
| GET    | `/api/team/health`               | —                       | `{ ok: true }`                                                               | Liveness probe for CLI `team up` best-effort start (0256 R4). |

### Message routes (`apps/server/src/modules/messages/index.ts`)

| Method | Path                      | Body / Query                         | Response                                                                  | Notes                             |
| ------ | ------------------------- | ------------------------------------ | ------------------------------------------------------------------------- | --------------------------------- |
| GET    | `/api/messages/inbox`     | `?agent=<id>&limit=<n>`              | `{ messages: [{id, fromId, body, status, createdAt, inReplyTo}], count }` | One agent's inbox queue.          |
| GET    | `/api/messages`           | `?limit=<n>`                         | `{ messages: [...], count }`                                              | Global message feed (all agents). |
| POST   | `/api/messages`           | `{ fromId, toId, body, inReplyTo? }` | `{ msgId, toId, status: 'queued' }` (201)                                 | Enqueue a message.                |
| POST   | `/api/messages/:id/reply` | `{ fromId, body }`                   | `{ msgId, toId, status: 'queued' }` (201)                                 | Reply to a message.               |

**Convention:** response envelopes use `{ data…, count }` for lists and `{ ok, ... }` for mutations,
matching the existing board routes. Error shape: `{ error: string }` with the appropriate HTTP status.
All team routes are Bun-gated (require `ServerContext`); they return 503 on the Cloudflare Workers path.
