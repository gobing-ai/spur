---
schema_version: 1
name: Preserve feature scenario-key rows when re-verifying and re-recording a task
status: todo
template: standard
created_at: 2026-09-23T23:05:36.805Z
updated_at: "2026-09-23T23:47:48.766Z"
feature_id: D63

priority: P2
ac_altitude: task-local
estimate_hours: 4
---

## 0936. Preserve feature scenario-key rows when re-verifying and re-recording a task

### Background

Filed by the 2026-09-23 session review (--triage) after the D63 verifyall batch (8/8 task verdicts PASS, shippable FAIL on incomplete 0935).

During that batch, each done task was force re-verified standalone: a fresh `.spur/run/<wbs>-verdict.json` was authored and `spur task record <wbs> --verdict-file …` re-transcribed `## Testing` from it. The 0921 artifact was authored with bare requirement ids (R1–R4) and dropped the DD-09 scenario-title row `R4 — Task optimization earns promotion` that `spur feature check D63` needs for satisfaction. The gate caught it as `L4.scenario-unverified` (covering task 0921 had no PASS verdict with MET requirement); the keyed row was restored and the check returned to 0 findings. Detection depended entirely on someone re-running `feature check` — nothing in the verify/record path warns at write time.

Already resolved in-session (excluded from this task): the 0921 scenario key itself; the Review-backfill data-loss concern (sectionIsBare guard verified working — authored reports at 0914/0915 untouched, only bare `<!-- spur:record-review -->` placeholders at 0917–0921 backfilled).

Evidence: `.spur/run/0921-verdict.json` (restored scenario-key requirements row); `spur feature check D63 --json` before/after (1 finding → 0 findings); the dropped-key class is reproducible by any `--force` re-verify that authors a fresh verdict artifact for a task whose Testing carries feature scenario-title rows (0915 R2, 0916 R3, 0918 R5, 0919 R6, 0920 R7, 0921 R4+R8 keys today).

### Requirements

- [ ] R1. Make the verify→record path preserve feature scenario-title rows: when `spur task record --verdict-file` re-transcribes `## Testing` and the new artifact lacks a MET-row match for a feature scenario title (or `AC-N` alias) that the previous Testing section matched with a MET row, warn loudly on stderr (exit 0) naming each dropped scenario; additionally warn when the new artifact's rows match no feature scenario at all (parity with the existing `task verdict` warning). Surface the warnings in `RecordResult.scenarioWarnings` and `--json`. Owner seam: `TaskService.record()` (`packages/app/src/services/task-service.ts:1339`) with matching owned by a new exported `matchedScenarioKeys` helper in `feature-check.ts` — no second normalization implementation.
- [ ] R2. Cover the behavior with focused tests in `packages/app/tests/services/task-record.test.ts`: dropped-key warns and names the scenario; preserved-key stays silent; MET-only comparison; no-feature_id silent; no-match-parity warns; the bare-placeholder Review backfill is unchanged.
- [ ] R3. Document the scenario-key carry-forward rule in `plugins/sp/skills/code-verification/SKILL.md` Step 10 so standalone `--force` re-verifies copy existing scenario-title rows into the fresh verdict artifact.

### Acceptance Criteria

