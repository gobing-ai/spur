---
description: >-
  Restructure the feature tree from a mapping file — dry-run then apply via
  spur feature move / task feature_id edges / root docs/*.md reference rewrites
  (CLI-gated; no raw Write on docs/features or docs/tasks)
argument-hint: "[--map <path>] [--dry-run] [--apply] [--limit <old-id>] [--wave <1|2|3|all>] [--yes]"
allowed-tools: ["Bash", "Read", "AskUserQuestion", "Skill"]
---

# Dev Featurechange

CLI-gated feature-tree restructure orchestrator. Executes dispositions from a mapping file; does not invent hierarchy.

## Usage

```
/sp:dev-featurechange [--map <path>] [--dry-run] [--apply] [--limit <old-id>] [--wave <1|2|3|all>] [--yes]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--map` | `docs/plans/feature-tree-restructure-map.md` | Old→new disposition SSOT (do not re-audit the tree) |
| `--dry-run` | *(default if neither dry-run nor apply)* | Print planned CLI steps; write nothing |
| `--apply` | off | After confirm (unless `--yes`), run moves + refreshes + doc rewrites |
| `--limit <old-id>` | none | Only process one `old_id` row (dogfood single node) |
| `--wave <n\|all>` | `all` | Restrict to apply-order wave 1 / 2 / 3 from the map |
| `--yes` | off | Skip interactive confirm on apply (still print plan first) |

## Implementation

**Preconditions**

1. Load hierarchy rules: `Skill(skill="sp:spur-cli")` → `references/features/hierarchy-mece.md`. Refuse `merge-into` or new root letters unless the map + operator explicitly allow.
2. Mapping file must exist (default `docs/plans/feature-tree-restructure-map.md`).
3. Prefer a clean working tree / dedicated branch for apply.

**Parse map**

- Read `--map`. Collect rows where disposition is not `keep`.
- Filter by `--limit` / `--wave` if set.
- Wave defaults from map: **1** = K→J, L→J · **2** = N→H, O→H · **3** = P→D, Q→F, R→F.

**Dry-run plan (always)**

For each selected reparent row:

```bash
spur feature move <old_id> --parent <new_parent> --dry-run --json
```

Record `mapping` and `tasksUpdated[]`. Plan `spur feature refresh` + `spur feature check --json`. For root **`docs/*.md` only** (not nested folders): search for old ids; list hits. Do **not** rewrite `docs/features/`, `docs/tasks*/`, `plugins/`, `apps/`, `AGENTS.md` in v1.

Print blast-radius table: old_id | disposition | dry-run new_id | tasks | docs/*.md hits.

Stop if only dry-run (or neither flag — treat as dry-run).

**Confirm apply**

Unless `--yes`, use `AskUserQuestion` (or explicit operator “apply”) with the blast-radius report. Abort on no.

**Apply (CLI only)**

Forbidden: raw Write/Edit of feature or task corpus to change IDs. Required: harness CLI.

```bash
spur feature move <old_id> --parent <new_parent> --json
spur feature refresh --json
spur feature check --json
```

After moves, refresh and check as above. Task edges: prefer `feature move` cascade. If a task remains stale:

```bash
spur task update <wbs> --feature <new_id> --json
```

**Root docs/\*.md references**

For each renamed id, update only `docs/*.md` at the docs root (e.g. `docs/05_FEATURES.md`). Skip hits inside `docs/features/` or `docs/tasks*`.

**Report**

Emit applied mapping, CLI exit codes, check summary, docs files touched, residual skips.

**merge-into (v1)**

Dry-run may print a manual absorb protocol. Apply **skips** automatic body-merge.

**Stretch (not required for v1)**

`--json-out` dry-run report · reverse mapping rollback · `--docs-glob` override (default remains root `docs/*.md`).

**Related**

Map feature F31 · mapping SSOT `docs/plans/feature-tree-restructure-map.md` · hierarchy-mece.md · `spur feature move|refresh|check` · `spur task update --feature`
