---
schema_version: 1
name: Run repo-wide tripwires on the wrap diff before the wrap commit
status: backlog
template: feature-impl
created_at: 2026-10-01T01:23:53.052Z
updated_at: "2026-10-01T01:43:56.993Z"
feature_id: A9

ac_altitude: task-local
---

## 1037. Run repo-wide tripwires on the wrap diff before the wrap commit

### Background

Repo-wide tripwires (`repo-wide-tests/`, run by `bun run test-repo-wide`, `package.json:85`) execute only inside `spur-check-feature`. In batch runall-A9-485e the wrapup `doc-sync` agent (sp:doc-evolve wrapup) rewrote ADR-130's committed Decision text in place. The operator then committed it as fdf0a62b4 (2026-09-30 16:49), and adr-supersession test (e) caught it only at the 17:15–17:21 merge re-gate. That forced a drop decision (merge 2b10712c9) and a re-gate.

Refinement 2026-09-30 corrected the original premise. Neither `config/workflows/wrapup-pipeline.yaml` nor `plugins/sp/scripts/wrapup-steps.ts` creates a "wrap commit". The wrap commit is made by the operator or batch driver after wrapup finishes. The title's "before the wrap commit" therefore means "before wrapup reaches a terminal success state". The edits are still uncommitted at that point.

The fail-early window matters because test (e) inspects only the *working diff* of `docs/00_ADR.md` (`repo-wide-tests/adr-supersession.test.ts:152-208`). Once a wrap edit is committed on a clean tree, (e) can no longer see it. Only a merge or conflict that resurfaces the diff can trip it. So the window inside wrapup is the only reliable one.

### Requirements

- [ ] R1. Post-doc-sync tripwire hop. `wrapup-pipeline.yaml` gains one state, `doc-tripwire`, entered after the doc-sync branch resolves: from `learnings-append` and from `repair`, both of which today go straight to `metrics-record`. It is not entered on the `task-resolve → metrics-record` path, which runs no doc-sync. The state runs the new var `docTripwireCmd` via `sh -c` and writes `PASS` or `FAIL` to `.spur/run/$__runId-wrapup-doc-tripwire.status`, following the `feature-verify` pattern. FAIL routes to `failed` with `terminalReason: failed-check`. PASS routes to `metrics-record`. The FAIL edge is declared first, and a missing status never routes as PASS.
- [ ] R2. Portable, trusted-config default. `docTripwireCmd` is a TRUSTED CONFIG ONLY var, with the same comment and security contract as `featureGateCmd`. Its default runs `bun run test-repo-wide` only when `package.json` declares a `test-repo-wide` script; otherwise it exits 0 (a no-op for other projects). Spur gets the tripwire with no caller change. Callers can override it with `--vars`, and an empty string disables the hop's check while still writing PASS.
- [ ] R3. Additive and cost-bounded. No existing state, edge or gate changes semantics: `featureGateCmd`/`feature-verify`, `spur-check-feature` and merge-time re-gates stay as they are. Reuse the existing `test-repo-wide` runner and write no new check logic. On a clean wrap the added cost is one `test-repo-wide` run.
- [ ] R4. Contract docs in the same change (T3). The wrapup state list and route description in `plugins/sp/skills/spur-dev/references/dev-operations.md` (wrap/wrapall) and `execution-batch.md` (Step 6 batch wrap) name the new hop and var. Rebuild the generated bundle `apps/cli/config/` with `build:bundle`.
- [ ] N1. Non-goals. The feature-transition pre-flight is 1033 R2 and diff-sized verify is 1033 R1. No commit step is added to wrapup, no ADR-124 gate-frequency change, no new tripwire tests or rules, and no change to the doc-sync agent prompt.

### Acceptance Criteria

