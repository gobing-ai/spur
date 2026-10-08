---
schema_version: 1
name: Decide L2.unclosed-code-fence suppressibility in REQUIRED_FINDING_CODES (1008 P3-2)
status: done
template: feature-impl
created_at: 2026-09-29T18:18:17.374Z
updated_at: "2026-10-08T15:50:05.195Z"
feature_id: F91

ac_altitude: task-local
---

## 1010. Decide L2.unclosed-code-fence suppressibility in REQUIRED_FINDING_CODES (1008 P3-2)

### Background

Origin: task 1008 review finding P3-2 (verbatim): "L2.unclosed-code-fence is not in REQUIRED_FINDING_CODES (`packages/app/src/services/planning-check-base.ts:76-88`), so `tasks.severity` config may downgrade it to warning/off. Default emit severity is error (R2 met), but a fail-closed corruption signal arguably merits unsuppressible treatment like L2.missing-required-section. Design choice for the operator to confirm."

Mechanism (verified on main):

- `REQUIRED_FINDING_CODES` (`packages/app/src/services/planning-check-base.ts:76-88`) is the frozen set of codes that cannot be downgraded by `severityOverrides` nor absorbed by accepted-map filtering. Header comment: callers MAY extend it for project-specific essential errors but MUST NOT shrink it; frozen at the planning-check-base seam so `TaskCheckService` and `FeatureCheckService` share one policy.
- Current members: `L1_MARKDOWN_PARSE`, `L1_SCHEMA_VALIDATION`, `L2_MISSING_REQUIRED_SECTION`, `L3_AC_BDD_ERROR`, `L3_AC_BDD_INVALID`, `L3_REQUIREMENTS_EMPTY`, `L3_AC_EMPTY`, `L3_REQUIRED_SECTION_PLACEHOLDER`, `REQUIRED_REFERENCE_CODES`, `L4_PREREQUISITE_CYCLE`, `COMPLETION_FINDING_CODES`.
- Emission site (`planning-check-base.ts:228-241`) pushes `L2.unclosed-code-fence` with severity `error` and a fail-closed message — this task does not change emission either way.
- The config surface is `tasks.severity` (severityOverrides), documented in the finding-code catalog of `docs/design/configuration-contracts.md` (counts sentence near :49 was already corrected to 63/L2×6 by task 1008 P2-1).

Why it matters (F91 intent): an unclosed fence makes `findHeadings` see a truncated prefix — every later section is invisible and downstream checks pass on corrupted input. A corruption signal the config can silence partially defeats the corpus gate. Counter-argument for keeping it suppressible: legacy files with stray fences would hard-fail checks with no escape hatch. This is a product decision, not a mechanical fix.

### Requirements

- **R1 (unsuppressible)** — add `FINDING_CODES.L2_UNCLOSED_CODE_FENCE` to `REQUIRED_FINDING_CODES` (`packages/app/src/services/planning-check-base.ts:76-91`), beside `L2_MISSING_REQUIRED_SECTION`. `summarizeWithStatus` (`:315+`) already refuses `off`/downgrade overrides and accepted-map absorption for members of the set, so membership is the whole implementation.
- **R2 (policy recorded at its owner)** — the essential-vs-advisory policy lives in `docs/design/essential-workflow-checks.md` (finding-class table, :25-37), not in `configuration-contracts.md` (which has no suppression-policy row). Record there that a document whose structure the parser cannot see (unclosed code fence, missing required section) is essential. Add one clause to the `tasks.severity` sentence in `docs/design/configuration-contracts.md` (finding-code catalog, ~:49) that overrides do not apply to essential codes, pointing to that doc.

### Acceptance Criteria

