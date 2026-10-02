---
schema_version: 1
name: Emit inline pipeline action rows so run close needs no post-hoc backfill
status: done
template: feature-impl
created_at: 2026-10-01T23:59:14.229Z
updated_at: "2026-10-02T06:12:02.188Z"
feature_id: E71

priority: P2
estimate_hours: 1
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/1046-verdict.json
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

- [x] R1. The YAML-interpreter section of
  `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (`:233-235` loop) states the
  per-action emission obligation inline (pointer to "Structured trace emission" with the exact
  `--action` shape), so a driver following only the loop section cannot reach close with zero rows.
- [x] R2. Repo and installed copies of the driver reference are resynced (superskill install path) —
  or, if sync is intentionally deferred, the drift is documented in the repo copy's header.
- [x] R3. The `NO_ACTION_ROWS` stdout JSON error text (`inline-run-setup.ts:1035`) appends a
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

The merged implementation uses the existing inline trace delegate and preserves strict close validation.

- R1 — `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:243` requires each settled action boundary before the next action, transition guard or close. The loop includes the exact `--action` payload and the measured `--actions-file` alternative; failed batches are neither retried nor backfilled at close.
- R2 — `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:15` documents the Superskill Codex command-spelling adaptation. The inspected installed reference at `~/.agents/skills/sp-spur-dev/references/inline-pipeline-driver.md` contains the same durable record paths and loop obligation. Superskill owns installation; a literal canary from the superseded branch wording is not required.
- R3 — `packages/app/src/services/inline-run-setup.ts:1119` points the zero-row JSON error to `--action/--actions-file during the run (no backfill)` and the structured-trace section anchor. The error code remains `NO_ACTION_ROWS`, exit remains 1, and the run retains the existing after-close semantics.
- Regression — `packages/app/tests/services/inline-run-driver.test.ts:340` pins the error code, zero action rows, in-run remediation and reference anchor. The owner-generated `plugins/sp/lib/inline-run.generated.mjs` carries the same implementation; `scripts/commands/bundle-plugin-lib.test.ts:187` checks deterministic bundle parity.

The independent task branch and its original prose were integrated in merge `5e0a0a3c`. Main retained the already-verified implementation and stronger storage safeguards. This section describes that merged code; the original branch receipts and rehearsal are retained as historical evidence.

### Testing

**Pipeline verify results**

- Verdict: PASS (existing recorded verdict; this correction does not mint a new proof)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:243` — action boundary precedes the next action, guard or close; exact payload and measured batch alternative appear in the loop. |
| R2 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:15` documents the Codex adapter spelling; the inspected installed reference has the same durable record paths and current loop obligation. |
| R3 | MET | `packages/app/src/services/inline-run-setup.ts:1119` and `packages/app/tests/services/inline-run-driver.test.ts:340` — explicit in-run remediation and section anchor, with unchanged failure code and exit. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | Retained rehearsal `ac1-rehearsal-1046-d973` is terminal done with 10 incrementally emitted action rows; its `.md` and `.state.json` records are retained under `.spur/memory/runs/`. The scratch task was removed after the rehearsal. |
| AC2 | MET | command | The repo header documents the installer namespace difference, satisfying the documented-drift alternative; installed and repo references contain the current loop obligation and durable record paths. |
| AC3 | MET | test | Main's focused inline-run-driver suite: 13 pass, 0 fail; deterministic plugin bundle suite: 16 pass, 0 fail. The current assertions check the actual in-run remediation and section anchor rather than superseded branch wording. |
| AC4 | MET | test | The zero-row close test pins exit 1, `code: NO_ACTION_ROWS` and `actionRows: 0`; the success case still closes after emission. |

The original task-pipeline verification run `8c94ccab-5a16-4106-9f65-baf74d940e1b` and source-tree evidence remain preserved. The subsequent cleanup checks are recorded in `.spur/memory/runs/worktree-cleanup-20261002/cleanup-result.json`. Historical receipts describe their own source tree; live source anchors above describe merged main.

### Review

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | Functional / SECUA / Architecture | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:243` | Reviewed the final scoped implementation and executable failure/disposal evidence; no unresolved blocker or major finding. | RESOLVED |

#### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:243`; exact command in loop; isolated CLI task/run rehearsal emits 7 measured rows before advancing |
| R2 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:15`; Superskill sync, with only documented Codex command-spelling conversion |
| R3 | MET | `packages/app/src/services/inline-run-setup.ts:1119`; `packages/app/tests/services/inline-run-driver.test.ts:342`; unchanged exit/code with actionable pointer |

#### SECUA and architecture

The change uses existing trace tooling and leaves strict close semantics intact. The isolated project-override rehearsal proves incremental emission and close, while the focused test covers NO_ACTION_ROWS. It does not claim the bundled model/certification pipeline ran. Superskill owns the installed adapter; its command-spelling difference is documented.

Security: confined paths, existing identity validation and secret redaction remain. Correctness: focused regression evidence covers the changed success/failure branches. Efficiency: bounded local storage traversal; no new background collector. Usability: visible outcomes and errors. Architecture: existing app/domain/plugin ownership and standalone bundle contract remain. No speculative refactor is required.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-02T00:08:30.476Z backlog → todo (system)
- 2026-10-02T00:16:52.094Z todo → wip (system)
- 2026-10-02T04:08:45.852Z wip → testing (system)
- 2026-10-02T04:08:45.855Z testing → done (system)

