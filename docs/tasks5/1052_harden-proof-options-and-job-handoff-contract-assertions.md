---
schema_version: 1
name: Harden proof options and job handoff contract assertions
status: done
template: issue
created_at: 2026-10-02T17:00:25.447Z
updated_at: "2026-10-05T18:22:32.257Z"
feature_id: D63

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/1052-verdict.json
---

## 1052. Harden proof options and job handoff contract assertions

### Background

Consolidated from the 2026-10-02 reviews originally captured as tasks 1054 and 1056. Current source accepts unrecognized proof.fingerprint action option keys and silently treats a non-string expect as capture-only. The retained job-handoff test also assumes unique section boundaries and checks template heading presence without uniqueness.

The D63 link follows current-input proof and planning-handoff correctness; the job-handoff baseline was implemented under D62 task 1050. These are task-local regressions that preserve the current feature scope and command contracts.

The original task 1052 freshness-gate request is excluded: `scripts/commands/bundle-plugin-lib.test.ts` already compares committed .mjs bytes with regeneration, including inline-run at line 187, and `bun run test` / `spur-check` discover that test. This is evidence for existing coverage of the reported stale-inline-bundle defect, not a claim that every generated declaration has exhaustive byte-freshness coverage.

### Requirements

- [x] R1. Validate proof.fingerprint action options against its real accepted keys (`var`, `expect`, `taskFile`, `featureFile`), rejecting unknown keys before spec reads or Git capture with an actionable error naming unexpected and accepted keys. Do not confuse these options with the typed computeProofInputFingerprint input object.
- [x] R2. Reject a supplied non-string expect instead of silently dropping the proof comparison. Preserve valid var validation, capture-only behavior for absent/empty/blank expect, and existing optional spec behavior: undefined or empty-string taskFile/featureFile is absent; whitespace-only paths remain explicit invalid paths. Keep proof-bound run.artifact and shared spec-reader options compatible.
- [x] R3. Extend the existing job-handoff contract test to require exactly one occurrence of each of the four reference slicing boundaries and each of the eight handoff-template headings in its owning reference/template, using exact heading lines. Add isolated duplicate/missing-heading mutations and retain unrelated-edit tolerance and both thin-wrapper assertions; do not add a Markdown parser or change the command instructions.

### Acceptance Criteria

- [x] AC1 — Unknown proof action keys fail before any proof input work (req: R1)
  Given valid var plus legacy keys gitDiffSummary/gitLogHashObject or a misspelled taskFile key, execute returns ok:false naming the unexpected keys and the four accepted keys; no spec read or digest capture occurs, and valid action options continue to work.
- [x] AC2 — Invalid expectation types cannot silently weaken proof comparison (req: R2)
  Given non-string expect, execute fails; valid matching/mismatching string expectations keep their existing result, absent/empty/blank expect remains capture-only, undefined/empty spec paths stay optional and whitespace-only spec paths remain rejected. Existing proof-bound run.artifact checks stay green.
- [x] AC3 — Handoff contract drift fails at the actual heading owner (req: R3)
  Given isolated copies of dev-operations.md and its shared template, each duplicated or missing boundary/template heading produces a named violation before incorrect slicing can pass; both wrapper checks and unrelated-edit mutations still pass without scratch input or canonical file changes.

### Q&A

- Original 1054 conflated the action option map with computeProofInputFingerprint's input signature. Use the four action keys documented on ProofFingerprintActionRunner.
- Do not put a blanket unknown-key rejection in readProofInputContents: run.artifact passes its larger legitimate option map to that shared reader. Bound artifact strictness does not follow automatically from fingerprint validation.
- Original 1054 claimed whitespace-only taskFile/featureFile is absent. Only undefined and the literal empty string are absent today; preserve that behavior.
- Original 1056 located eight boundary headings in both wrappers. The wrappers have no eight-section handoff template: four slice boundaries and eight template headings belong to the shared dev-operations reference. Correct the assertion scope there.
- Keep task 1050's declared-instruction coverage and existing numeric specimen exclusions; these assertions do not prove model execution. The previous byte-parity migration does not prevent a deliberate test enhancement.
- Skip the additional freshness gate requested by original 1052 because the observed .mjs drift class already has a normal-suite regeneration assertion. No new dependency, parser, public command or workflow is needed.

