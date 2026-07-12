# How to Use Spur for Daily Software Development

> **Verified against spur `0.2.5` running on Bun `1.3.14`.** Every command and flag below
> was captured from the live `--help` output and exercised on the real project corpus.
> For the **slash-command layer** (the `sp` plugin, e.g. `/sp:dev-run`, `/sp:dev-idea`,
> `/sp:dev-wrap`) layered on top of these CLI verbs, see
> [How to Use the `sp:dev-*` Slash Commands](./how_to_use_dev_slash_commands_for_daily_software_development.md).

---

## 1. What Is Spur?

Spur is a **local-first harness engineering toolkit** for mainstream coding agents (Claude Code,
Codex, Gemini CLI, pi, omp, OpenCode, Antigravity, OpenClaw, Hermes, Grok). It is **not** a coding
agent and **not** a BYOK LLM platform. It wraps agents you already have installed and authenticated,
adding:

- **Execution discipline** — run any supported agent with a single command, capture structured output.
- **Constraint checking** — enforce architecture, style, and quality rules before code ships.
- **Workflow orchestration** — declare multi-step pipelines (implement → check → fix → done) as YAML.
- **Task & feature management** — markdown-backed planning with hierarchical IDs, lifecycle tracking.
- **History analytics** — import and analyze agent conversation logs for token/cost insights.
- **Team coordination** — durable inter-agent messaging and task assignment.

Spur owns no model-reaching path other than `spur agent run` (delegated to the installed agent).

---

## 2. Installation

### Prerequisites

- **Bun ≥ 1.3.14** on PATH (Spur runs as `.ts` under Bun; no compiled binary needed for dev).
- At least one supported coding agent installed and authenticated (run `spur agent doctor` to verify).

### From source (this repository)

```bash
git clone <repo> && cd spur
bun install
```

Run the CLI directly:

```bash
bun run apps/cli/src/index.ts --help
```

### From npm (published bundle)

```bash
npm i -g @gobing-ai/spur
spur --help
```

> The npm bundle ships a Bun bundle with a `#!/usr/bin/env bun` shebang — Bun must be on PATH.

### From standalone binary (Bun-less machines)

```bash
curl -fsSL https://<release-host>/install.sh | bash
```

Per-platform `--compile` binaries are GitHub Release assets for darwin/linux × arm64/x64.

### Verify installation

```bash
spur --version     # 0.2.5
spur agent doctor  # check every detected agent
spur agent list    # list detected agents
```

---

## 3. Project Initialization

Every project that uses Spur needs a one-time `init`:

```bash
spur init                    # scaffold .spur/ with config, rules, workflows
spur init --name my-project  # custom project name
spur init --minimal          # only the minimal .spur scaffold (no rules/workflows)
spur init --force            # recreate files that already exist
```

What `init` creates under `.spur/`:

| Path | Purpose |
|---|---|
| `config.yaml` | Project config (single surface, ADR-017 — supersedes the legacy `config.json`) |
| `agents/.gitkeep` | Team-mode agent specs dir (created regardless of `--minimal`) |
| `rules/` | Constraint rule presets (project layer) |
| `workflows/basic.yaml` | Canonical implement/check/fix loop |
| `spur.db` | SQLite database for run history, traces, planning events (WAL mode) |
| `logs/spur.log` | Bootstrap logger output |

> **Re-init guard:** `spur init` refuses (exit 1) when `.spur/config.yaml` already exists,
> unless `--force` is given — preventing a stray `init` from clobbering a configured project.

On first run, `spur init` also seeds `~/.config/spur/` from the bundled package-root `config/` assets
(existing files are never overwritten), so `spur rule run` resolves a real ruleset from any
project. `--json` output:

```bash
spur init --json
# → { "ok": true, "project": "my-project", "config": ".spur/config.yaml",
#      "created": [...], "skipped": [], "globalRulesSeeded": 0, "globalConfigSeeded": 1 }
```

Verify initialization:

```bash
spur status          # Project: ok, .spur: ok, Git: <branch>, AgentSpecs: [...]
spur status <path>   # also inspect a specific file/dir
```

---

## 4. CLI Surface (Quick Reference)

