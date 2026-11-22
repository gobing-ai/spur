---
schema_version: 1
name: "E2E proof: idea run files follow-ups and discovery findings"
status: done
template: feature-impl
created_at: 2026-11-22T03:48:21.562Z
updated_at: "2026-11-22T19:46:39.629Z"
feature_id: I15

dependencies: ["1434"]
tags: ["I15"]
priority: P2
estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 1435. E2E proof: idea run files follow-ups and discovery findings

### Background

Implements: R5 — An E2E idea run files follow-ups and discovery findings and leaves a receipt.

Builds on 1434 (handoff completeness check and report sections) and on the feature-create ledger gate (`config/workflows/idea-pipeline.yaml:177-211`).

**Refine corrections (2026-11-21)**
- Background repeated 1434's text ("This task adds the deterministic completeness layer") → rewritten. This task is the end-to-end proof, not the layer.
- "A script under scripts/commands/" → **a test** next to the existing idea-pipeline E2E, `apps/cli/tests/workflow/idea-pipeline-e2e.test.ts`. That test already drives the bundled pipeline in-process (`main(['workflow', …])`) with `executor: 'host'`, writes each work item's artifacts plus a receipt, and advances with `workflow continue --answer-text <receipt>`. The "scripted work-item answers" mechanism exists, and a `scripts/commands` copy would duplicate it (ADR-130).
- What the proof proves: the host work items are scripted by the test (feature create, ledger, AC, batch), so it proves the **deterministic** chain: the yaml ledger gate, `spur feature check --inventory`, batch-create, and `spur feature handoff` with 1434's check and sections. It does **not** prove that `sp:brainstorm` writes good dispositions; that is model behavior outside a repeatable receipt.
- Path: idea-eval → feature-create → ac-generate → (system-design skipped: `design=skip`) → decompose → batch-create-run → ready-prepare → handoff-finalize → handoff (`idea-pipeline.yaml` states :68-420).

### Requirements

- [x] R1. `apps/cli/tests/workflow/idea-followup-ledger-e2e.heavy.test.ts` runs the bundled `idea-pipeline.yaml` in a temp project with `executor: host`, `profile: auto`, `design: skip`, `idea_approved: true`, from start to the terminal `handoff` state. Each host work item is answered by writing its `expectFiles` plus a receipt.
- [x] R2. The scripted eval report's `## Requirement inventory` has:
  - I1 and I2 owing items (covered by the AC);
  - I3 `[deferred: follow-up — Preview export]`;
  - I4 `[deferred: excluded — operator ruled out]`;
  - I5 `(source: discovery — src/preview.ts:12) [deferred: follow-up — Preview cache invalidation]`.

  The scripted feature-create step creates the I3/I5 features with real `spur feature create` calls and writes the ledger.
- [x] R3. Assertions, from `--json` output and run-folder files only:
  - the run ends in `handoff`;
  - `spur feature show` resolves both follow-up ids;
  - the ledger has exactly I3 and I5;
  - no feature titled after I4 exists;
  - the handoff report has `## Follow-ups filed` with both ids and `/sp:dev-plan --feature <id>`, `## Excluded` with I4 and its reason, and exactly one `## Next command`.
- [x] R4. A negative leg: the same fixture with the I5 row removed from the ledger after feature-create makes `spur feature handoff` exit nonzero naming I5, with no handoff report written. Drive it directly against the run folder; no second full pipeline run is needed.
- [x] R5. It writes the live `.spur/run/idea-followup-ledger-e2e-receipt.json` (stable name, overwritten each run) with `{generatedAt, runId, finalState, ledger, followupsFiled, excluded, negativeLeg: {exitCode, message}}`. A successful preview is explicitly published to `docs/reports/idea-followup-ledger-e2e-receipt.json` before the feature gate; automated verification does not rewrite its tracked proof inputs.

### Acceptance Criteria

- [x] AC1 — An E2E idea run files follow-ups and discovery findings and leaves a receipt

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:35:16.698Z

- **Closed: script vs test.** Test. The host-executor harness already lives in `apps/cli/tests/workflow/`, and the heavy suite runs it.
- **Closed: proving brainstorm's dispositions.** Out of scope. Model output is not repeatable; the proof covers the deterministic chain the prompt feeds.

### Design

- **Model:** extend the pattern in `idea-pipeline-e2e.test.ts:7-72`: an `invoke(args)` helper over `main([...,'--json'])`, temp project, `decideDecisionMaker: false`, and `writeFile` for artifacts. Add a `answer(item, files)` helper that writes the given files and the receipt and calls `continue`. Loop until `status` is terminal, branching on `pause.workItem.state`.
- **Real CLI where it matters:** feature creation, follow-up filing, AC write and batch-create go through `main([...])` CLI calls in the scripted step. Shell gates then exercise real corpus state, and nothing is hand-written into `docs/features/`.
- **Heavy:** a full run spawns shell actions and the spur binary (`$spurBin`). Name it `*.heavy.test.ts` so `test:heavy` owns it. Give it a 120s timeout.
- **Anti-patterns:** no asserting on model prose; no mocking `finalizeIdeaHandoff`; no fixed sleeps; no writing the receipt only on success (write it in `finally` with whatever was observed).
- **Depends on 1434** for the sections and fail-closed exit. Before 1434 lands, R3/R4 fail, which proves the test discriminates.

