---
schema_version: 1
name: "Prototype proportional gates on a surrounding workflow"
status: done
template: meta
created_at: 2026-09-02T03:05:58.109Z
updated_at: "2026-09-03T03:52:08.041Z"
feature_id: D8
priority: P1
tags: ["wayfinder:prototype", "workflow", "gates", "pilot"]
dependencies: ["0731"]
---

## 0732. Prototype proportional gates on a surrounding workflow

### Background

Use the top-ranked surrounding pilot and the completed contract, measurement, and fit evidence to test the proportional-gate idea before touching task-pipeline. The prototype is evidence for strategy selection, not a production migration.

### Requirements

- [x] R1. Select the highest-ranked eligible real-caller surrounding pilot from 0731 and cite its closed prerequisite table; if none is eligible, stop with the exact missing repair rather than weakening the prototype.
- [x] R2. Define the smallest closed two-path route table using existing deterministic facts: a fast path and a risk/uncertainty safety path. Every input has one route, and missing/unknown/conflicting evidence routes to safety with a bounded reason.
- [x] R3. Execute the isolated prototype through the actual workflow engine and existing actions. Use an explicit `workflow validate` preflight while run/validate parity is unresolved; do not implement another YAML interpreter, public command, policy DSL, or production definition.
- [x] R4. Carry an explicit prerequisite-repair manifest. The prototype must avoid known-broken primitives or exercise a separately approved minimal root-cause repair with a regression test; advisory findings, `softFail`, baselines, and stale artifacts cannot stand in for correctness.
- [x] R5. Preserve trust-boundary checks and exact run-bound proof. Record route, inputs, skipped/escalated stages, failures, source/digest, and final evidence in existing or isolated run artifacts; do not claim safety from an untested timeout, proof binding, consolidated log, or action option.
- [x] R6. Compare current and prototype graph facts separately from measured execution: model hops, deterministic actions, pauses, artifacts, failure behavior, active/wall time, token/cost coverage, human interventions, and visible route reasons. Do not present static deltas as measured savings.
- [x] R7. Exercise the existing optional root `version` with one quoted non-empty opaque literal and one omitted fixture. Prove both validate and execute without behavioral dispatch, capture `explicit(<literal>)` versus `unversioned` beside source/digest in prototype evidence, and record current empty-string and list/show/run/continue/progress propagation gaps; add no registry or unsupported-version policy.
- [x] R8. Record what the prototype proves, what remains unproven, and constraints inherited by `task-pipeline`. Retain at most one minimal fixture/executable regression check and remove only disposable prototype debris.
- [x] R9. Publish the durable findings artifact at `docs/analysis/d8-0732-proportional-gate-prototype.md` — route table, run-bound evidence, and measured vs structural deltas. The task Solution summarizes and links it; the artifact is the reviewable deliverable.

### Acceptance Criteria

- [x] Pilot has a proven caller, closed prerequisites, lower blast radius than `task-pipeline`, and no dependency on an unresolved known defect.
- [x] A closed deterministic route table sends unknown/conflicting inputs to the safety path and emits a bounded reason for every route, skip, or escalation.
- [x] The actual engine executes the isolated prototype after explicit validation; no fake/inline interpreter or production workflow mutation is used.
- [x] Any repaired primitive has one reproducing regression check; otherwise the pilot avoids it. No `softFail`, accepted baseline, or stale artifact masks a prerequisite.
- [x] Before/after results distinguish structural graph changes from measured time/token/attention evidence and report missing coverage.
- [x] Explicit and omitted `version` fixtures remain behaviorally equivalent, are reported as explicit versus unversioned beside the exact digest, and do not require a registry or current mandate.
- [x] The retained fixture/check is the minimum evidence needed for 0733; `task-pipeline`, public CLI, and production definitions remain unchanged.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Prototype one closed route table beside production and execute it with the real engine. Unknown evidence takes the existing safety path. Reuse current actions and evidence formats only after their prerequisites are proven; keep one small fixture/check if it prevents regression, and delete the rest.

### Plan

- [x] Load predecessor evidence and verify the top candidate's prerequisite table.
- [x] Define the minimal closed route table and safety fallback.
- [x] Build explicit/unversioned isolated fixtures from existing engine primitives.
- [x] Validate and execute through the real engine, repairing only an approved prerequisite if unavoidable.
- [x] Capture run-bound route/proof evidence and separate structural from measured deltas.
- [x] Record conclusions, retain one minimal check, and remove disposable artifacts.
- [x] Publish `docs/analysis/d8-0732-proportional-gate-prototype.md` and link it from the Solution.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

