---
schema_version: 1
name: Typed engine builtins for gate, commit-guard and corpus transition
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.818Z
updated_at: "2026-10-17T16:13:32.035Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - engine
  - gate
estimate_hours: 4

dependencies: ["1231", "1224", "1222", "1223"]
---

## 1234. Typed engine builtins for gate, commit-guard and corpus transition

### Background

Feature D65 F4. task-pipeline has 54 inline shell actions; deterministic steps (gate, commit-guard, status transition) should be typed engine builtins, and project commands go through A92's `spur self exec`.

**Refine corrections (2026-10-17)**
- Title/R1 "typed engine builtins gate, commit-guard, corpus.transition" → `command.gate` already exists (packages/app/src/workflow/actions/command-gate.ts: executable + args, no shell, retry, resultFile, softFail; used task-pipeline.yaml:344, :923) → run `spur task gate`, `spur workflow commit-guard`, `spur task update <wbs> <status>` and `spur self exec` through command.gate; no new builtin kinds unless command.gate falls short. Title kept (CLI cannot rename); scope is the command.gate port.
- R2 "reuse a PASS receipt keyed by git tree hash" → receipt reuse already exists (quality-gate.ts:337 readReceiptStatus; PASS + tier full + inputDigest match) and the alternate-index tree capture exists (~:820–851) → re-key inputDigest to the gate-computed gitTree alone; drop the caller-supplied proofDigest input (:397, :407).
- Estimate 6h → 4h (no new action kinds).
- quality-gate.ts is modified in the A92 worktree → start from the A92-merged file.

### Requirements

- [ ] R1. Deterministic steps in migrated workflows run as `command.gate` actions invoking existing verbs (`spur task gate`, `spur workflow commit-guard`, `spur task update <wbs> <status>`, `spur self exec <action>`), not shell actions.
- [ ] R2. The gate selects run/recheck/light by visit and receipt, invokes project commands via `spur self exec <action>`, and reuses a PASS receipt whose inputDigest equals the gitTree it computes itself (quality-gate.ts alternate-index capture); no caller-supplied proofDigest.
- [ ] R3. Step outcomes are typed (pass/fail/blocked via exit code + resultFile receipt path) and visible in action_runs traces.

### Acceptance Criteria

- [ ] AC1 — Deterministic steps run as typed engine builtins (req: R1, R3)
- [ ] AC2 — A passing gate receipt is reused while the tree hash is unchanged (req: R2)
- [ ] AC3 — Foundation tasks depend on the A92 action map

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T16:13:24.481Z

- New action kinds: none; command.gate suffices (closed, refine 2026-10-17). Reopen only with a concrete gap command.gate cannot express.
- Digest key: gitTree only; task/feature hashes drop with the proof chain (closed; ADR-140).

### Design

Reuse command.gate (exec without shell, typed outcome, retry, resultFile) for every deterministic step; one implementation stays behind the CLI verb. Receipt reuse: keep readReceiptStatus (quality-gate.ts:337) and swap the digest input to `{gitTree}` from the existing `git read-tree HEAD` / `git add -A` (excluding docs/tasks*, docs/features*) / `git write-tree` capture — corpus edits do not invalidate a code PASS. Depends on A92 (1222 resolver, 1223 self exec, 1224 gate routing). Rejected: new `gate`/`corpus.transition` kinds (duplicate command.gate), shell actions with stricter guards (the shell layer is the overhead being removed).

### Plan

- [ ] Failure modes: dirty tree between receipt and reuse, receipt from another wbs, unbound action, transition refused by graph, command.gate timeout
- [ ] Re-key receipt inputDigest to gitTree; remove proofDigest input
- [ ] Express gate / commit-guard / status transition as command.gate in the fixture workflow
- [ ] Exercise via the fixture workflow

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History
