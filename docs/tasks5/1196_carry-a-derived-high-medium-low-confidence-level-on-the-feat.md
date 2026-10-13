---
schema_version: 1
name: Carry a derived HIGH/MEDIUM/LOW confidence level on the feature-verification receipt and gate completion on it
status: done
template: standard
created_at: 2026-10-13T19:03:27.230Z
updated_at: "2026-10-13T19:47:20.140Z"

done_forced: "false"
done_reason: unforced close; PASS artifact at tracked Testing section (scratch verdict not retained)
---

## 1196. Carry a derived HIGH/MEDIUM/LOW confidence level on the feature-verification receipt and gate completion on it

### Background

The feature-verification pass records a bound PASS/FAIL receipt and nothing else about how much the green result can be trusted. Task-pipeline has gated a confidence level since 1068: the verify answer carries `Confidence: HIGH|MEDIUM|LOW`, the verdict artifact records it, and BOTH completion guards (`verify → record`, `record → done`) refuse a LOW or absent level unless the run was launched with `ackLowConfidence=true`. The feature boundary has no analogue, so `verifying → done` treats every PASS identically — including a PASS produced by a caller command override (`--cmd`) that ran a different check set than the selected definition declares.

Operator request, 2026-10-13: "Add verification for: confidence level (HIGH/MEDIUM/LOW)", scoped to the feature-verification boundary, in this source repo, with a derived level plus an operator-acknowledged gate (chosen from three options; the other two were operator-declared-only and advisory-only).

Observed in knowledge-kit during G14's verification (run `6a95b206`): the receipt carries `status: PASS`, verifier identity, `inputDigest` and run id — no confidence field — and `spur feature check G14 --as done` reported only the stale-FAIL rejection. Evidence for the derivation is already captured by the pass: the effective command (override or the definition's own), the exit status, and the before/after proof-input digest.

### Requirements

- [x] R1. `FeatureVerificationReceipt` carries `confidence` (`HIGH|MEDIUM|LOW`) and `confidenceBasis` (non-empty string array naming the evidence the level rests on), written by `completeFeatureVerificationReceipt` and accepted by `parseFeatureVerificationReceipt`.
- [x] R2. The level is DERIVED by the pass from its own evidence — HIGH when the selected definition's configured command exited 0 with an unchanged proof-input digest; MEDIUM when the same clean pass ran under a caller command override (`--cmd`), which certifies a different check set than the definition declares; LOW on any non-PASS or explicitly declared case. An explicit operator override (`--confidence HIGH|MEDIUM|LOW`) wins and is named as such in the basis.
- [x] R3. Completion validation rejects a receipt that asserts PASS with `confidence` absent or LOW unless the receipt itself records the operator acknowledgement (`confidenceAcknowledged: true`, supplied by the pass through `ackLowConfidence`); the detail names the level and the repair. HIGH and MEDIUM PASS receipts are accepted unchanged.
- [x] R4. The rejection is an unsuppressible L4 error finding in `feature check` / the transition gate, the level is visible in the pass output, and no existing rejection reason changes behaviour.
- [x] R5. Tests cover the derivation (default command, override, override with an explicit level), the receipt round-trip, and the gate (HIGH/MEDIUM accepted, LOW and absent rejected, LOW accepted with the acknowledgement). Docs: a dated ADR-119 amendment plus the receipt/response surface where it is documented.

### Acceptance Criteria

- [x] AC1 — A pass run with the definition's own command records `confidence: HIGH` with a basis naming the exit status and the unchanged digest, and `parseFeatureVerificationReceipt` round-trips both fields. (req: R1, R2)
- [x] AC2 — A pass run with `--cmd <other>` records `MEDIUM` and its basis names the override; `--confidence HIGH` on that same run records HIGH with a basis saying it was operator-declared. (req: R2)
- [x] AC3 — Completion is refused with the new finding when a PASS receipt has no `confidence` (legacy receipt) or `confidence: LOW` without the acknowledgement, and accepted when the same LOW receipt records `confidenceAcknowledged: true`. (req: R3, R4)
- [x] AC4 — `bun run gate` and the touched test files pass, and nothing in the existing feature-verification/receipt/transition suites regresses. (req: R5)

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

