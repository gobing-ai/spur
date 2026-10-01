---
schema_version: 1
name: "ADR-130: dated amendment for spur-bin.ts facade accuracy note"
status: wip
template: feature-impl
created_at: 2026-10-01T00:47:12.874Z
updated_at: "2026-10-01T01:10:14.799Z"
feature_id: A9

ac_numbering: task-local
ac_altitude: task-local
---

## 1035. ADR-130: dated amendment for spur-bin.ts facade accuracy note

### Background

Captured from the creation title: "ADR-130: dated amendment for spur-bin.ts facade accuracy note".

### Requirements

- [ ] R1. `docs/00_ADR.md` ADR-130 gains one dated amendment line recording that `plugins/sp/lib` also holds the hand-written shared `spur-bin.ts` spur-CLI invocation helper (adopted by task 1019), widening the Decision's "`env.ts` and generated bundles" enumeration. The note dropped by the 2b10712c9 merge is restored in this form.
- [ ] R2. ADR-130's historical lines (title, Status, Decision, Why, Alternatives, Consequence, Retains, Detail) stay byte-identical; only `version`/`updated_at` frontmatter and the appended amendment line change in `docs/00_ADR.md`.
- [ ] R3. `repo-wide-tests/adr-supersession.test.ts` (e) admits ADR-130 to its amended set (same precedent as 0911/ADR-123), so the uncommitted diff passes and every other ADR stays frozen.

Out of scope: rewording the Decision line in place; the satellite `docs/design/harness-surface-governance.md:92` (already carries the spur-bin.ts fact); any code change.

### Acceptance Criteria

- [ ] AC1 — ADR-130 carries the dated spur-bin.ts amendment (req: R1)
  `rg -n "Amendment \(2026-09-30 · task 1035\)" docs/00_ADR.md` hits one line inside the ADR-130 block, naming `spur-bin.ts`.
- [ ] AC2 — No historical ADR text is rewritten (req: R2, R3)
  `git diff --unified=0 HEAD -- docs/00_ADR.md` removes only `version:`/`updated_at:` lines; `bun test repo-wide-tests/adr-supersession.test.ts` exits 0 with the diff uncommitted.
- [ ] AC3 — Feature gate stays green (req: R3)
  `bun run spur-check-feature` exits 0 (sandbox-blocked sub-checks reported separately).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

ADR-130's Decision text omits that the spur binary is a thin facade (spur-bin.ts) delegating into apps/cli; a post-merge reader of 00_ADR.md alone can misread where lifecycle logic lives. Constitution forbids in-place edits of historical ADR lines, so the correction lands as a dated amendment entry - the sanctioned change class. Dated-amendment detail style has precedent (docs/00_ADR.md:1186).

Content: one dated sentence under ADR-130 stating the facade fact with the code path cited. Fact-check the exact file name/location and delegation target against the tree before writing.

### Plan

1. Fact-check: locate the facade file (rg spur-bin / package.json bin mapping) and confirm what it delegates to.
2. Read precedent: rg -n "amendment" docs/00_ADR.md; match the established dated-entry format.
3. Append the dated amendment entry under ADR-130 - additions only; zero modification of historical lines.
4. Gate: bun run spur-check-feature once (adr-supersession is the critical check). Commit docs(sp).
5. Blocked on operator authorization: this task executes only on Robin's explicit go; the task record is the authorization trail.

### Solution

- Single file change: docs/00_ADR.md, ADR-130 section, dated amendment entry (pure addition).
- Facade facts to cite (verified 2026-09-30): facade file plugins/sp/lib/spur-bin.ts; bin mapping apps/cli/package.json:23.
- Draft entry: "2026-09-30 - Accuracy note: the spur binary is a facade (plugins/sp/lib/spur-bin.ts, wired via apps/cli/package.json:23) delegating to apps/cli; lifecycle logic remains in packages/app per this ADR's layering. Added after batch runall-A9-485e."
- Format precedent: docs/00_ADR.md:1186. No other ADR sections touched; no renumbering; adr-supersession must stay green.

### Testing

- bun run spur-check-feature (once) - adr-supersession green is the acceptance gate.
- git diff docs/00_ADR.md shows additions only (git diff --stat + manual scan).

### Review

- git diff on 00_ADR.md = pure addition; dated; placed per precedent format.
- Facade claim matches code (file exists; delegation target correct).
- No duplicate of an existing note; no historical line modified.

### References

- docs/00_ADR.md (ADR-130; precedent line 1186); adr-supersession rule; constitution ADR governance.
- Evidence: wrap fdf0a62b4 dropped its ADR-130 edit mid-merge 2026-09-30 (17:15-17:21) rather than amend in place; this task re-lands it properly.
- Authorization: Robin's go (task = authorization record).

### History

- 2026-10-01T00:50:19.482Z backlog → todo (system)
- 2026-10-01T00:50:19.755Z todo → wip (system)

