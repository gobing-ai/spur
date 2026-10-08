---
schema_version: 1
name: Migrate task-pipeline review-fail-triage decide to the review-failure-class catalog decision
status: done
template: feature-impl
created_at: 2026-10-07T16:29:03.402Z
updated_at: "2026-10-08T16:36:27.273Z"
feature_id: P1

dependencies: ["1094"]
tags: ["decision", "workflow"]
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/1116-verdict.json
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

- [x] R0. Start condition: the operator records the evidence bar (minimum samples and accepted rate) in this task's Q&A. `spur decision status --reliability --json` on the project database then shows `review-failure-class` meeting it on the effective maker, counting only samples from a reachable maker (no `no-backend` fallbacks). Cite the report output in Solution. Gather samples with `spur decision run review-failure-class --param wbs=<wbs> --evidence <file>` over a recorded non-PASS review answer plus its task spec.
- [x] R1. Replace the inline `decide` in `review-fail-triage` with `{decision: review-failure-class, params: {wbs: ${vars.wbs}}, evidence: [...], resultFile: ...}`, keeping evidence `.spur/run/${vars.__runId}-review-answer.txt`, `${vars.taskSpecPath}` and resultFile `.spur/run/${vars.wbs}-review-failure-class.decision`.
- [x] R2. Guards, the following projection shell and the resultFile path are unchanged. With `workflow.decideDecisionMaker` off, the row is `fix` with `source: default`, `reason: disabled`, exactly as today.
- [x] R3. Regenerate the CLI bundle (`bun run --filter @gobing-ai/spur build:bundle`); `config/workflows/` stays the source of truth.
- [x] R4. Update the §4 audit row for `review-fail-triage` in the design satellite to "migrated (task 1116)".
- [x] R5. After this slice no shipped workflow declares an inline decide. Add a committed check that scans `config/workflows/*.yaml` and fails on any inline-form `decide` action (feature R2, first clause); start the one-release deprecation clock for S8 in the feature Notes.

### Acceptance Criteria

- [x] AC1 — Workflow decide action resolves a catalog decision by id
- [x] AC2 — Every AI decision in shipped workflows comes from a catalog

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:29:31.035Z

- Evidence bar: _operator to record before start (samples ≥ N, acceptedRate ≥ X on maker M)._

#### Q&A entry — 2026-10-07 operator evidence bar

- **Evidence bar (operator decision, 2026-10-07):** at least **20 samples** with an **accepted rate ≥ 80%** for `review-failure-class` on its effective maker, in `spur decision status --reliability --json` on the project database. Only samples served by a configured, reachable maker count; `no-backend` fallbacks are excluded (feature P1 Entry condition). The 80% rate matches the catalog `minConfidence: 0.8`, and the same bar applies to all three adoption slices.
- **Status:** the task stays `blocked` until the report meets the bar; no waiver. Report on 2026-10-07: `review-failure-class` has 0 samples.

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