```
# Project + utilities
spur init           [--name <name>] [--force] [--minimal] [--json]
spur status         [path] [--json]
spur migrate        [--json]
spur serve          [--port <n>] [--host <addr>] [--no-open] [--cwd <path>] [--json]

# Agent execution surface
spur agent          run <prompt> [--agent <name>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--drain] [--json]
spur agent          list [--specs] [--json]
spur agent          doctor [agent] [--json]
spur agent          create <id> --type <agent-type> [--name] [--workspace] [--purpose] [--tags <a,b>] [--model] [--autonomy] [--system-prompt] [--no-identity-preamble] [--auto-start] [--json]
spur agent          edit <id>
spur agent          delete <id> [--force]

# Rule engine
spur rule           run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <s>] [--stop-on-first [<s>]] [--fix-mode <mode>] [--dry-run] [--verbose] [--json]
spur rule           validate [--file <path>|--preset <name>|<path>] [--kind <type>] [--no-schema] [--json]
spur rule           list [--preset <name>] [--json]
spur rule           trace [run-id] [--preset <name>] [--status <s>] [--since <iso-date>] [--last <n>] [--json]

# Workflow orchestration
spur workflow       validate <workflow.yaml> [--no-schema] [--json]
spur workflow       run     <workflow.yaml> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan] [--json]
spur workflow       continue [run-id] [--yes] [--json]
spur workflow       list    [--json]
spur workflow       trace   [run-id] [--workflow <name>] [--status <s>] [--since <iso-date>] [--last <n>] [--json]
spur workflow       cancel  <run-id> [--json]
spur workflow       clean   [--older-than <minutes>] [--force] [--dry-run] [--json]

# Task management
spur task           create  <title> [--feature <id>] [--parent <wbs>] [--template <variant>] [--folder <path>] [--json]
spur task           show    <wbs> [--folder <path>] [--json]
spur task           update  <wbs> [status] [--section <name> --from-file <path>] [--feature <id>] [--priority <p>] [--no-lifecycle] [--folder <path>] [--json]
spur task           list    [--status <s>] [--phase <p>] [--parent <wbs>] [--feature <id>] [--folder <path>] [--json]
spur task           refresh [--folder <path>] [--json]
spur task           refresh-roster <wbs> [--folder <path>] [--json]
spur task           batch-create --file <json> [--folder <path>] [--json]
spur task           record  <wbs> [--verdict-file <path>] [--solution-from-diff] [--transition <status>] [--folder <path>] [--json]
spur task           verdict <wbs> [--from-answer <path>] [--folder <path>] [--json]
spur task           check   [<wbs>] [--strict] [--strict-core] [--folder <path>] [--json]
spur task           resolve <file-path> [--strict] [--folder <path>] [--json]
spur task           path    <wbs> [--folder <path>] [--json]
spur task           migrate                              # reserved (A17) — not yet wired

# Feature management
spur feature        create  <name> [--parent <id>] [--folder <path>] [--json]
spur feature        show    <id> [--folder <path>] [--json]
spur feature        update  <id> [status] [--field <k> --value <v>] [--section <name> --from-file <path>] [--folder <path>] [--json]
spur feature        list    [--status <s>] [--priority <p>] [--folder <path>] [--json]
spur feature        move    <id> [--parent <id>] [--dry-run] [--folder <path>] [--json]
spur feature        refresh [--folder <path>] [--json]
spur feature        check   [<id>] [--strict] [--folder <path>] [--json]

# History analytics
spur history        import  --source <source> [--file <path>|--root <path>] [--mode <mode>] [--dry-run] [--json]
spur history        analyze [--since <iso-date>] [--json]
spur history        report  [--json]   # reserved — currently prints a TODO marker

# Team coordination
spur message        send    <body> --to <id> [--from <id>] [--json]
spur message        inbox   --agent <id> [--json]
spur message        reply   <msg-id> <body> [--json]
spur team           assign  <task-id> <agent-id>
spur team           status  [--json]
spur team           start | stop                # Phase-4 daemon stubs (exit 0)
```

Every command supports `--json` for machine-readable output.

---

## 5. Daily Development Workflow

A typical day with Spur follows this loop:

```
Plan → Implement (via agent) → Check (rules + tests) → Fix → Verify → Close task
```

### 5.1 Planning: Tasks and Features

