# spur feature

> Manage features with hierarchical IDs (groups A–H, digit children: A1, A1→B1, etc.).

## Subcommands

| Subcommand | Description |
|---|---|
| `create <name>` | Create a feature; allocates a hierarchical ID under the create-lock |
| `show <id>` | Show a feature by ID |
| `update <id> [status]` | Update a feature status (lifecycle) or a scalar frontmatter field |
| `list` | List features with optional status/priority filters |
| `move <id>` | Move a feature to a new parent — cascade rename of the subtree |
| `refresh` | Regenerate INDEX.md (ID-encoded tree) and repopulate each feature ## Tasks region |
| `check [id]` | Validate feature file(s) through the four-layer check |

## spur feature create

```
spur feature create [options] <name>
```

| Argument | Description |
|---|---|
| `name` | Feature name |

| Flag | Description |
|---|---|
| `--parent <id>` | Parent feature ID (child gets the next free digit 1-9) |
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

### Example

```bash
spur feature create "User authentication"           # → allocates ID (e.g. F7)
spur feature create "OAuth provider" --parent F7    # → F71
```

## spur feature show

```
spur feature show [options] <id>
```

| Argument | Description |
|---|---|
| `id` | Feature ID |

| Flag | Description |
|---|---|
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

### JSON shape

```json
{
  "id": "F1",
  "status": "active",
  "name": "Planning foundation",
  "filePath": "...",
  "frontmatter": { ... }
}
```

## spur feature update

```
spur feature update [options] <id> [status]
```

| Argument | Description |
|---|---|
| `id` | Feature ID |
| `status` | New lifecycle status (omit when using `--field/--value`) |

| Flag | Description |
|---|---|
| `--field <key>` | Frontmatter field to set (e.g. `priority`) |
| `--value <value>` | New value for `--field` |
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

### Examples

```bash
spur feature update F7 active                       # lifecycle transition
spur feature update F7 --field priority --value P0  # set a scalar field
```

### Feature statuses

```
backlog → active → verifying → done  (also: cancelled)
```

> **No `--section`:** feature bodies (Goal/Scope/AC/Tasks/Notes) are hand-edited. The CLI owns
> status, scalar `--field/--value`, IDs via create/move, and the `## Tasks` block via refresh.

## spur feature list

```
spur feature list [options]
```

| Flag | Description |
|---|---|
| `--status <s>` | Filter by status |
| `--priority <p>` | Filter by priority |
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

### JSON shape

Array of feature objects: `[{ id, status, priority, name }, ...]`

### Verified corpus (2026-06-19)

18 features: groups A–H (active), F1 (active P0), F2–F6 (backlog), B1/H1–H3 (backlog).

## spur feature move

```
spur feature move [options] <id>
```

| Argument | Description |
|---|---|
| `id` | Feature ID to move |

| Flag | Description |
|---|---|
| `--parent <id>` | New parent feature ID (omit to move to a top-level group) |
| `--dry-run` | Show the old→new ID map + affected tasks without writing |
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

### Example

```bash
spur feature move F71 --parent B     # → B + next digit, cascade-renames subtree
spur feature move F71 --dry-run      # preview the old→new ID map
```

## spur feature refresh

```
spur feature refresh [options]
```

| Flag | Description |
|---|---|
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

Regenerates `INDEX.md` (ID-encoded tree with status badges) and repopulates each feature's
`## Tasks` region. Read-only over the corpus (files win); safe to run anytime.

> Run `spur feature refresh` when closing a task to keep feature `## Tasks` blocks tracking real
> task status.

## spur feature check

```
spur feature check [options] [id]
```

| Argument | Description |
|---|---|
| `id` | Feature ID (validates all features when omitted) |

| Flag | Description |
|---|---|
| `--strict` | Elevate warnings to failures |
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

Four-layer check: L1 Zod frontmatter (hard) · L2 section presence · L3 format (BDD AC syntax,
one-active-goal, ≤9 children) · L4 traceability (incoming feature_id edges, orphan scenarios).

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.1 Planning
- `docs/04_DESIGN.md` — §7.2 feature commands
