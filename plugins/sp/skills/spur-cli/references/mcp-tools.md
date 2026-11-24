# MCP tools and their CLI verbs

The embedded MCP server (`spur self serve`, B9/ADR-152) and the gateway host (1382) advertise the
41 `sp_*` tools below. **The CLI is the source of truth and the fallback**: the rule is *presence*,
not agent identity — if the harness exposes `sp_*` tools, prefer them for these operations; if it
does not, run the CLI verb unchanged. The result shapes match, so a task written through a tool and
the same task written through the CLI are indistinguishable on disk.

Which agents expose these tools: [mcp-agent-adoption](../../../../../docs/design/mcp-agent-adoption.md).

## Read and write map

### Task (10)

| Tool | CLI verb | Notes |
| --- | --- | --- |
| `sp_task_show` | `spur task show <wbs> --json` | identical payload |
| `sp_task_list` | `spur task list [--status …] [--feature …] --json` | filters match the schema properties |
| `sp_task_create` | `spur task create --title … [--feature …] [--parent …]` | the tool never runs model-backed ready-prep; refine afterwards with `spur task refine` |
| `sp_task_update` | `spur task update <wbs> [--section … --from-file …] [--priority …]` | writes inline content; `append` extends the named section instead of replacing it; `status` is refused — use `sp_task_transition` |
| `sp_task_transition` | `spur task update <wbs> <status>` | same guarded seam, so a refusal carries the same `GUARD_DENIED` code and message |
| `sp_task_check` | `spur task check <wbs> [--as …] --json` | the same one-entry result list |
| `sp_task_sections` | `spur task sections <wbs> <op> [name]` | `op: list \| init \| add`, matrix-enforced |
| `sp_task_deps` | `spur task deps <wbs> <op> [values…]` | `op: set \| add \| remove \| clear`; mutation codes survive |
| `sp_task_preflight` | `spur task preflight [wbs] [--operation …] --json` | reads the corpus facts in-process, same TABLE A decision |
| `sp_task_batch_plan` | `spur task batch-plan <mode>` | inline `tasks` JSON only; never a caller path |

### Feature (8)

| Tool | CLI verb | Notes |
| --- | --- | --- |
| `sp_feature_show` | `spur feature show <id> --json` | unknown id is an error, as on the CLI |
| `sp_feature_list` | `spur feature list [--status …]` | `parentId` keeps direct children only (DD-14) |
| `sp_feature_create` | `spur feature create <name> [--parent …]` | allocates the hierarchical id |
| `sp_feature_update` | `spur feature update <id> --priority …` | section+content or field+value; `status` is refused — use `sp_feature_transition` |
| `sp_feature_transition` | `spur feature update <id> <status>` | same guard code as the CLI |
| `sp_feature_sync` | `spur feature sync [id] [--dry-run] [--force]` | no `id` syncs every feature |
| `sp_feature_refresh` | `spur feature refresh` | rebuilds INDEX.md and the `## Tasks` tables |
| `sp_feature_check` | `spur feature check <id> [--as …] [--strict] --json` | identical report |

### Workflow (7) and rule (3)

| Tool | CLI verb | Notes |
| --- | --- | --- |
| `sp_workflow_status` | `spur workflow trace [<runId>] --json` | identical timeline |
| `sp_workflow_run` | `spur workflow run <file> [--vars <json>] [--dry-run]` | the tool forwards `vars` strings only |
| `sp_workflow_continue` | `spur workflow continue [<runId>] --answer …` | same paused-run resolution when `runId` is omitted |
| `sp_workflow_list` | `spur workflow list --json` | same layer walk (project, registered, shared) |
| `sp_workflow_show` | `spur workflow show <file>` | states, transitions, vars, `mcp` exposure, digest |
| `sp_workflow_validate` | `spur workflow validate <file> --json` | identical findings |
| `sp_workflow_cancel` | `spur workflow cancel <run-id>` | an unknown run id is a tool error, not a value |
| `sp_rule_run` | `spur rule run --preset <name> [--rule <id>] [--fail-on …]` | returns findings/fixes/exitCode; never applies a fix |
| `sp_rule_list` | `spur rule list [--preset <name>]` | files, or a preset's resolved rules |
| `sp_rule_validate` | `spur rule validate [file-or-preset]` | project-confined: a `file` outside the root is refused |

### Decision (4)

| Tool | CLI verb | Notes |
| --- | --- | --- |
| `sp_decision_list` | `spur decision list [--layer …]` | `layer: project \| registered \| shared` filtered in the handler |
| `sp_decision_show` | `spur decision show <id> --json` | contract plus effective maker and source |
| `sp_decision_status` | `spur decision status --json` | recorded readiness only — no maker is probed |
| `sp_decision_run` | `spur decision run <id> [--params <json>]` | inline `evidence` string only, never a path |

### Coordination (4) and builder (2)

| Tool | CLI verb | Notes |
| --- | --- | --- |
| `sp_agent_status` | `spur agent status --json` | roster, bindings and capacity from the same service |
| `sp_message_send` | `spur message send --to … --body …` | `from` is caller-supplied, as on the CLI |
| `sp_message_inbox` | `spur message inbox <member>` | `mode: list \| requests` |
| `sp_message_reply` | `spur message reply <messageId> --body …` | replies as the original recipient |
| `sp_builder_check_deps` | `spur builder check-deps --json` | read-only; the configured dependency scope |
| `sp_builder_show_branches` | `spur builder show-branches --json` | read-only branch topology |

### Self (3)

| Tool | CLI verb | Notes |
| --- | --- | --- |
| `sp_self_status` | `spur self status --json` | no gateway-daemon section — that probe is CLI-local |
| `sp_self_search` | `spur self search <query>` | `mode`, `scope`, `glob`, `limit`, `regex`, or `status: true` |
| `sp_self_actions` | `spur self exec --help` | lists the SDLC actions or resolves one command — never runs it |

## CLI-only

These have no tool, deliberately — the tool schema omits them so the corpus rules hold by
construction rather than by discipline. Run the CLI verb for them:

- **force-done / `--force-done` / `--provenance-bypass`** — an operator override; an agent gets the `GUARD_DENIED` refusal and escalates.
- **task `migrate` / `record` / `verdict`** — corpus repairs and pipeline evidence bookkeeping stay operator commands.
- **`spur feature move` / `spur feature verify`** — a subtree cascade rename and a bound PASS/FAIL receipt.
- **`spur workflow clean` / `spur workflow promote-*`** — bulk reclamation and release promotion.
- **rule files (`--file`) and `--fix-mode auto`** — presets and project-confined files only, so a remote caller cannot point the engine at an arbitrary path or rewrite a source; `suggest` exists, `auto` does not.
- **decision evidence paths** — `evidence` is an inline instructions string; a caller-named file is never read.
- **`spur agent start|stop|loop`** — process lifecycle stays with the operator.
- **builder `bump-ver` / `drop-tags` / `publish` / `build-*`** — release and build actions are not agent operations.
- **`spur self serve|install|uninstall|init|maintain|migrate`** and any shell execution (including running a resolved action) — the server cannot manage itself.
- **gateway-daemon status** — a CLI-local probe; a caller that reached `/mcp` already proved the server is up.
- **ready-prep on create** — a server tool never dispatches a model; `spur task refine` is the explicit follow-up.
- **batch-create** — multi-task authoring stays a CLI operation with its own transaction shape.

Anything that edits `.spur/config.yaml` is CLI-only for the same reason.

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