**Features** are hierarchical containers (groups A–Z, then digit children: A1, A1→B1, etc.).
**Tasks** are WBS-numbered work items (0001, 0002, …) linked to features via
`--feature <id>`. Both go through a CLI-gated lifecycle — never edit the file directly.

```bash
# Create a feature
spur feature create "User authentication"              # → allocates a group letter (e.g. F7)
spur feature create "OAuth provider" --parent F7       # → F71

# List features
spur feature list                    # all features with status/priority
spur feature list --status active    # filter by status

# Show a feature
spur feature show F7

# Update a feature — three composable modes (section / scalar field / status):
spur feature update F7 active                              # lifecycle transition
spur feature update F7 --field priority --value P0        # set a scalar field
spur feature update F7 --section Goal --from-file ./goal.md  # replace Goal body (body-only)

# Validate features
spur feature check          # validate all features (4-layer check)
spur feature check F7       # validate one feature
spur feature check --strict # warnings become failures

# Regenerate INDEX.md and ## Tasks blocks
spur feature refresh

# Move a feature (cascade-renames the subtree)
spur feature move F71 --parent B   # → B + next digit
spur feature move F71 --dry-run    # preview the old→new ID map
```

```bash
# Create a task
spur task create "Implement login endpoint" --feature F7
spur task create "Add unit tests" --parent 0089
spur task create "Research X" --template brainstorm

# Show a task
spur task show 0089

# Update a task — three composable modes (section / scalar / status):
# (a) Lifecycle transition (positional status)
spur task update 0089 wip
spur task update 0089 done          # guarded — requires non-empty Plan section
# (b) Section replace (--section requires --from-file; body-only)
spur task update 0089 --section Plan --from-file ./plan.md
# (c) Scalar frontmatter field (allow-listed: feature_id, parent_wbs, priority)
spur task update 0089 --feature F71
spur task update 0089 --priority P0

# List tasks
spur task list                       # all tasks
spur task list --status wip          # filter by status
spur task list --parent 0089         # filter by parent WBS
spur task list --feature F71         # filter by linked feature (feature_id edge)

# Validate tasks
spur task check            # validate all tasks (4-layer check)
spur task check 0089       # validate one task
spur task check --strict   # elevate ALL warnings to failures
spur task check --strict-core   # gate variant: fail only on hard-core errors (the testing→done guard)

# Regenerate kanban.md from the task corpus
spur task refresh

# Regenerate a parent's sub-task roster block
spur task refresh-roster 0089

# Batch-create tasks from JSON (all-or-nothing, validated against task-batch.schema.json)
spur task batch-create --file ./tasks-batch.json

# Pipeline integration verbs
spur task record 0089 --verdict-file .spur/run/0089-verdict.json --solution-from-diff --transition testing
spur task verdict 0089 --from-answer .spur/run/0089-verify-answer.txt
spur task resolve src/auth/login.ts
spur task path 0089
```

**Task statuses:** `backlog → todo → wip → testing → blocked → done` (also `cancelled`).
`done` is re-enterable (reopen with warning + mandatory History entry).

**Feature statuses:** `backlog → active → verifying → done` (also `cancelled`).
`verifying` is DD-13's status — makes verification derivable, listable, event-triggerable.

> **Note:** `spur task update <wbs> done` is guarded — it refuses if the `### Plan` section is
> empty or placeholder-only. Fill the Plan section first:
> `spur task update <wbs> --section Plan --from-file ./plan.md`, then transition to `done`.

### 5.2 Implementing: Agent Execution

Spur delegates to installed coding agents via a single command:

```bash
# Run a prompt with auto-detected agent (default: auto)
spur agent run "Add a login endpoint to src/auth/"

# Run with a specific agent
spur agent run "Fix the failing test" --agent codex
spur agent run "Summarize the diff" --agent grok

# Resume the previous session
spur agent run "Continue" --continue

# Specify a model (explicit --model wins over the configured one)
spur agent run "Refactor the DB layer" --agent gemini --model gemini-2.0-flash

# Output mode (text|json) — Grok maps text → --output-format plain
spur agent run "Generate a summary" --mode json --json

# Working directory for agent execution
spur agent run "Run the tests" --cwd ./packages/domain

# Team mode: prepend pending inbox messages for a team agent spec
spur agent run "Work on task 0089" --agent reviewer --drain
```