- [x] AC1 — `packages/app/tests/services/planning-check-base.test.ts` (beside the `essential L1 schema error survives severityOverrides` case, ~:390) proves `isUnsuppressibleFinding(L2_UNCLOSED_CODE_FENCE)` is true, a `severityOverrides: { 'L2.unclosed-code-fence': 'off' }` / `'warning'` leaves the finding at severity `error` with `pass: false`, and an accepted-map entry for the code does not absorb it (req: R1)
- [x] AC2 — `docs/design/essential-workflow-checks.md` finding-class table classifies parser-invisible structure (unclosed fence, missing required section) as essential; `configuration-contracts.md` notes `tasks.severity` cannot override essential codes (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T19:53:31.565Z

- **Q: Branch A (unsuppressible) or B (keep escape hatch)?** Closed 2026-09-29: **A**. Evidence: (1) `essential-workflow-checks.md` says classify by actual consumer requirements — an unclosed fence truncates the parsed view, so every later-section check passes on corrupted input; consumer semantics are not intact → essential. (2) Corpus scan of all 1180 files under `docs/tasks*/` and `docs/features/` with `MarkdownDocument.unclosedFenceLine()` found **0** unclosed fences — the legacy-escape-hatch argument has no population. (3) The fix is always one line (close the fence); an override that silences corruption only hides data loss (1008 R3). Branch B is dropped.
- **Q: Does `corpus-check` need a baseline change?** Closed: no — zero existing occurrences, so no accepted-map entries exist to reconcile.

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

1. `packages/app/src/services/planning-check-base.ts:76-91` — add `FINDING_CODES.L2_UNCLOSED_CODE_FENCE,` after `L2_MISSING_REQUIRED_SECTION` with a one-line WHY comment (parser-invisible structure; task 1010).
2. `packages/app/tests/services/planning-check-base.test.ts` — copy the shape of the `essential L1 schema error survives severityOverrides` test for the fence code; add the accepted-map leg.
3. Docs (same commit): `docs/design/essential-workflow-checks.md` finding-class table row; `docs/design/configuration-contracts.md` `tasks.severity` clause.

Constraints (anti-drift):

- Do NOT touch emission (`packages/app/src/services/planning-check-base.ts:228-241`) or default severity.
- Do NOT shrink the set.
- `packages/app` is bundled into `plugins/sp/lib/*.generated.mjs` only via scripts that import it; if `bun run build:plugin-lib` produces a diff, commit it (1008 precedent). Otherwise none.
- `ac_altitude: task-local` stays.

Verify: `(cd packages/app && bun test tests/services/planning-check-base.test.ts)`; `bun run spur-check`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/planning-check-base.ts:76-82` L2_UNCLOSED_CODE_FENCE in REQUIRED_FINDING_CODES beside L2_MISSING_REQUIRED_SECTION; isUnsuppressibleFinding at `packages/app/src/services/planning-check-base.ts:104`; off refused at `packages/app/src/services/planning-check-base.ts:345-347`; accepted-map skipped at `packages/app/src/services/planning-check-base.ts:366` |
| R2 | MET | `docs/design/essential-workflow-checks.md:29` parser-invisible structure row (essential); `docs/design/configuration-contracts.md:49` tasks.severity clause: overrides do not apply to essential codes |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/planning-check-base.test.ts:414-450` isUnsuppressibleFinding true; off/warning overrides keep severity error and pass false; accepted-map entry does not absorb; fresh 44 pass / 0 fail |
| AC2 | MET | command | `rg -c "Parser-invisible document structure" docs/design/essential-workflow-checks.md` → 1 (`docs/design/essential-workflow-checks.md:29`); `rg -c "overrides do not apply to essential codes" docs/design/configuration-contracts.md` → 1 (`docs/design/configuration-contracts.md:49`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Review (2026-09-29): sp-super-reviewer fresh session — verdict PASS. Answer: `.spur/run/task-1010-03ed1d55-review-answer.txt`. P4 finding (observational): `packages/app/tests/services/planning-check-base.test.ts:438-448` signature cast on 6-arg `summarizeWithStatus` omits the 7th `requiredList?` param — functional, correctly ordered; rides post-batch.

### History

- 2026-09-29T20:36:22.758Z backlog → todo (system)
- 2026-09-29T20:40:08.977Z todo → wip (system)
- 2026-09-29T20:53:03.759Z wip → testing (system)
- 2026-09-29T20:54:49.425Z testing → done (system)

