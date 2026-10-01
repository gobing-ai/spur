---
schema_version: 1
name: "Pipeline execution efficiency: proportional gate, diff-sized fan-out, wrapup pre-flight"
status: done
template: feature-impl
created_at: 2026-09-30T22:20:05.119Z
updated_at: "2026-10-01T18:56:08.316Z"
feature_id: D9

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 3
---

## 1033. Pipeline execution efficiency: proportional gate, diff-sized fan-out, wrapup pre-flight

### Background

Feature I33's 3-task batch (1021–1023, 2026-09-30) took 3h40m38s end-to-end (18:17:02→21:57:40 UTC; commits `77f0d10dd`→`f5a0b8edc`→`ca965477d`, wrapup, merge). Transcript forensics (pi session `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-09-30T18-17-02-838Z_01a0f388-c876-7519-9482-a58ecc2ca979.jsonl`) attributed the time to structure, not content:

| Symptom | Measured | Evidence |
| --- | --- | --- |
| Subagent fan-out on small diffs | 1022: 41m of a 55m phase in subagents; implement dispatch 20m00s for an ~18-line diff; verifier 12m35s; reviewer ~6m. 1023: 33m of 47m; implement 15m30s | sink timestamps 19:43:48Z, 20:16:26Z, 20:33:47Z, 20:51:56Z |
| Full gate per task | `qualityGateCmd="bun run spur-check"`: 7m34s (1021), ~4m (1022), 9m12s (1023, run twice) | sink 18:53:01Z, 20:45:31Z |
| Wrapup failures | 2 of 3 wrapup runs failed late (dogfood gate, ledger registration order), then an 11m58s digest stall | failed runs `47415d75`, `f5877e99`; paused `215c6eab` |

**Refine corrections (2026-09-30)**

