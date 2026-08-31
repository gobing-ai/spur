---
schema_version: 1
name: "Harden history import provenance and pipeline verify loop (0722 session review)"
status: backlog
template: meta
created_at: 2026-08-31T15:58:12.645Z
updated_at: "2026-08-31T17:05:42.221Z"
feature_id: F91
ac_altitude: task-local
---

## 0726. Harden history import provenance and pipeline verify loop (0722 session review)

### Background
Task 0722 eventually passed, but three avoidable feedback-loop failures consumed three runs and roughly ten hours:
the published importer destroyed the `history_tool_call.args_raw` evidence channel on a full pi import, the pipeline
did not prove that live-data premise before implementation, and a 30-minute verify timeout discarded nearly complete
work before a mechanical verdict parse retry.

Current-tree verification on 2026-08-31 corrected the original capture:

- Spur and the npm registry both resolve `@gobing-ai/ts-llm-jsonl-importer` 0.4.48. That build retains todo-tool
  arguments only. Upstream commit `96762d5` adds pi/claude/opencode bash-command retention but is not in a published
  release. A full pi import with 0.4.48 can upsert the same messages with `args_raw = NULL`; task 0722 observed 73k
  affected tool arguments and repaired them from the fixed upstream tree.
- `packages/app/src/services/task-verdict.ts` already accepts compound evidence labels such as `test + command` and
  emits an `ac-row-dropped` failure for unknown labels. The old compound-label incident is evidence for a pre-write
  lint, not a missing parser feature.
- `packages/app/src/workflow/actions/agent-run.ts` writes `answerFile` only after a successful agent exit. A timeout
  therefore leaves no resumable verify answer even though live output was produced.
- During this refinement, task 0722 was re-verified concurrently. Its Acceptance Criteria rows now use the exact E6
  scenario titles, and `spur feature check E6 --json` is clean. This proves the existing matcher is sufficient; 0726
  must prevent malformed future verifier output, not widen feature matching or rewrite certified evidence.

Scope is the smallest set of guards that shortens the same future loop: fail closed before destructive import, prove
declared live-data channels in pipeline precheck, preserve and lint verifier progress, then reconcile the corpus
baseline once no other writer owns task/verdict state. Task 0726 remains linked to F91 because the remaining corpus
work is gate integrity; E6 is only the regression fixture.

### Requirements
- [ ] **R1. Importer provenance guard.** Before opening the project DB, reject every non-dry-run `full` import whose
  selected sources include `pi` when the resolved `@gobing-ai/ts-llm-jsonl-importer` version is unknown or lower than
  `0.4.49`. Reuse the existing `resolveImportProvenance` result, surface error code `unsafe-history-importer` with the
  installed version, minimum safe version, destructive `args_raw` reason, and upgrade/relink remedy, and leave the DB
  accessor uncalled. Dry-run and non-pi imports remain available. The guard is hard-fail in this task; there is no
  warn-only rollout for a path already proven to destroy retained evidence.
- [ ] **R2. Deterministic evidence-channel precheck.** Recognize the exact repeatable task-AC declaration
  `evidence-channel: history_tool_call.args_raw[pi]`. Before implementation, a plugin script must run the fixed query
  `SELECT COUNT(*) FROM history_tool_call WHERE args_raw IS NOT NULL AND source = 'pi'`; a missing DB/table or zero
  count writes FAIL and prints the declaration plus query, while no declaration writes PASS. The pipeline guard must
  require both the existing size status and this evidence status. Do not accept embedded SQL or add a generic probe
  registry in this slice.
- [ ] **R3. Resumable, linted verify answer.** `/sp:dev-verify` must create
  `.spur/run/<wbs>-verify-answer.txt` itself and append one complete requirement/AC row after it is certified. A retry
  reads valid existing rows and verifies only missing IDs. The workflow must use `expectFile` so `agent.run` does not
  overwrite progress after exit. Before `spur task verdict --from-answer`, a deterministic plugin lint must reject
  missing, duplicate, or unknown R IDs; AC IDs that do not exactly match the task's checklist label or scenario title;
  invalid status/evidence-type values; and empty evidence. Preserve the existing compound evidence normalization and
  final verdict derivation.
- [ ] **R4. Corpus reconciliation at commit prep.** After R1-R3 and owned docs land, confirm
  `spur feature check E6 --json` remains clean and the pre-implementation 0722 verdict hash is unchanged, then run
  `bun run corpus-check`, repair only 0726-owned findings, and regenerate `config/corpus-baseline.json` with
  `bun run scripts/commands/regen-corpus-baseline.ts` only from a tree with no other writer's task/verdict changes.
  Record the remaining accepted-Open set in the resulting diff/commit and run the full project gates once.

