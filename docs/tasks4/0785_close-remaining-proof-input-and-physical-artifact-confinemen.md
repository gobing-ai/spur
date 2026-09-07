---
schema_version: 1
name: "Close remaining proof-input and physical artifact confinement gaps"
status: done
template: issue
created_at: 2026-09-06T18:27:45.398Z
updated_at: "2026-09-06T23:45:56.684Z"
feature_id: D6
priority: P1
dependencies: ["0781", "0784"]
---

## 0785. Close remaining proof-input and physical artifact confinement gaps

### Background
Audit 0781 F-07 remains present: proof-fingerprint.readOptional treats an explicit missing path like omitted input and resolves relative paths outside context.workdir; the 0781 path fix is lexical only. Installed FileSystem exposes optional synchronous realPath, but stat follows symlinks and has no isSymbolicLink method. run.artifact only checks a digest-shaped var and has no independent capture; its only shipped proofBinding=current caller is task-pipeline's done onEnter, after task update done. The canonical verdict parser does not retain a proof field; the actual pipeline stores proof.digest/runId/definitionDigest/stages in raw JSON. No shipped proof capture currently supplies featureFile. These facts constrain the repair below.
### Requirements
- [x] R1. A missing optional taskFile/featureFile (undefined or empty compatibility value) stays optional; any nonempty supplied path must be a readable regular file resolved under context.workdir or fail with a named error before a digest is produced. Reject invalid option types. All task/docs proof capture callers must include their canonical task spec and the linked feature spec when one exists.
- [x] R2. Both command.gate and run.artifact must reject physical escapes through an existing leaf/ancestor symlink, dangling symlinks or an outside .spur/run root before command/write/ledger effects. Preserve valid descendants, internal symlinks, missing output-leaf creation and injected filesystem testing. Missing realPath capability must fail closed rather than silently skip confinement.
- [x] R3. For the shipped verify-verdict current binding, independently capture the current inputs, validate the canonical verdict plus its raw proof block, and require matching task/run/definition/digest and stage evidence before any task record/done write or ledger record. A digest-shaped workflow var alone is insufficient; a forged matching var cannot bless stale artifact content.
- [x] R4. Record review completed only after that run actually completes review on the same digest; a skipped or stale review marker is not completed evidence. Keep ADR-107 Option B and current safety completion requirements unchanged.
- [x] R5. Keep unbound path-only artifact registration compatible. Other artifact kinds requesting current binding fail explicitly as unsupported in this task; do not invent a general proof envelope, new registry or a runtime sandbox. Preserve all proof guards and document the bounded local-filesystem threat model.
### Acceptance Criteria
```gherkin
Feature: Fail-closed proof and artifact inputs
  Scenario: R1 — Declared missing proof inputs fail closed
    Given an explicitly supplied missing task spec or a workdir-relative spec
    When proof capture executes
    Then the missing spec fails without a digest
    And the relative spec is read under the workflow workdir
    And linked feature requirement changes invalidate task and docs proof
  Scenario: R2 — Artifacts cannot escape through symlinks or claim false binding
    Given an artifact path escaping through a symlink or carrying mismatched proof
    When the action tries to write or record it
    Then it fails before the external write or ledger record
    And unexecuted review is never reported completed
    And the task cannot transition done before artifact binding succeeds
```

Verify in packages/app with bun test tests/workflow/actions/proof-fingerprint.test.ts tests/workflow/actions/run-artifact.test.ts tests/workflow/actions/command-gate.test.ts tests/workflow/proof-input-fingerprint.test.ts tests/workflow/task-pipeline-proof-chain.test.ts tests/workflow/docs-pipeline-proof-chain.test.ts. Use real temporary symlink/Git fixtures and in-memory DB rows; assert zero command/write/ledger/lifecycle effects on rejection.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-06T19:04:03.832Z

