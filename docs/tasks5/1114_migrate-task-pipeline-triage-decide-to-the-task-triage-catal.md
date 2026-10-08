---
schema_version: 1
name: Migrate task-pipeline triage decide to the task-triage catalog decision
status: done
template: feature-impl
created_at: 2026-10-07T16:29:02.797Z
updated_at: "2026-10-08T16:36:33.583Z"
feature_id: P1

dependencies: ["1094"]
tags: ["decision", "workflow"]
priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/1114-verdict.json
---

## 1114. Migrate task-pipeline triage decide to the task-triage catalog decision

### Background

Feature P1, slice S4 (`docs/design/decision-observability-and-adoption.md` §4–§5), one decision point per slice (operator decision 2026-10-06). Split out of task 1094 on 2026-10-07; 1094 ships the catalog-reference `decide` framework this slice uses.

The task-pipeline `triage` state (`config/workflows/task-pipeline.yaml:575`) runs an inline `decide` with id `task-triage`, choices low/standard/high, default `standard`. The bundled catalog entry `task-triage` (`config/decisions/task-pipeline.yaml`) mirrors it with the same choices and fallback. This slice swaps the inline action for a catalog reference. Routing must stay identical: same resultFile, same guards, same fallback.

Blocked until the evidence bar in the feature P1 Entry condition is met for `task-triage` on its effective maker.

**Refine corrections (2026-10-07)**

- Checked anchors: `triage` is at `config/workflows/task-pipeline.yaml:575`, `test-fail-triage` at `:614` and `review-fail-triage` at `:683`. These are the only three `kind: decide` actions in `config/workflows/`. The catalog entry `task-triage` has type `choice`, the same labels and fallback `standard`, and the file-level `minConfidence: 0.8` equals the inline default (`DEFAULT_MIN_CONFIDENCE`), so the accept threshold does not move. Type `choice` means the 1094 `noul` boolean→`yes`/`no` mapping does not apply.
- Prompt change (the plan did not mention it): the catalog form drops the inline `question`. The maker sees the catalog `description` + `criteria` instead. Gathering R0 samples through `spur decision run task-triage` therefore measures the exact prompt the migrated action sends. Inline-form samples from before the migration do **not** count toward the bar.
- Evidence equivalence: 1094 R3 joins the files into `instructions` with the same per-file `redactAndBound(…, DECIDE_EVIDENCE_MAX_CHARS)` bound the inline path uses. The CLI sample path and the workflow path send byte-identical input.
- The R2/E2E claim "off-switch row identical to today" holds field by field: with the switch off, the inline row has `backend: null` and `evidenceDigest: null` (`packages/app/src/workflow/decide.ts:105`), and 1094 R5 produces the same values. Only `durationMs` differs, so the comparison excludes it.
- Priority and estimate were unset → P2, 2 h. The status stays `blocked`: the operator evidence bar (R0) is an unmet start condition, not a refine gap.

### Requirements

- [x] R0. Start condition: the operator records the evidence bar (minimum samples and accepted rate) in this task's Q&A. `spur decision status --reliability --json` on the project database then shows `task-triage` meeting it on the effective maker, counting only samples from a reachable maker (no `no-backend` fallbacks). Cite the report output in Solution. Gather samples with `spur decision run task-triage --param wbs=<wbs> --evidence <file>` over a green-gate diff from a recent task (diffstat JSON plus task spec).
- [x] R1. Replace the inline `decide` in `triage` with `{decision: task-triage, params: {wbs: ${vars.wbs}}, evidence: [...], resultFile: ...}`, keeping evidence `.spur/run/${vars.wbs}-diffstat.json`, `${vars.taskSpecPath}` and resultFile `.spur/run/${vars.wbs}-triage.decision`.
- [x] R2. Guards, the following projection shell and the resultFile path are unchanged. With `workflow.decideDecisionMaker` off, the row is `standard` with `source: default`, `reason: disabled`, exactly as today.
- [x] R3. Regenerate the CLI bundle (`bun run --filter @gobing-ai/spur build:bundle`); `config/workflows/` stays the source of truth.
- [x] R4. Update the §4 audit row for `triage` in the design satellite to "migrated (task 1114)".

