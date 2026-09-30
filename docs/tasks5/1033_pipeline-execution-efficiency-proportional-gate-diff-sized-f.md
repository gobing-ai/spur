---
schema_version: 1
name: "Pipeline execution efficiency: proportional gate, diff-sized fan-out, wrapup pre-flight"
status: backlog
template: feature-impl
created_at: 2026-09-30T22:20:05.119Z
updated_at: "2026-09-30T22:20:07.573Z"
feature_id: D9

priority: P2
---

## 1033. Pipeline execution efficiency: proportional gate, diff-sized fan-out, wrapup pre-flight

### Background

Captured from the creation title: "Pipeline execution efficiency: proportional gate, diff-sized fan-out, wrapup pre-flight".

### Requirements

## Background

Feature I33's 3-task batch (1021–1023, 2026-09-30) took 3h40m38s end-to-end (18:17:02→21:57:40 UTC; commits `77f0d10dd`→`f5a0b8edc`→`ca965477d`, wrapup, merge). Transcript forensics (session jsonl, event-gap attribution) show the time is structural, not content: ~55% of execution time is fixed subagent fan-out latency on small diffs, ~21m is full `bun run spur-check` run 3+ times, ~20m is two failed wrapup runs on gate-ordering issues. This task pins the fixes and the measured baseline so implementation cannot drift.

#### Measured baseline (evidence anchors)

| Symptom | Measured | Evidence |
| --- | --- | --- |
| Subagent fan-out on small diffs | 1022: subagent time 41m of 55m phase (73%); implement dispatch gap 20m00s for an ~18-line diff; verifier 12m35s; reviewer ~6m. 1023: 33m of 47m (70%); implement 15m30s | sink timestamps 19:43:48Z, 20:16:26Z, 20:33:47Z, 20:51:56Z |
| Full gate per task | `qualityGateCmd="bun run spur-check"` per task: 7m34s (1021), ~4m (1022), 9m12s (1023); 1023 ran the gate TWICE (fix → re-run, no receipt reuse) | sink 18:53:01Z, 20:45:31Z |
| Wrapup failures | 2 of 3 wrapup runs failed on gate ordering (dogfood-report gate, ledger registration order), then digest-seam stall 11m58s; failed runs `47415d75`, `f5877e99`; paused run `215c6eab` | wrapup phase 31m total |
| Existing hooks available but unused | `sp:spur-check` light tier (changed-scope biome + per-workspace typecheck + related tests, fingerprint-bound receipts `.spur/run/<wbs>-check-receipt.json`); ADR-119 `spur-check-feature` repo-wide once-per-feature; precheck already computes `.spur/run/<wbs>-diffstat.json` `{files,insertions,deletions,sensitive}` | task-pipeline.yaml, quality-gate.ts env, task-diffstat.ts |

## Requirements

- R1 (proportional quality gate): per-task gate becomes the light tier as defined by `sp:spur-check` (changed-scope Biome + per-workspace typecheck + related tests only), with receipt reuse keyed on the proof fingerprint `quality-gate.ts` already receives — a PASS receipt at the same fingerprint must short-circuit a re-run (1023's double gate is the regression to kill). The full `bun run spur-check` moves to exactly ONE run per feature at the feature boundary (`spur-check-feature` semantics, ADR-119). ANTI-DRIFT: light-tier check set = the existing sp:spur-check light definition, verbatim — do not invent a new check set; the feature-boundary full pass is never dropped or diluted.
- R2 (diff-sized fan-out): precheck's existing diffstat selects the execution shape — doc-only/small diff (≤3 files AND ≤60 changed lines AND `sensitive=false`) → inline implement + ONE fresh reviewer (verify folded into the reviewer's traceability pass); anything else (code, large, or `sensitive=true`) keeps the full implement-worker → fresh reviewer → fresh verifier fan-out unchanged. ANTI-DRIFT: thresholds are numeric constants in the pipeline/driver contract (not implicit judgment); `sensitive=true` always forces full fan-out; the pipeline state machine (precheck→implement→test→review→approve→verify→record→done) is unchanged — this only changes who executes steps, not which steps exist.
- R3 (wrapup pre-flight): before dispatching the wrapup workflow, run cheap pre-dispatch checks that fail fast with a named check id: (a) L4 dogfood ledger contains the expected entry when the dogfood gate will fire; (b) receipt digest parity — recompute the feature-verification digest via the source-local resolver path and compare with the stored receipt BEFORE the run (seam tracked in task 1031); (c) feature/task terminal-state sanity. ANTI-DRIFT: pre-flight never weakens or skips the gates themselves; it only moves their failure earlier (before partial pipeline execution).
- R4 (timing observability): persist step timings to `.spur/run/<wbs>-timings.json` (gate wall-ms, dispatch→completion per subagent, fan-out mode chosen) so AC-1 is checkable from run records instead of transcript forensics. Reuse the existing `.spur/run` JSON pattern (`diffstat.json`); no new storage surface.

Implementation surface note: this task authorizes edits to `config/workflows/task-pipeline.yaml` (SSOT), `plugins/sp/scripts/quality-gate.ts`, and the inline driver — regenerate the generated copy via `bun run --filter @gobing-ai/spur build:bundle`; never hand-edit `apps/cli/config/` (gitignored). Run `bun run corpus-check` for checker-policy changes.

#### AC-1: Measured improvement, machine-checkable

- G/R: For a comparable 3-task batch, per-task light gate wall ≤120s; full spur-check executed exactly once per feature; small-doc tasks dispatch ≤1 fresh subagent. Evidence: `.spur/run/<wbs>-timings.json` + gate logs from an executed batch, compared against the baseline table above.

#### AC-2: Quality preserved

- G/R: Feature-boundary full `spur-check` passes; touching a file after a PASS receipt invalidates it (receipt reuse fails closed); a `sensitive=true` task still gets full fan-out.

#### AC-3: Wrapup fails fast, not late

- G/R: With the ledger entry removed or a digest mismatch injected, wrapup aborts at pre-flight with the named check id BEFORE any workflow step executes (reproducible from run records).

#### Reference

- Analysis session: I33 batch 2026-09-30; transcript `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-09-30T18-17-02-838Z_01a0f388-c876-7519-9482-a58ecc2ca979.jsonl`
- Sibling tasks: 1031 (digest seam — R3b depends on it), 1032 (advisory sweep)
- Surfaces: `config/workflows/task-pipeline.yaml`, `plugins/sp/scripts/quality-gate.ts`, `plugins/sp/scripts/task-diffstat.ts`, `plugins/sp/scripts/inline-run-setup.ts`, skill `sp:spur-check`, ADR-119

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
