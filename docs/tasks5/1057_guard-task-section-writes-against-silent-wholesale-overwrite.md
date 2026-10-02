---
schema_version: 1
name: Guard task section writes against silent wholesale overwrite of populated sections
status: todo
template: issue
created_at: 2026-10-02T21:08:29.909Z
updated_at: "2026-10-02T21:17:54.428Z"
feature_id: D63

---

## 1057. Guard task section writes against silent wholesale overwrite of populated sections

### Background

Session defect observed 2026-10-02 while driving task 1052 through task-pipeline: the review-state write `spur task update 1052 --section Review --from-file …` replaced the Review section WHOLESALE, silently destroying the task's pre-existing "Consolidation disposition — 2026-10-02" P1–P4 findings table (consolidation provenance for 1051–1056). The loss surfaced indirectly: the testing→done L3 gate then failed ("Review must contain a populated P1–P4 priority findings table"), costing a diagnose cycle plus a manual git-restore-and-merge repair before the done transition passed. The replace-on-write contract is documented behavior; the defect is that no bounded mechanism exists to extend a populated section without destroying it, and no warning fires when the target section is non-empty.

Recurrence surface is broad: every pipeline review/record write targets `--section Review`, and consolidation-heavy tasks (1051–1056, D63) carry disposition tables exactly there. Feature derivation: daily-workflow adoption friction (D63).

### Requirements

- R1: Provide a bounded way to extend a populated section without destroying it. Smallest sufficient design — a `--append` flag on `spur task update --section` (appends the body after the existing section content), or a non-empty-overwrite guard that refuses a wholesale replace of a non-empty section unless `--force` is passed; pick one and state why in Design. Recommendation: `--append` — it is additive, back-compat, and matches how pipeline states actually want to add review/verify narratives.
- R2: Default behavior is unchanged: `--section` without the new flag keeps today's byte-exact wholesale-replace semantics (the pipeline depends on it); existing task-update tests pass unmodified.
- R3: All writes stay CLI-gated (`spur task update`); no new direct file-write path is introduced, and section-name case sensitivity (canonical heading names) is preserved.

### Acceptance Criteria

- [ ] AC1: The chosen mechanism (R1) is implemented and tested: appending to (or force-replacing) a populated Review section preserves the pre-existing P1–P4 table content per the chosen semantics — test in the task-update/planning-write-service suite.
- [ ] AC2: Default wholesale-replace semantics are unchanged — existing task-update tests pass without modification.
- [ ] AC3: `spur task update --help` documents the new flag/guard, including the case-sensitive section-name contract.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-02T21:17:32.133Z

- Q: Why not default-append everything? A: Breaks R2 and every pipeline state write (review/record intentionally replace per hop). Replace stays default; append is opt-in.
- Q: Why not restore-and-append automatically on conflict? A: Nothing tracks "the previous body was intentional" — git is the restore mechanism today; automating it needs history semantics this task must not invent.
- Q: Does append interact with `--provenance-bypass`/`--force-done`? A: No — orthogonal (status transitions vs section writes); only the `--assignee`-style exclusions apply.

### Design

#### Code anatomy

- CLI: `apps/cli/src/commands/task.ts` — `task update` help block (:424-431) documents the current contract verbatim: "Sections replace, with one exception: `--section "Q&A"` APPENDS a timestamped `#### Q&A entry — <ISO>` block. Start the body with `<!-- qa:replace -->` to replace it wholesale." Shared options (`SHARED_OPTIONS.section/fromFile`) gate `--section`/`--from-file` (:432-434); `--section` + `--assignee` are mutually exclusive (:488), `--from-file` required with `--section` (:523). Valid section names: `spur task sections <wbs> list`.
- Service: `packages/app/src/services/planning-write-service.ts` — `updateSection(ref, sectionName, body)` (:305-307) → `executePipeline({kind:'updateSection', sectionName, sectionBody})` → `doc.ln(mutation.sectionName, body)` REPLACES the heading body (:486-490 emits PlanningSectionMutationData `{kind:'section', name}`). The Q&A exception lives at :582-632 (task **0701 R7a**, `appendQaEntry`): append = `doc.replaceSection('Q&A', existing + '\n' + entry)` with entry = `#### Q&A entry — <ISO>\n\n<body>`; body starting with `<!-- qa:replace -->` (:624-627) switches to wholesale replace.
- Consumer that made the defect visible: `packages/app/src/workflow/lifecycle-adapter.ts:391-403` — the testing→done L3 gate (task 0278 R1) reads Review post-write and fails with "Review must contain a populated … P1–P4 … table" when the table is gone. This gate is a backstop, not a guard: it fired AFTER the data was already destroyed.
- Case sensitivity: section names are canonical and case-sensitive (`spur task update --section Review`, not `review` — hit in-session; the write then targets/creates the wrong heading). `MarkdownDocument` validates names (see :302 doc comment).

