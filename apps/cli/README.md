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

#### Install the `sp` plugin to your coding agents

The npm package ships the `sp` plugin and its marketplace manifest alongside the CLI. Install it
into your supported coding agents without cloning this repository:

```bash
# point superskill at the installed @gobing-ai/spur package root
superskill install sp --marketplace $(npm root -g)/@gobing-ai/spur
```

(With Bun: `bun install -g @gobing-ai/spur`; the package root is `$(npm root -g)/@gobing-ai/spur`
or `$(bun pm bin -g)/../lib/node_modules/@gobing-ai/spur`.) This registers the marketplace and
installs the `sp` plugin to Claude Code, Codex, Gemini CLI, pi, omp, OpenCode, Antigravity, etc.

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

**Verification.** The installer downloads to a temp file, checks it against the release's
`SHA256SUMS`, and only then atomically replaces `spur`. A failed download, a checksum mismatch, or a
missing `SHA256SUMS` leaves an existing install untouched and exits non-zero. `SPUR_RELEASE_URL`
overrides the download base URL (a mirror, or a `file://` directory in tests).

The checksum is a **code-execution** boundary, not just an integrity check: having verified the
download, the installer *runs* it (`spur init`), so a release whose `SHA256SUMS` cannot be verified
is a release you cannot safely install. `SPUR_SKIP_VERIFY=1` is the single explicit bypass and
prints a warning — keep it for local or air-gapped installs, and pipe the script into `sh` only from
a source you trust.

**Releasing standalone binaries.** Run `bun run build:binaries` in `apps/cli`, then upload **all**
of `dist/cli/spur-*` **and** `dist/cli/SHA256SUMS` to the GitHub Release for the tag. A release
without `SHA256SUMS` makes the installer fail by default.

### Package layout (what ships)

The published tarball is a self-contained Bun bundle plus static assets:

| Path | Purpose |
| ------ | --------- |
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

### Extending the Spur Board

A project can add its own Board modules — a compiled React tool or an embedded URL app — without
editing this package. An installed Board reads them from a fresh project's `.spur/config.yaml`:

```yaml
bootstrap:
  modules:
    - id: team-board
      name: Team board
      icon: "🧭"
      type: react
      directory: board/team-board/dist
      entry: index.js
      styles: [index.css]
    - id: docs
      name: Documentation
      icon: "📚"
      type: iframe
      url: https://docs.example.test/
```

`spur init` seeds `modules: []` (built-ins only); change selection with a config edit, then restart
`spur serve` and reload. The full authoring contract — the declaration union, the
`@gobing-ai/spur/board` type export, the Vite library setup and the frame/trust limits — is in the
[downstream Board modules design](https://github.com/gobing-ai/spur/blob/main/docs/design/downstream-board-modules.md).

## Documentation

Full docs, architecture, and the complete command surface live in the
[Spur repository](https://github.com/gobing-ai/spur).

## License

Apache-2.0 © [Robin Min](mailto:minlongbing@gmail.com)
