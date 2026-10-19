---
schema_version: 1
name: Align the review answer contract with the spur task verdict vocabulary
status: todo
template: issue
created_at: 2026-10-18T19:33:15.525Z
updated_at: "2026-10-19T02:41:27.626Z"

feature_id: F91
---

## 1254. Align the review answer contract with the spur task verdict vocabulary

### Background

Observed across the whole D66 batch on 2026-10-18 (feature D66, tasks 1246-1252, branch `sp/runall-d66-7760`). The review hop asks its agent for one answer shape and `spur task verdict --from-answer` enforces a different one, so a *correct* review is certified as non-PASS and the run burns its remediation budget.

**What each side says.**
- The pipeline prompt (`config/workflows/task-pipeline.yaml`, `review` onEnter `input`, ~line 622-660) asks for a plain `Verdict: PASS|FAIL` line preceded by a `| Req | Status | Evidence |` table and a `| AC | Status | Evidence Type | Evidence |` table. It never states the status vocabulary, the evidence-type vocabulary, or the AC-identity rule.
- `packages/app/src/services/verify-answer-lint.ts` (~line 140-205) enforces: `MET | PARTIAL | UNMET` (not PASS/FAIL), an AC id matching a declared label or scenario title, and an evidence type from `test | command | static-ref | manual-review | llm-judge | n/a` (or a `+` compound).
- `packages/app/src/services/feature-check.ts:1490-1545` plus `apps/cli/src/commands/task/verdict.ts:85` add a *second* requirement: at least one row must key to a feature scenario, with accepted forms `scenario title`, `AC-<n>` alias, `(feature R<n>)`, `(covers: R<n>)`, `[R<n>]`.
- `confidence-mismatch` contradicts ADR-141: a reviewer that states `MEDIUM` because it carries a residual (an OPEN/DEFER row) is rejected, because the derivation reads only the requirement/AC rows and cannot see the residual.

**What happened (evidence).**
- Runs `6078a8a6` (pi-k3), `8e680e1e` (codex-sol), `bc16c064` and `db097057` (pi-k3) each ended `retry-exhausted` while the reviewer's own verdict was PASS.
- 1249's answer said "artifact written … and merged into the task's `## Review`" — the tables landed in the section, the answer text was prose.
- 8e680e1e's answer was cut mid-sentence ("First draft failed the …"), so the captured stdout is not a reliable carrier either.
- 1246, 1247, 1249, 1250, 1251 and 1252 were only certifiable after an operator rebuilt the answer from the reviewer's own tables with the vocabulary normalized (`PASS`→`MET`, AC ids re-keyed, evidence types mapped, confidence aligned). 1248 was certifiable only because the reviewer happened to write `.spur/run/1248-verdict.json` = PASS while the pipeline's own status token read FAIL.
- Downstream symptom already partially fixed on 2026-10-18: `flipVerifiedCheckboxes` (`packages/app/src/services/task-record.ts:319-410`) could not tick a task AC box from a scenario-keyed row whose scenario id was not echoed in the AC bullet; the bare-title match was added, with two tests in `packages/app/tests/services/task-record.test.ts`.

### Requirements

- [ ] R1. The review hop's `input` states the exact answer contract the lint enforces: `MET | PARTIAL | UNMET` statuses, the enumerated evidence-type tokens, the AC column carrying the declared AC label or the feature scenario title (never a scenario suffix glued onto a truncated label), and the requirement that at least one row key to a feature scenario.
- [ ] R2. `spur task verdict --from-answer` re-asks once, naming the failing lint rules, when the answer parses but fails the vocabulary/identity lint — instead of deriving a review FAIL that enters remediation.
- [ ] R3. Accepted AC-identity forms are stated in one place and shared by the lint, the scenario-key gap check and the checkbox flip: declared label, bare title, `AC<n>`, `AC-<n>`, scenario title, `(feature R<n>)`, `(covers: R<n>)`, `[R<n>]`.
- [ ] R4. A `Confidence: MEDIUM` stated for a carried residual (an OPEN or DEFER row in the answer's findings table) is accepted, and a mismatch message names the row responsible.
- [ ] R5. A missing/`UNKNOWN`-deriving answer (no tables) is reported as `answer-shape` in the run's terminal reason and in the review status token, distinguishable from a substantive FAIL.
- [ ] R6. An end-to-end test drives one review whose final message is prose with the tables in `## Review` and asserts the run certifies with no operator normalization.

### Acceptance Criteria

- [ ] AC1 — A review answer in the documented vocabulary certifies with no operator normalization (req: R1, R6)
- [ ] AC2 — A prose-only answer is re-asked once, then reported as answer-shape instead of a review FAIL (req: R2, R5)
- [ ] AC3 — Every accepted AC-identity form resolves the same way in the lint, the scenario-key gap and the checkbox flip (req: R3)
- [ ] AC4 — A carried residual keeps MEDIUM admissible (req: R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Chosen: one contract, stated by the producer, checked by the consumer.**
1. Put the vocabulary in the prompt (R1). The pipeline owns the ask; the lint owns the check; a shared constant list keeps them from drifting (`packages/app/src/services/verify-answer-lint.ts` exports the accepted tokens; the prompt text cites the same words).
2. Add a bounded re-ask (R2): after `spur task verdict --from-answer` returns lint findings that are all `answer-shape` class, re-dispatch the reviewer once with those findings quoted. Budget one retry, reuse the same session, then fail closed with `answer-shape`.
3. Unify identity forms (R3) behind one exported matcher used by `verify-answer-lint.ts`, `feature-check.ts` (`verdictScenarioKeyGap`) and `task-record.ts` (`acRowProves`). The bare-title match added on 2026-10-18 is the seed of that matcher.
4. Confidence (R4): when the answer's findings table carries an OPEN or DEFER row, `MEDIUM` is the admissible level; the message names that row.

**Rejected.**
- Accepting `PASS`/`FAIL` as synonyms in the lint: the verdict vocabulary is the machine contract, and the ambiguity between "requirement PASS" and "row PARTIAL" would move into every consumer. State it instead.
- Dropping the scenario-key requirement: it is what makes a covering task's verdict evidence the feature scenario (0958 R2); the fix is to state it in the prompt.
- Making the pipeline read `## Review` instead of the answer: the section is a rendered projection and can be rewritten after the run.

**Frozen names.** `ANSWER_SHAPE` finding class; `VERDICT_STATUS_TOKENS`, `VERDICT_EVIDENCE_TYPES`, `VERDICT_SCENARIO_KEY_FORMS` exported from `verify-answer-lint.ts` / `feature-check.ts`.

**File targets.** `config/workflows/task-pipeline.yaml` review `input`; `packages/app/src/services/verify-answer-lint.ts`; `apps/cli/src/commands/task/verdict.ts:85`; `packages/app/src/services/feature-check.ts:1490-1545`; `packages/app/src/services/task-record.ts:319-410`; tests `packages/app/tests/services/{verify-answer-lint,task-record,feature-check}.test.ts`, `apps/cli/tests/commands/task/verdict*.test.ts`.

**Anti-patterns.** No per-model prompt variants; no "accept anything" fallback; never derive PASS from prose the lint cannot parse; do not weaken the scenario-key rule for task-local tasks (they are already exempt by `checkAcCoverage`).

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