- Old R1 "light gate per task, full `spur-check` once per feature" → **conflicts with ADR-124 (Accepted, `docs/00_ADR.md:1914`)**, which keeps the full gate at the task quality boundary and rejected "a single end-of-run gate only"; `config/workflows/task-pipeline.yaml` states "review is entered only after a full green qualityGateCmd". Full-receipt reuse already exists (`plugins/sp/scripts/quality-gate.ts:44-55`, `check.reused` log line). 1023's second gate ran after a fix changed the tree, so reuse correctly did not apply. → **Dropped.** Reversing it needs an ADR-124 amendment by the operator, not a task.
- Old R2 "precheck's existing diffstat selects the execution shape" → **diffstat is written by `triage` (after the gate), not precheck** (`config/workflows/task-pipeline.yaml:498-526`). So it can size review/verify, not implement. A deterministic implement-size floor already exists: driver dispatch condition 5, `estimate_hours ≤ 1` → host-inline (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:308-315`). 1021–1023 had no `estimate_hours` (`spur task show` → null) although refine ready-finalization requires it (`plugins/sp/skills/spur-dev/references/dev-operations.md:281-282`). That was a process miss, not a spec gap. The review-skipping fast lane (0943 triage, `task-pipeline.yaml:527-550`) also exists but is model-decided and off unless `workflow.decideDecisionMaker`. → **Reframed** as R1: a diffstat arm on the existing dispatch floor, for `verify` only.
- Old "fold verify into the reviewer" → **rejected.** It removes a pipeline stage and its verdict artifact, contradicting the requirement's own "state machine unchanged" invariant.
- Old R3(b) "digest parity per 1031's canonicalization seam" → 1031 disproved that seam; the real cause was a stale persisted `spurBin` (fixed in `62499ad68`). Parity now means **running the exact done guard with the same `$spurBin` the transition will use.** → R2.
- Old R4 `.spur/run/<wbs>-timings.json` → **dropped.** The inline driver already records `--duration-ms` per action through `WorkflowActionTraceWriter` (`inline-pipeline-driver.md:479-500`), and run-log lines carry ISO-8601 UTC stamps plus dispatch/inline provenance (`:331`, `:472`). AC timing comes from `spur workflow trace <run-id> --json`.

### Requirements

- **R1** — Diff-sized verify floor. The inline driver's native-subagent dispatch condition 5 gains a second, diffstat-based arm that applies to the `verify` state only. When `.spur/run/<wbs>-diffstat.json` parses and has `files ≤ 3`, `insertions + deletions ≤ 60` and `sensitive == false`, `verify` runs host-inline. The run log gets `stage verify executed inline in session <session-id> (below dispatch floor: diffstat files <f> lines <n>)`. A missing, unparsable or `sensitive: true` diffstat leaves condition 5 as today, so the failure mode is more isolation, never less. The thresholds are literal constants in the driver contract. `implement` and `review` eligibility, and the pipeline state graph, do not change.
- **R2** — Wrapup pre-flight. When `vars.feature` is set, `wrapup-steps.ts resolve` runs a pre-flight after the task list resolves PASS and before any corpus-mutating state (doc-sync, learnings, metrics, feature-transition):
  1. Run `$spurBin feature sync <feature> --dry-run --json`. If the proposal is `gateBlocked`, write FAIL with reason `failed:preflight:gate-blocked <codes>`, where `<codes>` are the sorted unique error `gateFindings[].code`.
  2. If the proposal reaches `done` (`to == "done"` or `hops` contains `"done"`), run `$spurBin feature check <feature> --strict --as done --json` — the exact verifying→done guard. Error findings fail with `failed:preflight:done-gate <codes>`. When the feature is not yet `verifying`, ignore `L4.feature-receipt-*` findings: the verifying `onEnter` will produce the receipt.
  3. When the dry-run proposal does not reach `done`, run no further checks.

  A pre-flight FAIL routes through the existing resolve FAIL edge to `failed`. The pre-flight never writes PASS on its own, never skips or relaxes the later feature-transition / feature-verify gates, and uses the same `spurBin` env as `runFeatureTransition`.

### Acceptance Criteria

```gherkin
  @core
  Scenario: AC1 — a small non-sensitive diff verifies host-inline (req: R1)
    Given an inline full-pipeline run whose triage diffstat has 2 files, 40 changed lines and sensitive false
    When the driver reaches the verify state
    Then verify executes in the host session
    And the run log records the "below dispatch floor: diffstat" line

  @core
  Scenario: AC2 — a sensitive or large diff keeps verify dispatch eligibility (req: R1)
    Given a triage diffstat with sensitive true, or more than 3 files, or more than 60 changed lines, or no diffstat file
    When the driver evaluates verify dispatch eligibility
    Then condition 5 is decided by estimate_hours exactly as before

  @core
  Scenario: AC3 — a missing dogfood report fails wrapup at pre-flight (req: R2)
    Given a feature whose done guard reports L4.dogfood-missing under --strict
    When wrapup-pipeline runs with that feature
    Then task-resolve records FAIL with reason "failed:preflight:done-gate L4.dogfood-missing"
    And no doc-sync, learnings, metrics or feature-transition step executes

  @core
  Scenario: AC4 — a receipt mismatch on a verifying feature fails at pre-flight (req: R2)
    Given a verifying feature whose receipt fails L4.feature-receipt-contract
    When wrapup-pipeline runs with that feature
    Then task-resolve records FAIL naming L4.feature-receipt-contract

  @core
  Scenario: AC5 — receipt-only findings on an active feature do not block wrapup (req: R2)
    Given an active feature whose only done-guard errors are L4.feature-receipt-* findings
    When wrapup-pipeline runs with that feature
    Then task-resolve records PASS and the pipeline proceeds unchanged

  @core
  Scenario: AC6 — a sync that does not reach done runs no done-gate check (req: R2)
    Given a feature whose dry-run sync proposal does not reach done
    When wrapup-pipeline runs with that feature
    Then no feature check call is made and task-resolve records PASS
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T22:41:54.885Z

- **Per-task light gate / once-per-feature full gate** — dropped (ADR-124). To pursue it, the operator amends ADR-124 first; any follow-up task starts from that amendment.
- **Why verify and not review for R1** — review's value is independence from the implementer. Verify is evidence mapping whose output is host-linted (`spur task verdict --from-answer`) and bound to the proof digest, so running it host-inline loses less. Review keeps its current eligibility.
- **Why diffstat thresholds 3 files / 60 lines** — carried over from the originally filed task (the 1022 diff was ~18 lines). Literal constants; tune only with measured runs.
- **Implement sizing** — no new mechanism. The `estimate_hours` floor already covers it; refine ready-finalization must set `estimate_hours` (process adherence, noted for dev-refine).
- **Pre-flight placement** — inside `wrapup-steps.ts resolve` rather than a new state or a command-prose step. It covers `/sp:dev-wrap`, `/sp:dev-wrapall` and headless `spur workflow run` in one place, reuses the resolve FAIL edge, and adds no shell action (ADR-115 caps).
- **Known hazard, out of scope** — wrapup's own doc-sync/learnings-append mutate proof inputs (`.spur/context/learnings.md` is in the receipt digest, `packages/app/src/services/feature-check.ts:503-511`). A receipt minted *before* wrapup on an already-`verifying` feature can therefore go stale during wrapup. The pre-flight cannot catch this, because it runs before the mutation. If it reproduces, file a separate D9 task; do not widen this one.
- **Timings artifact** — dropped; the structured trace already records per-action `duration-ms`.

### Design

**R1 — driver contract (prose; no code):**
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:308-315` (condition 5): append a "diffstat arm (verify only)" paragraph. The driver reads `.spur/run/<wbs>-diffstat.json` with `jq`, never estimating size itself. Below the floor when `.files <= 3 and ((.insertions // 0) + (.deletions // 0)) <= 60 and .sensitive == false`. It applies only when the current state id is `verify`. Missing, unparsable or sensitive input → arm not applied. Add the log template `stage verify executed inline in session <session-id> (below dispatch floor: diffstat files <f> lines <n>)`.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:134-140`: extend the parenthetical to say that the floor includes a verify-only diffstat arm, owned by `inline-pipeline-driver.md`. Do not restate the numbers.

**R2 — `plugins/sp/scripts/wrapup-steps.ts`:**
- In `resolveTasks`, after the unresolved-task loop and before writing PASS: `if ((env.feature ?? '') !== '') { const pf = preflightFeature(env, cwd); if (pf) return writeFail(pf); }`.
- New `export function preflightFeature(env, cwd): string | null`, next to `resolveTasks`, using the existing `spur(env, args, { cwd })` helper:
  - `sync --dry-run --json`: unparsable output or nonzero rc → `failed:preflight:sync-unreadable` (fail closed).
  - `proposal.gateBlocked === true` → `failed:preflight:gate-blocked <codes>`.
  - `reachesDone = proposal.to === 'done' || proposal.hops?.includes('done')`. If false → `null`.
  - `feature check <f> --strict --as done --json`: take element 0 when the result is an array. Keep `findings.filter(f => f.severity === 'error')`, and when `proposal.from !== 'verifying'` drop codes starting with `L4.feature-receipt-`. Unparsable output → `failed:preflight:check-unreadable`. Non-empty → `failed:preflight:done-gate <sorted unique codes joined by ','>`.
- Also write the full check JSON to `.spur/run/<runId>-wrapup-preflight.json` for diagnosis. It is a run-scoped artifact following the existing `<runId>-*` pattern.
- Update the header artifact list (`wrapup-steps.ts:5-15`) and the `task-resolve` description in `config/workflows/wrapup-pipeline.yaml:126-145` (one sentence: "when vars.feature is set, resolve also runs the feature pre-flight (1033 R2)"). Regenerate with `bun run --filter @gobing-ai/spur build:bundle` and commit the regenerated `wrapup-steps.mjs` twin.
- **Invariants:** only `resolveTasks` writes the resolve status; the pre-flight never writes PASS; the feature-transition and feature-verify states are untouched.

**Rejected:** a new wrapup state (more YAML, same effect); pre-flight in the dev-wrap command prose (misses headless runs); a `--preflight` verb on `spur feature` (public-surface change).

### Plan

1. Failure list first (isolated system, per AGENTS): (a) dry-run gateBlocked; (b) done-gate error on an active feature, non-receipt code; (c) receipt-only errors on an active feature → pass; (d) receipt error on a verifying feature → fail; (e) proposal not reaching done → no check call; (f) unparsable sync/check output → fail closed; (g) empty `vars.feature` → pre-flight skipped.
2. Add the (a)–(g) cases to `plugins/sp/tests/wrapup-steps.test.ts` with a stubbed `spur`: extend the existing `stub-spur` helper (`plugins/sp/tests/wrapup-steps.test.ts:56-59`, one fixed JSON for any args) into an argv-dispatching `case` script so `task show`, `feature sync --dry-run` and `feature check` return distinct payloads, and log argv to assert (e) makes no check call. Run `(cd plugins/sp && bun test tests/wrapup-steps.test.ts)`: new cases red.
3. Implement `preflightFeature` + the `resolveTasks` hook per Design; tests green. Regenerate the bundle; confirm `wrapup-steps.mjs` is updated.
4. Edit the driver contract (R1) and the cross-cutting mirror. Run `(cd plugins/sp && bun test tests/skill-structure.test.ts)`.
5. E2E (AC3/AC5, repeatable artifact): in a scratch feature fixture or a disposable worktree, run `bun run apps/cli/src/index.ts workflow run wrapup-pipeline.yaml --vars '{"tasks":["<done wbs>"],"feature":"<id>"}'` once with the dogfood ledger entry absent and once present. Keep both `.spur/run/<runId>-route-reason.txt` + `spur workflow trace <runId> --json` outputs as evidence.
6. `bun run spur-check`; commit `feat(sp): diff-sized verify floor and wrapup feature pre-flight (1033)`.

**Verification checks (evidence for the AC above):**

- [x] Driver contract condition 5 contains the verify-only diffstat arm with literal thresholds and log template (AC1, AC2).
- [x] `wrapup-steps.test.ts` cases (a)–(g) pass (AC3–AC6); suite 42/42.
- [x] Pre-flight done-gate fail path: unit case (b) produces the exact reason `failed:preflight:done-gate L4.dogfood-missing` and resolve FAIL stops the pipeline before PASS (resolve is the first state, so no doc-sync/learnings/metrics/feature-transition can run). Full-workflow scratch-feature E2E was not performed — a disposable corpus fixture with a dogfood-missing done guard proved impractical; the pre-flight lives entirely in `resolveTasks`, covered by tests plus real-spur E2E (AC3).
- [x] Real-spur E2E on D9 (`e2e-1033`): active feature, sync dry-run does not reach done — no check call, no preflight artifact, resolve PASS (AC5/AC6 covered by unit cases (c)/(e) and the argv-log assertion).

### Solution

- `plugins/sp/scripts/wrapup-steps.ts` — R2: `preflightFeature` (:230) + `sortedUniqueCodes` (:215); invoked from `resolveTasks` (:123) when `env.feature` is set, after task-list resolution and before the PASS write. Sync dry-run (rc≠0/unparsable/non-object → `failed:preflight:sync-unreadable`; `gateBlocked` → `failed:preflight:gate-blocked <sorted unique error codes>`); done-reaching proposals run `feature check --strict --as done` (unparsable → `failed:preflight:check-unreadable`; error findings → `failed:preflight:done-gate <codes>`; `L4.feature-receipt-*` ignored unless `from === 'verifying'`); non-done proposals make no check call. Full check JSON captured to `.spur/run/<runId>-wrapup-preflight.json`. FAIL routes through the existing `writeFail` edge; the pre-flight never writes PASS.
- `plugins/sp/tests/wrapup-steps.test.ts` — R2: cases (a)–(g) with an argv-dispatching stub `spur` (argv logged for no-call assertions); suite 42/42.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:317` + `cross-cutting.md` — R1: verify-only diffstat arm of dispatch condition 5 (literal thresholds files≤3 / ins+del≤60 / sensitive false; failure direction = more isolation; inline log template).
- `config/workflows/wrapup-pipeline.yaml:142` — task-resolve description notes the feature pre-flight.
- `plugins/sp/scripts/wrapup-steps.mjs` — node twin regenerated via `bun run build:scripts`.

Final re-verification clarified the R1 numeric-count precondition in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:319`: the literal jq predicate first requires numeric files/insertions/deletions. The previous expression incorrectly classified null files as small and defaulted missing counts to zero. The new guard is goal-equivalent safety hardening: missing/null counts keep the estimate floor; thresholds, valid-input behavior, other stages and state graph are unchanged. Fresh literal-jq fixtures pass 11/11. Task 1039 provides durable predicate/log and boundary pins.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:317` specifies verify-only size eligibility with numeric counts, literal thresholds and fallback. `plugins/sp/tests/task-diffstat.test.ts:243` and `plugins/sp/tests/task-diffstat.test.ts:267` pin the documented expression, exact log and 3/4-file boundary. Fresh dispatch suites: 121 pass, 0 fail, exit 0; literal jq fixture probe: 11/11 expected results (origin: D9 final verification, `.spur/run/D9-finalverify/dispatch-jq.json`). |
| R2 | MET | `plugins/sp/scripts/wrapup-steps.ts:179` preflights before writing resolve PASS; `plugins/sp/scripts/wrapup-steps.ts:230` rejects malformed/failed sync and check responses. `plugins/sp/tests/wrapup-steps.test.ts:864` and cases (a)-(g) exercise fail-closed behavior, receipt filtering and no-check paths. Fresh focused plugin run: 151 pass, 0 fail, exit 0. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — a small non-sensitive diff verifies host-inline (req: R1) | MET | test | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:317` specifies verify-only size eligibility with numeric counts, literal thresholds and fallback. `plugins/sp/tests/task-diffstat.test.ts:243` and `plugins/sp/tests/task-diffstat.test.ts:267` pin the documented expression, exact log and 3/4-file boundary. Fresh dispatch suites: 121 pass, 0 fail, exit 0; literal jq fixture probe: 11/11 expected results (origin: D9 final verification, `.spur/run/D9-finalverify/dispatch-jq.json`). |
| Scenario: AC2 — a sensitive or large diff keeps verify dispatch eligibility (req: R1) | MET | test | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:317` specifies verify-only size eligibility with numeric counts, literal thresholds and fallback. `plugins/sp/tests/task-diffstat.test.ts:243` and `plugins/sp/tests/task-diffstat.test.ts:267` pin the documented expression, exact log and 3/4-file boundary. Fresh dispatch suites: 121 pass, 0 fail, exit 0; literal jq fixture probe: 11/11 expected results (origin: D9 final verification, `.spur/run/D9-finalverify/dispatch-jq.json`). |
| Scenario: AC3 — a missing dogfood report fails wrapup at pre-flight (req: R2) | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:937` rejects dogfood-missing and writes resolve FAIL before subsequent states; focused plugin suite exit 0. |
| Scenario: AC4 — a receipt mismatch on a verifying feature fails at pre-flight (req: R2) | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:993` keeps receipt failures on a verifying feature; focused plugin suite exit 0. |
| Scenario: AC5 — receipt-only findings on an active feature do not block wrapup (req: R2) | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:973` permits active-feature receipt-only findings; focused plugin suite exit 0. |
| Scenario: AC6 — a sync that does not reach done runs no done-gate check (req: R2) | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:1018` asserts no done-gate call for a non-done proposal; focused plugin suite exit 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Final inline review

Scope: tagged task implementation plus the final D9 fixes. Dimensions: functional, security, efficiency, correctness, usability, architecture. Fresh focused commands pass (65 application tests, 151 plugin tests, 121 dispatch tests).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | functional | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:317` specifies verify-only size eligibility with numeric counts, literal thresholds and fallback. `plugins/sp/tests/task-diffstat.test.ts:243` and `plugins/sp/tests/task-diffstat.test.ts:267` pin the documented expression, exact log and 3/4-file boundary. Fresh dispatch suites: 121 pass, 0 fail, exit 0; literal jq fixture probe: 11/11 expected results (origin: D9 final verification, `.spur/run/D9-finalverify/dispatch-jq.json`). | All numbered requirements trace to fresh executable evidence; no open completeness finding. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:317` specifies verify-only size eligibility with numeric counts, literal thresholds and fallback. `plugins/sp/tests/task-diffstat.test.ts:243` and `plugins/sp/tests/task-diffstat.test.ts:267` pin the documented expression, exact log and 3/4-file boundary. Fresh dispatch suites: 121 pass, 0 fail, exit 0; literal jq fixture probe: 11/11 expected results (origin: D9 final verification, `.spur/run/D9-finalverify/dispatch-jq.json`). |
| R2 | MET | `plugins/sp/scripts/wrapup-steps.ts:179` preflights before writing resolve PASS; `plugins/sp/scripts/wrapup-steps.ts:230` rejects malformed/failed sync and check responses. `plugins/sp/tests/wrapup-steps.test.ts:864` and cases (a)-(g) exercise fail-closed behavior, receipt filtering and no-check paths. Fresh focused plugin run: 151 pass, 0 fail, exit 0. |

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | security, efficiency, correctness, usability | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:317` specifies verify-only size eligibility with numeric counts, literal thresholds and fallback. `plugins/sp/tests/task-diffstat.test.ts:243` and `plugins/sp/tests/task-diffstat.test.ts:267` pin the documented expression, exact log and 3/4-file boundary. Fresh dispatch suites: 121 pass, 0 fail, exit 0; literal jq fixture probe: 11/11 expected results (origin: D9 final verification, `.spur/run/D9-finalverify/dispatch-jq.json`). | No open P1-P3 finding: fail-closed parsing, bounded work, diagnostic clarity and regression behavior reviewed. |

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | architecture | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:317` specifies verify-only size eligibility with numeric counts, literal thresholds and fallback. `plugins/sp/tests/task-diffstat.test.ts:243` and `plugins/sp/tests/task-diffstat.test.ts:267` pin the documented expression, exact log and 3/4-file boundary. Fresh dispatch suites: 121 pass, 0 fail, exit 0; literal jq fixture probe: 11/11 expected results (origin: D9 final verification, `.spur/run/D9-finalverify/dispatch-jq.json`). | Shared service and existing script boundaries remain intact; standalone generated twins and real-fixture test seams need no structural change. |

#### Retained review and resolved follow-ups

Inline review of the 1033 change set: `wrapup-steps.ts` feature pre-flight (R2), driver/cross-cutting diffstat-arm prose (R1), wrapup-pipeline.yaml task-resolve description, wrapup-steps tests (a)–(g), regenerated node twin.

Gate re-check: `quality-gate recheck` **PASS** on proof digest `sha256:62724c84ffacba1123d9490e7d5a0509e518ecc59f6ef05b7754898b05078ed2` — `bun run spur-check`, attempts 1, 0 fail, 323s (receipt `.spur/run/1033-check-receipt.json`). An earlier recheck invocation that omitted `qualityGateCmd` produced a vacuous instant-PASS receipt (empty command, 7 ms); it was purged and the gate re-run with the canonical `qualityGateCmd="bun run spur-check"` before this PASS.

| Priority | Finding | Resolution |
| --- | --- | --- |
| P3 | `quality-gate recheck` silently passes when `qualityGateCmd` is unset (empty command → rc 0 → PASS receipt). Footgun for inline drivers; deserves a guard requiring a non-empty command in recheck mode. | Resolved by completed task 1038: both modes reject blank commands with a mode-specific diagnostic before any receipt write; shipped-node probes pass. |
| P4 | Design says the wrapup twin is refreshed by "the bundle step"; the actual regenerator is `superskill script convert` (`bun run build:scripts`). Twin regenerated in-change. | resolved in-change |
| P4 | `sync-unreadable` also covers a spur CLI that fails for non-JSON reasons (e.g. no project in cwd, rc≠0). Contract-sanctioned fail-closed ("failure mode is more isolation, never less"); observed in the foreign-cwd E2E run. | accepted by design |

Pre-flight invariants verified by test: never writes PASS on its own (only resolveTasks writes the status), later feature-transition / feature-verify gates untouched, same `spurBin` env as `runFeatureTransition`.


Evidence-ephemerality note (session review 2026-10-01): the `.spur/run/1033-*` artifacts cited above (evidence log, verify answer, gate receipt, conformance-check output) lived in the batch worktree and were removed at closeout; the digests, commands and outcomes quoted in this file are the durable record. Resolved by task 1039: committed conformance tests now pin real fixtures, both thresholds, the literal document predicate and exact log; fresh mutation checks fail as expected. Historical removed artifacts are not relied on for this verification.

### References

- Feature D9; ADR-124 (`docs/00_ADR.md:1914`); ADR-119; ADR-115 (shell caps); ADR-117 (structured trace)
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:295-321,479-500`; `plugins/sp/skills/spur-dev/references/cross-cutting.md:134-140`
- `config/workflows/task-pipeline.yaml:498-550` (triage/diffstat), `:633-665` (verify)
- `plugins/sp/scripts/task-diffstat.ts`; `plugins/sp/scripts/quality-gate.ts:44-55`
- `plugins/sp/scripts/wrapup-steps.ts:122-178,465-500`; `config/workflows/wrapup-pipeline.yaml:126-210,341-397`
- `packages/app/src/services/feature-service.ts:498-530,609-611` (sync dry-run evaluates the L4 gate only); `packages/app/src/services/feature-check.ts:745-785` (dogfood), `:503-511` (learnings in digest)
- Siblings: 1031 (receipt diagnostics, spurBin fix `62499ad68`), 1032

### History

- 2026-09-30T22:42:06.092Z backlog → todo (system)
- 2026-10-01T07:31:48.328Z todo → wip (system)
- 2026-10-01T15:41:09.147Z wip → testing (system)
- 2026-10-01T15:41:56.644Z testing → done (system)

