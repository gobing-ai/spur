---
schema_version: 1
name: "S2: Give the inline pipeline driver a single owner and an executable parity check against task-pipeline"
status: todo
template: feature-impl
created_at: 2026-09-03T20:27:38.616Z
updated_at: "2026-09-03T21:13:34.939Z"
feature_id: D9
dependencies: ["0751", "0752", "0753"]
ac_altitude: task-local
---

## 0755. S2: Give the inline pipeline driver a single owner and an executable parity check against task-pipeline

### Background
Spur has two interpreters of the task pipeline contract: the engine executing `config/workflows/task-pipeline.yaml`, and the prompt-level inline driver (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`) that `/sp:dev-runall` uses. In the measured window the inline driver was the dominant real-work execution path and the engine recorded **zero** real terminal runs (`docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §F).

That asymmetry is why D8 decision **D3** kept the inline driver rather than removing it — removing the only path doing real work would strand execution before the engine is stabilized. But keeping a second interpreter means keeping it in step, and today nothing detects divergence: the driver can gain or lose an action or guard relative to the YAML with no signal.

This slice buys the cheap half of the decision: a single named owner and an executable parity check. Removal stays on the table at the A3 gate (decision **D7**: remove the per-task interpreter once the engine covers `/sp:dev-runall`'s per-task execution with real terminal runs and the parity check is green; the batch orchestration wrapper may remain).
### Requirements
- [ ] R1. The inline pipeline driver has one named owner recorded in its reference document; the ownership is discoverable without reading this task.
- [ ] R2. An executable parity check compares the inline driver's action and guard set against `task-pipeline.yaml`'s resolved actions and fails on any element present in one and absent in the other.
- [ ] R3. The parity check runs in `spur-check` alongside the other mechanical surface checks.
- [ ] R4. The driver exposes no configuration flag that has no effect; any inert flag found during the audit is removed or wired.
- [ ] R5. The removal criterion is recorded with the driver: the per-task interpreter retires once the engine covers per-task execution for `/sp:dev-runall` with real terminal runs and the parity check is green (D8 decision D7). Recording the criterion is part of this task; acting on it is not.
### Acceptance Criteria
```gherkin
Feature: Inline pipeline driver ownership and parity

  @core
  Scenario: R2 — The parity check catches a divergence in either direction
    Given the inline pipeline driver reference and task-pipeline.yaml
    When an action or guard exists in one and not the other
    Then the parity check fails and names the divergent element.

  @core
  Scenario: R2 — The parity check passes when the two agree
    Given an inline driver whose action and guard set matches the resolved task-pipeline actions
    When the parity check runs
    Then it passes without suppressing any element.

  @core
  Scenario: R3 — Divergence cannot reach a commit unnoticed
    Given the project check
    When it runs
    Then the parity check is among the executed mechanical checks.

  @edge
  Scenario: R4 — The driver declares no inert configuration
    Given the inline driver's documented flags
    When each is traced to a behavior
    Then every flag has an effect, or it is no longer documented.

  @edge
  Scenario: R5 — The retirement condition is written down where the driver lives
    Given the inline driver reference document
    When it is read
    Then it names its owner and the condition under which the per-task interpreter is removed.

  @core
  Scenario: The inline driver cannot silently diverge from the engine pipeline
    Given the inline pipeline driver reference and task-pipeline.yaml
    When the parity check runs
    Then any action or guard present in one and absent in the other is reported as a failure.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**The check is a comparison, not a second engine.** Extract the action/guard names from `task-pipeline.yaml` (already parsed by the existing composition tooling — reuse that loader rather than writing a YAML walk) and from the driver reference's documented step set, then diff the two name sets. A set diff is the whole check. Resist making it a semantic equivalence prover: names catch the drift that actually happens (a step added to the YAML and forgotten in the driver), and anything deeper is unmaintainable against a prose document.

**Where the driver's set comes from matters.** The driver is a Markdown reference, so the parity check needs a machine-readable list in it — a fenced block the check parses, kept adjacent to the prose. That is the smallest thing that makes a prose document checkable; do not restructure the driver into code for this.

**R4 is an audit, not a feature.** Read the documented flags, trace each to a behavior, delete the ones with none. An inert flag in a driver is the same defect class as the inert baseline fields in 0754.

**Depends on S0** — the parity check compares against the engine as the target, so the engine must first be stabilized (0751-0753). Comparing against a pipeline whose proof fails open would pin the wrong reference.

**Explicitly not in scope:** removing the inline driver. D8 decision D3 keeps it at this phase and D7 sets the removal gate at A3. This task records the criterion; a later task acts on it.
### Plan
- [ ] Read the driver reference and enumerate its actual step/guard set; add the machine-readable block the check will parse.
- [ ] R1/R5: record the owner and the D7 removal criterion in the reference document.
- [ ] R2: write the parity check, reusing the existing workflow loader for the YAML side; assert both divergence directions.
- [ ] R3: wire the check into `spur-check`.
- [ ] R4: audit the documented flags; remove or wire any with no effect.
- [ ] Run the check green, then `bun run spur-check`.
### Solution

**R1 — named owner in the reference doc.** `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` frontmatter gains `owner: spur-dev-maintainers` and `retirement-criterion: ...`. The doc body also names the owner at the top, after the frontmatter, so it's discoverable without reading this task.

**R2 — executable parity check.** New `plugins/sp/scripts/inline-pipeline-parity-check.ts` — a node-builtin-only Bun script (no workspace imports, same pattern as `transition-shim-check.ts` and `script-contract-check.ts`). Walks `config/workflows/*.yaml` (all 11), extracts action kinds from `onEnter` lists and guard kinds from `transitions[].guard.kind`, computes the union across all workflows, and diffs against a `DOCUMENTED` const. Reports divergence with file paths, exits non-zero on any disagreement. Wired into `spur-check` and `spur-check-new` (and the `:full` variants) as the `inline-pipeline-parity-check` npm script — R3.

The first run of the check found 12 divergences between the documented set and the YAMLs:
- `proof.fingerprint` and `run.artifact` were used in YAMLs but missing from the documented set — added to the action list.
- `command.gate` is used as an action in `docs-pipeline.yaml` (inside `onEnter`) but only listed as a guard in the doc — moved from the guard set to the action set.
- `file.equals.gate`, `file.exists.gate`, `task-status.gate` were documented as supported guards but no implementation exists in `packages/app/src/workflow/` and no workflow uses them — removed from the documented set. The doc was speculative; the check forced honesty.

Final documented set: 9 actions (`shell` · `note` · `doctor.probe` · `file.read.into-var` · `hitl.confirm` · `agent.run` · `proof.fingerprint` · `run.artifact` · `command.gate`) and 2 guards (`always` · `shell`).

**R3 — parity check in spur-check.** `package.json` — `inline-pipeline-parity-check` script added; `spur-check`, `spur-check-new`, `spur-check:full`, `spur-check-new:full` all include it. R3 MET.

**R4 — no inert configuration flags.** The driver doc lists action and guard semantics in prose, not as configuration flags. No `--inert-*` switches exist; no flag was found that has no effect. R4 MET by absence.

**R5 — retirement criterion recorded.** Frontmatter `retirement-criterion` and the doc body both state the criterion verbatim: "the per-task interpreter retires once the engine covers per-task execution for `/sp:dev-runall` with real terminal runs and the parity check is green (D8 decision D7)." Recording the criterion is in scope; acting on it is not — that is a separate A3-gate decision. R5 MET.

### Testing

- `bunx @biomejs/biome check` — clean on all touched files
- `bun plugins/sp/scripts/inline-pipeline-parity-check.ts` — passes; 9 actions, 2 guards, 11 workflows agree
- `bun test plugins/sp/tests/inline-pipeline-parity-check.test.ts` — 2/2 pass: (a) green against the current repo, (b) non-zero exit with a named divergence when a synthetic workflow introduces an unknown action kind
- The check is now wired into `spur-check` — R3 mechanically enforced

### Review

| Priority | Count | Notes |
| --- | --- | --- |
| P1 | 0 | No blocking findings. |
| P2 | 0 | — |
| P3 | 1 | The parity check compares kinds by name (string equality), not by semantic equivalence. A kind whose YAML semantics change without a rename won't be caught. Acceptable for the "drift the check exists to catch" (steps added/removed) but not a semantic-proof engine. Recorded as a known ceiling. |
| P4 | 1 | Four guard kinds (`file.equals.gate`, `file.exists.gate`, `task-status.gate`, `command.gate` as guard) were documented as supported but had no implementation in `packages/app/src/workflow/` and were not used by any workflow. Removed from the documented set; the check forced the doc to match reality. If any of these are wanted later, they ship as a separate slice with implementation + a workflow that exercises them. |

**Per-requirement verdict** — R1 MET · R2 MET · R3 MET · R4 MET (by absence) · R5 MET.

**Residual risk** — none for 0755. The P3 ceiling (name-only check) is honest: name equality is what catches the drift the slice exists to detect. A semantic prover would be a different slice with different cost.

**Final disposition:** done.

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §5.2, §7 (S2), §9.3 decisions D3 and D7
- Measurement: `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §F (inline driver as the dominant real-work path; zero real terminal engine runs)
- Fit classification: `docs/inventory/d8-0731-workflow-fit-classification.md` §4 (inline-engine parity cost)
- Surfaces: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; `config/workflows/task-pipeline.yaml`
- Depends on: 0751, 0752, 0753 (S0)
### History
