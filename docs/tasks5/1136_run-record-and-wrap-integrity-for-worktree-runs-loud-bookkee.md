---
schema_version: 1
name: "Run-record and wrap integrity for worktree runs: loud bookkeeping, fresh digests, scoped repair"
status: done
template: feature-impl
created_at: 2026-10-09T05:28:31.980Z
updated_at: "2026-10-09T20:48:28.801Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 12
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1136-verdict.json
---

## 1136. Run-record and wrap integrity for worktree runs: loud bookkeeping, fresh digests, scoped repair

### Background

**Origin.** Pipeline run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132, 2026-10-08, inline full pipeline, worktree) closed its task correctly but left three integrity defects in the harness that each cost wall-clock and, in one case, nearly certified the wrong tree.

**Defect 1 — the run's action trace silently did not land (93 rows, one refused close).** The run row was created by `inline-run-setup.ts` in the **invoking** tree `/Users/robin/xprojects/spur-new` — correct per the worktree contract (the WT-3 marker and the row live with the invoking tree). Every subsequent `--action` call was made with cwd = the **execution** tree `spur-new-sp-run-1132-85fab6d4`, whose per-tree `.spur/spur.db` contains no such row. The script answered `{"ok":false,"code":"RUN_NOT_FOUND"}` on each call, but the driver's own commands had appended `>/dev/null 2>&1`, so the failures were invisible for the whole run. The result: `runs` row with **zero** `action_runs` rows; `--close --status done` refused with
`{"ok":false,"error":"run 85fab6d4-… closed done with zero action_rows rows; emit --action/--actions-file during the run (no backfill); see inline-pipeline-driver.md#structured-trace-emission-adr-117-task-0868","code":"NO_ACTION_ROWS","actionRows":0}`.
The only non-lying options were to leave the row falsely `running` or to re-emit the trace afterwards; 93 rows were re-emitted post-run (all `--estimated`, since none had been timed) and the correction was written into the run log. **The contract forbids backfill at close — and it was right to; the defect is that the driver let a silent no-op happen at all.**

**Defect 2 — a stale digest nearly reused a gate receipt (12 m 20 s lost).** After deleting a stray untracked artifact the tree's real digest moved from `sha256:e1f2afbf…` to `sha256:21996f6e…`. The driver passed the *file's* value (the older one) to `quality-gate.ts recheck`; the gate's `readReceiptStatus(receiptPath, env.proofDigest)` compared it with the run's `1132-check-receipt.json` `inputDigest`, matched, and correctly-skipped by its own rules:
`check.reused — full-tier PASS receipt at input digest sha256:e1f2afbf…; gate skipped`.
A PASS for a tree that no longer existed was one accepted command away. The driver caught it, recomputed the digest, and re-ran the gate for real (12 m 20 s), but the reuse decision trusts a caller-supplied string that the caller is demonstrably capable of getting wrong.

**Defect 3 — the wrapup full route could not complete and "repaired" the wrong file (two failed runs, ~8 min plus a manual revert).** The full route (mode unset → deterministic drift probe → `doc-sync` → `learnings-*` → `doc-tripwire`) failed twice at `doc-tripwire`, which runs the repo-wide tripwires over the still-uncommitted wrap diff:
`repo-wide-tests/adr-supersession.test.ts` → *"(g2) the superseded team-mode design stays as history but is delinked from the design index"*.
Root cause: the wrapup **`doc-sync`** step **re-added** the deliberately delinked row for `design/spur-team-mode-design.md` to `docs/04_DESIGN.md` (with a version/`updated_at` bump), and the ADR-supersession tripwire then failed by design. Its **`repair`** lane followed and modified an **unrelated** file — `apps/app/tests/decision/decision-log-query.test.ts` (+36 lines) — instead of the violation's subject. Both writes had to be reverted by hand (`git checkout -- …`); the wrap only completed on the documented fast route (`mode=fast`: `task-resolve → metrics-record → done`, run `42aaec50-7eac-4a4b-8d0b-a0fe980c8dc5`), i.e. the operator's `--wrap` intent was only partially served.

