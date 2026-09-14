# Spur Help

Spur is a **local-first harness engineering toolkit** for mainstream coding agents (Claude Code,
Codex, Gemini CLI, pi, omp, OpenCode, Antigravity, OpenClaw, Hermes, Grok). It wraps agents you
already have installed and authenticated, adding execution discipline, constraint checking,
workflow orchestration, task and feature management, history analytics, and team coordination.

It is **not** a coding agent and **not** a BYOK LLM platform. Spur owns no path to a model other
than `spur agent run`, which delegates to the installed agents.

## Quick start

```bash
npm i -g @gobing-ai/spur   # or install from source / standalone binary
spur agent doctor          # verify your coding agents are ready
spur init                  # scaffold .spur/ in your project
spur status                # confirm the project is healthy
```

From there, create your first task and open the [daily development workflow](./daily-development-workflow.md):

```bash
spur task create "Investigate flaky login test" --skip-ready
```

## How the help is organized

**Start here — task-first guides:**

| Page | What it covers |
| --- | --- |
| [Getting started](./getting-started.md) | Install, verify, init, first task |
| [Daily development workflow](./daily-development-workflow.md) | The full plan → implement → check → verify → close loop |
| [Slash commands](./dev-slash-commands.md) | Drive the same loop from inside a coding-agent session |

**Then the reference — one page per CLI noun:**

| Command | Page | Command | Page |
| --- | --- | --- | --- |
| `spur agent` | [agent](./agent.md) | `spur projects` | [projects](./projects.md) |
| `spur builder` | [builder](./builder.md) | `spur rule` | [rule](./rule.md) |
| `spur feature` | [feature](./feature.md) | `spur serve` | [serve](./serve.md) |
| `spur history` | [history](./history.md) | `spur status` | [status](./status.md) |
| `spur init` | [init](./init.md) | `spur task` | [task](./task.md) |
| `spur maintain` | [maintain](./maintain.md) | `spur team` (deprecated 0848) | [team](./team.md) |
| `spur message` | [message](./message.md) | `spur workflow` | [workflow](./workflow.md) |
| `spur migrate` | [migrate](./migrate.md) | | |

## Global conventions

- **`--help` everywhere:** `spur <noun> --help` (and `spur <noun> <verb> --help`) prints the
  authoritative usage for that command; `spur help [command]` is a shortcut for the same output.
- **Top-level flags:** `-V, --version`, `-v, --cli-verbose` (internal diagnostics),
  `--no-logo` (suppress the startup banner).
- **Machine-readable output:** most commands support `--json` (exceptions: `agent delete`,
  `agent edit`, `agent loop`, `team assign`); `--json-envelope` additionally
  wraps the output in the standard `{ok, data|error}` envelope for scripting.
- **CLI-gated entities:** tasks, features, agent specs, and workflow runs are files and database
  rows — always edit them through the CLI, never by hand.

## Every page, verified

Every command, verb, and flag in this help was generated against the live CLI output and checked
at generation time — if a page and `spur <noun> --help` ever disagree, trust the CLI and file an
issue against the docs.

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: .spur/run/help2-spur-help-snapshots/) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
