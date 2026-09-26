---
schema_version: 1
name: "Decompose workflow-service.ts: extract composition lint, run-record inspection and reclamation"
status: todo
template: standard
created_at: 2026-09-26T04:37:18.168Z
updated_at: "2026-09-26T04:40:07.144Z"

---

## 0962. Decompose workflow-service.ts: extract composition lint, run-record inspection and reclamation

### Background

Source: `/sp:dev-review packages --focus all` (2026-09-25), architecture candidate **C2 (weak locality)**, commit base `959f84bd6`.

`packages/app/src/services/workflow-service.ts` is 3,412 lines, 47 exports, 35 imports. `WorkflowAppService` (:606) orchestrates run/continue/cancel/list/trace, but the file also hosts three separable concerns whose logic is **pure or I/O-thin** and already tested as free functions:

| Group | Exports (line) | External consumers (rg, 2026-09-25) |
|---|---|---|
| **Composition lint** (pure over `WorkflowDef`) | `COMPOSITION_CAPS` :292, `collectDecideViolations` :2230, `hitlAnswerVar` :2309, `gateSitesForState` :2320, `collectHitlDecisionViolations` :2368, `collectUndeclaredShellVarViolations` :2450, `countLogicalCommands` :2530, plus the private composition measurers (~:2540-2600) | `workflow/actions/decide.ts`; tests `decide.test.ts`, `decision-evidence.test.ts`, `undeclared-shell-vars.test.ts`, `composition-advisory.test.ts`, `idea-pipeline-routing.test.ts` |
| **Run-record read/inspect** | `readWorkflowRunRecord` :2889, `RUN_RECORD_INSPECT_MAX_BYTES` :2926, `RUN_RECORD_INSPECT_MAX_CHARS` :2933, `stateReadFailureReason` :2936, `inspectWorkflowRunRecord` :3023 | `apps/cli/src/commands/workflow.ts`, `services/agent-service.ts`, `index.ts`, `tests/services/workflow-service.test.ts` |
| **Log/retention config + reclamation types** | `resolveWorkflowLogRetentionDays` :2835, `resolveOutputLogConfig` :2844, `Reclaimed*` / `*ReclamationResult` types | `apps/cli/src/commands/workflow.ts`, `index.ts`, tests |

Stay in the service: `WorkflowAppService`, `mergeWorkflowRunVars` :2718, `InvalidWorkflowRunIdError` :2737, `workflowVersionLiteral` :2077 (used by `services/inline-run-setup.ts`).

Note: `hitlAnswerVar` and `gateSitesForState` have **no** consumer outside the file — they move with the lint group but should become non-exported unless a test needs them.

Plugin standalone contract checked: `plugins/sp/scripts/inline-run-setup.ts` only mentions `readWorkflowRunRecord` in a comment (:358) and uses `import type` from `@gobing-ai/spur-app` (:340) — moving is safe.

Advisory severity. No behavior change intended.

### Requirements

- [ ] R1. Composition-lint functions and `COMPOSITION_CAPS` live in `packages/app/src/workflow/composition-lint.ts`, importing nothing from `services/workflow-service.ts`.
- [ ] R2. Run-record read/inspect functions and constants live in `packages/app/src/workflow/run-record.ts`.
- [ ] R3. Log-retention/output-log config resolvers and reclamation result types live in `packages/app/src/workflow/run-retention.ts` (or co-located with R2 if the split leaves < ~150 lines).
- [ ] R4. Every symbol currently exported from `@gobing-ai/spur-app` stays exported from the barrel with the same name and type (no consumer edits outside `packages/app`).
- [ ] R5. `hitlAnswerVar` and `gateSitesForState` become module-private unless a test consumes them.
- [ ] R6. Zero behavior change: no test assertion is edited; only import paths.

### Acceptance Criteria

- [ ] AC1 — `wc -l packages/app/src/services/workflow-service.ts` is below 2,500 (req: R1)
- [ ] AC2 — `rg "workflow-service" packages/app/src/workflow/composition-lint.ts packages/app/src/workflow/run-record.ts` returns nothing (no back-edge) (req: R1)
- [ ] AC3 — `git diff 959f84bd6 -- 'packages/app/tests/**' 'apps/**/tests/**'` shows only import-line changes (req: R6)
- [ ] AC4 — `bun run typecheck` green with no edits under `apps/` (req: R4)
- [ ] AC5 — `bun run spur-check` green; per-file coverage of each new module ≥ 90% (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Pure move refactor, one commit per group so each is independently revertible:

1. `workflow/composition-lint.ts` — the lint group is pure `WorkflowDef → findings`; placing it under `workflow/` co-locates it with `actions/decide.ts`, its only production consumer.
2. `workflow/run-record.ts` — file-system reads of `<runDir>/<runId>`; takes paths, returns records. `agent-service.ts` imports it directly rather than via the service.
3. `workflow/run-retention.ts` — config → numbers.

The service imports these modules; the modules never import the service (enforce by AC2). Barrel (`src/index.ts`) re-exports from the new locations.

**Rejected:** splitting `WorkflowAppService` itself (run vs continue vs admin). The class is the orchestration seam and its methods share private state; splitting it is a larger redesign with no identified caller pain. Revisit only if a later change forces it.

**Grilling:** *Challenge:* the move churns imports across many test files for no functional gain. *Defense:* the pure lint group gets a direct test surface without instantiating the service, and a 900-line reduction to the hottest file in the package improves locality for every later workflow change; churn is mechanical and confined to import lines (AC3).

### Plan

- [ ] Commit 1: extract composition lint → `workflow/composition-lint.ts`; update `actions/decide.ts` + 5 test imports; privatize `hitlAnswerVar` / `gateSitesForState` if unused by tests.
- [ ] Commit 2: extract run-record → `workflow/run-record.ts`; update `agent-service.ts`, barrel, tests.
- [ ] Commit 3: extract retention resolvers + reclamation types.
- [ ] After each commit: `(cd packages/app && bun test tests/workflow tests/services/workflow-service.test.ts)`; at the end `bun run spur-check` + `bun run test-cf`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-26T04:40:07.144Z backlog → todo (system)

