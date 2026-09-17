---
schema_version: 1
name: "Run-scoped executor pins: resolve every workflow role once at precheck, keep per-role session slots, and apply the coder-reuse / reviewer-fresh stage session policy"
status: todo
template: feature-impl
created_at: 2026-09-17T23:19:46.555Z
updated_at: "2026-09-17T23:20:22.635Z"
feature_id: B7
priority: P1
tags:
  - workflow
  - agent-run
  - session
  - B7
estimate_hours: 8

dependencies: []
---

## 0894. Run-scoped executor pins: resolve every workflow role once at precheck, keep per-role session slots, and apply the coder-reuse / reviewer-fresh stage session policy

### Background

Every model-bearing stage resolves its executor and spawns a cold one-shot subprocess; `agent.run` is 96% of machine time (357 s avg). Authority: `docs/design/session-pinned-dispatch.md` §4 (resolve once, session pin per role, stage policy, capability gate), ADR-121, ADR-047 (affinity precedence). Current code: `agent-run.ts` reads `__agentSessionDir`/`__agentSessionId`, `freshSession`; `doctor.probe` runs per stage. Capabilities come from `getAgentSessionCapability` (task 2 widens it; this task reads whichever fields exist).

### Requirements

- [ ] R1. `precheck` (task-pipeline) and `start` (idea-pipeline) resolve every role declared by the workflow's `agent.run` stages once and write `__executor.<role> = {{ name, agent, model, tier, capabilities }}` into run vars; `agent-run.ts` reads the pin and performs no doctor/detection call on the per-stage path (asserted by a test that fails on any doctor invocation after precheck).
- [ ] R2. Session state moves to `__session.<role>.{{dir,id}}`; the post-run `discoverSessionId` write-back targets the role slot; ADR-047 precedence is preserved (an explicit pin never emits a global continue).
- [ ] R3. `agent.run` accepts an optional `session: reuse | fresh` option; defaults by role are coder → `reuse`, reviewer/planner/scribe → `fresh`; `spur workflow validate` rejects any other value.
- [ ] R4. A reviewer stage may declare `session: reuse` explicitly; the run trace records the declaration source (`default` | `declared`).
- [ ] R5. When the pinned executor's `supportsResumeById` is `false`, every stage runs fresh and one warning `executor-no-resume` is emitted per run (not per stage).
- [ ] R6. `config/workflows/task-pipeline.yaml` and `idea-pipeline.yaml` declare the intended policy per stage (coder stages reuse; review/verify fresh); `bun run --filter @gobing-ai/spur build:bundle` regenerates `apps/cli/config/`.
- [ ] R7. Tests in `packages/app/tests/workflow/` cover R1–R5 with a stubbed resolver; the workflows design satellite documents the `session` option; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B7 scenarios R1, R2, R3, R4, R5.

- [ ] AC1 — Executor resolution happens once per role per run (req: R1)
- [ ] AC2 — A coder-role stage resumes the previous coder-role session (req: R2)
- [ ] AC3 — Reviewer-role stages never inherit the coder session by default (req: R3)
- [ ] AC4 — A stage can override the session policy explicitly (req: R4)
- [ ] AC5 — An executor without resume support degrades to fresh per stage (req: R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: the run, not the stage, is the unit of dispatch (docs/design/session-pinned-dispatch.md §2, §4). Pins are run vars because run vars already survive pauses and resumes and are visible in `workflow trace`; a new store would duplicate that. Stage isolation becomes a declared policy: reviewers are fresh by default so review never inherits the implementer's context (operator confirmed 2026-09-17). Non-resume executors degrade to today's behaviour with one warning, so no agent is blocked by this change. Mutation policy: `packages/app/src/workflow/actions/agent-run.ts`, the precheck/start resolution seam (`doctor.probe` action + `resolveRole`), workflow schema for the `session` option + validate, the two bundled workflow YAMLs, tests, workflows satellite; no pin invalidation, no trace columns, no E6 mapping (task 8).

### Plan

1. Read design §4, ADR-047, `agent-run.ts` affinity block, the `doctor.probe` action, and `resolveRole` in `agent-service.ts`.
2. Implement role enumeration + one-time resolution at precheck/start; write `__executor.<role>` pins.
3. Move session slots to `__session.<role>`; add the `session` option with role defaults and validation; add the one-per-run warning.
4. Declare policies in both workflow YAMLs; rebuild the bundle.
5. Write the tests; update the workflows satellite; run `cd packages/app && bun test tests/workflow/` then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