- [ ] AC1 — An in-place historical ADR edit left by doc-sync fails wrapup at doc-tripwire (req: R1)
- [ ] AC2 — A clean doc-sync diff passes doc-tripwire and proceeds to metrics-record (req: R1, R3)
- [ ] AC3 — The repair path also passes through doc-tripwire; the no-doc-sync path does not (req: R1)
- [ ] AC4 — The default command is a no-op in a project without a test-repo-wide script and runs it in Spur (req: R2)
- [ ] AC5 — Wrap contract docs and the generated bundle name the new hop and var (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-01T01:43:36.328Z

- **Placement: state after doc-sync, not code in wrapup-steps.ts.** No wrap commit exists in wrapup. The edit's source is the `doc-sync` agent.run state. A guard on doc-sync itself cannot coexist with its `contract-violation` → `repair` edge, which needs the agent result. So the hop sits where the two doc-sync exits converge (`learnings-append`, `repair`), before `metrics-record` / `feature-transition` mutate metrics or feature state.
- **Var plus package-script probe, not a hardcoded Spur command.** Shipped workflows are portable, and `repo-wide-tests/` is Spur-specific. Projects cannot override workflow vars through config (`.spur/config.yaml` has no workflow-var surface). A script-presence probe gives Spur the check by default and is a no-op elsewhere.
- **Run the whole `test-repo-wide`, not a "tripwire subset".** The suite is one file today and has no subset selector. Add one only when the runtime measurably hurts wraps.
- **Dedup.** 1033 R2 (feature sync dry-run + done gate inside `wrapup-steps.ts resolve`) is a different check class and a different file. 1037 touches only the YAML, so they do not need to land together. 0872 put repo-wide checks in the feature pass; this task adds an earlier observation and moves nothing.

### Design

- **New var** (`config/workflows/wrapup-pipeline.yaml` vars block, :93-108, next to `featureGateCmd`):
  `docTripwireCmd: 'if jq -e ''.scripts["test-repo-wide"]'' package.json >/dev/null 2>&1; then bun run test-repo-wide; fi'`
  It carries the TRUSTED CONFIG ONLY comment. If the implementer finds a quoting-safe equivalent (for example `grep -q '"test-repo-wide"' package.json`), that is acceptable; the behavior in R2 is the contract.
- **New state `doc-tripwire`** (declare it next to `repair`/`metrics-record`, :294-316). Its onEnter has one shell action:
  `sh -c "$docTripwireCmd" && printf 'PASS\n' > ".spur/run/$__runId-wrapup-doc-tripwire.status" || printf 'FAIL\n' > ".spur/run/$__runId-wrapup-doc-tripwire.status"`
  The action always exits 0, so status truth lives in the file (the 0783 R4 pattern).
- **Edges.**
  - Retarget `learnings-append → metrics-record` (:548) and `repair → metrics-record` (:555) to `doc-tripwire`.
  - Add `doc-tripwire → failed` (guard: status = FAIL, `terminalReason: failed-check`), declared first.
  - Add `doc-tripwire → metrics-record` (guard: status = PASS).
  - Leave `task-resolve → metrics-record` (:465) untouched.
- **Invariants.**
  - Only a verified command writes PASS.
  - A missing status matches neither edge. Follow the engine's no-match behavior for existing status-file states, and confirm it ends at `failed`, not `done`.
  - Learnings and docs already on disk stay put on FAIL; the `failed` description already promises this.
- **Rejected alternatives.**
  - Logic in `wrapup-steps.ts`: it has no commit step, and its target is a different concern.
  - Folding the check into `featureGateCmd`: that would widen ADR-108 / D61's feature-scoped gate, and it runs only after feature-transition has already mutated state.
  - A doc-evolve prompt rule only: not deterministic.

### Plan

1. **Write the failing tests first** in `packages/app/tests/workflow/wrapup-pipeline.test.ts`, mirroring the 0770/0783 structural tests at :108-247:
   - `doc-tripwire` exists;
   - FAIL edge is declared before the PASS edge;
   - `learnings-append`/`repair` target it;
   - `task-resolve → metrics-record` is unchanged;
   - the `docTripwireCmd` default carries the script-presence probe and the trusted-config comment.
   Add a behavioral check that runs the default command in a temp dir without `test-repo-wide` (exit 0) and with a script that exits 1 (status FAIL).
2. **Edit `config/workflows/wrapup-pipeline.yaml`** (var, state, edges) per Design.
3. **Run `bun run --filter @gobing-ai/spur build:bundle`** to regenerate `apps/cli/config/`.
4. **Update docs (T3):**
   - `plugins/sp/skills/spur-dev/references/dev-operations.md` wrap/wrapall entries (around :363-396);
   - `plugins/sp/skills/spur-dev/references/execution-batch.md` Step 6 (:541-560): name the hop and var, and explain how to override or disable it.
5. **E2E repro (AC1), with an artifact:** in a scratch worktree, apply an in-place edit to a historical ADR line in `docs/00_ADR.md`, then run the default `docTripwireCmd` and capture the FAIL output naming test (e). Revert the edit and re-run to get PASS. Save the transcript to `.spur/run/1037-tripwire-repro.log`.
6. **Gates:** `bun run spur-check`, then `bun run spur-check-feature` once. These cover `inline-pipeline-parity-check`, `workflow-promotion-check` and `repo-wide-tests` against the changed YAML.

### Solution

Pending — written by implement. Expected touch set:
- `config/workflows/wrapup-pipeline.yaml:93-108`: add the `docTripwireCmd` var.
- `config/workflows/wrapup-pipeline.yaml:294-316`: add the `doc-tripwire` state.
- `config/workflows/wrapup-pipeline.yaml:548`: retarget the edge.
- `config/workflows/wrapup-pipeline.yaml:555`: retarget the edge.
- `apps/cli/config/` (generated by `build:bundle`).
- `packages/app/tests/workflow/wrapup-pipeline.test.ts:108`: structural and behavioral tests.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:541-560`: Step 6 batch wrap.
- `plugins/sp/skills/spur-dev/references/dev-operations.md:363-396`: wrap/wrapall.

`plugins/sp/scripts/wrapup-steps.ts` is NOT in scope.

### Testing

Pending — written by `spur task record` from the verify verdict.

### Review

Pending — written by the review coordinator (`/sp:dev-review`).

### References

- `config/workflows/wrapup-pipeline.yaml`:
  - vars :93-108 (`featureGateCmd` trusted-config precedent);
  - `doc-sync` :210;
  - `repair` :294;
  - `metrics-record` :316;
  - `feature-verify` :374 (status-file pattern);
  - edges :465, :548, :555.
- `package.json:85` (`test-repo-wide`) and `package.json:84` (`spur-check-feature`).
- `repo-wide-tests/adr-supersession.test.ts:152-208`: test (e), the working-diff freeze; `amended` list at :168.
- `packages/app/tests/workflow/wrapup-pipeline.test.ts:108-247`: structural test precedent.
- Evidence:
  - batch runall-A9-485e: wrap commit fdf0a62b4 carried the doc-sync ADR-130 in-place edit;
  - merge 2b10712c9 dropped it, with `spur-check-feature` PASS on the resolved tree.
- Related:
  - 1033 R1/R2 (distinct check class, distinct file: `wrapup-steps.ts`);
  - 0872 (repo-wide checks are feature-scoped; unchanged);
  - 0915 (`feature-verify` hop pattern);
  - 1035 (ADR-130 amendment).

### History
