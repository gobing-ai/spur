---
template: feature-impl
schema_version: 1
name: "fix review section double-write and stale pipeline descriptions"
description: ""
status: done
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-08T22:28:31.879Z"
updated_at: "2026-08-18T04:42:47.128Z"
---

## 0228. fix review section double-write and stale pipeline descriptions

### Background

Post-completion audit of task 0227 (three-dimensional review architecture) revealed a **code-level
double-write bug** in the task pipeline's section-write chain. The `## Testing` and `## Review`
sections each have multiple uncoordinated writers, and the last writer is not always the
authoritative one:

- **`## Testing`**: `functional-review` Step 7 writes, `code-verification` verify mode writes, then
  the `record` step (`task-service.ts:554-557`) overwrites unconditionally with
  `renderTesting(verdict)`. The first two writes are wasted.
- **`## Review`**: `dev-review` writes (three dimensions), then `code-verification` verify mode
  Step 10 writes via `spur task update --section Review --from-file` (a full `doc.replaceSection`),
  destroying dev-review's findings. The `record` step (`task-service.ts:563-567`) then sees non-bare
  Review and skips (bareness guard). Net: dev-review's functional + architecture findings are lost.

Additionally, two description locations are stale — they describe the old single-dimension (SECUA
only) review, not the three-dimensional review introduced by task 0227:

- `config/workflows/task-pipeline.yaml:123` — review state description.
- `plugins/sp/skills/spur-dev/references/dev-operations.md` lines 40, 74, 77.

### Requirements

<!-- R-numbered list derived from the linked feature or refined task scope. -->

R1. `functional-review` must write its per-requirement traceability table to `## Review`, not `## Testing`. Rationale: `dev-review.md:62-63` declares `## Review` as the output section for all three dimensions; `functional-review` is dispatched by `dev-review`, so its output belongs in `## Review`. The `## Testing` section is owned by the verify/record pipeline exclusively. `SKILL.md:241-249` (`functional-review/SKILL.md`).

R2. `code-verification` verify mode (Step 10) must stop writing `## Review` directly. It writes `## Testing` + `.spur/run/<wbs>-verdict.json`; the verdict artifact carries the SECUA findings, and the `record` step's `renderReview(verdict)` + bareness guard handles the Review backfill. `SKILL.md:225-235` (`code-verification/SKILL.md`).

R3. The `functional-review` Step 7 vs Step 8 contradiction must be resolved. Step 7 currently says "write to `## Testing`" and Step 8 says "the `record` step transcribes this into `## Testing`." After the fix, Step 7 writes to `## Review` and Step 8 should reflect that the skill writes to `## Review` (standalone) or the `record` step handles section transcriptions (pipeline). `SKILL.md:241-273` (`functional-review/SKILL.md`).

R4. `code-verification` verify mode's output contract (table row + Step 11 prose) must be updated to remove `SECUA findings → ## Review` from the verify-mode scope. The `review` mode still writes `## Review` (unchanged). `SKILL.md:37, 266-268` (`code-verification/SKILL.md`).

R5. `task-pipeline.yaml:123` review state description must reflect three-dimensional review (functional + SECUA + architecture), not SECUA-only. `config/workflows/task-pipeline.yaml:123`.

R6. `dev-operations.md` operation #2 (review) must reflect three-dimensional review: purpose, behavior, and output section. `plugins/sp/skills/spur-dev/references/dev-operations.md:40, 72-78`.

R7. `code-improvement` SKILL.md already states it does not write to the task file directly (lines 190-192). No change needed — confirmed not part of the double-write.

### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

#### AC-1: functional-review writes to Review not Testing

- **Given** functional-review is dispatched by dev-review
- **When** Step 7 executes
- **Then** it writes the per-requirement traceability table to `## Review` via `spur task update --section Review`
- **And** it does NOT write to `## Testing`

#### AC-2: code-verification verify mode does not write Review

- **Given** code-verification is in verify mode under the pipeline
- **When** Step 10 executes
- **Then** it writes `## Testing` and `.spur/run/<wbs>-verdict.json` only
- **And** it does NOT write to `## Review` directly

#### AC-3: functional-review Step 7 and Step 8 are consistent

- **Given** functional-review SKILL.md is read
- **When** Step 7 and Step 8 are compared
- **Then** both reference `## Review` as the output section
- **And** there is no contradiction about which section or who writes

#### AC-4: code-verification verify-mode contract reflects the change

- **Given** code-verification SKILL.md is read
- **When** the verify-mode output table and Step 11 prose are inspected
- **Then** the verify mode output is "per-requirement verdict → `## Testing`; `.spur/run/<wbs>-verdict.json`"
- **And** SECUA findings → `## Review` is removed from verify mode only (review mode unchanged)

#### AC-5: pipeline YAML review state description reflects three dimensions

- **Given** task-pipeline.yaml is read
- **When** the review state description at line 123 is inspected
- **Then** it mentions functional + SECUA + architecture (three-dimensional) not SECUA-only

#### AC-6: dev-operations review entry reflects three dimensions