**Current code facts (verified 2026-10-08).**
- `plugins/sp/scripts/inline-run-setup.ts` modes and contract (usage text, lines 17–24): `--run-id --file`, `--fingerprint --task-file`, `--action --run-id --node --kind --status --ok --duration-ms [--estimated]`, `--actions-file`, `--close --run-id --status [--reason]`, `--persist-out --from`, `--decide`. Terminal-reason enum: `done, paused-operator, failed-check, failed-agent, failed-timeout, failed-guard, cancelled, interrupted, retry-exhausted`. `--estimated` is valid only with `--action`.
- Per-tree DBs are deliberate: the failed-transition message itself says *"Provenance DB checked: <cwd> (per-tree isolation — if the pipeline ran in another tree, e.g. a `--worktree` invoked from elsewhere, re-record `spur task run-link` from this tree)"*. So the fix must respect isolation rather than remove it.
- `quality-gate.ts` modes `run|recheck|deferred|light|status`; reuse surface `readReceiptStatus(receipt, proofDigest)`; the receipt shape `.spur/run/<wbs>-check-receipt.json` (`inputDigest`, `checks[].durationMs`, `status`).
- `config/workflows/wrapup-pipeline.yaml`: `doc-sync` (`:224`), `learnings-validate` (`:259`), `learnings-append` (`:287`), `repair` (`:308`, ADR-118 contract-violation repair), `doc-tripwire` (`:330`, writes `PASS`/`FAIL` to `.spur/run/$__runId-wrapup-doc-tripwire.status`), routing guards (`:600-618`), and the proportional fast path `task-resolve → metrics-record` when `mode == fast` (`:503-506`) with "a caller-set mode is projected verbatim; the probe never runs".
- The tripwire that caught it is `repo-wide-tests/adr-supersession.test.ts` (g2/g3); `docs/04_DESIGN.md` is a derived index whose rows are the delink surface.

**Session evidence (2026-10-09), from the 1130/1131 batch teardown.** (1) `persist-out` skipped one row as an external-key conflict and instructed the driver to reconcile before teardown; the conflicting row was a duplicate `feature:E5` lifecycle run whose authoritative copy already existed in the invoking tree, so nothing unique was lost — but the reconciliation was manual and unassisted. (2) `persist-out-check` then returned BLOCKED against its 256-file listing cap over 367 scratch files, and removal proceeded on hand-verified cited evidence (`1130/1131-verdict.json`, both `-test-gate.status`, both `-review-proof.digest`, four run records) rather than an assertion. (3) While auditing run rows: the invoking tree's database holds 63 runs in `running`, including a `feature:E5` lifecycle row whose `completed_at` is set while its status never closed.

**Refine corrections (2026-10-09)**

- **Split.** The task had 12 requirements across five subsystems, with duplicate R6/R7 numbering and duplicate AC6/AC7. It now keeps only **run-trace and digest integrity**. The other parts moved:
  - wrapup doc-sync scope and the nested feature-transition (old R4, R5, second R7) → **1147** (H1);
  - worktree teardown bookkeeping (old R8, R11, R12) → **1148** (E71).
- **Old R2 close half is already shipped.** `--close --status done` with zero rows already exits 1 with `NO_ACTION_ROWS` (`packages/app/src/services/inline-run-setup.ts:1350-1361`, task 0975 R2; driver reference `:426`). `--close` on a missing row already exits 1 with `RUN_NOT_FOUND` (`:1381-1389`). Remaining gaps:
  - the no-suppression rule;
  - `--action` emission is documented as best-effort (driver `:424`), so a cross-tree `RUN_NOT_FOUND` on `--action` is only logged;
  - nothing pins the owning tree as cwd.
- **Old R5 mechanism is misattributed.** The wrapup `repair` state is a shell step that only writes `.spur/run/<run>-wrapup-repair.status` (`config/workflows/wrapup-pipeline.yaml:308-328`), and a `doc-tripwire` FAIL routes straight to `failed` (`:600-611`). The out-of-scope test edit therefore came from the `doc-sync` `agent.run`, the only model step. Corrected in 1147.
- **Old R3 still holds.** `readReceiptStatus(receiptPath, currentDigest)` compares the caller-supplied `env.proofDigest` string (`packages/app/src/services/quality-gate.ts:292-300`, `plugins/sp/scripts/quality-gate.ts:51`). No change since 2026-10-08 except the 1127 lock fix.
- **Feature.** H1 (spur-dev umbrella) stays; the driver reference and the setup script are its surface.

### Requirements

- [x] R1. **Action rows reach the tree that owns the run row.**
  - `inline-run-setup --action`/`--actions-file`/`--close` accept `--project-root <invoking-tree>`.
  - The driver contract always passes the invoking tree recorded in the WT-3 marker (or the run's setup cwd when no worktree is in use).
  - When the row is not found in that tree's database, `--action` exits 1 with `RUN_NOT_FOUND`, the same as `--close` today. A run-row miss is a correctness failure, not a best-effort emission failure. Other emission failures keep their best-effort policy.
- [x] R2. **No suppressed bookkeeping.** The driver reference forbids redirecting stdout/stderr of `inline-run-setup`, `quality-gate` and `persist-out*` calls. A static pin fails when any driver or execution-batch reference snippet pipes those commands to `/dev/null`.
- [x] R3. **The gate never reuses a receipt on a caller-copied digest.**
  - Before `readReceiptStatus` is consulted, the gate recomputes the proof-input fingerprint itself (the same function `inline-run-setup --fingerprint` uses, with `taskSpecPath`/`featureSpecPath` from env).
  - When the supplied `proofDigest` differs from the recomputed value, reuse is refused. The gate runs and logs `check.reuse-refused — supplied <D1> != current <D2>`.
  - When the recompute cannot run (missing task path), reuse is refused, never assumed.
- [x] R4. **Node durations come from the emitter's clock.**
  - A new `--node-enter --run-id --node` call stamps the enter time.
  - A following `--action` for that node without `--duration-ms` computes `duration = now − enter`.
  - A caller-supplied `--duration-ms` is still accepted but recorded as `provenance: host-reported`, separate from `measured`, in the row's structured result.
  - A row whose computed start precedes `runs.started_at` is rejected (exit 1).
- [x] R5. **Missing declared nodes and operator wait are visible.**
  - At `--close`, the script compares the run's visited declared states (from the run's state sidecar) with the states that have rows, and reports `missingNodes[]` in the close JSON and the run log as a trace defect. It does not fail the close.
  - operator-pause waits are emitted as their own row (`kind: operator-wait`) by the driver, so they are not charged to the neighbouring node.
