---
schema_version: 1
name: Fix the feature-verification gate caller and close out E7 review findings
status: testing
template: standard
created_at: 2026-09-24T07:19:45.903Z
updated_at: "2026-09-24T18:32:23.548Z"

priority: P1
---

## 0948. Fix the feature-verification gate caller and close out E7 review findings

### Background

The E7 batch (0925–0929) shipped the two-file run record and reached feature `done`. During the
batch and its wrap hop, defects and deferred advisories surfaced that **no open task owns**:

- The feature-done gate's authority caller passes an incomplete `--vars` map, so the ADR-119
  feature-scoped pass cannot record a receipt — every feature's `verifying → done` transition fails
  through the documented path (`spur feature sync`). `--vars` **replaces** the workflow var map
  (no merge), which is the underlying footgun; a partial override silently empties `spurBin`.
- The pass script's source-mode module loader can never satisfy its seam contract, and its error
  advice ("rebuild/install the sp plugin") cannot fix a source-tree gap.
- The task precheck scripts silently swallow unknown flags and let a later positional overwrite
  `wbs`, so a mis-invocation FAILs with a garbage-named status file and a masked exit code.
- Tasks 0925–0929 each recorded deferred advisories in their own files; those are pointers, not
  owners. Evidence for all of the above is in `.spur/run/batch-e7-202609231946/{batch-report.md,
  wrap-hop.md}` and `docs/dogfood/2026-09-23-E7-run-record-gate-dogfood.md`.