- [ ] AC1 — A fixture re-record whose verdict artifact drops a MET-matched feature scenario-title row prints the R1 stderr warning naming that scenario, still exits 0, and carries the warning in `RecordResult.scenarioWarnings` / `--json`; a subsequent `spur feature check` no longer regresses to `L4.scenario-unverified` without a record-time signal. (req: R1)
- [ ] AC2 — The focused tests for dropped-key warning, preserved-key silence, MET-only comparison, no-feature silence, no-match parity, and unchanged Review backfill all pass. (req: R2)
- [ ] AC3 — `plugins/sp/skills/code-verification/SKILL.md` Step 10 names the carry-forward rule where a standalone verifier reads it. (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-23T23:46:26.593Z

- **Warn vs refuse (closed 2026-09-23):** warn-only in v1. Refusal would break legitimate standalone re-verifies that intentionally re-key evidence, and `spur feature check` already is the hard gate (`L4.scenario-unverified` warning → error under `--strict` at the done boundary). The record-time signal closes the *detection-timing* gap — the regression surfaces at the write that causes it instead of the next feature check. Reversible: a future refusal mode is additive.
- **Where the matching logic lives (closed):** `feature-check.ts` remains the single owner of scenario matching. Record consumes a new exported pure helper from it instead of re-implementing normalization; `task-service.ts` only adds feature-file resolution, for which `checkAcSubsetWarning` (`packages/app/src/services/task-service.ts:1282`) is the precedent.
- **What counts as a regression (closed):** only **MET**-status matched scenario keys are compared, previous Testing vs new artifact. A scenario whose previous match was not MET was never verified, so there is nothing to lose; comparing all rows would warn on non-load-bearing churn.
- **Scope exclusions (closed):** the `spur task verdict --from-answer` path already warns on no-scenario-match (0700 R3, see `packages/app/src/services/feature-check.ts:910-925`) and needs no change; Review backfill (`sectionIsBare` guard) is untouched; no FSM, gate, or verdict-schema change.

### Design

Add a record-time scenario-coverage guard to `TaskService.record()` so a re-transcription that drops a previously-carried feature scenario-key row warns at the write that causes it.

**Seam.** `TaskService.record()` at `packages/app/src/services/task-service.ts:1339` already parses the current document before overwriting Testing (`:1343-1344` parse, `:1362-1367` Testing write), so the previous Testing body is available with zero extra I/O.

**New private helper** `checkScenarioKeyRegression(taskFilePath, prevTestingBody, verdict): Promise<string[]>` mirroring `checkAcSubsetWarning` (`packages/app/src/services/task-service.ts:1282`): frontmatter `feature_id` → prefix-scan `join(dirname(taskFilePath), '..', 'features')` for `<id>_*.md` (`:1291-1300` precedent) → extract the feature's `Acceptance Criteria` body. Extract that resolution half of `checkAcSubsetWarning` into a shared private `resolveFeatureAcBody(taskFilePath)` — behavior-preserving, both helpers consume it. No feature_id / no feature file / no scenarios → `[]` (silent).

**Matching (feature-check.ts stays the owner).** Export a pure `matchedScenarioKeys(rows, ac): string[]` from `packages/app/src/services/feature-check.ts` built on the existing `rowMatchesScenario` (`:1206`) and the `AC-N` alias indexing used by `checkScenarioSatisfaction` (`:792-797`); `verdictRowsMatchScenarios` (`:1237`, barrel-exported at `packages/app/src/index.ts:216`) is the any-match precedent. Compute matched keys for MET-status rows only: previous Testing rows via `parseTesting` (imported from `./task-record`, the `feature-check.ts:44` precedent) versus the new artifact's `requirements` + `acceptanceCriteria`.

**Warnings (two, both exit-0).**
- Regression: a scenario key matched by a MET row in previous Testing has no MET-row match in the new artifact → one warning per dropped key naming the scenario title and the covering task role it served.
- No-match parity: the new artifact's rows match no feature scenario at all → one warning, mirroring the `task verdict` wording so the bypassed path and this one read alike.

**Surfacing.** Extend `RecordResult` (`packages/app/src/services/task-record.ts:84`) with `scenarioWarnings?: string[]`; the CLI `spur task record` prints each warning to stderr, exit 0 — the `updateSection` warnings-spread precedent (`task-service.ts:853-855`, `:1221-1224`). `--json` output carries the array.

**Invariants.** Warning-only, never blocks the write; UNKNOWN verdicts and the authored-Testing preservation branch (`:1358-1367`) behave exactly as today; Review `sectionIsBare` fallback unchanged; no new public CLI noun/verb, no verdict-schema change, no second normalization implementation.

**Tests** land in `packages/app/tests/services/task-record.test.ts` (record-call precedent `:712`): dropped-key warns and names the scenario; preserved-key silent; MET-only comparison (a previously non-MET match lost → silent); no-feature_id silent; no-match-parity warns; Review backfill unchanged.

### Plan

- [ ] 1. Export `matchedScenarioKeys(rows, ac)` from `packages/app/src/services/feature-check.ts` (pure, built on `rowMatchesScenario` + the `AC-N` alias indexing); add a barrel export only if consumers outside `services/` need it. Unit-test title / `Scenario:`-prefix / alias / MET-filter behavior in the feature-check test suite.
- [ ] 2. Extract `resolveFeatureAcBody(taskFilePath)` from `checkAcSubsetWarning` in `packages/app/src/services/task-service.ts` (behavior-preserving), then implement `checkScenarioKeyRegression` and wire it into `record()` between the verdict read and the Testing write; extend `RecordResult` with `scenarioWarnings?: string[]`.
- [ ] 3. Print the warnings to stderr (exit 0) and into `--json` output in the CLI `task record` command (`apps/cli/src/commands/task.ts`), matching the `updateSection` warnings precedent.
- [ ] 4. Add the `task-record.test.ts` cases from Design (dropped-key warns / preserved-key silent / MET-only / no-feature silent / no-match-parity / Review backfill unchanged) and run the narrow suite, then the `record`-adjacent app+CLI tests per the changed-path matrix.
- [ ] 5. Add the scenario-key carry-forward rule to `plugins/sp/skills/code-verification/SKILL.md` Step 10 (standalone re-verify copies existing scenario-title rows into the fresh verdict artifact) and run `bun run spur-check` once as the final gate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/app/src/services/task-service.ts:1339` — `record()` seam; `:1343-1344` previous-document parse; `:1362-1367` Testing re-transcription; `:1282` `checkAcSubsetWarning` feature-resolution precedent (`:1291-1300` prefix-scan); `:853-855`, `:1221-1224` warnings-spread surfacing precedent.
- `packages/app/src/services/task-record.ts:84` — `RecordResult`; `./task-record` exports `parseTesting` (consumer precedent `feature-check.ts:44`).
- `packages/app/src/services/feature-check.ts:1206` — `rowMatchesScenario`; `:1237` `verdictRowsMatchScenarios` (any-match warning precedent, barrel-exported `packages/app/src/index.ts:216`); `:792-797` scenario alias indexing; `:910-925` the 0700 R3 verdict-time warning this task mirrors; `:951-975` `isScenarioVerified` (PASS + MET-row semantics).
- `packages/app/tests/services/task-record.test.ts:712` — `svc.record()` test precedent.
- `.spur/run/0921-verdict.json` — the restored scenario-key row (`R4 — Task optimization earns promotion`) whose initial loss motivated this task; session evidence: `spur feature check D63 --json` 1 finding → 0 findings after restore.
- `plugins/sp/skills/code-verification/SKILL.md` Step 10 — documentation owner for the carry-forward rule (R3).

### History

- 2026-09-23T23:46:35.664Z backlog → todo (system)

