---
schema_version: 1
name: Close the inline-run bookkeeping gaps and enforce the test-only subpath invariant
status: todo
template: issue
created_at: 2026-09-26T16:02:38.308Z
updated_at: "2026-09-26T16:02:40.403Z"

---

## 0975. Close the inline-run bookkeeping gaps and enforce the test-only subpath invariant

### Background

All four findings were surfaced by the 0961 worktree run (`dev-run 0961 --auto --next --agent inline --worktree`), which completed successfully but exposed bookkeeping gaps around it. Each is evidenced below.

**F1 — Inline `--worktree` run provenance is destroyed by the success path.** The authoritative run row (and any `action_runs` rows) is persisted through `inline-run-setup.ts` into the **worktree's** `<worktree>/.spur/spur.db`, which is gitignored and therefore dies with `git worktree remove`. The two-file run record (`.spur/run/<run-id>.md` + `.state.json`) is likewise written under the worktree's `.spur/run/`. After the 0961 FF-merge and teardown:

- `bun apps/cli/src/index.ts workflow progress inline-20260926T050316Z-9a4ab2d5 --json` → `Run inline-20260926T050316Z-9a4ab2d5 not found.`
- `.spur/run/inline-20260926T050316Z-9a4ab2d5.md` → absent (only the five artifacts copied out by hand survived, plus the WT-3 marker)

So a successful `--worktree` run is exactly the case that loses its own audit trail; a *failed* run retains the tree and keeps it. Tension with WT-3, which deliberately places the marker in the invoking tree so resume works.

**F2 — No `action_runs` rows were emitted for any executed action.** `inline-pipeline-driver.md` §"Every executed action" requires the driver to append a provenance line and then record the boundary via `inline-run-setup.ts --action --node <state> --kind <kind> --status <done|failed> --ok <bool> --duration-ms <n>`. Across the 0961 run (precheck, implement, test, review, verify, record, done) **not one** `--action` call was made, so `ActionRunDao` has no rows for this run. F1 would have destroyed them anyway; the two compound.

**F3 — Proof capture ordering vs completion-box ticking forces a re-capture on a normal pass.** `test` captures `proofDigest` over the task's proof-input sections, which include `Requirements` / `Acceptance Criteria` / `Plan` — the sections that hold `- [ ]` completion boxes. Ticking a box mutates that section, so the digest drifts. `residual-scan.ts` classes `unchecked-box` as **always blocking and never deferrable** (`:288` blocking, `:276` explicitly excludes unchecked boxes from P4 deferral), so unticked boxes fail `verify` outright. In the 0961 run the boxes were still unticked when the digest was first captured, which forced: capture → tick → digest drift → re-capture → gate re-run → `verify` fold PARTIAL → `test-recheck` → re-verify. Two re-captures were needed on an otherwise clean task. The ordering is not asserted anywhere, so nothing catches it until `verify`.

**F4 — The `src/testing/` import invariant is unenforced.** 0961 established the invariant the design relies on: *nothing under `packages/app/src/` outside `src/testing/` may import `src/testing/`; the Worker entry never imports the `./testing` subpath.* It is asserted only ad hoc by an `rg` probe in the task's AC. `rg -ln "src/testing" config/rules/` returns nothing, so a future non-test import of a test double would not fail CI and would silently re-introduce the production→test coupling 0961 removed.

### Requirements

- [ ] R1. A `--worktree` inline run's provenance survives the successful teardown of the worktree: after `git worktree remove`, the run row is queryable from the invoking tree and the run record (`.md` + `.state.json`) is present in the invoking tree's `.spur/run/`.
- [ ] R2. Every executed `agent.run`/`shell`/`note`/`doctor.probe` action on the inline path records an `action_runs` row through the existing `--action` writer, so `spur workflow progress <run-id>` reports per-action rows for the run (not just the terminal row).
- [ ] R3. On a normal (no-remediation) pass the proof digest is captured **after** the task's completion boxes are in their final state, so ticking them cannot induce digest drift; a stray unchecked box still fails `verify` rather than being silently deferred.
- [ ] R4. The test-only subpath invariant is machine-enforced by a rule in `config/rules/`: a `src/**` module outside `src/testing/` that imports `src/testing/` fails `spur rule run`, and the check is smoke-tested in both directions (a compliant tree passes; a synthetic violating import fails).

### Acceptance Criteria

- [ ] AC1 — R1 — Worktree teardown preserves run provenance (req: R1)
- [ ] AC2 — R2 — Action rows are emitted for executed actions (req: R2)
- [ ] AC3 — R3 — Capture ordering cannot drift on a normal pass (req: R3)
- [ ] AC4 — R4 — The invariant is rule-enforced (req: R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**R1 — pick one owner for the run row.** Cheapest is to stop creating the row inside the worktree: resolve the project DB from the invoking tree (the driver already knows `spurBin` and the pre-isolation cwd) so `inline-run-setup.ts` writes the run row and the run record where they will still exist after teardown. The alternative — snapshot the run's DB rows back to the invoking tree before `worktree remove`, in the WT-4a evidence-persistence step — is more code and keeps a second copy alive. Prefer the first unless the worktree is required to own its DB.

**R2 — emit at the action boundary.** The driver already measures each action's wall clock for the provenance line, so `--action` is a direct call at the same boundary; `duration_ms` is already in hand. Keep it best-effort per the existing contract (a persistence failure must never wedge the run).

**R3 — order the capture after the tick.** Either (a) have the `implement` state's `onEnter` tick the requirement/AC/plan boxes it satisfied before `test` captures the digest, or (b) assert at `precheck`/`test` entry that the task has zero unchecked boxes and fail closed with a named reason. (b) is the smaller change and makes the failure legible; (a) is what the residue scanner implicitly assumes. Sequencing matters more than which: the invariant to state is *capture last*.

**R4 — a rule, not a probe.** `config/rules/` already carries structure rules (`structure/test-location.yaml` is the precedent, and it is what forced 0961's test rename). Add the sibling constraint there and smoke-test both directions per `sp:rule-add`; a rule that only ever passes is not a gate.

**Rejected.** Folding F1/F2 into a doc note only, or asserting F3 from prose in `inline-pipeline-driver.md`: each leaves the behavior unenforced, which is what produced all four findings.

### Plan

- [ ] Reproduce F1: run one `--worktree` task to completion, tear down, and confirm `spur workflow progress <run-id>` fails on the invoking tree.
- [ ] Implement R1 (prefer invoking-tree DB/record ownership); re-run the reproduction and confirm the row resolves after teardown.
- [ ] Implement R2 (`--action` at each action boundary); confirm per-action rows appear for a run.
- [ ] Implement R3 (capture-last ordering or a fail-closed precheck); confirm a normal pass needs exactly one capture and an unticked box fails loudly.
- [ ] Implement R4 as a `config/rules/` constraint with both-direction smoke tests.
- [ ] Gates: `bun run gate`; targeted tests for `inline-run-setup` / `residual-scan` / the new rule.
- [ ] One commit: `fix(sp): keep inline --worktree run provenance, emit action rows, order the proof capture, enforce the test-only subpath (WBS)`.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
