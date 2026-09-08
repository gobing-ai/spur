---
schema_version: 1
name: Follow-ups from session review of run c8c496fc (0804)
status: todo
template: issue
created_at: 2026-09-08T19:52:32.046Z
updated_at: "2026-09-08T21:24:51.714Z"

ac_numbering: task-local
---

## 0809. Follow-ups from session review of run c8c496fc (0804)

### Background

Task 0804's session review collected follow-ups from run
`c8c496fc-6cfe-42a5-8989-1e9716a04179`. This refinement checked the current tree at
`b8adc2f0d` on 2026-09-08, including existing uncommitted edits. Task 0804 is `done`, and
commit `ee3e448b0` is an ancestor of HEAD. Task 0808 is also `done`; its R4 documents inline
record as a registration-equivalent log convention, not an engine artifact-ledger insertion.

Confirmed remaining defects: inline setup inserts empty identity metadata before a separate
stamp; bound artifact registration misdiagnoses a missing SQLite run row as malformed metadata;
and the existing local AC-normalization refactor replaced ASCII U+0027 with U+02BC. The
delegate's reachable `finally` and shared AC-wrapper helper already exist locally and must be
preserved. The static-import cleanup remains outstanding.

The historical log reports a missing run at record entry, but does not establish who removed it
or whether it was rebuilt. Its proposed test-cleanup cause is unsupported: the cited test owns
a separate temporary database. Retain the incident as evidence, not as a verified cause or an
open-ended implementation assignment. Definition drift is a separate identity issue; editing a
workflow file does not establish that its new definition was executed or authorize a resume stamp.

### Requirements

- [ ] R1. A newly created inline run persists its complete launch identity with the initial run insert: canonical `definitionDigest`, `workflowVersion` including explicit null, and `definitionSource` containing path/layer/workdir. An interruption leaves either no row or a fully identified row. Preserve identity-checked idempotent attach, legacy/malformed/conflicting-row refusals, collision safety and nonterminal status.
- [ ] R2. Preserve the locally repaired delegate cleanup and prove that each opened project DB is closed exactly once before process termination on setup success, returned refusal and thrown failure. Existing exit codes, diagnostics, outcome artifacts and unsafe-id refusal remain compatible. This is validation of the existing correction, not a second cleanup implementation.
- [ ] R3. Bound `run.artifact` registration treats either null or undefined from the run lookup as a missing authoritative row, returns the existing named refusal, and writes no artifact. Retain fail-closed behavior without reconstructing, deleting or modifying run identities. The historical row-loss cause remains unverified and is outside remediation scope.
- [ ] R4. The inline driver preserves the definition selected and read at invocation for the entire run, including the setup-provided `__definitionDigest`; source edits to that YAML do not automatically reload the FSM or stamp `resumeDefinitionDigest`. Certification still captures current source/task inputs and rejects stale proof. If execution must switch definitions or the executed identity cannot be established, stop that run and start a fresh run with fresh certification; do not repair history at record entry. Align setup and record guidance with task 0808's registration-equivalent convention.
- [ ] R5. Preserve `stripAcWrappers` reuse while restoring the pre-refactor normalization character set (U+0027, U+2018, U+2019, U+201C, U+201D); do not silently add U+02BC equivalence. Keep aliases, ambiguity detection and duplicate rejection unchanged. Replace the shadowed dynamic path/fs imports in `openInlineRunProjectDb` with module-level imports while preserving path resolution, directory creation, migration and close behavior.

Non-goals: implementing code in this refinement; bundle-only setup support (former R6); new
public commands, flags, exported types, dependencies, migrations or DAO methods; a transaction or
compensation framework; global lifecycle-DB mutation guards; automated consent inference;
changing workflow YAML, engine paused-resume semantics, 0808's no-ledger inline convention, or
unrelated working-tree edits.

### Acceptance Criteria