**Out of scope:** publishing the upstream importer release; fixing importer `record_hash` stability; arbitrary SQL
evidence declarations; a new public `spur` noun/verb/flag; changing the feature scenario matcher; rewriting certified
0722 evidence; stale editor/LSP diagnostics; the unrelated history-board security heuristic; and F91's missing
dogfood artifact.

### Acceptance Criteria
- [ ] AC1 (R1): with importer version `0.4.48` or `unknown`, a non-dry-run full pi/all import returns
  `unsafe-history-importer` before `getDb`; version `0.4.49+`, dry-run, and full non-pi paths reach the existing import
  flow. Unit tests assert the DB accessor and importer are untouched on rejection.
- [ ] AC2 (R2): a task with `evidence-channel: history_tool_call.args_raw[pi]` gets PASS for a positive fixture count
  and FAIL for zero/missing DB/table, with the fixed SQL printed; a task without the declaration passes without
  opening SQLite. Pipeline contract tests prove evidence FAIL blocks `precheck -> implement`.
- [ ] AC3 (R3): pre-seeding a partial answer with certified rows and rerunning verify preserves those rows and resumes
  at the first missing ID. The lint rejects each invalid class with a row-level message before verdict derivation,
  while a complete answer using exact AC titles and `test + command` passes and produces the existing normalized
  verdict shape.
- [ ] AC4 (R4): `spur feature check E6 --json` remains free of `L4.verdict-rows-match-no-scenario` and
  `L4.scenario-unverified`; the 0722 verdict SHA-256 captured immediately before implementation is identical after
  all gates; targeted workspace tests, `bun run spur-check`, and the single commit-prep `bun run corpus-check` pass;
  and no unrelated working-tree file is staged or changed.

### Q&A
<!-- CLOSED decisions from implement-ready refinement. No open questions remain. -->

#### Q&A entry — 2026-08-31 implement-ready refinement

- **Hard fail versus warning:** hard fail now. The 0.4.48 path has already caused evidence loss; a warning preserves the
  unsafe default and contradicts AC1.
- **Safe importer threshold:** `0.4.49` is the first permissible patch after the verified published 0.4.48. Unknown and
  prerelease versions fail closed. The upstream fix itself remains owned by `gobing-ai/ts-libs` commit `96762d5`.
- **Evidence declaration surface:** one allowlisted declaration only. Arbitrary task-authored SQL would turn corpus text
  into executable input and is rejected.
- **Verify transport:** the verifier owns the progress file and the workflow checks it with `expectFile`; retaining
  `answerFile` would overwrite resumable content at successful exit.
- **E6 alignment:** concurrent 0722 re-verification corrected the AC row identities and made E6 clean. No matcher change
  is needed; exact AC identity is enforced at the verifier lint boundary instead.
- **Compound evidence labels:** already fixed by task 0568; no parser expansion is part of 0726.
- **Baseline timing:** refinement observed concurrent 0722 task/verdict writes plus unrelated domain changes. R4 must
  capture the final pre-implementation verdict hash and wait for a clean single-writer boundary.
### Design
**R1 — provenance guard**

- Reuse `resolveImportProvenance` in `apps/cli/src/commands/history.ts`; resolve it before service construction and pass
  `importerVersion` through `HistoryServiceContext`.
- In `packages/app/src/services/history-service.ts`, add
  `MIN_SAFE_PI_BASH_IMPORTER_VERSION = '0.4.49'`, a small numeric semver-triple comparison (no dependency), and
  `UnsafeHistoryImporterError` with code `unsafe-history-importer`.
- Call one shared assertion at the start of both direct `import` and fan-out `importAll`, before `getDb`. It applies
  only to non-dry-run full imports containing pi. Unknown, malformed, and prerelease versions are unsafe.
- Extend `packages/app/tests/services/history-service.test.ts` and `apps/cli/tests/commands/history.test.ts`; inject the
  version in service fixtures rather than reading the host package.

**R2 — evidence precheck**

- Add `plugins/sp/scripts/task-evidence-precheck.ts`, patterned after `task-size-precheck.ts`: fetch the task via
  `spur task show <wbs> --json`, parse repeated exact declarations, query `.spur/spur.db` with `bun:sqlite`, write
  `.spur/run/<wbs>-precheck-evidence.status`, and always exit 0 so the status file is the fail-closed contract.
