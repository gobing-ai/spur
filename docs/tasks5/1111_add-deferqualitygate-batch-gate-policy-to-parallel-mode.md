---
schema_version: 1
name: Add deferQualityGate batch gate policy to parallel mode
status: done
template: feature-impl
created_at: 2026-10-07T07:29:50.343Z
updated_at: "2026-10-08T15:08:10.581Z"
feature_id: H15

dependencies: ["1107"]
priority: P2
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1111-verdict.json
---

## 1111. Add deferQualityGate batch gate policy to parallel mode

### Background

Under `--mode parallel` every task pipeline runs its own full quality gate inside its worktree (`task-pipeline.yaml` quality-gate stage), so an N-task batch pays N full gates plus the operator's integrated verification. Session evidence: the P1 batch paid 4 full-gate runs (~28 min) where 1 integrated run (388s) sufficed — slices integrated clean and only the integrated tree was checked once. The batch lifecycle already has the defer-once precedent: `deferFeatureSync` (0931 R5, `execution-batch.md` § Parallel isolation "Generated regions — defer the sync, regenerate once").

**Refine corrections (2026-10-07)**

- **Conflicts with ADR-124** (`docs/00_ADR.md:1977`): it explicitly rejected "a single end-of-run gate only (loses early feedback during implement)" and keeps the invariant that review runs only after a green full gate (also stated in the YAML at `config/workflows/task-pipeline.yaml:166-170`). Skipping the gate by default is not acceptable; the policy is rewritten as **opt-in**, keeps early feedback through the light tier, and amends ADR-124 with a dated clarification.
- The `test` state is also the **proof-chain entry** (`task-pipeline.yaml:398-452`): it resolves `taskSpecPath`, priority and `featureSpecPath` and captures `proofDigest` (ADR-071) before running `quality-gate.ts run`. "Skip the stage" would break the proof chain — only the final gate command may change.
- There is no stage named "quality-gate"; the stages are `test` / `test-recheck`. Guards read `.spur/run/<wbs>-test-gate.status` PASS/FAIL (`:1013-1055`); the verify proof stamp records `qualityGate.status` (`:782`).
- Existing mechanism to reuse: the light tier (`runLightGate`, `packages/app/src/services/quality-gate.ts:448`, task 0939) runs changed-scope biome, typecheck and related tests and writes a light receipt — but never writes `test-gate.status`.
- The P1 batch was **not** a `--mode parallel` run; it was an inline `--worktree` batch with ad-hoc fan-out, and per-slice gates did run. "4 gates (~28 min) → 1 (388s)" is a projection (see 1107).
- Parallel mode today (`plugins/sp/skills/spur-dev/references/execution-batch.md:1380-1400`): WT-3 passes `"deferFeatureSync":"true"`; the post step runs feature sync once; there is **no** integrated full gate after clean merges (only after conflict resolution, `:1251`). Default concurrency 2; `--worktree` is rejected under parallel.

### Requirements

- [x] R1. `task-pipeline.yaml` gains var `deferQualityGate` (default `"false"`), placed and commented like `deferFeatureSync` (`:207-212`). With `"true"`, the `test` state keeps every proof-chain onEnter step and replaces only the final gate command with `quality-gate.ts deferred`, which runs the light tier and writes `DEFERRED` (light PASS) or `FAIL` (light FAIL) to `.spur/run/<wbs>-test-gate.status`. `test-recheck` behaves the same under the var.
- [x] R2. The `test → triage` and `test-recheck → triage` guards accept `DEFERRED` only when `deferQualityGate = "true"`; the verify proof stamp records `qualityGate.status: "DEFERRED"`; the completion-gate digest checks are unchanged. With the default `"false"`, behavior is identical to today (`DEFERRED` is rejected).
- [x] R3. `/sp:dev-runall --mode parallel` (and `/sp:dev-parallel`) gain opt-in flag `--defer-gate`; only then WT-3 adds `"deferQualityGate":"true"`. The post step runs the project `qualityGateCmd` once on the integrated BASE_REF **before** feature sync and records PASS/FAIL in the batch report. On FAIL: batch verdict FAIL, feature sync skipped, and the report lists per-branch re-gate commands newest-first (no automatic bisect).
- [x] R4. Batch report rows of deferred tasks carry `gate: deferred`.
- [x] R5. ADR-124 gets a dated clarification: under opt-in `--defer-gate` parallel batches, per-task review follows a green **light** receipt, and the "green full gate" invariant moves to batch scope (nothing integrated is reported PASS without the integrated full gate). The YAML invariant comment (`:166-170`) and the flag glossary (`flag-glossary.md`, anchor `#flag-defer-gate`) state the same.