- [ ] AC1 (R1): Given an isolated migrated DB and valid workflow, when setup inserts a run and an injected adapter failure interrupts immediately after that insert, then the persisted row already has all launch-identity fields, with explicit null for an unversioned workflow. Given an insert failure before the write, no row exists. A retry after the completed insert attaches with the same identity; an existing conflicting row is unchanged. Existing setup/refusal tests pass.
- [ ] AC2 (R2): Given the real delegate loading a minimal fixture app module through its existing `--spur-bin` path, when setup succeeds, returns `ok: false`, or throws after the DB opens, then the close marker appears exactly once before the child exits (0 for success, 1 otherwise). Success and returned refusal retain their current outcome documents; a thrown failure retains its stderr failure behavior. Unsafe ids still create no artifact and never open the DB.
- [ ] AC3 (R3): Given a valid bound verdict and an isolated migrated DB with its matching run removed before registration, when the real action executes, then it returns `ok: false` with `no authoritative row`, does not label the row malformed, and leaves both the run absent and the artifact ledger empty. Existing malformed-metadata, proof, path and identity refusal behavior stays intact.
- [ ] AC4 (R4): Given an inline run initialized with definition A, when the task edits tracked workflow YAML to B before quality-gate capture but the driver continues executing its invocation-time A, then new proof uses a changed current input fingerprint and A's setup identity without a resume stamp. A service-level bound-artifact fixture accepts that identity and rejects an artifact claiming B against the A row. The driver reference explicitly distinguishes this fixture's engine ledger from the inline log convention, requires a new run if execution switches to B, and refuses stale post-capture evidence. It does not claim ignored/external files are included in the Git fingerprint. Inline pipeline parity passes.
- [ ] AC5 (R5): Given a scenario containing ASCII or the previously supported curly quotes, when the real answer-lint script receives its quote-normalized alias, then it accepts it; aliases submitted twice still fail as duplicates. U+02BC is not newly treated as removable punctuation. Existing exact-title, wrapper, ordinal, ambiguity and paraphrase tests pass, and the existing real DB-open/setup checks remain green after static-import cleanup.

### Q&A

Refined automatically at ready depth on 2026-09-08. Decisions are closed for this task; no
implementation was performed. Original R numbers are retained except R6, which is removed.

| Original item | Evaluation and disposition |
| --- | --- |
| R1 atomicity | Valid defect, overcomplicated proposed solution. Installed engine 0.4.57 accepts `metadata_json` in the initial INSERT. Put identity there and remove the second stamp; no transaction/delete seam. Failure-injection probe reproduces the empty-metadata window. |
| R2 dead finally | Historically valid, already corrected in the starting local diff. Keep that correction and add the missing subprocess cleanup evidence. Do not claim it was fixed by this refinement. |
| R3 row loss | Incident retained; test-driven DB rebuild is an unverified hypothesis. Drop that causal claim and speculative global guard. Replace with the reproduced missing-row diagnostic defect at the existing fail-closed boundary. The same fixture's DELETE cannot reach the lifecycle DB because it opens its own temporary path. |
| R4 automatic drift consent | The proposed author-attribution heuristic is invalid: authorized edits do not prove executed definition or resume consent. Freeze the invocation-time definition and its identity; fresh input proof still covers the changed YAML. Switching executed definitions requires a new inline run. Existing engine paused-resume consent remains owned by 0784. |
| R5 cosmetic cleanup | Wrapper deduplication already exists locally, but its quote-class change is a reproduced behavior regression. Retain the helper, restore exact former normalization semantics, and finish static imports. |
| R6 bundle-only delivery | Drop from this task: conditional future product scope, no concrete requested support change. Keep existing fail-closed behavior. Robin owns any later bundle-delivery scope decision. |

No new API. No new feature linkage inferred; these are task-local follow-ups. Upstream 0804,
0808 and 0784 are already done, not pending prerequisites. This task does not reopen their
implementation or claim that the historical row loss has been explained.