**Exit codes** for `spur agent run`: 0 success · 1 agent-not-found / known-but-unusable ·
2 invalid arguments / unknown executor · 3 agent execution failure.

Canonical coding-agent ids (`ts-ai-runner` 0.4.8+): `claude`, `codex`, `gemini`, `pi`, `omp`,
`opencode`, `antigravity-cli`, `openclaw`, `hermes`, `grok`. Grok auth uses `XAI_API_KEY` and/or
`~/.grok/auth.json` (no CLI auth-status verb).

**Agent management:**

```bash
spur agent list             # list detected coding agents (includes grok when installed)
spur agent list --specs     # list team agent specs (.spur/agents/*.yaml)
spur agent doctor           # check readiness of all agents
spur agent doctor claude    # check one agent
spur agent doctor grok      # Grok: version + XAI_API_KEY / ~/.grok/auth.json

# Create a team agent spec
spur agent create reviewer --type codex --purpose "Code review specialist" --tags review,quality
spur agent create builder --type grok --purpose "Implementation agent"

# Edit a spec (opens $EDITOR, or prints the path)
spur agent edit reviewer

# Delete a spec (requires --force)
spur agent delete reviewer --force
```

> **Single LLM execution surface:** every model call in Spur routes through `spur agent run`.
> Workflow `agent.run` actions and sp skills all delegate to this same command. Spur owns no
> other model-reaching path. `--agent` resolution goes through the `agent` config block —
> `auto` (default) / explicit name / `current` (reads `SPUR_AGENT`).

### 5.3 Checking: Rules and Constraints

Rules enforce architecture, style, and quality invariants before code ships.

```bash
# Run the default pre-check preset (cheap static rules)
spur rule run

# Run a specific preset
spur rule run --preset recommended-post-check   # heavier quality checks
spur rule run --preset strict-check

# Run a single ad-hoc rule file
spur rule run --file ./my-rule.yaml

# Filter to one rule ID
spur rule run --rule no-direct-fetch

# Control failure threshold
spur rule run --fail-on warning    # exit 1 on any warning or error
spur rule run --fail-on info       # exit 1 on any finding

# Stop after the first finding (at/above severity)
spur rule run --stop-on-first          # defaults to error
spur rule run --stop-on-first warning  # stop at first warning

# Fix mode (auto-apply fixes)
spur rule run --fix-mode auto          # apply fixes
spur rule run --fix-mode auto --dry-run  # preview fixes without writing
spur rule run --fix-mode suggest       # suggest fixes in output

# Verbose: stream per-rule progress to stderr
spur rule run --verbose

# JSON output
spur rule run --json
```

**Rule management:**

```bash
# List discovered rule files (inventory, not evaluation)
spur rule list                    # all rule files across sources
spur rule list --preset strict-check  # rules in a specific preset

# Validate a rule file or preset (without evaluating)
spur rule validate ./my-rule.yaml
spur rule validate --preset strict-check
spur rule validate my-rule.yaml --no-schema   # skip JSON schema validation

# Show persisted rule run history
spur rule trace                   # recent runs (default last 20)
spur rule trace <run-id>          # one run timeline
spur rule trace --status failed   # filter by status
spur rule trace --since 2026-06-01 --last 50
```

**Rule sources (layered, highest-priority first):**
1. `SPUR_RULES_PATH` env var
2. Local `.spur/rules/` (project layer)
3. Global `~/.config/spur/rules/` (user layer, or `SPUR_GLOBAL_RULES_DIR`)
4. Bundled fallback (from `@gobing-ai/ts-rule-engine`)

### 5.4 Orchestrating: Workflows

Workflows declare multi-step pipelines as YAML (state-machine format). They drive the
implement → check → fix loop, task lifecycles, feature lifecycles, and the new
idea / wrapup phases (task 0167).

