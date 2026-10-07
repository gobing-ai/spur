---
schema_version: 1
name: Migrate task-pipeline review-fail-triage decide to the review-failure-class catalog decision
status: blocked
template: feature-impl
created_at: 2026-10-07T16:29:03.402Z
updated_at: "2026-10-07T17:23:42.063Z"
feature_id: P1

dependencies: ["1094"]
tags: ["decision", "workflow"]
priority: P2
estimate_hours: 3
---

## 1116. Migrate task-pipeline review-fail-triage decide to the review-failure-class catalog decision

### Background

Feature P1, slice S4 (`docs/design/decision-observability-and-adoption.md` §4–§5), one decision point per slice (operator decision 2026-10-06). Split out of task 1094 on 2026-10-07; 1094 ships the catalog-reference `decide` framework this slice uses.

The task-pipeline `review-fail-triage` state (`config/workflows/task-pipeline.yaml:683`) runs an inline `decide` with id `review-failure-class`, choices fix/stop, default `fix`. The bundled catalog entry `review-failure-class` (`config/decisions/task-pipeline.yaml`) mirrors it with the same choices and fallback. This slice swaps the inline action for a catalog reference. Routing must stay identical: same resultFile, same guards, same fallback.

Blocked until the evidence bar in the feature P1 Entry condition is met for `review-failure-class` on its effective maker.

**Refine corrections (2026-10-07)**

- Checked anchors: `triage` is at `config/workflows/task-pipeline.yaml:575`, `test-fail-triage` at `:614` and `review-fail-triage` at `:683`. These are the only three `kind: decide` actions in `config/workflows/`. The catalog entry `review-failure-class` has type `choice`, the same labels and fallback `fix`, and the file-level `minConfidence: 0.8` equals the inline default (`DEFAULT_MIN_CONFIDENCE`), so the accept threshold does not move. Type `choice` means the 1094 `noul` boolean→`yes`/`no` mapping does not apply.
- Prompt change (the plan did not mention it): the catalog form drops the inline `question`. The maker sees the catalog `description` + `criteria` instead. Gathering R0 samples through `spur decision run review-failure-class` therefore measures the exact prompt the migrated action sends. Inline-form samples from before the migration do **not** count toward the bar.
- Evidence equivalence: 1094 R3 joins the files into `instructions` with the same per-file `redactAndBound(…, DECIDE_EVIDENCE_MAX_CHARS)` bound the inline path uses. The CLI sample path and the workflow path send byte-identical input.
- The R2/E2E claim "off-switch row identical to today" holds field by field: with the switch off, the inline row has `backend: null` and `evidenceDigest: null` (`packages/app/src/workflow/decide.ts:105`), and 1094 R5 produces the same values. Only `durationMs` differs, so the comparison excludes it.
- Priority and estimate were unset → P2, 3 h. The status stays `blocked`: the operator evidence bar (R0) is an unmet start condition, not a refine gap.

### Requirements

- [ ] R0. Start condition: the operator records the evidence bar (minimum samples and accepted rate) in this task's Q&A. `spur decision status --reliability --json` on the project database then shows `review-failure-class` meeting it on the effective maker, counting only samples from a reachable maker (no `no-backend` fallbacks). Cite the report output in Solution. Gather samples with `spur decision run review-failure-class --param wbs=<wbs> --evidence <file>` over a recorded non-PASS review answer plus its task spec.
- [ ] R1. Replace the inline `decide` in `review-fail-triage` with `{decision: review-failure-class, params: {wbs: ${vars.wbs}}, evidence: [...], resultFile: ...}`, keeping evidence `.spur/run/${vars.__runId}-review-answer.txt`, `${vars.taskSpecPath}` and resultFile `.spur/run/${vars.wbs}-review-failure-class.decision`.
- [ ] R2. Guards, the following projection shell and the resultFile path are unchanged. With `workflow.decideDecisionMaker` off, the row is `fix` with `source: default`, `reason: disabled`, exactly as today.
- [ ] R3. Regenerate the CLI bundle (`bun run --filter @gobing-ai/spur build:bundle`); `config/workflows/` stays the source of truth.
- [ ] R4. Update the §4 audit row for `review-fail-triage` in the design satellite to "migrated (task 1116)".
- [ ] R5. After this slice no shipped workflow declares an inline decide. Add a committed check that scans `config/workflows/*.yaml` and fails on any inline-form `decide` action (feature R2, first clause); start the one-release deprecation clock for S8 in the feature Notes.

### Acceptance Criteria

- [ ] AC1 — Workflow decide action resolves a catalog decision by id
- [ ] AC2 — Every AI decision in shipped workflows comes from a catalog

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:29:31.035Z

- Evidence bar: _operator to record before start (samples ≥ N, acceptedRate ≥ X on maker M)._

### Design

**What.** A YAML-only swap of one `decide` action, from the inline form to the 1094 catalog-reference form. Nothing else in the state changes.

**Frozen action** (`review-fail-triage` onEnter, replacing the inline block in place):

```yaml
- kind: decide
  options:
      decision: review-failure-class
      params:
          wbs: ${vars.wbs}
      evidence:
          - .spur/run/${vars.__runId}-review-answer.txt
          - ${vars.taskSpecPath}
      resultFile: .spur/run/${vars.wbs}-review-failure-class.decision
```

**Invariants.**

- The following projection shell, the guards and the resultFile path are byte-unchanged.
- The off-switch row equals today's row on every field except `durationMs`.
- The `review-fail-triage` description comment stays accurate. Edit it only if it names the inline `question`.
- `spur workflow validate task-pipeline --json` emits no 1094 deprecation warning for this state.

**Anti-patterns.**

- Do not copy the old `question` into `params`: it is not a catalog parameter, and 1113 pre-validation rejects unknown keys.
- Do not tune the catalog `criteria` in this slice. Doing so would invalidate the R0 samples.
- Do not edit `apps/cli/config/` by hand; it is generated by `build:bundle`.

**R5 check (frozen).** Add `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts`:

- It parses every `config/workflows/*.yaml` and walks every `onEnter`/`onExit` action.
- It asserts that every `kind: decide` action satisfies `isCatalogDecideOptions` (1094 R1). On failure it names the file, the state and the inline id.
- It must fail on the pre-1116 tree (because of `review-fail-triage`) and pass after. Run it once before the edit to prove this.

The S8 deprecation clock goes in the feature Notes through `spur feature update P1` (never a direct write), with the release version from root `package.json`.

### Plan

1. Confirm R0 and cite the report; stop if the bar is not met.
2. Edit `config/workflows/task-pipeline.yaml` (`review-fail-triage`), regenerate the bundle.
3. E2E: run a real task through `spur workflow run task-pipeline` (or the inline driver) to the `review-fail-triage` state twice: switch off (row `fix`, `reason: disabled`, no `decision.*` events) and switch on with the configured maker (row from the model or a fallback, `decision.start/(success|failure)/end` in `system_events` with `caller: workflow` and the run id). Compare the off-switch row to the pre-change row. Save `.spur/run/1116-decide.json`.
4. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T16:29:38.703Z backlog → blocked (system)

