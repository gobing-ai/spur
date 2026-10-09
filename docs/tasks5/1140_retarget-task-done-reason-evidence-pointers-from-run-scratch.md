---
schema_version: 1
name: Retarget task done_reason evidence pointers from run scratch to durable evidence
status: todo
template: standard
created_at: 2026-10-09T16:43:56.946Z
updated_at: "2026-10-09T16:44:17.881Z"

ac_numbering: task-local
ac_altitude: task-local
---

## 1140. Retarget task done_reason evidence pointers from run scratch to durable evidence

### Background

ADR-131 (as amended 2026-10-09) states the consumer invariant for run scratch: `.spur/run/` may be
absent in any later run, so no tracked source file, document or task record may rely on it, and a
durable citation names `.spur/memory/evidence/`, `.spur/memory/runs/` or the tracked task Testing
section.

The corpus violates it in one bounded class. Seventeen task files record the volatile copy in the
`done_reason` frontmatter field, e.g.
`docs/tasks5/1046_emit-inline-pipeline-action-rows-so-run-close-needs-no-post-.md` reads
`done_reason: unforced close; PASS artifact at .spur/run/1046-verdict.json`. Seventy-one other task
files already name the durable owner, so the convention exists and the remainder is drift.

Measured at filing time (2026-10-09): all seventeen named tasks also have a canonical copy at
`.spur/memory/evidence/<wbs>-verdict.json`, and the scratch copies still exist locally. Nothing is
dangling yet. A scratch cleanup turns all seventeen into broken pointers, which is the failure the
amended ADR exists to prevent.

`spur task update` exposes no `done_reason` flag, so the pointer is not settable through the normal
update surface. `spur task migrate-anchors` already performs the same class of work on the corpus —
it qualifies in-repo evidence anchors — and carries the `--dry-run` and `--wbs` options a bounded
migration needs.

### Requirements

- [ ] R1. Every task whose `done_reason` names a run-scratch verdict path (`.spur/run/<wbs>-verdict.json` or an equivalent `.spur/run/` evidence file) is retargeted to the durable owner for that evidence, and only when the durable copy resolves. A pointer whose durable copy is absent is left byte-identical and reported as unresolved; no pointer is invented or synthesized.
- [ ] R2. The rewrite runs through the existing corpus surface `spur task migrate-anchors`, extended to qualify `done_reason` evidence pointers. `--dry-run` reports the complete change set without writing any file, and `--wbs <wbs>` scopes the pass to one task. No new public noun, verb or flag is introduced.
- [ ] R3. The pass is idempotent. A second invocation rewrites nothing and reports zero rewrites; a pointer that already names the durable owner is not touched, and its surrounding frontmatter is byte-identical afterwards.
- [ ] R4. Every byte outside the retargeted pointer value is preserved: other frontmatter fields, all sections, and all history entries. Prose sections that describe the scratch mechanism — including mentions of `.spur/run/` paths as runtime description — are never rewritten, because they document the mechanism rather than cite evidence.
- [ ] R5. `--json` emits a machine-readable report with one row per task: the wbs, the outcome (`rewritten`, `already-durable`, `durable-copy-missing`, `no-pointer`), and the old and new pointer values for rewrites. The human output names the same outcomes.

### Acceptance Criteria