```bash
# List available workflow YAML files
spur workflow list

# Validate a workflow definition
spur workflow validate config/workflows/basic.yaml
spur workflow validate config/workflows/basic.yaml --json
spur workflow validate config/workflows/basic.yaml --no-schema  # skip schema check

# Run a workflow
spur workflow run config/workflows/basic.yaml

# Run with per-run variables (JSON object — there is no --var key=value form)
spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0089"}'

# Dry-run: validate and walk transitions without executing actions
spur workflow run config/workflows/basic.yaml --dry-run

# Run async: detached worker, monitor via trace
spur workflow run config/workflows/task-pipeline.yaml --async --json
# → { "runId": "...", "status": "started", "workflowName": "..." }
# Monitor: spur workflow trace <run-id>

# Resume a paused (HITL) workflow run
spur workflow continue              # resume the most recent paused run
spur workflow continue <run-id>     # resume a specific run
spur workflow continue --yes        # resume without prompting

# Cancel an async run
spur workflow cancel <run-id>       # SIGTERMs the worker + agent grandchild

# Clean stale non-terminal runs
spur workflow clean --older-than 30
spur workflow clean --force        # ALL non-terminal regardless of age
spur workflow clean --dry-run      # list, don't write

# Show persisted workflow run history
spur workflow trace                 # recent runs (default last 20)
spur workflow trace <run-id>        # one run timeline
spur workflow trace --workflow task-pipeline --status running
spur workflow trace --since 2026-06-01 --last 50
```

**Bundled workflows** (in `config/workflows/`):

| Workflow | Purpose | Phase |
|---|---|---|
| `basic.yaml` | Canonical implement → check → fix → done loop | Example |
| `task-lifecycle.yaml` | Task status transitions (backlog → todo → wip → testing → done) | Entity FSM |
| `feature-lifecycle.yaml` | Feature status transitions (backlog → active → verifying → done) | Entity FSM |
| `task-pipeline.yaml` | Task execution pipeline (precheck → implement → test → review → approve → verify → record → done) | Execution |
| `feature-dev.yaml` | Feature umbrella (brainstorm → plan → execute-tasks → feature-verify → done) | Umbrella execution |
| `planning-pipeline.yaml` | Planning pipeline (phasing → feature-id → design-gen → design-approval → handoff) | Planning |
| `idea-pipeline.yaml` | Idea → feature + AC + task batch (discovery → … → handoff) | Ideation (new 0167) |
| `wrapup-pipeline.yaml` | Post-execution wrap-up (task-resolve → doc-sync → learning-capture → metrics-record → feature-transition → branch-cleanup → done) | Wrap-up (new 0167) |

**Workflow action kinds** (run by the engine at state entry): `note`, `shell`, `agent.run`,
`hitl.confirm`, `event.emit`, `file.exists`, `file.read`, `http.request`.

**Guard kinds** (used in `transitions[].guard`): `shell`, `always`, `never`, `action-ok`.

### 5.5 History Analytics

Import and analyze agent conversation logs.

```bash
# Import from a specific agent source
spur history import --source pi --file ~/pi/logs/conversation.jsonl
spur history import --source claude --root ~/.claude/projects/
spur history import --source codex --root ~/.codex/sessions/ --mode incremental

# Sources: pi|claude|codex|gemini|opencode|antigravity|openclaw
# Modes: full|incremental|force-file

# Dry-run (scan without persisting)
spur history import --source pi --root ~/pi/logs/ --dry-run

# Analyze imported data
spur history analyze
spur history analyze --since 2026-06-01 --json

# Report (reserved — currently prints a TODO marker)
spur history report
```

### 5.6 Team Coordination

Durable inter-agent messaging and task assignment.

```bash
# Assign a task to an agent spec
spur team assign 0089 reviewer

# List agent specs and their run status
spur team status

# Send a message to an agent
spur message send "Please review the auth endpoint" --to reviewer
spur message send "Urgent: tests failing" --to reviewer --from operator

# Check an agent's inbox
spur message inbox --agent reviewer

# Reply to a message (threads the conversation)
spur message reply msg-001 "Looks good, merging"
```

> **Team mode (Phase 1–3):** `team assign` + `message send` + `agent run --drain <spec-id>`
> folds the spec's inbox into the prompt and maps spec-id → coding-agent type.
> `team start/stop` are deferred daemon stubs that point users at `--drain`.

### 5.7 Serving the Web UI

```bash
# Start the Spur web server (local fallback)
spur serve                         # default: localhost:3000, opens browser
spur serve --port 8080 --host 0.0.0.0
spur serve --no-open               # skip opening the browser
spur serve --json                  # output { port, url, pid } and exit
```