The starting tree also contains unrelated changes in CHANGELOG.md, task 0804 and
packages/app/src/index.ts. Preserve them. The R2/R5 source edits were present before this
refinement. Before implementation, reconcile those edits into a clean task branch/worktree
under the normal lifecycle; neither discard them nor silently assume HEAD contains them.

### Design

#### Decision and boundary

Use existing service and script seams; no new API. Changes are task-local and preserve the
accepted identity/consent boundaries, so no new ADR is needed. Chosen atomicity design: one
identity-bearing engine INSERT. A two-call transaction is unnecessary and the installed
DbAdapter exposes atomic `batch`, not an async transaction callback; compensating deletion adds
an ownership race and cannot recover process death. Do not add either.

#### R1: inline setup

Owner: `packages/app/src/services/inline-run-setup.ts`, `createOrAttachInlineRun` create branch.
Continue using the existing resolver's `digest`, `workflowVersionLiteral` and
`RunDefinitionSource`. Pass `metadata_json: JSON.stringify({ definitionDigest: digest,
workflowVersion: version, definitionSource: source })` to the existing engine
`createOrAttachRun` call; remove the subsequent `stampRunIdentity` call in this branch.
Leave the current existing-row validation and return shape intact. The call has no
`external_key`, so the installed engine rejects colliding IDs instead of adopting another row.
An insertion error still fails closed; do not turn a collision into a successful attachment
without the existing identity checks. No domain DAO edits or raw production SQL.

Test owner: `packages/app/tests/services/inline-run-setup.test.ts`. Wrap the injected `getDb`
adapter in the test to fail immediately before or after its INSERT, read the real durable row,
and retry after the after-insert failure. Inspect the full metadata, including null version and
source, and preserve the current bound-record/idempotent/conflict test cases. Do not retain an
obsolete test that requires the removed identity-stamp operation to be called.

#### R2: delegate cleanup

Owner: `plugins/sp/scripts/inline-run-setup.ts`; preserve its current `exitCode` + reachable
`finally { projectDb.close(); }` + post-finally exit. Tests belong in
`plugins/sp/tests/inline-run-setup.test.ts`. Reuse child-process tests and the existing app-entry
resolution seam: create a minimal temporary repo-shaped stub with apps/cli/src/index.ts and
packages/app/src/index.ts, pass its source entry to `--spur-bin`, and append open/setup/close
markers from the fixture module. Cover success, returned failure and rejection after open; a
close count alone after OS teardown is insufficient. No production test hook, module mocking
framework or new exported main function.

#### R3: missing row at binding

Owner: `packages/app/src/workflow/actions/run-artifact.ts`, the lookup in `executeBound`.
Normalize the DAO's null result to undefined or use a nullish guard before accessing metadata;
reuse the existing `no authoritative row` error. Today the property access is caught by the JSON
parse catch and incorrectly produces `metadata_json is malformed`. Do not change RunDao's
return types globally or weaken malformed-metadata/proof checks.

Test owner: `packages/app/tests/workflow/actions/run-artifact.test.ts`; reuse its real isolated
SQLite bound-verdict fixture, remove only its run before execution, assert the exact refusal
class and no ledger write. Fixture cleanup must stay on its owned database. This test establishes
the boundary behavior, not the historical incident's cause.

#### R4: definition identity, source fingerprint and inline record

