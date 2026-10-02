---
schema_version: 1
name: Emit inline pipeline action rows so run close needs no post-hoc backfill
status: done
template: feature-impl
created_at: 2026-10-01T23:59:14.229Z
updated_at: "2026-10-02T04:41:12.073Z"
feature_id: E71

priority: P2
estimate_hours: 1
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-run-1046-5da7/.spur/memory/evidence/1046-verdict.json
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

- R1. The YAML-interpreter section of
  `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (`:233-235` loop) states the
  per-action emission obligation inline (pointer to "Structured trace emission" with the exact
  `--action` shape), so a driver following only the loop section cannot reach close with zero rows.
- R2. Repo and installed copies of the driver reference are resynced (superskill install path) —
  or, if sync is intentionally deferred, the drift is documented in the repo copy's header.
- R3. The `NO_ACTION_ROWS` stdout JSON error text (`inline-run-setup.ts:1035`) appends a
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

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Change map (4 files, docs-first per task Design):

- R1 — `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (YAML-interpreter section, after the loop paragraph): new block "Trace emission is part of this loop, not an optional extra (task 1046)" stating the per-action emission obligation inline with the exact `--action` shape (`--run-id/--node/--kind/--status/--ok/--duration-ms`), the `--actions-file` batch alternative, the fail-closed rationale (zero-row done close refused, `NO_ACTION_ROWS`, 0975 R2, reproduced by run 201a166a), and a pointer to the "Structured trace emission" contract (ADR-117). A loop-following driver now cannot reach close with zero rows without contradicting the section it executes from.
- R2 — same file, header note "Installed-copy note (task 1046 R2)": the superskill install rewrites `/sp:*` to each target namespace (e.g. `/sp-dev-*`), so byte-`diff` against an installed copy is non-empty by design; the sync canary is grep `"Trace emission is part of this loop"` in the installed copy. The installed copy (`~/.agents/skills/sp-spur-dev/references/...`) was resynced through the sanctioned path (`superskill install sp --marketplace <staged worktree marketplace>`, 9 targets) and carries the canary; residual byte-diff is installer namespace adaptation only.
- R3 — `packages/app/src/services/inline-run-setup.ts:1030-1042` (close path): the zero-row `error` string now appends the in-run remediation pointer (`--action` / `--actions-file` + driver-reference section name); `code: 'NO_ACTION_ROWS'`, exit 1, fail-closed after-close semantics (0975 R2) unchanged.
- AC3 twin — `plugins/sp/lib/inline-run.generated.mjs` regenerated via `bun run --filter @gobing-ai/spur build:bundle` so the plugin twin carries the same R3 string (1043 lesson; `bundle-plugin-lib` anchor green).
- Tests — `packages/app/tests/services/inline-run-driver.test.ts:344-356`: the zero-row close case now also asserts the pointer fragments (`--action`, `--actions-file`, `Structured trace emission`) while the pre-existing assertions pin exit 1 + `code: 'NO_ACTION_ROWS'` (AC4) and the one-row close pins `ok:true` (AC1's service-level counterpart).

Rationale: the defect was contract placement, not missing tooling (refine correction 1) — the loop section a driver actually follows was silent about emission, so the fix is the obligation at the point of execution plus a remediation pointer at the failure site. No new flags, scripts, or relaxed close validation.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | static-ref: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:245-259` — interpreter-section block with exact `--action` shape, `--actions-file` batch, fail-closed rationale (0975 R2, run 201a166a), pointer to "Structured trace emission" (ADR-117) |
| R2 | MET | static-ref: installed copy `~/.agents/skills/sp-spur-dev/references/inline-pipeline-driver.md` (external evidence, outside this repo) carries the sync canary in its interpreter section after `superskill install sp` (9 targets); by-design byte-diff documented in the repo copy header note |
| R3 | MET | test: `packages/app/src/services/inline-run-setup.ts:1032-1040` — error appends remediation pointer; exit 1 + `code: 'NO_ACTION_ROWS'` unchanged (pinned by still-green test assertions) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | rehearsal run `ac1-rehearsal-1046-d973` driven per interpreter section — 10 action rows emitted, `--close --status done` printed `{"ok":true,"actionRows":10}` exit 0; no post-hoc backfill file existed; scratch task file/folder removed |
| AC2 | MET | command | canary grep hit in the installed copy; residual byte-diff is installer `/sp:` → `/sp-` namespace adaptation, documented in the repo copy header (R2's documented-drift alternative) |
| AC3 | MET | test | `packages/app/tests/services/inline-run-driver.test.ts:344-356` asserts `--action`, `--actions-file`, `Structured trace emission` in the zero-row error; focused suite 12/12; twin rebuilt via `build:bundle`, anchor `bundle-plugin-lib` 16/16 |
| AC4 | MET | test | pre-existing assertions pin exit 1 + `code: 'NO_ACTION_ROWS'` on the same case (test file unchanged in that region); source diff shows exit code and code field untouched |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | Functional / SECUA / Architecture | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:245` | Reviewed the final scoped implementation and executable AC evidence; no unresolved blocker or major finding. | RESOLVED |
| P4 | SECUA | `packages/app/src/services/inline-run-setup.ts:1034` | Error phrasing says `--actions-file` covers "the whole state", but the batch shape accepts any subset; harmless imprecision. | ACCEPTED (cosmetic) |
| P4 | Functional | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:258` | Anchor link uses a GitHub-style slug; terminal readers rely on the quoted section name, which is present. | ACCEPTED (cosmetic) |
| P4 | Architecture | (worktree DB) | AC1 rehearsal scratch run row persists in the disposable worktree DB until WT-4 removal; `.spur/run/` is gitignored so nothing reaches main. | ACCEPTED (by design) |

#### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | interpreter-section block "Trace emission is part of this loop, not an optional extra (task 1046)" with exact `--action` shape, `--actions-file` batch, fail-closed rationale (0975 R2, run 201a166a), pointer to "Structured trace emission" (ADR-117) |
| R2 | MET | installed copy resynced via `superskill install sp --marketplace <staged worktree marketplace>` (9 targets); canary present in the installed copy's interpreter section; by-design byte-diff (installer namespace adaptation) documented in the repo copy header note |
| R3 | MET | `packages/app/src/services/inline-run-setup.ts:1030-1042` error appends the remediation pointer; exit 1, `code: 'NO_ACTION_ROWS'`, after-close fail-closed semantics unchanged (AC4 pinned by pre-existing assertions, still green) |
| AC1 | MET | rehearsal run `ac1-rehearsal-1046-d973`: 10 `--action` emissions across stages, `--close --status done` → `{"ok":true,"actionRows":10}` exit 0, no post-hoc backfill file; scratch task file/folder removed |
| AC2 | MET | installed copy carries the sync canary; byte-diff explained + documented in repo header (R2 alternative) |
| AC3 | MET | `packages/app/tests/services/inline-run-driver.test.ts:344-356` asserts the pointer fragments; twin `plugins/sp/lib/inline-run.generated.mjs` rebuilt (`build:bundle`); `bundle-plugin-lib` anchor test 16/16 |

#### SECUA and architecture

The fix is contract placement, not new tooling: the obligation now lives in the section a loop-following driver executes from, and the failure site names the remediation. No validation was weakened — the zero-row close still fails closed with the same code and exit; the pointer is additive text. The test extends the existing zero-row case in place (no new fixtures, no assertion weakening). Docs/twin parity is maintained through the sanctioned `build:bundle` regeneration; plugin standalone contract unaffected (generated twin only). No speculative abstraction; no cross-boundary change.

Proof: fp=sha256:d8b2dbf9ee036f5116252358e08a7a736d741366d1ec580dca3d4223f6d8cec1 gate=PASS (attempt 1, bun run spur-check) run=8c94ccab-5a16-4106-9f65-baf74d940e1b review=PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-02T00:08:30.476Z backlog → todo (system)
- 2026-10-02T04:24:43.053Z todo → wip (system)
- 2026-10-02T04:25:47.369Z wip → testing (system)
- 2026-10-02T04:41:12.069Z testing → done (system)

