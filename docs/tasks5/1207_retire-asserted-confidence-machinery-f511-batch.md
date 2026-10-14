---
schema_version: 1
name: Retire asserted-confidence machinery (F511 batch)
status: wip
template: feature-impl
created_at: 2026-10-14T21:08:54.898Z
updated_at: "2026-10-14T22:24:58.738Z"
feature_id: F511

priority: P2
---

## 1207. Retire asserted-confidence machinery (F511 batch)

### Background

The `Confidence: HIGH|MEDIUM|LOW` contract on verify/review answers is a re-import of the anti-hallucination protocol's self-grading vocabulary. spur deliberately moved anti-hallucination (incl. confidence-level enforcement) to superskill as cc:anti-hallucination (e6aa7b3bf, ADR-055 amendment); task 1068 brought the vocabulary back into the verify answer contract, and it spread to pipeline v4 gates (c3d571953), 1196 feature receipts, 1204 review answers / F51, and config/rules/docs/verdict-confidence.yaml. An asserted label is not verification: lint only checks the word is in vocabulary, and the agent that can PASS can always write HIGH. Operator decision (Robin, 2026-10-14): remove the asserted machinery; keep the derived family (feature receipts measure which command ran, its exit status and proof-input digest — ADR-131 amendment) and the decision subsystem's numeric confidence. changelog precedent: confidence verification was added (21582dc6c) then carved out (343e3e9ad).

### Requirements

- [ ] R1. `packages/app` no longer lints, derives, stores (authoring side) or renders an asserted verify-answer confidence: `verify-answer-lint.ts` drops confidence-missing/confidence-value/confidence-unwarranted/confidence-understated and CONFIDENCE_LEVELS; `task-verdict.ts` and `verify-verdict.ts` drop the authoring contract (old artifacts with a confidence field keep parsing — read-compat stays); `task-record.ts` renders no Confidence line.
- [ ] R2. `residual-scan.ts` grades review PASS edges on verdict/findings only: drop reviewConfidenceViolation, the confidence clause in reviewContractViolations, and the review-answer/ackLowConfidence grading input plumbing; generated plugin twins re-emitted.
- [ ] R3. `config/workflows/task-pipeline.yaml` has no confidence check row, no review-edge confidence grading and no task-boundary ackLowConfidence var; generated `apps/cli/config` re-synced; feature-lifecycle.yaml untouched.
- [ ] R4. `config/rules/docs/verdict-confidence.yaml` deleted; `bun run corpus-check` audited for the checker-policy change (T10): no F511-attributable failures and the pre-existing D2/H51/D5/D4/F9 findings unchanged.
- [ ] R5. Contract docs updated: code-verification SKILL Step 11, verdict-schema.md, dev-review.md, super-reviewer.md, dev-operations.md verify confidence mentions; the changelog "no confidence ratings" invariant stays.
- [ ] R6. F51 cancelled via CLI with the retirement reason; ADR entry records the boundary (anti-hallucination → cc; spur keeps derived evidence gates); feature-receipt derived contract (ADR-131/1196) verified unchanged.
- [ ] R7. Pinning tests updated with the removal; focused suites, `bun run spur-check`, `spur rule run`, `bun run plugin-smoke` green.

### Acceptance Criteria

- [ ] AC1 — a verify answer without a Confidence line lints clean, derives an artifact and records Testing with no confidence value (req: R1)
- [ ] AC2 — the review-gate scanner produces no confidence violation for answers with or without a Confidence line, and open P1–P3 findings still block (req: R2)
- [ ] AC3 — task-pipeline.yaml validates with no confidence wiring and feature-lifecycle.yaml is byte-unchanged (req: R3)
- [ ] AC4 — verdict-confidence.yaml is gone, corpus-check audited with no F511-attributable failures (pre-existing findings unchanged), and the ADR boundary entry exists (req: R4)
- [ ] AC5 — feature receipt with derived confidence still passes done-transition-guard checks unchanged (req: R3, receipt-contract invariance under the R3 scenario)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

