---
schema_version: 1
name: Author the workflow execution foundation design satellite
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.814Z
updated_at: "2026-10-17T16:13:21.820Z"
feature_id: D65
priority: P1
tags:
  - docs
  - workflow
  - design
estimate_hours: 3

---

## 1231. Author the workflow execution foundation design satellite

### Background

Feature D65, ADR-140 (Proposed) and the ADR-051 2026-10-17 noun-verb amendment were written directly by the operator's instruction; the non-UI contract they need is still missing. This satellite is the single owner of the dispatch, work-item, receipt, builtin, decision-gate and lease contracts every later D65 task implements. Design review of record: .spur/run/eef3a06e-b461-4ada-a811-f7ac4d89297f-idea-design-review.md.

**Refine corrections (2026-10-17)**
- Host resolution "inline/omitted + host-session pin" → hostSessionId() falls back to CLAUDE_CODE_SESSION_ID (apps/cli/src/commands/agent/shared.ts:152), Claude-only → host resolves by `vars.executor: host`, a branch beside the existing `'fleet'` branch (packages/app/src/workflow/actions/agent-run.ts:687).
- "per-tree gate lease" → task 1127 measured 43/64 gates overlapping across sessions *and* worktrees on one host → host-wide full-gate lock (ADR-140 item 6, D65 R6).
- "builtins gate / corpus.transition" → `command.gate` action already exists (packages/app/src/workflow/actions/command-gate.ts; used task-pipeline.yaml:344, :923) → builtin catalogue = command.gate + existing decide; no new kinds unless command.gate falls short.
- "fleet column blocked when spur serve absent" → scripts/commands/fleet-e2e.ts scaffolds its own scratch fleet → fleet column runs self-contained; blocked only if scaffolding fails.
- Design template path → plugins/sp/skills/spur-dev/templates/design.md.

### Requirements

- [ ] R1. Create docs/design/workflow-execution-foundation.md from plugins/sp/skills/spur-dev/templates/design.md, citing ADR-140 and ADR-051 (amendment 2026-10-17).
- [ ] R2. Specify the work-item payload {runId, state, skill, prompt, inputs, expectFiles, ownedSections}, the single receipt shape for host/subprocess/fleet, and the ADR-126 A4 receipt rules (timeout = outcome-unknown; re-dispatch only on a definite failed/not-started receipt).
- [ ] R3. Specify host resolution by `vars.executor: host` (sibling of the `fleet` branch, agent-run.ts:687), the input-kind pause carrying the work item, and resume via `spur workflow continue <run-id> --answer-text <receipt-path>` with CAS idempotency.
- [ ] R4. Specify deterministic steps as `command.gate` invocations of existing verbs (`spur task gate`, `spur workflow commit-guard`, `spur task update`, `spur self exec`), the self-contained-stage lint rules, gate decision modes per profile, and leases (host-wide full-gate lock, worktree, fleet occupancy) with holder/stale rules.
- [ ] R5. List every CLI surface change; each is an existing verb or a flat `spur <noun> <verb>` flagged for operator consent.
- [ ] R6. Add the satellite row to docs/04_DESIGN.md and point the sp:spur-dev inline-pipeline-driver reference at it as the migration target.

### Acceptance Criteria

- [ ] AC1 — The design satellite documents the foundation (req: R1)
- [ ] AC2 — New commands keep the noun verb shape (req: R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T16:13:21.423Z

- Host selection: `vars.executor: host`, not a session pin — agent-neutral, no new flag (closed, refine 2026-10-17).
- Gate lock scope: host-wide, per task 1127 evidence (closed).
- New builtin kinds: none by default; command.gate covers deterministic steps (closed; reopen only if 1234 finds a gap).

### Design

Docs-only task; it freezes the contracts before code so tasks 1232–1242 cite one owner instead of restating mechanics. Content = the approved design review (.spur/run/eef3a06e-…-idea-design-review.md) as corrected by this refine (see Background corrections); no further decision is made here. Rejected: writing the contract inside each implementation task (drift across 11 tasks). Verify: `spur feature check D65`, link-check, rule presets recommended-pre-check/post-check with zero findings on the touched docs.

### Plan

- [ ] Draft satellite from the design template with the corrected decisions
- [ ] Add 04 index row and inline-pipeline-driver pointer
- [ ] Run link-check and rule presets on touched docs

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
