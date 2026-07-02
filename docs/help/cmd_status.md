# spur status

> Show project health, Git context, and optional path metadata. A **verb-less** command —
> accepts an optional `path` positional and flags directly.

```
spur status [options] [path]
```

| Argument | Description |
|---|---|
| `path` | Optional file/dir path; reports `{ size, isFile, isDirectory }` for it |

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

## Behavior

`spur status` reports whether the project is healthy and exposes context for tooling:

- **Project** — `package.json` and `.spur/config.yaml` presence.
- **Git** — root, current branch, dirty/clean state.
- **Team** — agent spec ids found under `.spur/agents/`.
- **Path** (when given) — size, `isFile`, `isDirectory` for the named target.

## Example

```bash
spur status                  # human-readable summary
spur status src/auth         # adds file/dir metadata for the path
spur status --json           # machine-readable envelope (see shape below)
```

### JSON shape

```json
{
  "ok": true,
  "packageJson": true,
  "spurConfig": true,
  "git": { "root": "...", "branch": "main", "dirty": false },
  "agentSpecs": ["reviewer", "tester"],
  "path": { "path": "src/auth", "size": 1234, "isFile": false, "isDirectory": true }
}
```

## See Also

- [Command index](./index.md)
- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §3 Initialization
- `docs/04_DESIGN.md` — §1.2 supporting utilities
