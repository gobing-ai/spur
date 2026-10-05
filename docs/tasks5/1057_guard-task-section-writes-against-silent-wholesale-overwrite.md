---
schema_version: 1
name: Guard task section writes against silent wholesale overwrite of populated sections
status: done
template: issue
created_at: 2026-10-02T21:08:29.909Z
updated_at: "2026-10-05T18:22:32.263Z"
feature_id: D63

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1057-verdict.json
---

## 1057. Guard task section writes against silent wholesale overwrite of populated sections

### Background

Session defect observed 2026-10-02 while driving task 1052 through task-pipeline: the review-state write `spur task update 1052 --section Review --from-file …` replaced the Review section WHOLESALE, silently destroying the task's pre-existing "Consolidation disposition — 2026-10-02" P1–P4 findings table (consolidation provenance for 1051–1056). The loss surfaced indirectly: the testing→done L3 gate then failed ("Review must contain a populated P1–P4 priority findings table"), costing a diagnose cycle plus a manual git-restore-and-merge repair before the done transition passed. The replace-on-write contract is documented behavior; the defect is that no bounded mechanism exists to extend a populated section without destroying it, and no warning fires when the target section is non-empty.

Recurrence surface is broad: every pipeline review/record write targets `--section Review`, and consolidation-heavy tasks (1051–1056, D63) carry disposition tables exactly there. Feature derivation: daily-workflow adoption friction (D63).

### Requirements

- [x] R1. Provide a bounded way to extend a populated section without destroying it. Smallest sufficient design — a `--append` flag on `spur task update --section` (appends the body after the existing section content), or a non-empty-overwrite guard that refuses a wholesale replace of a non-empty section unless `--force` is passed; pick one and state why in Design. Recommendation: `--append` — it is additive, back-compat, and matches how pipeline states actually want to add review/verify narratives.
- [x] R2. Default behavior is unchanged: `--section` without the new flag keeps today's byte-exact wholesale-replace semantics (the pipeline depends on it); existing task-update tests pass unmodified.
- [x] R3. All writes stay CLI-gated (`spur task update`); no new direct file-write path is introduced, and section-name case sensitivity (canonical heading names) is preserved.

### Acceptance Criteria

- [x] AC1: The chosen mechanism (R1) is implemented and tested: appending to (or force-replacing) a populated Review section preserves the pre-existing P1–P4 table content per the chosen semantics — test in the task-update/planning-write-service suite. (req: R1)
- [x] AC2: Default wholesale-replace semantics are unchanged — existing task-update tests pass without modification. (req: R2)
- [x] AC3: `spur task update --help` documents the new flag/guard, including the case-sensitive section-name contract. (req: R3)

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

`PlanningWriteService.updateSection` (`packages/app/src/services/planning-write-service.ts:305`) forwarded every `--section` write to `doc.replaceSection(...)` unconditionally inside `applyMutation` — `MarkdownDocument.replaceSection` swaps the heading body wholesale and exposes no extend path. The only non-destroying section write was the Q&A-specific `appendQaEntry` (task 0701 R7a), so extending a populated Review/Testing section required authoring the full desired state in one file; a partial body silently dropped the pre-existing content (the 1052 defect), and the testing→done Review L3 gate (`packages/app/src/workflow/lifecycle-adapter.ts:391`) only detected the loss after the data was already gone. Reproduced by RED tests pre-fix: a default-path `updateSection` onto a seeded Review body destroys prior content (retained as the AC2 pin test).

### Solution

Extend path for populated sections, threaded CLI → service → write pipeline (file:line map @ `071053a2c`):

- `packages/app/src/services/planning-write-service.ts`
  - `MutationDescriptor` gains `append?: boolean`; `updateSection(ref, sectionName, body, append = false)` (`:305-312`) forwards it into the pipeline.
  - `applyMutation` precedence branch (`:596-607`): body starting with `<!-- qa:replace -->` on `Q&A` → wholesale replace (unchanged); else explicit `append` → `appendSectionBody`; else default → `doc.replaceSection` wholesale (unchanged behavior for all existing callers — 30+ call sites pass ≤3 args).
  - New `appendSectionBody` helper (`:663-676`): empty existing → `body.trim() + '\n'`; else `existing.trimEnd() + '\n\n' + body.trim() + '\n'` (one blank line separator; edge-2 normalization). Merged body re-enters `replaceSection`, keeping `assertFenceBalance`/`stripSameLevelHeadings` protection.
  - `QA_REPLACE_MARKER` hoisted to module scope (shared by Q&A path and precedence branch).
- `packages/app/src/services/task-service.ts` — `updateSection(wbs, sectionName, sourceFile, append = false)` (`:1230-1244`) reads the file and forwards `append` (4th param, back-compat).
- `apps/cli/src/commands/task.ts` — `--append` option (`:440-444`); validation `--append` requires `--section` → exit 2 before the `--assignee` branch (`:488-492`); threads `options.append === true` (`:543-549`); help text states the extend contract and case-sensitivity.
- Docs (same commit, T3): `docs/help/cmd_task.md` flag row + replace-vs-append note + example; `docs/help2/task.md`; `plugins/sp/skills/spur-cli/references/tasks/section-editing.md` + `verbs.md`.
- Tests: 7 service cases (extend/replace pin/empty-create/consecutive appends/Q&A precedence both ways), 2 CLI cases (`--append` happy path; missing `--section` exit 2), 1 gate backstop (appended Review shape passes the testing→done L3 gate, `packages/app/tests/workflow/lifecycle-adapter.test.ts:321-357`). Feature server routes untouched — CLI-task-only scope.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | --append extend path: planning-write-service.ts updateSection/applyMutation + QA_REPLACE_MARKER precedence (071053a2c); extend + precedence tests in planning-write-service.test.ts |
| R2 | MET | Default-replace pin test passes; pre-existing CLI (198) and service suites unmodified and green |
| R3 | MET | No new direct write path; --append requires --section exits 2; help/docs/skill refs updated; case-sensitive canonical sections preserved |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | planning-write-service extend test preserves populated Review content; lifecycle gate-backstop test at packages/app/tests/workflow/lifecycle-adapter.test.ts:321-357 |
| AC2 | MET | test | Default replace semantics unchanged — bun run spur-check PASS (9765 tests / 566 files, worktree) |
| AC3 | MET | docs | docs/help/cmd_task.md, docs/help2/task.md, plugins/sp/skills/spur-cli/references/tasks/section-editing.md document --append and case sensitivity |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

