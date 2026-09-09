---
schema_version: 1
name: Fix test hermeticity and dogfood-harness findings from run 20260908-2330-devrun-0815
status: todo
template: issue
created_at: 2026-09-09T17:11:57.002Z
updated_at: "2026-09-09T17:37:54.153Z"

priority: P2
---

## 0817. Fix test hermeticity and dogfood-harness findings from run 20260908-2330-devrun-0815

### Background

Findings batch from dogfood run 20260908-2330-devrun-0815 (inline `/sp-dev-run 0815 --auto --next --agent inline --worktree --force`; protocol `sp:dogfood-testing@1.2`). The run reached terminal `failed`: the pipeline FSM behaved contract-correctly, but the quality gate was environment-blocked, and the operator hand-confirmed the gate before authorizing merge-back (main `a2c0dac8a`). The code-level findings are already fixed and merged in `39563d002` (ts-db ^0.4.62 lockstep, workaround deletions, four no-row assertion repairs) and are NOT in scope here.

This task owns the remaining open findings from the run report (`docs/dogfood/2026-09-08-dev-run-0815-dogfood.md`, validator rc=0) plus the six residuals parked in task 0815 References, so 0815 can be closed without orphaning them.

**Premise correction (2026-09-09 refine, `--depth ready`).** The run report's P1 finding states the leaking file is a *gitignored* `.spur/config.yaml` that is *absent in CI*. Both halves are false in this tree and the corrected premise changes the fix:

- `.spur/config.yaml` is **tracked** (`git ls-files .spur`; present at the run's BASE_SHA `3f11b875`) and `git check-ignore` does not match it. A `git worktree add` therefore materializes it, and CI checks it out too — file presence is not the worktree/CI divergence.
- The `.spur` paths that config references are tracked **relative symlinks** into `config/`: `.spur/rules -> ../config/rules`, `.spur/tasks -> ../config/tasks`, `.spur/plugins -> ../config/plugins` (all mode `120000` in `git ls-files -s`). They resolve identically in a worktree.
- What is genuinely worktree-divergent under `.spur/` is the untracked/ignored runtime state: `spur.db*` (`.gitignore:128`), `run/`, `backups/`, `logs/`, `reports/`, `agents/*` (`.gitignore:136`). The run's own "worktree importer schema stamp" fix (worktree-local `spur migrate`) is the `spur.db` half of exactly this.

The reproducible, tree-verifiable defect behind the P1 class is therefore **cwd binding, not file presence**: a test that omits `cwd` binds the CLI to whatever `process.cwd()` happens to be, so the operator's live project root — its config, its DB, its executor/team roster — becomes a test input. R1 is rewritten against that.

### Requirements

**R1 (P1, config-leak hermeticity).** CLI test discovery must not pick up the worktree-local, gitignored `.spur/config.yaml` via cwd fallback — workflow-list tests must be deterministic in git worktrees (they fail in worktrees, pass in CI today). Direction: isolate discovery cwd in the affected fixtures or exclude config discovery under test; add a check that reproduces the leak.

**R2 (P2, spawn contention).** `bun run test` must be deterministic under parallel load — spawn-heavy suites (fixtures spawning the CLI/workflows) flake when the machine is loaded, and the gate failure set varied per run. Direction: serial-shed or resource-isolate spawn-heavy suites; a gate failure must reproduce standalone when it is real.

**R3 (P2, verify-answer-lint contract).** verify-answer-lint rejects bold-paragraph AC labels that other accepted answer styles use — 2026-09-09 conformance required a manual rewrite to a checklist projection. Pick one authority and align: either the lint accepts the documented bold-paragraph style, or the template explicitly forbids it.

**R4 (P3, fingerprint scoping doc).** Document what the run-artifact proof fingerprint binds (quality-gate digest + review marker + verify answer) and its scoping, in `docs/04_DESIGN.md`, same commit as any related code change (T3).

**R5 (residual owner surface).** Provide the going-forward owner surface for the six residuals parked in task 0815 References (importer `Promise.race` timeout deferral; ts-db README at-least-once note; P4 sweep-reason vocabulary; TS-server restart after dep bumps; cog merge-message convention; importer-schema migrate remedy) — by moving them into this task's References or another agreed surface — so task 0815 can transition to done without orphaning them (0815 Q&A precondition, 2026-09-09).

### Acceptance Criteria

- [ ] AC1 (R1, R2) — `bun run test` green in a fresh git worktree, repeated 3× under simulated load, with no varying failure sets
- [ ] AC2 (R3) — a verify-answer in the previously rejected bold-paragraph AC style passes verify-answer-lint, or the template explicitly forbids that style
- [ ] AC3 (R4) — `docs/04_DESIGN.md` documents the proof-fingerprint binding/scoping (same commit as any related code change)
- [ ] AC4 (R5) — the six 0815 residuals have a named owner surface and 0815 can close

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