#### Chosen design (resolves R1): generalize the 0701 R7a append pattern

Add `--append` to `spur task update --section`. Semantics: when the target section EXISTS, new body = existing body + single blank line + new body (no timestamp wrapper, no entry heading — pipeline Review narratives are state, not history entries); when it does NOT exist, create it (identical to replace). Implemented beside `appendQaEntry` (:582-632) reusing `MarkdownDocument.getSection/replaceSection`; Q&A's default-append behavior stays UNTOUCHED (0701 R7a contract).

Rejected alternative (guard/`--force`): a refusal on non-empty replace adds friction to every intentional pipeline write (review/record states replace on each hop by design) and converts one footgun into a flag-hunting loop; `--append` is opt-in, additive, and matches how the 1052 repair manually reconstructed the section (restore-from-git + append).

#### Governance note (non-negotiable before implementation)

Adding a public flag to an existing verb is a public-surface change — per AGENTS.md it requires explicit operator consent with design context. This task does NOT grant that consent; the refine/design stage must present the flag (exact name, semantics above) and get it before coding. If consent is declined, fall back to scoping the Q&A-style exception to `Review` (an internal behavior change on an existing section, still design-reviewed).

#### Explicitly out of scope

- Structured/semantic section merging or conflict resolution (append is textual).
- Changing default replace semantics for ANY section (R2; pipelines depend on it).
- `spur feature update` section writes (note as follow-on only if the shared `MarkdownDocument` API makes it free).
- Proof-digest interaction: Requirements/AC ticks stay digest-neutral (0958 canonicalization); appended Review narratives are digest-irrelevant (Review ∉ proof-input sections). Appends to proof-input sections (Background/Requirements/…) legitimately move the digest — do not add neutrality logic for them.

#### Edge cases the implementation must specify

1. Append target is the LAST section (body extends to EOF) — trailing newline handling.
2. Existing body empty or whitespace-only → no stray double blank line (normalize to one separator).
3. Consecutive appends accumulate in call order; no dedupe, no timestamp.
4. Append to Q&A: `--append` on Q&A must not double-append (flag with the special-cased section — state the precedence: explicit `--append` on Q&A uses the generic append, NOT the timestamped entry wrapper, unless body starts with `<!-- qa:replace -->` which still forces replace).

### Plan

1. Consent gate FIRST (Design § governance): present the `--append` design to the operator; do not code before consent (or the agreed fallback scope).
2. RED: in the planning-write-service test suite, write failing tests for the Design § edge cases (1)-(4) plus the happy path: append to a populated Review section containing a P1–P4 table → table preserved verbatim, new body appended after one blank line.
3. Implement the generic append path in `planning-write-service.ts` beside `appendQaEntry` (:582-632), threading `append?: boolean` through `updateSection` (:305) → `executePipeline` mutation → `doc.replaceSection` composition.
4. Thread the flag through `apps/cli/src/commands/task.ts` (option + validation: `--append` requires `--section`; conflicts with `--assignee` same as `--section`; update the :424-431 help block).
5. GREEN: focused suites; confirm the Q&A 0701 R7a tests pass UNMODIFIED (default behavior unchanged).
6. T3 surface docs: if this lands in `docs/04_DESIGN.md`'s surface index, same-commit satellite update per AGENTS.md; `sp:doc-evolve` sync-check when unsure.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- Focused service: `(cd packages/app && bun test tests/services/planning-write-service.test.ts)` — new append cases; existing replace + Q&A 0701 R7a cases unmodified.
- CLI: `(cd apps/cli && bun test tests/commands/task-update*.test.ts)` (locate exact file with `rg -l "task update" apps/cli/tests/`) — flag validation, help text snapshot if one exists.
- Gate backstop check: a test proving the L3 gate (`packages/app/src/workflow/lifecycle-adapter.ts:391-403`) still accepts an APPENDED Review section whose P1–P4 table survived (append must not corrupt table syntax).
- Repo gate at done: `bun run spur-check` per pipeline; feature close adds `spur-check-feature` (ADR-119).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Defect session: 2026-10-02, task 1052 (feature D63), run 782ba320-0fef-4424-a00d-437b203d642c — review-state write destroyed the "Consolidation disposition — 2026-10-02" table; L3 denial cost a diagnose cycle + git-restore repair before done passed.
- Precedent mechanism: task 0701 R7a — `appendQaEntry`, `packages/app/src/services/planning-write-service.ts:582-632`, `<!-- qa:replace -->` marker, documented in `apps/cli/src/commands/task.ts:424-431`.
- Gate consumer: `packages/app/src/workflow/lifecycle-adapter.ts:391-403` (0278 R1, testing→done Review L3).
- Contract consumers: task-pipeline v3 (`config/workflows/task-pipeline.yaml`) review/record states write `--section Review` on every run; consolidation-heavy tasks 1051-1056 (D63).
- Help/section discovery: `spur task sections <wbs> list` (valid canonical names).

### History
