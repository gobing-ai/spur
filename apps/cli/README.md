# @gobing-ai/spur

**The `spur` command** — a local-first harness for mainstream coding agents (Claude Code, Codex,
Gemini CLI, pi, omp, OpenCode, Antigravity, OpenClaw, Hermes, Grok). Spur is **not** a coding agent;
it wraps the agents you already have with constraint checking, workflow orchestration, agent health
checks, and conversation-history analytics.

## Install

Pick the path that matches your setup. Both give you a global `spur` command and seed the default
config into `~/.config/spur/` on first run.

### If you have Bun (`bun >= 1.3.0`) — recommended

The npm package ships a Bun bundle and runs under the Bun runtime you already have.

```bash
# Install globally → use the `spur` command everywhere
bun install -g @gobing-ai/spur
spur --help

# …or run ad-hoc with no install
bunx @gobing-ai/spur --help
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

### Package layout (what ships)

The published tarball is a self-contained Bun bundle plus static assets:

| Path | Purpose |
|------|---------|
| `spur.js` | CLI entry (`bin.spur`) |
| `config/` | Default rules, workflows, tasks, templates, plugins (ADR-015 SSOT) |
| `web/` | Spur Board SPA served by `spur serve` |
| `schemas/` | JSON Schema for editor/CI validation |

`spur init` copies the full `config/` tree into the project `.spur/` directory (and seeds
`~/.config/spur/` globally on first run). `spur serve` resolves board assets from package `web/`.

### First run

```bash
spur init     # scaffold .spur/ from bundled config/ + seed ~/.config/spur/ — idempotent, never clobbers
spur serve    # local board at http://localhost:3000/board (uses package web/)
```

The standalone installer runs `spur init` for you; the Bun install does it on your first `spur init`.

## Usage

```bash
spur init                                  # scaffold .spur/ + seed global rules
spur serve --port 5678                     # start API + Spur Board
spur rule run --preset recommended-pre-check   # evaluate constraint rules
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
