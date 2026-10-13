---
schema_version: 1
name: Carry a derived HIGH/MEDIUM/LOW confidence level on the feature-verification receipt and gate completion on it
status: backlog
template: standard
created_at: 2026-10-13T19:03:27.230Z
updated_at: "2026-10-13T19:04:37.245Z"

---

## 1196. Carry a derived HIGH/MEDIUM/LOW confidence level on the feature-verification receipt and gate completion on it

### Background

The feature-verification pass records a bound PASS/FAIL receipt and nothing else about how much the green result can be trusted. Task-pipeline has gated a confidence level since 1068: the verify answer carries `Confidence: HIGH|MEDIUM|LOW`, the verdict artifact records it, and BOTH completion guards (`verify → record`, `record → done`) refuse a LOW or absent level unless the run was launched with `ackLowConfidence=true`. The feature boundary has no analogue, so `verifying → done` treats every PASS identically — including a PASS produced by a caller command override (`--cmd`) that ran a different check set than the selected definition declares.

Operator request, 2026-10-13: "Add verification for: confidence level (HIGH/MEDIUM/LOW)", scoped to the feature-verification boundary, in this source repo, with a derived level plus an operator-acknowledged gate (chosen from three options; the other two were operator-declared-only and advisory-only).

Observed in knowledge-kit during G14's verification (run `6a95b206`): the receipt carries `status: PASS`, verifier identity, `inputDigest` and run id — no confidence field — and `spur feature check G14 --as done` reported only the stale-FAIL rejection. Evidence for the derivation is already captured by the pass: the effective command (override or the definition's own), the exit status, and the before/after proof-input digest.

### Requirements

- [ ] R1. `FeatureVerificationReceipt` carries `confidence` (`HIGH|MEDIUM|LOW`) and `confidenceBasis` (non-empty string array naming the evidence the level rests on), written by `completeFeatureVerificationReceipt` and accepted by `parseFeatureVerificationReceipt`.
- [ ] R2. The level is DERIVED by the pass from its own evidence — HIGH when the selected definition's configured command exited 0 with an unchanged proof-input digest; MEDIUM when the same clean pass ran under a caller command override (`--cmd`), which certifies a different check set than the definition declares; LOW on any non-PASS or explicitly declared case. An explicit operator override (`--confidence HIGH|MEDIUM|LOW`) wins and is named as such in the basis.
- [ ] R3. Completion validation rejects a receipt that asserts PASS with `confidence` absent or LOW unless the receipt itself records the operator acknowledgement (`confidenceAcknowledged: true`, supplied by the pass through `ackLowConfidence`); the detail names the level and the repair. HIGH and MEDIUM PASS receipts are accepted unchanged.
- [ ] R4. The rejection is an unsuppressible L4 error finding in `feature check` / the transition gate, the level is visible in the pass output, and no existing rejection reason changes behaviour.
- [ ] R5. Tests cover the derivation (default command, override, override with an explicit level), the receipt round-trip, and the gate (HIGH/MEDIUM accepted, LOW and absent rejected, LOW accepted with the acknowledgement). Docs: a dated ADR-119 amendment plus the receipt/response surface where it is documented.

### Acceptance Criteria

