---
schema_version: 1
name: Move the remaining canonical workflows to the run record
status: done
template: feature-impl
created_at: 2026-09-23T05:09:42.309Z
updated_at: "2026-09-24T05:23:15.434Z"
feature_id: E7
priority: P2
tags:
  - run-record
  - workflow-adoption
estimate_hours: 8

dependencies: ["0927"]
---

## 0928. Move the remaining canonical workflows to the run record

### Background

Covers the remaining E7 R4 caller set after the task-pipeline slice. Current idea, feature verification, lifecycle, wrapup, history, PR review, and wayfinder workflows reference `.spur/run`; many of those files are independent proof or transient workflow outputs. The final reader/writer inventory must be taken after D63. Depends on task-pipeline migration so the shared installed/plugin seam is stable. Rubric: E8 D1 L2 C2 R1 = 14; these workflow files are independent from the task-pipeline proof review but share one migration contract.

**Refine corrections (2026-09-22)**
- Original wording could imply every `.spur/run` reference should move → the current canonical YAML includes WBS-keyed verdicts, status gates, learning captures, and other non-record artifacts → require an ownership table and audited no-change dispositions before touching each workflow.

### Requirements

- [x] R1. Classify every remaining canonical workflow's `.spur/run` artifacts as run record, independent evidence, or transient output using the post-D63 source and installed catalog.
- [x] R2. Migrate run-record-owned readers/writers to the shared pair without changing each workflow's guard, human decision, retry, or external-effect behavior.
- [x] R3. Keep independent task/feature proof, history outputs, trace-file output, and project-owned overrides at their existing owners; never overwrite an override.
- [x] R4. Check source and installed resolution, interruption/replay, terminal status, and absence of undeclared run-record sidecars for every affected workflow.

### Acceptance Criteria

- [x] AC1 — Current callers survive the storage migration (req: R1)
  Given the post-D63 source and installed catalog for every remaining canonical workflow
  When each workflow's run-directory writers and readers are classified and record-owned sites are migrated
  Then independent proof and transient outputs retain their owners, every affected workflow uses the shared pair, and no undeclared run-record sidecar remains
  And source, installed, resumed, and project-override resolution preserve their guards, decisions, trace status, and external-effect identity
  Verify with an inventory table and focused workflow fixtures for each changed definition; do not count unrelated proof files as pair violations.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Dependency: 0927 establishes the installed/plugin pair seam; 0921 supplies the final D63 catalog. Take a fresh catalog inventory before editing. If an item is independent evidence or transient output, record that disposition and leave it in place.
- Inventory scope: inspect `idea-pipeline.yaml`, `feature-verification.yaml`, `feature-lifecycle.yaml`, `task-lifecycle.yaml`, `wrapup-pipeline.yaml`, `history-anatomy.yaml`, `pr-review.yaml`, and `wayfinder-resolution.yaml` plus any post-D63 canonical definition and directly corresponding plugin scripts. Classify each `.spur/run` producer and its last reader in a reviewable table; the inventory, not a blanket filename count, determines edits.
- Migration: use the 0925–0927 pair seam only for genuinely record-owned sites. Preserve each workflow's guard ordering, human decisions, retry policy, external-effect identity, trace status, and project override precedence. A workflow with no record-owned site needs no code edit; record its audited no-change outcome.
- Primary targets: affected `config/workflows/*.yaml`, their direct plugin scripts/tests, and owning workflow design/catalog docs. Keep task-pipeline, Board, independent proof, history products, and explicit trace-file output out of this slice. No new public CLI/API.
- Anti-patterns: no universal replacement workflow, no duplicate state store, no mass sidecar deletion, and no overwrite of project-owned definitions.

### Plan

1. Freeze the post-D63 resolved catalog and enumerate each remaining workflow's run-directory readers and writers.
2. Convert record-owned sites in small workflow groups, keeping independent evidence untouched.
3. Validate each affected workflow, run representative source/installed dry and resumed cases, and compare authoritative traces.
4. Remove only obsolete run-record sidecars and update the design/catalog disposition.

### Solution

