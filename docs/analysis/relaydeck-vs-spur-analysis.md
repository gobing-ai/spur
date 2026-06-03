# relaydeck vs Spur — Deep-Dive Analysis

**Date:** 2026-06-02
**Analyst:** Lord Robb (Robin Min)
**Scope:** Full codebase review of `vendors/relaydeck` (v0.1.3) vs Spur `bun run apps/cli/src/index.ts agent run`

---

## Executive Summary

**relaydeck** and **Spur** are both *harness-native* toolkits — they wrap real vendor CLI coding agents (Claude Code, Codex, pi, OpenCode, Cursor, Antigravity) rather than shipping their own model runtime. However, they operate at **radically different architectural levels**:

- **relaydeck** is a **team OS**: a persistent daemon that manages a team of long-running, unattended agents with live observability, peer-to-peer messaging, and a plugin-extensible event bus.
- **Spur** (`agent run`) is a **stateless CLI launcher**: a one-shot `exec` that detects which agent to run, translates a prompt to the agent's CLI format, spawns the process, and returns the result.

The critical insight: **relaydeck builds everything Spur does not** — persistence, multiplexing, observability, messaging, and orchestration. These are not competitors; relaydeck's architecture is a natural *superstructure* above what `spur agent run` provides today.

---

## 1. relaydeck Architecture Deep Dive

### 1.1 Core Engine (`relaydeck/`)

| Module | LOC | Role |
|--------|-----|------|
| `orchestrator.py` | ~1350 | Agent lifecycle: create, start, stop, restart, message injection, semantic status |
| `harness/base.py` | ~1246 | PTY subprocess wrapper, identity preamble, message delivery to live PTYs |
| `plugin.py` | ~2065 | Plugin registry, discovery, event bus (`PluginEventBus`), trust ladder |
| `db.py` | ~1200 | SQLite schema, migrations, `open_db`, message/agent/usage tables |
| `sdk.py` | ~1400 | Public plugin SDK (`Plugin`, `PluginHost`, `PluginContext`, `RemoteHost`) |
| `skills.py` | ~640 | Skill discovery, validation, hashing, materialization, injection helpers |
| `worktrees.py` | ~910 | Git worktree create/remove/list, workspace hooks, status, diff |
| `prompts.py` | ~710 | Interactive prompt lifecycle (open → answered/expired/canceled) |
| `transports/cli.py` | ~2700 | Full Click CLI (70+ commands), daemon start/stop, agent mgmt, plugins |
| `transports/api.py` | ~2500 | FastAPI + SSE + WebSocket, OpenAPI docs, agent/message/plugin endpoints |
| `web/static/` | ~20 JS files | Build-less Lit dashboard + UI kit (`RelayElement`, `RelayLens`, tile system) |
| `automation/actions.py` | ~480 | Action dispatcher: `agent.message`, `script`, `gh`, `bus.emit`, `code`, `model` |

### 1.2 Plugin System (30+ Bundled Plugins)

**Architecture:** Everything beyond the core runtime is a `RelaydeckPlugin`. The core `relaydeck/` package **never statically imports** any plugin; plugins import only public facades (`relaydeck.sdk`, `relaydeck.harness`, `relaydeck.provider`). Plugins are discovered at startup via `_scan_package("plugins")`.

**Plugin capabilities** (declared in `plugin.toml`):
- `cli.register` — Click command groups
- `api.register` — FastAPI route registration
- `ui.register` — Dashboard tiles, lenses, overlays
- `events.subscribe` / `events.emit` — Plugin event bus
- `workers.register` — Background threads
- `harness.register` / `provider.register` — Agent types / model providers
- `skills` — Skill materialization (`[plugin.skills]`)

**Trust ladder:** `bundled > curated > local > untrusted`

**Key plugins:**