### Design

Validate unknown keys at ProofFingerprintActionRunner.execute, using its documented action option set. Keep readProofInputContents as a shared optional-spec reader so bound run.artifact does not reject its own legitimate fields. Reject non-string expect at the same boundary before digest work.

Extend `boundedSection`/`templateViolations` in the existing test file with exact-line uniqueness checks. The four slicing headings are DUMP_START, RESUME_START, TEMPLATE_START and NEXT_SECTION_START; the eight TEMPLATE_HEADINGS belong to the shared template. Run mutations on in-memory text only. Reuse the existing suite and the current assert/error conventions.

Write the option-validation and duplicate-heading regressions before changing their implementation. Preserve the existing proof/action contracts and generated-plugin installation behavior.

### Plan

1. Add failing proof option/type checks and exact-heading duplicate/missing mutations to the existing owning tests.
2. Add minimal action-boundary validation and extend the existing handoff assertions; preserve run.artifact spec-reader compatibility.
3. Run focused proof, bound-artifact, proof-input and handoff contract tests, retaining their output.
4. Run the normal task gate and record verification through the task pipeline; update only owning design contracts whose facts change.

### Root Cause

ProofFingerprintActionRunner.execute accepts a Record<string, unknown> and validates var and spec values but not unknown keys (`packages/app/src/workflow/actions/proof-fingerprint.ts:51`); non-string expect falls through to an empty string at line 88. `readProofInputContents` omits only undefined/empty-string paths and accepts a larger caller map from run.artifact (`packages/app/src/workflow/proof-input-fingerprint.ts:160`; `packages/app/src/workflow/actions/run-artifact.ts:283`).

`boundedSection` uses indexOf without boundary counts (`plugins/sp/tests/job-handoff-contract.test.ts:84`), and templateViolations checks includes instead of exact heading uniqueness at line 161. Task 1050 already retained the normal-suite checks; this is a small extension of those checks, not a reimplementation.

### Solution

Implemented and verified. The earlier consolidation plan is retained in Design/Plan; the current change map is:

- `packages/app/src/workflow/actions/proof-fingerprint.ts:63`: validate the four accepted action option keys before reading proof inputs; reject unexpected keys and supplied non-string `expect` without weakening the shared artifact reader.
- `plugins/sp/tests/job-handoff-contract.test.ts:162`: enforce exact-line uniqueness for the shared handoff template headings and slicing boundaries, with isolated duplicate/missing-heading mutations at `plugins/sp/tests/job-handoff-contract.test.ts:320`.

The Pipeline review entry in this task records AC1–AC3 PASS for run `782ba320-0fef-4424-a00d-437b203d642c`. The later session gate also passed 9,785 tests with unchanged coverage thresholds; receipt: `.spur/run/scripts-conflict-repairs/verification.json`. This documentation correction does not create a new implementation or pipeline verdict.

### Testing

Historical pre-implementation triage baseline follows. Current implementation verification is recorded in the Pipeline review entry below and the session gate receipt `.spur/run/scripts-conflict-repairs/verification.json`.

- Bundle regeneration baseline: `bun test ./scripts/commands/bundle-plugin-lib.test.ts` — 16 passed, 0 failed; `.spur/run/triage-1051-1056-bundle-check.log`.
- Plugin close/reason/handoff baseline: `(cd plugins/sp && bun test tests/job-handoff-contract.test.ts tests/inline-run-trace.test.ts tests/inline-run-close-reason.test.ts)` — 32 passed, 0 failed; `.spur/run/triage-1051-1056-plugin-check.log`.
- App write/record/lifecycle/proof baseline: `(cd packages/app && bun test tests/services/planning-write-service.test.ts tests/services/task-record.test.ts tests/workflow/lifecycle-adapter.test.ts tests/workflow/actions/proof-fingerprint.test.ts)` — 200 passed, 0 failed; `.spur/run/triage-1051-1056-app-check.log`.
- Live fixture reproduction (`bun .spur/run/triage-1051-1056-reproduce.ts`) confirms: legacy unknown proof keys are silently accepted without changing the digest, non-string expect is accepted as capture-only, and whitespace-only taskFile is rejected rather than omitted. Results: `.spur/run/triage-1051-1056-reproduction.json`.
- Corrected task readiness: `bun run apps/cli/src/index.ts task check 1052 --as todo --strict --json` — passed with no findings after the approved title/file renames and removal of superseded tasks.