R1/R3 — audited no-change classification across the remaining canonical workflows (idea-pipeline, feature-verification, feature-lifecycle, task-lifecycle, wrapup-pipeline, history-anatomy, pr-review, wayfinder-resolution): every `.spur/run` reference in `config/workflows/*.yaml` is a declared workflow artifact — run-scoped signals/answers/retry counters and batch/handoff data (`<runId>-<name>`, including the `-idea-*` driver artifacts: written by `idea-coverage-check.ts:80` / the decompose+ready states, read back by the same workflow's guards and `packages/app/src/workflow/idea-handoff.ts:71-78`), WBS/feature-keyed independent proof (`$wbs-verdict.json`, feature-verification receipts `packages/app/src/workflow/feature-verification-receipt.ts:127-130`), history-anatomy outputs plus its shared `history-anatomy-run.id` pointer, and `.spur/memory/*` route logs. None names the run record — the pair (`<runId>.md` + `<runId>.state.json`) is written for every workflow by the 0925 engine sink and 0927 inline seam, so R2's "every affected workflow uses the shared pair" already holds at the storage layer and R2/R4 require no YAML edit (no new public API needed; §1.2 verdict/gate state fields stay future work). Migrating the workflow-data artifacts would duplicate the state store (declared anti-pattern) and change guard/retry semantics.

Changes: (1) `plugins/sp/tests/run-record-catalog.test.ts` (new) — post-D63 catalog-wide fixture: sweeps every `config/workflows/*.yaml` (auto-covers post-D63 additions), strips run-id placeholder spellings (`${vars.__runId}`, `$__runId`, `<runId>`, `<RUNID>`, `<run-id>`) and asserts no reference resolves to an exact record name (`.md`/`.state.json`/`.log`), i.e. no legacy single-file run state and no undeclared run-record sidecar remains; spot-checks the idea-pipeline driver-artifact owners (mutation-checked: detects all record-name spellings, ignores declared workflow artifacts). (2) Deferred review handoffs fixed: `plugins/sp/skills/spur-cli/references/workflows.md` :207,:217-219,:288,:305,:313-317 (run record wording — `--no-log` and `--follow --output` now describe `.spur/run/<RUNID>.md` + `.state.json`, matching `apps/cli/src/commands/workflow.ts:533,1482`; legacy `.log` kept only as read-only fallback/reclamation scope :352-356) and `plugins/sp/skills/spur-dev/references/execution-workflow.md:141` (stream target → `.spur/run/<runId>.md`). (3) `docs/design/run-record-contract.md` — 0928 remaining-catalog baseline paragraph recording the audited no-change dispositions.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | test + manual-review — plugins/sp/tests/run-record-catalog.test.ts:63-76 (32 pass incl. post-D63 catalog presence asserting all 8 remaining workflows, per-file record-name sweep, idea-pipeline owner spot-checks :80-95); independent enumeration of every `.spur/run` ref in config/workflows/*.yaml: idea-pipeline.yaml:105,380,509, wrapup-pipeline.yaml:163,198, pr-review.yaml:74,92,126, wayfinder-resolution.yaml:66,85,143,150, feature-verification.yaml:74, history-anatomy.yaml:94,160-318, task-lifecycle.yaml:39 — all run-scoped `<runId>-<name>` / `<wbs>-verdict.json` / `history-anatomy-run.id` artifacts, zero exact record names |
| R2 | MET | test + static-ref — catalog sweep green (plugins/sp/tests/run-record-catalog.test.ts:63-76) + `git diff config/workflows/` empty (no definition edited, so guard/human-decision/retry/external-effect behavior identical by construction) + pair ownership sits outside workflows: packages/app/src/observability/workflow-run-log-sink.ts:92-93 (0925 engine sink) and plugins/sp/scripts/inline-run-setup.ts:189-190 (0927 inline seam) write `.spur/run/<runId>.md` + `.state.json` for every run |
| R3 | MET | manual-review + static-ref — no `config/workflows` diff and no `.spur/workflows` override dir in tree (nothing overwritten); independent proof retained: packages/app/src/workflow/feature-verification-receipt.ts:124-131 (run/feature-scoped receipts), config/workflows/wayfinder-resolution.yaml:143,150 (`<wbs>-verdict.json`), history-anatomy.yaml:94 (shared pointer); trace-file stays `.spur/workflow/` (apps/cli/src/commands/workflow.ts:532, docs table in plugins/sp/skills/spur-cli/references/workflows.md:218); doc edits are prose-only wording fixes (workflows.md:207,217-219,288,305,313-317,352-356; plugins/sp/skills/spur-dev/references/execution-workflow.md:141) matching CLI reality (workflow.ts:533,1482) |
| R4 | MET | test + command — focused run: run-record-catalog + inline-run-setup/trace/installed/pipeline-driver suites 32 pass / 0 fail (installed resolution via bundled Node twin, plugins/sp/tests/inline-run-installed.test.ts); skill-structure + parity 93 pass / 0 fail; `bunx tsc --noEmit` exit 0; mutation sweep independently re-run: 5/5 record-name spellings flagged (`.md`, `.state.json`, `<RUNID>.md`, `<run-id>.log`, `$__runid.LOG`), 7/7 declared artifacts ignored |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | catalog fixture covers every post-D63 definition (9 YAMLs incl. all 8 remaining, plugins/sp/tests/run-record-catalog.test.ts:48-76); independent proof/transient keep owners (feature-verification-receipt.ts:127-130, history-anatomy.yaml:94, wayfinder-resolution.yaml:143,150, `.spur/memory` route logs wrapup-pipeline.yaml:161); pair used by every workflow at the storage layer via sink+seam (workflow-run-log-sink.ts:92-93, inline-run-setup.ts:189-190); zero undeclared sidecars (sweep green, 10 files); source/installed/resumed/override resolution preserved — no definition edited (`git diff config/workflows/` empty), parity + installed-twin suites re-run green (32 pass), focused fixtures exist for the seam pair (inline-run-setup/trace/installed/driver) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:775ba44ec3d557a7728babf3f37b44c302d3b5ba62fa776510ccd088f9422783 |

### References

- [E7 feature](../features/E7_two-file-run-record-history-orpc-and-tool-using-source-migration.md) and [current run-record contract](../design/run-record-contract.md).
- Depends on [0927](0927_preserve-task-pipeline-proof-while-moving-its-run-state-to-t.md); D63 final catalog is owned by [0921](0921_complete-measured-workflow-migration-and-catalogue-reconcili.md).
- D63 is active in a separate worktree at refinement time. Recheck the merged canonical catalog, generated bundle, and project-override resolution before inventory or edits.

### History

- 2026-09-24T04:56:59.587Z todo → wip (system)
- 2026-09-24T05:23:13.422Z wip → testing (system)
- 2026-09-24T05:23:15.434Z testing → done (system)

