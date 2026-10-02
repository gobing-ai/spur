---
schema_version: 1
name: Emit inline pipeline action rows so run close needs no post-hoc backfill
status: todo
template: feature-impl
created_at: 2026-10-01T23:59:14.229Z
updated_at: "2026-10-02T00:14:51.504Z"
feature_id: E71

priority: P2
estimate_hours: 1
---

## 1046. Emit inline pipeline action rows so run close needs no post-hoc backfill

### Background

Filed from session review of task 1043 (run 201a166a): the inline driver executed all stages with
zero `action_runs` rows; `--close --status done` refused with `NO_ACTION_ROWS` and the run closed
only after a 27-row post-hoc `--actions-file` backfill with approximate durations.

**Refine corrections (2026-10-01):** (1) Premise corrected — per-stage emission tooling already
exists (ADR-117 / 1007 R5: `--action` single row, `--actions-file` batch, best-effort;
`plugins/sp/scripts/inline-run-setup.ts:22-23`); this task builds no tooling. (2) Root cause
sharpened — the driver reference's YAML-interpreter section (the loop a driver executes from,
`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:233-235`) states no emission
obligation; the contract lives in a later section ("Structured trace emission", `:490-602`) that a
loop-following driver never reaches — reproduced by run 201a166a. (3) Repo path corrected:
source of truth is `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (not
`plugins/sp/skills/sp-spur-dev/...`); installed copy at
`~/.agents/skills/sp-spur-dev/references/inline-pipeline-driver.md` DIFFERS from repo (drift,
verified by diff 2026-10-01). (4) `NO_ACTION_ROWS` stdout (`inline-run-setup.ts:1035`) carries no
remediation pointer; note the guard fires after `closeRun` already ran — the run is terminal-done
with exit 1 by design (0975 R2, must not be relaxed).

### Requirements

- [ ] R1. The YAML-interpreter section of
  `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (`:233-235` loop) states the
  per-action emission obligation inline (pointer to "Structured trace emission" with the exact
  `--action` shape), so a driver following only the loop section cannot reach close with zero rows.
- [ ] R2. Repo and installed copies of the driver reference are resynced (superskill install path) —
  or, if sync is intentionally deferred, the drift is documented in the repo copy's header.
- [ ] R3. The `NO_ACTION_ROWS` stdout JSON error text (`inline-run-setup.ts:1035`) appends a
  remediation pointer (emit via `--action`/`--actions-file` during the run, see the driver
  reference); exit code, `code`, and fail-closed semantics are unchanged.

### Acceptance Criteria

- AC1. Rehearsal: driving a throwaway scratch task through task-pipeline stages with a scratch
  RUN_ID, following ONLY the interpreter section (with its embedded emission obligation), closes
  with `ok:true`, `actionRows > 0`, and no post-hoc backfill file; scratch run/task cleaned up.
  (test/inspection)
- AC2. `diff -q plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md
  ~/.agents/skills/sp-spur-dev/references/inline-pipeline-driver.md` is empty after resync, or the
  documented drift note exists in the repo copy. (inspection)
- AC3. A zero-row done close prints the remediation pointer in its JSON `error`; the focused
  packages/app trace test asserts the pointer; `bun run --filter @gobing-ai/spur build:bundle` run
  so the plugin twin matches (anchor `bundle-plugin-lib.test.ts:202` green). (test)
- AC4. Close validation unchanged: zero-row done close still exits 1 with `code: NO_ACTION_ROWS`.
  (test)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Docs-first, one-line code change. R1/R2 are reference edits in the repo source
(`plugins/sp/skills/spur-dev/...`); sync installed copy via superskill (never hand-edit the
installed file). R3 is an error-string append in `packages/app/src/services/inline-run-setup.ts`
(close path, `:1030-1037`) — after any source change run
`bun run --filter @gobing-ai/spur build:bundle` (twin anchor `bundle-plugin-lib.test.ts:202`,
1043 lesson). Extend the existing trace/close test for AC3/AC4; E2E rehearsal (AC1) uses a
scratch RUN_ID + throwaway task in the same repo, removed afterwards. No new flags, no new
scripts; `--close` stays strict (rejected alternative: tolerating zero-row closes — hides
non-execution, 0975 R2).

### Plan

1. Put per-action emission and its exact --action payload into the YAML interpreter loop; link the detailed trace contract.
2. Add a remediation pointer to NO_ACTION_ROWS while retaining its code/exit behavior.
3. Rehearse incremental emission in an isolated real task/run fixture; extend existing close assertions and regenerate the plugin twin.
4. Sync the installed driver reference through Superskill, run focused and repository gates, then verify/record/complete through the CLI.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-02T00:08:30.476Z backlog → todo (system)