The web server is Hono on Bun.serve (local) or the Cloudflare Worker (production). UI
modules are auto-discovered at build time from `apps/web/src/modules/` — see
[How to Add a UI Module](./how_to_add_a_new_ui_module.md).

### 5.8 Migrations

```bash
spur migrate    # apply CLI-owned schema migrations to .spur/spur.db
```

---

## 6. The Daily Loop (Putting It Together)

A complete feature implementation cycle, from planning to shipped:

```bash
# 1. Plan: create a feature and tasks (planning half)
spur feature create "Add OAuth login" --parent F7
spur feature update F71 --section Goal --from-file ./goal.md        # body-only
spur feature update F71 --section "Acceptance Criteria" --from-file ./ac.md
spur feature check F71 --strict                                     # gate: AC must validate
spur task create "Implement OAuth callback handler" --feature F71
spur task create "Add token refresh" --feature F71
spur task batch-create --file ./tasks-batch.json                    # gate: schema must validate

# 2. Refine a task just-in-time
spur task update 0089 --section Plan --from-file ./plan.md
spur task update 0089 --section Solution --from-file ./solution.md
spur task update 0089 wip                                            # FSM transition

# 3. Run the single-task pipeline (executes the work; auto-skips the HITL gate)
spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0089","profile":"auto"}'

# 4. Verify the verdict
cat .spur/run/0089-verdict.json   # { "verdict": "PASS" }
spur task record 0089 --verdict-file .spur/run/0089-verdict.json --solution-from-diff --transition testing

# 5. Close: transition to done
spur task update 0089 done          # guarded by `spur task check --strict-core`

# 6. Wrap up: learnings, metrics, doc-sync, optional feature transition + branch cleanup
spur workflow run .spur/workflows/wrapup-pipeline.yaml \
  --vars '{"tasks":"[\"0089\"]","profile":"auto"}'

# 7. Refresh the board
spur feature refresh
spur task refresh
```

**Alternative — drive a whole feature in one call.** `feature-dev.yaml` enumerates the
feature's tasks and runs each through `task-pipeline.yaml` automatically, then strict-checks
the feature before certifying `done`:

```bash
spur workflow run config/workflows/feature-dev.yaml --vars '{"featureId":"F71"}'
```

**Async long runs.** The full single-task pipeline can take many minutes (each `agent.run`
stage can take the full `stepTimeoutMs`, default 10 min). For CI / unattended execution, run
detached and poll the trace:

```bash
RUN=$(spur workflow run config/workflows/task-pipeline.yaml \
  --vars '{"wbs":"0089","profile":"auto"}' --async --json | jq -r '.runId')
spur workflow trace "$RUN"   # poll until status is terminal (done/failed)
spur workflow cancel "$RUN"  # SIGTERM the worker + agent grandchild if needed
```

---

## 7. JSON Output Convention

Every command supports `--json`. Representative envelope shapes (verified):

```bash
spur task list --json        # → array of task objects [{wbs, name, status, filePath, frontmatter}, ...]
spur task show 0089 --json   # → single task object {wbs, name, status, ..., frontmatter}
spur task refresh --json     # → { kanban_path: "docs/tasks/kanban.md" }
spur feature list --json     # → array of feature objects [{id, status, priority, name}, ...]
spur rule run --json         # → { preset, ruleCount, findings[], fixes[] }
spur rule list --json        # → { totalFiles, ...sources }
spur workflow list --json    # → { layers, entries, totalFiles }
spur workflow run f.yaml --dry-run --json   # → { runId, workflowName, mode, status, finalState, transitionsTaken, reason }
spur workflow run f.yaml --async --json     # → { runId, status: "started", workflowName }
spur agent list --json       # → { agents: [{name, installed, version, ...}] }
spur agent doctor --json     # → { agents: [{agent, installed, authenticated, usable, tier, ...}] }
spur agent run ... --json    # → { exitCode, stdout, stderr, durationMs }
spur status --json           # → { ok, packageJson, spurConfig, git: {root, branch, dirty}, agentSpecs, path? }
spur team status --json      # → { agents: [...] }
spur message inbox --agent X --json   # → { messages: [...], count }
```

Use `--json` for scripting, CI integration, and when piping to other tools.

---

## 8. Configuration

### Project config (`.spur/config.yaml`)

