---
schema_version: 1
name: Reconcile post-G11 feature corpus projections and record legacy review
status: done
template: meta
created_at: 2026-10-21T18:33:43.463Z
updated_at: "2026-10-21T18:55:44.985Z"
priority: P2

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1270-verdict.json
---

## 1270. Reconcile post-G11 feature corpus projections and record legacy review

### Background

Robin requested a comprehensive review of every docs/features record after G11, confirmation before deprecating any feature/task, then a comprehensive source review with fixes. Audit baseline: 195 feature records and 1267 tasks across five configured folders; 141 feature checks pass and 54 fail, chiefly historical evidence debt. Preserve existing authority, AC titles, and execution history.

### Requirements

- [x] R1. Record coverage and evidence-backed dispositions for all 195 features and linked task consequences in a durable report.
- [x] R2. Repair the sixteen proven stale generated feature task rosters and nine broken task links through the Spur CLI.
- [x] R3. Annotate obsolete planning/current-scope statements with verified successor ownership without rewriting historical acceptance identities.
- [x] R4. Apply feature and task deprecations only after Robin explicitly confirms the exact candidate set; preserve pending proposals otherwise.

### Acceptance Criteria

- [x] AC1 — Every feature has a recorded review disposition and unresolved historical evidence remains explicitly reported (req: R1).
- [x] AC2 — Generated rosters agree with canonical and legacy task feature edges and the nine task links resolve (req: R2).
- [x] AC3 — Current-reading annotations cite successor ownership while historical AC identities remain intact (req: R3).
- [x] AC4 — No feature or task is deprecated without an explicit confirmation record for that candidate (req: R4).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Use source-local spur feature/task operations as the only corpus writers. The report is a docs/reports working record under constitution 4.2. Feature check failures from missing historical evidence are recorded, never waived or fabricated. The isolated audit worktree excludes unrelated scheduler edits. mutationPolicy: code (documentation scope only); no workflow edits.

### Plan

- [x] Freeze source-local feature and all-folder task snapshots and semantic coverage.
- [x] Save report with candidate/task evidence and baseline check/sync results.
- [x] Repair generated projections and broken links through CLI operations.
- [x] Add minimal current-reading annotations to identified stale records.
- [x] Preserve all lifecycle states while explicit deprecation confirmation is pending; run affected-input checks and retain their findings.
- [x] Verify report coverage, links, unchanged AC identities and intentional diff; the task close and commit follow verification.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

| Surface | Change and rationale |
| --- | --- |
| `docs/reports/2026-10-21-feature-legacy-audit.md:1` | Retains all 195 feature dispositions, linked-task consequences, baseline findings and explicit pending deprecation candidates. |
| `docs/features/G1_inbox-ipc.md:72` | Current-reading annotations distinguish live capability from retired carriers and planning snapshots across affected records; original acceptance identities and historical notes are preserved. |
| `docs/features/F82_feature-status-feedback-loop-derivation-sync-refresh-command-board-status-ux.md:73` | Corrected nine relative task links through the CLI. |
| `docs/features/F43_task-level-deprecated-status-frozen-but-retained-task-lifecycle-state-with-guarded-consumers.md:90` | Refreshed sixteen generated task rosters from the canonical plus legacy feature edges. |

Verification: `bun /tmp/spur-g11-verify-docs.mjs` returned 195 covered, 79 modified feature records, 79 unchanged Acceptance Criteria sections, 16 exact rosters, 9 existing repaired links, and zero lifecycle changes. Source-local affected feature checks retain the existing historical proof findings; no receipt is fabricated. Deprecation of M4/G5/F61 and their exact task sets remains pending explicit operator confirmation. Separate source fixes belong to task 1271.

Coverage: N/A (documentation-only change; no runtime code path added).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The durable report records all 195 feature dispositions and 1267 task metadata records, baseline CLI checks and deprecation/task consequences: `docs/reports/2026-10-21-feature-legacy-audit.md:12`. |
| R2 | MET | Documentation integrity assertion probe passed 16 exact roster comparisons and nine existing repaired task links; example retained links at `docs/features/F82_feature-status-feedback-loop-derivation-sync-refresh-command-board-status-ux.md:80`. |
| R3 | MET | Documentation integrity assertion probe confirmed all 79 edited Acceptance Criteria sections identical to HEAD; current-reading annotations preserve the original acceptance text. |
| R4 | MET | Documentation integrity assertion probe confirmed zero feature lifecycle changes; no task was deprecated, and explicit candidate confirmation is pending at `docs/reports/2026-10-21-feature-legacy-audit.md:22`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | Documentation integrity assertion probe: 195 feature IDs present in the report; source-local full feature check returned 141 PASS and 54 FAIL, explicitly retained in the report. |
| AC2 | MET | command | Documentation integrity assertion probe: 16 generated rosters exactly match alias-aware task edges; all nine corrected task links exist. |
| AC3 | MET | command | Documentation integrity assertion probe: 79 modified feature records, 79 unchanged acceptance sections; annotations point to the replacement owners. |
| AC4 | MET | command | Documentation integrity assertion probe: zero feature lifecycle transitions; git diff confirms no old task status changed and the exact deprecation candidate set remains pending. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1270

Scope: all 195 feature records and 1,267 task metadata records; 79 feature records edited plus the durable audit report. Functional, security, efficiency, correctness, usability and architecture reviewed. Original acceptance sections and all lifecycle states are preserved.

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | correctness | Historical proof gaps remain explicitly recorded; 79 affected checks yield 55 exit 0 and 24 exit 1 in the isolated checkout, where gitignored historical verdict artifacts are unavailable. They are not waived or misrepresented as implementation PASS. | `docs/reports/2026-10-21-feature-legacy-audit.md:30` | ACCEPTED |
| 2 | P4 (advisory) | usability | M4/G5/F61 deprecation and linked task changes remain proposals awaiting the requested operator confirmation; M5 live role-resolution capability is retained. | `docs/reports/2026-10-21-feature-legacy-audit.md:14` | ACCEPTED |
| 3 | P4 (advisory) | correctness | Source follow-up reproduced an O ambiguity residual beyond its already delivered single-action retry grouping; task 1272 owns that repair. The feature Notes correct the document-only closure inference, and the source audit will carry the follow-up. | `docs/features/O_observability-run-detail-refinements.md:52` | ACCEPTED |

Verification: full task gate passed lint/typecheck, 11,526 tests across 740 files and post-check rules. Documentation integrity probe passed all 195 coverage rows, 79 unchanged acceptance sections, 16 exact generated rosters, nine existing repaired links, zero lifecycle changes. CLI-only corpus diffs reviewed; no runtime/source changes belong to this task.

Confidence: MEDIUM
Verdict: PASS

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History

- 2026-10-21T18:41:29.459Z todo → wip (system)
- 2026-10-21T18:49:42.272Z wip → testing (system)
- 2026-10-21T18:55:31.153Z testing → done (system)

- 2026-10-21 — Full task gate passed twice (11,526 tests, zero failures each), the second after audit wording was clarified. Pipeline review initially required exact ACCEPTED disposition tokens; corrected without code changes. Its final close classified quoted historical placeholder wording as an unfinished diff marker and retained a failed run. Corrected the report wording, reran the full gate, then completed standalone verdict/record/residual verification through the normal guarded testing → done transition. Final verdict PASS; residual blocking=0; no force/provenance override and no feature/task deprecation applied.