- **Given** dev-operations.md is read
- **When** operation #2 (review) is inspected
- **Then** its purpose, backing, behavior, and delegation reflect the three-dimensional dispatch

#### AC-7: pipeline record step write chain is consistent with skill docs

- **Given** the record step (`task-service.ts:554-567`) unconditionally overwrites `## Testing`
- **And** guards `## Review` with `sectionIsBare`
- **When** the skill docs are read
- **Then** no skill other than code-verification verify mode writes to `## Testing`
- **And** no skill in the verify step writes to `## Review`
- **So** the record step is the single authoritative Testing writer and Review is protected by the bareness guard

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

**Q1: Why not add a bareness guard to the `## Testing` overwrite in the record step (like Review has)?**

A: The `## Testing` section's authoritative content is the verdict artifact rendered by
`renderTesting(verdict)`. The verify-mode write to Testing is redundant with the record step's
render — both derive from the same verdict. Adding a guard would preserve the redundant
intermediate write, which is worse than having a single authoritative writer. The fix is to stop
the unnecessary writes, not to guard against them.

**Q2: Why should `functional-review` write to `## Review` when the `record` step might also write `## Review`?**

A: The `record` step's `## Review` write is guarded by `sectionIsBare` (`task-service.ts:563`).
If `functional-review` (via `dev-review`) already wrote non-bare content, the record step skips.
This is the intended design: dev-review owns the Review content; the record step only backfills a
bare Review with the verdict-rendered summary. The bug was `code-verification` verify mode
bypassing this guard by writing directly before the record step runs.

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

**Approach: documentation-only fix (no engine code changes).**

The double-write bug is caused by uncoordinated writes in skill documentation, not by the record
step's logic. The record step is correct: `## Testing` unconditionally (verdict is authoritative),
`## Review` bareness-guarded (dev-review owns it). The bug is that `functional-review` writes to
`## Testing` (wrong section) and `code-verification` verify mode writes to `## Review` (bypasses
the guard). Fixing the skill docs aligns the write chain with the record step's existing logic.

**Section ownership after fix:**

| Section | Pipeline step | Writers | Authoritative |
|---------|--------------|---------|---------------|
| `## Testing` | verify → record | `code-verification` verify mode (Step 10), then `record` step (`renderTesting`) | record step |
| `## Review` | review → verify → record | `dev-review` dispatches `functional-review` + `code-verification` review mode + `code-improvement`; `record` step backfills only if bare | dev-review (three dimensions) |

**Key invariant:** No skill in the verify step writes to `## Review`. No skill other than
`code-verification` verify mode writes to `## Testing` (and even that is intermediate — the record
step is authoritative).

**Tradeoffs:**
- No engine code change → low risk, but the fix relies on skill-doc compliance (no runtime
  enforcement). Acceptable: the pipeline already trusts skills to write via CLI verbs, not direct
  file access.
- `code-verification` verify mode no longer writes SECUA findings to `## Review` directly → the
  verdict artifact (`renderReview(verdict)`) is the fallback when Review is bare. This is the
  intended bareness-guard design.

**Impacted surfaces (6 files):**

1. `plugins/sp/skills/functional-review/SKILL.md` — Step 7 + Step 8 (R1, R3).
2. `plugins/sp/skills/code-verification/SKILL.md` — Step 10, table row, Step 11 prose (R2, R4).
3. `config/workflows/task-pipeline.yaml` — review state description (R5).
4. `plugins/sp/skills/spur-dev/references/dev-operations.md` — operation #2 review (R6).
5. No engine code changes (`task-service.ts`, `task-record.ts`, `planning-write-service.ts`).
6. No test changes (documentation-only; existing pipeline tests do not assert section write
   coordination between skills).

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

- [x] **P1**: Fix `functional-review/SKILL.md` Step 7 — change `--section Testing` to `--section Review`; update surrounding prose.
- [x] **P2**: Fix `functional-review/SKILL.md` Step 8 — change `## Testing` to `## Review`; resolve contradiction.
- [x] **P3**: Fix `code-verification/SKILL.md` Step 10 — remove the Review section write block; keep only the Testing write + verdict artifact.
- [x] **P4**: Fix `code-verification/SKILL.md` table row (line 37) — remove `SECUA findings → ## Review` from verify mode.
- [x] **P5**: Fix `code-verification/SKILL.md` Step 11 prose (lines 266-268) — update record-step transcription description.
- [x] **P6**: Fix `task-pipeline.yaml:123` — update review state description to three-dimensional.
- [x] **P7**: Fix `dev-operations.md` operation #2 (lines 40, 74-77) — update review description.
- [x] **P8**: Run `bun run lint` and `bun run typecheck` — verify clean.
- [x] **P9**: Run `bun test` — verify full suite passes.
- [x] **P10**: Run `spur task check 0228 --strict` — verify task passes strict check.
- [x] **P11**: Write Solution + Testing sections, transition to done.

### Solution

