---
schema_version: 1
name: "Symbol-anchor convention: prefer path:symbol over path:line in new task citations and test evidence"
status: todo
template: feature-impl
created_at: 2026-08-27T19:45:19.751Z
updated_at: "2026-08-27T19:48:07.380Z"
feature_id: F94
priority: P3
---

## 0695. Symbol-anchor convention: prefer path:symbol over path:line in new task citations and test evidence

### Background

Rider from the 0688 friction review (F94): line-number anchors are the rot source — G-2 exists
because `path:line` citations silently decay under source edits. A `path:symbol` citation
(`file.ts#symbol` or `file.ts:symbol` per whatever the anchor grammar supports) survives line
shifts and is what the drift detector (0692) then verifies instead of re-derives. S-size: docs
plus a corpus note, no checker change.

### Requirements

- [ ] R1. **Document the convention** in the authoring guidance that owns citation forms (wherever
      F91/0584 landed them — `sp:code-verification`, cross-cutting references): prefer
      `path:symbol` over `path:line` for new task citations and test evidence; line anchors are
      the rot source.
- [ ] R2. **Corpus note.** One dated note recording the 0688-review decision so the convention's
      origin is traceable.

### Acceptance Criteria

- [ ] AC1. Given the updated guidance, a new author finds the preferred `path:symbol` form, the
      reason, and when a line anchor is still acceptable.
- [ ] AC2. The dated corpus note exists and links back to this feature.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