| Plugin | Function |
|--------|----------|
| **messaging** | Durable agent-to-agent inbox + CLI/dashboard surfaces. PTY injection with readiness gates, echo confirmation, late drain, reply threading |
| **prompts** | Tap-able choice prompts (not blocking stdin). Agents ask; human picks on dashboard |
| **hitl** | Human-in-the-loop escalation. `awaiting-input` detection → plugin-bus event → Telegram/Dashboard notification |
| **metering** | Token/cost tracking per agent. Multi-provider pricing (catalog + models.dev). Usage tiles |
| **usage_limits** | Rolling session/weekly quotas with auto-pause |
| **vault** | Encrypted secrets. `${vault:NAME}` substitution at agent start. Keys never leave daemon |
| **loop** | Schedule-driven (interval/cron) or event-driven action dispatcher |
| **gateway** | External webhook ingress (`/api/gateway/webhook/<channel>`) |
| **github** | `gh` CLI poller for issues/PRs; rule-based routing to agents |
| **telegram** | Chat → agent routing. Slash commands (`/new`, `/restart`, `/screenshot`, `/stop`) |
| **file_watcher** | Workspace file events → bus events |
| **harnesses/** | 7 harness plugins: pi, claude-code, codex, cursor, opencode, antigravity, relaydeck-native |
| **providers/** | 4 provider catalog plugins: openai, anthropic, openrouter, ollama |
| **external_agents** | Read-only health observation of Hermes Agent and OpenClaw runtimes |

### 1.3 Agent Lifecycle

```
relaydeck agent create <name> --type <harness> --purpose "..." --tags "..."
    → writes ~/.relaydeck/agents/<name>.yaml (YAML source of truth)
    → DB mirrors subset for fast queries

relaydeck agent start <name>
    → Orchestrator.start_agent()
    → HarnessAgent.run() in dedicated thread
    → Spawns CLI in PTY: e.g. `claude --permission-mode auto --append-system-prompt "..." --print`
    → Injects identity preamble (self + peers)
    → Injects workspace AGENTS.md + skills
    → Injects any queued messages (drain on start)
    → Begins SSE/WebSocket streaming of output
    → Semantic engine polls PTY screen → derives status (working/awaiting-input/complete-unread/idle)
```

**Key difference from Spur:** The harness CLI runs *unattended* and *persistently* in a PTY. It doesn't exit after one prompt — it stays alive, waiting for the next message injection.

### 1.4 Autonomy Posture

Every harness translates one cross-harness knob (`config.autonomy`) into native permission flags:
- `"auto"` → `--permission-mode auto` (Claude), `--sandbox workspace-write --ask-for-approval never` (Codex)
- `"bypass"` → skip all checks
- `"locked"` → only allowlist runs
- `"manual"` → operator drives flags

The `relaydeck` CLI is *always* auto-allowed so peer messaging never stalls.

### 1.5 Messaging Architecture

The most sophisticated subsystem. Message delivery over an unreliable PTY transport:

```
relaydeck workspace message --agent <target> "..."
  → CLI POSTs to daemon HTTP API
  → Daemon writes to SQLite (durable, queued)
  → If target agent is live (PTY output observed recently):
      → Inject message bytes into PTY via HarnessAgent.send_message()
      → \r handling, newline normalization, split-write for debouncing TUIs
  → If target is cold: leave queued, drain on next start
  → Optional echo confirmation: poll PTY screen for message ID → mark delivered
  → relaydeck reply <msg_id> <body>: infers recipient + threads reply
  → Cleanup: prune delivered/failed past retention; queued never pruned by age
```

### 1.6 Dashboard Architecture

- **Build-less:** Vendored Lit (`lit-all.min.js`), no bundler
- **Real-time:** SSE event stream + WebSocket PTY terminals
- **LiveStore pattern:** `live.subscribe(path, cb)` not polling; `live.invalidate(prefix)` on mutations
- **Lens system:** `RelayLens` base class with `sidebar()/detail()` templates
- **Tile system:** `RelayElement` + `defineTile`, framework-neutral `mount(container, api, ctx)` for plugins
- **Terminal safety:** xterm.js tile owns its own WebSocket; never re-rendered by reactive callbacks
- **Shared UI kit:** `<rd-toggle>`, `<rd-settings-form>`, modals, CSS design tokens

### 1.7 Semantic Status Engine

Cross-harness, screen-sampling state machine:

```
pyte Screen emulator ← PTY snapshot (every 1.5s)
  → Detect patterns (working spinner, error markers, input prompt)
  → Derive: working | awaiting-input | complete-unread | idle
  → Defer to authoritative sources (vendor hooks, manual) for 45s
  → Write to DB → emit agent.status_changed event
```

Workspace health rolls up: `errored > awaiting-input > working > complete-unread > idle > stopped > empty`

---

## 2. Spur `agent run` Architecture

### 2.1 Architecture

Spur's `agent run` is a **stateless CLI command** that delegates everything to the external `@gobing-ai/ts-ai-runner` package:

```
spur agent run "prompt" --agent <name> --model <model> --mode <mode> --cwd <path>
  ↓ apps/cli/src/commands/agent.ts:runAgentRun()
  ↓ AgentDetector.detect() → find installed agents
  ↓ DoctorRunner.check(agent) → verify readiness
  ↓ AiRunner.run({ prompt, agent, model, mode, cwd })
  ↓ AiRunner translates to agent CLI args:
      claude:  claude -p "prompt" --model <model> --output-format <mode>
      codex:   codex exec "prompt" --model <model>
      pi:      pi -p "prompt" --model <model>
      gemini:  gemini -p "prompt"
      ...
  ↓ Spawns as child process (Bun.spawn / child_process)
  ↓ Streams stdout/stderr → console
  ↓ Returns AgentRunResult { exitCode, stdout, stderr, signal?, durationMs }
```

### 2.2 Command Surface

| Command | Role |
|---------|------|
| `spur agent run <prompt>` | One-shot agent invocation |
| `spur agent list` | Detect installed agents |
| `spur agent doctor` | Readiness check per agent |
| `spur rule run/validate/list` | Constraint evaluation |
| `spur workflow validate/run/list` | Workflow orchestration |
| `spur history import/analyze/report` | JSONL analytics |
| `spur init` | Project scaffold |
| `spur status` / `spur migrate` | Supporting utilities |

### 2.3 What Spur Does NOT Have

| Capability | relaydeck | Spur |
|------------|-----------|------|
| Persistent daemon | Yes (FastAPI + SSE + WS) | No (stateless CLI) |
| Multi-agent orchestration | Yes (orchestrator, multi-agent) | No (one-shot, one agent) |
| Agent-to-agent messaging | Yes (durable SQLite + PTY injection) | No |
| Live web dashboard | Yes (Lit + SSE/WS + lenses) | No (read-oriented server stub) |
| Plugin system | Yes (30+ plugins, trust ladder) | No (commands are hardcoded) |
| Semantic status | Yes (screen-sampling engine) | No |
| PTY terminal streaming | Yes (xterm.js + WebSocket) | No (raw stdout) |
| Usage metering / limits | Yes (token/cost tiles, quotas) | Yes (history analyze, post-hoc) |
| Secrets vault | Yes (`${vault:NAME}` + encryption) | No |
| Human-in-the-loop | Yes (prompts + escalation + Telegram) | No |
| Git worktree management | Yes (create/remove/status/hooks) | No |
| Automation/loops | Yes (interval/cron/event-driven) | Partial (workflow engine only) |
| Skills management | Yes (discover/validate/hash/inject) | No (agent's own system) |
| Provider abstraction | Yes (unified preset → provider/model) | Partial (pass-through to agent) |
| Agent identity preamble | Yes (self + peers discovery) | No |
| External agent observation | Yes (Hermes/OpenClaw read-only) | No |
| Desktop notifications | Yes (HITL escalation) | No |

---

## 3. Key Architectural Differences

### 3.1 Execution Model

| | relaydeck | Spur |
|---|---|---|
| **Model** | Persistent PTY (agent stays alive, receives messages) | One-shot subprocess (agent exits after one prompt) |
| **Conversation** | Multi-turn via PTY injection | Single prompt → response |
| **State** | SQLite + YAML, daemon-owned | Stateless (DB is for analytics, not runtime) |
| **Continuation** | Native (agent never exits) | `--continue` flag (resumes last session) |

### 3.2 Design Philosophy

| | relaydeck | Spur |
|---|---|---|
| **Primary UI** | Web dashboard | CLI terminal |
| **Extensibility** | Plugin system (everything is a plugin) | External engine packages (pre-compiled) |
| **Scope** | Team OS (long-running, multi-agent) | Single-shot runner + analytics |
| **Language** | Python 3.12+ | TypeScript/Bun |
| **Package mgmt** | pip/uv | Bun workspaces |
| **Observability** | Live SSE + WebSocket + dashboard | Exit code + stdout/stderr + JSON output |

### 3.3 Overlap — What Both Do

Both projects:
- Wrap real vendor CLI agents (harness-native, not BYOK LLM)
- Detect installed agents (`doctor` / `list`)
- Translate a common interface to agent-specific CLI flags
- Support multiple agent types (Claude Code, Codex, pi, OpenCode, Cursor, Antigravity)
- Have `--json` output for automation
- Support `--model` / `--mode` / `--cwd` parameters
- Have workflow orchestration (relaydeck via loop plugin, Spur via `ts-dual-workflow-engine`)
- Have history/analytics (relaydeck via metering, Spur via `ts-llm-jsonl-importer`)
- Have rule/constraint evaluation (relaydeck via github plugin rules, Spur via `ts-rule-engine`)

---

## 4. What Spur Can Learn from relaydeck

### 4.1 High-Impact, Feasible Enhancements

#### A. Agent Identity Preamble

**What relaydeck does:** At spawn time, injects a markdown block into the agent's system prompt describing: the agent's own ID, workspace, purpose, tags, and a list of peer agents with their purposes and the `relaydeck workspace message` command they can use to collaborate.

**Why it matters for Spur:** Even in a single-shot model, providing the agent with awareness of its own role and available tooling improves output quality. Spur already has workspace config — adding a generated identity block to the prompt would be low-effort, high-impact.

**Implementation:** Add `--role <purpose>` and `--tags <list>` flags to `spur agent run`. Generate a preamble block (`You are agent <name> in workspace <ws>. Your purpose: <purpose>`) and prepend it to the prompt.

#### B. Human-in-the-Loop Prompting

**What relaydeck does:** When an agent needs human input (e.g., Claude Code's `ask_user`), the `prompts` plugin intercepts it, stores a structured prompt with tap-able choices in SQLite, and surfaces it on the dashboard. The human picks; the answer is injected back into the PTY. The `hitl` plugin escalates to Telegram.

**Why it matters for Spur:** `spur agent run` is a blocking CLI call. If an agent hits an approval prompt, the process hangs. The operator has to `Ctrl-C` or switch to the agent's own TUI. A prompt-redirect mechanism would let Spur handle this gracefully.

**Implementation:** Detect agent approval prompts from stdout patterns. Surface them as structured choices (or fallback to raw input). This requires a mode where the agent process is interactive, not just one-shot.

#### C. Provider/Model Presets (Unified Abstraction)

**What relaydeck does:** `~/.relaydeck/presets/<name>.yaml` maps friendly names to `provider/model` pairs (e.g., `fast = openai/gpt-4o-mini`). Every agent config references a preset, not a raw model string. The harness resolves `preset` → `provider/model` at spawn.

**Why it matters for Spur:** `--model` is pass-through to the agent CLI, meaning the operator must know agent-specific model names (`claude-sonnet-4-20250514` vs `gpt-5.1`). A preset system abstracts this.

**Implementation:** Add `spur preset add <name> --provider <p> --model <m>` and `--preset <name>` to `spur agent run`. Resolve presets before passing `--model` to the agent.

#### D. Usage Metering at Runtime

**What relaydeck does:** The `metering` plugin subscribes to agent usage events, records per-call token/cost data to SQLite, and surfaces live tiles on the dashboard. The `usage_limits` plugin enforces rolling quotas with auto-pause.

**Why it matters for Spur:** Spur has `spur history analyze` for post-hoc analytics, but no live cost tracking. Adding a `--track-usage` flag to `spur agent run` that records per-call token counts would bridge this gap.

**Implementation:** Parse agent stdout for token usage patterns (most agent CLIs emit token counts). Store in `history_etl_*` tables at call completion. Expose via `spur history analyze --live`.

### 4.2 Medium-Impact, More Complex

#### E. Multi-Agent Orchestration (Team Mode)

**What relaydeck does:** The orchestrator manages multiple agents simultaneously, each in its own thread. Agents discover peers via the identity preamble and message each other via the `messaging` plugin. The `loop` plugin drives scheduled or event-driven agent dispatch.

**Why it matters for Spur:** `spur workflow run` already has a dual-mode workflow engine. Extending it to spawn multiple agents in parallel and route messages between them would enable complex multi-agent pipelines.

**Implementation:** Extend `spur workflow run` to support agent spawn actions. Use a lightweight message queue (SQLite-backed like relaydeck) for inter-agent communication. This is a significant feature — likely a Phase 3+ item.

#### F. Plugin System

**What relaydeck does:** 30+ plugins, all discovered at startup, each declaring capabilities in `plugin.toml`. Trust ladder gates access. Plugins add CLI commands, API routes, dashboard UI, event subscriptions, and agent types.

**Why it matters for Spur:** Spur's current architecture hardcodes commands and routes. A plugin system would allow third-party extensions without modifying core — particularly useful for custom harnesses, rules, or analytics pipelines.

**Implementation:** Design a plugin manifest format (YAML/TOML). Allow plugins to register CLI subcommands and API routes. Gate with a trust model. This is a Phase 4+ architectural change — significant but powerful.

#### G. Live Web Dashboard

**What relaydeck does:** Build-less Lit dashboard with xterm.js terminals, SSE event streaming, and a lens/tile system for extensibility. The dashboard is the *primary* UI; CLI is at parity.

**Why it matters for Spur:** Spur's `apps/web` is a thin read-oriented stub. A live dashboard for observing agent runs, viewing token usage, and managing workflows would transform the UX from CLI-only to a full observability surface.

**Implementation:** Build on Spur's existing Astro + oRPC stack. Add SSE endpoints to `apps/server`. Build a dashboard with live agent output streaming and workflow visualization. This is the most complex enhancement — probably Phase 4+.

### 4.3 Low-Impact, Quick Wins

| Enhancement | relaydeck Feature | Spur Implementation |
|------------|-------------------|---------------------|
| `--purpose` flag | Agent purpose tag | Add to `spur agent run`; inject into prompt |
| `--tags` flag | Agent metadata tags | Add for future filtering/routing |
| Agent ID validation | `[a-z][a-z0-9]*(-[a-z0-9]+)*` | Add to `spur agent run --agent` resolution |
| Workspace AGENTS.md injection | Auto-include workspace context | Read `.spur/AGENTS.md` and prepend to prompt |
| Skill directory discovery | `workspaces/<ws>/skills/` | Scan `.spur/skills/` and inject into prompt |
| Semantic exit codes | `complete-unread` → `idle` transition | Parse agent output for completion markers |
| Slash-command routing | `/new`, `/restart`, `/screenshot` | Already exists in `ts-ai-runner`; extend set |
| Model catalog caching | Provider catalog → models.dev | Cache model lists to avoid repeated CLI probes |

---

## 5. Architectural Patterns Worth Adopting

### 5.1 Plugin-First Architecture

relaydeck's "everything is a plugin" approach means the core engine (~3000 LOC) is small, and all capability lives in self-contained plugins. This is architecturally superior to Spur's hardcoded command tree because:

- **Testability:** Each plugin is independently testable
- **Extensibility:** Third-party plugins without core changes
- **Separation of concerns:** Engine, harness, provider, and UI are decoupled
- **Trust boundary:** Plugin capabilities are declared and gated

Spur could adopt this incrementally: start with a plugin manifest for harness registration, then extend to rules, analytics, and UI.

### 5.2 YAML as Source of Truth, SQLite as Mirror

relaydeck's pattern is elegant: YAML files are the canonical config (human-editable, git-friendly), SQLite mirrors a subset for fast queries and runtime state. The orchestrator resyncs DB from YAML on every boot. This eliminates drift between config and runtime state.

Spur could adopt this for agent/workspace config: `.spur/config.json` (or YAML) → SQLite mirror for analytics queries.

### 5.3 CLI ↔ Daemon over HTTP

relaydeck's CLI never touches live PTY state directly — it POSTs to the daemon's HTTP API. This means:
- CLI can run from anywhere (different terminal, SSH session)
- API and dashboard share the same mutation endpoints
- CLI is always at parity with web UI (same HTTP calls)

Spur is currently local-process-only. Adding a daemon would be a major architectural shift, but even without one, structuring CLI commands as thin HTTP clients would prepare for it.

### 5.4 Semantic Status Engine

The screen-sampling approach (`pyte` emulator → pattern matching → status derivation) is clever and harness-agnostic. It works for *any* PTY-based agent, regardless of whether the vendor exposes hooks. This is more robust than relying on exit codes or stdout parsing alone.

Spur could implement a lighter version: parse agent stdout for known completion/error patterns and derive structured status from it.

### 5.5 Best-Effort Messaging over PTY

The layered reliability approach (readiness gate → live write → echo confirmation → late drain) is necessary because PTY injection is inherently unreliable. The design documents the failure modes and defenses explicitly. This level of rigor in handling an inherently unreliable transport is instructive for any system that programs a TUI-based agent.

---

## 6. What relaydeck Does NOT Do (and Spur Does)

| Capability | Spur | relaydeck |
|------------|------|-----------|
| Rule constraint engine | `spur rule run` (ts-rule-engine) | No equivalent (github plugin has basic rules) |
| Dual-mode workflow engine | FSM + transition-flow (ts-dual-workflow-engine) | Loop plugin (simpler, event/interval-driven) |
| JSONL history import | `spur history import` (ts-llm-jsonl-importer) | No equivalent (metering is live-only) |
| History ETL analytics | Per-source, per-model, daily aggregation | No equivalent |
| Type-safe contracts | oRPC (contract ↔ handler compile-time) | FastAPI (runtime-only type checking) |
| Monorepo with shared tsconfig | Bun workspaces + ts-base | Single Python package |
| Conventional commits + changelog | Enforced | Manual CHANGELOG.md |

These are Spur's **strengths** — areas where relaydeck could learn from Spur's approach, particularly the workflow engine sophistication and the type-safe API contract layer.

---

## 7. Summary: What to Build Next

### Tier 1 — Immediate Value (Days)

1. **`--purpose` and `--tags` flags** on `spur agent run` with identity preamble injection
2. **Provider/model presets** (`spur preset add/use`) to abstract agent-specific model names
3. **Workspace AGENTS.md / skills injection** into agent prompts
4. **Runtime usage metering** (parse agent stdout for tokens → record to DB)

### Tier 2 — Architectural Enhancement (Weeks)

5. **Plugin manifest system** for harness/provider/rule registration
6. **Semantic exit code / status derivation** from agent stdout patterns
7. **Human-in-the-loop prompt redirection** (detect approval prompts → surface to operator)
8. **YAML config as source of truth** for agent/workspace definitions

### Tier 3 — Strategic (Months)

9. **Live web dashboard** with agent output streaming (SSE + WebSocket)
10. **Multi-agent orchestration** with inter-agent messaging
11. **Persistent daemon mode** with CLI ↔ API parity
12. **Plugin ecosystem** with trust ladder and capability gating

---

## Appendix: File Map

### relaydeck Key Files

```
relaydeck/orchestrator.py         Agent lifecycle, event bus, type registry
relaydeck/harness/base.py         HarnessAgent: PTY spawn, identity preamble, message injection
relaydeck/agents_base.py          BaseAgent class (thread, status, emit)
relaydeck/plugin.py               PluginRegistry, RelaydeckPlugin, PluginEventBus, trust ladder
relaydeck/sdk.py                  Public SDK facade (Plugin, PluginHost, PluginContext)
relaydeck/skills.py               Skill discovery, validation, hashing, materialization
relaydeck/worktrees.py            Git worktree create/remove/status/diff/hooks
relaydeck/prompts.py              Interactive prompt lifecycle (open→answered/expired)
relaydeck/semantic_engine.py      Screen-sampling status derivation (pyte)
relaydeck/config.py               AgentSpec, WorkspaceConfig, ModelPreset, YAML/TOML loading
relaydeck/db.py                   SQLite schema, migrations, agent_messages, usage_events
relaydeck/messages.py             Message envelope, format rendering
relaydeck/transports/cli.py       Full Click CLI (2700 LOC, 70+ commands)
relaydeck/transports/api.py       FastAPI + SSE + WebSocket + OpenAPI (2500 LOC)
relaydeck/web/static/             Build-less Lit dashboard (app.js, lenses/, tiles/, uikit/)
relaydeck/automation/actions.py   Action dispatcher (agent.message, script, gh, model, code)
relaydeck/provider_config.py      Provider config + model catalog helpers
relaydeck/harness_options.py      Harness catalog + CLI probe detection
plugins/messaging/plugin.py       Durable peer messaging (58KB, the largest plugin)
plugins/prompts/plugin.py         Tap-able choice prompts
plugins/hitl/plugin.py            Human-in-the-loop escalation
plugins/loop/agent.py             Schedule/event-driven LoopAgent
plugins/gateway/plugin.py         External webhook ingress
plugins/github/plugin.py          GitHub poller + rule-based routing
plugins/telegram/plugin.py        Telegram chat ↔ agent routing (107KB)
plugins/metering/plugin.py        Token/cost metering
plugins/usage_limits/plugin.py    Rolling quota enforcement
plugins/vault/plugin.py           Encrypted secrets vault
```

### Spur Key Files

```
apps/cli/src/index.ts             CLI entry, dispatch, banner
apps/cli/src/commands/agent.ts    Agent run/list/doctor (delegates to ts-ai-runner)
apps/cli/src/commands/rule.ts     Rule run/validate/list (delegates to ts-rule-engine)
apps/cli/src/commands/workflow.ts Workflow validate/run/list (delegates to ts-dual-workflow-engine)
apps/cli/src/commands/history.ts  History import/analyze/report (delegates to ts-llm-jsonl-importer)
apps/cli/src/context.ts           CliContext (db, logger, runtime adapter)
apps/cli/src/args.ts              Arg parsing (commander-like)
apps/cli/src/db/migrations.ts     CLI schema SQL composition
packages/domain/src/              DAOs, schema definitions (via ts-db defineTable)
packages/contracts/src/           oRPC transport contracts
packages/config/src/              Zod config schema + env parsing
docs/00_ADR.md                    Architecture decisions (authoritative)
docs/04_DESIGN.md                 CLI surface, config schema, data shapes

~/xprojects/ts-libs/packages/
  ts-ai-runner/                   AgentDetector, DoctorRunner, AiRunner
  ts-rule-engine/                 RuleEngine, evaluators, presets
  ts-dual-workflow-engine/        FSM + TransitionFlow engine
  ts-llm-jsonl-importer/          SourceDefinition pipeline, incremental import
  ts-db/                          DbAdapter, BaseDao, defineTable, migrations
  ts-infra/                       Logger, EventBus, telemetry
  ts-runtime/                     RuntimeContext, FileSystem, ProcessExecutor
  ts-utils/                       Output, errors, api-response, cursor helpers
```
