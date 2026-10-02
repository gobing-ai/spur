---
schema_version: 1
name: Retain task 1041 job-handoff contract checks in the normal repository suite
status: done
template: issue
created_at: 2026-10-02T05:46:49.743Z
updated_at: "2026-10-02T17:08:55.445Z"
feature_id: D62

priority: P3
ac_altitude: task-local
ac_numbering: task-local
dependencies: ["1041"]
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-dev-runall-d62-7b87/.spur/memory/evidence/1050-verdict.json
---

## 1050. Retain task 1041 job-handoff contract checks in the normal repository suite

### Background

Task 1041 passed verification with zero residual findings: .spur/run/1041-verify/summary.json. At the start of this review, its detailed executable handoff/template checks existed only in .spur/run/1041-handoff-contract-check.ts and .spur/run/1041-verify/instruction-contract-check.ts. The latter also reads a historical current-host reconciliation receipt from scratch. The tracked command-contract tests mention the new commands only in count assertions at scripts/commands/command-contract.test.ts:350 and :438; the normal plugin suite has no job-handoff-specific test. A disposable scratch tree therefore removes the detailed checks needed to catch future shared handoff-contract drift.

This is coverage hardening, not a claim that task 1041's recorded PASS was false. Task 1046's stale prose was corrected inline; this task does not repeat it. Task 1041 supplies the completed command/contract implementation; these are task-local instruction-contract regressions under D62.

Triage preserved the original scripts, verification summary and walkthrough receipt under .spur/memory/runs/session-review-1041/source/, with hashes in input-manifest.json. This resolves loss of the investigation inputs; the lack of a tracked normal-suite regression remains open.

### Requirements

- [x] R1. Add one tracked Bun test under plugins/sp/tests that checks the two thin command wrappers against the shared job-dump/job-resume contract and eight-section handoff template, without .spur/run input or a historical receipt.
- [x] R2. Cover required --file/path validation, sample-data exclusion, live-state reconciliation, preserving ownership, missing required versus optional evidence, and the prohibitions on replaying completion or inventing approvals. Reuse existing command/link validators where available; do not build a Markdown parser.
- [x] R3. Treat these as checks of the declared instructions, not proof that a model executed them. Tests run in the normal root gate, tolerate unrelated reference edits and keep the current instructions and command surface unchanged.

### Acceptance Criteria

- [x] AC1 — Detailed handoff checks survive scratch disposal (req: R1).
  Given a clean checkout with .spur/run absent, the tracked test checks both wrappers and the shared template and passes as part of normal Bun discovery.
- [x] AC2 — Material contract drift is detected (req: R2).
  Removing the required file contract, one template heading, approval boundary or completed-work/live-state reconciliation obligation makes the targeted check fail; legitimate unrelated reference edits do not.
- [x] AC3 — No runtime layer or fabricated execution proof (req: R2, R3).
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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/task.ts:1263` |
| `apps/cli/src/commands/task.ts:1841` |
| `apps/cli/src/commands/task.ts:28` |
| `apps/cli/src/commands/task.ts:685` |
| `apps/server/src/context.ts:39` |
| `apps/server/src/context.ts:42` |
| `apps/server/src/context.ts:447` |
| `packages/app/src/index.ts:912` |
| `packages/app/src/services/planning-write-service.ts:165` |
| `packages/app/src/services/planning-write-service.ts:224` |
| `packages/app/src/services/planning-write-service.ts:249` |
| `packages/app/src/services/planning-write-service.ts:256` |
| `packages/app/src/services/planning-write-service.ts:496` |
| `packages/app/src/services/planning-write-service.ts:530` |
| `packages/app/src/services/task-record.ts:102` |
| `packages/app/src/services/task-service.ts:1547` |
| `packages/app/src/services/task-service.ts:1576` |
| `packages/app/src/services/task-service.ts:1605` |
| `packages/app/src/services/task-service.ts:1620` |
| `packages/app/src/services/task-service.ts:1643` |
| `packages/app/src/services/task-service.ts:34` |
| `packages/app/src/workflow/lifecycle-adapter.ts:62` |
| `packages/app/tests/services/planning-write-service.test.ts:745` |
| `packages/app/tests/services/task-record.test.ts:13` |
| `packages/app/tests/services/task-record.test.ts:15` |
| `packages/app/tests/services/task-record.test.ts:2344` |
| `packages/app/tests/services/task-record.test.ts:41` |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts:10` |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts:3` |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts:357` |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts:5` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/tests/job-handoff-contract.test.ts (only 1050 code file): one tracked Bun test, 17 tests; checks both wrappers (argument-hint, required flag row, usage line, section anchor, Skill dispatch — verbatim in dev-job-dump.md/dev-job-resume.md) plus the eight-section shared template; zero .spur/run or receipt references |
| R2 | MET | All 18 dump + 24 resume obligation strings verified verbatim in dev-operations.md:343-366: path validation incl. corpus-write exclusion, --json live-state, ownership/one-writer, missing-required vs optional evidence, no-replay/no-fabricated-snapshot, approvals-stay-pending; includes() + bounded heading slicing, no Markdown parser, no new dependency |
| R3 | MET | Instruction-contract assertions only: imports bun:test + node:fs + node:path; no runtime layer/flag/dependency; runs in the normal root gate (gate log: repo-wide discovery incl. ./plugins, 9703 pass / 0 fail); control test job-handoff-contract.test.ts:395 proves unrelated reference edits pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Test reads only plugin-root canonical files (test:22-27,60-62); no scratch/receipt path; 1050-test-gate.status=PASS with repo-wide bun test across 566 files proves normal clean-checkout discovery |
| AC2 | MET | test | 6 mutation tests (test:340-404): wrapper flag-row, template heading, approval boundary, completed-work/live-state reconciliation (resume + dump), specimen leak, plus control test; mutation source strings verified verbatim in live production files |
| AC3 | MET | test | No receipt read, no parser/runtime layer, no new dependency or public flag; output describes instruction-contract assertions; review APPROVE confirms byte-identical migration of 42 obligation strings from hash-pinned 1041 scratch scripts |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Task 1041; .spur/run/1041-verify/summary.json
- .spur/run/1041-handoff-contract-check.ts
- .spur/run/1041-verify/instruction-contract-check.ts
- scripts/commands/command-contract.test.ts:350
- plugins/sp/skills/spur-dev/references/dev-operations.md:343
- D62.
- .spur/memory/runs/session-review-1041/input-manifest.json (retained source checks and historical verification inputs)

### History

- 2026-10-02T16:18:00.152Z todo → wip (system)
- 2026-10-02T17:08:53.914Z wip → testing (system)
- 2026-10-02T17:08:55.441Z testing → done (system)

