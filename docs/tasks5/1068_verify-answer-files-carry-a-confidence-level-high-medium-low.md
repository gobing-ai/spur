---
schema_version: 1
name: Verify answer files carry a confidence level (HIGH/MEDIUM/LOW)
status: done
template: standard
created_at: 2026-10-03T16:19:55.477Z
updated_at: "2026-10-03T16:32:12.467Z"

done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new/.spur/memory/evidence/1068-verdict.json
---

## 1068. Verify answer files carry a confidence level (HIGH/MEDIUM/LOW)

### Background

Captured from the creation title: "Verify answer files carry a confidence level (HIGH/MEDIUM/LOW)".

### Requirements

- [x] R1. The verify answer file (`.spur/run/<wbs>-verify-answer.txt`) carries a `Confidence: HIGH|MEDIUM|LOW` line (exactly one, alongside `Verdict:`), so a reader can see how strongly the verifier stands behind the verdict without re-deriving it from the evidence.
- [x] R2. `spur task verdict --from-answer` lint validates the confidence line: missing → `confidence-missing` finding; a value outside HIGH/MEDIUM/LOW → `confidence-value` finding. Both block derivation like any other lint finding.
- [x] R3. The derived verdict artifact (`.spur/run/<wbs>-verdict.json`) carries the confidence as a top-level `confidence` field, and `spur task record` renders it into `## Testing` next to the verdict line. Artifacts written before this change (no confidence field) remain readable — confidence is optional on read, required on new answer files.
- [x] R4. The authoring contract is updated where the answer-file schema is documented (`plugins/sp/skills/code-verification/SKILL.md` Step 11 schema), so pipeline verify steps write the line.
- [x] R5. Regression tests: lint accepts each of HIGH/MEDIUM/LOW, rejects missing/invalid; derive carries the value into the artifact; record renders it; a pre-change artifact without the field still records cleanly.

### Acceptance Criteria

- [x] AC1 — A verify answer with `Confidence: HIGH` lints clean and derives an artifact with `confidence: "HIGH"` (req: R1, R2, R3)
- [x] AC2 — An answer with no confidence line, or `Confidence: SURE`, is rejected by lint with a named finding and no artifact is written (req: R2)
- [x] AC3 — A verdict artifact without a confidence field (pre-change) is accepted by `spur task record` and renders Testing without a confidence line (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

**Approach:** one new closed-vocabulary line on the verify answer-file contract, verified at the lint seam and carried through to the artifact and Testing render.

- Lint + parser: `packages/app/src/services/verify-answer-lint.ts:66` (`confidence-missing`/`confidence-value` findings), `:311` (`extractAnswerConfidence`, the total non-throwing reader).
- Derivation: `packages/app/src/services/task-verdict.ts:22` (`VerdictResult.confidence`), `:52` (populated via the helper; omitted when absent/invalid — lint rejects those answers first).
- Canonical artifact: `packages/app/src/services/verify-verdict.ts:68-69` (type) + `:166` (zod `confidence` enum, optional on read so pre-1068 artifacts parse unchanged).
- Render: `packages/app/src/services/task-record.ts:285` — `renderTesting` emits `- Confidence: <level>` only when present.
- Authoring contract: `plugins/sp/skills/code-verification/SKILL.md` Step 11 schema block gained the Confidence line + level rubric (R44 baseline bumped deliberately, +542 B).
- Fixtures repaired: `apps/cli/tests/commands/task.test.ts` (0958 gate answers), `plugins/sp/tests/dispatch-handoff-contract.test.ts` (0818 R2 answers).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `Confidence: HIGH\|MEDIUM\|LOW` line parsed with the same exactly-one contract as `Verdict:` — `packages/app/src/services/verify-answer-lint.ts:294-301`; rubric documented in `plugins/sp/skills/code-verification/SKILL.md` Step 11. |
| R2 | MET | `confidence-missing` at `packages/app/src/services/verify-answer-lint.ts:66`, `confidence-value` adjacent; lint blocks derivation (task.ts verdict command exits 1 before artifact write — covered by CLI suite). |
| R3 | MET | Artifact carries `confidence` via `task-verdict.ts:22,52` + `verify-verdict.ts:68-69,166`; rendered by `packages/app/src/services/task-record.ts:285`; pre-1068 artifacts parse unchanged (field optional in zod schema). |
| R4 | MET | `plugins/sp/skills/code-verification/SKILL.md` Step 11 schema block carries the Confidence line + rubric. |
| R5 | MET | Tests: `bun test tests/services/verify-answer-lint.test.ts tests/services/task-verdict.test.ts tests/services/task-record.test.ts` (packages/app) — 227 pass, 0 fail this run; consumers `apps/cli/tests/commands/task.test.ts` 198 pass, `plugins/sp/tests/dispatch-handoff-contract.test.ts + skill-structure.test.ts` 101 pass, 0 fail this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | lint test.each over HIGH/MEDIUM/LOW passes clean; derive carries `confidence: 'MEDIUM'` from a MEDIUM answer — verify-answer-lint.test.ts + task-verdict.test.ts, green this run. |
| AC2 | MET | test | Missing line → `confidence-missing`; `Confidence: SURE` → `confidence-value` with line number; no artifact written (CLI verdict command lint gate) — green this run. |
| AC3 | MET | test | `renderTesting` renders `- Confidence: HIGH` when present and no Confidence line for a field-less artifact — task-record.test.ts, green this run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-03T16:29:17.575Z backlog → todo (system)
- 2026-10-03T16:29:17.859Z todo → wip (system)
- 2026-10-03T16:31:55.983Z wip → testing (system)
- 2026-10-03T16:32:12.323Z testing → done (system)