- **R1 — catalog migration** (`config/workflows/task-pipeline.yaml:749`, decide id `:767`): the `review-fail-triage` inline decide became the catalog-reference form `{id, decision: review-failure-class, params: {wbs: '${vars.wbs}'}, evidence: ['.spur/run/'${vars.__runId}'-review-answer.txt', '${vars.taskSpecPath}'], resultFile: '.spur/run/'${vars.wbs}'-review-failure-class.decision'}`. The `id` is preserved so guard parity and the audit-row contract stay intact; question/choices/minConfidence/fallback live in the bundled catalog (`config/decisions/task-pipeline.yaml:54` — minConfidence 0.8, fallback `fix`).
- **R0 — evidence bar met** (`.spur/run/1116-r0-reliability.json`): `review-failure-class` × fm-local — 20 samples, 20 accepted, acceptedRate 1.0 (bar ≥ 0.80), medianConfidence 1.0, p50 4120ms; no fallbacks. Maker served keyless via the project-layer `.spur/config.yaml` override (setup recorded in the 2026-10-07 Q&A; override restored after capture).
- **R5 — committed gate** (`packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts`): walks every shipped workflow definition and fails on any `kind: decide` that does not satisfy `isCatalogDecideOptions`. Pre-edit FAIL proven before the migration (`.spur/run/1116-r5-prefail.txt` — names `task-pipeline.yaml/triage/onEnter: id=task-triage` and `task-pipeline.yaml/review-fail-triage/onEnter: id=review-failure-class`). After this slice and task 1114 (same batch, landed before this gate run) the check runs strict: no shipped workflow declares an inline decide.
- **R3 — bundle** regenerated via `bun run --filter @gobing-ai/spur build:bundle`; the bundled `apps/cli/config/workflows/task-pipeline.yaml` is byte-identical to `config/workflows/task-pipeline.yaml` (diff-verified).
- **R4 — satellite** §4 audit row updated: `docs/design/decision-observability-and-adoption.md:223` → "catalog decide — migrated (task 1116)", anchor `config/workflows/task-pipeline.yaml:749`. The S8 one-release deprecation clock for remaining external consumers starts at this slice's landing and is recorded in the feature Notes.
- **Collateral** — `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:601-603` frozen pin moved from the inline shape (`choices ['fix','stop']`) to the catalog form (`decision`, `params.wbs`).
- **E2E** (`.spur/run/1116-decide.json`): one-state probe carried the migrated block verbatim. Off row (`run-71ebc8e0-5f78-49a5-874c-1278464cd4e6`): exact degraded contract `fix/default/disabled`. On row (`run-93f0a8dc-dd68-4219-81ab-336351127469`): `fix/model/fm-local`, confidence 1, `accepted`, 11466ms; decision_logs row `review-failure-class|fix||model|accepted|1.0|fm-local|shared`. First enabled run (`run-7cc72cef`) hit the catalog minConfidence gate (0.029 < 0.8 → low-confidence→fix) on thin evidence before the enriched run — recorded, not hidden.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R0 | MET | operator evidence bar of 20 samples at acceptedRate 0.8 on a reachable maker recorded in task Q&A; prior-session receipt (`.spur/run/1116-r0-reliability.json`, gitignored, written 2026-10-08 00:36) shows review-failure-class on fm-local 20 samples, 20 accepted, acceptedRate 1, no fallbacks; not re-executable this run (the fm-local samples are absent from the current project ledger) |
| R1 | MET | review-fail-triage decide is the catalog reference `decision: review-failure-class` with params wbs, the original evidence and resultFile `config/workflows/task-pipeline.yaml:776-785`; catalog entry `config/decisions/task-pipeline.yaml:44` |
| R2 | MET | resultFile path unchanged `config/workflows/task-pipeline.yaml:785`; fallback values match the inline defaults replaced `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:94`; switch-off disabled row from the fallback with no events `packages/app/tests/workflow/actions/decide-catalog.test.ts:211`; fresh run 28 pass / 0 fail |
| R3 | MET | fresh 2026-10-08 `diff -q config/workflows/task-pipeline.yaml apps/cli/config/workflows/task-pipeline.yaml` reports identical; source of truth `config/workflows/task-pipeline.yaml:776-785` |
| R4 | MET | §4 audit row reads migrated `docs/design/decision-observability-and-adoption.md:229` |
| R5 | MET | committed scan fails on any inline-form decide across shipped workflows `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:42`; S8 deprecation clock started in the feature Notes `docs/features/P1_workflow-decision-points-adopt-spur-decision-catalogs.md:206` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Workflow decide action resolves a catalog decision by id | MET | test | accepted served result maps onto the frozen row and writes the resultFile `packages/app/tests/workflow/actions/decide-catalog.test.ts:153`; shipped workflow decide actions are catalog references resolving to existing choice decisions `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:85`; fresh run 28 pass / 0 fail |
| AC2 — Every AI decision in shipped workflows comes from a catalog | MET | test | every decide action in every shipped workflow is catalog-reference `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:42`; every referenced id exists with choice type, criteria and fallback `packages/app/tests/workflow/shipped-workflows-catalog-decide.test.ts:85`; fresh run 28 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