- [x] R6. **Driver scratch lives in the run directory, and declared vars exist before use.**
  - The driver reference requires all driver scratch under `.spur/run/<run-id>/` (never `/tmp` or `$TMPDIR`, which the OS can reap mid-run).
  - Before a `shell` action that references a declared var (for example `qualityGateCmd`), the driver checks that the var is exported and non-empty, and fails the action naming the var otherwise.
- [x] R7. **Docs, pins and bundle ship in the same change.**
  - Update the driver reference: owning-tree flag, no-suppression, node-enter, operator-wait rows, scratch location, var check.
  - Update the receipt contract comment in `packages/app/src/services/quality-gate.ts`.
  - Add one fixture pin per requirement, each shown to fail without its fix.
  - Run `bun run --filter @gobing-ai/spur build:bundle` and `bun run build:scripts`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — An action row emitted from the execution tree lands in the owning tree (req: R1)
  Given a run row created in tree A and a driver whose cwd is worktree B
  When "inline-run-setup --action --project-root A" runs from B
  Then the row is written to A's database
  And without --project-root the command exits 1 with RUN_NOT_FOUND instead of a logged no-op
```

```gherkin
Scenario: AC2 — Suppressed bookkeeping output is rejected by a pin (req: R2)
  Given a driver reference snippet that redirects an inline-run-setup call to /dev/null
  When the contract pin runs
  Then it fails naming the file and line
```

```gherkin
Scenario: AC3 — A stale supplied digest cannot reuse a gate receipt (req: R3)
  Given a full-tier PASS receipt for digest D1 and a tree whose recomputed digest is D2
  When quality-gate recheck runs with proofDigest=D1
  Then reuse is refused, the gate runs, and the log states supplied D1 and current D2
  And when the recompute cannot run, reuse is refused as well
```

```gherkin
Scenario: AC4 — A node duration is the emitter's measurement (req: R4)
  Given "--node-enter --node implement" followed later by "--action --node implement" without --duration-ms
  When the row is written
  Then its duration is the emitter's elapsed time with provenance measured
  And a row given --duration-ms carries provenance host-reported
  And a row whose start would precede runs.started_at is rejected
```

```gherkin
Scenario: AC5 — A declared state with no row, and operator wait, are both visible (req: R5)
  Given a run that visited precheck, implement, the approve state and verify but emitted rows only for implement
  When the run closes
  Then the close JSON lists precheck, the approve state and verify under missingNodes
  And an approval wait emitted by the driver appears as its own operator-wait row
```

```gherkin
Scenario: AC6 — Undeclared scratch and an unexported var fail early (req: R6)
  Given a shell action that references qualityGateCmd
  When the driver reaches it with qualityGateCmd unset
  Then the action fails naming qualityGateCmd before running the command
  And the driver reference states that scratch lives under .spur/run/<run-id>/
```

```gherkin
Scenario: AC7 — Pins discriminate and docs match (req: R7)
  Given each new fixture pin
  When its fix is reverted in an isolated copy
  Then the pin fails
  And "bun run spur-check" passes with every fix in place
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T18:06:12.999Z

- **Q: Resolve the run row across both trees automatically, or pass the owner explicitly?** A: Explicitly, with `--project-root`. Auto-search across trees risks picking the wrong row when an id exists in both, which was Design failure (a). The WT-3 marker already names the invoking tree.
- **Q: Does a missing declared node fail the close?** A: No. It is reported (`missingNodes`). Failing would recreate the backfill pressure that `NO_ACTION_ROWS` forbids; visibility is the goal.
- **Q: Where did the wrapup and teardown requirements go?** A: To 1147 (wrapup write scope and nested feature-transition) and 1148 (persist-out-check scope, skipped-item report, markerless landing record).

### Design

