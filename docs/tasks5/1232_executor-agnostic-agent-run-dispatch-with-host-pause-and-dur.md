---
schema_version: 1
name: Executor-agnostic agent.run dispatch with host pause and durable receipt
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.817Z
updated_at: "2026-10-17T16:13:23.065Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - engine
  - fleet
estimate_hours: 8

dependencies: ["1231"]
---

## 1232. Executor-agnostic agent.run dispatch with host pause and durable receipt

### Background

Feature D65 F1/F2. Today the host LLM interprets the YAML (ADR-047 amendments, ADR-087), costing 32% driver overhead across 32 measured runs. The engine must execute every surface and hand an agent.run to a host, subprocess or fleet executor through one work item and one receipt.

**Refine corrections (2026-10-17)**
- R4 "host resolution uses the host-session pin (ADR-121/132)" → hostSessionId() is Claude-only (CLAUDE_CODE_SESSION_ID, apps/cli/src/commands/agent/shared.ts:152) → resolve host by `context.vars.executor === 'host'` beside the `'fleet'` branch (agent-run.ts:687); driver skills pass `--vars '{"executor":"host"}'`. No new flag.
- Design premise "--answer-text accepted on non-input pauses" → continue.ts:100 targets input gates only → the host pause is an input-kind pause so --answer-text carries the receipt path.
- `workflow run` has no --agent flag (flags: --vars, --run-id, --async, --json) → executor is a var, consistent with above.

### Requirements

- [ ] R1. When an agent.run runs with `vars.executor: host`, the engine pauses the run as an input-kind pause and `spur workflow run|continue --json` returns the work item as the pause payload.
- [ ] R2. `spur workflow continue <run-id> --answer-text <receipt-path>` validates the receipt (expectFiles present, owned sections written) and resumes; a second continue on a non-paused run is refused without side effects.
- [ ] R3. Subprocess (`AgentRunActionRunner`) and fleet (`fleet-dispatch.ts` dispatchToFleet :138) executors write the same receipt shape; ADR-126 A4 rules apply to all three.
- [ ] R4. Executor selection is `vars.executor` (host | fleet | unset → existing tier resolution, agent-run.ts:444); headless callers keep ADR-087 substitution. No new verb or flag unless the operator consents at review.

### Acceptance Criteria

- [ ] AC1 — The host executor pauses the run with a work item at an agent.run stage (req: R1, R2)
- [ ] AC2 — Subprocess and fleet executors complete the same work item on a durable receipt (req: R3)
- [ ] AC3 — New commands keep the noun verb shape (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T16:13:22.659Z

- Host selection via `vars.executor: host` (closed, refine 2026-10-17): agent-neutral, reuses the existing fleet branch pattern, needs no flag.
- Pause kind: input-kind, because --answer-text is input-only (closed).

### Design

Add a `host` branch next to the `fleet` branch at agent-run.ts:687: it writes the work item, then raises the engine's existing input-kind HITL pause (same persistence, `run --json` surfacing and CAS claim the hitl `input` action already uses). Resume reuses `--answer-text` (input-only, continue.ts:100), whose value is the receipt path; the runner validates the receipt before releasing the transition. The receipt is a file path so host, subprocess and fleet differ only in who writes it. Agent-neutral: no CLAUDE_CODE_SESSION_ID dependency. Rejected: session-pin resolution (Claude-only), subprocess-everything (loses host context and native subagents), host-only (breaks fleet), a new run state (the pause already exists).

### Plan

- [ ] Write failure modes first: missing receipt, partial expectFiles, double continue, stale run, fleet timeout, executor var unset
- [ ] `host` branch at agent-run.ts:687 raising an input-kind pause with the work item
- [ ] Receipt validation on continue
- [ ] Unify subprocess/fleet receipt shape
- [ ] E2E through the fixture workflow (shared with 1238)

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