### Plan

Premises (verified 2026-11-21): host-executor E2E pattern `apps/cli/tests/workflow/idea-pipeline-e2e.test.ts:7-72`; pipeline states `config/workflows/idea-pipeline.yaml:68-420`; ledger gate :210-211; handoff state :409-418.

- [ ] 1. Failure modes: a stage's `expectFiles` list drifts and the scripted answer misses a file (assert the pause state names each time); a follow-up is filed with a wrong id; an excluded item is filed; the negative leg passes because the report exists from the positive leg (use a fresh run id and assert the report is absent); the receipt is not written on failure.
- [ ] 2. Write the test against the current tree. It should reach `handoff-finalize` and fail on R3's sections (1434 not landed), or pass end to end once 1434 lands.
- [ ] 3. Run `(cd apps/cli && bun test tests/workflow/idea-followup-ledger-e2e.heavy.test.ts)` until green. Inspect the receipt.
- [ ] 4. Confirm `bun run test:heavy` includes it, and commit the receipt.

### Solution

The heavy subprocess E2E drives the actual idea-pipeline definition through host work-item pauses, native feature creation/update and native handoff. Its fixture contains I1/I2 covered requirements, I3 follow-up, I4 excluded and discovery-prefixed I5 follow-up; the ledger contains exactly I3/I5, both features resolve, and the excluded feature is not created. The report sections and single main next command are asserted. A fresh negative run id removes I5 from the ledger and proves nonzero exit naming I5, with no handoff report.

The freshly bundled `apps/cli/config/workflows/idea-pipeline.yaml` and the executed tracked `config/workflows/idea-pipeline.yaml` are byte-identical; the run-local definition-provenance artifact records their hash. This verifies the bundled definition without maintaining a second workflow.

Artifact boundary correction from the earlier A83 gate repair is now reflected in R5: the test always writes its stable live receipt to `.spur/run/idea-followup-ledger-e2e-receipt.json` in finally. A successful preview is explicitly published as `docs/reports/idea-followup-ledger-e2e-receipt.json` before the feature gate. Automated tests preserve their tracked inputs, so a feature receipt cannot invalidate itself. The required payload fields and the canonical published name are unchanged. This replaces the stale claim that the test runs Biome over the ignored receipt or rewrites a tracked proof on every invocation.

Fresh real CLI parity/E2E run: 36 pass, zero fail, including the positive and negative handoff legs; the standalone E2E also passed. The published receipt is from this verification run.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/workflow/idea-followup-ledger-e2e.heavy.test.ts:226` runs the idea pipeline with host executor, auto profile, skipped design and approved idea; the resume helper at line 217 writes expected artifacts and receipts after each pause. Executed source definition equals the freshly bundled definition byte-for-byte; @batch `.spur/run/verify-1435-definition-provenance.json` lines 1-6 records its digest. |
| R2 | MET | `apps/cli/tests/workflow/idea-followup-ledger-e2e.heavy.test.ts:27` owns the fixture; inventory I1/I2, explicit I3 follow-up, excluded I4 and discovery-prefixed I5 are passed through real native feature-create/update calls. The published receipt ledger contains exactly I3 and I5. |
| R3 | MET | `apps/cli/tests/workflow/idea-followup-ledger-e2e.heavy.test.ts:325` resolves both ids and checks the exact ledger, feature inventory, report sections, both plan commands and one main Next command. Fresh real CLI parity plus E2E run passed 36 tests; the published receipt records terminal handoff and report observations. |
| R4 | MET | `apps/cli/tests/workflow/idea-followup-ledger-e2e.heavy.test.ts:365` uses a separate negative run id with I5 removed. The real CLI returns nonzero naming I5 and no report exists, preventing the successful leg from masking a failure. |
| R5 | MET | Full repository gate PASS: @batch `.spur/run/run_5cd020af-b6e3-42d0-883a-aa1d54e908f5-feature-verification.log` lines 1-786. Fix-pass artifacts: @batch `.spur/run/1435-verify-answer.txt` lines 1-33 and `.spur/run/1435-verdict.json` lines 1-67; raw evidence under `.spur/run/verify-1434-1436-` and `.spur/run/verify-1436-`. `apps/cli/tests/workflow/idea-followup-ledger-e2e.heavy.test.ts:380` always emits the live ignored receipt in finally. The successful preview is explicitly published to `docs/reports/idea-followup-ledger-e2e-receipt.json:1` with required fields. R5/Solution now reflect this boundary; automated verification does not mutate its tracked proof input. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R5 — An E2E idea run files follow-ups and discovery findings and leaves a receipt | MET | command | `docs/reports/idea-followup-ledger-e2e-receipt.json:1`; native positive and negative E2E plus 54 focused inventory/handoff tests. @batch `.spur/run/verify-1434-1436-e2e-final.log` lines 1-46 records 36 pass; `.spur/run/verify-1434-1436-focused-final.log` lines 1-66 records 54 pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T03:48:24.480Z backlog → todo (system)
- 2026-11-22T06:03:02.112Z todo → wip (system)
- 2026-11-22T06:04:45.045Z wip → testing (system)
- 2026-11-22T06:04:47.073Z testing → done (system)

