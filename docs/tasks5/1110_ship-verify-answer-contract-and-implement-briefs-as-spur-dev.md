---
schema_version: 1
name: Ship verify-answer contract and implement briefs as spur-dev references
status: todo
template: feature-impl
created_at: 2026-10-07T07:29:49.913Z
updated_at: "2026-10-07T07:34:14.227Z"
feature_id: R

---

## 1110. Ship verify-answer contract and implement briefs as spur-dev references

### Background

The batch's four consecutive first-attempt verify verdicts (1096–1099) came from two hand-authored briefs written into the gitignored driver tree: `.spur/run/verify-answer-contract.md` (how the verifier's answer must be shaped) and `.spur/run/implement-context.md` (repo-relative production anchors from the start, focused checks before reporting done). The pipeline already lints answers (`task verdict`, 1003 R2, `task-pipeline.yaml:718-764`) but nothing ships the shape guidance — every downstream session re-derives it or fails the lint.

### Requirements

- [ ] R1. New reference `plugins/sp/skills/spur-dev/references/verify-answer-contract.md`: bare R/AC ids, verbatim scenario-title twin rows, executable evidenceType, repo-relative file:line anchors, verbatim-only quotes — content harvested from the session artifacts, not reinvented.
- [ ] R2. The implement-side brief (repo-relative anchors from the first write, focused checks before done, evidence-shaped change map) is stated once in the implement contract — extend `plugins/sp/commands/dev-run.md` implement mode or the `sp:code-implementation` skill; reference it from the pipeline implement step's comment (yaml :292-296) rather than inlining prose into YAML.
- [ ] R3. The verify stage of `task-pipeline.yaml` (:718) points at the new reference so the shape contract and the lint stay visibly paired.

### Acceptance Criteria

- [ ] AC1 — Implement workers receive shipped verify-answer and production-anchor briefs without driver-tree hand authoring

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

- 2026-10-07T07:34:14.227Z backlog → todo (system)

### Notes

Source content: gitignored `spur-new-wt-p1/.spur/run/verify-answer-contract.md` + `implement-context.md` (tree removed — recover from session transcript or commit 4f682cb96's era notes in `.spur/memory/sessions/109{5..9}-checkpoint.md`). Effect evidence to cite in the reference header: 1095 fix loop vs 1096–1099 first-attempt chain. Skill-file changes must follow `docs/99_PROJECT_CONSTITUTION.md` + superskill authoring gates if the skill is superskill-managed — check `superskill skill --help` surface before editing a managed skill.