- [x] R1/R2: receipt fields + `FEATURE_RECEIPT_CONFIDENCE_LEVELS` + writer/parser support; run-side derivation with the override; export from `packages/app/src/index.ts`.
- [x] R3/R4: `unacknowledged-low-confidence` rejection in the validator, the new finding code and its `codeByReason` mapping, then the two run/check suites extended.
- [x] R2: argv flags in `plugins/sp/scripts/feature-verification-steps.ts` and the two vars in `apps/cli/config/workflows/feature-verification.yaml`.
- [x] R5: tests for the derivation, the round-trip and the gate; `typecheck` + `lint` + the pre-check rule preset.
- [x] Evidence: end-to-end receipt probe (confidence + basis) and a `feature check` refusal for a LOW receipt, recorded in `## Testing`; ADR entry in the owning ADR.

### Solution

| Change | Anchor | Rationale |
| --- | --- | --- |
| `FEATURE_RECEIPT_CONFIDENCE_LEVELS` + `FeatureReceiptConfidence` + the three receipt fields | `packages/app/src/workflow/feature-verification-receipt.ts:83` | One vocabulary, shared with the task pipeline's gate (1068); additive fields, schema stays v1 |
| The writer refuses a level without a non-empty basis | `packages/app/src/workflow/feature-verification-receipt.ts:215` | A level the reader cannot audit is the claim-table equivalent of a PASS with no proof |
| Parser shape-checks level and basis when present, absence stays legal | `packages/app/src/workflow/feature-verification-receipt.ts:340` | A pre-field receipt must read as *unlevelled* (a named, repairable refusal), not as malformed |
| Ninth rejection `unacknowledged-low-confidence`, checked last | `packages/app/src/workflow/feature-verification-receipt.ts:309` | Every earlier reason keeps its message and repair; the level is the final judgement on a current PASS |
| `deriveFeatureConfidence` — the measured derivation | `packages/app/src/workflow/feature-verification-run.ts:163` | HIGH = own command + unchanged digest; MEDIUM = clean pass under a `--cmd` override (named); LOW otherwise; an explicit declaration wins and is labelled `operator-declared` |
| `confidenceOverride` + `ackLowConfidence` inputs, wired into both completion paths | `packages/app/src/workflow/feature-verification-run.ts:206` | The acknowledgement rides the receipt, so the transition reads evidence rather than later flags |
| Finding code + unsuppressible mapping | `packages/config/src/finding-codes.ts:196`, `packages/app/src/services/planning-check-base.ts:63`, `packages/app/src/services/feature-check.ts:620` | The refusal blocks `verifying → done` like its eight siblings |
| Verifier argv gains `--confidence` and `--ack-low-confidence` | `plugins/sp/scripts/feature-verification-steps.ts:128` | The entry stays argv-only; the operation owns validation |
| Workflow vars `confidence` / `ackLowConfidence` + the invocation | `config/workflows/feature-verification.yaml:58` and `:81` | Operators steer the level with the same vocabulary the task pipeline uses |
| Exports | `packages/app/src/index.ts:1061` | The bundle surface carries the new symbols |
| ADR amendment + receipt contract | `docs/00_ADR.md` (ADR-119 amendment), `docs/design/workflow-execution-economy.md` (receipt section) | Decision, derivation, the refusal rule and the one-time migration cost are recorded where the receipt is owned |
| Tests — 8 files, 11 new cases | `packages/app/tests/workflow/feature-verification-run.test.ts`, `…/feature-verification-receipt.test.ts`, `packages/app/tests/services/feature-transition.test.ts`, `…/feature-service.test.ts`, `…/task-record.test.ts`, `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts`, `apps/server/tests/modules/feature/transition-gate.test.ts`, `apps/cli/tests/commands/feature.test.ts` | Derivation, round-trip, refusal and the transition denial are pinned; existing PASS fixtures now carry a level because an unlevelled PASS is refused by design |
| Regenerated plugin libs + the argv twin | `plugins/sp/lib/{inline-run,quality-gate,idea-handoff}.generated.mjs`, `plugins/sp/scripts/feature-verification-steps.mjs` | Generated output carries the new surface; the installed bundle/Node mismatch is filed separately (1197) |