WHAT: delete the asserted-confidence contract at every seam it touches, keep read-compat for historical artifacts, keep the derived receipt family.
WHY: an asserted label adds ceremony without evidence; the actual gates (tests, traceability, citation rules) stay. The receipt level is a measurement, not a self-grade.
WHERE: packages/app/src/services/{verify-answer-lint,task-verdict,verify-verdict,task-record,residual-scan}.ts; plugins/sp generated twins; config/workflows/task-pipeline.yaml (+ generated apps/cli/config); config/rules/docs/verdict-confidence.yaml; plugins/sp contract docs; docs/00_ADR.md; docs/features/F51*.
ANTI-PATTERNS: do not touch feature-verification-receipt.ts, done-transition-guard receipt checks, contracts/observability.ts, decision/confidence-level.ts, history-anatomy confidence reading, sourced-api-claims rule. No new flags, no replacement vocabulary.

### Plan

1. Strip app services (R1) and their pinning tests; run focused suites in packages/app.
2. Strip residual-scan review grading (R2); re-emit plugin lib twins; run plugin tests.
3. Edit task-pipeline.yaml (R3); build:bundle sync; validate workflow.
4. Delete the rule (R4); corpus-check.
5. Contract docs (R5), F51 cancel (R6), ADR entry.
6. Full gates: spur-check, spur rule run, plugin-smoke; record verdict; done.

### Solution

Removed the asserted-confidence contract at every seam; kept the derived family.

- `packages/app/src/services/verify-answer-lint.ts:1` — dropped CONFIDENCE_LEVELS, confidence-missing/value/unwarranted/understated rules and extractAnswerConfidence; the `evidence-hedged` and `evidence-citation` rules stay.
- `packages/app/src/services/task-verdict.ts:1` / `verify-verdict.ts:1` — no confidence in the answer contract or VerifyVerdict type; legacy artifacts with a `confidence` key parse with the value ignored (read-compat, unknown keys tolerated).
- `packages/app/src/services/task-record.ts:1` — Testing section renders no Confidence line.
- `packages/app/src/services/residual-scan.ts:337` — dropped reviewConfidenceViolation, the confidence clause in reviewContractViolations, parseScanArgs `--review-answer` and buildReviewGateArtifact ack plumbing; grades verdict/findings/citations only. Plugin twin `plugins/sp/scripts/residual-scan.ts` + `.mjs` and lib twins re-emitted (`build:scripts`, `build:plugin-lib`); `scripts/commands/bundle-plugin-lib.ts` RESIDUAL_SCAN_DECLS updated.
- `config/workflows/task-pipeline.yaml:63` v6→v7 — confidence check row, review-edge `--review-answer` grade and `ackLowConfidence` var removed; PASS edges hand the review gate no answer file (Verdict grep stays). Guard-parity baseline entries for verify→record/record→done regenerated; precheck→implement entry 0 kept frozen (pre-existing drift out of scope).
- `config/rules/docs/sourced-api-claims.yaml` remains; `verdict-confidence.yaml` deleted (config/rules/docs:1) (only sourced-api-claims remains in config/rules/docs/).
- Contract docs: `plugins/sp/commands/dev-review.md:1`, `plugins/sp/agents/super-reviewer.md:228`, `plugins/sp/skills/code-verification/SKILL.md` + `references/verdict-schema.md`, `plugins/sp/skills/spur-dev/references/execution-workflow.md` + `inline-pipeline-driver.md` — answer grammar has no Confidence line; legacy lines parse with the value ignored.
- `docs/features/F51_review-confidence-certification-at-pipeline-pass-boundaries.md:1` cancelled with retirement rationale; `docs/00_ADR.md:2339` ADR-138 records the ownership boundary (anti-hallucination → cc:anti-hallucination; spur gates on deterministic evidence).
- Tests: packages/app service suites, workflow proof-chain (1122 pin flipped to assert `--review-answer` ABSENT), guard-parity (verdictVariants 9→6), plugins/sp residual-scan suite, apps/cli task.test.ts (1123 denial tests → read-compat pins; lint matrix de-dimensionalized; `evidence-hedged` refusal kept), super-reviewer-output-contract (confidence pin → F511 pin), confidence-level vocabulary-parity (fourth declaration leg removed).
- Untouched by design: feature-verification-receipt.ts, done-transition-guard receipt checks, contracts/observability.ts, decision/confidence-level.ts, history-anatomy, sourced-api-claims rule, config/workflows/feature-verification.yaml.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-14T21:09:43.618Z backlog → todo (system)
- 2026-10-14T21:09:43.963Z todo → wip (system)