**P1 — functional-review Step 7: Testing → Review** (`plugins/sp/skills/functional-review/SKILL.md:243-249`):
Changed `spur task update --section Testing` to `--section Review` and updated the temp-file name
from `/tmp/<wbs>-testing.md` to `/tmp/<wbs>-functional.md`. The per-requirement traceability table
now writes to `## Review`, matching `plugins/sp/commands/dev-review.md:62-63`'s declaration of `## Review` as the output
section for all three review dimensions.

**P2 — functional-review Step 8: resolve contradiction** (`plugins/sp/skills/functional-review/SKILL.md:272-273`):
Changed "the `record` step transcribes this output into the task's `## Testing` section" to
"the `record` step transcribes this output into the task's `## Review` section — keep the table
structure stable." Step 7 and Step 8 now agree on `## Review` as the output section.

**P3 — code-verification Step 10: remove Review write** (`plugins/sp/skills/code-verification/SKILL.md:225-235`):
Removed the `spur task update --section Review --from-file` block. Verify mode now writes only
`## Testing` via CLI verb. Added a blockquote warning explaining why: `## Review` is owned by the
review step (`/sp:dev-review`), the `record` step backfills via `sectionIsBare` guard
(`packages/app/src/services/task-service.ts:563`), and writing `## Review` here destroys the review step's findings.
Also removed the `Review section` body-only guidance bullet (no longer needed since verify mode
no longer writes Review).

**P4 — code-verification table row: verify-mode output contract** (`plugins/sp/skills/code-verification/SKILL.md:37-38`):
Updated the `/sp:dev-verify` row from "per-requirement verdict → `## Testing`; SECUA findings → `## Review`" to
"per-requirement verdict → `## Testing`; `.spur/run/<wbs>-verdict.json`". Added a new `/sp:dev-review` row for
the review mode: "three-dimensional findings → `## Review` (functional + SECUA + architecture)".

**P4b — code-verification Step 11 prose: record-step transcription** (`plugins/sp/skills/code-verification/SKILL.md:266-269`):
Updated from "The **record** step transcribes the answer file into the task: `## Testing` ← verdict +
per-requirement/AC tables, `## Review` ← SECUA findings" to "The **record** step transcribes only
`## Testing` from the verdict — verdict + per-requirement/AC tables + evidence. `## Review` is
owned by the review step (`/sp:dev-review`) and the record step's `sectionIsBare` guard
(`packages/app/src/services/task-service.ts:563`) preserves any non-bare Review content. Verify mode never writes `## Review`."

**P5 — task-pipeline.yaml: review state description** (`config/workflows/task-pipeline.yaml:123`):
Changed "SECUA-framework code review via /sp:dev-review (Security, Efficiency, Correctness, Usability, Architecture)"
to "Three-dimensional code review via /sp:dev-review (functional requirements traceability + SECUA
framework (Security, Efficiency, Correctness, Usability, Architecture) + architecture depth),
findings written to `## Review`."

**P6 — dev-operations.md: operation #2 review** (`plugins/sp/skills/spur-dev/references/dev-operations.md:40,74-78`):
- Table row 40: updated Backing column from "sp:code-verification (review)" to "sp:code-verification (review) + sp:functional-review + sp:code-improvement".
- Purpose (line 74): changed from "SECUA-framework code review" to "Three-dimensional code review — (1) functional requirements traceability, (2) SECUA framework, (3) architecture depth."
- Backing (line 76): expanded to list all three backing skills with their dimensional responsibilities.
- Behavior (line 77): changed from "run SECUA analysis" to "run three-dimensional analysis (functional traceability + SECUA + architecture depth)".

**R7 confirmation:** `code-improvement/SKILL.md:190-192` does not write to the task file directly — confirmed not part of the double-write. No change needed.

**No engine code changes.** The record step (`packages/app/src/services/task-service.ts:554-567`) is correct as-is: `## Testing` unconditional (verdict authoritative), `## Review` bareness-guarded (dev-review owns it). The fix realigns skill documentation with the record step's existing logic.

### Testing

Coverage: N/A (documentation-only task — no code changes, no tests to run).
Verification: `spur task check 0228 --strict` PASS; `bun run lint` clean; `bun run typecheck` clean; `bun test` full suite passes.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: H1 (spur-dev umbrella skill)
- Task 0227: `docs/tasks2/0227_enhance-the-review-capability-in-plugin-sp.md` — introduced three-dimensional review.
- Record step code: `packages/app/src/services/task-service.ts:554-567`
- Render functions: `packages/app/src/services/task-record.ts:172-237`
- Section writer: `packages/app/src/services/planning-write-service.ts:248-249, 479-482`
- Pipeline workflow: `config/workflows/task-pipeline.yaml:122-128`
- `dev-review` command: `plugins/sp/commands/dev-review.md:62-63`
- `code-improvement` SKILL (no direct write): `plugins/sp/skills/code-improvement/SKILL.md:190-192`

### History

- 2026-07-08 — created, moved to wip.
- 2026-07-08T22:41:03.006Z wip → testing (system)
- 2026-07-08T22:41:08.838Z testing → done (system)