- **Per-tree isolation is correct; the defect is silent failure.**
  - The failed-transition message already states the model, so R1 keeps isolation.
  - The owning tree travels explicitly (`--project-root`, taken from the WT-3 marker).
  - A run-row miss on `--action` becomes a loud exit 1, matching `--close`.
  - `NO_ACTION_ROWS` at close already exists, so R2 is only the no-suppression contract and its pin.
- **The gate owns its reuse identity (R3).**
  - `readReceiptStatus` stays a pure comparison.
  - The gate entry computes `current = computeProofInputFingerprint(...)` and refuses reuse when `current !== env.proofDigest`.
  - The plugin script reaches the fingerprint through its generated `.mjs` twin. A relative import satisfies the plugin-standalone contract; no `@gobing-ai/*` value import.
  - Cost: one fingerprint, a few seconds, paid only when a receipt exists.
- **Emitter-measured timing (R4).**
  - `--node-enter` writes `{node, enteredAt}` to the run's state sidecar (`.spur/memory/runs/<run-id>.state.json`, which the script already projects).
  - `--action` reads it.
  - `provenance` is a structured result field (`measured`|`host-reported`), not log prose. The existing `--estimated` maps to `host-reported`.
- **Visibility over enforcement (R5).** Close computes `missingNodes` from visited states minus nodes with rows and reports it. `operator-wait` is a row kind the driver emits around operator pauses; no new state is added.
- **Boundaries.** No global provenance DB. No cross-tree row search. No backfill. Do not change `NO_ACTION_ROWS` semantics, and do not touch wrapup or teardown (1147/1148).
- **Failure inventory (write before code):**
  - (a) `--project-root` pointing at a tree without the row;
  - (b) the loud `--action` miss breaking the same-tree path;
  - (c) the fingerprint recompute differing from the driver's capture because the cwd differs (it must run in the execution tree);
  - (d) a `--node-enter` with no matching `--action`, which leaves a dangling enter;
  - (e) `missingNodes` counting states the run never visited;
  - (f) the var check rejecting a legitimately empty optional var: only vars the YAML declares without a default are required.

### Plan

1. Write the failure inventory (Design) as test names first.
2. Write the tests before the implementation:
   - `packages/app/tests/services/inline-run-setup*.test.ts`: two in-memory DBs for R1, plus R4 and R5;
   - `plugins/sp/tests/quality-gate-receipt.test.ts`: the stale-supplied-digest case for R3;
   - a static pin in `plugins/sp/tests/dogfood-testing/` for R2 and R6.
3. R1 and R4: in `packages/app/src/services/inline-run-setup.ts`, add the `--project-root` resolution, the loud `--action` miss, `--node-enter` and provenance. Then regenerate the plugin twin.
4. R3: recompute at gate entry in `plugins/sp/scripts/quality-gate.ts` and the service's reuse path, then log the refusal.
5. R5: compute `missingNodes` in the close path. Emit `operator-wait` from the driver's operator-pause handling.
6. R2, R6 and R7: driver reference edits, the receipt comment, `build:bundle` and `build:scripts`.
7. Acceptance drill: a worktree round-trip with emission from B into A, a stale-digest recheck, and a close with a missing node. Record each output in Testing.
8. Run `bun run spur-check` once.

### Solution

Change map (file:line at merge commit):

