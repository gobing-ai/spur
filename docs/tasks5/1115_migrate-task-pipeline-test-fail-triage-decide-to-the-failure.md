---
schema_version: 1
name: Migrate task-pipeline test-fail-triage decide to the failure-class catalog decision
status: done
template: feature-impl
created_at: 2026-10-07T16:29:03.102Z
updated_at: "2026-10-08T05:45:50.075Z"
feature_id: P1

dependencies: ["1094"]
tags: ["decision", "workflow"]
priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/1115-verdict.json
---

## 1115. Migrate task-pipeline test-fail-triage decide to the failure-class catalog decision

### Background

Feature P1, slice S4 (`docs/design/decision-observability-and-adoption.md` §4–§5), one decision point per slice (operator decision 2026-10-06). Split out of task 1094 on 2026-10-07; 1094 ships the catalog-reference `decide` framework this slice uses.

The task-pipeline `test-fail-triage` state (`config/workflows/task-pipeline.yaml:614`) runs an inline `decide` with id `failure-class`, choices fix/stop, default `fix`. The bundled catalog entry `failure-class` (`config/decisions/task-pipeline.yaml`) mirrors it with the same choices and fallback. This slice swaps the inline action for a catalog reference. Routing must stay identical: same resultFile, same guards, same fallback.

Blocked until the evidence bar in the feature P1 Entry condition is met for `failure-class` on its effective maker.

**Refine corrections (2026-10-07)**

- Checked anchors: `triage` is at `config/workflows/task-pipeline.yaml:575`, `test-fail-triage` at `:614` and `review-fail-triage` at `:683`. These are the only three `kind: decide` actions in `config/workflows/`. The catalog entry `failure-class` has type `choice`, the same labels and fallback `fix`, and the file-level `minConfidence: 0.8` equals the inline default (`DEFAULT_MIN_CONFIDENCE`), so the accept threshold does not move. Type `choice` means the 1094 `noul` boolean→`yes`/`no` mapping does not apply.
- Prompt change (the plan did not mention it): the catalog form drops the inline `question`. The maker sees the catalog `description` + `criteria` instead. Gathering R0 samples through `spur decision run failure-class` therefore measures the exact prompt the migrated action sends. Inline-form samples from before the migration do **not** count toward the bar.
- Evidence equivalence: 1094 R3 joins the files into `instructions` with the same per-file `redactAndBound(…, DECIDE_EVIDENCE_MAX_CHARS)` bound the inline path uses. The CLI sample path and the workflow path send byte-identical input.
- The R2/E2E claim "off-switch row identical to today" holds field by field: with the switch off, the inline row has `backend: null` and `evidenceDigest: null` (`packages/app/src/workflow/decide.ts:105`), and 1094 R5 produces the same values. Only `durationMs` differs, so the comparison excludes it.
- Priority and estimate were unset → P2, 2 h. The status stays `blocked`: the operator evidence bar (R0) is an unmet start condition, not a refine gap.

### Requirements

- [x] R0. Start condition: the operator records the evidence bar (minimum samples and accepted rate) in this task's Q&A. `spur decision status --reliability --json` on the project database then shows `failure-class` meeting it on the effective maker, counting only samples from a reachable maker (no `no-backend` fallbacks). Cite the report output in Solution. Gather samples with `spur decision run failure-class --param wbs=<wbs> --evidence <file>` over a recorded quality-gate findings file from a failed run.
- [x] R1. Replace the inline `decide` in `test-fail-triage` with `{decision: failure-class, params: {wbs: ${vars.wbs}}, evidence: [...], resultFile: ...}`, keeping evidence `.spur/run/${vars.wbs}-test-gate.findings` and resultFile `.spur/run/${vars.wbs}-failure-class.decision`.
- [x] R2. Guards, the following projection shell and the resultFile path are unchanged. With `workflow.decideDecisionMaker` off, the row is `fix` with `source: default`, `reason: disabled`, exactly as today.
- [x] R3. Regenerate the CLI bundle (`bun run --filter @gobing-ai/spur build:bundle`); `config/workflows/` stays the source of truth.
- [x] R4. Update the §4 audit row for `test-fail-triage` in the design satellite to "migrated (task 1115)".