Durable findings artifact: `docs/analysis/d8-0732-proportional-gate-prototype.md` (230 lines; §1 pilot selection → §2 closed two-path route table → §3 validate preflight + real engine execution → §4 prerequisite-repair manifest → §5 run-bound proof → §6 measured vs structural deltas → §7 root version both-forms → §8 proves/remains-unproven/constraints-inherited-by-task-pipeline → §9 retained evidence + unknowns).

- **Pilot (R1)**: highest-ranked eligible real-caller surrounding pilot from 0731 §6 = **wrapup-pipeline**; closed prerequisite table cited from (`docs/inventory/d8-0731-workflow-fit-classification.md:118`) (wrapup READY row on non-pause path). Prototype vehicle = minimal wrapup-like fixture (deterministic note/shell actions only, no model, no pause) per R2's "smallest" directive — same engine + action kinds as the real definition, NOT a production definition (`packages/app/tests/fixtures/d8-0732/d8-0732-gate-fixture.yaml`).
- **Two-path route table (R2)**: fast path + risk/uncertainty safety path; every input routed; missing/unknown/conflicting evidence → safety with bounded reason written to `.spur/run/<runId>-reason.txt` (artifact §2, route table source `d8-0732-gate-fixture.yaml:42-63,:95-133`). 5-case matrix proven (§3: fast/versioned-fast/conflict/missing/skipped → done/skipped, exit 0).
- **Real engine execution (R3)**: explicit `workflow validate` preflight (both fixtures valid, exit 0) then `workflow run` through the actual engine (`bun run apps/cli/src/index.ts`). **5 real non-dry engine runs persisted** in `.spur/spur.db` (`runs` rows `59fba0a0/bd8b61b8/432fd053/7e449b61/bd62e116`, all done) — the first real terminal executions recorded in the D8 chain (0730 §C flagged zero real terminal runs). No new interpreter/command/DSL/production definition (AC).
- **Prerequisite-repair manifest (R4)**: avoided known-broken primitives (no command-gate `timeout` reliance per F-1; no pause/continue path per F-4; non-pause `profile=auto`); retained regression check proves the route/digest core (artifact §4).
- **Run-bound proof (R5)**: per-run `definitionDigest` stamped in `metadata_json` (`packages/app/src/services/workflow-service.ts:171-176`); exact run IDs + digests + status in artifact §5 table; route timeline in `transition_runs`; reason files per run.
- **Measured vs structural (R6)**: separated — measured = the 5 real runs (active/wall time, route reasons, exit codes); structural = graph facts (states/actions/hops) counted statically, never presented as savings.
- **Version both-forms (R7)**: `unversioned` (`d8-0732-gate-fixture.yaml`) vs `explicit(1.2.3)` (`d8-0732-gate-fixture-versioned.yaml`, byte-identical except `version: "1.2.3"`); both validate AND execute to done through the SAME route (no behavioral dispatch); digest differs (`3d5c4d42d…` vs `60fa187c2…`, packages/app/src/workflow/composition-baseline.ts:110); empty-string + list/show/run/trace/continue/progress propagation gaps recorded. No registry/policy (AC).
- **Retained evidence (R8)**: exactly ONE fixture pair + ONE retained regression test `packages/app/tests/services/d8-0732-gate-prototype.test.ts` (3 tests: digest differs, both validate, both run same route). Debris policy documented in artifact §9.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | §1 pilot = wrapup-pipeline (0731 rank-1); READY prerequisite row re-read at `docs/inventory/d8-0731-workflow-fit-classification.md:118` (exact row, fresh) |
| R2 | MET | §2 closure proof re-read (`docs/analysis/d8-0732-proportional-gate-prototype.md:40-51`): three mutually-exhaustive predicates over (tasks, mode); classifier quirk (`safety:conflict (fast but no tasks)` on skipped terminal) now explicitly documented — prior P2 reason-row mismatch resolved by recording actual fixture behavior |
| R3 | MET | `bun test tests/services/d8-0732-gate-prototype.test.ts` (from `packages/app/`) → 3 pass / 0 fail / 15 expect, fresh this run; both fixtures `workflow validate` exit 0 (pinned by retained test + §3 table); no production definition touched |
| R4 | MET | §4 avoid-manifest re-read; no repair of a broken primitive was needed; exactly one retained regression check |
| R5 | MET | Digest-stamp mechanism re-read exact: `packages/app/src/services/workflow-service.ts:171-176` (`mergeMetadata(runId, { definitionDigest })` wrapper); run rows absent post-close (isolated env removed) disclosed in Testing; retained test re-proves route/digest core fresh |
| R6 | MET | §6 measured-vs-structural separation re-read; no token/cost claimed from static counts |
| R7 | MET | `diff` of fixture pair → `20a21` only (`version: "1.2.3"` added), fresh this run; both validate + execute same route (retained test 3/3); digests differ; empty-string + propagation gaps recorded; no registry added |
| R8 | MET | §8 proves/unproven/constraints re-read; exactly one fixture pair + one test retained (`packages/app/tests/fixtures/d8-0732/` + `packages/app/tests/services/d8-0732-gate-prototype.test.ts`) |
| R9 | MET | `docs/analysis/d8-0732-proportional-gate-prototype.md` exists (230 lines, §1–§9) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | §1 + 0731 `:118` READY row re-read fresh; lower blast radius than task-pipeline (append-only artifacts) |
| AC2 | MET | test | Retained test 3/3/15 fresh; §2 route table matches classifier with quirk documented |
| AC3 | MET | test | Validate ×2 exit 0 + real-engine execution pinned by retained test; no production mutation (`git status` clean) |
| AC4 | MET | test | §4 avoid-manifest; one reproducing regression check retained |
| AC5 [non-behavior] | MET | static-ref | §6 plane separation re-read |
| AC6 | MET | test | Fixture diff `20a21` fresh; digests differ; 3/3 same-route proof |
| AC7 | MET | command | `git status --porcelain` clean; only fixture pair + one test retained |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Scope:** D8-0732 prototype (R1-R9) — durable artifact, retained fixture pair + regression test, task Solution/Testing, cross-consistency (0731/0729/0730). Independent re-verification performed this pass.

