# Install Spur with your coding agent

> Follow this guide to set up Spur for this repository and my coding agent. Verify the CLI, the
> agent's MCP entry and the live tool list. Tell me which checks passed and which need my input.

Run the steps from the Git repository root. Start by checking `spur --version`,
`superskill --version`, and whether `.spur/config.yaml` already exists. Reuse a working install
that supports the commands below and preserve existing project and agent settings.

## 1. Install and initialize

With Bun on PATH, install whichever of these CLIs are missing or need an update:

```sh
bun add -g @gobing-ai/spur @gobing-ai/superskill
spur self install --with sp-plugin --json
```

`self install` seeds machine defaults and delegates the `sp` plugin install to Superskill for
its configured targets. To limit the install to one agent, run `spur self install --json` and
`superskill install sp --marketplace gobing-ai/spur --targets <target>`. Check
`superskill install --help` and use the target ID supported by that installation.

For a CLI-only setup without Bun on macOS or Linux, download
[`scripts/install.sh`](https://raw.githubusercontent.com/gobing-ai/spur/main/scripts/install.sh)
and run `SPUR_INSTALL_ZG=0 SPUR_INSTALL_A2A=0 sh <downloaded-installer>`. The installer verifies the
release checksum and seeds machine defaults. Add its bin directory to PATH if needed. See the
[standalone installer instructions](../apps/cli/README.md#if-you-dont-have-bun--standalone-binary).

If `.spur/config.yaml` is missing, run:

```sh
spur self init --minimal --json
```

Check `spur self status --json` from the project root. This completes CLI-only setup. For MCP,
register the repo locally if its path is absent from `spur projects list --json`:

```sh
spur projects add . --json
```

## 2. Connect the coding agent

Every agent reaches Spur the same way: a `spur` MCP entry that runs `spur mcp --gateway`, a stdio
bridge in front of the local gateway's `/mcp`. The bridge resolves `http://localhost:<port>/mcp`
from `server.gateway` and reads the bearer from the variable `server.mcp.authEnv` names, so no
token ever lands in an agent config file. Set up the machine once (2.1–2.2), then add the entry
to each agent you use (2.3).

### 2.1 Machine config

`spur self install` seeds `~/.config/spur/config.yaml` from the shipped default when the file is
absent. That default already enables MCP and admits loopback callers without a token, so a fresh
machine needs no exports. If the file predates this, add (or compare against) the `server` block
from [`config/config.global.yaml`](../config/config.global.yaml):

```yaml
server:
    mcp:                         # drives the gateway root /mcp AND each project's /<prefix>/mcp
        enabled: true
        authEnv: SPUR_MCP_TOKEN   # the NAME of a variable, never the token
        allowUnauthenticated: true
    # gateway:
    #     port: 3000             # set only when 3000 is taken; the bridge reads the same value
```

One block and one token cover both endpoints: the gateway checks the bearer at its root `/mcp` and
forwards the same token to each project's loopback `/mcp`
([project gateway](design/project-gateway.md)). A leftover `server.gateway.mcp` block from an older
release is ignored; delete it.

To require a token instead, set `allowUnauthenticated: false` and export the token in the shell
profile that launches the gateway and your agents:

```sh
export SPUR_MCP_TOKEN="$(openssl rand -hex 32)"   # or read it from your secret store
```

Process variables (`SPUR_GATEWAY_PORT`, `SPUR_MCP_ENABLED`, `SPUR_MCP_AUTH_ENV`) override the file
for one session. Config is read at
startup, so restart the gateway after editing it.

### 2.2 Keep the gateway running

On macOS, install the LaunchAgent once; it survives logout and reboot:

```sh
spur self install --daemon --json
```

For a port other than 3000, pass `--port <n>` and set the same `server.gateway.port` in the YAML:
the bridges read the port from config, not from the LaunchAgent.

Elsewhere, or for a one-off session, run it in the background of the shell that launches your
agents and wait for its startup message:

```sh
spur self serve --gateway --no-open &
```

A startup line beginning `config: project config could not be loaded` means the YAML did not
parse; fix it before going on, or the gateway runs with every surface off.

### 2.3 Add the agent entry

Run `spur self install --with sp-plugin --json` (or `superskill install sp --marketplace
gobing-ai/spur --targets <target>`) first: Superskill translates the
[plugin MCP manifest](../plugins/sp/mcp.json) into each target's native config and is idempotent.
Inspect the target file it wrote. Add the entry by hand only where Superskill generated none, and
keep any other servers already in that file.

All entries run the same command. Transport verdicts come from the
[MCP agent adoption matrix](design/mcp-agent-adoption.md); only omp passed direct HTTP, because
Spur accepts HTTP revisions `2026-07-28` and newer, so use the stdio bridge everywhere else.

| Agent | Native file (user / project) | Entry key | Observed verdict |
| --- | --- | --- | --- |
| Claude Code | native `sp` plugin; else `~/.claude.json` / `.mcp.json` | `mcpServers.spur` | plugin connected (1417); matrix: cli-only |
| Codex CLI | `~/.codex/config.toml` | `[mcp_servers.spur]` + `env_vars` | mcp-stdio-bridge |
| Gemini CLI | `~/.gemini/settings.json` / `.gemini/settings.json` | `mcpServers.spur` | unobserved (account error) |
| pi | `~/.pi/agent/mcp.json` / `.pi/mcp.json` (trusted projects) | `mcpServers.spur` | mcp-stdio-bridge |
| omp | `~/.omp/agent/config.yml` | `mcp_servers.spur` | mcp-http (stdio also passes) |
| OpenCode | `~/.config/opencode/opencode.json` / `opencode.json` | `mcp.spur` | unobserved (provider balance) |
| Grok CLI | `~/.grok/config.toml` / `.grok/config.toml` | `[mcp_servers.spur]` | unobserved (no request) |
| OpenClaw | `~/.openclaw/openclaw.json` | `mcp.servers.spur` | unobserved (provider auth) |
| Antigravity, Hermes | not verified | — | use the CLI fallback |

"Unobserved" means the harness never reached MCP on that client, not that its MCP support is
missing; the entry below is the format the harness injected. These are the same snippets the
Board shows under **Integrations › MCP › Client config**.

Claude Code, Gemini CLI, pi (and any `mcpServers` JSON client):

```json
{
  "mcpServers": {
    "spur": { "command": "spur", "args": ["mcp", "--gateway"] }
  }
}
```

Codex filters the child environment, so allowlist the variables the bridge reads. Use your own
token variable name in place of `SPUR_MCP_TOKEN` if you changed `authEnv`:

```toml
[mcp_servers.spur]
enabled = true
command = "spur"
args = ["mcp", "--gateway"]
env_vars = ["SPUR_GATEWAY_PORT", "SPUR_MCP_ENABLED", "SPUR_MCP_AUTH_ENV", "SPUR_MCP_TOKEN"]
```

Grok CLI uses the same TOML without `env_vars`. omp (YAML):

```yaml
mcp_servers:
  spur:
    command: spur
    args:
      - mcp
      - --gateway
```

omp may instead use `url: http://localhost:3000/mcp` directly, plus
`headers: { Authorization: "Bearer ${SPUR_MCP_TOKEN}" }` when tokens are required.

OpenCode:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "spur": { "type": "local", "command": ["spur", "mcp", "--gateway"] }
  }
}
```

OpenClaw:

```json
{
  "mcp": {
    "servers": {
      "spur": { "command": "spur", "args": ["mcp", "--gateway"] }
    }
  }
}
```

`spur` must be on the PATH the agent launches children with; if it is not, put the absolute path
from `command -v spur` in `command`. Start a fresh agent session after adding the entry. The Board's
**Integrations › MCP** readiness pins show, per agent, whether the binary is installed, the entry is
valid (`configured` / `misconfigured`) and the gateway has seen its calls (`active`); they read the
same files and change nothing.

## 3. Verify the live catalog

Run these probes from a shell with the same environment as the agent. They use the same bridge as the installed
agent entry. Inspect the JSON-RPC response for a `result` or `error`.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' |
  spur mcp --gateway

printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"server/discover"}' |
  spur mcp --gateway
```