### Acceptance Criteria

- [x] AC1 — Workflow decide action resolves a catalog decision by id

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:29:28.730Z

- Evidence bar: _operator to record before start (samples ≥ N, acceptedRate ≥ X on maker M)._

#### Q&A entry — 2026-10-07 operator evidence bar

- **Evidence bar (operator decision, 2026-10-07):** at least **20 samples** with an **accepted rate ≥ 80%** for `failure-class` on its effective maker, in `spur decision status --reliability --json` on the project database. Only samples served by a configured, reachable maker count; `no-backend` fallbacks are excluded (feature P1 Entry condition). The 80% rate matches the catalog `minConfidence: 0.8`, and the same bar applies to all three adoption slices.
- **Status:** the task stays `blocked` until the report meets the bar; no waiver. Report on 2026-10-07: `failure-class` has 0 samples.

### Design

**What.** A YAML-only swap of one `decide` action, from the inline form to the 1094 catalog-reference form. Nothing else in the state changes.

**Frozen action** (`test-fail-triage` onEnter, replacing the inline block in place):

```yaml
- kind: decide
  options:
      decision: failure-class
      params:
          wbs: ${vars.wbs}
      evidence:
          - .spur/run/${vars.wbs}-test-gate.findings
      resultFile: .spur/run/${vars.wbs}-failure-class.decision
```

**Invariants.**

- The following projection shell, the guards and the resultFile path are byte-unchanged.
- The off-switch row equals today's row on every field except `durationMs`.
- The `test-fail-triage` description comment stays accurate. Edit it only if it names the inline `question`.
- `spur workflow validate task-pipeline --json` emits no 1094 deprecation warning for this state.

**Anti-patterns.**

- Do not copy the old `question` into `params`: it is not a catalog parameter, and 1113 pre-validation rejects unknown keys.
- Do not tune the catalog `criteria` in this slice. Doing so would invalidate the R0 samples.
- Do not edit `apps/cli/config/` by hand; it is generated by `build:bundle`.

### Plan

1. Confirm R0 and cite the report; stop if the bar is not met.
2. Edit `config/workflows/task-pipeline.yaml` (`test-fail-triage`), regenerate the bundle.
3. E2E: run a real task through `spur workflow run task-pipeline` (or the inline driver) to the `test-fail-triage` state twice: switch off (row `fix`, `reason: disabled`, no `decision.*` events) and switch on with the configured maker (row from the model or a fallback, `decision.start/(success|failure)/end` in `system_events` with `caller: workflow` and the run id). Compare the off-switch row to the pre-change row. Save `.spur/run/1115-decide.json`.
4. `bun run spur-check`.

### Solution

Migrated the test-fail-triage onEnter decide to the failure-class catalog reference (R0 evidence: failure-class accepted 20/20 samples on fm-local, acceptedRate 1.00 ≥ 0.8, reachable keyless maker; median confidence 1.0).

**The change (config/workflows/task-pipeline.yaml:666, test-fail-triage onEnter):** the inline decide options block (question/choices/default, the R0-deprecated form) is replaced by the catalog-reference form — `id: failure-class`, `decision: failure-class`, `params: {wbs: ${vars.wbs}}`, evidence and resultFile unchanged. Routing is untouched: choices `fix`/`stop`, fallback `fix`, minConfidence 0.8 and the four edges (failed/failed-check, failed/retry-exhausted, test-fix, failed/failed-check) live in the catalog/edges exactly as before.