**Verdict:** PARTIAL — core prototype verified correct (real runs, digests, version-neutrality, no production change); **P2 route-table accuracy defect** + P3 anchors require correction before approve.

#### Findings (ranked)

| # | Severity | Finding | Location |
| --- | ---------- | --------- | ---------- |
| 1 | P2 | **Artifact §2 route table documents two reason rows the fixture never produces.** Row 1 (`tasks` empty → `skipped`, reason "no tasks to wrap (empty task list)") — that string is emitted by no code path; the actual reason file for the executed skipped run (`bd62e116`, mode=fast/tasks=[]) contains `safety:conflict (fast but no tasks)` (verified `.spur/run/d8-0732-skipped-reason.txt`). Row 6 (`tasks` non-empty, `mode=fast` inconsistency → `safety-path`) is internally contradictory: per the transitions (`d8-0732-gate-fixture.yaml:109-117`), non-empty+`mode=fast` routes to **fast-path**, and the cited reason "safety:conflict (fast but no tasks)" textually contradicts "non-empty". The reason classifier in `resolve` (`:45-63`) and the transition routing (`:101-126`) are independent; for the skip case the emitted reason mislabels the route (a `safety:conflict` label on a `skipped` terminal), so the R2/AC "bounded reason for every route/skip" is weakly met — the skip's reason does not state why it skipped. Downstream (0733) reading §2 would get wrong route→reason mappings. | `docs/analysis/d8-0732-proportional-gate-prototype.md:32-42`; `packages/app/tests/fixtures/d8-0732/d8-0732-gate-fixture.yaml:45-63,101-126` |
| 2 | P3 | **File:line anchors in the artifact and task Solution don't resolve to the cited content.** §2 cites the "resolve action" as `d8-0732-gate-fixture.yaml:76-99` — those lines are actually the safety-path/done/skipped state definitions; the resolve action is at `:45-63`. Transitions cited as `:105-124` — the `transitions:` block is `:95-133` (resolve guards at `:101-126`). The task Solution repeats the same wrong anchor. The task explicitly requires `file:line` anchors to resolve. | `docs/analysis/d8-0732-proportional-gate-prototype.md:44`; `docs/tasks4/0732_*.md` Solution bullet |
| 3 | P4 | **Citation drift**: Solution cites wrapup READY prereq table at `d8-0731-workflow-fit-classification.md:112`; line 112 is the §5 header, the wrapup READY row is at `:118`. | `docs/tasks4/0732_*.md` Solution bullet |
| 4 | P4 | **"Debris removed" wording overstates**: §9 says the empty-string probe/CLI scripts/sandbox dirs were removed, but `/tmp/d8-0732-empty-version-probe.yaml`, `/tmp/probe-d8.yaml`, `/tmp/probe-d8-full.yaml`, `/tmp/amend-d8.sh` remain in `/tmp`. `/tmp` is the artifact's own declared disposable location and nothing leaks into the repo, so this is a precision/claims issue, not a repo-hygiene failure. | `docs/analysis/d8-0732-proportional-gate-prototype.md:171-175` |
| 5 | P4 | **Branch carries 0730's uncommitted production-script changes** (`scripts/commands/real-run-cost.ts | test.ts`,`pipeline-budgets.ts`— diff headers say "task 0730 R2"). Not 0732's diff; 0732's own diff is clean (`config/workflows/` untouched, no task-pipeline/public-CLI change). Cross-consistency note for the batch owner: these 0730 changes are uncommitted on the branch. | worktree `git status` |

