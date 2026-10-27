---
schema_version: 1
name: Combined supervised and attached fleet performance receipt
status: done
template: feature-impl
created_at: 2026-10-22T07:00:38.146Z
updated_at: "2026-10-27T00:34:38.853Z"
feature_id: G75
priority: P3
tags:
  - fleet
  - performance

dependencies: ["1282", "1276", "1277", "1278", "1280"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1283-verdict.json
---

## 1283. Combined supervised and attached fleet performance receipt

### Background

Implements: R6 — A combined fleet receipt distinguishes participation gains from convenience.
Work package B6. Extends the G74 phase receipt driver. Depends on attached stage execution and the G74 adapters. If attached-ready adds no material gain over supervised-warm, report it as convenience only.
Rubric: E5 D1 L1 C1 R1 = 9 → own task.

**Refine corrections (2026-10-22)**
- Dependencies were incomplete: the combined receipt compares supervised-warm (needs 1276–1278) and host capabilities (1280) as well as attached-ready (1282). → resolution: depends on 1276, 1277, 1278, 1280, 1282.
- Receipt driver and schema are 1273's (`fleet-e2e --perf`, `docs/reports/fleet-perf-receipt.json`); this task adds modes, not a harness.

### Requirements

- [x] R1. Run identical first-batch workloads on attached-ready, supervised-cold and supervised-warm workers including busy waits, attach overhead and failures.
- [x] R2. Report p50/p95 completion, useful throughput and completion rate with quality and cost guardrails.
- [x] R3. Record Grok Build and Antigravity CLI as second-batch probes; unsupported attachments are never counted as gains.

### Acceptance Criteria

```gherkin
Scenario: AC1 — R6 — A combined fleet receipt distinguishes participation gains from convenience (req: R1)
  Given `bun run fleet-e2e --perf --modes attached-ready,supervised-cold,supervised-warm`
  When the deterministic lane runs
  Then every mode runs the same workload digest, and busy waits, attach overhead and failures appear as phases or trial statuses

Scenario: AC2 — Gains are reported with guardrails (req: R2)
  Given the receipt
  When the Markdown summary is generated
  Then it shows p50/p95, validated-per-hour and completion rate per mode, and labels attached-ready "convenience only" when its gain over supervised-warm is under the plan's materiality threshold

Scenario: AC3 — Batch-2 hosts never count as gains (req: R3)
  Given Grok Build and Antigravity CLI probes
  When they are absent or unsupported
  Then their rows read `unsupported` with a reason and are excluded from gain computations
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:26:06.694Z

- **Q: Materiality threshold?** CLOSED — use the provisional target in `docs/plans/2026-10-21-fleet-performance-measurement.md` (labelled provisional); if absent there, report raw deltas and mark "no threshold" rather than inventing one.
- **Q: Real agents?** CLOSED — opt-in `--real-agents`, operator-run.

### Design

**Files:** `scripts/commands/fleet-e2e.ts` (`--modes <csv>` within `--perf`; attached mode uses the 1282 fixture occupant); `docs/reports/fleet-perf-receipt.json` and `docs/reports/fleet-perf-receipt.md` (the generated receipt both lanes rewrite — named separately because a `fleet-perf-receipt.{json,md}` brace form parses as a dead prefix in the implement scope allowlist); same receipt schema with `mode` values extended to `attached-ready`; Markdown summary adds a mode comparison table and the convenience verdict.
**Invariants:** failure denominators kept; no fabricated gains; batch-2 rows unsupported unless qualified.
**Rejected:** separate benchmark harness.

### Plan

1. Failure cases first: attached occupant busy for the whole trial; attach failure; mode missing a qualified driver; batch-2 host absent.
2. `--modes` + attached mode trial runner.
3. Combined deterministic receipt (`docs/reports/fleet-perf-receipt.{json,md}`).
4. Opt-in real-agent comparison; `bun run spur-check`.

### Solution

- `scripts/commands/fleet-e2e.ts:905` — `perfModesOf` validates `--modes` (shared by `parsePerfArgs` and the direct `runFleetE2e` entry); default is all three lanes, unknown mode exits loudly.
- `scripts/commands/fleet-e2e.ts:2524` — `runAttachedTrials`: per trial, `agent join --role coder --member <id> --json` (binding requires full fsRead/fsWrite/processSpawn attestation), `agent report --pin epoch:gen` handshake, `attach` phase mark, then `createAttachedTurnDispatcher` polls for a correlated reply while a fixture occupant polls the coder inbox for the keyed request, closes the task through the source-local CLI (todo → wip → Solution+Testing sections → testing → done) and replies with the correlation JSON. Every trial is bounded by `PERF_TRIAL_TIMEOUT_MS` (abort → outcome-unknown); the injected failure never answers and stays in the completion-rate denominator.
- `scripts/commands/fleet-e2e.ts:2150` — `PERF_BATCH2_AGENTS` (grok-build, antigravity-cli) probe binary provenance via `Bun.which` + host version; qualification-only rows, never gains.
- `scripts/commands/fleet-e2e.ts:2178` — `modeGainVerdict`: material-gain iff attached p50 ≥15% AND p95 ≥10% lower than supervised-warm (provisional plan targets); otherwise convenience-only / no-gain / inconclusive.
- `scripts/commands/fleet-e2e.ts:3108` — `turnComparison` only when a supervised turn lane ran; `scripts/commands/fleet-e2e.ts:3130` — `attachedComparison` only when attached-ready ran.
- `scripts/commands/fleet-e2e.ts:2452` + `scripts/commands/fleet-e2e.ts:2471` + `scripts/commands/fleet-e2e.ts:2497` — receipt markdown gains the Batch-2 probe table and the Mode comparison table with materiality line and convenience verdict, plus the caveat that the attached column is the fleet-task lane while the warm column is the turn-fixture lane, so a verdict compares ergonomics across layers rather than a like-for-like paid-model delta. The trailing receipt note was corrected to admit that pairing (it previously claimed the two were never mixed).
- Tests: `scripts/commands/fleet-e2e-perf.test.ts:95` (mode selector), `scripts/commands/fleet-e2e-perf.test.ts:111` (materiality verdicts); `scripts/commands/fleet-e2e-turn-perf.ts` typing widened for the shared measured/processes record.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Three lanes on one workload digest `scripts/commands/fleet-e2e.ts:1974`, busy-wait phase `scripts/commands/fleet-e2e.ts:2687`, injected attach failure kept in denominator `scripts/commands/fleet-e2e.ts:2800`; receipt `docs/reports/fleet-perf-receipt.md:6` (digest) and `docs/reports/fleet-perf-receipt.md:16` (9/9 validated trials with phases) |
| R2 | MET | p50/p95/completionRate/validatedPerHour per mode `docs/reports/fleet-perf-receipt.md:28`; materiality verdict `scripts/commands/fleet-e2e.ts:2216`; tests `scripts/commands/fleet-e2e-perf.test.ts:134` |
| R3 | MET | Batch-2 probe rows built without driver and excluded from gains `scripts/commands/fleet-e2e.ts:3212`; receipt rows `docs/reports/fleet-perf-receipt.md:62` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R6 — A combined fleet receipt distinguishes participation gains from convenience (req: R1) | MET | command | `bun run fleet-e2e --perf --trials 3 --agents pi` → 9/9 validated, one digest `docs/reports/fleet-perf-receipt.md:6`, busy-wait/attach phases `docs/reports/fleet-perf-receipt.md:22`; warm-turn claim/redelivery tests `packages/app/tests/services/agent-loop-service.test.ts:428`, `packages/app/tests/services/agent-loop-service.test.ts:498` (19 pass) |
| AC2 — Gains are reported with guardrails (req: R2) | MET | test | `scripts/commands/fleet-e2e-perf.test.ts:140` convenience-only under threshold (23 pass); receipt comparison `docs/reports/fleet-perf-receipt.md:69` |
| AC3 — Batch-2 hosts never count as gains (req: R3) | MET | command | `docs/reports/fleet-perf-receipt.md:62` grok-build/antigravity-cli `unsupported` with reasons; gain rows iterate measured targets only `scripts/commands/fleet-e2e.ts:3233` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1283

**Scope:** task 1283 change set — `scripts/commands/fleet-e2e.ts` (`--modes` selector, `attached-ready` trial lane, batch-2 probes, `modeGainVerdict`, receipt markdown), `scripts/commands/fleet-e2e-turn-perf.ts` (measured/processes record widened to `Partial`), `scripts/commands/fleet-e2e-perf.test.ts`, `scripts/commands/fleet-e2e-turn-perf.test.ts`, `docs/reports/fleet-perf-receipt.json`, `docs/reports/fleet-perf-receipt.md`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | `--modes` accepts an empty or duplicate list (`scripts/commands/fleet-e2e.ts:905`): `parseArgs` filters empty entries, so `--modes ""`, a whitespace value or an unset `$MODES` reaches `perfModesOf` as an empty lane list, the perf lane runs no trial, still writes `docs/reports/fleet-perf-receipt.{json,md}` (empty `trials`/`measured`, no comparison tables) and exits 0 — verified by evaluating `parsePerfArgs` on `--modes ' '`, which returned `[]`. Duplicates are not deduped either: two identical lane names keep both entries and double-run that lane, skewing its sample count. | `scripts/commands/fleet-e2e.ts:905` | DEFER(empty/duplicate list semantics are a selector-owned decision — fail loudly vs fall back to all lanes — and no path in the shipped `repeatCommand` emits an empty list; file as follow-up) |
| 2 | P4 (advisory) | correctness | The Batch-2 markdown row hardcodes the literal `unsupported` instead of rendering `probe.status`, so a future batch-2 driver would show `qualified` in the JSON and `unsupported` in the table. Currently equivalent because `PERF_BATCH2_AGENTS` always passes `driver: null`. | `scripts/commands/fleet-e2e.ts:2459` | ACCEPTED |
| 3 | P4 (advisory) | correctness | AC2's literal wording labels an under-materiality result "convenience only"; the verdict function splits that band into `convenience-only` (positive but under 15%/10%) and `no-gain` (attached slower than warm). The shipped receipt therefore reads `no-gain` for pi. Stricter than the AC, never a fabricated gain, and disclosed by the receipt caveat. | `scripts/commands/fleet-e2e.ts:2193` | ACCEPTED |
| 4 | P4 (advisory) | usability | The `attach` phase mark is measured once per lane and pushed into every attached trial's `phases`, so an `--trials n>1` receipt repeats one attach timestamp per row and per-trial attach overhead cannot be separated from the single handshake. | `scripts/commands/fleet-e2e.ts:2565` | ACCEPTED |
| 5 | P4 (advisory) | usability | The measured/JSON lane key is `attached` while trials and `modes` use `attached-ready`; AC2's per-mode table therefore needs a name mapping a reader has to infer. | `scripts/commands/fleet-e2e.ts:3104` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `scripts/commands/fleet-e2e.ts:2524` `runAttachedTrials` reuses `createPerfTask`, so attached and supervised lanes run the same workload; `docs/reports/fleet-perf-receipt.md:14-17` shows both lanes under one digest (`docs/reports/fleet-perf-receipt.md:6`) with the attached row phases `attach→busy-wait→terminal`; injected-failure arm aborts after `PERF_ATTACH_FAIL_MS` and records `timed-out` while keeping the duration (`scripts/commands/fleet-e2e.ts:2709`, `scripts/commands/fleet-e2e.ts:2747`) |
| R2 | MET | `scripts/commands/fleet-e2e.ts:2178` `modeGainVerdict`; `scripts/commands/fleet-e2e-turn-perf.ts:35` `perfMeasured` emits p50/p95/completionRate/validatedPerHour per mode; `docs/reports/fleet-perf-receipt.md:22-26` renders them per mode and `docs/reports/fleet-perf-receipt.md:59-72` states the provisional materiality thresholds, the verdict and the cross-layer caveat |
| R3 | MET | `scripts/commands/fleet-e2e.ts:2150` `PERF_BATCH2_AGENTS` (grok-build, antigravity-cli) feeds only `batch2Probes` (`scripts/commands/fleet-e2e.ts:3118`), rendered at `docs/reports/fleet-perf-receipt.md:50-57` with status `unsupported` and a reason per row; `attachedComparison`/`measured` never read those rows (`scripts/commands/fleet-e2e.ts:3130`) |

##### AC traceability (task-local criteria)

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 — R6 — A combined fleet receipt distinguishes participation gains from convenience (req: R1) | MET | test + command + static-ref | `scripts/commands/fleet-e2e-perf.test.ts:95` (absent `--modes` selects all three lanes, unknown lane fails loudly); `docs/reports/fleet-perf-receipt.md:14-17` — one `workloadDigest` for both lanes, attached row phases `attach→busy-wait→terminal`; failure status path `scripts/commands/fleet-e2e.ts:2709` and `scripts/commands/fleet-e2e.ts:2747` |
| AC2 — Gains are reported with guardrails (req: R2) | MET | test + command | `scripts/commands/fleet-e2e-perf.test.ts:111` (material-gain, convenience-only, no-gain, inconclusive); `docs/reports/fleet-perf-receipt.md:22-26` per-mode p50/p95/completionRate/validatedPerHour; `docs/reports/fleet-perf-receipt.md:61-72` materiality line, verdict row and caveat |
| AC3 — Batch-2 hosts never count as gains (req: R3) | MET | command + static-ref | `docs/reports/fleet-perf-receipt.md:50-57` — grok-build and antigravity-cli rows read `unsupported` with a reason; exclusion from gains at `scripts/commands/fleet-e2e.ts:3118` (probe-only record) against `scripts/commands/fleet-e2e.ts:3130` (comparison reads `measured`) |

##### Verification run in this review

- `bun test scripts/commands/fleet-e2e-perf.test.ts scripts/commands/fleet-e2e-turn-perf.test.ts` → 21 pass, 0 fail, 246 expect calls.
- `bunx tsc --noEmit -p scripts/tsconfig.json` → exit 0. `bunx biome check` on the four changed script files → clean.
- `spur task check 1283` → PASS. `spur task residual 1283 review-gate` → blocking=0.
- Not re-run here: the E2E perf lanes (they rewrite the tracked receipt and would change the reviewed tree); the committed receipt is the artifact from the last lane run, cited above.

##### Residual risk

The attached-vs-warm comparison pairs the fleet-task lane with the 1276 turn-fixture lane; the receipt says so at `docs/reports/fleet-perf-receipt.md:68-69` and the verdict reads `no-gain` rather than manufacturing a cross-layer gain. Materiality thresholds are provisional plan targets, labelled as such (`docs/reports/fleet-perf-receipt.md:61`). Batch-2 rows carry absolute host paths per the receipt's own external-path policy (`docs/reports/fleet-perf-receipt.md:78`), which differs from `redactProbeOutput` (`scripts/commands/fleet-e2e.ts:1494`) used by the host capability report — pre-existing receipt convention, not introduced here.

**Next:** defer the `--modes` empty/duplicate-list semantics as a follow-up and wrap.

Confidence: MEDIUM

Verdict: PASS

### References

- Feature G75 R6; KPI plan `docs/plans/2026-10-21-fleet-performance-measurement.md`; design `docs/design/fleet-attached-occupants.md` §7.
- Depends on 1276, 1277, 1278, 1280, 1282 (and transitively 1273).

### History

- 2026-10-26T01:34:24.423Z todo → wip (system)
- 2026-10-26T02:46:04.470Z wip → testing (system)
- 2026-10-26T02:46:18.574Z testing → done (system)

