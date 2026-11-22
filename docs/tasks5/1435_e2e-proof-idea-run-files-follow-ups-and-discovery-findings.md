---
schema_version: 1
name: "E2E proof: idea run files follow-ups and discovery findings"
status: done
template: feature-impl
created_at: 2026-11-22T03:48:21.562Z
updated_at: "2026-11-22T06:04:47.078Z"
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
- [x] R5. It writes `docs/reports/idea-followup-ledger-e2e-receipt.json` (stable name, overwritten each run) with `{generatedAt, runId, finalState, ledger, followupsFiled, excluded, negativeLeg: {exitCode, message}}`.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

- `apps/cli/tests/workflow/idea-followup-ledger-e2e.heavy.test.ts` — new heavy, subprocess-driven E2E (no in-process `main()`): runs the bundled `config/workflows/idea-pipeline.yaml` via real `spur` subprocesses (`runCli`) in a temp project with `executor:host`, `profile:auto`, `design:skip`, `idea_approved:true`; each host work-item pause is answered by writing its `expectFiles` after the pause appears (stage onEnter shells delete stale artifacts) plus a receipt at `.spur/run/<runId>/receipts/<state>.json` (shape per `packages/app/src/workflow/receipt.ts`) and `workflow continue --answer-text`; the scripted feature-create stage files I3/I5 through real `spur feature create --parent` + `feature update --section` calls and writes the follow-up ledger validated by the yaml shell gate; R2 fixture carries the exact inventory (I3/I5 deferred follow-ups, I4 excluded, I5 discovery-source prefix); asserts R3 terminal `handoff`, ledger exactly I3+I5 resolvable via `feature show`, no I4-titled feature, report sections `## Follow-ups filed` (both ids + `/sp:dev-plan --feature <id>`), `## Excluded` (I4 + reason), exactly one `## Next command`; R4 negative leg re-drives `feature handoff` against a fresh run id with the I5 ledger row removed and asserts nonzero exit naming I5 with no report written; writes the observed outcome to `docs/reports/idea-followup-ledger-e2e-receipt.json` (biome-cleaned via `bunx biome check --write`, 1309 parity-evidence pattern).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | test: apps/cli/tests/workflow/idea-followup-ledger-e2e.heavy.test.ts spawns real spur subprocesses, drives config/workflows/idea-pipeline.yaml host-executed to finalState handoff, answering every expectFiles pause with receipts (1/1 pass, ~25s) |
| R2 | MET | test: same file — scripted eval report fixture carries I1/I2 covered, I3 follow-up, I4 excluded with reason, I5 discovery-prefixed follow-up; feature-create stage uses real spur feature create + ledger write of I3/I5 rows |
| R3 | MET | test: same file asserts status done/finalState handoff, both ids resolve via feature show, ledger exactly I3+I5, no I4-titled feature, report sections Follow-ups filed (both ids + /sp:dev-plan --feature <id>), Excluded (I4 + reason), exactly one Next command |
| R4 | MET | test: negative leg — ledger without I5 row -> spur feature handoff exit 1 naming "follow-up item I5 has no ledger row", no handoff report written |
| R5 | MET | test: finally-block writes docs/reports/idea-followup-ledger-e2e-receipt.json with generatedAt/runId/finalState/ledger/followupsFiled/excluded/negativeLeg; command: bunx biome check on the artifact -> clean |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | command: bun test apps/cli/tests/workflow/idea-followup-ledger-e2e.heavy.test.ts 1/1 pass — full idea run files follow-ups (I3, I5 -> real features) and discovery findings, leaves docs/reports/idea-followup-ledger-e2e-receipt.json |
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