Not in scope: the 65 `running` rows accumulated in `.spur/spur.db` (already owned by 0937, which
E7's completion unblocks) and the two-sessions-one-checkout incident (operational, no code owner).

### Requirements

- [ ] R1. `config/workflows/feature-lifecycle.yaml:45` passes only `featureId` to the nested
  `feature-verification.yaml` run, so the inner `spurBin` var is empty, `loadModule` falls back to
  source mode and the pass fails with `application entry is missing feature-verification seams`.
  Make the documented caller work end to end.
- [ ] R2. `spur workflow run --vars` replaces the workflow var map instead of merging it, so a
  partial override silently drops every other var (`spurBin` included). Either merge with the
  definition's declared defaults or reject a var set that leaves declared vars unset.
- [ ] R3. `feature-verification-steps.ts` `loadModule` prefers `packages/app/src/index.ts` whenever a
  source checkout is detected, but that entry does not re-export `splitLaunchCommand` /
  `ArtifactDao` (0 matches; the generated bundle does), and the thrown advice ("rebuild/install the
  sp plugin") cannot fix a source-tree gap.
- [ ] R4. `plugins/sp/scripts/task-size-precheck.ts` and `task-evidence-precheck.ts` `parseArgs`
  ignore unknown `--flags` (`else { i++; }`) and let any later positional overwrite `wbs`, so
  `script 0926 --task-file x.md` fetches `x.md`, writes a garbage-named status file and FAILs.
  Reject unknown flags and keep the first positional.
- [ ] R5. 0929 inspection hardening: the server maps 400 by string-matching the seam error message
  `Invalid workflow run id` (`apps/server/src/modules/observability/index.ts`), so wording drift
  yields a 500; state JSON is served parse-trusted without read-side re-redaction
  (`packages/app/src/services/workflow-service.ts`); the cap is named as bytes but applied to a
  string bound; realpath/stat/read TOCTOU windows remain.
- [ ] R6. 0926 legacy continue/read: a mid-follow legacy→`.md` transition re-emits the whole file
  from the top; `existsSync`/`readFileSync` TOCTOU classifies a vanished pair as `state-invalid`
  instead of `state-missing`; an empty legacy `.log` yields a misleading `--no-log` hint.
- [ ] R7. 0927 inline seam: a re-setup after failure can leave a stale `error` key in `.state.json`
  (no retry-with-same-id flow); the retired sidecar `ok` value is not projected; the
  `inline-run-setup.ts` header-ordering hazard (`!existsSync(markdownPath)` before the identity
  write) can invert the header/body order.
- [ ] R8. 0928 docs and catalogue: the task doc cites scripts without their package paths; the
  `run-record-catalog` sweep strips only placeholder-prefixed run ids (a literally hardcoded record
  name would evade it); `config/workflows/history-anatomy.yaml` points at a fixed-name record under
  `.spur/run` that has no retention path.
- [ ] R9. Batch-driver surface: the default worktree path under `.spur/` breaks biome vcs-root
  detection ("Checked 0 files", worked around by relocating to `.wt-e7-*`); a batch's own
  `.spur/run` records are removed with the worktree (copy-out is undocumented); and the driver doc
  does not state the verify-answer table contract (AC table must be 4 columns with the
  evidence-type token isolated in cell 3).

### Acceptance Criteria

- [ ] AC1 — A feature in `verifying` reaches `done` via `spur feature sync <id>` alone, with the
  receipt written by the `feature-lifecycle` invocation (no manual pass run). Covers R1, R2.
- [ ] AC2 — `spur workflow run <wf> --vars '{"one":"x"}'` leaves every other declared var at its
  definition default, or is rejected with a message naming the missing vars; a CLI test proves it.
  Covers R2.
- [ ] AC3 — A source checkout's pass script fails with an error that names the mode and the fix
  (not "rebuild/install the sp plugin"), and a targeted test asserts it. Covers R3.
- [ ] AC4 — Both precheck scripts exit non-zero on an unknown flag and ignore a later positional;
  a regression test fails against the current implementation. Covers R4.
- [ ] AC5 — The observability run-record route returns 400 for an invalid id without matching the
  seam's message text, and the served state JSON is re-redacted on read. Covers R5.
- [ ] AC6 — The 0926/0927/0928 items each carry a focused test or a recorded, justified exemption,
  and the default worktree root no longer breaks biome. Covers R6–R9.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **R1/R2 root cause.** `--vars` replace-not-merge is the defect; the caller is its first victim.
  Fix both: make the caller explicit (`--vars "{\"featureId\":\"$featureId\",\"spurBin\":\"$spurBin\"}"`)
  **and** give `--vars` merge semantics against the definition's declared defaults, so a partial
  override can never silently blank a declared var. Verify the caller only by running
  `spur feature sync <id>` on a feature in `verifying` — the nested JSON quoting is not provable
  statically.
- **R3 direction.** Either re-export the required seams from `packages/app/src/index.ts`, or make
  `loadModule`'s mode explicit (source vs bundle) and have the error name the mode and the fix.
  Prefer the explicit mode: the source entry is not the contract surface for plugin scripts.
- **R4 direction.** In both prechecks, replace the trailing `else { i++; }` with a refusal that
  prints usage and exits 1 (`usage()` already exits 1), and set `wbs` only when unset. Keep the
  existing `task-pipeline.yaml:186,191` invocation working (positional wbs + `--spur-bin` /
  `--max-reqs` / `--max-plan-items`). Regenerate both `.mjs` twins via
  `superskill script convert sp <name>.ts`.
- **R5 direction.** Introduce a typed/sentinel error (or an error code) for the invalid-run-id case
  and map on that instead of the message; re-redact on read at the sink boundary; rename the cap to
  match its unit; collapse the realpath/stat/read sequence to one open-then-verify.
- **R6/R7/R8.** Behaviour-level repairs confined to the run-record read/write seams and the two
  docs/config items; keep the existing `readWorkflowRunRecord` seam as the single write/read owner.
- **R9.** Prefer relocating the default worktree root outside `.spur/` over documenting the
  workaround, and state the copy-out requirement plus the verify-answer table contract in the
  driver reference.
- **Sequencing.** R1–R4 are gate-integrity fixes and come first; R5–R8 are the deferred advisories;
  R9 is documentation/default-path work that can land last.

### Plan

- [ ] P1. Fix the `feature-lifecycle` caller var set and add merge-or-reject semantics to
  `--vars`; cover with a CLI test that a partial `--vars` keeps declared defaults.
- [ ] P2. Prove the caller end to end: a feature in `verifying` reaches `done` through
  `spur feature sync <id>` alone, with the receipt produced by the lifecycle invocation.
- [ ] P3. Make `loadModule`'s source/bundle choice explicit and replace the misleading
  "rebuild/install the sp plugin" advice; regenerate the `.mjs` twin.
- [ ] P4. Reject unknown flags and stop the positional overwrite in both precheck scripts; add a
  regression test that `script <wbs> --task-file x.md` exits non-zero and writes no status file.
- [ ] P5. Regenerate both precheck `.mjs` twins and re-run the task-pipeline precheck steps.
- [ ] P6. Add a typed invalid-run-id error and map the server 400 on it; extend the observability
  route test with a non-matching message.
- [ ] P7. Re-redact state JSON on read; rename the inspect cap to its real unit; collapse the
  realpath/stat/read TOCTOU window.
- [ ] P8. Fix the 0926 read-path items (whole-file re-emit, TOCTOU classification, empty-log hint)
  with focused tests in the workflow service/CLI suites.
- [ ] P9. Fix the 0927 inline-seam items (stale `error` key, unprojected sidecar `ok`, header-order
  hazard) with tests in `plugins/sp/tests/inline-run-setup.test.ts`.
- [ ] P10. Close the 0928 items: script paths in the task doc, catalogue sweep for non-placeholder
  record names, and a retention path or explicit exemption for the `history-anatomy.yaml` pointer.
- [ ] P11. Relocate the default batch worktree root outside `.spur/` and verify biome reports a
  non-zero file count there.
- [ ] P12. Document worktree record copy-out and the verify-answer table contract in the driver
  reference.
- [ ] P13. Run `bun run spur-check` plus the affected plugin tests; record the results.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/workflow.ts:2037` |
| `apps/cli/tests/commands/workflow.test.ts:2305` |
| `apps/server/src/modules/observability/index.ts:372` |
| `apps/server/tests/modules/observability/index.test.ts:2` |
| `apps/server/tests/modules/observability/index.test.ts:597` |
| `apps/server/tests/modules/observability/index.test.ts:608` |
| `packages/app/src/index.ts:690` |
| `packages/app/src/services/workflow-service.ts:1` |
| `packages/app/src/services/workflow-service.ts:2505` |
| `packages/app/src/services/workflow-service.ts:2546` |
| `packages/app/src/services/workflow-service.ts:2551` |
| `packages/app/src/services/workflow-service.ts:2569` |
| `packages/app/src/services/workflow-service.ts:2583` |
| `packages/app/src/services/workflow-service.ts:2586` |
| `packages/app/src/services/workflow-service.ts:2608` |
| `packages/app/src/services/workflow-service.ts:2620` |
| `packages/app/src/services/workflow-service.ts:2622` |
| `packages/app/src/services/workflow-service.ts:2630` |
| `packages/app/src/services/workflow-service.ts:2637` |
| `packages/app/src/services/workflow-service.ts:2643` |
| `packages/app/src/services/workflow-service.ts:2676` |
| `packages/app/src/services/workflow-service.ts:2679` |
| `packages/app/src/services/workflow-service.ts:2694` |
| `packages/app/src/services/workflow-service.ts:2699` |
| `packages/app/src/services/workflow-service.ts:2710` |
| `packages/app/tests/services/workflow-service.test.ts:2615` |
| `packages/app/tests/services/workflow-service.test.ts:2683` |
| `plugins/sp/scripts/feature-verification-steps.ts:100` |
| `plugins/sp/scripts/feature-verification-steps.ts:23` |
| `plugins/sp/scripts/feature-verification-steps.ts:39` |
| `plugins/sp/scripts/feature-verification-steps.ts:59` |
| `plugins/sp/scripts/feature-verification-steps.ts:72` |
| `plugins/sp/scripts/feature-verification-steps.ts:75` |
| `plugins/sp/scripts/feature-verification-steps.ts:81` |
| `plugins/sp/scripts/feature-verification-steps.ts:85` |
| `plugins/sp/scripts/inline-run-setup.ts:225` |
| `plugins/sp/scripts/inline-run-setup.ts:245` |
| `plugins/sp/scripts/inline-run-setup.ts:256` |
| `plugins/sp/scripts/inline-run-setup.ts:53` |
| `plugins/sp/scripts/task-evidence-precheck.ts:77` |
| `plugins/sp/scripts/task-evidence-precheck.ts:83` |
| `plugins/sp/scripts/task-size-precheck.ts:127` |
| `plugins/sp/scripts/task-size-precheck.ts:133` |
| `plugins/sp/tests/inline-run-setup.test.ts:63` |
| `plugins/sp/tests/run-record-catalog.test.ts:25` |
| `plugins/sp/tests/run-record-catalog.test.ts:31` |
| `plugins/sp/tests/run-record-catalog.test.ts:44` |
| `plugins/sp/tests/run-record-catalog.test.ts:87` |
| `plugins/sp/tests/run-record-catalog.test.ts:92` |
| `plugins/sp/tests/task-evidence-precheck.test.ts:11` |
| `plugins/sp/tests/task-evidence-precheck.test.ts:299` |
| `plugins/sp/tests/task-size-precheck.test.ts:207` |

### Testing

**Pipeline verify results**

- Verdict: FAIL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | PARTIAL | Caller repaired at `config/workflows/feature-lifecycle.yaml:48` (`--vars "{\"featureId\":\"$featureId\",\"spurBin\":\"$spurBin\"}"`); JSON payload parses with a space-bearing `spurBin` (verified with `jq`). It does not execute: `bun apps/cli/src/index.ts feature sync F21 --json` from a real `active` state committed `active → verifying` and then denied `verifying → done` with "no feature-latest receipt"; `SELECT COUNT(*) FROM runs WHERE workflow_name LIKE '%feature-verification%'` returned 0; `.spur/run/F21-feature-verification.json` was never written. Engine `dist/service.js:228-288` runs no `onEnter`; `dist/state-machine.js:65` is the only executor. Engine is external (`@gobing-ai/ts-dual-workflow-engine@^0.5.5`, no workspace source) → task 0949. |
| R2 | MET | Already satisfied: engine `dist/variables.js:5` `mergeVars` merges declared defaults under the override. Pinned by `apps/cli/tests/commands/workflow-vars-merge.test.ts` — partial `--vars` leaves `beta=DEFAULT_BETA`, omitted leaves both defaults, full override replaces both (3 pass). |
| R3 | MET | `plugins/sp/scripts/feature-verification-steps.ts:72-105` loads the generated bundle, never `packages/app/src/index.ts`; failures name `mode=bundle` and the real fix. `plugins/sp/tests/feature-verification-steps-mode.test.ts` (3 pass) asserts the missing-bundle and seam-less-bundle messages, the absence of the retired advice, and that the source app entry is not referenced. |
| R4 | MET | `task-size-precheck.ts:126-136` and `task-evidence-precheck.ts:76-86`: unknown flag prints `unknown flag: <arg>` and exits 1; first positional wins. Manual: `--task-file x.md` → exit 1 with no status file; `0948 0999` → writes `0948-precheck-size.status`. Regression tests added to both suites. |
| R5 | MET | `InvalidWorkflowRunIdError` (`workflow-service.ts:2512`, `code: 'invalid-run-id'`) thrown at `:2546`; server maps on the code at `apps/server/src/modules/observability/index.ts:374`. `redactJsonValue` (`:2648`) re-redacts state on read. Caps split into `RUN_RECORD_INSPECT_MAX_BYTES`/`_MAX_CHARS` (`:2585`/`:2591`). `readConfinedRunFile` (`:2619-2634`) opens once with `O_NOFOLLOW`, then `fstat` + dev/ino identity vs the confined realpath. |
| R6 | MET | `workflow-service.ts:2553-2568` reads the state in one call, so ENOENT is `state-missing` and every other failure is `state-invalid`. `apps/cli/src/commands/workflow.ts:2036-2046` reports an empty record instead of the `--no-log` hint. The documented legacy→`.md` switch is pinned by the existing 0926 CLI test. |
| R7 | MET | `plugins/sp/scripts/inline-run-setup.ts:229` projects `ok`; a successful re-setup drops any prior `error`; `:251` writes the `.md` header with an exclusive `openSync(..., 'wx')`. `plugins/sp/tests/inline-run-setup.test.ts` `0948 R7` asserts no `error` key after re-setup and exactly one header. |
| R8 | MET | `plugins/sp/tests/run-record-catalog.test.ts:58` `isRecordName` catches a literally hardcoded record name while exempting run-id-suffixed artifacts — mutation-checked both ways. `history-anatomy.yaml:94` carries the retention exemption, recorded in `docs/design/run-record-contract.md`. Three bare script citations in `docs/tasks5/0928_*.md` gained package paths via CLI-gated section writes (`task check 0928` passes). |
| R9 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md` states the worktree location rule with measured evidence (sibling `Checked 1076 files` vs `.spur/`-nested `Checked 0 files`) and the per-stage record copy-out requirement. `inline-pipeline-driver.md` states the AC-table shape: 4 columns, one isolated evidence-type token in cell 3. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | UNMET | command | `bun apps/cli/src/index.ts feature sync F21 --json` from a real `active` state: hop committed to `verifying`, then `verifying → done` denied with "no feature-latest receipt". Run-row count for `feature-verification` = 0; no receipt file written. The onEnter never executes under `requestTransition`. Follow-up: task 0949. |
| AC2 | MET | test | `apps/cli/tests/commands/workflow-vars-merge.test.ts` 3 pass: partial → `alpha=OVERRIDE beta=DEFAULT_BETA`; omitted → both defaults; full → both replaced. |
| AC3 | MET | test | `plugins/sp/tests/feature-verification-steps-mode.test.ts` 3 pass: missing and seam-less bundles assert `mode=bundle`, `build:bundle`, the bundle path, and the absence of "rebuild/install the sp plugin". |
| AC4 | MET | test | `plugins/sp/tests/task-size-precheck.test.ts` and `task-evidence-precheck.test.ts`: the two `0948 R4` tests each pass — exit non-zero with `unknown flag: --task-file` and no garbage status file, and first-positional-wins writes `0926-…status` while `x.md` is ignored. |
| AC5 | MET | test | `apps/server/tests/modules/observability/index.test.ts` 24 pass: typed error → 400; plain Error with the old message → 500 (not reclassified); code stability. `packages/app/tests/services/workflow-service.test.ts` `0948 R5` 2 pass: nested state values and keys redacted; `maxBytes` gates size while `maxChars` bounds text. |
| AC6 | MET | test | `0948 R6` (app + CLI), `0948 R7` (inline-run-setup), `0948 R8` (catalog mutation check) all pass; `execution-batch.md` names the sibling root and the measured Biome failure; `history-anatomy.yaml:94` plus `run-record-contract.md` record the retention exemption. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P1 | functional-traceability | `config/workflows/feature-lifecycle.yaml:48` | R1/AC1 unmet — the caller is repaired but never executes: the engine's external-transition path (`@gobing-ai/ts-dual-workflow-engine` `dist/service.js:228-288` `evaluateAndCommit`) evaluates the guard and commits the hop without running the entered state's `onEnter`; only the driver runs `onEnter` (`dist/state-machine.js:65`). Evidence: a real `active → verifying` sync created a `feature-lifecycle` run row and **0** `feature-verification` run rows and no receipt, then the `verifying → done` guard denied with "no feature-latest receipt". The engine is an external catalog dependency with no workspace source, so the fix belongs upstream — filed as task 0949. |
| P4 | functional-traceability | `packages/app/src/services/workflow-service.ts:2512` | R2 was already satisfied — the engine merges declared vars under the override (`dist/variables.js:5`). Pinned at the CLI boundary with a new regression test rather than changed, so a future flip back to replace-semantics fails in the CLI suite. |
| P4 | secu-review | `packages/app/src/services/workflow-service.ts:2619` | R5 TOCTOU closed with one `open(O_NOFOLLOW)` + `fstat` + dev/ino identity against the confined realpath, replacing the `realpath → stat → read` triple-resolve. Confinement no longer depends on a symlink follow, and the served bytes are provably the checked inode. |
| P4 | secu-review | `packages/app/src/services/workflow-service.ts:2648` | R5: the served state JSON was parse-trusted while the markdown was scrubbed; `redactJsonValue` now re-redacts nested values and keys on read. |
| P4 | design-conformance | `plugins/sp/skills/spur-dev/references/execution-batch.md` | R9: the worktree location rule and its Biome failure mode are stated with measured evidence (sibling `Checked 1076 files` vs `.spur/`-nested `Checked 0 files`), and the per-stage record copy-out requirement is explicit (E7 Finding 5). |
| P4 | scope-creep | `docs/tasks5/0928_*.md` | Three bare script citations in another task's evidence sections gained their package paths via CLI-gated section writes (`task check 0928` still passes). Within R8's explicit scope; no other task content touched. |
| P4 | quality-gate | — | `bun run spur-check` exit 0 — 8898 pass / 0 fail across 508 files, lint + typecheck clean, post-check rules pass. `.spur/run/0948-test-gate.status` = PASS. |
| P4 | focused-tests | — | New/extended: `workflow-vars-merge.test.ts` (3), `feature-verification-steps-mode.test.ts` (3), precheck `0948 R4` (4), app `0948 R5`/`R6`, server observability (24), `run-record-catalog.test.ts` (13), `inline-run-setup.test.ts` (10) — all pass. |
| P4 | evidence-rule-pass | — | Every behavior-bearing AC row carries executable evidence; AC1 is recorded UNMET with its command evidence and a named follow-up rather than papered over. |

**Residual risk.** (1) AC1/R1 — the feature-done gate still cannot pass until task 0949 lands the
engine-side `onEnter` execution; any feature entering `verifying` through the lifecycle records no
receipt. (2) The AC1 probe's `running` `feature-lifecycle` row was not reclaimed (the orphan class
owned by 0937); it lives only in this worktree's gitignored DB. (3) `spurBin` is interpolated into a
nested JSON string by shell, so a `spurBin` containing a quote or backslash would break the payload —
not reachable with `resolveSpurBin()` output.

**Final disposition.** PARTIAL — 12 of 13 plan items landed with tests and a green full gate; the
caller repair (R1) is correct but unreachable in this repository, so AC1 is unmet and ownership moved
to task 0949.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-24T07:29:16.470Z backlog → todo (system)
- 2026-09-24T18:16:24.051Z todo → wip (system)
- 2026-09-24T18:32:23.548Z wip → testing (system)

