---
name: "W2: spur feature move — cascade rename for hierarchy changes"
description: "W2: spur feature move — cascade rename for hierarchy changes"
status: Backlog
created_at: 2026-06-13T01:08:18.984Z
updated_at: 2026-06-13T01:08:18.984Z
folder: docs/tasks
type: task
feature-id: F3
priority: P2
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0061. "W2: spur feature move — cascade rename for hierarchy changes"

### Background

Design §2.4/DD-14: moves are renames (ID encodes position); rare, CLI-mediated. Surface addition — sync the delivery doc + 04_DESIGN when built.


### Requirements

R1. spur feature move <id> --parent <id>: re-allocates ID, renames file, cascades to all descendants.
R2. Updates every task feature_id edge; History entries appended on all touched files.
R3. Atomic under the lock domain; dry-run report.


### Q&A



### Design

Authority: design §2.4 + DD-14 (moves are renames because the ID encodes position; rare, CLI-mediated,
cascade: descendants re-IDed, files renamed, every task `feature_id` edge updated, History entries
appended on all touched files; atomic within the lock domain). Surface addition: the verb is
`spur feature move <id> --parent <id>` — sync the delivery doc §1.2 and `04_DESIGN §7.2` in the landing
commit (this task settles the doc drift it would otherwise create).


### Solution

1. FeatureService `move`: compute target ID (next free digit under new parent, ≤9 enforced), map old→new
   for the node + all descendants, then execute as one write-service batch: file renames + frontmatter id
   rewrites + task edge updates + History appends.
2. `--dry-run`: full old→new mapping + affected-task report, zero writes.
3. Atomicity: all-or-nothing under the create-lock + entity locks; failure mid-cascade rolls back via the
   dry-run plan (apply only after full plan validates).
4. Tests: multi-level subtree move with linked tasks; collision (target parent full) rejected; dry-run
   write-free. Same commit: delivery doc + `04 §7.2` surface sync. Gate: ≥90%.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