- Which artifact kinds get strong binding now? Only the sole shipped bound kind, verify-verdict. Unbound other kinds remain supported; unsupported current binding fails rather than inventing another schema.
- What is the current proof authority? Freshly captured input content plus authoritative RunDao identity, not caller-supplied digest vars. Existing digest algorithm remains unchanged.
- Can binding run after task done? No. It moves before task record/status mutations and replaces the redundant record-entry capture.
- What does realPath absence mean? Refusal for these local proof actions; tests provide a capability explicitly. No silent skip.
- Race boundary: static symlink and missing-ancestor safety is required; protection against a hostile process swapping links concurrently is not claimed.
- D9 fast route: retained dormant. Skipped review is recorded honestly and does not satisfy the current completion guard.
- New action options are additive taskFile/featureFile names already used by proof.fingerprint; no new public CLI surface or unresolved schema choice remains.
### Design
#### Frozen design
Reuse FileSystem, computeProofInputFingerprint and the existing action owners. Choose fresh input comparison over trusting vars or adding a persistent proof-state store: it proves the actual inputs using the current hash algorithm and survives resume without a new cache.

Input seam: add/export readProofInputContents(fileSystem, workdir, options) in proof-input-fingerprint.ts, accepting existing taskFile/featureFile names and returning taskContent/featureContent only after regular-file/read validation. Both proof.fingerprint and bound run.artifact use it; exceptions become actionable ok:false results. This is shared validation for two real callers, not a new service. Preserve empty-string-as-omitted compatibility, but task/docs pipeline callers must resolve nonempty canonical taskSpecPath and linked featureSpecPath before capture. Resolve through existing task show/feature show JSON filePath fields once, project with file.read.into-var, and supply both paths to every bracket leg. Do not hash a missing linked feature as absent.

Path seam: introduce one internal resolveRunArtifactPath(fileSystem, workdir, path): Promise<string> beside the action owners, reused by both owners. First preserve 0781 lexical descent; canonicalize the project workdir, then prove the run directory and every existing target/ancestor remain beneath that canonical .spur/run boundary. Use FileSystem.realPath and readDir/stat, not invented lstat/isSymbolicLink methods. For a missing output leaf, ascend to the nearest existing ancestor and reconstruct only missing segments; if realPath reports ENOENT but the parent directory contains that name, treat it as a dangling link and reject. Permission errors, unsupported realPath and unreadable ancestors fail closed. Check before ensureDir/dispatch/ledger; test doubles supply explicit realPath behavior. Accept symlinks resolving within the permitted run tree. This prevents static symlink escapes, not hostile concurrent symlink replacement (TOCTOU); no sandbox guarantee or descriptor-based filesystem redesign is introduced.

Binding seam: add optional taskFile/featureFile options to RunArtifactOptions (same names as proof.fingerprint); current binding for verify-verdict requires taskFile. Inject the existing ProcessExecutor as an optional trailing constructor dependency via builtins.ts for fresh capture. Bound registration requires the composed DB context so RunDao.traceRowById(context.runId) supplies authoritative run identity. Parse the verdict with parseVerifyVerdict, then validate the raw proof object separately because the canonical parser strips unknown proof fields. Require PASS aggregate, artifact wbs == context.vars.wbs, proof.runId == context.runId, and proof.definitionDigest == run metadata.resumeDefinitionDigest when present, otherwise the immutable definitionDigest. Require proof.digest and all required stage digests to equal the freshly captured digest, qualityGate/verification PASS and review completed. Missing/malformed/mismatched identity refuses before ledger write. Return the bounded compared digest and setVars.proofDigestNow on success; no bodies in ArtifactDao.

Move the bound run.artifact action from done to record entry before task record/status mutations, replacing that entry's redundant proof.fingerprint comparison with the action's fresh comparison. Keep the verify-entry bracket and remaining completion guards. For capture/read paths in unbound registration, preserve existing behavior except required-file regularity and physical confinement. Non-verify-verdict current binding refuses explicitly; absent binding remains path-only with no new JSON requirement. No proof schema migration or new digest field; use the existing nested proof.digest shape, not the stale satellite's hypothetical proofInputDigest name.

Review provenance: after the review action succeeds, write .spur/run/<runId>-review-proof.digest containing the reviewed digest. Stamp review completed only when that run-scoped marker equals the current digest; otherwise stamp skipped and let the existing safety completion guard refuse. Marker corruption, an earlier digest or a skipped branch is never completed. Keep dormant fast branches/defaults unchanged; do not manufacture activation evidence.

