# Quick Start

Spur is a **local-first harness engineering toolkit** for mainstream coding agents (Claude Code,
Codex, Gemini CLI, pi, omp, OpenCode, Antigravity, OpenClaw, Hermes, Grok). It wraps agents you
already have installed and authenticated, and adds execution discipline, constraint checking,
workflow orchestration, task and feature management, history analytics, and team coordination.

Spur is **not** a coding agent and **not** a BYOK LLM platform. It owns no path to a model other
than `spur agent run`, which delegates to the agents already on your machine.

## What you need

- **Bun ≥ 1.3.14** on PATH (Spur runs as TypeScript under Bun).
- At least one supported coding agent installed and authenticated.

## Install

```bash
# From npm (published bundle; a Bun installation must be on PATH)
npm i -g @gobing-ai/spur

# From source
git clone <repo> && cd spur && bun install
bun run apps/cli/src/index.ts --help

# Standalone binary (Bun-less machines)
curl -fsSL https://<release-host>/install.sh | bash
```

Per-platform binaries are published as release assets for darwin/linux on arm64/x64.

## Verify the installation

```bash
spur --version          # prints the installed version
spur agent list         # every detected coding agent
spur agent doctor       # readiness check: installed, authenticated, usable
spur agent doctor claude   # check one agent by name
```

`spur agent doctor` is the single readiness gate — run it before anything else. If an agent you
expected is missing or unauthenticated, fix that first; everything downstream delegates to it.

## Initialize a project

Every project that uses Spur needs a one-time initialization. Run this at the project root:

```bash
spur init                    # scaffold .spur/ with config, rules, agents
spur init --name my-project  # custom project name (default: directory name)
spur init --minimal          # only the minimal .spur scaffold
spur init --force            # recreate files that already exist
```

| Created path | Purpose |
| --- | --- |
| `.spur/config.yaml` | Project config (the single config surface) |
| `.spur/agents/` | Team agent specs directory |
| `.spur/rules/` | Constraint rule presets (project layer) |
| `.spur/workflows/` | Project workflow YAML layer (not created by `init`; the shipped implement/check/fix pipelines resolve from the package's `bundled:workflows` config layer) |
| `.spur/spur.db` | SQLite database: run history, traces, planning events (WAL mode) |
| `.spur/logs/spur.log` | Log output |

> **Re-init guard:** `spur init` refuses to run when `.spur/config.yaml` already exists, unless
> you pass `--force`. A stray `init` cannot clobber a configured project.

On first run, Spur also seeds `~/.config/spur/` from its bundled defaults (existing files are
never overwritten). Pass `--adopt-global-config` to deliberately rewrite that global config from
the shipped default (the old file is backed up first).

## Check project health

```bash
spur status          # project, .spur, git branch, agent specs
spur status <path>   # also inspect a specific file or directory
```

## Your first task

Tasks are WBS-numbered (`0001`, `0002`, …), markdown-backed work items — the unit of planned
work in Spur:

```bash
spur task create "Investigate flaky login test" --skip-ready
spur task list
spur task show 0001
```

> **Heads-up:** `spur task create` can run a *ready preparation* step that dispatches your
> configured coding agent to enrich the task. Pass `--skip-ready` when you just want to capture
> a backlog item without any model call.

## Where to go next

- [Daily development workflow](./daily-development-workflow.md) — the plan → implement → check →
  verify → close loop, end to end.
- [Slash commands](./dev-slash-commands.md) — drive the same loop from inside a coding-agent
  session with one command per step.
- [CLI reference](./index.md) — one page per command noun, generated from the live CLI.

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: .spur/run/help2-spur-help-snapshots/) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots (init, status, agent, task).
-->
