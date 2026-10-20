---
schema_version: 1
name: Align the review answer contract with the spur task verdict vocabulary
status: done
template: issue
created_at: 2026-10-18T19:33:15.525Z
updated_at: "2026-10-20T02:31:34.595Z"

feature_id: F91
priority: P1
ac_altitude: task-local
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1254-verdict.json
---

## 1254. Align the review answer contract with the spur task verdict vocabulary

### Background

The merged review/certification stage has a reproducible producer-contract mismatch. `config/workflows/task-pipeline.yaml:637-646` specifies the table headers but omits row status/evidence vocabularies and feature-credit guidance. It also asks the captured certification answer for confidence derived from finding dispositions, while `packages/app/src/services/verify-answer-lint.ts:163-203` checks that answer with deriveVerifyConfidence. The authored Review section is independently checked with deriveReviewConfidence by `packages/app/src/services/residual-scan.ts:363-377`. A PASS with executable AC and a carried P4 legitimately derives HIGH in the certification answer and MEDIUM in Review. A direct current-tree call to both derivations reproduced that distinction.

**Refine corrections (2026-10-18)**
- Valid: incomplete review-stage answer instructions and use of the wrong confidence lane for its captured certification answer.
- Removed: model re-asks inside task verdict (deterministic CLI ownership violation), certifying prose with tables elsewhere (contradicts the answer-file gate), unconditional acceptance of MEDIUM for any OPEN row (open P1-P3 remains blocking), and an unproven requirement to merge every AC matcher. Task AC identity and feature credit are distinct contracts; the checkbox bare-title defect is already fixed at `packages/app/src/services/task-record.ts:365-389`.
- Historical run IDs from the filing are context, not independently re-established runtime evidence. Current code and existing certification tests establish the defect without depending on archived stdout.
- Task-local AC is explicit because these regressions are narrower than F91's ship scenarios. No feature link changes. Estimate previously unset → 4h after removing retry/identity redesign scope.

### Requirements

- [x] R1. The review-stage prompt states the existing exact requirement/AC table headers, MET/PARTIAL/UNMET statuses (plus N/A for AC), evidence-type tokens including + compounds, and one row per declared requirement/AC. The captured answer itself contains these tables and exactly one plain Verdict line.
- [x] R2. The prompt distinguishes the Review section's disposition-derived confidence from the certification answer's evidence-derived confidence, using the existing deriveReviewConfidence and deriveVerifyConfidence formulas without changing either policy. A carried nonblocking residual can produce Review MEDIUM and certification HIGH.
- [x] R3. Teach task AC identity separately from feature scenario credit: canonical exact scenario titles or existing AC-N feature aliases for covering tasks; task-local identities remain legal and no feature-credit requirement is invented for an unlinked/non-covering task. No new accepted ID forms.
- [x] R4. Regression tests execute the real task verdict certification path for the documented answer, preserve blocking review residual behavior, and reject prose-only, invalid-vocabulary and missing-row answers without manufacturing PASS.

Out of scope: model retry orchestration, new CLI flags/verbs, new workflow states/status/terminal-reason vocabularies, blanket matcher unification, confidence policy changes, reconstructing answers from rendered task sections, and product-code remediation.

### Acceptance Criteria

- [x] AC1 — A documented answer certifies through the real task verdict path without normalization (req: R1, R3, R4)
- [x] AC2 — Review MEDIUM and certification HIGH coexist for executable AC with one carried P4 (req: R2, R4)
- [x] AC3 — Prose-only and invalid rows remain non-PASS, and an open P1-P3 still blocks completion (req: R4)

### Q&A

- Closed: task verdict remains deterministic; no re-ask flag or hidden agent call.
- Closed: preserve both ADR-141 lane derivations; fix which instructions reach each artifact.
- Closed: no identity-policy redesign without a failing accepted-form fixture.
- Delegation: implementation only after this refinement; no implementation or PASS certification claimed here.

### Design

Chosen: repair the producer instructions and pin the existing consumer contracts; no new API. Change the review agent.run input in `config/workflows/task-pipeline.yaml`, retaining current answerFile/expectFile paths, fresh reviewer independence and action order. Spell the small vocabulary directly in the prompt, with a contract test against the existing accepted tokens rather than exporting a new public constant solely for YAML. The final captured answer uses verify confidence; Review uses review confidence. Keep task verdict a pure deterministic lint/derive/write command.

Primary targets: `config/workflows/task-pipeline.yaml`; `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts`; `plugins/sp/tests/task-pipeline-resilience.test.ts`; canonical `plugins/sp/agents/super-reviewer.md` only if its output guidance conflicts; owning certification contract `docs/design/planning-workflow-contracts.md` if its contract text changes. Tests for the linter/confidence functions may add a narrow fixture but production matchers are not refactored. Rebuild generated CLI config through build:bundle; do not hand-edit installed adapters.

