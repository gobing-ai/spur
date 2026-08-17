---
template: feature-impl
schema_version: 1
name: "Anchor integrity: qualification migration, then subject matching"
description: ""
status: todo
type: task
profile: standard
feature_id: F91
parent_wbs: null
priority: P1
tags: ["corpus", "migration"]
dependencies: ["0582", "0584"]
ac_numbering: task-local
created_at: "2026-08-17T22:18:51.247Z"
updated_at: "2026-08-17T23:08:29.644Z"
---

## 0583. Anchor integrity: qualification migration, then subject matching

### Background
Two halves of one object: the evidence anchor. One half repairs the historical population, the other
stops it recurring — and the repair must land first, or the new rule fires on 213 tasks at once.

**The population.** Of 851 `L4.stale-line-anchor` warnings measured 2026-08-17, **810 cite an
in-repo file written with an incomplete path**: 726 bare filenames whose basename resolves to
exactly one repository path (`` `Badge.tsx:42` ``), and 84 wrong-prefix paths whose basename
likewise resolves. A further 178 are bare filenames whose basename is ambiguous. These are
mechanical — a unique basename determines the repo-relative path — and `spur task migrate` (feature
F6) already owns the idempotent normalization pass with its M1–M8 rules and dry-run contract, so
this is one more rule in that tool, not a new one.

**The silent half.** `checkLineAnchors` documents its own limit at
`packages/app/src/services/task-check.ts:1026`: "Subject-name matching (line content names the
R-item) stays an agent re-verify responsibility — this gate is existence + bounds only." That leaves
the *dangerous* case ungated. An anchor whose file grew — because a **later** task edited it — still
resolves and still passes bounds, but now points at unrelated code. It reads as verified evidence
and is not. Measured on feature E5: tasks 0578–0581 grew five shared files, and 18 anchors in tasks
0553/0554/0555 drifted 40–240 lines onto unrelated code (`artifact.ts:136` → a comment belonging to
another task; `history-service.ts:284` → `runJsonlImport`). `spur task check --strict-core` reported
**0 warnings** on all three. The gate flagged only the harmless class and certified the harmful one.

The skill already states the rule (`sp:code-verification` Step 4, anti-stale-citation); nothing
enforces it.
### Requirements
- [ ] **R1.** A qualification pass rewrites an anchor whose basename resolves to exactly **one** tracked repository path into the repo-relative form; `--dry-run` produces the full old→new report and modifies nothing, and a second apply changes zero files. Measurable: the 810 qualifiable citations are rewritten, and re-running reports zero changes.
- [ ] **R2.** An ambiguous basename is **reported, never guessed** — left for an author, with all candidate paths named. Measurable: the 178 ambiguous citations appear in the report and are unmodified on disk.
- [ ] **R3.** The pass rewrites the citation **path only**, never line numbers. Measurable: a test asserts a qualified citation keeps its original line range byte-for-byte.
- [ ] **R4.** An anchor whose cited lines do not name the subject of the requirement or AC row citing them is reported as `L4.anchor-subject-mismatch`, with a message naming what was expected and what the cited lines actually contain. Measurable: the 18 known E5 drift cases (tasks 0553/0554/0555 before their 2026-08-17 repair) are reported by the rule.
- [ ] **R5.** Subject matching tolerates ordinary wording drift — a symbol, identifier, or heading naming the requirement's noun counts. Measurable: a citation to a test whose name paraphrases the requirement does not report.
- [ ] **R6.** `L4.anchor-subject-mismatch` ships at **warning** severity and is promoted to **error** only after R1's pass has landed and the residue is reconciled into the warning baseline. Measurable: `spur task check --corpus` is green at both severities in sequence.

**Out of scope / non-goals:** the external-evidence citation form and the AC-altitude field (task
0584); the warning-side baseline mechanism itself (task 0582); the 178 ambiguous citations, which
need an author's judgment rather than a migration; feature-file citations.
### Acceptance Criteria
```gherkin
Scenario: R4 — In-repo anchors are qualified by a reviewable migration
  Given a task citing a bare filename that resolves to exactly one repository path
  When the anchor-qualification migration runs with --dry-run
  Then the full old-to-new report is produced and no file is modified
  And applying it rewrites the citation to the repo-relative path

Scenario: R5 — An anchor must name its requirement's subject
  Given an anchor whose line resolves but whose content does not name the cited requirement
  When spur task check runs
  Then the anchor is reported
  And the finding is a warning until the R4 migration has landed, an error after
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Order within this task is the whole risk and is **frozen**: qualify (R1–R3) → reconcile → subject-match
as warning (R4–R5) → promote to error (R6). 213 tasks carry stale anchors today, so landing subject
matching as an error first is a flag day, and landing it before qualification means it fires on paths
that do not even resolve. This is the ADR-058 shape and the operator's 2026-08-17 ruling.

**The migration is NOT a new M-rule.** `packages/app/src/services/corpus-migrator.ts:11-12` states the
invariant explicitly: *"Body sections are **never** rewritten — M-rules touch frontmatter +
append-only History only."* Anchor citations live in `## Testing` / `## Solution` **bodies**, so
adding an M-rule would break the migrator's own contract. Frozen approach instead: a distinct
qualification pass that computes each new body and writes it through the sanctioned CLI write path,
`PlanningWriteService.updateSection` (`packages/app/src/services/planning-write-service.ts:272`) —
the same path `spur task update --section` uses. Reuse the migrator's **dry-run report shape and
idempotency contract**; do not reuse its transform pipeline.

