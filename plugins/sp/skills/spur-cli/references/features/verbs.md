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
- `list` filters by `--status <s>`. `--json` emits an array.

## `update <id> [status] | --field <key> --value <v>`

Dual-mode, mutually exclusive. **No `--section`** — feature body sections are hand-edited in the
file.

- **Status** (positional): legal transition over `backlog → active → verifying → blocked → done →
  cancelled`. `verifying` is the AC-traceability gate. **One active goal** corpus-wide (enforced by
  `check`).
- **Field** (`--field` requires `--value`): set a single frontmatter scalar, e.g.
  `--field priority --value P1`.

Exit `2` when neither a status nor a complete `--field/--value` pair is given.

## `move <id>`

Re-parent a subtree. `--parent <new>` cascade-renames `<id>` and **every descendant** to the new
position; omit `--parent` to lift the subtree to a top-level group. Use this for any structural
change — never hand-edit an ID, which would orphan descendants and break edges.

## `refresh`

Rebuild the features INDEX, the tree, and each feature's `## Tasks` block from the files on disk.
**Files win.** Run after hand-edits.

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