Owners: the five existing proof/action modules plus builtins.ts, one shared path helper and their focused tests; task-pipeline.yaml/docs-pipeline.yaml proof callers; docs/design/workflow-composition-contract.md and 04 index note. Repair that satellite's stale synthetic-docs-PASS and removed-baseline statements while syncing the actual proof shape. Increment changed definition versions from current values. No source files outside this ownership are needed.

Dependencies: 0781's lexical fix remains intact; 0784 supplies immutable source identity and honest resumeDefinitionDigest. 0786 consumes the final documentation/guidance without changing proof behavior. No new public noun/verb, dependency, engine, registry, cache, baseline, blanket strictness, fast-route activation, live-run mutation, external review request, host installation, or release. Workflow/source changes below are the implementation handoff, not actions performed by refine.

Execution budget: one owned task at a time; checkpoint after 45 minutes or two unsuccessful fix iterations in .spur/run/0785-execution-notes.md, preserving focused logs. Reproduce with targeted workspace tests before the single final project gate. requireDiff: source/tests for runtime tasks, canonical docs/tests for 0786; no fabricated source edit for refinement. Refinement itself changes planning sections only.
### Plan
- [x] R1/R2: add failing missing/unreadable/wrong-type spec, relative cwd, leaf/ancestor/dangling/root symlink and unsupported-filesystem tests.
- [x] R1/R2: implement shared validated input reads and physical path confinement; preserve legitimate descendants and no-effects refusal.
- [x] R3: implement fresh verify-verdict comparison and authoritative run binding with existing DB/ProcessExecutor seams; test forged vars, mismatched WBS/run/definition/stage digests and missing proof.
- [x] R1/R3/R4: supply canonical task/feature paths on every bracket, move bound registration before completion without duplicate capture, and stamp review from a same-run/same-digest completion marker.
- [x] R5: test unchanged unbound registration and explicit unsupported binding; sync actual contract/legacy projections, run affected safety-path suites, rebuild bundle and run the final project gate.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
Closed the two remaining gaps (spec-blind proof inputs; unsigned artifact binding) through one
confined read path and one bound write path, both physically anchored to the real `.spur/run` tree.

**R2 — spec-complete proof inputs.**
- `packages/app/src/workflow/proof-input-fingerprint.ts:84` — `ProofInputContents` union +
  `SpecReadOutcome`; `readProofInputContents()` (exported, same file) reads the task file and the
  optional linked feature spec through the injected `FileSystem` only: undefined/empty → omitted,
  non-string values rejected by option name, lexical containment under `resolve(workdir)`,
  stat→isFile→readFile failing closed. `computeProofInputFingerprint` folds both contents, so the
  digest now covers every text the completion verdict certifies.
- `packages/app/src/workflow/actions/proof-fingerprint.ts:59` — capture action consumes
  `readProofInputContents`; local `readOptional` (write-capable, `path`-only) deleted.
- `config/workflows/task-pipeline.yaml` — `featureSpecPath` var (line 111, default empty), resolve
  shell + `file.read` at `test` entry (lines ~380–411; declared-but-unresolvable feature fails
  closed, empty stays legitimate), `featureFile:` on all three capture legs (lines 419, 522, 637).
- `config/workflows/docs-pipeline.yaml` — same var + resolver + read + two `featureFile` legs
  (lines 49, 174, 181, 218). Version bumps: task-pipeline `3` (line 32), docs-pipeline `2` (line 19).

**R1/R3 — physical path confinement (`packages/app/src/workflow/actions/run-path.ts`, new).**
- `RunArtifactPathError` (line 9), `within()` (line 30), `resolveRunArtifactPath()` (line 37):
  lexical descent under `resolve(workdir)` first (0781 rule, strict — `.spur/run` itself rejected),
  then canonicalization: workdir realPath, `.spur/run` realPath must stay inside it, ascent to the
  nearest existing ancestor with dangling-symlink rejection, anchor realPath containment, and
  reconstruction of the missing suffix — result strictly inside the canonical run root. A
  `FileSystem` without `realPath` fails closed; symlink escapes are rejected before `ensureDir`,
  dispatch, or any write.
- `packages/app/src/workflow/actions/command-gate.ts:120` and `packages/app/src/workflow/actions/run-artifact.ts:105` and `packages/app/src/workflow/actions/run-artifact.ts:232` — every result/path traversal goes through
  `resolveRunArtifactPath` before any effect; `ensureDir` now guards the parent of the normalized
  file (never the target itself, so a file-named-directory cannot be created).

