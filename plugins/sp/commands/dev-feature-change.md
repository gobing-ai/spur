---
description: "Restructure the feature tree from a mapping file — dry-run then apply via spur feature move / task feature_id edges / root docs/*.md reference rewrites (CLI-gated; no raw Write on docs/features or docs/tasks). Triggers: feature restructure, feature tree move, reparent features, apply mapping file"
role: planner
argument-hint: "[--map <path>] [--dry-run] [--apply] [--limit <old-id>] [--wave <1|2|3|all>] [--yes]"
allowed-tools: ["Bash", "Read", "AskUserQuestion", "Skill"]
---

# Dev Feature Change

CLI-gated feature-tree restructure orchestrator. Executes dispositions from a mapping file; does not invent hierarchy.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--map` `<path>` | Feature-restructure mapping file. | configured |
| `--dry-run` | Plan only; write nothing. | off |
| `--apply` | Apply the planned restructure. | off |
| `--limit` `<old-id>` | Restrict to a single old feature id. | omitted |
| `--wave` `<1\|2\|3\|all>` | Migration wave to execute. | all |
| `--yes` | Skip confirmation prompts. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-feature-change [--map <path>] [--dry-run] [--apply] [--limit <old-id>] [--wave <1|2|3|all>] [--yes]
```

## Implementation

**Preconditions**

1. Load hierarchy rules: `Skill(skill="sp:spur-cli")` → `references/features/hierarchy-mece.md`. Refuse `merge-into` or new root letters unless the map + operator explicitly allow.
2. Mapping file must exist (default `docs/plans/feature-tree-restructure-map.md`).
3. Prefer a clean working tree / dedicated branch for apply.

**Parse map**

- Read `--map`. Collect rows where disposition is not `keep` (typically `reparent-under:<parent>`).
- Filter by `--limit` / `--wave` if set.
- Wave membership comes from the map itself (its wave column/section is the SSOT). Never hard-code letter sets here — the tree moves under the command and literals go stale.

**Free-digit preflight (mandatory before dry-run report)**

Group selected reparent rows by `new_parent`. For each parent:

```bash
spur feature list --json
```

Count current children (ids where `id` starts with parent and length = parent.length+1, digit 1–9).
`free = 9 - childCount`. If `rowsUnderParent.length > free`, **abort the plan** with a clear error naming the parent, free slots, and competing old_ids. Do not apply a partial wave.

**Dry-run plan (always) — sequential prediction**

Do **not** fire independent dry-runs that all claim the same next id. Walk rows **in apply order** and maintain a local occupancy set:

1. Start with real children of each parent from `spur feature list --json`.
2. For each row: run `spur feature move <old_id> --parent <new_parent> --dry-run --json` **or** predict next free digit from the occupancy set (prefer live dry-run when only one pending under that parent).
3. After predicting `new_id`, add it to the occupancy set so the next sibling under the same parent gets the next free digit.
4. Record `mapping` and `tasksUpdated[]` from each dry-run (with multi-folder scan, tasksUpdated should list every linked WBS).

Plan `spur feature refresh` + `spur feature check --json` after apply.

**Root docs/\*.md references (high-confidence only)**

Scan only `docs/*.md` (docs root, not nested folders). For single-letter feature ids, **do not** use bare `\\bX\\b`. Prefer:

- `feature <id>` / `feature <id>,` / `(feature <id>`
- Feature file basename stems from INDEX
- Markdown links to `./<id>_…md`

Skip pure English uses of the letter. Do **not** rewrite `docs/features/`, `docs/tasks*/`, `plugins/`, `apps/`, `AGENTS.md` in v1.

Print blast-radius table: old_id | disposition | predicted new_id | tasks | docs hits.

Stop if only dry-run (or neither flag — treat as dry-run).

**Confirm apply**

Unless `--yes`, use `AskUserQuestion` (or explicit operator “apply”) with the blast-radius report. Abort on no.

**Apply (CLI only)**

Forbidden: raw Write/Edit of feature or task corpus to change IDs. Required: harness CLI.

Apply rows **in the same order** as the dry-run plan:

```bash
spur feature move <old_id> --parent <new_parent> --json
```

After all moves (or per wave):

```bash
spur feature refresh --json
spur feature check --json
```

Task edges: `feature move` rewrites `feature_id` across **all** configured task folders (via `foldersConfig`). Safety check (the glob covers every tasks folder, present and future):

```bash
rg -n '^feature_id: <old_id>$' docs/tasks*/
```

If any stale edges remain, fix with:

```bash
spur task update <wbs> --feature <new_id> --json
```

**Report**

Emit applied mapping, CLI exit codes, check summary, docs files touched, residual skips, free-digit preflight result.

**merge-into (v1)**

Dry-run may print a manual absorb protocol. Apply **skips** automatic body-merge.

**Stretch (not required for v1)**

`--json-out` dry-run report · reverse mapping rollback · `--docs-glob` override (default remains root `docs/*.md`).

**Related**

Map feature F31 · mapping SSOT `docs/plans/feature-tree-restructure-map.md` · hierarchy-mece.md · `spur feature move|refresh|check` · `spur task update --feature`
