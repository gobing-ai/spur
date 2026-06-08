# @gobing-ai/spur-cli

**The `spur` command** — a local-first harness for mainstream coding agents (Claude Code, Codex,
Gemini CLI, Antigravity, pi, OpenCode, OpenClaw). Spur is **not** a coding agent; it wraps the agents
you already have with constraint checking, workflow orchestration, agent health checks, and
conversation-history analytics.

## Install

Pick the path that matches your setup. Both give you a global `spur` command and seed the default
config into `~/.config/spur/` on first run.

### If you have Bun (`bun >= 1.3.0`) — recommended

The npm package ships a Bun bundle and runs under the Bun runtime you already have.

```bash
# Install globally → use the `spur` command everywhere
bun install -g @gobing-ai/spur-cli
spur --help

# …or run ad-hoc with no install
bunx @gobing-ai/spur-cli --help
```

### If you don't have Bun — standalone binary

A self-contained executable (Bun embedded) for macOS and Linux. No runtime to install.

```bash
# One-liner: downloads the binary, puts it on PATH, seeds config
curl -fsSL https://raw.githubusercontent.com/gobing-ai/spur/main/scripts/install.sh | sh
spur --help
```

The installer drops `spur` into `~/.local/bin` by default. Override the target with `SPUR_INSTALL`,
or pin a release with `SPUR_VERSION`:

```bash
SPUR_INSTALL=/usr/local/bin SPUR_VERSION='@gobing-ai/spur-v0.1.7' \
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/gobing-ai/spur/main/scripts/install.sh)"
```

If `~/.local/bin` isn't already on your `PATH`, add it (e.g. `export PATH="$HOME/.local/bin:$PATH"`
in your shell profile). Supported targets: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`.
Windows: use the Bun path under WSL.

### First run

```bash
spur init     # seeds ~/.config/spur/ (config.yaml, rules/, workflows/) — idempotent, never clobbers
```

The standalone installer runs `spur init` for you; the Bun install does it on your first `spur init`.

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