Algorithm: normal review → author Review with dispositions → captured final answer with requirement/AC evidence and verify-derived confidence → existing task verdict → existing residual review gate → approval. Assert the two confidence values independently in the fixture. Negative answers fail deterministically and retain lint diagnostics; do not consume a new repair budget or silently normalize them.

Rejected: new prompt generators, a new schema API, model work in CLI, deriving PASS from task-section prose, weakening evidence/scenario-credit rules. Dependencies: none; use current D65 merged review stage. Handoff to 1256: runtime dispatch failure classification remains that task's ownership, not answer-format remediation. Execution budget 4h; persisted output is prompt/contract-test diff plus standard task evidence.

### Plan

- [x] 1. Add a failing prompt-contract assertion for vocabulary and the two confidence lanes (R1-R3).
- [x] 2. Extend the existing certification fixture with executable AC + accepted/open P4: Review MEDIUM, captured answer HIGH, task verdict PASS; assert open P1-P3 still blocks (R2, R4).
- [x] 3. Repair only canonical review producer instructions; preserve artifact paths and stage order (R1-R3).
- [x] 4. Run malformed/prose-only/missing-row negatives through the existing real CLI fixture; no PASS and no new model dispatch (R4).
- [x] 5. Run focused app pipeline/lint/confidence and plugin contract tests inside their workspaces, rebuild bundle, validate task-pipeline and run the task-owned gate. Update owning contract text only if changed. Record real evidence before completion.

### Root Cause

The review agent produces two artifacts with different consumers: Review is checked against finding dispositions, but the captured final answer is fed to task verdict and checked against requirement/AC evidence. `config/workflows/task-pipeline.yaml:637-646` teaches only the former confidence formula for the latter artifact. `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:462-511` already demonstrates a Review MEDIUM alongside a certification HIGH; the prompt does not teach this existing separation.

### Solution

Repaired the review stage's producer instructions so each of its two artifacts states the confidence
level its own consumer derives, and pinned the consumer vocabularies with tests.

