---
name: feature-verbs
description: Per-verb flag detail, JSON shapes, and the four check layers for spur feature.
see_also:
  - spur-cli
---

# `spur feature` — verb detail

Ground truth for every `spur feature` verb. The CLI is the source of behavior; this mirrors it. If
a flag isn't listed, it doesn't exist.

## `create <name>`

Allocate a feature with a hierarchical ID (DD-14) under the create-lock (serialized allocation;
fail-loud).

| Flag | Effect |
| ---- | ------ |
| `--parent <id>` | Child gets the next free digit 1–9 under `<id>`. Omit for a top-level letter ID. |
| `--folder <path>` | Target a non-default features folder. |
| `--json` | Emit `{ ref: { id, filePath } }`. |

## `show <id>` / `list`

- `show <id>` prints frontmatter + body.
- `list` filters by `--status <s>` and/or `--priority <p>`. `--json` emits an array.

## `update <id> [status] | --field <key> --value <v> | --section <name> --from-file <path>`

Multi-mode. At least one of status, field pair, or section pair is required (exit `2` otherwise).

- **Status** (positional): legal transition over `backlog → active → verifying → blocked → done →
  cancelled`. `verifying` is the AC-traceability gate. **One active goal** corpus-wide (enforced by
  `check`).
- **Field** (`--field` requires `--value`): set a single frontmatter scalar, e.g.
  `--field priority --value P1`.
- **Section** (`--section` **requires** `--from-file`): replace the entire named section body from a
  file (same file-wins contract as `spur task update --section`).

## `advance <id>`

Walk the legal **forward** lifecycle path hop-by-hop until a target status.

| Flag | Effect |
| ---- | ------ |
| `--to <status>` | Target status (default `done`). Forward path: `backlog → active → verifying → done`. |
| `--folder <path>` | Custom features folder. |
| `--json` | Emit `{ id, status, hops: [{ from, to }, …] }`. |

No-op (success) when already at the target. Exit `1` if the feature is missing or a hop is illegal.

## `move <id>`

Re-parent a subtree. `--parent <new>` cascade-renames `<id>` and **every descendant** to the new
position; omit `--parent` to lift the subtree to a top-level group. Use this for any structural
change — never hand-edit an ID, which would orphan descendants and break edges.

| Flag | Effect |
| ---- | ------ |
| `--parent <id>` | New parent (omit → top-level group). |
| `--dry-run` | Show old→new ID map + affected tasks without writing. |
| `--folder` / `--json` | Standard. |

## `refresh`

Rebuild **derived docs only**: `INDEX.md` and each feature's `## Tasks` auto-gen region from task
`feature_id` edges (WBS / title / status). **Files win** for that region; Goal/Scope/AC and feature
`status` are untouched. Run after task create/link/done or hand-edits that leave the roster stale.

| Flag | Effect |
| ---- | ------ |
| `--feature <id>` | Rewrite only that feature's `## Tasks` (INDEX.md still fully regenerated). |
| `--folder` / `--json` | Standard. |

**vs `sync`:** `refresh` never changes lifecycle status and never runs transition guards.

## `sync [id]`

Align a feature's **frontmatter status** with linked task states. Derives a proposal and, unless
`--dry-run`, applies legal lifecycle hops (e.g. all tasks terminal → toward `done`; reopened work →
reopen). Real transitions — gates (dogfood for self-referential workflow features, one-active-goal,
L4 readiness) may deny a hop.

| Flag | Effect |
| ---- | ------ |
| `[id]` / `--all` | One feature, or every feature that has linked tasks (one required). |
| `--dry-run` | Report proposal only; no write. |
| `--force` | Apply a *reopen* (backward) proposal without interactive confirmation. |
| `--folder` / `--json` | Standard. JSON: `{ proposal, applied, appliedHops[] }`. |

**vs `refresh`:** `sync` never rewrites INDEX.md or `## Tasks` tables.

## `check [id]`

The four-layer validator. Bare = whole tree; with an ID = one feature. `--strict` elevates warnings
to failures. `--json` emits per-feature findings.

| Layer | Checks | Severity |
| ----- | ------ | -------- |
| **L1** | Zod frontmatter schema | hard error |
| **L2** | Section-Status-Matrix presence (required sections per status) | warning-first; `gate:true` sections are hard |
| **L3** | Format rules — BDD AC syntax, one-active-goal, children-limit (≤ 9, corpus-derived) | mixed |
| **L4** | Traceability — incoming `feature_id` edges, orphan scenarios, coverage orphans, `verifying` readiness | warning-first |

A finding carries `{ layer: 'L1'|'L2'|'L3'|'L4', section, severity, message }`. Parse the JSON to
answer "is H2 ready for `verifying`?" or "which scenarios have no task?" — the rules are CLI code,
not prose to restate. This is the gate `sp:spur-dev`'s planning half loops on.

## Command surface (quick)

```
spur feature create  <name> [--parent <id>] [--folder] [--json]
spur feature show    <id> [--folder] [--json]
spur feature update  <id> [status] [--field <k> --value <v>] [--section <n> --from-file <p>] [--folder] [--json]
spur feature advance <id> [--to <status>] [--folder] [--json]
spur feature list    [--status <s>] [--priority <p>] [--folder] [--json]
spur feature move    <id> [--parent <id>] [--dry-run] [--folder] [--json]
spur feature refresh [--feature <id>] [--folder] [--json]
spur feature sync    [id] | --all [--dry-run] [--force] [--folder] [--json]
spur feature check   [id] [--strict] [--folder] [--json]
```