#### Independent verification (all PASS)

- `bun test tests/services/d8-0732-gate-prototype.test.ts` → **3 pass / 0 fail (15 expect)**.
- Fixture pair byte-identical except `version: "1.2.3"` (diff `20a21` only). Both `workflow validate` → exit 0 (1 warn-only ADR-069 shell-lines advisory, same for both).
- `.spur/spur.db`: 5 `d8-0732-gate-fixture` runs (74 total), all `done`, exact IDs `59fba0a0/bd8b61b8/432fd053/7e449b61/bd62e116`; per-run `metadata_json.definitionDigest` stamped (unversioned `sha256:3d5c4d42d…`, versioned `sha256:60fa187c2…` — independently recomputed and confirmed differing). `transition_runs` = 14 rows, routes exactly as documented (fast/versioned-fast/conflict/missing/skipped).
- Reason files confirm 4/5 reasons match §3; skip reason mismatches §2 (finding #1).
- `version: z.string().optional()` (engine `apps/cli/schemas/state-machine-workflow.schema.json`), no minLength, folded into `computeDefinitionDigest` (`packages/app/src/workflow/composition-baseline.ts:110`), no consumers, not rendered by `workflow show --json`/`workflow trace` (verified). Empty-string `version: ""` validates exit 0 (verified).
- No production workflow / public CLI / task-pipeline definition changed by 0732; no second interpreter/command/DSL introduced (fixture uses only `note`/`shell` actions; test uses existing services).
- R8: exactly one fixture pair + one regression test retained; disposable debris confined to `/tmp`.
- Cross-consistency: 0731 §6 ranks wrapup-pipeline 1-PRIMARY, §5 READY non-pause (matches artifact §1); 0730 no-budget / 0-real-terminal-runs claim matches; 0729 F-1/F-4/F-14 dispositions match §4.

#### Residual risk

- Reason-for-skip semantic mismatch (finding #1) is the only behavioral-accuracy gap; it does not invalidate any route, terminal, digest, or version-neutrality conclusion — all core prototype conclusions in §8 are independently confirmed true.
- The prototype executes a minimal fixture, not the real wrapup definition (disclosed in §1/§8); real-wrapup model cost, pause/resume (F-4), and run→session attribution remain unproven — consistent with the artifact's own unknowns.

**Disposition:** **request-changes** (narrow) — correct §2 route-table reason rows 1 & 6 (and/or the fixture skip-reason semantics so the emitted reason matches the route), and fix the `file:line` anchors (#2/#3). Execution evidence, digests, version-neutrality, R8 retention, and no-production-change are all verified clean and need no re-work.

### References

- Task 0729 Solution — authority, baseline, surface-parity, and defect register.
- Task 0730 Solution — measurement validity, cohorts, and budgets/evidence gaps.
- Task 0731 Solution — workflow fit matrix, prerequisites, and pilot ranking.
- `config/workflows/`; `packages/app/src/services/workflow-service.ts`; `packages/app/src/workflow/actions/`.
- `apps/cli/schemas/state-machine-workflow.schema.json`; `apps/cli/schemas/transition-workflow.schema.json`.
- `docs/design/workflow-composition-contract.md`; `docs/design/workflow-observability.md`.

### History

- 2026-09-02T18:27:32.459Z todo → wip (system)
- 2026-09-02T18:50:01.508Z wip → testing (system)
- 2026-09-02T18:50:07.777Z testing → done (system)
