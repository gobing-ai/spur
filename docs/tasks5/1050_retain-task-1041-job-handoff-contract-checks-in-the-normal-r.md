---
schema_version: 1
name: Retain task 1041 job-handoff contract checks in the normal repository suite
status: todo
template: issue
created_at: 2026-10-02T05:46:49.743Z
updated_at: "2026-10-02T06:12:00.922Z"
feature_id: D62

priority: P3
ac_altitude: task-local
ac_numbering: task-local
dependencies: ["1041"]
---

## 1050. Retain task 1041 job-handoff contract checks in the normal repository suite

### Background

Task 1041 passed verification with zero residual findings: .spur/run/1041-verify/summary.json. At the start of this review, its detailed executable handoff/template checks existed only in .spur/run/1041-handoff-contract-check.ts and .spur/run/1041-verify/instruction-contract-check.ts. The latter also reads a historical current-host reconciliation receipt from scratch. The tracked command-contract tests mention the new commands only in count assertions at scripts/commands/command-contract.test.ts:350 and :438; the normal plugin suite has no job-handoff-specific test. A disposable scratch tree therefore removes the detailed checks needed to catch future shared handoff-contract drift.

This is coverage hardening, not a claim that task 1041's recorded PASS was false. Task 1046's stale prose was corrected inline; this task does not repeat it. Task 1041 supplies the completed command/contract implementation; these are task-local instruction-contract regressions under D62.

Triage preserved the original scripts, verification summary and walkthrough receipt under .spur/memory/runs/session-review-1041/source/, with hashes in input-manifest.json. This resolves loss of the investigation inputs; the lack of a tracked normal-suite regression remains open.

### Requirements

- [ ] R1. Add one tracked Bun test under plugins/sp/tests that checks the two thin command wrappers against the shared job-dump/job-resume contract and eight-section handoff template, without .spur/run input or a historical receipt.
- [ ] R2. Cover required --file/path validation, sample-data exclusion, live-state reconciliation, preserving ownership, missing required versus optional evidence, and the prohibitions on replaying completion or inventing approvals. Reuse existing command/link validators where available; do not build a Markdown parser.
- [ ] R3. Treat these as checks of the declared instructions, not proof that a model executed them. Tests run in the normal root gate, tolerate unrelated reference edits and keep the current instructions and command surface unchanged.

### Acceptance Criteria

- [ ] AC1 — Detailed handoff checks survive scratch disposal (req: R1).
  Given a clean checkout with .spur/run absent, the tracked test checks both wrappers and the shared template and passes as part of normal Bun discovery.
- [ ] AC2 — Material contract drift is detected (req: R2).
  Removing the required file contract, one template heading, approval boundary or completed-work/live-state reconciliation obligation makes the targeted check fail; legitimate unrelated reference edits do not.
- [ ] AC3 — No runtime layer or fabricated execution proof (req: R2, R3).
  The test neither reads the historical walkthrough receipt nor adds a runtime handoff parser, new helper dependency, public flag or executable command layer; output describes instruction-contract assertions accurately.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-02T05:46:53.702Z

Task 1041 stays completed. The new check protects its declared reusable instructions and does not certify model behavior or recreate a parser. Historical walkthrough receipts remain historical evidence only; no test may turn their stored PASS into a new live execution claim.

### Design

Add plugins/sp/tests/job-handoff-contract.test.ts using the current test workspace's read/path helpers and Bun test. Extract only the existing job-dump/job-resume/template sections by their declared headings and assert bounded semantic obligations. Migrate the material checks from the two scratch scripts, dropping the historical receipt assertions and brittle assertions against every sentence. Existing command-contract/shared-flag/link owners remain responsible for their generic checks; reuse them or rely on their normal gate rather than cloning their parsers.

Primary production inputs: plugins/sp/commands/dev-job-dump.md, dev-job-resume.md and plugins/sp/skills/spur-dev/references/dev-operations.md. Production behavior and prose stay unchanged. One test file is the default scope; only touch existing test helpers if genuinely required. No workflow, feature rewrite, snapshot of real operator work or new testing framework.

### Plan

1. Read the two retained scratch checks and the existing plugin test helpers; identify assertions not already covered by generic gates.
2. Add the single tracked instruction-contract test with no scratch or walkthrough dependency.
3. Exercise representative negative mutations in isolated text fixtures or temporary copies to prove the test detects material drift; do not alter canonical instruction files for a test.
4. Run the focused plugin test and existing command/link checks, then the task gate and real task verification.

### Root Cause

The useful instruction checks were created as verification-attempt scripts rather than integrated into the repository's existing Bun test discovery. They require scratch paths and a one-time walkthrough receipt, so they cannot act as a normal clean-checkout regression gate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Task 1041; .spur/run/1041-verify/summary.json
- .spur/run/1041-handoff-contract-check.ts
- .spur/run/1041-verify/instruction-contract-check.ts
- scripts/commands/command-contract.test.ts:350
- plugins/sp/skills/spur-dev/references/dev-operations.md:343
- D62.
- .spur/memory/runs/session-review-1041/input-manifest.json (retained source checks and historical verification inputs)

### History
