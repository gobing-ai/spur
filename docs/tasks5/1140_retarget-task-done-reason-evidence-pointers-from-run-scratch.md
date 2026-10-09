---
schema_version: 1
name: Retarget task done_reason evidence pointers from run scratch to durable evidence
status: todo
template: standard
created_at: 2026-10-09T16:43:56.946Z
updated_at: "2026-10-09T17:57:44.394Z"

ac_numbering: task-local
ac_altitude: task-local
feature_id: E71
priority: P2
estimate_hours: 3
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

**Refine corrections (2026-10-09)**

- "Seventeen task files" → `rg '^done_reason:.*\.spur/run/'` finds **22**:
  - 16 `.spur/run/<wbs>-verdict.json` and 1 `.spur/run/1086/verdict.json`. All 17 have a durable `.spur/memory/evidence/<wbs>-verdict.json`.
  - 3 legacy verdict pointers have no durable copy and no scratch copy: 0494, 0497, 0562. All three have a populated tracked Testing section.
  - 2 prose mentions of spike directories: 0490 and 0491 cite `.spur/run/049x-spike/`. These describe where a spike ran; they do not cite a verdict.
  - Resolution: the class is **verdict-evidence pointers**. Spike-dir prose is out of scope here and for 1141's rule.
- R1 "unresolved pointer left byte-identical" → that leaves 3 permanent violations, so 1141's rule could never go green. ADR-131 names the tracked Testing section as a durable owner, so the resolution is: retarget an unresolved verdict pointer to the tracked Testing section when that section is non-empty, and leave it unchanged (reported) only when Testing is empty too.
- R5 "outcome enum per row" → `migrate-anchors` already reports `fileReports[].doneReasons[{from,to}]` (1089 R3). Extend that shape (`kind`, `unresolved`) instead of adding a parallel report.
- Feature: none → **E71** (ADR-131 consumer invariant).

### Requirements

- [ ] R1. `spur task migrate-anchors` retargets a `done_reason` verdict pointer, matching `.spur/run/<wbs>-verdict.json` or `.spur/run/<wbs>/verdict.json` as a substring of the value, to `.spur/memory/evidence/<wbs>-verdict.json` when that file exists under the repo root. Only the matched path substring changes.
- [ ] R2. When no durable verdict exists but the task's tracked `Testing` section is non-empty, the pointer substring is replaced with `tracked Testing section (scratch verdict not retained)`. When both are absent, the value is left unchanged and the row is reported `unresolved`.
- [ ] R3. The report keeps the existing `fileReports[].doneReasons[{from,to}]` shape and adds `kind: 'absolute-path' | 'durable-evidence' | 'tracked-testing'`, plus `doneReasonUnresolved?: string` on the file report. `--dry-run` writes nothing. `--wbs` scopes to one task. No new noun, verb or flag.
- [ ] R4. Idempotent: a second run yields zero `doneReasons` rows. The existing absolute-path normalization (1089 R3) still applies first, so an absolute scratch pointer resolves in one pass.
- [ ] R5. Only the `done_reason` value changes. Sections, other frontmatter and History bytes are preserved. Prose `.spur/run/` mentions, including the 0490/0491 spike-dir pointers, are never touched.
- [ ] R6. The pass runs once on this repository. The resulting corpus diff (expected 20 rewrites, 0 unresolved) is committed with this task.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a scratch verdict pointer is retargeted to durable evidence (req: R1, R5)
  Given a done task whose done_reason is "unforced close; PASS artifact at .spur/run/1046-verdict.json"
  And .spur/memory/evidence/1046-verdict.json exists
  When `spur task migrate-anchors --wbs 1046` runs
  Then done_reason reads "unforced close; PASS artifact at .spur/memory/evidence/1046-verdict.json"
  And no other byte of the file changes

Scenario: AC2 — a subpath verdict pointer is normalized (req: R1)
  Given done_reason cites .spur/run/1086/verdict.json and .spur/memory/evidence/1086-verdict.json exists
  When the pass runs
  Then done_reason cites .spur/memory/evidence/1086-verdict.json

Scenario: AC3 — a pointer with no durable copy falls back to tracked Testing (req: R2)
  Given done_reason cites .spur/run/0562-verdict.json with no durable copy
  And the task's Testing section is non-empty
  When the pass runs
  Then the pointer substring reads "tracked Testing section (scratch verdict not retained)"
  And the row kind is tracked-testing

