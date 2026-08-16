# spur feature

> Manage features with hierarchical IDs. Group letters A–Z are the top level; children
> get the next free digit 1–9 (e.g. `F7` → `F71`, `F72`, …). IDs encode position — moving
> a feature cascade-renames the subtree. Backed by `PlanningWriteService` over the same
> write path as `spur task`.

## Subcommands

| Subcommand | Description |
|---|---|
| `create <name>` | Allocate a hierarchical ID under the create-lock |
| `show <id>` | Show a feature by ID (summary + content) |
| `update <id> [status]` | Lifecycle transition, `--field/--value` scalar, or `--section/--from-file` body replace |
| `advance <id>` | Walk a feature through the legal forward lifecycle path to a target status |
| `list` | List features sorted by ID, with status/priority filters |
| `move <id>` | Move a feature to a new parent — cascade-rename the subtree |
| `refresh` | Rebuild `INDEX.md` + each feature `## Tasks` table from task edges (**docs only** — no status change) |
| `check [id]` | Validate feature file(s) through the four-layer check |
| `sync [id]` | Align feature **lifecycle status** with linked task states (real transitions + guards) |

## spur feature create

```
spur feature create [options] <name>
```

| Argument | Description |
|---|---|
| `name` | Feature name |

| Flag | Description |
|---|---|
| `--parent <id>` | Parent feature ID (child gets the next free digit 1–9) |
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

ID allocation under the create-lock (R1): `--parent` → next free child digit 1–9; no
parent → next free group letter A–Z.

### Example

```bash
spur feature create "User authentication"           # → allocates a group letter (e.g. F7)
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

Returns the feature summary + content; exit 1 if not found.

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

Three mutation modes, composable in one invocation (applied in order: section → scalar field → status):

### Mode (a): Lifecycle transition

```
spur feature update [options] <id> <status>
```

### Mode (b): Section replace (body-only)

```
spur feature update [options] <id> --section <name> --from-file <path>
```

### Mode (c): Scalar frontmatter field

```
spur feature update [options] <id> --field <key> --value <value>
```

| Argument | Description |
|---|---|
| `id` | Feature ID |
| `status` | New lifecycle status (omit when using `--field/--value` or `--section/--from-file`) |

| Flag | Description |
|---|---|
| `--field <key>` | Frontmatter field to set (e.g. `priority`) |
| `--value <value>` | New value for `--field` |
| `--section <name>` | Section name to replace (requires `--from-file`; body-only contract) |
| `--from-file <path>` | File to read section body from (requires `--section`) |
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

Exit 2 if an option pair is incomplete.

### Examples

```bash
spur feature update F7 active                                  # lifecycle transition
spur feature update F7 --field priority --value P0            # set a scalar field
spur feature update F7 --section Goal --from-file ./goal.md   # section replace (body-only)
```

### Feature statuses

```
backlog → active → verifying → done  (also: cancelled)
```

`verifying` is DD-13's status — it makes verification derivable, listable, event-triggerable,
and assignable.

## spur feature advance

```
spur feature advance [options] <id>
```

| Argument | Description |
|---|---|
| `id` | Feature ID to advance |

| Flag | Default | Description |
|---|---|---|
| `--to <status>` | `done` | Target status (`backlog` → `active` → `verifying` → `done`) |
| `--folder <path>` | — | Custom features folder |
| `--json` | — | Output machine-readable JSON |

Walks a feature through the legal forward lifecycle path (`backlog → active → verifying →
done`), one hop at a time, until the `--to` target is reached. Runs `feature check` at the
gates: standard before leaving `active`, strict before leaving `verifying`. Prints the hop
trail on success (`F7: advanced to done (active → verifying, verifying → done)`).

### Example

```bash
spur feature advance F7                 # → done (walks the full forward path)
spur feature advance F7 --to verifying  # stop at verifying
spur feature advance F7 --json          # { id, status, hops: [{from, to}, ...] }
```

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

Cascade-rename (DD-14): re-IDs the node + all descendants (ID encodes position), renames
their files, rewrites each `id` frontmatter + appends a move History line, and updates
every task `feature_id` edge. Validates the full old→new plan first (collision / ≤9 /
not-into-own-subtree); applies atomically with best-effort rollback.

### Example

```bash
spur feature move F71 --parent B   # → B + next digit, cascade-renames subtree
spur feature move F71 --dry-run    # preview the old→new ID map
```

## spur feature refresh

```
spur feature refresh [options]
```

| Flag | Description |
|---|---|
| `--feature <id>` | Restrict the `## Tasks` rewrite to one feature (INDEX.md still regenerated) |
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

Regenerate `INDEX.md` (deterministic ID-encoded tree, per-node status badge + relative
link) and repopulate each feature's `## Tasks` auto-gen marker region from task
`feature_id` edges. Only the marker region is rewritten; the rest of the feature file and
all task files are byte-preserved. **Does not change feature lifecycle status** (that is
`sync`).

> Run `spur feature refresh` when closing a task to keep feature `## Tasks` blocks tracking
> real task status.

## spur feature sync

```
spur feature sync [options] [id]
```

| Argument | Description |
|---|---|
| `id` | Feature ID (optional if `--all`) |

| Flag | Description |
|---|---|
| `--all` | Sync all features with linked tasks |
| `--dry-run` | Report proposed status transitions without applying |
| `--force` | Apply reopen proposals without confirmation |
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

Align a feature's **lifecycle status** with the states of its linked tasks (real status
transitions + guards). Prefer `--dry-run` first. **Does not** rewrite INDEX/`## Tasks` —
use `refresh` for roster docs.

```bash
spur feature sync H2 --dry-run --json
spur feature sync H2 --json
spur feature sync --all --json
```

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
| `--as <status>` | Evaluate the one-active-goal rule as if the feature were in `<status>` (0418: lifecycle FSM guards pass the transition target) |
| `--folder <path>` | Custom features folder |
| `--json` | Output machine-readable JSON |

**Four-layer check:**

- **L1** — Zod frontmatter schema (hard).
- **L2** — section-matrix (status-driven required sections).
- **L3** — BDD AC validation (shared 0043 module) + one-active-P0-goal over
  {active, verifying} + ≤9-children (DD-14, corpus-derived).
- **L4** — incoming `feature_id` edges + orphan-scenario warnings + **AC coverage**
  (DD-09: feature scenarios covered by no linked task = warnings) + verifying-readiness
  (linked tasks not done/cancelled).

`--strict` elevates warnings to failures.

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.1 Planning
- [spur task](./cmd_task.md) — WBS-numbered tasks that link to features
- `docs/04_DESIGN.md` — §7.2 `spur feature` commands (canonical surface)
