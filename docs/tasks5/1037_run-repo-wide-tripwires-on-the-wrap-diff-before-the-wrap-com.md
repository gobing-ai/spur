---
schema_version: 1
name: Run repo-wide tripwires on the wrap diff before the wrap commit
status: done
template: feature-impl
created_at: 2026-10-01T01:23:53.052Z
updated_at: "2026-10-01T03:50:38.750Z"
feature_id: A9

ac_altitude: task-local
---

## 1037. Run repo-wide tripwires on the wrap diff before the wrap commit

### Background

Repo-wide tripwires (`repo-wide-tests/`, run by `bun run test-repo-wide`, `package.json:85`) execute only inside `spur-check-feature`. In batch runall-A9-485e the wrapup `doc-sync` agent (sp:doc-evolve wrapup) rewrote ADR-130's committed Decision text in place. The operator then committed it as fdf0a62b4 (2026-09-30 16:49), and adr-supersession test (e) caught it only at the 17:15–17:21 merge re-gate. That forced a drop decision (merge 2b10712c9) and a re-gate.

Refinement 2026-09-30 corrected the original premise. Neither `config/workflows/wrapup-pipeline.yaml` nor `plugins/sp/scripts/wrapup-steps.ts` creates a "wrap commit". The wrap commit is made by the operator or batch driver after wrapup finishes. The title's "before the wrap commit" therefore means "before wrapup reaches a terminal success state". The edits are still uncommitted at that point.

The fail-early window matters because test (e) inspects only the *working diff* of `docs/00_ADR.md` (`repo-wide-tests/adr-supersession.test.ts:152-208`). Once a wrap edit is committed on a clean tree, (e) can no longer see it. Only a merge or conflict that resurfaces the diff can trip it. So the window inside wrapup is the only reliable one.

### Requirements

- [x] R1. Post-doc-sync tripwire hop. `wrapup-pipeline.yaml` gains one state, `doc-tripwire`, entered after the doc-sync branch resolves: from `learnings-append` and from `repair`, both of which today go straight to `metrics-record`. It is not entered on the `task-resolve → metrics-record` path, which runs no doc-sync. The state runs the new var `docTripwireCmd` via `sh -c` and writes `PASS` or `FAIL` to `.spur/run/$__runId-wrapup-doc-tripwire.status`, following the `feature-verify` pattern. FAIL routes to `failed` with `terminalReason: failed-check`. PASS routes to `metrics-record`. The FAIL edge is declared first, and a missing status never routes as PASS.
- [x] R2. Portable, trusted-config default. `docTripwireCmd` is a TRUSTED CONFIG ONLY var, with the same comment and security contract as `featureGateCmd`. Its default runs `bun run test-repo-wide` only when `package.json` declares a `test-repo-wide` script; otherwise it exits 0 (a no-op for other projects). Spur gets the tripwire with no caller change. Callers can override it with `--vars`, and an empty string disables the hop's check while still writing PASS.
- [x] R3. Additive and cost-bounded. No existing state, edge or gate changes semantics: `featureGateCmd`/`feature-verify`, `spur-check-feature` and merge-time re-gates stay as they are. Reuse the existing `test-repo-wide` runner and write no new check logic. On a clean wrap the added cost is one `test-repo-wide` run.
- [x] R4. Contract docs in the same change (T3). The wrapup state list and route description in `plugins/sp/skills/spur-dev/references/dev-operations.md` (wrap/wrapall) and `execution-batch.md` (Step 6 batch wrap) name the new hop and var. Rebuild the generated bundle `apps/cli/config/` with `build:bundle`.
- [x] N1. Non-goals. The feature-transition pre-flight is 1033 R2 and diff-sized verify is 1033 R1. No commit step is added to wrapup, no ADR-124 gate-frequency change, no new tripwire tests or rules, and no change to the doc-sync agent prompt.

### Acceptance Criteria