Scenario: AC4 — a pointer with neither owner is reported, not rewritten (req: R2, R3)
  Given done_reason cites a scratch verdict with no durable copy and an empty Testing section
  When `spur task migrate-anchors --json` runs
  Then the file report carries doneReasonUnresolved with the pointer
  And the file bytes are unchanged

Scenario: AC5 — dry-run, idempotency and prose safety on this repository (req: R3, R4, R5, R6)
  Given the repository corpus
  When `spur task migrate-anchors --dry-run --json` runs
  Then 20 doneReasons rows are reported and no file changes
  When the pass is applied and then run again
  Then the second run reports zero doneReasons rows
  And the 0490/0491 done_reason values are byte-identical
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

#### Q&A entry — 2026-10-09T17:57:38.592Z

- **Q: Are the 0490/0491 spike-directory mentions in scope?** A: No. They are historical prose about where a spike ran and cite no verdict. ADR-131 binds evidence citations; 1141's rule matches the same verdict-file class.
- **Q: Leave the 3 legacy pointers unchanged (original R1)?** A: No. Retarget them to the tracked Testing section, which ADR-131 names as a durable owner. Otherwise 1141's rule is permanently red.
- **Q: New outcome enum or extend the existing report?** A: Extend `doneReasons` with a `kind` field. The 1089 R3 shape already exists and is consumed by `apps/cli` human output.

### Design

`packages/app/src/services/anchor-qualifier.ts`:

- Rename nothing. Add `retargetScratchVerdict(reason: string, repoRoot: string, hasTesting: boolean, exists: (p) => boolean): {to: string; kind} | {unresolved: string} | null`. It uses `SCRATCH_VERDICT_RE = /\.spur\/run\/(\d{4})(?:-|\/)verdict\.json/`.
- In `qualifyAnchors` (@397–410), compose it after `normalizeDoneReason`: `const step1 = normalizeDoneReason(v) ?? v; const step2 = retargetScratchVerdict(step1, …)`. Write the final value once through the existing `opts.writeField` path. `hasTesting` is `(doc.getSection('Testing') ?? '').replace(/<!--[\s\S]*?-->/g,'').trim().length > 0`.
- `AnchorFileReport.doneReasons` items gain `kind`. Add `doneReasonUnresolved?: string`. CLI human output (`apps/cli/src/commands/task.ts` migrate-anchors) prints `done_reason: <from> → <to> (<kind>)` and `done_reason unresolved: <ptr>`.
- `existsSync` on `join(repoRoot, '.spur/memory/evidence', '<wbs>-verdict.json')` decides. The durable plane is gitignored, so this is a local fact. Running the pass on a fresh clone yields `tracked-testing` rather than `durable-evidence`; acceptable, because both are ADR-131 owners.

Same-change doc: the `spur task migrate-anchors` entry in `plugins/sp/skills/spur-cli/references/task.md` gains one line on done_reason retargeting.

### Plan

1. Failure modes first in `packages/app/tests/services/anchor-qualifier.test.ts`:
   - F1: a scratch verdict pointer is left as-is.
   - F2: the subpath form is missed.
   - F3: a durable-missing pointer is silently dropped or rewritten without Testing.
   - F4: the second run rewrites again.
   - F5: a prose `.spur/run/` mention in Testing is rewritten.
   - F6: an absolute plus scratch pointer needs two passes.
2. Implement `retargetScratchVerdict` and compose it in `qualifyAnchors`. Extend the report types. Update CLI human output.
3. `(cd packages/app && bun test tests/services/anchor-qualifier.test.ts)`; `(cd apps/cli && bun test tests/commands/task.test.ts)`.
4. On this repo: run `spur task migrate-anchors --dry-run --json`, assert 20 rows and 0 unresolved, then apply and run again to confirm 0 rows. Commit the corpus diff.
5. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- ADR-131 (2026-10-09 amendment). `packages/app/src/services/anchor-qualifier.ts:130-141,397-410` (1089 R3 precedent).
- Blocks 1141 (rule must be green on the migrated corpus).

### History

- 2026-10-09T16:44:17.881Z backlog → todo (system)