- [ ] AC1 — A pass run with the definition's own command records `confidence: HIGH` with a basis naming the exit status and the unchanged digest, and `parseFeatureVerificationReceipt` round-trips both fields. (req: R1, R2)
- [ ] AC2 — A pass run with `--cmd <other>` records `MEDIUM` and its basis names the override; `--confidence HIGH` on that same run records HIGH with a basis saying it was operator-declared. (req: R2)
- [ ] AC3 — Completion is refused with the new finding when a PASS receipt has no `confidence` (legacy receipt) or `confidence: LOW` without the acknowledgement, and accepted when the same LOW receipt records `confidenceAcknowledged: true`. (req: R3, R4)
- [ ] AC4 — `bun run gate` and the touched test files pass, and nothing in the existing feature-verification/receipt/transition suites regresses. (req: R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT.** The feature-verification receipt gains a derived `confidence` level; the completion boundary refuses a PASS that carries none (or LOW) unless the receipt records the operator's acknowledgement. No new workflow state, no new CLI verb: the fields ride the existing receipt and the existing L4 completion-evidence check.

**WHY.** `verifying → done` today treats a PASS produced by the definition's own check set exactly like a PASS produced by a caller `--cmd` override that ran something else. Task-pipeline has refused that silent equivalence since 1068; this is the feature-boundary analogue the operator asked for on 2026-10-13.

**WHERE, exactly (frozen file targets).**

1. `packages/app/src/workflow/feature-verification-receipt.ts` — add `export const FEATURE_RECEIPT_CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const` + `export type FeatureReceiptConfidence = (typeof …)[number]`; add to `FeatureVerificationReceipt`: `confidence: FeatureReceiptConfidence`, `confidenceBasis: string[]`, and optional `confidenceAcknowledged?: boolean`. `CompleteFeatureReceiptOptions` gains the three (basis must be non-empty; the writer refuses an empty basis for a PASS). `parseFeatureVerificationReceipt` shape-checks the two when present and leaves absence legal at parse time. `FeatureReceiptRejection` gains `'unacknowledged-low-confidence'`; `validateFeatureVerificationReceipt` rejects when `status === 'PASS'` and (`confidence` is neither `HIGH` nor `MEDIUM`) and `confidenceAcknowledged !== true`, with a detail that names the level (or its absence) and the repair (re-run the pass, or re-run with the acknowledgement). Keep `FEATURE_RECEIPT_SCHEMA_VERSION` at 1: the fields are additive, and a legacy receipt is *rejected by validation*, not reported as malformed.
2. `packages/app/src/workflow/feature-verification-run.ts` — `FeatureVerificationRunInput` gains `confidenceOverride?: string` and `ackLowConfidence?: boolean`. Derivation, in this order: an explicit override whose value is one of the three levels wins and its basis says `operator-declared`; otherwise `status === 'PASS'` with `effectiveCmd === configuredCmd` ⇒ `HIGH` (basis: exit 0, digest unchanged); PASS under an override ⇒ `MEDIUM` (basis names the override); anything else ⇒ `LOW` (basis names the status). An override outside the enum throws like the other refusals in this module. Pass `confidence`, `confidenceBasis` and `confidenceAcknowledged` into `receipts.complete`, and carry `confidence` on `FeatureVerificationRunResult` so the reported line reads `verification PASS (run …, confidence HIGH …)`.
3. `packages/app/src/services/planning-check-base.ts` + `feature-check.ts` — add the finding code (`L4.feature-receipt-confidence`, `error`, unsuppressible like its siblings) and map the new rejection reason in the existing `codeByReason` record (the exhaustive `Record<FeatureReceiptRejection, FindingCode>` makes the mapping compile-checked).
4. `packages/app/src/index.ts` — export the new constant/type beside `FEATURE_RECEIPT_SCHEMA_VERSION`.
5. `plugins/sp/scripts/feature-verification-steps.ts` — accept `--confidence <HIGH|MEDIUM|LOW>` and `--ack-low-confidence`, threading both into the operation (this entry owns argv only, never validation logic).
6. `apps/cli/config/workflows/feature-verification.yaml` — vars `confidence: ""` and `ackLowConfidence: "false"`; the verifier invocation adds `--confidence "$confidence"` always and `--ack-low-confidence` only when `ackLowConfidence = true`, keeping the command inside the repo's shell-length rule. No transition-guard change: the gate is the completion boundary (`feature check` / the transition gate), not the workflow edge — the workflow still fails only when the pass itself fails.
7. Tests — `packages/app/tests/workflow/feature-verification-run.test.ts` (three derivations + the explicit override), `packages/app/tests/workflow/feature-verification-receipt.test.ts` (round-trip; LOW rejected; LOW + acknowledgement accepted; absent rejected; HIGH/MEDIUM accepted), `packages/app/tests/services/feature-transition.test.ts` (the new reason surfaces as its L4 finding and blocks `verifying → done`).
8. Docs — a dated entry under the ADR that owns the receipt contract (find it; ADR-119 is the feature-verification ADR) recording the derivation, the refusal rule, and the deliberate migration cost: **an existing PASS receipt without a level is refused at the next `verifying → done`, and the repair is one re-run of the pass** (no cutoff is added; unlike the verdict-artifact rule there is one receipt per feature run, so the refuse-and-re-run answer is cheaper than a date-keyed exemption).

**Anti-patterns.** Do not add a CLI flag to `feature check`/`feature update`: the acknowledgement lives on the receipt so it is durable and auditable. Do not derive a level from anything the pass does not measure (no model opinion, no finding counts). Do not weaken an existing rejection reason or reorder the validator's checks. Do not bump the schema version. Do not touch `apps/web/tests/test-helpers/board-build.ts`, `plugins/sp/lib/inline-run.generated.mjs` or `scripts/commands/run-tests.ts` — they carry another session's uncommitted work.

**Evidence required.** The three suites above green; `bun run typecheck`; `bun run lint`; `bun apps/cli/src/index.ts rule run --preset recommended-pre-check --fail-on warning --no-logo`; and one end-to-end probe: run `feature-verification.yaml` in a scratch project (or the repo's own fixture) and show the receipt JSON with `confidence`/`confidenceBasis` plus the `feature check` refusal for a LOW receipt. Regenerate the plugin bundle with `bun run build:plugin-lib` only when the app surface is final, and never revert the other session's copy of that file.

**Budget.** ~4 h, `mutationPolicy: code`.

### Plan

- [ ] R1/R2: receipt fields + `FEATURE_RECEIPT_CONFIDENCE_LEVELS` + writer/parser support; run-side derivation with the override; export from `packages/app/src/index.ts`.
- [ ] R3/R4: `unacknowledged-low-confidence` rejection in the validator, the new finding code and its `codeByReason` mapping, then the two run/check suites extended.
- [ ] R2: argv flags in `plugins/sp/scripts/feature-verification-steps.ts` and the two vars in `apps/cli/config/workflows/feature-verification.yaml`.
- [ ] R5: tests for the derivation, the round-trip and the gate; `typecheck` + `lint` + the pre-check rule preset.
- [ ] Evidence: end-to-end receipt probe (confidence + basis) and a `feature check` refusal for a LOW receipt, recorded in `## Testing`; ADR entry in the owning ADR.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
