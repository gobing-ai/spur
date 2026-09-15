---
name: spur-cli-projects
description: "spur-cli noun reference: operate `spur projects` to register local project roots, inspect live status, start detached project servers, and stop or remove registry entries."
see_also:
  - spur-cli
---

# spur projects - local multi-project registry

`spur projects` manages the machine-local registry resolved by
`packages/config/src/projects.ts` (`getProjectsFilePath`) and implemented by
`packages/app/src/services/project-registry.ts` (`ProjectRegistry`). Server startup is owned by
`packages/app/src/services/project-start.ts` (`startRegisteredProject`); CLI registration and JSON
shapes live in `apps/cli/src/commands/projects.ts`.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `add <path>` | Upsert an existing path in the registry | `--name <name>` `--json` |
| `remove <target>` | Remove an entry by display name or path | `--json` |
| `list` | List entries with live running status | `--json` `--fleet` |
| `start <target>` | Start or reuse a detached project server | `--port <n>` `--json` |
| `stop <target>` | Best-effort stop the listener and clear its recorded port | `--json` |

Every verb also advertises `--json-envelope`; use the facade's machine-output contract. Success is
exit `0`; validation, registry, spawn, health, or lookup failure is exit `1`.

## Registry behavior

- The default file is `~/.config/spur/projects.json`; `SPUR_PROJECTS_FILE` overrides it. Entries are
  `{ name, path, port }`, where `port: 0` means stopped.
- Paths are normalized (including `~`) and existing paths resolve to real paths. Name lookup is
  case-insensitive. Registry mutations use an advisory lock.
- `add` requires an existing path, resolves a relative path from the current working directory, and
  defaults the display name to its basename. It upserts; it does not start a server. The current
  source does not enforce a `.spur/` marker or directory type.
- `list` probes recorded ports and heals stale entries to `port: 0` before reporting `running`.
- `list --fleet` (0835) additionally resolves each project's fleet declaration at
  `<project>/.spur/fleet.json` under the existing verb (no new noun). Per project it prints one line
  per member: instance id (the spec id / mailbox identity), `role`, resolved `executor`,
  `fsWrite` capability state, and derived `write` flag. A project with no declaration reports
  `no declaration (.spur/fleet.json)`; an all-disabled roster reports `no enabled members`; a project
  whose executors fail resolution reports the error without failing the listing. Under `--json` each
  project gains `fleet` (the resolved fleet, `null` on resolution failure) and, on failure,
  `fleetError`.
- `list --fleet` (0836) also reports the project's orchestrator binding: one
  `orchestrator:` line per project with state `bound-online <id> (holder <spec-id>)`,
  `bound-offline <id> (no live claim)`, `missing (no-orchestrator-declared)`, or
  `unresolvable (<reason>)` — missing (nothing bound) and bound-offline (bound, no live
  claim) are distinct states with distinct next actions, and an unresolvable pointer is an
  error, never inferred. Reading the live claim touches the project's own `.spur/spur.db`
  (lazily; only when the pointer resolves). Under `--json` each project gains
  `orchestrator` (the binding, `null` on resolution failure) and, on failure,
  `orchestratorError`.
- `list --fleet` (0838) also reports the project's persisted strategy (0838): one
  `strategy:` line — `rest (default)` when nothing is persisted (the read never
  writes; only the runtime's `setStrategy`/`resume` persist), `<name> (v<n>)` for a
  persisted row, or `unavailable (<error>)` on a db failure. Under `--json` each
  project gains `strategy` (`{ strategy, strategyVersion }`, `null` when
  unpersisted) and, on failure, `strategyError`.

## Server lifecycle

```bash
spur projects start my-project --json
spur projects start /path/to/unregistered/project --port 3333 --json
spur projects stop my-project --json
```

`start` resolves by name or path. An existing unregistered path is auto-registered. A live recorded
port is returned idempotently; otherwise the service allocates a port (3000–3999 unless explicitly
set), spawns `spur serve --host 127.0.0.1 --no-open` detached in the project root, waits for the port,
then persists it.

`stop` finds processes bound to the recorded port, sends `SIGTERM` best-effort while excluding the
CLI and its parent, and clears the registry port. It is not a persistent supervisor contract.
`remove` only removes the registry entry; stop a running project first when process cleanup matters.

Raw JSON success payloads are verb-specific (`project`, `projects`, `removed`, `stopped`, or start
status fields). Under `--json-envelope` they move beneath `data`; failures normalize beneath
`error`. Read `apps/cli/src/commands/projects.ts` for exact fields.