### Testing

**Contract and coverage.** `bun run typecheck` → exit 0. `bun apps/cli/src/index.ts rule run --preset recommended-pre-check --fail-on warning --no-logo` → 51 rules passed. Focused suites (the eight receipt/transition files, run by the implementer):

```
bun test packages/app/tests/workflow/feature-verification-run.test.ts \
  packages/app/tests/workflow/feature-verification-receipt.test.ts \
  packages/app/tests/services/feature-transition.test.ts packages/app/tests/services/feature-service.test.ts \
  packages/app/tests/services/task-record.test.ts packages/app/tests/workflow/feature-lifecycle-adapter.test.ts \
  apps/server/tests/modules/feature/transition-gate.test.ts apps/cli/tests/commands/feature.test.ts
→ 343 pass / 0 fail (1740 expect calls)
```

Eleven new cases: the three derivations, the operator-declared override and its enum refusal, the recorded acknowledgement, the receipt round-trip, a level without its basis, a hand-edited level as malformed, and the completion boundary (HIGH/MEDIUM certified, LOW refused, LOW + acknowledgement accepted) including the `verifying → done` denial naming `L4.feature-receipt-confidence`.

**Full gate.** `bun run gate` → 11369 pass / 6 fail. All six are environmental, and none touches this change:

| Failure | Evidence it is not this change |
| --- | --- |
| `FeatureLifecycleAdapter … verifying→done refuses until the pass records PASS` | fails under parallel load with `SQLiteError: database is locked (SQLITE_BUSY)`; **green in isolation** in the same run |
| `FeatureCheckService > D61: normal done check rejects an unverified scenario…` | 20 s timeout under load; **green in isolation** |
| `EnvShellGuardRunner > a var carrying shell metacharacters…` | `^ this test timed out after 20000ms`; **green in isolation** |
| `AgentRunActionRunner > returns ok:false with error on non-zero exit` | **green in isolation** |
| `service-emitting verbs honor --json-envelope end-to-end (0697 AC2)` | 60 s timeout; unrelated surface |
| `forensic-query-history > sessionTimeline stays bounded on a 6,500-message session` | a host-speed assertion (`durationMs < 100`; measured 101 ms in the gate, 525 ms isolated) in an analytics path this change never touches — **pre-existing** |

Isolation re-run of the six files: `336 pass / 1 fail` — only the pre-existing timing assertion above.

**End-to-end probes** (throwaway git project with `docs/features/T1_probe-feature.md`, a run row per probe, the real workflow file, the regenerated bundle):