**R3/R4/R5 — bound, honest artifact registration.**
- `run-artifact.ts` `executeBound` — binding means: fresh `readProofInputContents` capture over
  `taskFile` (required non-empty) + `featureFile` (empty = omitted); run's declared
  `proofDigestNow ?? proofDigest` must match `PROOF_DIGEST_RE` and equal the fresh capture; verdict
  path confined + existing regular file + canonical-verdict valid PASS for the same wbs; raw
  `.proof` block (which the canonical parser strips) validated against the fresh digest, certifying
  run id, and the `RunDao` row's `resumeDefinitionDigest ?? definitionDigest` (authoritative DB
  identity — caller vars are never trusted); `qualityGate`/`verification` stages PASS with that
  digest; `stages.review.status = completed` AND the run-scoped marker
  `.spur/run/<runId>-review-proof.digest` names the same digest; only then `dao.record`. Any
  refusal leaves the artifact ledger empty for the run.
- `packages/app/src/workflow/builtins.ts:96` — `RunArtifactActionRunner` receives `processExecutor` (no ambient executor).
- `config/workflows/task-pipeline.yaml` — review state writes the completion marker right after its
  agent (line 600); verify stamps `review: {status: $rv, ...}` conditionally on the marker
  (line ~695: default `skipped`, never claimed-complete); the `verify → record` guard additionally
  requires `.proof.stages.review.status = "completed"`; record's FIRST onEnter action is the bound
  `run.artifact` (taskFile/featureFile) — before any `task record` or status mutation; the done-state
  `run.artifact` was removed (binding is the record-entry boundary, not a done-state echo).