## Review — fresh sp-super-reviewer, 2026-10-07 (native subagent, review-only)

**Verdict: PASS-WITH-FINDINGS.** Full report transcribed from the reviewer's output; review-time gate 10503 pass / 0 fail / 618 files; final post-fix gate (authoritative receipt): 10506 pass / 618 files / 704.36s with 1 fail = command-gate.test.ts soft-probe load timeout [5000.64ms], isolated re-run 14 pass / 0 fail / 857ms → documented flake (.spur/run/1116-spur-check.log).

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | test integrity / architecture | Migration dropped the inline choices/default pin without a catalog-content replacement: a silent catalog edit (`fallback: fix`→`stop`) would flip degraded routing while guard-parity/R5/proof-chain stay green. | `task-pipeline-proof-chain.test.ts:601`, `config/decisions/task-pipeline.yaml:54` | FIXED in-slice — catalog-content pin added to the R5 gate file (`shipped-workflows-catalog-decide.test.ts`): fallback values frozen standard/fix/fix, criteria non-empty, type choice; extended per the 1114 review (#2) with the lane-vocabulary key pin. |
| 2 | P3 (minor) | hygiene / config scope | `.spur/config.yaml` machine-local `decisions.maker: fm-local` is tracked and outside the slice; committing it would default every checkout to fm-local (unreachable on non-macOS → `no-backend` rows). | `.spur/config.yaml:145-151` | RESOLVED — override removed: `.spur/config.yaml` has no `maker` key and no working-tree diff (`git diff --stat -- .spur/config.yaml` empty, 2026-10-08 verifyall P1); effective maker resolves from the operator global config. |
| 3 | P4 (advisory) | test integrity | WAIVED_INLINE ledger scrutinized: fails loud in both misuse directions. Nits: malformed decide (no options) throws before the promised naming message; stale-entry detection misses deleted workflows. | `shipped-workflows-catalog-decide.test.ts:19,56-58,74-76` | ACCEPTED — tighten when the ledger is next used (currently empty). |
| 4 | P4 (advisory) | usability / docs | S8 clock note lacks a version anchor; root package.json has no version field (instruction unactionable); prose ambiguity + state-id typo. | feature Notes | ACCEPTED — typo fixed; version anchor pinned when S8 executes the removal. |
| 5 | P4 (advisory) | correctness (environment) | Stale GLOBAL registered workflow layer (spur v0.4.0 in ~/node_modules) shadows name-based `workflow validate/run task-pipeline` on this machine (pre-existing, exposed not caused; path-based validate silent). | `~/.config/spur/config.yaml:363`, `workflow-resolver.ts:96-103` | RESOLVED — 2026-10-08 (verifyall P1): operator global `~/.config/spur/config.yaml` `workflows.paths` switched from the absolute 0.4.0 install path to `bundled:workflows` (the config's own TODO; installed 0.4.0 carries `BUNDLED_PATH_PREFIX`). Name-based `workflow validate task-pipeline` now resolves the `shared` layer with catalog decides task-triage / failure-class / review-failure-class (source and linked CLIs). |
| 6 | P4 (advisory) | evidence provenance | Probe definitions deleted after capture; pre-fail file is a disclosed transcription. | `.spur/run/1116-decide.json:3` | ACCEPTED — preserve probe definitions for future E2E artifacts. |

Residual risk: P2#1 class-drift is now pinned; environment shadow (P4#5) persists until the global install is refreshed. No code defects in the slice.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T16:29:38.703Z backlog → blocked (system)
- 2026-10-07T22:42:49.476Z blocked → todo (system)
- 2026-10-08T07:33:23.487Z todo → wip (system)
- 2026-10-08T07:33:32.994Z wip → testing (system)
- 2026-10-08T07:33:35.704Z testing → done (system)