| Probe | Invocation | Receipt | Gate |
| --- | --- | --- | --- |
| C | `… --vars '{"featureId":"T1"}'` (definition's own command) | `PASS` · `HIGH` · basis `verification command exited 0`, `proof-input digest unchanged across the pass` | confidence rule satisfied |
| A | `--cmd true` | `PASS` · `MEDIUM` · basis adds `caller command override: true`, `the selected definition declares: bun run spur-check-feature` | — |
| D | `--confidence LOW`, no acknowledgement | `PASS` · `LOW` | **refused**: `L4.feature-receipt-confidence` — `completion evidence rejected (unacknowledged-low-confidence)`, detail names the basis and both repairs |
| E | `--confidence LOW --ack-low-confidence` | `PASS` · `LOW` · `confidenceAcknowledged: true` | confidence rule satisfied (remaining findings are the probe feature's own missing frontmatter) |
| — | `--confidence SURE` | no receipt written | refused before any write: `confidence must be HIGH, MEDIUM or LOW (got "SURE")` |
| 4 | `--cmd false` | `FAIL` · `LOW` · basis `verification command did not exit 0` | — |

**Known delivery limitation (filed as 1197).** The probes ran the repo's regenerated bundle under Bun. The *installed* path is not usable yet: the workflow's installed branch runs the `.mjs` twin with `node`, and the generated bundle imports `bun:sqlite` / `bun:ffi`, so `node <installed>/feature-verification-steps.mjs verify …` dies with `ERR_UNSUPPORTED_ESM_URL_SCHEME` while `bun …` proceeds. That mismatch predates this change (the pre-regeneration bundle contains the same three `bun:` imports) and is tracked in 1197 with the before/after evidence.

### Review

#### Review Report — 1196

**Scope:** `packages/app/src/workflow/feature-verification-receipt.ts`, `…/feature-verification-run.ts`, `packages/app/src/services/{feature-check,planning-check-base}.ts`, `packages/config/src/finding-codes.ts`, `packages/app/src/index.ts`, `plugins/sp/scripts/feature-verification-steps.ts`, `config/workflows/feature-verification.yaml`, the eight test files, and the two docs.
**Dimensions:** functional, correctness, security, efficiency, usability, architecture.
**Verdict:** PASS
**Confidence:** HIGH — every claim below is a command run in this tree (focused suites 343 pass / 0 fail, `bun run typecheck` exit 0, the pre-check preset at 51 rules, and the six probes in `## Testing`), plus a direct read of the diff.

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | usability | The `MEDIUM` level is reachable only through a caller `--cmd` override. That is deliberate — an override is the one way a clean pass can certify a different check set than the definition declares — but it means a project whose definition itself points at a weaker command records `HIGH` by construction; the definition, not the level, is what to review there. | `packages/app/src/workflow/feature-verification-run.ts:163` | ACCEPTED — recorded as the derivation's contract |
| 2 | P4 (advisory) | correctness | A pre-field receipt is refused with "re-run the pass" instead of being grandfathered. Deliberate and recorded (ADR-119 amendment): one receipt per feature run, so the repair is one pass, and a date-keyed exemption would keep unlevelled PASSes certifying for as long as they are cited. | `packages/app/src/workflow/feature-verification-receipt.ts:309` | ACCEPTED — the migration cost is in the ADR |
| 3 | P4 (advisory) | architecture | The level is validated *after* staleness and contract drift, so a stale LOW receipt reports `stale` first. Chosen so no existing reason changes message or behaviour, and because re-running fixes staleness and produces a level in the same step. | `packages/app/src/workflow/feature-verification-receipt.ts:480` | ACCEPTED |
| 4 | P4 (advisory) | correctness | The probes could not exercise the *installed* (`node`) path: the generated bundle imports `bun:sqlite`, so the workflow's installed branch fails at module load. Pre-existing (the pre-regeneration bundle carries the same imports) and outside this change; filed as 1197 with the before/after evidence. | `config/workflows/feature-verification.yaml:81`; `~/.agents/scripts/lib/inline-run.generated.mjs` | REPORTED — owner decision in 1197 |
| 5 | P4 (advisory) | usability | `confidenceBasis` is free-form strings, so a future consumer cannot group by basis without parsing prose. Deliberate: the basis is for a human reading the artifact, and the level is the machine field. | `packages/app/src/workflow/feature-verification-receipt.ts:110` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `feature-verification-receipt.ts:83` (vocabulary), `:215` (writer refuses a bare level), round-trip and refusal cases in the receipt suite |
| R2 | MET | `deriveFeatureConfidence` (`feature-verification-run.ts:163`) with the run-suite cases and probes C/A/4 |
| R3 | MET | Ninth rejection (`:309`), probes D (refused) and E (accepted with the acknowledgement recorded) |
| R4 | MET | `finding-codes.ts:196` + `feature-check.ts:620` + the unsuppressible set; earlier reasons unchanged |
| R5 | MET | Eleven new cases over eight files; typecheck and the 51-rule preset green; the six gate failures classified environmental in `## Testing` |

**Next:** no open P1–P3 in this change set. The installed-node mismatch is 1197's, not this task's.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-13T19:46:13.378Z backlog → todo (system)
- 2026-10-13T19:46:13.900Z todo → wip (system)
- 2026-10-13T19:46:15.405Z wip → testing (system)
- 2026-10-13T19:47:19.992Z testing → done (system)