Docs: `docs/design/workflow-composition-contract.md` (status line, command.gate confinement bullet,
run.artifact contract rewritten to the enforced binding, proof-state paragraph de-staled) and
`docs/04_DESIGN.md` (index row, proof-chain vars, completion-gate paragraph).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/proof-input-fingerprint.ts:118-142` — `readProofInputContents()` keeps `undefined` / `''` legitimately omitted (`:121`), rejects non-string option values by option name, enforces lexical containment under `resolve(workdir)` (`:122-125`), then `stat` → `isFile` → `readFile`, each failing closed with a named error before any digest (`:127-142`). Both task and feature contents fold into the digest. Callers: `config/workflows/task-pipeline.yaml` carries `taskFile` on 4 legs plus a `featureSpecPath` resolver (declared-but-unresolvable fails closed); `config/workflows/docs-pipeline.yaml` on 3 legs. Tests: `packages/app` `bun test tests/workflow/actions/proof-fingerprint.test.ts tests/workflow/proof-input-fingerprint.test.ts` (in the 6-file group below) — 90 pass / 0 fail this run. |
| R2 | MET | `packages/app/src/workflow/actions/run-path.ts:37-50` — `resolveRunArtifactPath()` refuses outright when the FileSystem has no `realPath` (`:42-45`, "refusing to skip confinement (0785 R2)"), applies 0781 lexical descent first (`:48-50`, traversal + sibling prefixes + the run root itself rejected), then canonicalizes so the result is strictly inside the canonical `.spur/run`; dangling symlinks are rejected and a missing output leaf is reconstructed. Wired before any effect at all 3 call sites: `packages/app/src/workflow/actions/command-gate.ts:120` and `packages/app/src/workflow/actions/run-artifact.ts:105,232`. Tests: `tests/workflow/actions/run-artifact.test.ts`, `tests/workflow/actions/command-gate.test.ts` — 90 pass / 0 fail this run. |
| R3 | MET | `packages/app/src/workflow/actions/run-artifact.ts:159-195` — `executeBound()` re-reads the specs itself (`:186-190`, "R1: validated spec reads … BEFORE any digest") and independently captures the current digest instead of trusting caller-supplied vars; the canonical verdict must be PASS for the same wbs and its raw `.proof` block must match the authoritative run identity read from `RunDao` (trace row / resume definition digest), with `qualityGate` and `verification` stage digests equal to the fresh capture. A digest-shaped workflow var alone is insufficient and a forged matching var cannot bless stale content — every refusal returns before the ArtifactDao ledger write and leaves the task lifecycle unmutated (`:86-89` doc comment). Tests: forged-var, mismatched wbs / run / definition / stage cases — 90 pass / 0 fail this run. |
| R4 | MET | `config/workflows/task-pipeline.yaml:598-600` writes the run-scoped marker `.spur/run/$__runId-review-proof.digest` immediately after the review agent; `:696-700` stamps `RV="completed"` only when that marker exists AND equals the current `$proofDigest` (default `"skipped"`); `:730-734` the verify→record registration comment requires `proof.stages.review.status = completed` independently evidenced by the same run-scoped marker (0785 R4). A skipped or stale review marker is therefore never completed evidence. ADR-107 Option B and the existing safety-completion requirements are untouched. Tests: `tests/workflow/task-pipeline-proof-chain.test.ts`, `tests/workflow/docs-pipeline-proof-chain.test.ts` — 90 pass / 0 fail this run. |
| R5 | MET | `packages/app/src/workflow/actions/run-artifact.ts:88-93` — an unsupported `proofBinding` is refused explicitly ("only \"current\" is defined (ADR-071)"); `:165-172` a `current` binding on any kind other than `verify-verdict` fails as unsupported rather than inventing a second proof envelope. Unbound path-only artifact registration is preserved unchanged; no new registry, envelope or runtime sandbox is introduced, and `packages/app/src/workflow/actions/run-path.ts:33-36` documents the bounded local-filesystem threat model (static symlink escapes, explicitly not TOCTOU, no sandbox). Docs synced in the same change: `docs/design/workflow-composition-contract.md`, `docs/04_DESIGN.md`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Declared missing proof inputs fail closed | MET | test | `packages/app/src/workflow/proof-input-fingerprint.ts:127-138` — an explicitly supplied spec that does not exist returns a named error ("an explicitly supplied spec must be readable, not silently omitted") and no digest is produced; a workdir-relative spec is resolved against `resolve(workdir)` and read from there (`:122-125`), while anything escaping the workdir is refused. Linked feature-spec contents fold into the same digest, so a feature requirement change invalidates task and docs proof. Executable evidence: `cd packages/app && bun test tests/workflow/actions/proof-fingerprint.test.ts tests/workflow/actions/run-artifact.test.ts tests/workflow/actions/command-gate.test.ts tests/workflow/proof-input-fingerprint.test.ts tests/workflow/task-pipeline-proof-chain.test.ts tests/workflow/docs-pipeline-proof-chain.test.ts` → 90 pass / 0 fail, 353 expect() calls, this run. |
| Scenario: R2 — Artifacts cannot escape through symlinks or claim false binding | MET | test | `packages/app/src/workflow/actions/run-path.ts:37-50` rejects leaf/ancestor symlink escapes, dangling symlinks and any path outside the canonical `.spur/run` root before the external write, and fails closed when `realPath` is unavailable; it is invoked ahead of every effect from `packages/app/src/workflow/actions/command-gate.ts:120` and `packages/app/src/workflow/actions/run-artifact.ts:105,232`. Mismatched proof is refused in `packages/app/src/workflow/actions/run-artifact.ts:159-195` before the ledger record, and `config/workflows/task-pipeline.yaml:696-700` reports review `completed` only against the matching run-scoped digest marker, so unexecuted review is never reported completed and the task cannot transition done before artifact binding succeeds. Executable evidence: same 6-file group, 90 pass / 0 fail this run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- docs/plans/2026-09-06-workflow-conflict-audit.md — F-07; tasks 0751 and 0781.
- docs/00_ADR.md — ADR-069/071, ADR-107 Option B, ADR-108; docs/design/workflow-composition-contract.md.
- packages/app/src/workflow/proof-input-fingerprint.ts; packages/app/src/services/verify-verdict.ts; packages/app/src/services/verified-outcome.ts.
- Installed @gobing-ai/ts-runtime src/file-system.ts:19 — installed FileSystem contract, optional realPath, no lstat.
- Dependency 0784 supplies execution/launch identity separation; downstream 0786.
### History
- 2026-09-06T22:00:27.194Z todo → wip (system)
- 2026-09-06T22:35:25.070Z wip → testing (system)
- 2026-09-06T22:35:26.054Z testing → done (system)