### Acceptance Criteria

- [x] AC1 — Workflow decide action resolves a catalog decision by id

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:29:26.599Z

- Evidence bar: _operator to record before start (samples ≥ N, acceptedRate ≥ X on maker M)._

#### Q&A entry — 2026-10-07 operator evidence bar

- **Evidence bar (operator decision, 2026-10-07):** at least **20 samples** with an **accepted rate ≥ 80%** for `task-triage` on its effective maker, in `spur decision status --reliability --json` on the project database. Only samples served by a configured, reachable maker count; `no-backend` fallbacks are excluded (feature P1 Entry condition). The 80% rate matches the catalog `minConfidence: 0.8`, and the same bar applies to all three adoption slices.
- **Status:** the task stays `blocked` until the report meets the bar; no waiver. Report on 2026-10-07: `task-triage` has 0 samples.

#### Q&A entry — 2026-10-08T06:23:32.462Z

- **Operator decision (Robin Min, session approval):** the evidence bar is WAIVED for this slice; the task proceeds on an explicit operator waiver recorded here per the feature P1 entry condition ("A slice that starts without meeting it records an explicit operator waiver there").
- **Measured evidence** (`.spur/run/1114-r0-reliability.json`, `spur decision status --reliability --json` on the project DB): `task-triage` × fm-local — 41 samples, 28 accepted, acceptedRate 68.3% (bar: ≥ 80%), fallbacks all `low-confidence` (13), medianConfidence 1.0, p50 8.4s. The single `no-backend` (typesafe) sample is excluded per the entry condition.
- **Waiver rationale (operator-approved):** the catalog's declared fallback `standard` is field-identical to the inline form's `default: standard`, so below-bar acceptance degrades routing to exactly today's behavior; the migration adds observability and catalog governance without increasing reliance on the model.

