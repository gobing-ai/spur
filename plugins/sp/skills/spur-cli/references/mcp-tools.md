# MCP tools and their CLI verbs

The embedded MCP server (`spur self serve`, B9/ADR-152) and the gateway host (1382) advertise the
ten `sp_*` tools below. **The CLI is the source of truth and the fallback**: the rule is *presence*,
not agent identity — if the harness exposes `sp_*` tools, prefer them for these operations; if it
does not, run the CLI verb unchanged. The result shapes match, so a task written through a tool and
the same task written through the CLI are indistinguishable on disk.

Which agents expose these tools: [mcp-agent-adoption](../../../../../docs/design/mcp-agent-adoption.md).

## Read and write map

| Tool | CLI verb | Notes |
| --- | --- | --- |
| `sp_task_show` | `spur task show <wbs> --json` | identical payload |
| `sp_task_list` | `spur task list [--status …] [--feature …] --json` | filters match the schema properties |
| `sp_task_create` | `spur task create --title … [--feature …] [--parent …]` | the tool never runs model-backed ready-prep; refine afterwards with `spur task refine` |
| `sp_task_update` | `spur task update <wbs> [status] [--section … --from-file …] [--priority …]` | the tool writes inline content; `status` is refused — use `sp_task_transition` |
| `sp_task_transition` | `spur task update <wbs> <status>` | same guarded seam, so a refusal carries the same `GUARD_DENIED` code and message |
| `sp_feature_check` | `spur feature check <id> [--as …] [--strict] --json` | identical report |
| `sp_rule_run` | `spur rule run --preset <name> [--rule <id>] [--fail-on …]` | tool returns findings/fixes/exitCode; it never applies a fix |
| `sp_workflow_status` | `spur workflow trace [<runId>] --json` | identical timeline |
| `sp_workflow_run` | `spur workflow run <file> [--vars <json>] [--dry-run]` | the tool forwards `vars` strings only |
| `sp_workflow_continue` | `spur workflow continue [<runId>] --answer …` | same paused-run resolution when `runId` is omitted |

## CLI-only

These have no tool, deliberately — the tool schema omits them so the corpus rules hold by
construction rather than by discipline. Run the CLI verb for them:

- **force-done / `--force-done`** — an operator override; an agent gets the `GUARD_DENIED` refusal and escalates.
- **rule files (`--file`)** — presets and rule ids only, so a remote caller cannot point the engine at an arbitrary path.
- **auto-fix (`--fix-mode auto`)** — a source rewrite is not exposed over MCP; `suggest` exists, `auto` does not.
- **ready-prep on create** — a server tool never dispatches a model; `spur task refine` is the explicit follow-up.
- **batch-create** — multi-task authoring stays a CLI operation with its own transaction shape.

Also CLI-only, for the same reason: `spur task record`, `spur task verdict`, `spur feature verify`,
`spur self …` (lifecycle of the server itself), and anything that edits `.spur/config.yaml`.

## Wiring an agent (gateway entry)

Use the [Spur install guide](https://github.com/gobing-ai/spur/blob/main/docs/install.md) for setup
and live `tools/list` and `server/discover` probes. The plugin ships one server in `mcp.json`,
`spur` → `spur mcp --gateway`. Superskill owns writing the entry for supported targets.
`--gateway` targets `http://localhost:<server.gateway.port>/mcp` and takes its bearer from the
variable named by `server.gateway.mcp.authEnv` — the token stays in the environment, never in an agent
config file. `--gateway` and `--url` are mutually exclusive, and a disabled gateway, an unset or empty
token variable, or a gateway that is not answering each fail with the remedy named.

## When the tools are absent

If the bridge probe passes and the agent still shows no tools, check the target's MCP startup
diagnostics and confirm the process receives the gateway environment. The bridge supports legacy
stdio tool clients, and the plugin supplies the default gateway variable allowlist for Codex.
Use the CLI verbs above when the agent has no usable tools.