`tools/list` returns all advertised tools in `result.tools`. For a list of names, pipe the response
through `jq -r '.result.tools[].name'` if jq is available. The built-in `sp_*` tools appear once
with a required `project` selector. The remaining entries come from opted-in workflows in
registered local projects. Listing leaves project servers stopped. `server/discover` returns
the local project names, prefixes and namespaces in `result.projects` and reports namespace
collisions and remote-project exclusions in `result.diagnostics`.

To verify a downstream tool, give its project one depth-one `plugins/<plugin>/plugin.json` with
a unique `name` matching `^[a-z][a-z0-9]{1,15}$`. Set `metadata.mcp.expose: true` as nested YAML
keys on an existing workflow you intend to expose. Run `spur workflow validate <file> --json`
from that project, then rerun `tools/list`. For example, namespace `acme` and workflow
`release-check` produce `acme_release_check`. Use distinct manifest names
and leave the shared `SPUR_MCP_NAMESPACE` override unset for multi-project discovery. See the
[workflow tool contract](design/embedded-mcp-server.md#4-tools-and-resources) for workflow roots
and validation rules.

Check whether the fresh agent session sees the tools. Call `sp_task_list` with `project` set to the
registered name or prefix to confirm end-to-end routing. The bridge supports discovery and calls
from legacy stdio clients. If the agent does not expose the tools, check its MCP config and
startup diagnostics, then use the
[Spur CLI equivalents](../plugins/sp/skills/spur-cli/references/mcp-tools.md) if needed.

Report the installed versions, project path, whether the agent entry was generated, the tool
names and any discovery diagnostics. Record agent-session availability separately from the
bridge check. Omit credentials from the report.
