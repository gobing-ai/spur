---
schema_version: 1
name: Preserve feature scenario-key rows when re-verifying and re-recording a task
status: done
template: standard
created_at: 2026-09-23T23:05:36.805Z
updated_at: "2026-09-24T01:53:03.749Z"
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

- [x] R1. Make the verify→record path preserve feature scenario-title rows: when `spur task record --verdict-file` re-transcribes `## Testing` and the new artifact lacks a MET-row match for a feature scenario title (or `AC-N` alias) that the previous Testing section matched with a MET row, warn loudly on stderr (exit 0) naming each dropped scenario; additionally warn when the new artifact's rows match no feature scenario at all (parity with the existing `task verdict` warning). Surface the warnings in `RecordResult.scenarioWarnings` and `--json`. Owner seam: `TaskService.record()` (`packages/app/src/services/task-service.ts:1339`) with matching owned by a new exported `matchedScenarioKeys` helper in `feature-check.ts` — no second normalization implementation.
- [x] R2. Cover the behavior with focused tests in `packages/app/tests/services/task-record.test.ts`: dropped-key warns and names the scenario; preserved-key stays silent; MET-only comparison; no-feature_id silent; no-match-parity warns; the bare-placeholder Review backfill is unchanged.
- [x] R3. Document the scenario-key carry-forward rule in `plugins/sp/skills/code-verification/SKILL.md` Step 10 so standalone `--force` re-verifies copy existing scenario-title rows into the fresh verdict artifact.

### Acceptance Criteria

- [x] AC1 — A fixture re-record whose verdict artifact drops a MET-matched feature scenario-title row prints the R1 stderr warning naming that scenario, still exits 0, and carries the warning in `RecordResult.scenarioWarnings` / `--json`; a subsequent `spur feature check` no longer regresses to `L4.scenario-unverified` without a record-time signal. (req: R1)
- [x] AC2 — The focused tests for dropped-key warning, preserved-key silence, MET-only comparison, no-feature silence, no-match parity, and unchanged Review backfill all pass. (req: R2)
- [x] AC3 — `plugins/sp/skills/code-verification/SKILL.md` Step 10 names the carry-forward rule where a standalone verifier reads it. (req: R3)

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

- [x] 1. Export `matchedScenarioKeys(rows, ac)` from `packages/app/src/services/feature-check.ts` (pure, built on `rowMatchesScenario` + the `AC-N` alias indexing); add a barrel export only if consumers outside `services/` need it. Unit-test title / `Scenario:`-prefix / alias / MET-filter behavior in the feature-check test suite.
- [x] 2. Extract `resolveFeatureAcBody(taskFilePath)` from `checkAcSubsetWarning` in `packages/app/src/services/task-service.ts` (behavior-preserving), then implement `checkScenarioKeyRegression` and wire it into `record()` between the verdict read and the Testing write; extend `RecordResult` with `scenarioWarnings?: string[]`.
- [x] 3. Print the warnings to stderr (exit 0) and into `--json` output in the CLI `task record` command (`apps/cli/src/commands/task.ts`), matching the `updateSection` warnings precedent.
- [x] 4. Add the `task-record.test.ts` cases from Design (dropped-key warns / preserved-key silent / MET-only / no-feature silent / no-match-parity / Review backfill unchanged) and run the narrow suite, then the `record`-adjacent app+CLI tests per the changed-path matrix.
- [x] 5. Add the scenario-key carry-forward rule to `plugins/sp/skills/code-verification/SKILL.md` Step 10 (standalone re-verify copies existing scenario-title rows into the fresh verdict artifact) and run `bun run spur-check` once as the final gate.

### Solution

Implemented the record-time scenario-key carry-forward guard exactly per Design.