Guidance owner: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` Run setup and
`run.artifact` paragraphs; use the Superskill skill refinement owner when implementing this
capability-reference edit. Keep one invocation-time parsed definition and the existing setup
artifact `.spur/run/<run-id>-inline-setup.json` identity. Do not re-resolve/reseed
`__definitionDigest` at record because the file changed. `proof.digest` is the fresh source/task
fingerprint; `proof.definitionDigest` identifies the workflow actually interpreted. They serve
different purposes. A changed tracked source YAML (such as config/workflows/task-pipeline.yaml)
before capture is included in current input proof; post-capture changes to fingerprinted inputs
invalidate that proof and require the normal certification loop. Do not claim ignored/external
workflow files are part of the Git fingerprint. Their executed identity remains the setup digest;
changing the definition actually interpreted still requires the new-run path below.

When the host cannot continue the same parsed definition, stop before record, preserve the log
and evidence, and start a new inline invocation with a fresh run ID and fresh gate/review/verify
evidence. Do not mutate old run/proof identities, manufacture a paused engine snapshot, or call
`continuePaused` for a running inline row. Task text, Git attribution and `--auto` are not consent
to stamp `resumeDefinitionDigest`. Task 0784 still owns explicit consent for actual paused engine
runs; no change to that service is needed here.

Task 0808's inline record remains its documented validation plus provenance log line, with no
artifact-ledger row. Correct the earlier setup paragraph's implication that setup itself makes
the host insert that row. Preserve the current convention's checks, and explicitly include
run/definition identity agreement from authoritative setup/run evidence. If identity is absent
or conflicts, stop; recreating a row is not a diagnostic operation. Do not invent an inline
`run.artifact` CLI. Update docs/04_DESIGN.md section 7.8 with the concise behavior and owner link
via sp-doc-evolve; no workflow YAML edit or public verb change.

Extend the existing setup bound-record fixture with a tracked workflow (adjust the fixture's
ignore file to ignore only .spur/run/, not the workflow) for A-at-launch, B-on-disk-before-capture,
proof carrying A, and forged proof carrying B. This tests identity mechanics through the actual
engine action; it is not evidence that the inline host now writes a ledger. Review the driver
instructions against the three cases (source-only edit, post-capture input edit, actual switch of
executed definition), then run the existing inline parity check. No second driver/runtime.

#### R5: normalization and imports

Owners: `plugins/sp/scripts/verify-answer-lint.ts` and the same setup service as R1. Keep
`stripAcWrappers` used by both callers. Restore the exact former removal set; use `\x27` if a
formatter would visually obscure U+0027, followed by the four existing curly quote characters.
U+02BC remains a meaningful character, as before this local refactor. Add a compact real-script
regression in `plugins/sp/tests/verify-answer-lint.test.ts` for ASCII/curly normalization,
duplicate aliases and the U+02BC negative case. Existing alias/ambiguity tests remain the guard.
Hoist mkdirSync and join alongside existing module imports; reuse the module's resolve. The
import-only cleanup needs no new abstraction or dedicated test.

#### Handoff and evidence

No pending dependencies or dependent-task handoff; preserve 0804 setup/proof refusal contracts,
0784 engine consent semantics and 0808 inline provenance. Primary change targets are the three
source files, their three existing test files, the driver reference and its 04_DESIGN owner link.
No edit to task 0804, CHANGELOG.md or app barrel exports is required by this specification.

Refinement evidence is in `.spur/run/0809-refine/`: probe.ts regenerates three isolated failing
regression probes and logs; these are ignored diagnostic artifacts, not installed tests. Port
the checks into the existing suites during implementation. Existing baseline: app suites 36/0,
plugin suites 33/0 on 2026-09-08. Expected failing probes: atomic-create, missing-row and
ascii-apostrophe. The additional frozen-definition probe passes with changed tracked YAML and
asserts a new input fingerprint while retaining the launch identity. No implementation PASS or
full-project gate is claimed by refinement.

### Plan

- [ ] P1 (R1-R5): Start the authorized implementation lifecycle from an isolated clean task tree, preserving/reconciling the starting R2/R5 edits and unrelated changes. Read the frozen Design and regenerate the three refinement probes if source has changed; do not treat scratch content as task authority.
- [ ] P2 (R1): Add the before/after-insert regression in the existing setup test file, then initialize metadata in the engine insert and remove the second stamp. Verify full metadata, retry attachment, collision preservation and all existing refusals.
- [ ] P3 (R2): Add the real delegate subprocess cases with fixture app markers. Retain the existing reachable-finally correction; change source only if the behavioral check reveals a remaining cleanup defect.
- [ ] P4 (R3): Add the real missing-row bound-registration regression, fix the nullish guard at the lookup, and verify that no run or artifact is created by refusal.
- [ ] P5 (R4): Extend the setup fixture to separate invocation identity from current source fingerprint. Align the driver reference and docs/04_DESIGN.md through their owner skills; check source-only edits, post-capture edits and actual definition switches without adding an execution surface or consent heuristic.
- [ ] P6 (R5): Add quote/duplicate compatibility cases, restore the exact character set while retaining wrapper reuse, and finish static imports in the setup service.
- [ ] P7 (R1-R5): From packages/app run `bun test tests/services/inline-run-setup.test.ts tests/workflow/actions/run-artifact.test.ts`; from plugins/sp run `bun test tests/inline-run-setup.test.ts tests/verify-answer-lint.test.ts`. Run `bun run inline-pipeline-parity-check`, applicable Superskill validation and sp-doc-evolve sync-check for the reference/docs edit.
- [ ] P8 (R1-R5): Run the final code gate once (`bun run spur-check`), plus required test-cf/build checks from AGENTS.md. Run source-local `task check 0809 --json` and affected-input checks under T11; no corpus audit unless checker policy actually changes. Review against all five ACs, record a real implementation verify verdict through the lifecycle, and commit only this task's authorized changes. Refinement alone must leave status todo and Solution/Testing/Review unclaimed.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/app/src/services/inline-run-setup.ts:244` — two-step create/stamp; `:158` — null normalization already used by setup; `:169` — existing resume-digest precedence; `:114` — dynamic imports.
- `node_modules/@gobing-ai/ts-dual-workflow-engine/dist/persistence.js:55` — installed 0.4.57 createRun inserts supplied metadata and rejects duplicate IDs; `:168` — createOrAttachRun only attaches by a supplied external key. Installed-source evidence, not a request to edit dependencies.
- `packages/domain/src/dao/run-dao.ts:145` — identity-stamp conditional update; `packages/app/src/services/workflow-service.ts:1039` — paused-only continue; `:1186` — explicit consented resume identity.
- `packages/app/src/workflow/actions/run-artifact.ts:324` — authoritative lookup; `:326` — undefined-only missing-row check; `:336` — resume/launch proof precedence.
- `plugins/sp/scripts/inline-run-setup.ts:169` — local reachable cleanup; `plugins/sp/scripts/verify-answer-lint.ts:267` — shared wrapper helper; `:294` — changed quote character set.
- `packages/app/tests/services/inline-run-setup.test.ts:92` — temporary DB ownership; `:106` — fixture-only DELETE. `packages/app/tests/workflow/actions/run-artifact.test.ts:157` — bound-artifact fixture; `plugins/sp/tests/verify-answer-lint.test.ts:448` — canonical-identity tests.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:49` — setup; `:121` — task 0808 inline registration-equivalent convention. `docs/04_DESIGN.md:644` — paused resume; `:2853` — dev-operation owner section.
- `docs/00_ADR.md:890` — ADR-065 script delivery; `docs/design/workflow-observability.md:263` — launch/resume identity; `docs/99_PROJECT_CONSTITUTION.md:212` — T11 affected-input discipline.
- Upstream task records read through `task show`: 0804 (done), 0808 (done), 0784 (done). No new feature association or dependency transition is required.
- Historical evidence: `.spur/run/c8c496fc-6cfe-42a5-8989-1e9716a04179.log:18`. This is a recorded observation/recovery, not a reproduced deletion cause.
- Local repeatable refinement evidence: `.spur/run/0809-refine/probe.ts` and atomic-create.log, missing-row.log, ascii-apostrophe.log. Each corrected probe reaches a requirement assertion and fails for the identified defect. Earlier scratch import-resolution failures were corrected before accepting this evidence.

### History
