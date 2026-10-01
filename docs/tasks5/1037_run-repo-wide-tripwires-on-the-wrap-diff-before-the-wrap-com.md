---
schema_version: 1
name: Run repo-wide tripwires on the wrap diff before the wrap commit
status: backlog
template: feature-impl
created_at: 2026-10-01T01:23:53.052Z
updated_at: "2026-10-01T01:24:14.926Z"
feature_id: A9

---

## 1037. Run repo-wide tripwires on the wrap diff before the wrap commit

### Background

Captured from the creation title: "Run repo-wide tripwires on the wrap diff before the wrap commit".

### Requirements

- [ ] R1. Wrap pre-commit tripwire pass. When the wrap step has assembled its edits (learnings, doc-sync, metrics, feature files) and before it creates the wrap commit, the pipeline runs the repo tripwire suite — `bun run test-repo-wide` or its tripwire subset — against the current working tree, which holds the staged wrap edits. Any failing tripwire FAILs the wrap step with reason `failed:wrap-tripwire <test-codes>` routed through the existing wrap FAIL edge; the message names the failing test and the offending file(s).
- [ ] R2. Additive timing only. Post-commit and merge-time behavior is unchanged; tripwires keep running in `spur-check-feature`. The pre-flight never relaxes or replaces a later gate; on PASS the wrap commit proceeds exactly as today.
- [ ] R3. Cost bound. The pre-flight reuses the existing repo-wide runner (no new check implementation); on a clean wrap it adds only the tripwire subset's runtime to the wrap step.
- [ ] N1. Non-goals (non-duplication): feature-transition pre-flight (feature sync dry-run + done gate) is 1033 R2; diff-sized verify dispatch is 1033 R1; no ADR-124 gate-frequency changes; no new tripwire rules.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Defect: repo tripwires (e.g. adr-supersession in repo-wide-tests/) are executed only by `spur-check-feature` via `test-repo-wide` (package.json:84), which runs after the wrap commit has landed. Task-local gates (spur-check) never run repo-wide tests. In batch runall-A9-485e the wrap commit fdf0a62b4 carried an in-place ADR edit that adr-supersession rejects; the violation surfaced only at the 17:15-17:21 merge re-gate, forcing a drop decision plus re-gate — fail-late where fail-at-wrap was possible.

Chosen design: run the existing tripwire suite inside the wrap step, after edit assembly and before `git commit`. At that moment the edits sit uncommitted in the working tree — exactly the state the tripwires inspect. FAIL routes through the wrap step's existing FAIL edge.

Non-duplication boundary: 1033 R2 pre-flights feature-transition state (feature sync dry-run, done gate) — a different check class (corpus state vs repo-wide content rules). This task adds the content-rule pass on the same wrap step; both touch plugins/sp/scripts/wrapup-steps.ts, so sequence with 1033 or land as one coordinated change.

### Plan

1. Locate the wrap commit assembly in plugins/sp/scripts/wrapup-steps.ts and the driver's wrap-state wiring.
2. Insert the pre-commit tripwire invocation (reuse `bun run test-repo-wide`); map failures to `failed:wrap-tripwire <codes>` on the existing FAIL edge.
3. Update the wrap contract text (execution-batch.md / inline-pipeline-driver.md) in the same commit (T3).
4. Gates: bun run spur-check, then bun run spur-check-feature once.

### Solution

- plugins/sp/scripts/wrapup-steps.ts: add the tripwire pass after edit assembly, before commit; same $spurBin/env conventions as the rest of resolve.
- Tripwire suite: repo-wide-tests/adr-supersession.test.ts:55 and siblings under repo-wide-tests/; runner definition package.json:84 (`test-repo-wide`).
- No new check logic and no rule changes; failures pass through the repo-wide test output with codes extracted for the FAIL reason.
- Coordinate with 1033 R2 (same file, its `resolve` pre-flight): land after 1033 or as one combined change to avoid conflicting edits.

### Testing

- Integration repro: a wrap diff editing a historical ADR line in place makes the wrap step FAIL at wrap time with `failed:wrap-tripwire` naming adr-supersession (replays the runall-A9-485e incident); a clean wrap diff proceeds with added latency <= the tripwire subset runtime.
- Commit the repro as a repeatable test/script per ADR-130 placement (repo-wide-tests/ or tests/).
- Gates: bun run spur-check, then bun run spur-check-feature once.

### Review

- Re-read 1033 before implementing; confirm the check classes stay disjoint (feature-transition pre-flight vs repo-wide content tripwires).
- Confirm the tripwire pass runs pre-commit (uncommitted working state), never post-commit.
- Confirm FAIL reason codes name the test + offending files and route to the existing FAIL edge.
- Confirm T3 doc sync for the wrap contract in the same commit.

### References

- plugins/sp/scripts/wrapup-steps.ts; package.json:84; repo-wide-tests/adr-supersession.test.ts:55; plugins/sp/skills/spur-dev/references/execution-batch.md (wrap contract)
- Evidence: batch runall-A9-485e — wrap commit fdf0a62b4 (2026-09-30 16:49) carried an ADR edit rejected by adr-supersession only at the merge re-gate (17:15-17:21); drop decision + re-gate cost.
- Related: 1033 (R1 diff-sized verify, R2 feature-transition pre-flight — distinct classes, same file), 1035 (ADR-130 amendment, landed via 2dc9841ed).

### History
