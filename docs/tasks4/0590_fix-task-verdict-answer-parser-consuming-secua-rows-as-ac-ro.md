---
template: issue
schema_version: 1
name: "Fix task-verdict answer parser consuming SECUA rows as AC rows"
description: ""
status: todo
type: issue
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-18T17:17:41.364Z"
updated_at: "2026-08-18T17:39:06.490Z"
---

## 0590. Fix task-verdict answer parser consuming SECUA rows as AC rows

### Background
Found during task 0587's verify run (2026-08-18). `extractAcceptanceCriteria` in
`packages/app/src/services/task-verdict.ts` sets an `inTable` flag when it meets the AC header row and
then consumes **every** subsequent 4-cell table row in the answer file — it has no section boundary
and never resets on a heading.

The verify answer-file schema documented in `plugins/sp/skills/code-verification/SKILL.md`
(§ Answer-File Schema Contract) places a 4-column SECUA table directly after the AC table:

```
| Priority | Dimension | Location | Finding |
```

So a schema-conformant answer file always yields a spurious failing check, e.g.

```
ac-row-dropped: 6 AC row(s) could not be parsed and were omitted from the verdict:
Priority (unrecognised status "Dimension"); P1 (unrecognised status "Correctness"); …
```

The two contracts contradict each other: the skill's documented shape cannot be parsed cleanly by the
parser that consumes it. Reproduced on 0587's verdict this run — the AC rows themselves parsed
correctly, so the effect is a false `fail` check on every verdict artifact, not data loss.
### Requirements
- [ ] R1. Give `extractAcceptanceCriteria` a section boundary: stop consuming rows when a markdown
  heading (`^#{1,6}\s`) is met after the AC table opened, so the `### SECUA Review` table is never read
  as AC rows. Keep the existing tolerance for header-name variants and keep `dropped[]` reporting for
  rows that are genuinely malformed *inside* the AC table — the 0398 R6 rule ("never discard a row in
  silence") still holds.
- [ ] R2. Regression test in `packages/app/tests/services/task-verdict.test.ts`: an answer file
  following the documented schema (Verdict line → per-requirement table → AC table → SECUA table)
  parses all AC rows and produces **no** `ac-row-dropped` check; a malformed row inside the AC table
  still reports one.
### Acceptance Criteria
- [ ] AC1. `bun test packages/app/tests/services/task-verdict.test.ts` green, including the new schema-conformant fixture that asserts no `ac-row-dropped` check.
- [ ] AC2. Re-deriving a verdict from a schema-conformant answer file (`spur task verdict <wbs> --from-answer <file> --json`) emits no `ac-row-dropped` entry in `checks[]`.
- [ ] AC3. A row with an unrecognised status inside the AC table still appears in `ac-row-dropped` — the silence guard is not weakened.
### Q&A
- **Deferred by operator decision (2026-08-18): re-verify after the current codebase is released, then
  decide whether this is still needed.** The defect is confirmed on the current tree (a
  schema-conformant answer file emits `ac-row-dropped` naming the SECUA rows), but it is a false
  failing *check* inside the verdict artifact — the AC rows themselves parse correctly, so no verdict
  has ever been mis-derived by it. That makes it safe to hold.
- **How to re-verify when the time comes:** run any `/sp:dev-verify <wbs>` that produces an answer file
  following `plugins/sp/skills/code-verification/SKILL.md` § Answer-File Schema Contract, then check
  `checks[]` in `.spur/run/<wbs>-verdict.json` for an `ac-row-dropped` entry listing `Priority` /
  severity labels. Present ⇒ still needed. Absent ⇒ close this task.
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
