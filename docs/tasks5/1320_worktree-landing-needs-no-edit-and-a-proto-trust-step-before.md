---
schema_version: 1
name: Worktree landing needs --no-edit and a proto-trust step before the commit hook
status: todo
template: issue
created_at: 2026-11-08T19:23:29.481Z
updated_at: "2026-11-08T19:23:38.929Z"
feature_id: D3

priority: P2
---

## 1320. Worktree landing needs --no-edit and a proto-trust step before the commit hook

### Background

Both findings come from landing a real `--worktree` run on 2026-11-08 (`/sp-dev-run 1319 --worktree`), i.e. the runbook was followed verbatim and failed twice on its own steps.

**1 — `git merge` is blocked without `--no-edit`.** WT-4's create-mode landing runs `git merge --ff-only "$BRANCH"` (`plugins/sp/skills/spur-dev/references/execution-worktree-landing.md`). In an agent environment the host policy refuses an interactive `git merge`: *"Interactive git command blocked: `git merge` without `--no-edit` or an explicit message…"*. A fast-forward needs no message, so the fix is `git merge --ff-only --no-edit "$BRANCH"` — the driver had to discover the flag mid-landing.

**2 — a fresh worktree cannot commit until `proto trust .prototools` runs.** WT-3b's commit invokes the repo's `cog` commit-msg hook, which `proto` refuses to load in a new worktree: *"the plugin for cog is configured in ./prototools, which has not been trusted"* → exit 1, commit refused. WT-2's setup list (install, `bundle:config`) does not include the trust step, so every create-mode landing fails at the first commit until the driver runs `proto trust .prototools` inside the worktree.

Both are runbook gaps, not code gaps: the machinery works, the documented commands are environment-incomplete.

### Requirements

- [ ] R1. WT-4 create-mode landing (`execution-worktree-landing.md`) uses `git merge --ff-only --no-edit "$BRANCH"`, with a one-line note that an agent environment blocks a merge without it. Any other `git merge` in that file gets the same treatment.
- [ ] R2. WT-2 create-mode setup (`execution-worktree-setup.md`) gains the trust step for a fresh tree: `proto trust .prototools` (best-effort, only when the project ships `.prototools`), placed before WT-3b's first commit, with the observed failure quoted so a driver recognizes it.
- [ ] R3. Both gaps are proven by the next create-mode `--worktree` landing (a real run, not a fixture): WT-4 merges without an interactive-git block, and WT-3b commits without a proto trust refusal.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [ ] 1. Edit `execution-worktree-landing.md` WT-4 (both create-mode commands) to `git merge --ff-only --no-edit`.
- [ ] 2. Edit `execution-worktree-setup.md` WT-2 create mode: add the `proto trust .prototools` step beside the dependency install / `bundle:config` list.
- [ ] 3. Grep the rest of the sp skill tree for `git merge --ff-only` and fix the siblings in the same pass (mirrored-surface rule).
- [ ] 4. Prove on the next `--worktree` run; record the transcript lines in `## Testing`.

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