| Change (`file:line`) | What |
| --- | --- |
| `packages/app/src/services/feature-check.ts:1262` | New exported pure `matchedScenarioKeys(rows, ac)` — MET-status rows only, built on the existing `rowMatchesScenario` (`:1206`) and the shared AC-N alias indexing (extracted `indexScenarioAliases`, now also used by `verdictRowsMatchScenarios` — no second normalization implementation). |
| `packages/app/src/services/task-record.ts:84` | `RecordResult` gains `scenarioWarnings?: string[]`. |
| `packages/app/src/services/task-service.ts:1320` | Extracted shared private `resolveFeatureAcBody(taskFilePath)` from `checkAcSubsetWarning` (behavior-preserving; both warnings consume it). |
| `packages/app/src/services/task-service.ts:1359` | New private `checkScenarioKeyRegression(wbs, taskFilePath, prevTestingBody, verdict)` — previous Testing rows via `parseTesting` vs new artifact `requirements` + `acceptanceCriteria`; one warning per dropped MET-matched scenario key naming it, plus the no-match parity warning mirroring the 0700 R3 `task verdict` wording. Warn-only, swallows to `[]` on any miss. |
| `packages/app/src/services/task-service.ts:1478` | `record()` wires the guard inside the Testing re-transcription branch (before the overwrite), so UNKNOWN-verdict authored-Testing preservation and Review `sectionIsBare` fallback behave exactly as today. |
| `apps/cli/src/commands/task.ts:1242` | `spur task record` prints each scenario warning to stderr (exit 0, both modes); `--json` carries the array on `scenarioWarnings`. |
| `packages/app/tests/services/task-record.test.ts:1187` | Five focused record cases: dropped-key warns+names scenario (Review backfill asserted unchanged), preserved-key silent, MET-only comparison, no-feature_id silent, no-match parity warns. |
| `packages/app/tests/services/feature-check.test.ts:3350` | `matchedScenarioKeys` unit tests: title/`Scenario:`-prefix/bracket-tag/alias matching, MET-filter, empty inputs. |
| `plugins/sp/skills/code-verification/SKILL.md:269` | Step 10 documents the scenario-key carry-forward rule for standalone `--force` re-verifies (R3). |

Rationale: detection moved from the next `feature check` to the write that causes the regression; matching stays owned by feature-check; warnings never block the write (reversible, per Q&A).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Anchors re-read this run: exported pure `matchedScenarioKeys` at `packages/app/src/services/feature-check.ts:1254` (MET-rows-only, built on `rowMatchesScenario` + shared `indexScenarioAliases` `:1262` — single normalization implementation); `checkScenarioKeyRegression` at `packages/app/src/services/task-service.ts:1359` wired into `record()` before the Testing overwrite (`:1442-1448`), swallow-to-`[]` warn-only; `RecordResult.scenarioWarnings` at `packages/app/src/services/task-record.ts:84`; CLI prints each warning to stderr exit-0 with `--json` carrying the array (`apps/cli/src/commands/task.ts:1242-1247`). Live demonstration: this very re-record via the source CLI emitted the no-match parity warning on stderr, exit 0. |
| R2 | MET | Five focused record cases re-read at `packages/app/tests/services/task-record.test.ts:1219-1300` (dropped-key warns+names scenario `:1219`, preserved-key silent `:1249`, MET-only comparison `:1262`, no-feature_id silent `:1283`, no-match parity `:1290`) with Review-backfill-unchanged assertions (`:1242`); `matchedScenarioKeys` units (`feature-check.test.ts:3350`). Fresh in-workspace runs this turn: task-record **87 pass / 0 fail** (204 expects), feature-check **110 pass / 0 fail** (523 expects). |
| R3 | MET | Carry-forward blockquote re-read at `plugins/sp/skills/code-verification/SKILL.md:268-275` — Step 10, immediately after the Corrections note a standalone verifier reads; ratchet bump with dated comment at `plugins/sp/tests/skill-structure.test.ts:858-860` (30_488 → 31_203, +715B), skill-structure suite fresh **89 pass / 0 fail**. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Dropped-key test (`task-record.test.ts:1219`) asserts `scenarioWarnings` length 1 naming the scenario + feature id with `testingWritten: true` (exit-0 warn-only); service-level `RecordResult.scenarioWarnings` is the `--json` payload. Live: this re-record printed the parity warning on stderr via `bun run apps/cli/src/index.ts`, exit 0; `spur feature check D63 --json` → pass, 0 findings. |
| AC2 | MET | test | All six focused behaviors pass fresh this run: task-record 87/0, feature-check 110/0, skill-structure 89/0; biome check clean on the four changed source files. |
| AC3 | MET | test | `SKILL.md:268-275` Step 10 carry-forward block re-read (names the rule, the `L4.scenario-unverified` regression class, and the record-time warnings); `plugins/sp/tests/skill-structure.test.ts` ratchet pins the file at 31_203 with dated comment — fresh suite run **89 pass / 0 fail**. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review coordinator:** inline pipeline driver (super-planner), single-pass SECUA + traceability over the 8-file diff.

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | Process | `plugins/sp/tests/skill-structure.test.ts:858` | `code-verification` SKILL.md baseline bumped 30_488 → 31_203 (+715B) for the R3 Step-10 rule; ratchet convention honored with a split candidate noted (`references/verdict-schema.md`). |
| P4 | Quality | `apps/cli/src/commands/task.ts:1242` | Scenario warnings print to stderr in both human and `--json` modes — deliberate: R1's "warn loudly on stderr" is unconditional and stdout JSON stays machine-clean. Diverges from the human-mode-only gating of the updateSection precedent. |
| P4 | — | — | No P1–P3 findings. |

