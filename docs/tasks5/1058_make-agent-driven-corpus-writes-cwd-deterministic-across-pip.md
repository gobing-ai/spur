---
schema_version: 1
name: Make agent-driven corpus writes cwd-deterministic across pipeline surfaces
status: todo
template: issue
created_at: 2026-10-02T22:50:39.301Z
updated_at: "2026-10-02T22:51:07.848Z"

---

## 1058. Make agent-driven corpus writes cwd-deterministic across pipeline surfaces

### Background

During inline pipeline run `95522d21` (task 1057) the shell working directory drifted between tool calls three times, silently landing corpus writes (`feature update` AC rewrite, `task update` AC rewrite) in the invoking tree instead of the run worktree; each required manual spill-revert. Root cause: commands assumed an inherited cwd — undefined input for agent-driven shells, where every bash call may start in an arbitrary directory. Blast radius is any CLI that resolves the corpus from `process.cwd()`: silent wrong-tree writes with no error. Fix layers: pin the tree explicitly at the tool layer, fail fast when the pin mismatches, and codify the protocol where pipeline drivers are defined.

### Requirements

- [x] R1. Add a project-root pinning flag (e.g. global `--cwd <dir>`) to corpus-mutating `spur` nouns (`task`, `feature`, `rule`, `workflow`), so every command names its tree explicitly instead of relying on `process.cwd()`. Public-surface addition — requires operator consent with design context and an ADR-00X entry before implementation.
- [x] R2. Codify the cwd protocol in the pipeline driver surfaces: `config/workflows/task-pipeline.yaml` + `wrapup-pipeline.yaml` driver steps and `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` mandate self-contained commands — subshell `(cd <abs> && …)` or the R1 flag, plus a fail-fast tree assert (`[ "$PWD" = "<abs>" ] || exit 91`) before any corpus write.
- [x] R3. Regression coverage: a corpus write executed with a stale cwd (different tree) either lands in the pinned tree or exits loudly; the test fails without the R1 flag wired through.
- [x] R4. Document the harness-layer residual: the pi bash tool exposes no `cwd` parameter — record as an upstream coordination item (out of scope for this repo's code, in scope for the protocol docs).

### Acceptance Criteria

- [ ] AC1: Every corpus-mutating `spur` command accepts the tree-pinning flag; `--help`, `docs/help*`, and `plugins/sp/skills/spur-cli` references updated in the same change set. (req: R1)
- [ ] AC2: Both pipeline YAMLs and the inline-pipeline-driver reference carry the mandated protocol with working examples; no driver step relies on inherited cwd. (req: R2)
- [ ] AC3: A regression test proves stale-cwd writes are pinned or rejected loudly (exit nonzero), failing without the fix. (req: R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
