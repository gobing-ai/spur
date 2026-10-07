---
schema_version: 1
name: Raise implementTimeoutMs default to 45 minutes
status: todo
template: feature-impl
created_at: 2026-10-07T07:29:49.093Z
updated_at: "2026-10-07T16:17:18.408Z"
feature_id: H15

priority: P2
estimate_hours: 2
---

## 1108. Raise implementTimeoutMs default to 45 minutes

### Background

`implementTimeoutMs` defaults to `"1800000"` (30m) at `config/workflows/task-pipeline.yaml:123`. Session evidence: 1096 and 1099 implement dispatches were killed at 30m mid-gate and needed re-dispatch; 1099's full implement consumed the raised 45m budget. The adjacent comment block (yaml :112-124) already documents that budget exhaustion is a real failure mode — the default predates multi-task batch usage.

**Refine corrections (2026-10-07)**

- **Premise error:** the P1 30m kills came from the **pi host subagent limit** ("Subagent timed out after 1800000ms"; pi's subagent `timeoutMs` default is 30m), not from the YAML value. Inline dispatch is governed by the host limit and `timeoutMs` does not apply inline (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:600-612`, task 0727; `:401`). Raising the YAML default alone changes only subprocess surfaces (`spur workflow run`, `--mode parallel`, headless) — it would not have prevented the observed kills. R2 adds the inline half.
- 45m is **not proven sufficient**: 1099 also timed out at the raised 45m budget (resumed), and 1097 used ≈40 of 45 min. 45m is a reasoned default, not a measured bound; the comment must say so.
- Line references re-verified: default at `config/workflows/task-pipeline.yaml:123`, comment block `:118-122`, `stepTimeoutMs` `:117`, implement `agent.run` uses `timeoutMs: ${vars.implementTimeoutMs}` at `:300`.
- R3 (exhaustion visible) already holds — `packages/app/src/workflow/actions/agent-run.ts:1280` reports "terminated by signal … (configured timeout: Nms…)", asserted at `packages/app/tests/workflow/actions/agent-run.test.ts:1378`. Verification only, no new plumbing.
- Missed dependents of the default value: `plugins/sp/tests/skill-structure.test.ts:762` asserts `"1800000"`; `docs/design/planning-workflow-contracts.md:257` states the 30 min default; the comment in `plugins/sp/hooks/context-session-start.ts:77`; `plugins/sp/skills/spur-dev/references/execution-workflow.md:311` and `:349` (check); the generated `apps/cli/config/` copy.

### Requirements

- [ ] R1. `config/workflows/task-pipeline.yaml:123` sets `implementTimeoutMs: "2700000"`. The comment block (`:118-122`) states the 45m default, that it governs subprocess surfaces, and that 45m is a reasoned default (P1: one 45m timeout still occurred) — not a proven bound.
- [ ] R2. The inline driver timeout contract (`inline-pipeline-driver.md` § Timeout boundary, `:600-612`) is amended: when the host's dispatch tool accepts a per-dispatch timeout (pi: subagent `timeoutMs`), the driver passes the stage's resolved YAML `timeoutMs` (implement → `implementTimeoutMs`) and records `host timeout <ms> (yaml timeoutMs)`; when it does not, it records `(platform subagent limit)` as today. No-replay and resume-from-partial-tree rules are unchanged. The `:401` "timeoutMs not applicable inline" statement is reworded to match.
- [ ] R3. The run-var override still works: `--vars '{"implementTimeoutMs":"..."}'` overrides the default on a subprocess run without YAML edits.
- [ ] R4. Budget exhaustion stays visible: the existing `configured timeout` message (`agent-run.ts:1280`) and its test (`agent-run.test.ts:1378`) are unchanged and green.
- [ ] R5. Every dependent of the old value is updated: `skill-structure.test.ts:762` assertion, `planning-workflow-contracts.md:257`, the `context-session-start.ts:77` comment, `execution-workflow.md:311`/`:349` if they state 30m, and `apps/cli/config/` regenerated via `bun run --filter @gobing-ai/spur build:bundle`.

### Acceptance Criteria

- [ ] AC1 — Implement dispatch budget defaults to 45 minutes on subprocess and inline hosts and exhaustion is visible (req: R1, R2, R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:15:15.178Z

- **Q: Does the YAML change fix the P1 kills?** A: No — those were the host limit. R2 makes the inline driver pass the YAML budget to the host when possible. Decided 2026-10-07 refine (amends the 0727 wording; recorded in the driver doc itself).
- **Q: 45m or higher?** A: 45m, labeled as a reasoned default. One P1 run still hit 45m while isolating an unrelated test failure; the resume path handles that case. Raising further without evidence is deferred.

### Design

**Approach:** one config value, one driver-contract amendment, dependent sync. No runtime code changes.

**Frozen names**

- Var `implementTimeoutMs` (unchanged name), default `"2700000"`.
- Run-log boundary strings: `host timeout <ms> (yaml timeoutMs)` | `host timeout <ms> (platform subagent limit)`.

**Inline amendment (R2):** the 0727 rule said the host limit governs and YAML `timeoutMs` is not applicable. The amendment keeps "host governs" as the fallback but makes the YAML budget the requested value whenever the host dispatch tool exposes a timeout parameter. Rationale: the operator sets one budget in one place; a host that silently imposes its own 30m default is what killed 1096 and 1099. A host without the parameter keeps today's behavior, so no host is broken.

**Anti-patterns**

- Claiming 45m is sufficient, or citing "two 30m kills" as a YAML-default failure.
- Adding new timeout plumbing in `agent-run.ts` (R4 is verification only).
- Hand-editing `apps/cli/config/` instead of running `build:bundle`.
- Changing `stepTimeoutMs` or other stage budgets (out of scope).

**Impacted surfaces:** `config/workflows/task-pipeline.yaml`, `apps/cli/config/` (generated), `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, `plugins/sp/skills/spur-dev/references/execution-workflow.md`, `docs/design/planning-workflow-contracts.md`, `plugins/sp/hooks/context-session-start.ts` (comment), `plugins/sp/tests/skill-structure.test.ts`.

**Dependency handoff:** 1107 R5 cites this task. Independent of 1109–1111.

### Plan

1. `rg -n '1800000|30 ?m(in)?' config/workflows plugins/sp docs/design apps/cli/src` — confirm the dependent list; add any missed hit to R5's set.
2. Edit `task-pipeline.yaml:118-123` (value + comment).
3. Amend `inline-pipeline-driver.md:600-612` and `:401` per R2.
4. Update `planning-workflow-contracts.md:257`, `context-session-start.ts:77` comment, `execution-workflow.md` if needed.
5. Update `skill-structure.test.ts:762` to `"2700000"`.
6. `bun run --filter @gobing-ai/spur build:bundle`; confirm `apps/cli/config/` diff carries the new value.
7. `(cd plugins/sp && bun test tests/skill-structure.test.ts)`; `(cd packages/app && bun test tests/workflow/actions/agent-run.test.ts)`; then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: H15
- `config/workflows/task-pipeline.yaml:117-123`, `config/workflows/task-pipeline.yaml:300`
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:401`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:600-612` (task 0727)
- `packages/app/src/workflow/actions/agent-run.ts:1280`, `packages/app/tests/workflow/actions/agent-run.test.ts:1378`
- Evidence: 1107 report (`docs/reports/i31/1107-runall-p1-pilot.md`)

### History

- 2026-10-07T07:34:13.557Z backlog → todo (system)

### Notes

The comment at yaml :119-121 currently reasons about the 30m choice — supersede it with the evidence, don't leave two justifications. `stepTimeoutMs` (review/verify/test-fix hops, :113) is a separate budget: leave it alone. Static-vs-run-var discipline per ADR-115: this var is already a run var, so no new knob is being added — only the default moves.

