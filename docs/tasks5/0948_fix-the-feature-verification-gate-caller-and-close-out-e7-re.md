---
schema_version: 1
name: Fix the feature-verification gate caller and close out E7 review findings
status: todo
template: standard
created_at: 2026-09-24T07:19:45.903Z
updated_at: "2026-09-24T07:29:16.470Z"

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-24T07:29:16.470Z backlog → todo (system)