Per ADR-017, the project uses a single YAML config surface (the legacy `config.json` is
retired). The Zod-validated schema lives in `@gobing-ai/spur-config`. A canonical example:

```yaml
$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"
version: "1"
name: my-project

bootstrap:
  logging:
    enabled: true
    level: info           # debug | info | warn | error
    console: true
    json: true
    file: true
    filePath: .spur/logs/spur.log
  database:
    enabled: true
    driver: bun-sqlite
    url: .spur/spur.db    # ${DATABASE_URL} interpolation supported
  telemetry:
    enabled: false
  scheduler:
    enabled: false

agent:
  default: pi             # default executor when no phase matches
  default-by-phase:
    # phase → named `agent.executors` profile
    dev-run: { name: orchestrator, agent: claude, model: opus-4 }
  executors:
    orchestrator: { name: orchestrator, agent: claude }

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
    docs/tasks: { baseCounter: 0, label: Core }
  active: docs/tasks

features:
  dir: docs/features
```

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Override the SQLite DB path (default: `<cwd>/.spur/spur.db`). Use `:memory:` for ephemeral. |
| `SPUR_RULES_PATH` | Additional rule root (highest priority) |
| `SPUR_GLOBAL_RULES_DIR` | Override global rules dir (default: `~/.config/spur/rules`). Setting this suppresses the bundled fallback. |
| `SPUR_TELEMETRY_ENABLED` | Toggle telemetry (`true`/`1`/`yes`/`on`) |
| `SPUR_TELEMETRY_ENDPOINT` | Telemetry endpoint |
| `SPUR_LOG_LEVEL` | Log level (`debug`/`info`/`warn`/`error`) |
| `SPUR_AGENT` | Read by `spur agent run --agent current` |
| `PORT` | Server port for `spur serve` (default: 3000) |
| `HOST` | Bind address for `spur serve` (default: localhost) |

---

## 9. Known Limitations and Notes

- **`spur history report`** is a reserved surface that currently prints a TODO marker. The
  full flag grammar is registered; implementation is deferred.
- **`spur team start|stop`** are deferred daemon stubs that print the daemon-not-available
  message and exit 0. Team mode uses `--drain` (prepend-on-drain) rather than live daemons.
- **`spur task migrate`** is reserved (A17) — a one-time corpus normalization gate, not
  yet wired.
- **`spur feature migrate`** is reserved — a one-time feature-corpus normalization, not
  yet wired.
- **Concurrent SQLite access:** Spur uses SQLite in WAL mode with a 5-second busy timeout.
  Multiple spur processes can run concurrently against the same project DB, but heavy
  concurrent writes may still contend. For hermetic test runs, use `DATABASE_URL=:memory:`.
- **Stale global install:** if a globally-installed `spur` (e.g. `~/node_modules/@gobing-ai/spur`)
  exists, it may shadow the workspace CLI. During development, always run
  `bun run apps/cli/src/index.ts` to use the current source.

---

## 10. Verification Gate

Before declaring work "done," run the project gate:

```bash
bun run lint     # biome check + per-workspace tsc --noEmit
bun run test     # bun test --coverage (all workspaces)
bun run test-cf  # Cloudflare Workers Vitest (server)
bun run build    # clean, then build cli/server/web into dist/
```

A change is complete only when all four pass and `git status` shows only intentional changes.

---

## 11. References

- **Slash-command layer (recommended for most users):**
  [How to Use the `sp:dev-*` Slash Commands](./how_to_use_dev_slash_commands_for_daily_software_development.md)
- **End-to-end workflow system (the 26 steps + diagrams):**
  [`docs/design/e2e-workflow-for-system-development.md`](../design/e2e-workflow-for-system-development.md)
- **Architecture:** `docs/03_ARCHITECTURE.md`
- **CLI design (every command/flag/config):** `docs/04_DESIGN.md`
- **Feature status:** `docs/05_FEATURES.md`
- **Decisions (why):** `docs/00_ADR.md`
- **Scope (what):** `docs/01_PRD.md`
- **Roadmap (when):** `docs/02_ROADMAP.md`
- **Process (how docs are maintained):** `docs/99_PROJECT_CONSTITUTION.md`
- **Agent guide:** `AGENTS.md` (read first every session)
