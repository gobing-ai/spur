# How to Use Spur for Daily Software Development

> **Verified against spur `0.2.5` running on Bun `1.3.14`.** Every command and flag below was
> captured from the live `--help` output and exercised on the real project corpus.

---

## 1. What Is Spur?

Spur is a **local-first harness engineering toolkit** for mainstream coding agents (Claude Code,
Codex, Gemini CLI, Antigravity, pi, OpenCode, OpenClaw). It is **not** a coding agent and **not** a
BYOK LLM platform. It wraps agents you already have installed and authenticated, adding:

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
| `config.yaml` | Project config (tasks folders, features dir) |
| `config.json` | Machine-readable config mirror |
| `rules/` | Constraint rule presets (symlinked to repo `config/rules/`) |
| `workflows/` | Workflow YAML definitions (symlinked to repo `config/workflows/`) |
| `spur.db` | SQLite database for run history, traces, planning events (WAL mode) |

Verify initialization:

```bash
spur status          # Project: ok, .spur: ok, Agents: <detected>, Git: <branch>
spur status <path>   # also inspect a specific file/dir
```

---

## 4. CLI Surface (Quick Reference)

```
spur init       [--name <name>] [--minimal] [--force] [--json]
spur status     [path] [--json]
spur agent      run <prompt> [--agent <name>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--drain] [--json]
spur agent      list [--specs] [--json]
spur agent      doctor [agent] [--json]
spur agent      create|edit|delete <id> ...
spur rule       run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <severity>] [--stop-on-first [<severity>]] [--fix-mode <mode>] [--dry-run] [--verbose] [--json]
spur rule       validate [--file <path>|--preset <name>|<path>] [--no-schema] [--json]
spur rule       list [--preset <name>] [--json]
spur rule       trace [run-id] [--preset <name>] [--status <s>] [--since <iso-date>] [--last <n>] [--json]
spur workflow   validate <workflow.yaml> [--no-schema] [--json]
spur workflow   run <workflow.yaml> [--run-id <id>] [--vars <json>] [--dry-run] [--json]
spur workflow   continue [run-id] [--yes] [--json]
spur workflow   list [--json]
spur workflow   trace [run-id] [--workflow <name>] [--status <s>] [--since <iso-date>] [--last <n>] [--json]
spur task       create <title> [--feature <id>] [--parent <wbs>] [--folder <path>] [--json]
spur task       show <wbs> [--folder <path>] [--json]
spur task       update <wbs> [status] [--section <name> --from-file <path>] [--folder <path>] [--json]
spur task       list [--status <s>] [--phase <p>] [--parent <wbs>] [--folder <path>] [--json]
spur task       refresh [--folder <path>] [--json]
spur task       batch-create --file <json> [--folder <path>] [--json]
spur task       check [<wbs>] [--strict] [--folder <path>] [--json]
spur task       resolve <file-path> [--folder <path>] [--json]
spur feature    create <name> [--parent <id>] [--folder <path>] [--json]
spur feature    show <id> [--folder <path>] [--json]
spur feature    update <id> [status] [--field <key> --value <value>] [--folder <path>] [--json]
spur feature    list [--status <s>] [--priority <p>] [--folder <path>] [--json]
spur feature    move <id> [--parent <id>] [--dry-run] [--folder <path>] [--json]
spur feature    refresh [--folder <path>] [--json]
spur feature    check [<id>] [--strict] [--folder <path>] [--json]
spur history    import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--dry-run] [--json]
spur history    analyze [--since <iso-date>] [--json]
spur history    report [--json]   # reserved — currently prints a TODO marker
spur message    send <body> --to <id> [--from <id>] [--json]
spur message    inbox --agent <id> [--json]
spur message    reply <msg-id> <body> [--json]
spur team       assign <task-id> <agent-id>
spur team       status [--json]
spur team       start|stop        # deferred daemon stubs
spur serve      [--port <n>] [--host <addr>] [--no-open] [--cwd <path>] [--json]
spur migrate    [--json]
```

Every command supports `--json` for machine-readable output.

---

## 5. Daily Development Workflow

A typical day with Spur follows this loop:

```
Plan → Implement (via agent) → Check (rules + tests) → Fix → Verify → Close task
```

### 5.1 Planning: Tasks and Features