- Residual gap (out of scope, pre-existing): `feature update`/server routes do not expose append mode; engine-side governance guard for wholesale feature-section writes remains future feature work (R1 chose CLI-task scope).

### Review

**Verdict: APPROVE** — fresh-context reviewer (run c0576110-5813-4000-8973-c45f54b4639e), reviewed `81347ca5c`; post-review P4 nits fixed in `071053a2c` (comment/wording only, no logic change). Design (`--append`, generalizing 0701 R7a) sits at the correct layer; default replace semantics untouched; all four spec edge cases handled. `appendSectionBody` normalizes exactly per design; Q&A precedence (`qa:replace` marker → explicit generic append → default timestamped entry) verified; merged bodies still pass through `assertFenceBalance`/`stripSameLevelHeadings` via `replaceSection`, so append cannot corrupt structure. All 30+ existing `updateSection` callers use ≤3 args → zero behavior change. Feature surface correctly out of scope.

#### Traceability

| Requirement | Evidence | Status |
|---|---|---|
| R1 append path | `planning-write-service.ts:309-312,596-607,663-676`; `task.ts:440-444,488-492,543-549` | ok |
| R2 replace default unchanged | `planning-write-service.ts:606`; diff adds tests only; Q&A default-append identical; pin test `planning-write-service.test.ts:275-284` | ok |
| R3 single write path | All writes via `executePipeline`; case sensitivity preserved (`markdown-document.ts:429-433`) | ok |
| AC1 extend preserves content | `planning-write-service.test.ts:252-272`; CLI `task.test.ts:677-714` | ok |
| AC2 replace default | `planning-write-service.test.ts:275-284`; existing Q&A/replace tests unmodified | ok |
| AC3 docs/help parity | `task.ts:440-444`; `cmd_task.md`; `help2/task.md`; `section-editing.md`; `verbs.md` | ok |
| Edge 1 (EOF trailing newline) | via `appendSectionBody` trailing `\n` + `replaceSection` EOF handling; no dedicated test (P4) | ok |
| Edge 2 empty body create | `planning-write-service.test.ts:286-306` | ok |
| Edge 3 consecutive appends | `planning-write-service.test.ts:308-319` | ok |
| Edge 4 Q&A precedence | `planning-write-service.test.ts:321-355` | ok |
| Gate backstop (Testing §3) | `packages/app/tests/workflow/lifecycle-adapter.test.ts:321-357` | ok |

#### Findings (P1–P4)

| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | — | — | No P1–P3 findings |
| P4 | correctness (cosmetic) | `planning-write-service.ts:301` | Stray `n` in new JSDoc — **fixed in `071053a2c`** |
| P4 | correctness/usability | `task-service.ts:1220-1244` | Fragment-level validation (Solution citation hard reject, AC-subset warnings) evaluates the appended fragment, not the merged body — restrictive/safe direction; pipeline writes never append to these sections. Documented, no code change per reviewer. |
| P4 | usability (docs) | `task.ts:441`, `cmd_task.md:130`, `section-editing.md:48` | "existing bytes" wording not byte-exact (whitespace trimmed) — **reworded in `071053a2c`** |
| P4 | test coverage | `planning-write-service.test.ts` | Edge 1 (last-section EOF) untested; behavior deterministic through `replaceSection` — accepted, noted for future suite work |

#### Post-review verification (worktree, `071053a2c`)

- `planning-write-service.test.ts` + `lifecycle-adapter.test.ts`: 79 pass / 0 fail
- `task.test.ts` (CLI): 198 pass / 0 fail
- `bun run spur-check` @ `81347ca5c`: PASS exit 0 (lint, rules, 9765 tests / 566 files) — P4 deltas since are comment/wording only

### References

- Defect session: 2026-10-02, task 1052 (feature D63), run 782ba320-0fef-4424-a00d-437b203d642c — review-state write destroyed the "Consolidation disposition — 2026-10-02" table; L3 denial cost a diagnose cycle + git-restore repair before done passed.
- Precedent mechanism: task 0701 R7a — `appendQaEntry`, `packages/app/src/services/planning-write-service.ts:582-632`, `<!-- qa:replace -->` marker, documented in `apps/cli/src/commands/task.ts:424-431`.
- Gate consumer: `packages/app/src/workflow/lifecycle-adapter.ts:391-403` (0278 R1, testing→done Review L3).
- Contract consumers: task-pipeline v3 (`config/workflows/task-pipeline.yaml`) review/record states write `--section Review` on every run; consolidation-heavy tasks 1051-1056 (D63).
- Help/section discovery: `spur task sections <wbs> list` (valid canonical names).

### History

- 2026-10-02T21:57:42.450Z todo → wip (system)
- 2026-10-02T22:18:38.111Z wip → testing (system)
- 2026-10-02T22:31:18.040Z testing → done (system)