**Qualification index** comes from `git ls-files`, so untracked and gitignored files can never be a
target — a gitignored `.spur/run/**` artifact is external evidence (task 0584's form), not a
qualification candidate.

**Measured population (verified against the current tree, 2026-08-17):** 847 `L4.stale-line-anchor`
findings across 213 tasks. Of the unresolvable citations, **726** are bare filenames whose basename
resolves to exactly one tracked path and **84** are wrong-prefix paths whose basename likewise
resolves — 810 qualifiable. **178** are ambiguous basenames (several tracked paths). **244** are
genuinely external and belong to 0584's form, not to this migration.

**Line numbers stay out of scope for the migration (R3).** A qualified path with a stale line is
still stale; subject matching is what catches that. Rewriting lines here would mean guessing what the
author meant — the exact failure this feature exists to end.

**Subject extraction (R4).** The R-item / AC row already names its noun. Prefer matching identifiers
and symbol names over free text: a citation to `createDefaultRegistry` matches because the cited lines
contain that identifier, not because they score high on token overlap. Bound the read to the cited
range plus a small window; never re-read whole files per anchor (847 findings × full-file reads is the
obvious performance trap).

**Frozen names.** New finding code `L4.anchor-subject-mismatch` in
`packages/config/src/finding-codes.ts` (alongside `L4_STALE_LINE_ANCHOR: 'L4.stale-line-anchor'` at
`packages/config/src/finding-codes.ts:123`). Severity is config-driven through the existing F9
severity-override map — the promotion in R6 is a severity change, not a second code.

**Anti-patterns — do not implement.** Do not resolve ambiguity by picking the shortest path or the
most recently modified file. Do not touch anchors that already resolve. Do not extend the migration to
feature files here. Do not fail a row for a citation to a test whose name paraphrases the requirement.
Do not add an M-rule that rewrites bodies.

**File targets.** New qualification pass alongside `packages/app/src/services/corpus-migrator.ts`
(reusing its report shape, not its transform pipeline); writes via
`packages/app/src/services/planning-write-service.ts:272` (`updateSection`); subject matching in
`packages/app/src/services/task-check.ts` (`checkLineAnchors`, ~:1029); new code in
`packages/config/src/finding-codes.ts`; verb wiring in `apps/cli/src/commands/task.ts`; surface doc
`docs/04_DESIGN.md` §7.1.

**Cross-task.** **Assumes from 0582:** the warning-side two-sided baseline exists, so R4's residue has
somewhere to be reconciled. **Assumes from 0584:** external citations are already classified as
external, or all 244 become false positives the moment subject matching runs. **Leaves for
dependents:** none — this is the feature's terminal task.
### Plan
- [ ] Confirm 0582's warning baseline and 0584's external classification have landed (R4, R6)
- [ ] Build the tracked-basename index from `git ls-files`; implement unique-basename qualification via `updateSection`, not an M-rule (R1, R3)
- [ ] Report ambiguous candidates with all paths named, unmodified; verify idempotency on a second apply (R2, R1)
- [ ] Run the pass with `--dry-run`, hand the report to the operator, apply after review (R1)
- [ ] Add `L4.anchor-subject-mismatch`; extract the citing row's subject alongside each anchor (R4)
- [ ] Match cited content identifier-first with a bounded read window; assert the 18 E5 drift cases report (R4, R5)
- [ ] Reconcile the residue into the warning baseline at warning severity (R6)
- [ ] Promote to error, confirm `corpus-check` green; `bun run lint` / `test` / `build` (R6)
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **ADR-062** — Corpus Gates Verify Evidence Content, and Every Severity Is Ratcheted (`docs/00_ADR.md`) — the decision record for this feature.
- **ADR-050** — the two-sided error baseline this work extends.
- **ADR-058** — tracked transition shims: the warning-first-then-tighten precedent and the two-sided manifest shape.
- **ADR-063** — top-level feature-node consent (why this feature lives at F91, not a root letter).
- **Feature F91** — `docs/features/F91_*.md`; parent **F9** owns `checkAcCoverage`, the stable finding codes, and the severity-override map this work builds on.
- **Origin audit** — the 2026-08-17 E5 re-audit (`/sp:dev-verifyall --feature E5 --force --fix all`) that surfaced all four root causes; tasks 0553/0554/0555/0564 carry the repaired citations.
### History