**Features** are hierarchical containers (groups A–H, then digit children: A1, A1→B1, etc.).
**Tasks** are WBS-numbered work items (0001, 0002, …) linked to features via `--feature <id>`.

```bash
# Create a feature
spur feature create "User authentication"              # → allocates ID (e.g. F7)
spur feature create "OAuth provider" --parent F7       # → F71

# List features
spur feature list                    # all features with status/priority
spur feature list --status active    # filter by status

# Show a feature
spur feature show F7

# Update a feature
spur feature update F7 active        # lifecycle transition
spur feature update F7 --field priority --value P0   # set a scalar field

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

# Show a task
spur task show 0089

# Update a task — two modes:
# (a) Lifecycle transition (positional status)
spur task update 0089 wip
spur task update 0089 done          # guarded — requires non-empty Plan section
# (b) Section replace (--section requires --from-file)
spur task update 0089 --section Plan --from-file ./plan.md

# List tasks
spur task list                       # all tasks
spur task list --status wip          # filter by status
spur task list --parent 0089         # filter by parent WBS

# Validate tasks
spur task check            # validate all tasks (4-layer check)
spur task check 0089       # validate one task
spur task check --strict   # warnings become failures

# Regenerate kanban.md from the task corpus
spur task refresh

# Resolve a file path to its owning task WBS
spur task resolve src/auth/login.ts

# Batch-create tasks from JSON (all-or-nothing, validated against task-batch.schema.json)
spur task batch-create --file ./tasks-batch.json
```

**Task statuses:** `backlog → todo → wip → testing → blocked → done` (also `cancelled`).

**Feature statuses:** `backlog → active → verifying → done` (also `cancelled`).

> **Note:** `spur task update <wbs> done` is guarded — it refuses if the `### Plan` section is
> empty or placeholder-only. Fill the Plan section first:
> `spur task update <wbs> --section Plan --from-file ./plan.md`, then transition to `done`.

### 5.2 Implementing: Agent Execution

Spur delegates to installed coding agents via a single command:

```bash
# Run a prompt with auto-detected agent (default: claude)
spur agent run "Add a login endpoint to src/auth/"

# Run with a specific agent
spur agent run "Fix the failing test" --agent codex

# Resume the previous session
spur agent run "Continue" --continue

# Specify a model
spur agent run "Refactor the DB layer" --agent gemini --model gemini-2.0-flash

# Output mode (text|json)
spur agent run "Generate a summary" --mode json --json

# Working directory for agent execution
spur agent run "Run the tests" --cwd ./packages/domain

# Team mode: prepend pending inbox messages for a team agent spec
spur agent run "Work on task 0089" --agent reviewer --drain
```

**Agent management:**

```bash
spur agent list             # list detected coding agents
spur agent list --specs     # list team agent specs (.spur/agents/*.yaml)
spur agent doctor           # check readiness of all agents
spur agent doctor claude    # check one agent

# Create a team agent spec
spur agent create reviewer --type codex --purpose "Code review specialist" --tags review,quality

# Edit a spec (opens $EDITOR, or prints the path)
spur agent edit reviewer

# Delete a spec
spur agent delete reviewer
```

> **Single LLM execution surface:** every model call in Spur routes through `spur agent run`.
> Workflow `agent.run` actions and sp skills all delegate to this same command. Spur owns no other
> model-reaching path.

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
spur rule trace                   # recent runs
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
implement → check → fix loop, task lifecycles, and feature lifecycles.

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

# Resume a paused (HITL) workflow run
spur workflow continue              # resume the most recent paused run
spur workflow continue <run-id>     # resume a specific run
spur workflow continue --yes        # resume without prompting