| File | Change |
| --- | --- |
| `packages/app/src/services/inline-run-setup.ts:1360` | `--project-root` resolution on every trace mode (R1); loud `RUN_NOT_FOUND` on a run-row miss for `--action`/`--actions-file` (R1); `runInlineRunNodeEnter` stamps `nodeEnters`/`visitedNodes` in the run-record sidecar (R4); `runInlineRunTrace` computes `duration = now - enter` with `provenance: measured`, keeps `host-reported` for a supplied `--duration-ms`, rejects a computed start before `runs.started_at`, and refuses an unmeasurable duration with `ACTION_DURATION_UNAVAILABLE` (R4); `--close` reports `missingNodes[]` from visited-vs-recorded nodes (R5); `runInlineRunTraceMode` is the ADR-130 dispatcher for the four trace modes (keeps the plugin script inside its 250-line glue budget); `appendInlineRunLogLine`/`projectInlineRunClose` take an optional `workdir` so every write lands in the owning tree. |
| `packages/app/src/services/quality-gate.ts:353` | `recomputeGateProofFingerprint` (`:943`) (same canonical graph as `inline-run-setup --fingerprint`: git alternate tree + task/feature proof data) and `resolveReceiptReuse`, which refuses reuse when the recompute fails or disagrees with the supplied digest, logging `check.reuse-refused — supplied <D1> != current <D2>` (R3). `runQualityGate` and the script's `status` mode both go through it. |
| `packages/app/src/index.ts:453` | Exports the new surface (`runInlineRunNodeEnter`, `runInlineRunTraceMode`, `InlineRunNodeEnterInput`, `InlineRunTraceModeInput`). |
| `plugins/sp/scripts/inline-run-setup.ts:22` | Argv/env only: accepts `--node-enter`, `--project-root`, and an optional `--duration-ms`; delegates the mode bodies to `runInlineRunTraceMode`. 211 lines (budget 250). |
| `plugins/sp/scripts/quality-gate.ts:53` | `status` mode delegates to `resolveReceiptReuse`. |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:606`, `plugins/sp/skills/spur-dev/references/structured-trace-emission.md:40` | Driver contract for `--project-root`, the no-suppression rule, `--node-enter`/measured provenance, `operator-wait` rows, `missingNodes`, driver scratch under `.spur/run/<run-id>/`, and the declared-var check before a shell action (R2/R4/R5/R6). Also removed an unguarded `bun plugins/sp/scripts/…` invocation that the script-contract check forbids on a shipped surface (pre-existing; see Testing). |
| `docs/design/run-record-contract.md:60`, `docs/design/disposable-run-storage.md:56` | Dated 1136 baseline entries for the owning-tree flag, measured timing, `missingNodes`, gate reuse identity, and driver scratch confinement. |
| `scripts/commands/bundle-plugin-lib.ts:730` | Declares the `runInlineRunNodeEnter`/`runInlineRunTraceMode` twin exports; regenerated `plugins/sp/lib/*.generated.{mjs,d.mts}` and `plugins/sp/scripts/*.mjs`. |

Rationale: per-tree DB isolation is correct, so the owning tree travels explicitly instead of being searched for; a run-row miss becomes a loud failure (the 1132 incident lost 93 rows to a suppression that hid exactly this); the gate recomputes its own reuse identity instead of trusting a caller-copied digest; and node durations come from the emitter's clock where available.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/inline-run-setup.ts:1231` resolves `--project-root` and the run-row miss raises `RunRowNotFoundError` → `code: RUN_NOT_FOUND`; drill: emission from tree B without the flag exits 1 `RUN_NOT_FOUND`, with it lands the row in tree A (`packages/app/tests/services/inline-run-setup.test.ts` AC1/R1 + failure inventory (a)/(b)). |
| R2 | MET | `plugins/sp/skills/spur-dev/references/structured-trace-emission.md:162` states the no-suppression rule; `plugins/sp/tests/dogfood-testing/bookkeeping-contract.test.ts` pins every `references/*.md` snippet and mutation-checks the detector. |
| R3 | MET | `packages/app/src/services/quality-gate.ts:353` `resolveReceiptReuse` recomputes before `readReceiptStatus`; refusal lines asserted in `packages/app/tests/services/quality-gate.test.ts` and `plugins/sp/tests/quality-gate-receipt.test.ts`; drill shows `check.reuse-refused — supplied … != current …` then the gate running, and `check.reused` for the honest digest. |
| R4 | MET | `--node-enter` (`packages/app/src/services/inline-run-setup.ts:1382` stamps `nodeEnters`) + the measured duration, `provenance` and `ACTION_START_PRECEDES_RUN_START`/`ACTION_DURATION_UNAVAILABLE` guards at `packages/app/src/services/inline-run-setup.ts:1543`; tests cover measured vs host-reported, the start-before-`started_at` rejection and `ACTION_DURATION_UNAVAILABLE`. |
| R5 | MET | `missingNodes[]` in the close JSON (`packages/app/src/services/inline-run-setup.ts:1636`) and the `trace-close-defect` run-record line; drill prints `{"ok":true,"actionRows":1,"missingNodes":["start","end"]}` exit 0. Operator-wait rows are documented and asserted. |
| R6 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:604` (driver scratch under `.spur/run/<run-id>/`) and `:610` (declared-var check), both pinned by `plugins/sp/tests/dogfood-testing/bookkeeping-contract.test.ts`. |
| R7 | MET | References + receipt comment + pins + regenerated bundle/twins ship together; `bun run spur-check` green (10675 pass / 0 fail, lint, pre/post rules). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — an action row emitted from the execution tree lands in the owning tree (req: R1) | MET | test | `packages/app/tests/services/inline-run-setup.test.ts` "AC1/R1" + acceptance drill `.spur/memory/runs/1136-acceptance-drill.log` |
| AC2 — suppressed bookkeeping output is rejected by a pin (req: R2) | MET | test | `plugins/sp/tests/dogfood-testing/bookkeeping-contract.test.ts` "a snippet redirecting inline-run-setup to /dev/null is rejected naming file and line" |
| AC3 — a stale supplied digest cannot reuse a gate receipt (req: R3) | MET | test | `plugins/sp/tests/quality-gate-receipt.test.ts` + `packages/app/tests/services/quality-gate.test.ts` stale/refusal cases; drill 2 |
| AC4 — a node duration is the emitter's measurement (req: R4) | MET | test | `packages/app/tests/services/inline-run-setup.test.ts` AC4 cases; `plugins/sp/tests/inline-run-trace.test.ts` `--node-enter` E2E |
| AC5 — a declared state with no row, and operator wait, are both visible (req: R5) | MET | test | `packages/app/tests/services/inline-run-setup.test.ts` AC5 case; drill 3 close JSON `missingNodes` |
| AC6 — undeclared scratch and an unexported var fail early (req: R6) | MET | test | driver-reference pins in `plugins/sp/tests/dogfood-testing/bookkeeping-contract.test.ts` (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:604`) |
| AC7 — pins discriminate and docs match (req: R7) | MET | command | failing-then-green sequence per fixture; `bun run spur-check` green on the final tree |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

**Gate and drill evidence (task 1136)**

Verification commands (task worktree `spur-new-sp-run-1136-18f9bb0b`, final tree):

- `bun run lint` — PASS (biome 1321 files + every workspace typecheck).
- `bun run test-pre-check` — PASS (50/50 recommended rules).
- `bun scripts/commands/gate-lock.ts -- bun run test` — PASS: **10675 pass / 0 fail**, 627 files,
  exit 0, per-file coverage thresholds met (`packages/app/src/services/inline-run-setup.ts` 92.38%
  lines / 90.63% funcs; `plugins/sp/scripts/quality-gate.ts` 94.12% lines).
- `bun run test-post-check` — PASS (2/2).
- `bun run build:scripts` (⇒ `build:plugin-lib` + twin conversion) — PASS; `script-contract-check`
  0 violations.

Acceptance drill (real CLI; full transcript in `.spur/memory/runs/1136-acceptance-drill.log`):

- **AC1/R1** — run row in tree A, `--action` from tree B (`/tmp/spur-1136-drill/{A,B}`): without
  `--project-root` → `{"ok":false,…,"code":"RUN_NOT_FOUND"}` exit 1; with it → exit 0 and
  `drill-1136-run|implement|agent.run|157|{"provenance":"measured","estimated":false}` lands in A
  while B keeps 0 rows.
- **AC3/R3** — receipt bound to the recomputed digest, rechecked with
  `proofDigest=sha256:stale-but-plausible` → `check.reuse-refused — supplied sha256:stale-but-plausible
  != current sha256:92af9f6f…` and the gate runs (`full-ran`); the honest digest → `check.reused …
  gate skipped`.
- **AC5/R5** — `--close --status done` → `{"ok":true,"actionRows":1,"missingNodes":["start","end"]}`
  exit 0 plus `trace-close-defect … missing action rows for visited nodes: start, end` in the run
  record.
- **AC2/R2 (deterrent)** — the same emission with stdout redirected to `/dev/null` hides the
  `RUN_NOT_FOUND` from the caller: the exact 1132 failure mode the pin rejects.

Test inventory (each shown to fail without its fix while iterating): R1/R4/R5 + dispatcher usage
refusals in `packages/app/tests/services/inline-run-setup.test.ts`; R3 in
`packages/app/tests/services/quality-gate.test.ts` (incl. `recomputeGateProofFingerprint` ↔
`computeProofInputFingerprint` parity) and `plugins/sp/tests/quality-gate-receipt.test.ts` (incl. the
`status`-mode refusals); R2/R6 in the new
`plugins/sp/tests/dogfood-testing/bookkeeping-contract.test.ts`; four updated suites for the loud-miss
contract, the optional `--duration-ms` and single ownership of the terminal-reason enum.

Out-of-task repair (disclosed): `script-contract-check` failed at base commit `17d06fe18` with the
`forbidden_invocation` kind on an unguarded `bun plugins/sp/scripts/task-diffstat.ts` in shipped prose
(`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:805`; verified by running the checker
in a clean worktree at that commit). The line was rewritten to the guarded idiom so the task gate can
be green; no behaviour change.

Not covered: no live driver `--worktree` run (the drill reproduces the two-tree shape with plain
directories, exercising the same `--project-root` path); wrapup/teardown defects are task 1147/1148
scope and were not touched.

**Gate and drill evidence (task 1136)**

Verification commands (task worktree `spur-new-sp-run-1136-18f9bb0b`, final tree):

- `bun run lint` — PASS (biome 1321 files + every workspace typecheck).
- `bun run test-pre-check` — PASS (50/50 recommended rules).
- `bun scripts/commands/gate-lock.ts -- bun run test` — PASS: **10675 pass / 0 fail**, 627 files,
  exit 0, per-file coverage thresholds met (`packages/app/src/services/inline-run-setup.ts` 92.38%
  lines / 90.63% funcs; `plugins/sp/scripts/quality-gate.ts` 94.12% lines).
- `bun run test-post-check` — PASS (2/2).
- `bun run build:scripts` (⇒ `build:plugin-lib` + twin conversion) — PASS; `script-contract-check`
  0 violations.

Acceptance drill (real CLI; full transcript retained at `.spur/memory/runs/1136-acceptance-drill.log`):

- **AC1/R1** — run row in tree A, `--action` from tree B (`/tmp/spur-1136-drill/{A,B}`): without
  `--project-root` → `{"ok":false,…,"code":"RUN_NOT_FOUND"}` exit 1; with it → exit 0 and
  `drill-1136-run|implement|agent.run|157|{"provenance":"measured","estimated":false}` lands in A
  while B keeps 0 rows.
- **AC3/R3** — receipt bound to the recomputed digest, rechecked with
  `proofDigest=sha256:stale-but-plausible` → `check.reuse-refused — supplied sha256:stale-but-plausible
  != current sha256:92af9f6f…` and the gate runs (`full-ran`); the honest digest → `check.reused …
  gate skipped`.
- **AC5/R5** — `--close --status done` → `{"ok":true,"actionRows":1,"missingNodes":["start","end"]}`
  exit 0 plus `trace-close-defect … missing action rows for visited nodes: start, end` in the run
  record.
- **AC2/R2 (deterrent)** — the same emission with stdout redirected to `/dev/null` hides the
  `RUN_NOT_FOUND` from the caller: the exact 1132 failure mode the pin rejects.

Test inventory (each shown to fail without its fix while iterating): R1/R4/R5 + dispatcher usage
refusals in `packages/app/tests/services/inline-run-setup.test.ts`; R3 in
`packages/app/tests/services/quality-gate.test.ts` (incl. `recomputeGateProofFingerprint` ↔
`computeProofInputFingerprint` parity) and `plugins/sp/tests/quality-gate-receipt.test.ts` (incl. the
`status`-mode refusals); R2/R6 in the new
`plugins/sp/tests/dogfood-testing/bookkeeping-contract.test.ts`; four updated suites for the loud-miss
contract, the optional `--duration-ms` and single ownership of the terminal-reason enum.

Out-of-task repair (disclosed): `script-contract-check` failed at base commit `17d06fe18` with the
`forbidden_invocation` kind on an unguarded `bun plugins/sp/scripts/task-diffstat.ts` in shipped prose
(`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:805`; verified by running the checker
in a clean worktree at that commit). The line was rewritten to the guarded idiom so the task gate can
be green; no behaviour change.

Not covered: no live driver `--worktree` run (the drill reproduces the two-tree shape with plain
directories, exercising the same `--project-root` path); wrapup/teardown defects are task 1147/1148
scope and were not touched.

**Wrap hop (`--wrap`, post-merge).**

The full wrap route failed deterministically and was completed on the documented fast route:

- `wrapup-pipeline` full route: `doc-sync`'s `agent.run` exited 0 with an **empty**
  `-wrapup-learnings.md`, the contract-violation edge routed to `repair`, and the `repair` shell
  then exited 1 — its `&&` chain starts with `V="$(cat .spur/run/$__runId-wrapup-learnings.status)"`,
  and that file does not exist on the empty-capture path, so `cat`'s status breaks the chain before
  `exit 0`. Transcript: `.spur/memory/runs/1136-wrap-full.log`. This is a distinct wrapup defect
  (the step must tolerate a missing status file), adjacent to task 1147/1148 scope; not fixed here
  because this task's boundaries exclude wrapup.
- No stray writes survived the failure: `git status` was clean afterwards (the 1132 incident needed
  a manual revert; this run did not).
- Fast route (`mode=fast`): `task-resolve → metrics-record → done`, exit 0, metrics recorded;
  transcript `.spur/memory/runs/1136-wrap-fast.log`.

Landed-gate re-run on the merged `main` tree (`c021837d4`, post-merge, after the worktree was
removed): `bun run lint` PASS, `test-pre-check` 50/50 PASS,
`bun scripts/commands/gate-lock.ts -- bun run test` **10675 pass / 0 fail** exit 0,
`test-post-check` 2/2 PASS — transcript `.spur/memory/runs/1136-spur-check.log`.

Landing: worktree FF-merged after merging `main` into the branch (a concurrent 1143 run had advanced
`main`); the single conflict was the `task-diffstat` doc line 1143 had already fixed, resolved by
taking main's version. `persist-out` reported one external-key conflict (the worktree's
`task-lifecycle` run row for 1136 vs the invoking tree's existing 1136 lifecycle link); reconciled by
evidence — the authoritative transition record is this file's History section, and no unique row or
evidence file was lost. Worktree and branch removed after the merge was verified on `main`.

### Review

Self-review over the full diff (SECUA + traceability). No P1/P2 findings; disposition PASS.

| Sev | Finding | Disposition |
| --- | --- | --- |
| P1 | — | none found |
| P2 | — | none found |
| P3 | `plugins/sp/lib/quality-gate.generated.mjs` grows ~65 KB → ~1.0 MB: the bundled core now inlines the proof-fingerprint graph (git alternate tree + spec extraction) so the gate keeps one canonicalizer. | Accepted. The rejected alternative — re-deriving the digest inside the gate script — is exactly the second-canonicalizer drift the R3 defense exists to prevent. `inline-run.generated.mjs` (1.75 MB) already sets this order of magnitude; revisit if plugin install size becomes a budget. |
| P3 | The script's read-only `status` mode now pays the recompute (3 git spawns) whenever a receipt exists. | Accepted: `status` is the same trust decision, and leaving it caller-trusting would keep the laundering path open through the one mode the pipeline uses to decide whether to re-run. Cost is bounded and paid only when a receipt exists. |
| P4 | `--actions-file` rows skip the start-before-`runs.started_at` check. | Recorded gap: the batch format carries no enter stamp, so every row is host-reported by construction and a reconstructed start would assert nothing; the guard scopes to `--action`. Revisit if the batch format gains timestamps. |
| P4 | This run's own trace holds a duplicate `precheck` row (an in-process debug call emitted one before the script emitted the real one). | Left in place: the trace is append-only and hand-editing rows is forbidden (ADR-117). |

Requirement traceability: **R1** satisfied (`--project-root` on every emission mode; run-row miss is a
loud exit 1 on `--action`/`--actions-file`/`--node-enter` and `--close`; per-tree isolation preserved
— design failure (a) rejected auto-search). **R2** satisfied (no-suppression contract in both
references + a mutation-checked static pin). **R3** satisfied (`resolveReceiptReuse` recomputes before
`readReceiptStatus` in `run`/`recheck` and in `status`; both refusal reasons logged and tested;
`readReceiptStatus` stays a pure comparison). **R4** satisfied (`--node-enter` → `provenance:
measured`; supplied duration → `host-reported`; start-before-`started_at` rejected; unmeasurable
duration is a named failure, not a silent no-op). **R5** satisfied (`missingNodes[]` reported, never
fatal; `operator-wait` documented as its own row kind). **R6** satisfied (scratch confinement and the
declared-var check are part of the driver contract with pins; no code change required — the reference
is the owner per the task's Plan). **R7** satisfied (references, receipt comment, bundle/scripts and
one pin per requirement ship together; `bun run spur-check` green on the final tree).

Residual risk: the loud-miss and the digest guard both change long-standing behaviour (silent
best-effort emission; caller-supplied digest reuse). Four existing suites were updated to the new
contracts and the pre-1136 behaviour is recorded in dated design entries, so the change is
auditable. Untested path: no live driver `--worktree` run was executed — the acceptance drill
reproduces the two-tree shape with plain directories, exercising the same `--project-root` code path.

### References

- Incident: run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132), 2026-10-08 — 93 action rows silently lost and one refused close (`NO_ACTION_ROWS`); one near-miss receipt reuse on stale digest `sha256:e1f2afbf…` while the tree was at `sha256:21996f6e…`; wrapup runs `4b02efaf-66fb-4656-81d0-a1710740229f` and `a03b4cf8-be23-4e43-a976-48fc9427d6f2` failed at `doc-tripwire`, `42aaec50-7eac-4a4b-8d0b-a0fe980c8dc5` completed on the fast route.
- Code touchpoints: `plugins/sp/scripts/inline-run-setup.ts` (modes/usage `:17-24`, `--action`, `--actions-file`, `--close`, `--estimated`), `plugins/sp/scripts/quality-gate.ts` (`recheck`, `readReceiptStatus`, `check.reused`), `config/workflows/wrapup-pipeline.yaml` (`doc-sync :224`, `repair :308`, `doc-tripwire :330`, guards `:600-618`, fast path `:503-506`), `repo-wide-tests/adr-supersession.test.ts` (g2/g3), `docs/04_DESIGN.md` (derived index rows).
- Contracts to update: `inline-pipeline-driver.md` (structured trace emission ADR-117 section, the run-record two-file convention, the digest-refresh cadence), `docs/design/run-record-contract.md`, `docs/design/disposable-run-storage.md`, and the wrapup workflow's own comments.
- Related: ADR-117 (action trace on every surface), ADR-118 (contract-violation repair), ADR-131 (disposable run scratch), ADR-119 (gate at the invariant's scope), feature E71/E7 (run record), task 0927 (two-file run record), task 0871 (ADR-118 repair pilot 0871), task 1037 (doc-tripwire).

### History

- 2026-10-09T05:30:22.775Z backlog → todo (system)
- 2026-10-09T18:44:42.449Z todo → wip (system)
- 2026-10-09T20:34:37.707Z wip → testing (system)
- 2026-10-09T20:35:30.324Z testing → done (system)

