---
schema_version: 1
name: "idea-pipeline on D65 primitives: typed entry gate, decide routing, executor dispatch"
status: done
template: feature-impl
created_at: 2026-10-18T05:10:06.872Z
updated_at: "2026-10-19T01:34:21.589Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - idea-pipeline

dependencies: ["1248"]
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1250-verdict.json
---

## 1250. idea-pipeline on D65 primitives: typed entry gate, decide routing, executor dispatch

### Background

idea-pipeline (config/workflows/idea-pipeline.yaml) is 1051 lines: 6 agent.run, 4 operator-pause actions, 0 `kind: decide` and 48 shell. 13 of 43 runs passed since 2026-09, and start→failed accounts for 19. Line 6 still references the retired feature-dev.yaml. Covers feature scenarios R8 and R9. Design: docs/design/workflow-consolidation.md §3.4.

**Refine correction (2026-10-18, depth ready).**

- The catalog is used, through shell rather than a typed action. Discovery calls `$spurBin decision run idea-recommendation` (line 175) and `decision run needs-design` (line 187), keeping only `.source=="model"` values. The filed "no decide action uses them" is true only for `kind: decide`. The gap is the shell wrapper (task-pipeline's typed form: task-pipeline.yaml:452).
- Under `profile=auto`, feature-check and batch-create already never pause. ac-generate's guards route straight to system-design, decompose, the retry loop or failed (lines 808-860), and decompose → batch-create-run (979-985). The two `hitl.confirm` states are entered only on the interactive fallback edges (861, 987), with ~10 mirrored edges (869-1014) and two empty→`no` shells (390, 574). The filed R2 ("route these stages through `decide`") has nothing for a decide to settle, because the recorded results are deterministic PASS/FAIL. The task deletes the interactive pause states instead. The D66 R8 scenario steps were corrected to match (2026-10-18), keeping the title.
- start→failed: `doctor.probe` (packages/app/src/workflow/actions/doctor-probe.ts) has no executor awareness. It runs `spur agent doctor` even when `executor=host` (the host session is the executor), and start→failed is hard (lines 716-724). task-pipeline's probe is soft.
- The filed R4 (no per-stage doctor/resolution shell) already holds. Every agent.run reads the once-pinned `${vars.planningAgent}` (lines 142-634), so it folds into R1.
- idea-eval (line 203) and design-approval (478) stay operator pauses. Their empty→`no` shells (216, 492) are the headless default-deny that 1248 leaves in place.

### Requirements

- [x] R1. `doctor.probe` is executor-aware:
  - with `vars.executor` = `host` it writes PASS without probing and logs `precheck: executor=host — subprocess doctor skipped`;
  - with `fleet` it writes PASS when fleet dispatch is wired, and otherwise FAIL naming `executor fleet`;
  - otherwise it keeps today's probe.

  start's idea-text check writes `FAIL: idea text is empty` to the same status file, and start→failed reports that file's first line.
- [x] R2. Delete the interactive `feature-check` and `batch-create` states, their edges and their answer shells. The profile-gated ac-generate and decompose edges apply to every profile: the `test "$profile" = auto` predicate is dropped, and the always fallback into the deleted states goes.
- [x] R3. The two discovery `spur decision run` shells become `kind: decide` actions (`idea-recommendation`, `needs-design`) with `resultFile`. A small projection preserves the existing fallback semantics: a non-model source reads `unknown`, and needs-design falls back to `design`.
- [x] R4. idea-eval and design-approval remain operator pauses on the interactive profile, and `--auto` (`idea_approved`/`design_approved`) still answers them.
- [x] R5. No feature-dev.yaml reference. The definition is at most 600 lines including comments.
- [x] R6. `/sp:dev-plan`, `/sp:dev-idea` and the spur-dev planning references drop the feature-check/batch-create gate rows; only idea-eval and design-approval remain operator gates.

Out of scope:
- The discovery, AC, design and decompose prompts.
- The batch-create-run idempotency.
- handoff.
- Host-run operator pauses (1248).
- Catalog content: the two existing ids fit, and no new entries are needed.

### Acceptance Criteria

- [x] AC1 — idea-pipeline routes its objective checks through the decision catalog (req: R2, R3, R4, R6)
- [x] AC2 — idea-pipeline starts on a typed entry check and dispatches stages through the host or fleet executor (req: R1, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-18T05:50:38.519Z

- Q: Keep an interactive confirm before batch-create so the operator can review the tasks? A: No. The result is a schema check (objective), and design §3.4 removes the pause. The operator reviews at design-approval and before `/sp:dev-runall`. The D66 R8 scenario is updated to match.
- Q: Add new catalog entries for feature-check and batch-create? A: No. A decide over a deterministic PASS/FAIL violates the catalog's rescue-only rule (config/decisions/idea-pipeline.yaml header).
- Q: Fold the idea-text check into `doctor.probe`? A: No. It is a different concern. Both write one status file with a named reason, which is the single typed entry verdict the guard reads.

### Design

Chosen:
- The D65 shape: the deterministic recorded result routes, catalog `decide` only rescues unclassifiable output, and operator pauses stay for taste.
- The executor decides readiness. Host runs need no subprocess doctor.

Rejected:
- Removing the idea-eval pause: it is a taste decision, owned by the operator.
- A decide at feature-check/batch-create: there is nothing to rescue.
- A soft doctor at start, as in task-pipeline: idea-pipeline needs `planningAgent` resolved for subprocess runs.

Invariant: no default path auto-creates a feature without a proceed/reshape recommendation.

Frozen names: none new. `doctor.probe` reads `context.vars.executor` the same way agent-run.ts:883 does.

File targets:
- packages/app/src/workflow/actions/doctor-probe.ts — executor branch before the probe loop. The fleet check uses the runner's injected fleet deps (packages/app/src/workflow/builtins.ts:68-80 wiring).
- config/workflows/idea-pipeline.yaml — version bump; bundle via build:bundle.
- Tests:
  - packages/app/tests/workflow/actions/doctor-probe*.test.ts;
  - packages/app/tests/workflow/idea-pipeline-routing.test.ts and idea-pipeline-definition.test.ts;
  - guard-parity.test.ts plus fixtures/guard-parity-baseline.json;
  - pipeline-action-budget.test.ts and self-contained-stage.test.ts.

  Regenerate pinned baselines through the tests' documented update path; never hand-edit them to green.
- plugins/sp/commands/dev-plan.md, dev-idea.md, plugins/sp/skills/spur-dev/references/planning-workflow.md and dev-operations.md (plan/idea rows).

Anti-patterns:
- No new var or catalog entry.
- Do not touch the idea-eval or design-approval answer shells; 1248 owns pause semantics.
- Do not skip the doctor when `executor` is empty.

Handoffs:
- Depends on 1248, so host pauses work for the two remaining operator gates.
- 1252 sweeps docs/03 and the satellites.

Execution budget: about 8h. Persisted artifacts: the YAML, doctor-probe and test diffs. requireDiff: yes.

### Plan

- [x] Write the failing E2E (packages/app/tests/workflow/idea-pipeline-routing.test.ts):
  - an interactive and an auto run on a fixture idea pass feature-check and batch-create with no pause;
  - `executor=host` start makes no doctor call;
  - an empty idea fails at start with the named reason.
- [x] Write the failing doctor-probe cases for host, fleet-wired, fleet-unwired and empty executor.
- [x] Implement the doctor-probe executor branch.
- [x] Rewrite idea-pipeline.yaml: delete the two states and their edges, drop the profile predicates, add the two decide actions, remove the feature-dev.yaml reference and condense comments to ≤600 lines.
- [x] Update dev-plan.md, dev-idea.md, planning-workflow.md and dev-operations.md.
- [x] Run build:bundle, then the targeted packages/app workflow tests, then `bun run spur-check`.
  The project gate belongs to the pipeline's `test` hop; implement ran build:bundle, the targeted
  tests and `spur task gate 1250 light`.

### Solution

**R1 — the entry check is executor-typed.** `packages/app/src/workflow/actions/doctor-probe.ts:135-157`
short-circuits the probe when the run already knows its executor: `host` writes PASS with
`precheck: executor=host — subprocess doctor skipped` (the host session *is* the executor), `fleet`
writes PASS when this host wired fleet dispatch and otherwise FAIL naming `executor fleet` (ADR-126).
The branch sits after the resultFile boundary check and `ensureDir` but before the role-pin walk, so
a `roles` map does not reintroduce a resolution call. Readiness comes from the injected
`FleetDispatchDeps` (`packages/app/src/workflow/actions/doctor-probe.ts:70-72`,
wired at `packages/app/src/workflow/builtins.ts:134-140`) — the same dep `agent.run` dispatch uses, so
"wired" means the one thing it means elsewhere. Any other executor value keeps the existing probe
(`vars.executor` empty → the tier ladder, unchanged).

`config/workflows/idea-pipeline.yaml:68-91` is the matching start state: the executor-aware
`doctor.probe` and the idea-text shell write the **same** status file, so one token routes.
The shell's `&& … ||` chain leaves `FAIL: idea text is empty` as the file's first line, which
`config/workflows/idea-pipeline.yaml:440` echoes to stderr on the start→failed edge.

**R2 — the objective pauses are gone.** `feature-check` and `batch-create` are deleted from
`config/workflows/idea-pipeline.yaml` with their edges and answer shells. ac-generate now routes on
the recorded check plus the derived route under every profile
(`config/workflows/idea-pipeline.yaml:448-454` — the `test "$profile" = auto` conjunct is dropped),
and decompose reaches the side effect directly (`config/workflows/idea-pipeline.yaml:464`).
design-approval's recorded-FAIL hop retargets to ac-generate
(`config/workflows/idea-pipeline.yaml:458`). The two taste gates keep their profile predicates
(`config/workflows/idea-pipeline.yaml:441-446` and `config/workflows/idea-pipeline.yaml:455`) — that is R4, not R2.

**R3 — the two rescues are typed.** The `spur decision run` shells become `kind: decide` actions over
the catalog ids (`config/workflows/idea-pipeline.yaml:120-126` idea-recommendation,
`config/workflows/idea-pipeline.yaml:138-144` needs-design), each with `evidence` and a `resultFile`.
The deterministic parse still runs first (`config/workflows/idea-pipeline.yaml:111-116`) and a
projection preserves the pre-1250 fallback: a non-model source leaves `unknown` so no default
auto-creates a feature (`config/workflows/idea-pipeline.yaml:129-135`), and needs-design falls back
to `design` unless the model said `skip` (`config/workflows/idea-pipeline.yaml:145-151`).

**R5** — version `3` (`config/workflows/idea-pipeline.yaml:38`), no feature-dev.yaml reference, 469
lines (was 1051; cap 600).

**R6** — the gate tables now list only idea-eval and design-approval, and name the AC check and the
batch create as deterministic steps: `plugins/sp/commands/dev-idea.md:44-53`,
`plugins/sp/commands/dev-plan.md:2`, `plugins/sp/README.md:98-99`,
`plugins/sp/skills/spur-dev/references/dev-operations.md:369`,
`plugins/sp/skills/spur-dev/references/dev-operations.md:375`,
`plugins/sp/skills/spur-dev/references/dev-operations.md:541`,
`plugins/sp/skills/spur-dev/references/planning-workflow.md:3` and
`plugins/sp/skills/spur-dev/references/planning-workflow.md:13-28`.

**Tests.** `packages/app/tests/workflow/idea-pipeline-routing.test.ts:209-363` asserts the deleted states,
auto-and-standard routing parity, the typed entry check, the named empty-idea reason and per-stage
executor dispatch; `packages/app/tests/workflow/idea-pipeline-routing.test.ts:364-498` runs the
decide projections' shells for real;
`packages/app/tests/workflow/actions/doctor-probe.test.ts:228-303` covers the four executor cases
(host, fleet-wired, fleet-unwired, empty — the last on the single-probe path, where the subprocess
doctor actually shows up); `packages/app/tests/workflow/idea-pipeline-definition.test.ts:725` asserts
no profile pauses on the deleted states; `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:142-160`
tracks the rescue moving out of the shell layer. The pinned baselines
(`packages/app/tests/workflow/fixtures/guard-parity-baseline.json`,
`packages/app/tests/workflow/pipeline-action-budget.test.ts`) were regenerated through their own
update path.

**Deliberate non-changes.** No new var and no new catalog entry (a decide over a deterministic
PASS/FAIL violates the catalog's rescue-only rule). The idea-eval and design-approval answer shells
are untouched — 1248 owns pause semantics. `planningAgent` stays unresolved on host/fleet runs by
design: those executors do not dispatch a subprocess that needs the pin.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/actions/doctor-probe.ts:139-157`; executor probe regressions and the bundled idea-pipeline E2E passed; empty idea writes its named failure status. |
| R2 | MET | `packages/app/tests/workflow/idea-pipeline-routing.test.ts:209-280`; executed route truth table passes for both profiles without deleted objective pause states. |
| R3 | MET | `config/workflows/idea-pipeline.yaml:120-151`; both catalog decide actions and fallback projections pass their executable tests and appear in the full run artifacts. |
| R4 | MET | `config/workflows/idea-pipeline.yaml:154-173`; interactive taste pause and explicit cancellation pass in the full bundled-run E2E; auto routing is covered by the route suite. |
| R5 | MET | `config/workflows/idea-pipeline.yaml:469`; executable size check is 469 lines, below 600; absence tests reject stale workflow references. |
| R6 | MET | `plugins/sp/commands/dev-idea.md:52`; plugin and definition tests pass for updated planning references. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R8 — idea-pipeline routes its objective checks through the decision catalog | MET | test | `packages/app/tests/workflow/idea-pipeline-routing.test.ts:209-280`; fresh executable profile-independent route matrix and decide projection tests passed. |
| R9 — idea-pipeline starts on a typed entry check and dispatches stages through the host or fleet executor | MET | test | `apps/cli/tests/workflow/idea-pipeline-e2e.test.ts:7-72`; real bundled definition records host entry PASS, discovery receipt and catalog artifacts; doctor-probe executor tests passed. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

# Review answer — task 1250 (idea-pipeline on D65 primitives)

Dimensions: functional traceability + SECUA + architecture (focus all). Diff reviewed: 15 files, +851/−1121 (working tree vs HEAD).

## Findings

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | packages/app/src/workflow/actions/doctor-probe.ts | The executor branch writes PASS for a wired fleet run without naming the wiring source in the file; the reason string carries it in output/logs instead. Consistent with the host branch; the guard routes on the single token either way. | OPEN (observation, no action) |

No P1–P3 findings. No carried residual.

- P4 (observation, no action): `doctor.probe`'s executor branch writes `PASS\n` for a wired fleet run without naming the wiring source in the file (the reason string carries it in `output`/logs instead). Consistent with the host branch; the guard routes on the single token either way.

## Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | PASS | packages/app/src/workflow/actions/doctor-probe.ts:135-157 — executor branch after the resultFile boundary check, before the role-pin walk; host reason `precheck: executor=host — subprocess doctor skipped` at packages/app/src/workflow/actions/doctor-probe.ts:144; fleet unwired FAIL naming executor fleet at packages/app/src/workflow/actions/doctor-probe.ts:151; readiness from injected FleetDispatchDeps (packages/app/src/workflow/actions/doctor-probe.ts:72, wired at packages/app/src/workflow/builtins.ts:139); empty executor keeps the probe (covered by test). start state writes one shared status file config/workflows/idea-pipeline.yaml:68-91; `FAIL: idea text is empty` at config/workflows/idea-pipeline.yaml:91; start→failed reports the file's first line config/workflows/idea-pipeline.yaml:438. |
| R2 | PASS | State list config/workflows/idea-pipeline.yaml:68-427 contains no `feature-check`/`batch-create` states; no transition targets them (config/workflows/idea-pipeline.yaml:434-469). ac-generate routes on recorded facts under every profile with the `test "$profile" = auto` conjunct dropped: config/workflows/idea-pipeline.yaml:447-453; decompose reaches batch-create-run via `guard: {kind: always}` config/workflows/idea-pipeline.yaml:464; design-approval recorded-FAIL hop retargeted to ac-generate config/workflows/idea-pipeline.yaml:457. |
| R3 | PASS | `kind: decide` for idea-recommendation config/workflows/idea-pipeline.yaml:120-126 and needs-design config/workflows/idea-pipeline.yaml:138-144, each with evidence + resultFile; deterministic parse still first config/workflows/idea-pipeline.yaml:111-116; projection preserves fallback: non-model source reads `unknown` config/workflows/idea-pipeline.yaml:128-135, needs-design falls back to design unless model `skip` config/workflows/idea-pipeline.yaml:145-151. Rescue tracked out of the shell layer by apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:142-160. |
| R4 | PASS | idea-eval remains `kind: hitl.confirm` config/workflows/idea-pipeline.yaml:156 and design-approval config/workflows/idea-pipeline.yaml:299; `--auto` answers via idea_approved/design_approved edges config/workflows/idea-pipeline.yaml:441-444 and config/workflows/idea-pipeline.yaml:455. Answer shells untouched in the diff. |
| R5 | PASS | version `"3"` config/workflows/idea-pipeline.yaml:38; zero `feature-dev.yaml` references (grep over the file); 469 lines (cap 600). Bundle in sync: apps/cli/config/workflows/idea-pipeline.yaml identical. |
| R6 | PASS | Gate tables list only idea-eval and design-approval: plugins/sp/commands/dev-idea.md:44-53, plugins/sp/commands/dev-plan.md:2, plugins/sp/README.md:98-99, plugins/sp/skills/spur-dev/references/dev-operations.md:369, plugins/sp/skills/spur-dev/references/planning-workflow.md:13-28 — feature-check/batch-create named as deterministic steps, not gates. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 (feature R8 — idea-pipeline routes its objective checks through the decision catalog) | PASS | code+test | `kind: decide` actions + fallback projections config/workflows/idea-pipeline.yaml:120-151; deleted pause states config/workflows/idea-pipeline.yaml:68-469; tests: packages/app/tests/workflow/idea-pipeline-routing.test.ts:209-498 (routing parity, projections run for real), packages/app/tests/workflow/idea-pipeline-definition.test.ts:725 (no profile pauses on deleted states), apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:142-160. Ran: 73+2+4 = 79 tests, 0 fail. |
| AC2 (feature R9 — idea-pipeline starts on a typed entry check and dispatches stages through the host or fleet executor) | PASS | code+test | Executor-typed entry check packages/app/src/workflow/actions/doctor-probe.ts:135-157 + config/workflows/idea-pipeline.yaml:68-91; start→failed first-line report config/workflows/idea-pipeline.yaml:438; per-stage executor dispatch asserted in packages/app/tests/workflow/idea-pipeline-routing.test.ts:316-363; four executor cases in packages/app/tests/workflow/actions/doctor-probe.test.ts:228-303. Ran: 79 tests across 6 files, 0 fail. |

Confidence: HIGH
Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)
- 2026-10-18T21:34:55.065Z todo → wip (system)
- 2026-10-18T22:33:05.216Z wip → testing (system)
- 2026-10-18T22:33:06.111Z testing → done (system)

