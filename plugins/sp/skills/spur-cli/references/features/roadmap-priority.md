---
name: feature-roadmap-priority
description: Roadmap hierarchy, priority/status conventions, and feature-tree adjustment guidance for spur feature.
see_also:
  - spur-cli
  - feature-verbs
  - product-planning
---

# Roadmap, Priority, And Status

`spur feature` is the feature-tree surface for roadmap structure. Use it to represent capability
hierarchy, lifecycle state, and priority. Keep PM scoring as prose or frontmatter scalar fields
until a deterministic schema is introduced.

## Hierarchy

Feature hierarchy should be user-facing first:

- Top-level features are product capabilities or roadmap themes.
- Children are deliverable slices under that capability.
- Technical modules, package names, and endpoints belong in prose or notes, not as the primary tree
  shape unless the product itself is developer-facing infrastructure.

**Normative create/extend rules (MECE, root gate, merge vs reparent):** see
[hierarchy-mece.md](hierarchy-mece.md). Load that file before `spur feature create` of a new root or
any bulk restructure. This section only states the product-facing intent; hierarchy-mece is the
checklist.

Use `spur feature move <id> --parent <id>` to restructure. Never hand-edit IDs; `move` cascade-renames
descendants and preserves the tree invariant.

## Priority

Use the existing scalar field path for priority:

```bash
spur feature update <id> --field priority --value P1
```

Recommended meaning:

| Priority | Meaning |
| --- | --- |
| `P0` | Stop-the-line; current release or production health depends on it. |
| `P1` | High-value committed work. |
| `P2` | Important backlog item; sequence after committed work. |
| `P3` | Opportunistic or exploratory. |

When prioritizing many candidates, use the RICE or MoSCoW guidance from `sp:spur-dev`'s product
planning reference, then write only the chosen scalar priority/status through `spur feature update`.
Keep the scoring rationale in the feature body or linked planning notes; do not invent hidden
metadata fields.

## Status

Feature statuses are lifecycle states, not priority buckets:

| Status | Use for |
| --- | --- |
| `backlog` | Accepted idea, not actively being built. |
| `active` | Current work target; `check` enforces one active goal. |
| `verifying` | Implementation is believed complete and AC traceability is being checked. |
| `blocked` | Progress stopped by an explicit dependency or decision. |
| `done` | Acceptance criteria are satisfied and verified. |
| `cancelled` | Explicitly cut; keep the record for traceability. |

Move status with `spur feature update <id> <status>` and let the lifecycle engine reject illegal
transitions.

## Roadmap Adjustments

For roadmap adjustment work:

1. List the candidate scope with `spur feature list --json` or a specific subtree with
   `spur feature show <id> --json`.
2. Apply the product-planning prioritization rubric in-session.
3. Present the proposed moves/status/priority changes before mutating if the blast radius spans
   multiple features.
4. Apply each accepted deterministic change through `spur feature update` or `spur feature move`.
5. Run `spur feature refresh` and `spur feature check --json`.

Do not add `/sp:prd-adjust` for this. The current CLI already has the deterministic primitives; the
PM value is the ranking and tradeoff judgment.
