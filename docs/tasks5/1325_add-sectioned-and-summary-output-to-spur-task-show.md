---
schema_version: 1
name: Add sectioned and summary output to spur task show
status: todo
template: feature-impl
created_at: 2026-11-10T07:34:40.665Z
updated_at: "2026-11-10T16:31:03.319Z"
feature_id: F22

priority: P2
ac_altitude: task-local
estimate_hours: 6
---

## 1325. Add sectioned and summary output to spur task show

### Background

KK history analysis since spur 0.4.30 (2026-11-10): task files of 36–52KB (0345: 35,959 bytes;
0346: 51,947 bytes) were re-read whole via `spur task show` across sessions, contributing to average
cache-read contexts of 74–170K tokens per assistant step (claude avg 102K, max 161K) and 265–708
step sessions. The `precheck-size` gate already forces oversized task files to trim, but the size
budget is not surfaced at authoring/refine time, and there is no way to read one section without
paying for the whole file.

### Requirements

- [ ] R1. `spur task show` gains a section filter (e.g. `--sections "Background,Requirements"` or repeated
   `--section`) and a summary mode (metadata + section index + per-section byte counts) so callers
   never need the full dump to plan or resume.
- [ ] R2. Size budget: the create/update/refine surface reports current file size against the
   `precheck-size` threshold at write time, not only at pipeline precheck.
- [ ] R3. Guidance: decomposition/refine guidance prefers phase-scoped task docs over one monolithic file
   when the AC set grows past the budget.

### Acceptance Criteria

- [ ] AC1 — (req: R1): `spur task show <wbs> --section Background --json` returns only that section's body plus
  metadata, byte-identical to the file's section content.
- [ ] AC2 — (req: R1): Summary mode returns the section index with byte counts and total size without section bodies.
- [ ] AC3 — (req: R2): Writing a task that exceeds the precheck-size threshold emits a size warning (or error, per
  current policy) at the CLI write, before any pipeline run.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-10T16:30:44.388Z

- Q: Why not let agents use sed/awk on task files? A: Callers already do, inconsistently; the CLI
  owns the section matrix, so the CLI should own filtered reads. This also keeps JSON consumers
  off markdown parsing.
- Q: Is the size warning a hard error? A: Warning at write time; `precheck-size` remains the hard
  gate at pipeline admission. This mirrors current policy rather than tightening it.
- Q: Dependencies? A: None.

### Design

**Decision: filter at the CLI read surface, not in callers.** `spur task show` already parses the
task file into frontmatter + sections; add two flags on that path only.

1. `--section <name>` (repeatable) or `--sections "A,B"`: return only the named sections' bodies
   plus frontmatter metadata, byte-identical to the file content. Unknown section names are an
   error listing valid names.
2. `--summary`: return frontmatter metadata plus a section index (name, byte count, heading line)
   and total file size, with no section bodies.
3. Size budget at write: the create/update/refine write path compares file size against the
   `precheck-size` threshold and emits a size warning at write time (before any pipeline run).
   Decomposition guidance prefers phase-scoped task docs when AC sets outgrow the budget.

No new flags on other nouns; no change to the task file schema.

### Plan

- [ ] P1. Section filter on `spur task show`: flag parsing, section extraction, JSON + human
  output, unknown-name error.
- [ ] P2. Summary mode: section index with byte counts and total size, no bodies.
- [ ] P3. Size-budget warning on the task write path (create/update/refine) using the existing
  precheck-size threshold.
- [ ] P4. Tests: filtered output byte-identity, summary byte counts, oversize write warning;
  update spur-cli reference docs.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-10T16:31:03.319Z backlog → todo (system)