- Support only `history_tool_call.args_raw[pi]` and its fixed parameterized query. An unknown declaration is FAIL.
- Add the script action to `config/workflows/task-pipeline.yaml` precheck and require its PASS status in both outgoing
  guards. Document the declaration in `plugins/sp/skills/spur-dev/references/gate-checklists.md` and the history
  contract in `docs/04_DESIGN.md`. Tests live in `plugins/sp/tests/task-evidence-precheck.test.ts` and the existing
  pipeline resilience/inline-driver suites.

**R3 — verify progress and lint**

- Update `plugins/sp/skills/code-verification/SKILL.md` and its verdict reference: initialize the canonical answer file
  with `Verdict: PARTIAL`, append complete Markdown table rows in task order, and on resume retain only rows that pass
  the same lint contract. Replace the first verdict line only after all rows are certified.
- Add `plugins/sp/scripts/verify-answer-lint.ts`. It obtains the task through `spur task show`, compares R IDs and exact
  AC checklist/scenario identities, reuses the documented status/evidence vocabulary, and exits non-zero with bounded
  row diagnostics. It writes nothing.
- In `config/workflows/task-pipeline.yaml`, replace verify's `answerFile` with `expectFile`, run the lint immediately
  after the agent returns, then run the existing `spur task verdict`. Do not change `agent.run`, `feature-check.ts`, or
  the public task-verdict surface.

**R4 — handoff and anti-patterns**

- Capture the current 0722 verdict SHA-256 at implementation start. Update owned design/skill surfaces, then use
  `sp:doc-evolve` sync-check before final gates. Preserve the concurrent 0722 task/verdict work and unrelated dirty
  domain files.
- Do not add a generic evidence-probe framework, a second verdict format, a new dependency, a warning-only bypass, a
  broader feature matcher, or a compatibility rewrite of historical verdict JSON.

### Plan
- [ ] 1. Capture the current 0722 verdict SHA-256. Add failing R1 service/CLI tests for unsafe, safe, dry-run, non-pi,
  unknown-version, and pre-DB rejection paths; implement the shared guard by reusing `resolveImportProvenance`. (R1)
- [ ] 2. Add `task-evidence-precheck.ts` and focused fixtures, then wire its status into both task-pipeline precheck
  guards and update the evidence-channel contract docs. (R2)
- [ ] 3. Add verifier partial-file/resume instructions and `verify-answer-lint.ts` tests for complete, partial,
  duplicate, unknown, empty-evidence, bad-status, bad-evidence-type, inexact-AC, and compound-type answers. (R3)
- [ ] 4. Switch the verify workflow action from `answerFile` to `expectFile`, insert lint before verdict derivation,
  and update workflow/inline-driver contract tests. (R3)
- [ ] 5. Update `docs/04_DESIGN.md` and plugin references, run `sp:doc-evolve` sync-check, then run focused tests from
  inside `packages/app`, `apps/cli`, and `plugins/sp`. Confirm E6 stays clean and the captured hash is unchanged.
  (R1-R4)
- [ ] 6. Recheck `git status`; once the single-writer boundary is clean, run `bun run corpus-check`, repair only owned
  findings, regenerate the corpus baseline once, and inspect the accepted-Open diff. (R4)
- [ ] 7. Run `bun run autofix`, `bun run spur-check`, `bun run test`, `bun run test-cf`, `bun run build`, final
  `spur task check 0726 --json`, and recheck the 0722 verdict hash. (R1-R4)

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Task 0722 and feature E6: `spur task show 0722 --json`; `spur feature check E6 --json`.
- Certified verdict authority: `.spur/run/0722-verdict.json`; capture its SHA-256 at implementation start and treat it
  as immutable for the 0726 diff.
- Importer provenance and import entry: `apps/cli/src/commands/history.ts`,
  `packages/app/src/services/history-service.ts`.
- Published importer observed 2026-08-31: npm `latest=0.4.48`; local lock/catalog 0.4.48. Upstream bash-retention fix:
  `gobing-ai/ts-libs` commit `96762d5` (not published at refinement time).
- Evidence precheck seams: `config/workflows/task-pipeline.yaml`, `plugins/sp/scripts/task-size-precheck.ts`,
  `plugins/sp/skills/spur-dev/references/gate-checklists.md`.
- Verify transport/parser: `packages/app/src/workflow/actions/agent-run.ts`,
  `plugins/sp/skills/code-verification/SKILL.md`, `packages/app/src/services/task-verdict.ts`.
- Baseline gate: `config/corpus-baseline.json`, `scripts/commands/regen-corpus-baseline.ts`.

### History
