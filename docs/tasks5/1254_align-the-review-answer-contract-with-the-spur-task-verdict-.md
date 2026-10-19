---
schema_version: 1
name: Align the review answer contract with the spur task verdict vocabulary
status: todo
template: issue
created_at: 2026-10-18T19:33:15.525Z
updated_at: "2026-10-19T06:37:44.180Z"

feature_id: F91
priority: P1
ac_altitude: task-local
estimate_hours: 4
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

- [ ] R1. The review-stage prompt states the existing exact requirement/AC table headers, MET/PARTIAL/UNMET statuses (plus N/A for AC), evidence-type tokens including + compounds, and one row per declared requirement/AC. The captured answer itself contains these tables and exactly one plain Verdict line.
- [ ] R2. The prompt distinguishes the Review section's disposition-derived confidence from the certification answer's evidence-derived confidence, using the existing deriveReviewConfidence and deriveVerifyConfidence formulas without changing either policy. A carried nonblocking residual can produce Review MEDIUM and certification HIGH.
- [ ] R3. Teach task AC identity separately from feature scenario credit: canonical exact scenario titles or existing AC-N feature aliases for covering tasks; task-local identities remain legal and no feature-credit requirement is invented for an unlinked/non-covering task. No new accepted ID forms.
- [ ] R4. Regression tests execute the real task verdict certification path for the documented answer, preserve blocking review residual behavior, and reject prose-only, invalid-vocabulary and missing-row answers without manufacturing PASS.

Out of scope: model retry orchestration, new CLI flags/verbs, new workflow states/status/terminal-reason vocabularies, blanket matcher unification, confidence policy changes, reconstructing answers from rendered task sections, and product-code remediation.

### Acceptance Criteria

- [ ] AC1 — A documented answer certifies through the real task verdict path without normalization (req: R1, R3, R4)
- [ ] AC2 — Review MEDIUM and certification HIGH coexist for executable AC with one carried P4 (req: R2, R4)
- [ ] AC3 — Prose-only and invalid rows remain non-PASS, and an open P1-P3 still blocks completion (req: R4)

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

- [ ] 1. Add a failing prompt-contract assertion for vocabulary and the two confidence lanes (R1-R3).
- [ ] 2. Extend the existing certification fixture with executable AC + accepted/open P4: Review MEDIUM, captured answer HIGH, task verdict PASS; assert open P1-P3 still blocks (R2, R4).
- [ ] 3. Repair only canonical review producer instructions; preserve artifact paths and stage order (R1-R3).
- [ ] 4. Run malformed/prose-only/missing-row negatives through the existing real CLI fixture; no PASS and no new model dispatch (R4).
- [ ] 5. Run focused app pipeline/lint/confidence and plugin contract tests inside their workspaces, rebuild bundle, validate task-pipeline and run the task-owned gate. Update owning contract text only if changed. Record real evidence before completion.

### Root Cause

The review agent produces two artifacts with different consumers: Review is checked against finding dispositions, but the captured final answer is fed to task verdict and checked against requirement/AC evidence. `config/workflows/task-pipeline.yaml:637-646` teaches only the former confidence formula for the latter artifact. `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:462-511` already demonstrates a Review MEDIUM alongside a certification HIGH; the prompt does not teach this existing separation.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
