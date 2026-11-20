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

Superskill reads the [plugin MCP manifest](../plugins/sp/mcp.json) and installs the `spur` entry
where the target supports MCP config. The entry runs `spur mcp --gateway`. Inspect the target's
installed MCP entry or plugin registration. If the target has a stdio client and Superskill did
not generate an entry, use the target's native MCP registration for the same command and
arguments. Keep the bearer token in the process environment.

Use a shell that can launch both the gateway and the coding agent. The agent uses one token to
access the gateway. The gateway uses a separate token to call its project servers. Use your
secret store or generate separate local tokens for this session.

```sh
export SPUR_GATEWAY_MCP_ENABLED=true
export SPUR_GATEWAY_MCP_AUTH_ENV=SPUR_GATEWAY_MCP_TOKEN
export SPUR_GATEWAY_MCP_TOKEN="$(openssl rand -hex 32)"
(
  export SPUR_MCP_ENABLED=true
  export SPUR_MCP_AUTH_ENV=SPUR_PROJECT_MCP_TOKEN
  export SPUR_PROJECT_MCP_TOKEN="$(openssl rand -hex 32)"
  exec spur self serve --gateway --no-open
) &
```

Wait for the gateway startup message. Launch a fresh agent session with the gateway exports
and `spur` on PATH. The default loopback port is 3000. Set `SPUR_GATEWAY_PORT` in the shared shell
before either process starts if you need another port. A separately launched project server needs
the same project auth settings as the gateway. Relaunch existing processes to pick up changed
environment variables.

Codex filters the bridge environment. Superskill generates an `env_vars` allowlist from the plugin
manifest for the gateway variable names above. If you choose a custom gateway token variable,
include that name in Codex's allowlist as well.

## 3. Verify the live catalog

Run these probes from a shell with the same exports. They use the same bridge as the installed
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