- **Waiver residual addendum (review finding #3, 2026-10-08):** accepted-sample lane distribution from `decision_logs` (task-triage × model × accepted, N=28): **low 27, standard 1**. The accepted answers overwhelmingly select the fast lane; the deterministic pre-decide guard pins `safety` for sensitive/>400-line diffs before the decide (`config/workflows/task-pipeline.yaml:640`), so `low` only ever applies to small contained diffs — the fast lane's intended scope — and every non-`low` value takes today's standard path. Degradation direction is unchanged (fail-safe to standard).

### Design

**What.** A YAML-only swap of one `decide` action, from the inline form to the 1094 catalog-reference form. Nothing else in the state changes.

**Frozen action** (`triage` onEnter, replacing the inline block in place):

```yaml
- kind: decide
  options:
      decision: task-triage
      params:
          wbs: ${vars.wbs}
      evidence:
          - .spur/run/${vars.wbs}-diffstat.json
          - ${vars.taskSpecPath}
      resultFile: .spur/run/${vars.wbs}-triage.decision
```

**Invariants.**

- The following projection shell, the guards and the resultFile path are byte-unchanged.
- The off-switch row equals today's row on every field except `durationMs`.
- The `triage` description comment stays accurate. Edit it only if it names the inline `question`.
- `spur workflow validate task-pipeline --json` emits no 1094 deprecation warning for this state.

**Anti-patterns.**

- Do not copy the old `question` into `params`: it is not a catalog parameter, and 1113 pre-validation rejects unknown keys.
- Do not tune the catalog `criteria` in this slice. Doing so would invalidate the R0 samples.
- Do not edit `apps/cli/config/` by hand; it is generated by `build:bundle`.

### Plan

1. Confirm R0 and cite the report; stop if the bar is not met.
2. Edit `config/workflows/task-pipeline.yaml` (`triage`), regenerate the bundle.
3. E2E: run a real task through `spur workflow run task-pipeline` (or the inline driver) to the `triage` state twice: switch off (row `standard`, `reason: disabled`, no `decision.*` events) and switch on with the configured maker (row from the model or a fallback, `decision.start/(success|failure)/end` in `system_events` with `caller: workflow` and the run id). Compare the off-switch row to the pre-change row. Save `.spur/run/1114-decide.json`.
4. `bun run spur-check`.

### Solution

- **R1 — catalog migration** (`config/workflows/task-pipeline.yaml:636`, decide id `:641`): the `triage` inline decide became the catalog-reference form `{id, decision: task-triage, params: {wbs: '${vars.wbs}'}, evidence: ['.spur/run/'${vars.wbs}'-diffstat.json', '${vars.taskSpecPath}'], resultFile: '.spur/run/'${vars.wbs}'-triage.decision'}`. Evidence, resultFile, guards, projection and the `standard` default are unchanged from the inline form; question/choices/fallback live in the bundled catalog (`config/decisions/task-pipeline.yaml:30`, fallback `standard`).
- **R0 — evidence + operator waiver** (`.spur/run/1114-r0-reliability.json`): `task-triage` × fm-local — 41 samples, 28 accepted, acceptedRate 68.3% (bar ≥ 80%), fallbacks all `low-confidence` (13), medianConfidence 1.0, p50 8439ms; the single `no-backend` typesafe sample is excluded per the entry condition. **Operator (Robin Min) waived the bar in-session on 2026-10-07**; the waiver and rationale are recorded in this task's Q&A: the catalog's declared fallback `standard` is field-identical to the inline form's `default: standard`, so below-bar acceptance degrades routing to exactly today's behavior — the migration adds observability and catalog governance without increasing reliance on the model.
- **R2 — off-row contract proven** (`.spur/run/1114-decide.json`): with `workflow.decideDecisionMaker` off, probe run `run-47c28809-f3cd-4008-99bf-2c49fa0f78a8` produced the exact degraded row `standard/default/disabled` (degraded true, backend/confidence/evidenceDigest null). On row (`run-de6f6e34-f30a-4251-b8d7-3056b29cade4`): `standard/model/fm-local`, confidence 1, `accepted`, 10902ms; decision_logs row `task-triage|standard||model|accepted|1.0|fm-local|config-default|shared`.
- **R3 — bundle** regenerated via `bun run --filter @gobing-ai/spur build:bundle`; bundled file diff-identical to source.
- **R4 — satellite** §4 audit row updated: `docs/design/decision-observability-and-adoption.md:221` → "catalog decide — migrated (task 1114, operator waiver on the evidence bar)", anchor `config/workflows/task-pipeline.yaml:603` (state id line; the decide block sits at `:636`).
- **Collateral** — `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts` frozen pin moved from the inline shape (`method/choices/default`) to the catalog form (`decision`, `params.wbs`); `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts` (1116 R5) runs strict — the task-triage waiver entry was deleted when this slice landed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R0 | MET | operator evidence bar of 20 samples at acceptedRate 0.8 on a reachable maker recorded in task Q&A; prior-session receipt (`.spur/run/1114-r0-reliability.json`, gitignored, written 2026-10-08 00:36) shows task-triage on fm-local 41 samples, 28 accepted, 0.683, below the bar, so the slice proceeds on the explicit operator waiver recorded in Q&A; not re-executable this run (the fm-local samples are absent from the current project ledger) |
| R1 | MET | triage decide is the catalog reference `decision: task-triage` with params wbs, the original evidence and resultFile `config/workflows/task-pipeline.yaml:641-651`; catalog entry `config/decisions/task-pipeline.yaml:19` |
| R2 | MET | resultFile path unchanged `config/workflows/task-pipeline.yaml:651`; fallback values match the inline defaults replaced `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:94`; switch-off disabled row from the fallback with no events `packages/app/tests/workflow/actions/decide-catalog.test.ts:211`; fresh run 28 pass / 0 fail |
| R3 | MET | fresh 2026-10-08 `diff -q config/workflows/task-pipeline.yaml apps/cli/config/workflows/task-pipeline.yaml` reports identical; source of truth `config/workflows/task-pipeline.yaml:641-651` |
| R4 | MET | §4 audit row reads migrated `docs/design/decision-observability-and-adoption.md:227` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Workflow decide action resolves a catalog decision by id | MET | test | accepted served result maps onto the frozen row and writes the resultFile `packages/app/tests/workflow/actions/decide-catalog.test.ts:153`; shipped workflow decide actions are catalog references resolving to existing choice decisions `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:85`; fresh run 28 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

## Review — fresh sp-super-reviewer, 2026-10-08 (native subagent, review-only)

**Verdict: PASS-WITH-FINDINGS.** Waiver scrutiny (requested as the batch's riskiest disposition): **sound and honestly recorded** — artifact numbers match the Q&A verbatim; equivalence claim verified in code (`minConfidence: 0.8` ≡ `DEFAULT_MIN_CONFIDENCE`; below-bar → `degradedCatalogRow` → non-`low` → empty mode → standard path, `actions/decide.ts:311-330`); recorded in the contractually correct place (slice Q&A per feature entry condition); residual bounded and measured (see Q&A addendum: accepted lanes low 27 / standard 1, pre-decide guard pins safety before the decide).

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness / ops | Stale GLOBAL registered workflow layer (spur v0.4.0, inline decides) outranks the shared layer for name-based resolution on this machine: `workflow validate task-pipeline` (by name) reads the pre-migration def and warns; `workflow run` by name would execute it. Pre-existing machine state, exposed not caused; affects 1114/1115/1116 equally; path-based validate silent. | `~/.config/spur/config.yaml:363`, `workflow-resolver.ts:96-103` | RESOLVED — 2026-10-08 (verifyall P1): operator global `~/.config/spur/config.yaml` `workflows.paths` switched from the absolute 0.4.0 install path to `bundled:workflows` (the config's own TODO; installed 0.4.0 carries `BUNDLED_PATH_PREFIX`). Name-based `workflow validate task-pipeline` now resolves the `shared` layer with catalog decides task-triage / failure-class / review-failure-class (source and linked CLIs). |
| 2 | P3 (minor) | test integrity | `low/standard/high` vocabulary lost its exact pin (catalog-content pin checked criteria non-empty, not keys) while the projection shell hardcodes `low` — a catalog rename would silently kill the fast lane (fail-safe, but undetected). | `shipped-workflows-catalog-decide.test.ts:88` vs `task-pipeline.yaml:660` | FIXED in-slice — criteria-keys pin added (`['high','low','standard']`) in the 1116-owned gate file. |
| 3 | P3 (minor) | waiver residual | Accepted 68.3%'s lane distribution (esp. `low`→fast-lane share) unmeasured — the other half of what the bar gated. | `.spur/run/1114-r0-reliability.json` | RESOLVED — lane distribution derived from `decision_logs` and recorded in Q&A (low 27 / standard 1, guard-bounded). |
| 4 | P4 (advisory) | satellite accuracy | Sibling-row anchors off by one (`:666`→667, `:749`→750). | `docs/design/decision-observability-and-adoption.md:222-223` | FIXED in-slice — anchors corrected. |
| 5 | P4 (advisory) | batch hygiene | Tracked `.spur/config.yaml` maker override has no owning task for its removal. | `.spur/config.yaml:143-150` | ACCEPTED — restoration at terminal wrap + feature-closure note (batch report). |

Residual risk: global-layer shadow until the operator refreshes the machine install (outside diff); accepted-lane skew (fast-lane preference) guard-bounded and audit-logged.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T16:29:38.239Z backlog → blocked (system)
- 2026-10-07T22:42:55.050Z blocked → todo (system)
- 2026-10-08T07:33:25.180Z todo → wip (system)
- 2026-10-08T07:33:38.233Z wip → testing (system)
- 2026-10-08T07:33:40.921Z testing → done (system)

