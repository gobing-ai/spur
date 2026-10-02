---
schema_version: 1
name: Classify nested .spur/run citations in persist-out instead of truncating to directory name
status: todo
template: issue
created_at: 2026-10-02T21:08:29.604Z
updated_at: "2026-10-02T21:09:14.226Z"
feature_id: D62

---

## 1056. Classify nested .spur/run citations in persist-out instead of truncating to directory name

### Background

Session defect observed 2026-10-02 during task 1052's worktree teardown (run 782ba320-0fef-4424-a00d-437b203d642c): `inline-run-setup --persist-out` failed twice. `RUN_CITATION_RE` (packages/app/src/services/inline-run-setup.ts:227) captures only the first path component of a citation — its charset excludes `/` — so six legitimate nested references (`.spur/run/triage-1051-1056/bundle-check.log` and siblings, cited in 1052's Testing section) collapsed into ONE copy obligation for the name `triage-1051-1056`, which resolves to a real evidence DIRECTORY. Symptom chain: "missing in both the worktree and the invoking tree" (directory is not a regular file), then after copying the dir into the worktree, "destination … is not a regular file — refusing to follow it" (:251). The 0984 R5 vocabulary already classifies unownable citations (`cited-directory:<name>` / `cited-symlink:<name>` / `cited-non-file:<name>`, :193) but subpath captures never reach that classifier.

Worked around in-session by flattening the six files to direct-child names (`triage-1051-1056-<file>`) and rewriting 1052's citations (commit `docs(tasks): flatten 1052 run-evidence citations to direct-child names (0984 persist-out contract)`). Recurrence is likely: task 1051 cites the same directory with subpaths, so any future D62/D63 worktree teardown covering it hits the same fatal.

### Requirements

- R1: A `.spur/run/<name>/<rest>` citation must not become a copy obligation for `<name>`. Smallest sufficient design — when the character following the captured group is `/`, classify the citation through the existing 0984 R5 skip vocabulary (`cited-directory:<name>`), OR extend extraction to resolve the full nested path against `SAFE_RUN_ID_RE` per component; pick one, and document the decision in the `asLiteralRunFileName` contract comment (inline-run-setup.ts:218-233). Recommendation: the skip classification — it matches the existing "not a file the copy set can own" contract and needs no path-traversal surface.
- R2: Literal direct-child citations behave exactly as today (copy obligation, divergence check, MAX_CITED_RUN_FILES budget) — existing 0984 suite stays green.
- R3: Any nested-path resolution (if chosen over skip) validates each component with the existing safe-name charset; no `..` or traversal escape.

### Acceptance Criteria

- [ ] AC1: A merged task file citing `.spur/run/<dir>/<file>` where `<dir>` exists as a directory in the invoking tree no longer fatals persist-out; the citation resolves to a declared skip reason (or a copied nested file, per R1 choice) — test in packages/app persist-out/0984 suite.
- [ ] AC2: Existing direct-child citation behavior is unchanged — full existing inline-run-setup/0984 test suite passes without modification.
- [ ] AC3: Classifier decision has unit evidence (capture-then-classify or resolve-path case) in packages/app tests, with the R1 design choice stated in the test name or comment.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