**Traceability (R{n} → evidence):**

- R1 → `packages/app/src/services/task-service.ts:1359` (`checkScenarioKeyRegression`) wired into `record()` before the Testing overwrite (`:1478`); matching owned by exported pure `matchedScenarioKeys` (`packages/app/src/services/feature-check.ts:1254`, built on `rowMatchesScenario` + shared `indexScenarioAliases` — no second normalization); MET-rows-only per Q&A; two exit-0 warnings (per dropped key naming it; no-match parity mirroring the 0700 R3 wording); surfaced via `RecordResult.scenarioWarnings` (`task-record.ts:84`) → CLI stderr + `--json` (`apps/cli/src/commands/task.ts:1242`). MET.
- R2 → `packages/app/tests/services/task-record.test.ts:1188` — five cases (dropped-key warns+names scenario / preserved-key silent / MET-only / no-feature_id silent / no-match parity) plus Review-backfill-unchanged assertions; `feature-check.test.ts:3350` — title/prefix/bracket/alias + MET-filter + empty-input units. 87 + 110 + 125 in-workspace tests pass. MET.
- R3 → `plugins/sp/skills/code-verification/SKILL.md:269` — Step 10 scenario-key carry-forward block where a standalone `--force` re-verifier reads it. MET.

**Design conformance:** `resolveFeatureAcBody` extraction is behavior-preserving (subset-warning tests green); UNKNOWN-verdict authored-Testing preservation and Review `sectionIsBare` fallback untouched; no FSM/gate/verdict-schema change; no new CLI noun/verb; warn-only never blocks the write.

**Residual risk:** warn-only by design — a deliberate re-key still lands (Q&A accepted; refusal mode is additive later). The record-time guard resolves the feature via `<tasksDir>/../features` prefix scan, same reach as the existing subset warning.

**Disposition:** approved for verify.

### References

- `packages/app/src/services/task-service.ts:1339` — `record()` seam; `:1343-1344` previous-document parse; `:1362-1367` Testing re-transcription; `:1282` `checkAcSubsetWarning` feature-resolution precedent (`:1291-1300` prefix-scan); `:853-855`, `:1221-1224` warnings-spread surfacing precedent.
- `packages/app/src/services/task-record.ts:84` — `RecordResult`; `./task-record` exports `parseTesting` (consumer precedent `feature-check.ts:44`).
- `packages/app/src/services/feature-check.ts:1206` — `rowMatchesScenario`; `:1237` `verdictRowsMatchScenarios` (any-match warning precedent, barrel-exported `packages/app/src/index.ts:216`); `:792-797` scenario alias indexing; `:910-925` the 0700 R3 verdict-time warning this task mirrors; `:951-975` `isScenarioVerified` (PASS + MET-row semantics).
- `packages/app/tests/services/task-record.test.ts:712` — `svc.record()` test precedent.
- `.spur/run/0921-verdict.json` — the restored scenario-key row (`R4 — Task optimization earns promotion`) whose initial loss motivated this task; session evidence: `spur feature check D63 --json` 1 finding → 0 findings after restore.
- `plugins/sp/skills/code-verification/SKILL.md` Step 10 — documentation owner for the carry-forward rule (R3).

### History

- 2026-09-23T23:46:35.664Z backlog → todo (system)
- 2026-09-24T01:25:16.434Z todo → wip (system)
- 2026-09-24T01:37:48.097Z wip → testing (system)
- 2026-09-24T01:37:48.381Z testing → done (system)

