---
schema_version: 1
name: "idea-pipeline on D65 primitives: typed entry gate, decide routing, executor dispatch"
status: todo
template: feature-impl
created_at: 2026-10-18T05:10:06.872Z
updated_at: "2026-10-18T05:50:39.467Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - idea-pipeline

dependencies: ["1248"]
estimate_hours: 8
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

- [ ] R1. `doctor.probe` is executor-aware:
  - with `vars.executor` = `host` it writes PASS without probing and logs `precheck: executor=host — subprocess doctor skipped`;
  - with `fleet` it writes PASS when fleet dispatch is wired, and otherwise FAIL naming `executor fleet`;
  - otherwise it keeps today's probe.

  start's idea-text check writes `FAIL: idea text is empty` to the same status file, and start→failed reports that file's first line.
- [ ] R2. Delete the interactive `feature-check` and `batch-create` states, their edges and their answer shells. The profile-gated ac-generate and decompose edges apply to every profile: the `test "$profile" = auto` predicate is dropped, and the always fallback into the deleted states goes.
- [ ] R3. The two discovery `spur decision run` shells become `kind: decide` actions (`idea-recommendation`, `needs-design`) with `resultFile`. A small projection preserves the existing fallback semantics: a non-model source reads `unknown`, and needs-design falls back to `design`.
- [ ] R4. idea-eval and design-approval remain operator pauses on the interactive profile, and `--auto` (`idea_approved`/`design_approved`) still answers them.
- [ ] R5. No feature-dev.yaml reference. The definition is at most 600 lines including comments.
- [ ] R6. `/sp:dev-plan`, `/sp:dev-idea` and the spur-dev planning references drop the feature-check/batch-create gate rows; only idea-eval and design-approval remain operator gates.

Out of scope:
- The discovery, AC, design and decompose prompts.
- The batch-create-run idempotency.
- handoff.
- Host-run operator pauses (1248).
- Catalog content: the two existing ids fit, and no new entries are needed.

### Acceptance Criteria

- [ ] AC1 — idea-pipeline routes its objective checks through the decision catalog (req: R2, R3, R4, R6)
- [ ] AC2 — idea-pipeline starts on a typed entry check and dispatches stages through the host or fleet executor (req: R1, R5)

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

- [ ] Write the failing E2E (packages/app/tests/workflow/idea-pipeline-routing.test.ts):
  - an interactive and an auto run on a fixture idea pass feature-check and batch-create with no pause;
  - `executor=host` start makes no doctor call;
  - an empty idea fails at start with the named reason.
- [ ] Write the failing doctor-probe cases for host, fleet-wired, fleet-unwired and empty executor.
- [ ] Implement the doctor-probe executor branch.
- [ ] Rewrite idea-pipeline.yaml: delete the two states and their edges, drop the profile predicates, add the two decide actions, remove the feature-dev.yaml reference and condense comments to ≤600 lines.
- [ ] Update dev-plan.md, dev-idea.md, planning-workflow.md and dev-operations.md.
- [ ] Run build:bundle, then the targeted packages/app workflow tests, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)