| File | Change |
| --- | --- |
| `config/workflows/task-pipeline.yaml:641-654` | Replaced the review `agent.run` answer contract: it names the two artifacts (the `## Review` section → `deriveReviewConfidence`; the captured answer → `deriveVerifyConfidence`), states the exact `| Req | Status | Evidence |` / `| AC | Status | Evidence Type | Evidence |` tables and status/evidence vocabularies, requires one `Verdict:` and one evidence-derived `Confidence:` line in the captured answer, and forbids repeating the section's disposition line. Kept inside the 1000-char composition cap by pointing at the owning doc for the exhaustive wording. |
| `plugins/sp/agents/super-reviewer.md:246-273` | The owning producer contract now carries the full certification-answer shape (both tables, statuses, the six evidence-type tokens plus `+` compounds, AC identity vs feature credit, the one-`Confidence:`-line rule) and names the legitimately differing levels (answer HIGH over executable AC with a carried P4, section MEDIUM). |
| `plugins/sp/skills/code-verification/references/verdict-schema.md:67-73` | ADR-141 section now states that a review run carries two answer artifacts with one `Confidence:` line each, that the levels legitimately disagree, and that a repeated line is `confidence-duplicate`. |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:747-964` | New `1254` suite: prompt-contract assertions (tables, statuses, one-row rules, ≤1000-char prompt, pointer to the owner), evidence-token parity driven through the real `lintVerifyAnswer`, AC-identity/feature-credit assertions, and two behavioral tests through the real CLI (carried P4 → section MEDIUM + verdict HIGH + close reachable + open P1-P3 still blocks; prose-only / invalid-vocabulary / missing-row answers stay non-PASS with their diagnostics). |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:375-406` | Structural twin: the YAML prompt teaches both lanes and points at the owner; the owner doc carries the full contract. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/task-pipeline.yaml:662-671` review input states both exact table headers, MET/PARTIAL/UNMET (N/A for AC), evidence-type tokens with `+` compounds, one row per requirement/AC and one Verdict line; `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:814` and `:833` pin it (anchors re-read 2026-10-19 force re-verify; prior :646-654 drifted) |
| R2 | MET | `config/workflows/task-pipeline.yaml:663-666` names deriveReviewConfidence for the Review section and deriveVerifyConfidence for the captured answer; `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:854` and `:861` assert both lanes in one run |
| R3 | MET | `config/workflows/task-pipeline.yaml:670-671` keys AC rows on task identities or a declared `AC-N` alias and states a task-local criterion needs no feature credit; `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:845` pins it |
| R4 | MET | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:861` and `:945` run the real task verdict --from-answer path, keep the open P1-P3 review-gate block, and reject prose-only, invalid-vocabulary and missing-row answers |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:861` — certified answer derives PASS through the real CLI; re-run this session: `bun test tests/workflow/task-pipeline-proof-chain.test.ts tests/services/task-record.test.ts` 178 pass / 0 fail |
| AC2 | MET | test | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:861` — Review MEDIUM passes the review gate while the answer derives HIGH; `plugins/sp/tests/task-pipeline-resilience.test.ts:382` 31 pass / 0 fail |
| AC3 | MET | test | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:945` three negative answers stay non-PASS; `:914` open P2 keeps review.status FAIL |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1254
**Scope:** task 1254 diff — `config/workflows/task-pipeline.yaml`, `plugins/sp/agents/super-reviewer.md`, `plugins/sp/skills/code-verification/references/verdict-schema.md`, `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts`, `plugins/sp/tests/task-pipeline-resilience.test.ts`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | architecture | The producer/consumer vocabulary now lives in three places (the YAML prompt, the owner doc, `verify-answer-lint.ts`); only the six evidence-type tokens are parity-guarded by a test, so a future token added to the lint alone can drift silently | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:802` | ACCEPTED |
| 2 | P4 (advisory) | usability | The 1000-character composition cap keeps the full contract in `super-reviewer.md`, so a reviewer that ignores the pointer runs on the summary alone — a prose-only mitigation, since the two artifacts are separate files with no deterministic cross-check | `config/workflows/task-pipeline.yaml:646` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `config/workflows/task-pipeline.yaml:646-654` states both table headers, `MET \| PARTIAL \| UNMET` (+ `N/A` for AC), the six evidence-type tokens with `+` compounds, and the one-row rules; `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:802` drives each taught token through the real `lintVerifyAnswer` |
| R2 | MET | `config/workflows/task-pipeline.yaml:649-652` names deriveReviewConfidence for the section and deriveVerifyConfidence for the captured answer; `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:830` asserts both derivations and both real gates on one run |
| R3 | MET | `config/workflows/task-pipeline.yaml:653-654` keys AC rows on the task's identities or a declared `AC-N` alias and states task-local criteria need no feature credit; `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:814` |
| R4 | MET | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:830,914` execute the real `spur task verdict --from-answer` path for the documented answer, preserve the open-P1-P3 review-gate block, and reject prose-only, invalid-vocabulary and missing-row answers with their diagnostics |

**Residual risk:** the two-artifact rule is taught in prose; a reviewer that repeats the section's `Confidence:` line in its final answer is rejected by the lint (`confidence-duplicate`) rather than silently accepted, so the failure is loud and repairable.

**Next:** close 1254 (`record` writes Testing from the PASS verdict; open P1-P3 count is zero).
Confidence: MEDIUM

### References

Refinement audit: 2026-10-18, source-local CLI, tasks 1254–1260 processed sequentially.

Evidence: task-pipeline review input; verify-answer-lint.ts; answer-confidence.ts; task-pipeline-proof-chain.test.ts.

Concurrency snapshot: git worktree list shows main only; task list --status wip returns []; one writer per tree. Recheck both before implementation. The tracked tree advanced to release 0.4.15 during the audit; preserve those external commits. Inspect installed versions/bundle at task start, then regenerate only artifacts affected by implementation.

Implement-ready checklist (specification, not an implementation PASS):

```json
[
  {
    "id": "requirements",
    "pass": true,
    "evidence": "Requirements contain bounded observable outcomes, scope exclusions and named current seams."
  },
  {
    "id": "design",
    "pass": true,
    "evidence": "Design freezes reused contracts, algorithm/precedence, files, negative cases and no-new-surface constraints."
  },
  {
    "id": "plan",
    "pass": true,
    "evidence": "Ordered Plan starts with failing fixtures, then minimal fix and named workspace/gate evidence."
  },
  {
    "id": "ac",
    "pass": true,
    "evidence": "Task-local checkbox ACs map every retained requirement to test-observable outcomes; implementation remains unchecked."
  },
  {
    "id": "decisions",
    "pass": true,
    "evidence": "Q&A closes original design choices; false premises and speculative APIs removed."
  },
  {
    "id": "dependencies",
    "pass": true,
    "evidence": "No unmet design prerequisites; boundaries to adjacent tasks explicit."
  },
  {
    "id": "premises",
    "pass": true,
    "evidence": "task-pipeline review input; verify-answer-lint.ts; answer-confidence.ts; task-pipeline-proof-chain.test.ts"
  }
]
```

### History

- 2026-10-19T06:58:47.205Z todo → wip (system)
- 2026-10-19T07:05:50.258Z wip → testing (system)
- 2026-10-19T07:07:06.598Z testing → wip (system)
- 2026-10-19T07:08:09.790Z wip → testing (system)
- 2026-10-19T07:08:12.448Z testing → done (system)