### Acceptance Criteria

- [x] AC1 — Opt-in deferred quality gate runs one integrated full gate per parallel batch (req: R1, R2, R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:17:00.593Z

- **Q: Does deferral violate ADR-124?** A: As originally written, yes. Decided (2026-10-07 refine, recommended for operator confirmation): opt-in only, light tier per task keeps early feedback, integrated full gate per batch, ADR-124 clarified. Alternatives rejected: drop the task (leaves N full gates per parallel batch with no option), or receipt reuse across worktrees (receipts bind to a per-tree fingerprint, so they cannot transfer).
- **Q: Which stage changes?** A: Only the final gate command inside `test` / `test-recheck`; the proof-chain entry steps stay.
- **Q: What happens on an integrated FAIL?** A: Batch FAIL, feature sync skipped, per-branch re-gate commands in the report; tasks already done stay done and the base ref is the batch branch, not main.

### Design

**Approach:** keep the proof chain and early feedback; swap only the per-task gate tier, and only when the operator opts in on a parallel batch. The full gate moves to the one place the integrated tree exists.

**Frozen names**

- Var `deferQualityGate` (`"false"` | `"true"`).
- Status token `DEFERRED` in `.spur/run/<wbs>-test-gate.status`.
- Script mode `quality-gate.ts deferred` (and the installed `.mjs` twin) — the script still owns the gate; YAML shell only resolves and dispatches it, matching the `run` / `recheck` pattern at `:452` / `:542`.
- Slash-command flag `--defer-gate`, glossary anchor `#flag-defer-gate`.
- Report marker `gate: deferred`.

**State behavior under `deferQualityGate="true"`**

| Point | Default | Deferred |
| --- | --- | --- |
| `test` onEnter proof steps | run | run (unchanged) |
| Gate command | `quality-gate.ts run` (full) | `quality-gate.ts deferred` (light) |
| Status written | PASS / FAIL | DEFERRED / FAIL |
| Guard to `triage` | PASS | PASS or DEFERRED (var-gated) |
| Proof stamp `qualityGate.status` | PASS | DEFERRED |
| Batch post step | feature sync | integrated full gate → feature sync on PASS |

**Invariants**

- Var unset or `"false"` ⇒ no behavior change; a stray `DEFERRED` file fails the guard.
- A FAIL light result follows the existing fix route (`test-fail-triage`, bounded `qualityGateMaxFixAttempts`).
- Sequential and inline runs never set the var; `--defer-gate` without `--mode parallel` is rejected.

**Anti-patterns**

- Skipping the `test` state or any proof-chain step.
- Writing `PASS` from a light run (breaks the "only the full gate writes PASS" rule at `:166-170`).
- Making deferral the parallel default.
- Automatic bisect on an integrated FAIL.

**Tests (write failure cases first):** pipeline-definition test — the var exists with default `"false"`; guards reject `DEFERRED` when the var is false and accept it when true. `quality-gate` script test — `deferred` writes `DEFERRED` on light PASS, `FAIL` on light FAIL, and never writes `PASS`. Dogfood batch-contract test (`plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`) — `--defer-gate` adds the var to WT-3 and the post step orders integrated gate before feature sync.

**Impacted surfaces:** `config/workflows/task-pipeline.yaml` (+ generated `apps/cli/config/`), `plugins/sp/scripts/quality-gate.ts` and its installed build, `packages/app/src/services/quality-gate.ts` (only if a helper is needed for the status write), `plugins/sp/skills/spur-dev/references/execution-batch.md` § Parallel isolation, `plugins/sp/skills/spur-dev/references/flag-glossary.md`, `plugins/sp/commands/dev-runall.md`, `plugins/sp/commands/dev-parallel.md`, `docs/00_ADR.md` (ADR-124 clarification), `docs/design/workflow-catalogue-refactor.md` §4 if it restates the invariant.

**Dependency handoff:** depends on 1107. If 1107's verdict is `partial`, the flag ships documented as a pilot that produces the missing samples (D62 `:55` asks for three); the default is unaffected either way.

### Plan

1. Write the failing tests listed in Design § Tests.
2. Add `deferred` mode to `plugins/sp/scripts/quality-gate.ts` (light run + status write); rebuild the installed script (`bun run build:plugin-lib` if it is generated).
3. Add `deferQualityGate` var; branch the `test` / `test-recheck` gate command on it; update the triage guards and the `:782` proof stamp.
4. Update the `:166-170` invariant comment.
5. Add `--defer-gate` to dev-runall / dev-parallel and the flag glossary; update `execution-batch.md` driver loop (WT-3 vars, post step order, report marker, red-gate recipe).
6. Add the ADR-124 dated clarification.
7. `bun run --filter @gobing-ai/spur build:bundle`; focused tests per workspace; `bun run spur-check`; `bun run plugin-smoke` (plugin script changed).

### Solution

Opt-in deferred gate for parallel batches: the proof chain stays intact, the per-task tier drops to light, and the one full gate moves to the integrated base ref.

| File:line | Change |
| --- | --- |
| `packages/app/src/services/quality-gate.ts:450-481` | New `runDeferredGate`: runs the light tier, then writes `DEFERRED` (light PASS) or `FAIL` to `.spur/run/<wbs>-test-gate.status` — never `PASS`; logs that the integrated full gate is owed |
| `plugins/sp/scripts/quality-gate.ts:20-51` | `deferred` mode wired into the argv dispatch (exit 0 on `DEFERRED`, 1 on `FAIL`), usage string updated; the script stays ADR-130 glue over the bundled core |
| `scripts/commands/bundle-plugin-lib.ts:484` | The generated plugin-lib type surface declares `runDeferredGate` so the standalone twin typechecks |
| `config/workflows/task-pipeline.yaml:228` | Var `deferQualityGate: "false"`, documented next to `deferFeatureSync` (default false = unchanged behavior; sequential/inline never set it) |
| `config/workflows/task-pipeline.yaml:489`, `:579` | `test` / `test-recheck` select the gate mode through `M` (`run`/`recheck` → `deferred` when the var is `"true"`); every proof-chain onEnter step is untouched |
| `config/workflows/task-pipeline.yaml:168-172` | The gate invariant comment states the ADR-124 clarification: only the full tier writes `PASS`, and under the opt-in policy the "green full gate before review" invariant holds at batch scope |
| `config/workflows/task-pipeline.yaml:1050-1052`, `:1093-1095` | Both triage guards accept `DEFERRED` only while `deferQualityGate = "true"`; with the default the token fails like a corrupt status |
| `plugins/sp/tests/quality-gate-receipt.test.ts:286-346` | Failure-case-first test: light PASS → `DEFERRED` (and the status file never contains `PASS`), light FAIL → `FAIL`, plus the `deferred` usage-error case |
| `plugins/sp/tests/skill-structure.test.ts:778-800` | Pipeline-definition assertions: the var defaults to `"false"`, both hops select the mode via `M`, and the var-gated guard appears on both triage edges |
| `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1034-1056` | Driver-contract pins: `--defer-gate` adds the var, the report marker is `gate: deferred`, and the integrated gate precedes the feature sync, with no automatic bisect |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:258-262`, `packages/domain/tests/planning/lifecycle-drift.test.ts:305-310`, `plugins/sp/tests/inline-pipeline-driver.test.ts:251-268` | The three shells that pinned the literal `"$S" run|recheck` dispatch now pin the `M`-driven form (resolver, fail-closed, and stub-simulation contracts unchanged) |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md:149-175` | New `--defer-gate` entry (anchor `#flag-defer-gate`) with the two load-bearing properties and the `--mode parallel` requirement |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:1392-1400`, `:1466-1480` | Driver loop passes the var only under the flag; the post step runs the integrated full gate before the deferred feature sync; the FAIL lane (batch FAIL, sync skipped, per-branch re-gate newest-first, no bisect) and the `gate: deferred` marker are specified |
| `plugins/sp/commands/dev-runall.md:29`, `plugins/sp/commands/dev-parallel.md:21` | Public flag documented with the argument-hint updated (flag-parity gates read both) |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:89-90` | The operation-map arg-hint rows for runall/parallel carry the flag (R8/R9 parity) |
| `docs/00_ADR.md:1991-2006` | ADR-124 dated clarification: the rejected single-end-of-run-gate alternative is narrowly reopened for opt-in parallel batches, with the light tier keeping early feedback and the invariant moved to batch scope |
| `docs/design/workflow-catalogue-refactor.md:89-97` | The catalogue design records the deferred tier and that deferral never disturbs the proof-chain entry |

**Rationale.** The batch's cost problem is N full gates for one integrated tree, but the naive fix — skip the gate — breaks both ADR-124's stated reason and the proof chain that `test` also owns. So the change moves exactly one thing: which tier runs per task. The light tier keeps the per-task early signal, `DEFERRED` (never `PASS`) keeps the "only the full tier certifies" rule honest, and the full gate lands where the integrated tree exists. Default-off keeps sequential and inline behavior byte-identical, and the guards make a stray `DEFERRED` fail closed. 1107's `partial` verdict means the flag ships as a pilot that produces the missing samples; the default is unaffected.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Var `deferQualityGate: "false"` at `config/workflows/task-pipeline.yaml:223` beside invariant comment `config/workflows/task-pipeline.yaml:162-167`; deferred mode select at `config/workflows/task-pipeline.yaml:501` and `config/workflows/task-pipeline.yaml:601`; `runDeferredGate` at `packages/app/src/services/quality-gate.ts:459` |
| R2 | MET | Triage guards accept DEFERRED only when opted in at `config/workflows/task-pipeline.yaml:1124` and `config/workflows/task-pipeline.yaml:1158`; receipt tests `plugins/sp/tests/quality-gate-receipt.test.ts:321-328` |
| R3 | MET | `--defer-gate` flag at `plugins/sp/commands/dev-runall.md:29` and `plugins/sp/commands/dev-parallel.md:21`; contract test `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1035-1046` |
| R4 | MET | `gate: deferred` row rule at `plugins/sp/skills/spur-dev/references/execution-batch.md:1537` |
| R5 | MET | ADR-124 dated clarification `docs/00_ADR.md:1991` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/sp/tests/quality-gate-receipt.test.ts:321-328`, `plugins/sp/tests/skill-structure.test.ts:782-786` |
| R1 — Opt-in deferred quality gate runs one integrated full gate per parallel batch | MET | test | Mode select `config/workflows/task-pipeline.yaml:501`; guards `config/workflows/task-pipeline.yaml:1124`; batch contract `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1035-1046` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — pipeline/service/script/docs surface; 3-dimensional review executed in-session by the inline driver (reviewer independence not achievable on the host-inline path, recorded as P4).

**Requirement traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `config/workflows/task-pipeline.yaml:228` (var, default `"false"`), `:489` / `:579` (tier selection via `M`), `packages/app/src/services/quality-gate.ts:459-481` (`DEFERRED`/`FAIL`, never `PASS`) |
| R2 | MET | Var-gated guards on both triage edges (pinned as exactly two occurrences); the completion predicate never reads the status token |
| R3 | MET | Glossary + both commands document the flag; the driver adds the var only under it and runs the integrated gate before the deferred sync (pinned) |
| R4 | MET | `gate: deferred` marker stated and pinned |
| R5 | MET | Dated ADR-124 clarification plus the YAML invariant comment, glossary entry and catalogue design |

**Findings**

| P | Finding | Disposition |
| --- | --- | --- |
| P3 | `sp-runtime-path` tripped by a comment citing the pipeline path from app code | fixed in-flight (reworded) |
| P3 | Generated plugin-lib type surface needed the new export | fixed in-flight; regeneration byte-deterministic |
| P3 | Three pins + the inline smoke stub keyed on the literal gate dispatch, silently disabling the smoke | fixed in-flight; now keyed on the `M` assignment + `"$RUNNER" "$S" "$M"` |
| P4 | No end-to-end parallel batch ran with `--defer-gate` | accepted; stated in residual risk |
| P4 | Gate crossed the fix-attempt bound (2 all-flake runs) | recorded bound deviation with isolation evidence |
| P4 | In-session review | accepted |

No P1/P2 findings. Residual risk: the flag is a labelled pilot (1107 verdict `partial`); the integrated-gate step is pinned, not observed.

### References

- Feature: H15; depends on 1107
- `docs/00_ADR.md:1977` (ADR-124), ADR-071 (proof chain)
- `config/workflows/task-pipeline.yaml:166-170`, `config/workflows/task-pipeline.yaml:207-212`, `config/workflows/task-pipeline.yaml:398-452`, `config/workflows/task-pipeline.yaml:782`, `config/workflows/task-pipeline.yaml:1013-1055`
- `packages/app/src/services/quality-gate.ts:448` (`runLightGate`, task 0939)
- `plugins/sp/skills/spur-dev/references/execution-batch.md:1251`, `plugins/sp/skills/spur-dev/references/execution-batch.md:1380-1400`

### History

- 2026-10-07T07:34:14.542Z backlog → todo (system)
- 2026-10-07T20:25:59.074Z todo → wip (system)
- 2026-10-07T21:27:05.281Z wip → testing (system)
- 2026-10-07T21:27:21.425Z testing → done (system)