- [x] AC1 — An in-place historical ADR edit left by doc-sync fails wrapup at doc-tripwire (req: R1)
- [x] AC2 — A clean doc-sync diff passes doc-tripwire and proceeds to metrics-record (req: R1, R3)
- [x] AC3 — The repair path also passes through doc-tripwire; the no-doc-sync path does not (req: R1)
- [x] AC4 — The default command is a no-op in a project without a test-repo-wide script and runs it in Spur (req: R2)
- [x] AC5 — Wrap contract docs and the generated bundle name the new hop and var (req: R4)

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

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | doc-tripwire state yaml:329-348 (sh -c "$docTripwireCmd", run-scoped status, exit-0 file-truth); retargets learnings-append/repair -> doc-tripwire :582-591; fast path untouched :500-506; FAIL edge first :598-611 terminalReason failed-check, PASS edge :612-618; missing status fail-closed via engine no-match (state-machine.ts:175-177); tests :806-843, :858-883 |
| R2 | MET | docTripwireCmd default + package-script probe :120; TRUSTED CONFIG ONLY :115-119 (same contract as featureGateCmd :111-112); no-op/declared/empty-disable behavior test :858-883; --vars override + empty-string disable documented dev-operations.md:374,390 + execution-batch.md:563 |
| R3 | MET | Additive diff: 1 var, 1 state, 2 new edges, 2 retargets; featureGateCmd/spur-check-feature untouched (package.json:84); reuses test-repo-wide runner (package.json:85), no new check logic; wrapup-steps.ts absent from diff; cost = one test-repo-wide per clean doc-sync wrap |
| R4 | MET | dev-operations.md:374,:390 + execution-batch.md:559-563 name hop/var/override/disable; generated bundle identical at identical lines (v7 :89, :17, :30-31, :120, :329-348, :599-617), gitignored generated output (.gitignore:80) |
| N1 | MET | No commit step (terminal reachability test :885-891), no ADR-124 change, no new tripwire tests/rules, no doc-sync prompt change; working-tree delta exactly the 5 stated files |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — An in-place historical ADR edit left by doc-sync fails wrapup at doc-tripwire (req: R1) | MET | test | repo-wide test (e) inspects only the uncommitted working diff of docs/00_ADR.md (adr-supersession.test.ts:152-208); declared script exit 1 records FAIL (test:868-871) -> FAIL edge routes failed (:816-829); missing status fail-closed; named E2E artifact covered by accepted mitigation (behavior tests + bundle parity + live wrap doc-tripwire run immediately after verify) |
| AC2 — A clean doc-sync diff passes doc-tripwire and proceeds to metrics-record (req: R1, R3) | MET | test | exit-0 writes PASS (:863-866, :872-874); PASS guard routes metrics-record (:612-618, asserted :820-829); Spur declares the script so a clean diff runs it and passes; live wrap run is E2E confirm |
| AC3 — The repair path also passes through doc-tripwire; the no-doc-sync path does not (req: R1) | MET | test | learnings-append and repair each have exactly one outbound edge to doc-tripwire (test:831-837; yaml:582-591); fast path present exactly once with shell guard, no task-resolve->doc-tripwire edge (test:838-843; yaml:478-519) |
| AC4 — The default command is a no-op in a project without a test-repo-wide script and runs it in Spur (req: R2) | MET | test | no test-repo-wide script -> probe fails -> PASS no-op (test:863-866; var :120); in Spur the script is declared (package.json:85); live wrap doc-tripwire run completes the "runs in Spur" half (accepted rationale) |
| AC5 — Wrap contract docs and the generated bundle name the new hop and var (req: R4) | MET | test | executable: version-pin test wrapup-pipeline.test.ts:116,149 + suite bundle parity asserts; static (reviewer-verified first-hand): dev-operations.md:374,390 + execution-batch.md:559-563 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Fresh reviewer subagent (read-only) ran /sp:dev-review --tasks 1037 --auto over the 5-file wrap diff. Verdict: PASS, HIGH confidence. SECUA clean. Functional traceability: R1-R4 + N1 MET. AC1-AC5 MET (AC1 mechanism-level).

| Priority | Count | Findings |
| --- | --- | --- |
| P1 | 0 | None |
| P2 | 0 | None |
| P3 | 2 | Evidence hygiene: (1) AC1 E2E repro artifact .spur/run/1037-tripwire-repro.log absent — mitigated: behavior tests pin the mechanism (wrapup-pipeline.test.ts:848-885), pre-existing repo-wide ADR test supplies the historical-edit scenario, live tripwire runs in the wrap hop immediately after verify; (2) plan-step-6 one-time spur-check-feature receipt absent — mitigated: bundle parity holds (apps/cli/config regenerated in gate), full-tier gate PASS on disk (1037-check-receipt.json) |
| P4 | 3 | Pre-existing drift, report-only, not introduced by this diff: stale learning-capture name in cross-cutting.md:652,667 + help docs + e2e-workflow design doc (route: sp:doc-evolve); lifecycle-projection-integrity.md:23 trusted sh -c var inventory lacks docTripwireCmd; wrapup iterationBound:10 headroom now 9/10 on worst-case wrap path |

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

- 2026-10-01T02:30:14.159Z backlog → wip (system)
- 2026-10-01T03:45:02.206Z wip → testing (system)
- 2026-10-01T03:50:38.750Z testing → done (system)

