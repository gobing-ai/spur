# spur feature

Manage features with hierarchical IDs. Group letters A–Z are the top level; children take the
next free digit (`F7` → `F71`, `F72`, …). IDs encode position — moving a feature cascade-renames
its whole subtree. Backed by the same CLI-gated write path as `spur task`.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `create <name>` | Create a feature; allocates a hierarchical ID under the create-lock |
| `show <id>` | Show a feature by ID |
| `update <id> [status]` | Update status, a scalar frontmatter field, or a section body |
| `advance <id>` | Walk the legal forward lifecycle path |
| `list` | List features with status/priority filters |
| `move <id>` | Move to a new parent — cascade-renames the subtree |
| `refresh` | Rebuild INDEX.md and per-feature task tables (docs only) |
| `check [id]` | Validate feature file(s) through the four-layer check |
| `sync [id]` | Align feature status with linked task states |

## spur feature create

```bash
spur feature create <name> [--parent <id>] [--folder <path>] [--json]
```

With `--parent`, the child gets the next free digit 1–9; without it, the next free group letter:

```bash
spur feature create "User authentication"           # → next group letter
spur feature create "OAuth provider" --parent F7    # → next digit under F7
```

## spur feature show / list

```bash
spur feature show <id> [--folder <path>] [--json]
spur feature list [--status <s>] [--priority <p>] [--folder <path>] [--json]
```

`show` prints the feature summary and content (exit 1 if not found); `list` sorts by ID and
accepts both filters combined.

## spur feature update

Three composable mutation modes, applied in order (section → scalar field → status):

```bash
spur feature update F7 active                                   # (a) lifecycle transition
spur feature update F7 --field priority --value P0              # (b) scalar frontmatter field
spur feature update F7 --section Goal --from-file ./goal.md     # (c) section body replace
```

`--section` requires `--from-file` (body-only). Exit 2 if an option pair is incomplete.

Feature statuses: `backlog → active → verifying → done` (plus `cancelled`). `verifying` exists so
verification is a derivable, listable state rather than a memory.

## spur feature advance

```bash
spur feature advance <id> [--to <status>] [--folder <path>] [--json]
```

Walks the legal forward path one hop at a time to the `--to` target (default `done`), running
`feature check` at the gates: standard before leaving `active`, and a normal (non-strict) check
at the `done` boundary — required-error findings still block the hop, advisory warnings stay
advisory.

```bash
spur feature advance F7                  # → done
spur feature advance F7 --to verifying
spur feature advance F7 --json           # { id, status, hops: [{from, to}, ...] }
```

## spur feature move

```bash
spur feature move <id> [--parent <id>] [--dry-run] [--folder <path>] [--json]
```

Cascade-rename: re-IDs the node and all descendants (ID encodes position), renames files,
rewrites `id` frontmatter, appends a History line, and updates every task `feature_id` edge. The
full old→new plan is validated first and applied atomically.

```bash
spur feature move F71 --dry-run    # preview the old→new ID map
spur feature move F71 --parent B   # → B + next digit, subtree renamed
```

## spur feature refresh

```bash
spur feature refresh [--feature <id> | --all] [--folder <path>] [--json]
```

Rebuilds `INDEX.md` and each feature's task table from task edges. **Docs only** — no status
changes. Scope is explicit: a bare invocation refuses to sweep; pass `--feature <id>` or `--all`.

## spur feature check

```bash
spur feature check [id] [--strict] [--as <status>] [--fix] [--folder <path>] [--json]
```

Four layers: frontmatter schema (L1), status-driven section matrix (L2), acceptance-criteria and
goal rules (L3), incoming edges and coverage warnings (L4). `--strict` elevates warnings to
failures, `--as <status>` evaluates as if the feature were in that status, and `--fix` repairs
structural findings in place (never authors content).

## spur feature sync

```bash
spur feature sync [id | --all] [--dry-run] [--force] [--folder <path>] [--json]
```

Aligns feature **lifecycle status** with the states of its linked tasks — real transitions with
guards. Prefer `--dry-run` first. `--force` applies reopen proposals without confirmation.
Docs regeneration is `refresh`, not `sync`.

```bash
spur feature sync F7 --dry-run --json
spur feature sync --all --json
```

## See also

- [task](./task.md) — the work items that link to features
- [Daily development workflow](./daily-development-workflow.md) — planning and close-out

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: feature.txt + verbs/feature_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
