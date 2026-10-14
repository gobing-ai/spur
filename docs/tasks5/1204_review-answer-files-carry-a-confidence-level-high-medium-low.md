---
schema_version: 1
name: Review answer files carry a confidence level (HIGH/MEDIUM/LOW)
status: wip
template: standard
created_at: 2026-10-14T03:44:43.514Z
updated_at: "2026-10-14T03:57:36.288Z"

---

## 1204. Review answer files carry a confidence level (HIGH/MEDIUM/LOW)

### Background

Captured from the creation title: "Review answer files carry a confidence level (HIGH/MEDIUM/LOW)".

### Requirements

- [ ] R1. The review answer file (`.spur/run/<runId>-review-answer.txt`) carries a `Confidence: HIGH|MEDIUM|LOW` line (exactly one, alongside `Verdict:`), using the verify chain's semantics: HIGH = the reviewer re-executed the checks behind the verdict, MEDIUM = partial reliance on prior/external evidence, LOW = key evidence not re-executed.
- [ ] R2. The authoring contract is updated where the review answer format is documented (`plugins/sp/commands/dev-review.md`), so `/sp:dev-review --auto` pipeline dispatches write the line.
- [ ] R3. Both review PASS edges (`review → verify` under `profile=auto`, `review → approve`) fire only on a graded PASS: the guard admits `Confidence: HIGH|MEDIUM`, and admits LOW or a missing line only when `ackLowConfidence=true`; anything else fails closed into `review-fail-triage` (never a silent pass).
- [ ] R4. Regression tests pin the policy: HIGH/MEDIUM proceed without ack; LOW/absent are refused without the ack and admitted with it; refusal rides the existing fail-closed catch-all, not a new terminal state.

### Acceptance Criteria

- Scenario: AC1 — a graded HIGH PASS proceeds (req: R1, R3). Given a fixture review answer with `Verdict: PASS` and `Confidence: HIGH`, when the rendered `review → verify` guard runs, it exits 0.
- Scenario: AC2 — an ungraded PASS cannot cross a PASS edge without the ack (req: R3). Given answers with `Confidence: LOW` or no confidence line, the `review → verify` and `review → approve` guards exit nonzero while `ackLowConfidence` is empty and exit 0 with `ackLowConfidence=true`.
- Scenario: AC3 — the contract names the line (req: R2). `plugins/sp/commands/dev-review.md` documents the exact `Confidence:` line and its three values in the answer-file schema.
- Scenario: AC4 — the policy is pinned (req: R4). `task-pipeline-proof-chain.test.ts` asserts both PASS guards carry the graded-confidence predicate and executes the rendered guards against fixture answers.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-14T03:46:18.277Z

- Q: Lint service (`verify-answer-lint.ts` style) vs shell guard? A: Shell guard inside the PASS edges — the review hop already classifies answers with shell greps behind a fail-closed catch-all (`review-fail-triage`); a missing/LOW line simply cannot take a PASS edge. No new lint surface, no new terminal state.
- Q: Does LOW hard-block? A: It blocks only the PASS edges; the bounded repair hop re-reviews under its existing retry budget, and the operator-only `ackLowConfidence` var admits a LOW/absent PASS deliberately (same var, same semantics as the verify chain). Review stays advisory — verify still certifies (0710 R2 unchanged).
- Q: Stamp review confidence on a check row (like verify's confidence row)? A: Deferred — that is telemetry, not verification; the answer file and guards carry the contract. Revisit if the record sweep should aggregate it.

### Design

Mirror of task 1068's verify-confidence chain applied to the review hop. The two PASS edges (`config/workflows/task-pipeline.yaml`, `review → verify` and `review → approve`) gain one predicate in their existing `&&` chain: admit `Confidence: HIGH|MEDIUM` via the same tolerant grep used for `Verdict:`, with `[ "$ackLowConfidence" = "true" ]` as the only escape (absent = fail-closed, matching verify's `(.confidence // "LOW")`). `plugins/sp/commands/dev-review.md` gains the answer-schema mandate. No TS changes, no new artifacts, no new pipeline state; the catch-all description is updated to name the ungraded-PASS case.

### Plan

1. Tests first (red): extend `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` with a review-confidence block — static predicate assertions plus behavioral runs of the rendered PASS guards against fixture answers (residual-scan stubbed via the script-root json, per the existing execution style).
2. `config/workflows/task-pipeline.yaml`: add the graded-confidence predicate to both PASS edges; update the routing comment and the catch-all description to name the ungraded/LOW PASS case.
3. `plugins/sp/commands/dev-review.md`: add the `Confidence:` mandate to the answer-file schema.
4. Focused gates: proof-chain suite, biome on touched files, `spur task check 1204`; regenerate any generated twin of the touched surfaces if one exists.

### Solution

- `config/workflows/task-pipeline.yaml` (review→verify ~:1326, review→approve ~:1337): graded-PASS predicate `( grep -qiE 'Confidence: *(HIGH|MEDIUM)' <answer> || [ "$ackLowConfidence" = "true" ] )` inserted between the Verdict grep and the residual-scan eval; routing comment, both edge descriptions and the catch-all description now name the ungraded/LOW case. Subshell parens keep the one-AND-list property (no `;`, pinned by the 1122 test).
- `plugins/sp/commands/dev-review.md`: new "Answer contract (pipeline dispatches)" bullet — exactly one `Verdict:` and one `Confidence:` line, verify-chain semantics, LOW/absent crosses only with `ackLowConfidence`.
- `plugins/sp/agents/super-reviewer.md`: "Machine-checked at the gate" paragraph corrected — the scanner owns presence/enum (`review-contract`), the PASS edges own value grading + ack (1204).
- `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts`: new "review confidence gate (task 1204)" describe — static predicate pins + 12-cell behavioral matrix executing the rendered guards against fixture answers (real residual scanner, stub spur); 1122-era fixtures graded and adjacency assertions updated.
- Discovery: presence/enum was ALREADY machine-checked at these edges by `residual-scan review-gate` (`packages/app/src/services/residual-scan.ts:338` → blocking `review-contract`). The genuine gap was value grading: a LOW PASS crossed exactly like HIGH. 1204 mirrors the verify chain's two-layer split (scanner≈lint, guard predicate≈completion-guard jq).

### Testing

- `bun test tests/workflow/task-pipeline-proof-chain.test.ts` (packages/app): 36/36 pass (3 new tests; red-first confirmed — HIGH fixture failed before the YAML change).
- Regression ring: packages/config `bundled-config.test.ts` (12), packages/domain `validator.test.ts` + `lifecycle-drift.test.ts` (62) — all pass.
- `biome check` on the touched test file: clean. `tsc --noEmit` (packages/app): clean.
- Bundled twin `apps/cli/config/workflows/task-pipeline.yaml` (ignored artifact) regenerated via `bundle-config config`; byte-identical to SSOT.
- `spur task check 1204`: PASS (1 WARN — standalone task, no feature_id; same shape as task 1068).
- Not covered: a live pipeline run end-to-end; guard semantics are exercised via rendered-guard execution with the real scanner instead.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-14T03:57:35.949Z backlog → todo (system)
- 2026-10-14T03:57:36.288Z todo → wip (system)

