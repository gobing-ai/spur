# @gobing-ai/spur-cli

**The `spur` command** — a local-first harness for mainstream coding agents (Claude Code, Codex,
Gemini CLI, Antigravity, pi, OpenCode, OpenClaw). Spur is **not** a coding agent; it wraps the agents
you already have with constraint checking, workflow orchestration, agent health checks, and
conversation-history analytics.

> **Runtime:** Spur is **Bun-native** (`bun >= 1.3.0`). Run it with `bunx`, or install globally under
> Bun. It does not run under plain Node today.

## Install / run

```bash
# Run ad-hoc (no install)
bunx @gobing-ai/spur-cli --help

# Install globally → use the `spur` command directly
bun install -g @gobing-ai/spur-cli
spur --help
```

## Usage

```bash
spur init                                  # scaffold .spur/ + seed global rules
spur rule run --preset recommended         # evaluate constraint rules
spur workflow run <workflow.yaml>          # run an FSM workflow
spur agent run "<prompt>" --agent auto     # execute a prompt via a coding agent
spur agent doctor                          # check agent readiness
spur history import --source claude --root <path>
spur history analyze
spur status
```

Every command supports `--json` for machine-readable output.

## Documentation

Full docs, architecture, and the complete command surface live in the
[Spur repository](https://github.com/gobing-ai/spur).

## License

Apache-2.0 © [Robin Min](mailto:minlongbing@gmail.com)