```gherkin
Scenario: AC1 — dry-run reports the change set and writes nothing (req: R2, R5)
  Given a task corpus containing tasks whose done_reason names a run-scratch verdict path
  When `spur task migrate-anchors --dry-run --json` runs
  Then every such task appears in the report with outcome rewritten and its old/new pointer values
  And no task file's bytes change on disk

Scenario: AC2 — a resolvable pointer is retargeted to the durable owner (req: R1)
  Given a done task whose done_reason names `.spur/run/<wbs>-verdict.json`
  And `.spur/memory/evidence/<wbs>-verdict.json` exists with the canonical verdict bytes
  When the pass runs without --dry-run
  Then that task's done_reason names the durable evidence path
  And the named path resolves on disk

Scenario: AC3 — an unresolved pointer is reported and left alone (req: R1)
  Given a done task whose done_reason names a run-scratch path
  And no canonical copy exists under `.spur/memory/evidence/`
  When the pass runs
  Then the report carries outcome durable-copy-missing for that task
  And its done_reason is unchanged

Scenario: AC4 — a second run is a no-op (req: R3)
  Given a corpus already migrated by the pass
  When the pass runs again
  Then the report carries zero rewritten rows
  And every previously migrated pointer still names the durable owner

Scenario: AC5 — only the pointer value changes (req: R4)
  Given a task with a scratch done_reason plus a Testing section that describes `.spur/run/` outputs
  When the pass rewrites that task's pointer
  Then the diff for that file touches only the done_reason value
  And the Testing section bytes are identical
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T16:44:04.096Z

- **Why migrate instead of leaving the pointers?** The durable relocation already happened; these
  seventeen pointers name the copy that the amended ADR calls disposable. Leaving them converts a
  latent inconsistency into a broken reference at the first scratch cleanup, and the completion gate
  reads `done_reason` (F93), so a dangling pointer misreports where the certifying evidence lives.
- **Why require the durable copy rather than rewrite unconditionally?** Rewriting to a path that does
  not exist trades a volatile reference for a false one. Forty-nine of the corpus's done tasks could
  be touched by a looser matcher, so the resolution check keeps the pass countable and truthful.
- **Why not a new `task update` flag?** It would add a public flag for a single one-shot migration,
  and ADR-051 requires operator consent for public-surface growth. The existing verb already owns the
  operation.
- **Why is prose out of scope?** Six hundred and six tracked documents mention `.spur/run/`, most of
  them describing what the pipeline writes there. That is legitimate documentation of a runtime
  mechanism; a migration that rewrote it would destroy mechanism documentation. The invariant binds
  citations of record, not descriptions.
- **Deferred:** any change to the `cited-directory:` skip vocabulary, and the executable-source class
  under `.spur/run/` (a gitignored directory, so it is not a corpus concern).

### Design

**Surface.** Extend `spur task migrate-anchors` rather than add a verb or a flag. It already owns
"qualify in-repo evidence anchors to repo-relative paths" on the task corpus, it already carries
`--dry-run` and `--wbs`, and qualifying a `done_reason` pointer is the same operation on a different
field. No public-surface consent is required because the noun, verb and flag set are unchanged
(ADR-051). A new `spur task update --done-reason` flag was rejected as a public-surface addition
whose only caller would be this one migration.

**Classification.** Read the frontmatter `done_reason` string, extract a `.spur/run/<name>` evidence
path if one is present, and resolve the durable counterpart under `.spur/memory/evidence/` using the
existing evidence-root constant rather than a hand-built path. Rewrite only when the durable file
exists; otherwise report and preserve. Multiple pointers in one string are each considered.

**Invariants.** The write is byte-preserving outside the pointer value: parse the frontmatter, replace
the value, and leave every other byte of the file untouched — no reformatting, no section
normalization, no history append. The pass is idempotent because the matcher requires a `.spur/run/`
prefix, so a durable pointer never matches a second time. Historical prose sections are out of scope
by construction: only the frontmatter pointer field is read.

**Fallback behavior stated by the amended ADR.** An unresolved durable pointer is not an error to
repair by invention — the pass reports `durable-copy-missing` and stops. That keeps the migration
honest when a scratch artifact predates the durable relocation and has no canonical copy.

**Relationship to ADR-131's `cited-directory:` allowance.** The persist-out `cited-directory:` skip
vocabulary stays as compatibility for historical citations inside task bodies; this migration
retires the frontmatter class instead of extending that allowance.

**Impacted surfaces.** `packages/app` migrate-anchors service and its report types, the CLI verb's
options wiring, and the corpus files it rewrites. No schema, contract or artifact-shape change.

### Plan

1. Read the existing `migrate-anchors` service and its report shape; confirm where a second anchor
   class fits without duplicating the walk or the write path.
2. Add the `done_reason` pointer matcher and the durable resolution check, reusing the evidence-root
   constant and the existing frontmatter read/write seam.
3. Extend the report rows with the new outcomes and old/new pointer values.
4. Write the AC1–AC5 cases first against a fixture corpus of four tasks (resolvable pointer,
   unresolved pointer, already-durable pointer, pointer plus prose mention); they fail before the
   matcher exists.
5. Run the focused suite, then `spur task migrate-anchors --dry-run --json` over the real corpus and
   compare the reported set against the seventeen known tasks.
6. Apply the pass, re-run `--dry-run` to confirm zero rewrites, then `spur task check` over the
   affected tasks and the rule presets.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-09T16:44:17.881Z backlog → todo (system)

