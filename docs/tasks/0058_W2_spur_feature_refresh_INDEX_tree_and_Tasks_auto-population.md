---
name: "W2: spur feature refresh — INDEX tree and Tasks auto-population"
description: "W2: spur feature refresh — INDEX tree and Tasks auto-population"
status: Backlog
created_at: 2026-06-13T01:08:18.983Z
updated_at: 2026-06-13T01:08:18.983Z
folder: docs/tasks
type: task
feature-id: F3
priority: P1
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0058. "W2: spur feature refresh — INDEX tree and Tasks auto-population"

### Background

Design §4.3, B03/B04/B06. INDEX renders the ID-encoded tree in tree-command style with status + links.


### Requirements

R1. INDEX.md full regeneration, deterministic, tree view with per-node status and markdown links.
R2. ## Tasks rewritten only between auto-gen markers; task files never touched.
R3. Golden-file tests.


### Q&A



### Design

Authority: design §4.3 (INDEX renders the ID-encoded tree, `tree`-command style, per-node status +
markdown link; full regeneration, deterministic ordering; feature `## Tasks` rewritten only between
auto-gen markers; task files never touched), B04 (links auto-populated from task `feature_id` edges).


### Solution

1. INDEX renderer in FeatureService: corpus scan → sort by ID (depth from length, lexicographic within
   level) → tree-drawing output with status badge + relative link per node → `docs/features/INDEX.md`.
2. `## Tasks` populator: scan registered task folders for `feature_id` edges → per-feature table (WBS,
   name, status) → `replaceMarkerRegion` via MarkdownDocument (0042); everything outside markers
   untouched (byte-compare test).
3. Golden-file tests for both outputs using the real corpus fixture + synthetic multi-depth fixtures.
4. Wire as `spur feature refresh` in the 0056 command file. Same commit: `04 §7.2`. Gate: ≥90%.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