**E2E proof (decisionMaker off → on, one-state probe .spur/e2e/1115-probe.yaml driving the exact migrated block):** switch off writes the R2 degraded row (`fix`, source default, reason disabled, backend null) — field-identical to the pre-migration inline off-row; switch on resolves through the catalog via fm-local (`fix`, source model, reason accepted, confidence 1) and persists a decision_logs row with caller=workflow, catalog_layer=shared and catalog_source attribution (the probe runs the exact verbatim-identical options block, so the recorded row's `node` is the probe state id `probe`, not the shipped state name). `workflow validate` no longer emits the deprecation warning for test-fail-triage (remaining warnings are the not-yet-migrated 1114/1116 steps). Rows: .spur/run/1115-decide.json.

**Test collateral (behavior preserved; pins updated to the migrated contract):** 0943's frozen-contract test (packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:327) now pins the catalog form (decision id, params, evidence, resultFile) instead of the deleted inline choices/default; the 0503 driver smoke's decisionMaker-off simulation (plugins/sp/tests/inline-pipeline-driver.test.ts:246) sources the degraded row value from the shipped catalog fallback (config/decisions/task-pipeline.yaml:42) instead of the removed inline `default` key, restoring the second test-fix hop its FAIL scenario expects.

### Testing

`bun run spur-check` — PASS (2026-10-07, worktree `sp/runall-p1-723834e9`): lint + typecheck clean; **10493 tests across 617 files, 0 fail** (log: .spur/run/1115-spur-check.log); post-check rules 2/2 passed. Focused re-runs during the slice: task-pipeline-triage-routing (15 tests), inline-pipeline-driver smoke (4 tests), inline-run-trace + cli-surface + agent + workflow-run-from (81 tests) — all green. Two earlier gate attempts flaked 5 unrelated timing-sensitive tests under machine load >30 (concurrent suites in other trees); all passed in isolation and in the final clean run — no code change was involved.

### Review

Phase 7 review by fresh-context sp-super-reviewer, 2026-10-07, scope = uncommitted 1115 diff @ 584fea1de. Verdict **PASS-WITH-FINDINGS** — gate-clearing (no P1/P2; six findings, all dispositioned).

Invariant verification: I1 shell/guards/resultFile byte-identical (only +4 comment lines + options swap) PASS; I2 off-row contract-exact + on-row accepted via fm-local PASS; I3 comment claim-by-claim accurate PASS; I4 `workflow validate` exit 0, no test-fail-triage deprecation warning PASS; I5 bundled copy byte-identical to source PASS; I6 pin-updates only — value contract preserved via DECISIONS_CATALOG source + guard-parity pins (fix/stop) + two test-fix hops in the FAIL scenario PASS; I7 scope clean (6 files; spec diff = system `updated_at` + Solution/Testing only) PASS.

Functional traceability: R0 MET (reliability report: failure-class × fm-local 21/21 accepted, acceptedRate 1.0 ≥ 0.8, medianConfidence 1.0, evidence=recorded); R1-R4 MET; AC1 MET (E2E on-run `reason: accepted`, `source: model`, decisionLog caller=workflow).

Findings (severity per P1–P4 scale):

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | `.spur/config.yaml` maker override is dirty in the tree; must not be committed with 1115 — restore before merge | DEFER (operator restore-before-merge step, planned) |
| P4 | `.spur/e2e/1115-probe.yaml` untracked and not gitignored; would ship under `git add -A` | DEFER (delete at cleanup) |
| P4 | Solution anchor drift: frozen-contract test cited :324, begins :327 | FIXED |
| P4 | Solution wording overstated decisionLog `node` field (row records probe state id) | FIXED |
| P4 | Design "Frozen action" omits `id:` key present in shipped options | ACCEPTED (preserves frozen row-id contract pinned by guard-parity) |
| P4 | State description's retired inline-form parenthetical left as-is | ACCEPTED (Design scoped description edits to only-if-it-names-the-inline-question) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T16:29:38.473Z backlog → blocked (system)
- 2026-10-07T22:43:06.819Z blocked → todo (system)
- 2026-10-08T05:45:50.062Z todo → done (system)