Coverage: N/A for the historical consolidation baseline only. That earlier step changed no production code and claimed no pipeline completion; subsequent implementation and verification supersede the pending state. Original six task snapshots are retained in `.spur/run/triage-1051-1056-original-tasks.json` and in Git history.

### Review

#### Consolidation disposition — 2026-10-02

| Original finding | Priority | Disposition | Current evidence |
| --- | --- | --- | --- |
| 1052: no normal-suite generated-lib freshness assertion | P4 | ALREADY COVERED for the reported .mjs drift class: equality checks run in the normal gate, and completed task 1044 fixed build:bundle generation order | `scripts/commands/bundle-plugin-lib.test.ts:187`; `package.json:78`; completed task 1044 |
| 1054: unknown proof options silently accepted | P3 | RETAIN as R1 with the actual four action keys; exclude blanket shared-reader rejection | `packages/app/src/workflow/actions/proof-fingerprint.ts:51`; `packages/app/src/workflow/actions/run-artifact.ts:283` |
| 1054: whitespace spec values are absent | P4 | CORRECT: only undefined/empty string is absent; preserve explicit-path validation | `packages/app/src/workflow/proof-input-fingerprint.ts:173` |
| Proof comparison type hole | P3 | ENHANCE as R2: non-string expect currently disables comparison silently | `packages/app/src/workflow/actions/proof-fingerprint.ts:77` |
| 1056: uniqueness assertions absent | P4 | RETAIN as R3; correct ownership to shared reference boundaries/template headings | `plugins/sp/tests/job-handoff-contract.test.ts:84`; `plugins/sp/tests/job-handoff-contract.test.ts:161` |

This review assesses the follow-up records; it does not certify the pending implementation.


#### Pipeline review — run 782ba320-0fef-4424-a00d-437b203d642c (2026-10-02)

Functional traceability AC1–AC3 all PASS with file:line evidence; SECUA clean. Findings: 2 non-blocking nits — (1) the guard's accepted-keys list is derived from `ACCEPTED_OPTION_KEYS` order, keep it in sync if options grow; (2) the handoff boundary test pins the Environment heading format, so clock-locale template edits must update the pin deliberately. No blocking findings. Diff implements AC1–AC3 with fail-closed semantics at the right boundary; quality gate PASS (first attempt, 4m56s) includes the new tests. Full review answer: `.spur/run/782ba320-0fef-4424-a00d-437b203d642c-review-answer.txt` (worktree run artifacts).

### References

- Related completed tasks: 1041 (thin job commands), 1050 (retained handoff contract tests), 0785 (shared proof spec validation), 0972 (generated inline export/declaration parity), 1044 (authoritative build:bundle generation order).
- Governing feature records: D63 (current-input proof and planning handoff), D62 (retained job-handoff assertions), A33 (existing generated-library integrity checks).
- `packages/app/src/workflow/actions/proof-fingerprint.ts`
- `packages/app/src/workflow/proof-input-fingerprint.ts`
- `packages/app/src/workflow/actions/run-artifact.ts`
- `plugins/sp/tests/job-handoff-contract.test.ts`
- `plugins/sp/skills/spur-dev/references/dev-operations.md`
- `scripts/commands/bundle-plugin-lib.test.ts`

### History

- 2026-10-02: Consolidated the six simultaneous review captures into 1051–1052; corrected diagnoses and preserved each original finding's disposition. Removed superseded captures 1053–1056 so those IDs can be reused. The operator's "go ahead" authorized the narrow direct title/file rename and deletion exception because the task CLI lacks those operations; sections, metadata and roster refreshes used Spur. Implementation remains todo.
- 2026-10-02T20:23:17.412Z todo → wip (system)
- 2026-10-02T20:47:17.233Z wip → testing (system)
- 2026-10-02T20:47:44.489Z testing → done (system)

