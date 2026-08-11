# sp plugin feature-tree restructure map

**Status:** applied (2026-08-11)
**Consumer:** `/sp:dev-featurechange`
**Boundary:** B owns runtime agent execution; I owns the sp plugin; H is frozen history.

## Target

```text
I — sp plugin
├── I1 — sp plugin hands-off ready (former I)
│   └── I11 — dev-idea taste gate (former I1)
└── I2 — spur-dev/spur-cli parity audit (former L)
```

## Mapping

| old_id | disposition | new_parent | expected_new_id | rationale | task_edge_notes | docs_root_refs |
| --- | --- | --- | --- | --- | --- | --- |
| I | reparent-under:new-I | I | I1 | Completed hands-off delivery becomes a child of the durable plugin capability. | Cascade 0167–0175 to I1. | no |
| I1 | cascade | I1 | I11 | Preserve the existing child relationship under the moved subtree. | Cascade 0360–0364 to I11. | no |
| L | reparent-under:new-I | I | I2 | Active parity work belongs to the plugin capability, not a new root. | Cascade 0512–0515 to I2. | yes |

## Apply sequence

The current historical feature occupies root `I`, so use `L` as the temporary parent; no unrelated
feature is involved.

1. Dry-run and apply `I → L1` (cascade `I1 → L11`) to free root `I`.
2. Create root `I` as `sp plugin`; root allocation reuses the first free letter.
3. Dry-run and apply `L1 → I1` (cascade `L11 → I11`).
4. Dry-run and apply `L → I2`.
5. Refresh and check the corpus; verify no task retains `feature_id: L`, `I`, or the temporary IDs.

## Ownership amendment

- **B — Agent execution:** `spur agent`, runner/doctor, process and session lifecycle, executor selection.
- **I — sp plugin:** `/sp:dev-*`, skills, commands, subagents, hooks, orchestration guidance, and CLI-reference parity.
- **H — legacy Agent integration history:** closed to new children. Existing children remain until a
  separate evidence-backed audit assigns each to B or I.

## Applied result

| Source | Temporary | Final | Tasks updated |
| --- | --- | --- | --- |
| I subtree | I → L1; I1 → L11 | I1; I11 | 0167–0175; 0360–0364 |
| new root | — | I | none |
| L | — | I2 | 0512–0515 |

`spur feature move` also exposed and fixed a shared defect: cascade moves updated frontmatter IDs
and filenames but not `# ID:` headings. The move path now rewrites the first feature heading, with
a regression assertion; CLI round-trips normalized I1, I11, and I2.