# Show persisted workflow run history
spur workflow trace                 # recent runs (default last 20)
spur workflow trace <run-id>        # one run timeline
spur workflow trace --workflow task-pipeline --status running
spur workflow trace --since 2026-06-01 --last 50
```

**Bundled workflows** (in `config/workflows/`):

| Workflow | Purpose |
|---|---|
| `basic.yaml` | Canonical implement → check → fix → done loop |
| `feature-dev.yaml` | Feature development pipeline (design → implement → verify) |
| `task-lifecycle.yaml` | Task status transitions (backlog → todo → wip → done) |
| `feature-lifecycle.yaml` | Feature status transitions (backlog → active → verifying → done) |
| `task-pipeline.yaml` | Task execution pipeline (precheck → implement → test → review → record) |
| `planning-pipeline.yaml` | Planning pipeline (brainstorm → spec → plan → decompose) |

**Workflow action kinds** (available at runtime via Spur builtins):
`note`, `shell`, `event.emit`, `agent.run`, `rule.check`, `file.exists`, `file.read`,
`hitl.confirm`, `hitl.select`, `hitl.input`, `http.request`.

**Guard kinds:** `shell`, `always`, `never`, `action-ok`.

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

### 5.8 Migrations

```bash
spur migrate    # apply CLI-owned schema migrations to .spur/spur.db
```

---

## 6. The Daily Loop (Putting It Together)

A complete feature implementation cycle:

```bash
# 1. Plan: create a feature and task
spur feature create "Add OAuth login" --parent F7
spur task create "Implement OAuth callback handler" --feature F71
spur task update 0089 --section Plan --from-file ./plan.md
spur task update 0089 wip

# 2. Implement: run the agent
spur agent run "Implement the OAuth callback handler per docs/tasks/0089*.md" --agent claude

# 3. Check: run rules and tests
spur rule run --preset recommended-pre-check
bun run test

# 4. Fix: if rules fail, fix and re-check
spur rule run --fix-mode auto --dry-run   # preview fixes
spur rule run --fix-mode auto             # apply fixes
spur rule run --preset recommended-pre-check  # re-verify

# 5. Verify: run the task pipeline workflow
spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0089"}'

# 6. Close: mark the task done and refresh the feature
spur task update 0089 done
spur feature refresh
```

---

## 7. JSON Output Convention

Every command supports `--json`. Representative envelope shapes (verified):

```bash
spur task list --json       # → array of task objects [{wbs, name, status, filePath, frontmatter}, ...]
spur task show 0089 --json  # → single task object {wbs, name, status, ...}
spur feature list --json    # → array of feature objects [{id, status, priority, name}, ...]
spur rule run --json        # → { preset, ruleCount, findings[], fixes[] }
spur rule list --json       # → { totalFiles, ...sources }
spur workflow list --json   # → { layers, entries, totalFiles }
spur workflow run f.yaml --dry-run --json  # → { runId, workflowName, mode, status, finalState, transitionsTaken, reason }
spur agent list --json      # → { agents: [{name, installed, version, ...}] }
spur agent doctor --json    # → { agents: [{agent, installed, authenticated, usable, tier, ...}] }
spur status --json          # → { ok, packageJson, spurConfig, git: {root, branch, dirty}, agentSpecs }
```

Use `--json` for scripting, CI integration, and when piping to other tools.

---

## 8. Configuration

### Project config (`.spur/config.yaml`)

```yaml
tasks:
  folders:
    docs/tasks:
      baseCounter: 1
      label: main
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
| `PORT` | Server port for `spur serve` (default: 3000) |
| `HOST` | Bind address for `spur serve` (default: localhost) |

---

## 9. Known Limitations and Notes

- **`spur history report`** is a reserved surface that currently prints a TODO marker. The full
  flag grammar is registered; implementation is deferred.
- **`spur team start|stop`** are deferred daemon stubs. Team mode uses `--drain` (prepend-on-drain)
  rather than live daemons.
- **`spur task migrate`** is reserved (A17) — a one-time corpus normalization gate, not yet wired.
- **Concurrent SQLite access:** Spur uses SQLite in WAL mode with a 5-second busy timeout. Multiple
  spur processes can run concurrently against the same project DB, but heavy concurrent writes may
  still contend. For hermetic test runs, use `DATABASE_URL=:memory:`.
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

- **Architecture:** `docs/03_ARCHITECTURE.md`
- **CLI design (every command/flag/config):** `docs/04_DESIGN.md`
- **Feature status:** `docs/05_FEATURES.md`
- **Decisions (why):** `docs/00_ADR.md`
- **Scope (what):** `docs/01_PRD.md`
- **Roadmap (when):** `docs/02_ROADMAP.md`
- **Process (how docs are maintained):** `docs/99_PROJECT_CONSTITUTION.md`
- **Agent guide:** `AGENTS.md` (read first every session)
