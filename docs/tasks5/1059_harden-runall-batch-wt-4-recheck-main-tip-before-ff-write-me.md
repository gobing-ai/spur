---
schema_version: 1
name: "Harden runall batch WT-4: recheck main tip before FF, write merged marker only after ref move"
status: backlog
template: feature-impl
created_at: 2026-10-02T23:30:10.890Z
updated_at: "2026-10-02T23:39:02.649Z"
feature_id: D63

---

## 1059. Harden runall batch WT-4: recheck main tip before FF, write merged marker only after ref move

### Background

**Origin:** D62 runall session (2026-10-02), dogfood finding F1 (`docs/dogfood/2026-10-02-D62-workflow-execution-economy-runall-dogfood.md`, local-only per `.gitignore:189`; summary duplicated here because that file is gitignored).

**What happened (observed):** The D62 batch (`sp/runall-d62-1c23`, base `7b2d0476d`, 4 tasks 1053-1056) hit the WT-4 hop while a concurrent session was actively committing to `main`. Six foreign commits landed mid-batch-to-wrap (`562f42256`, `936f53d7d`, `7512794bc`, `9f919a28d`, `c8d183969`, `d5334e9c6` — docs/memory/tasks only). Consequences, in order:

1. **FF impossible twice.** The runbook's FF-only contract (`plugins/sp/skills/spur-dev/references/execution-batch.md`, section "WT-4 — Success path (R4)", subsection "Fast-forward only") mandates: base moved → NO rebase/merge-commit/conflict resolution → fall to WT-5 (retain worktree + branch, report divergence). The session instead executed an **operator-approved deviation**: rebase via a throwaway worktree (`/tmp/sp-d62-final`) with a disjoint-path check (`git diff --name-only` both sides) before each rebase, full gate re-run after the first rebase (`bun install --frozen-lockfile` first — stale deps broke TS2307), targeted typecheck after the second (docs-only) rebase, then FF. The deviation worked but is **outside the written contract**; this task must decide whether to codify it (operator-gated WT-4 alternative) or keep WT-5-retain and make the divergence report actionable.
2. **Premature marker flip.** During the first failed FF attempt the worktree marker (`.spur/run/worktree-runall-d62-1c23.json`, WT-3 schema) was flipped to `status: "merged"` before the merge ref moved; it had to be manually reverted to `active` and re-flipped after the verified ref move (`mergeCommit: 92cf0af88`). Marker hygiene rule: the marker reflects **landed merges only**. In the runbook the flip is a bare trailing comment — `# update marker: status = "merged"` (end of the create-mode WT-4 script block, after `spur projects remove`) — with no guard, no ordering statement, and no verification step, for both create and reuse mode.
3. **Environmental note:** one `git worktree remove` half-failed (link deregistered, directory left behind, "Directory not empty" on retry) requiring manual cleanup — reuse this task's runbook edit to document the recovery path (`git worktree prune` + remove the leftover directory).

**Excluded (already resolved in-session, do not re-fix):** the batch itself is merged (`92cf0af88`) and wrapped; the marker is correctly `merged`; no code change was made to any driver script — the driver is the inline host-session procedure, so the deliverable here is the runbook contract (+ its contract test), not a bugfix.

### Requirements

1. **Pre-FF tip recheck (explicit):** the WT-4 block states an explicit `git fetch`/`git rev-parse "$BASE_REF"` recheck immediately before `git merge --ff-only`, and on movement since `baseSha` names the moved commits in the WT-5 halt report (`git log --oneline baseSha..BASE_REF`) so the operator can judge rebase-vs-retain without archaeology.
2. **Marker ordering (verified step):** replace the bare `# update marker: status = "merged"` comment with a guarded step: flip only after `[ "$(git rev-parse "$BASE_REF")" = "$(git rev-parse "$BRANCH")" ]` (or an explicit `mergeCommit` equality check) succeeds, in BOTH create and reuse mode. A failed FF must leave `status: active`.
3. **Rebase-reroute decision (explicit, not silent):** either (a) codify the disjoint-path rebase reroute used in the D62 session as an operator-gated WT-4 alternative (explicit operator approval required; disjoint-path check `git diff --name-only` both sides; gate re-run mandated after any non-docs rebase), or (b) keep the existing strict "Fast-forward only → WT-5" rule unchanged and record the session's deviation as an accepted operator override in this task's record. Do not widen FF-only semantics implicitly.
4. **Holder-cleanup recovery note:** document the observed partial-removal recovery (link deregistered but directory left: `git worktree prune`, then remove the leftover directory by hand) next to the WT-4b holder-cleanup block.

### Acceptance Criteria

- AC1: WT-4 (create + reuse) carries an explicit pre-FF tip recheck; movement since `baseSha` produces a WT-5 halt report naming the moved commits; contract test covers both the clean path and the moved-tip path.
- AC2: marker flip is a guarded step gated on a verified ref move in both modes; the contract test asserts a failed FF leaves `status: active` and only a verified move writes `merged`.
- AC3: the rebase-reroute decision is recorded (codified operator-gated, or strict FF-only retained with the deviation noted); no implicit widening of FF-only semantics.
- AC4: recovery path for partial worktree removal documented; `bun run plugin-smoke` and the execution-batch contract test pass; installed adapters re-synced via `superskill install sp` (dry-run verified).

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

- Extend `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` for recheck + marker ordering + (if codified) the reroute gate; run from `plugins/sp`: `(cd plugins/sp && bun test tests/dogfood-testing/execution-batch-contract.test.ts)` (workspace `bunfig.toml` supplies preload).
- `bun run plugin-smoke` before release of the plugin change.
- Dry-run the WT-4 block by hand in a scratch clone: simulate a moved base and confirm the halt report text and marker staying `active`.
- `bun run spur-check` for the touched workspaces; `bun run spur-check-feature` once if D63 requires the feature-scoped pass for this task's completion (ADR-119).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
