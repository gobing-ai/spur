---
schema_version: 1
name: Record a closed terminal reason on every workflow run and separate bookkeeping rows
status: todo
template: feature-impl
created_at: 2026-09-24T00:13:17.000Z
updated_at: "2026-09-24T00:23:20.852Z"
feature_id: D64
priority: P1
tags:
  - workflow
  - observability

dependencies: ["0935", "0936", "0925", "0926", "0927", "0928", "0929", "0930", "0931", "0932", "0933", "0934"]
estimate_hours: 10
---

## 0937. Record a closed terminal reason on every workflow run and separate bookkeeping rows

### Background

Implements: R1 — Refactor work starts only after its prerequisite features finish; R2 — Every workflow run ends with a classified terminal reason. Phase 0 of docs/design/workflow-catalogue-refactor.md §3. Starts only after features D63, E7, H53 and H1 are done (declared as task dependencies after batch creation).

**Refine corrections (2026-09-23)**

1. *Owner of the runs row.* The claim was that the enum and column live in `packages/domain`. In fact the run row is finalized by the engine. `@gobing-ai/ts-dual-workflow-engine` `finalizeRun(runId, status, completedAt)` is at `ts-libs/packages/dual-workflow-engine/src/persistence.ts:103` and `:398`. The Spur `drizzle/` migrations own the `runs` DDL (0000, then ALTERs in 0005 and 0007), and the next prefix is **0049**. The reason therefore needs an engine facade change (AGENTS.md: "fix their facades instead of adding Spur workarounds") plus a Spur migration.
2. *The reason is dropped today.* `RunLifecycle.fail(..., reason)` (`run-lifecycle.ts:328`) sends its reason only to the log, span and event. Only `interruptRun` persists `interrupt_reason`. No `closeRun(runId, status, reason)` signature exists. `WorkflowActionTraceWriter.closeRun(runId, status, completedAt?)` is at `packages/app/src/workflow/action-trace.ts:262`.
3. *Failure terminals are ambiguous.* A state finalizes as `failed` only when it is listed in `failureStates`. Its engine reason is `terminal:<stateId>`, so every edge into a shared `failed` state looks the same. A per-transition declared reason is needed.
4. *Bookkeeping tag.* The engine has no row-kind column. Classify bookkeeping at report time from `workflow_name ∈ {task-lifecycle, feature-lifecycle}` using one shared constant. Do not add a second schema column.
5. *Pin lag.* Spur pins engine 0.5.2 (root `package.json` catalog), while the ts-libs source is at 0.5.4. The engine release in step 0 must also absorb the 0.5.2→0.5.4 delta.

### Requirements

- [ ] R1. The closed enum `TerminalReason = 'done' | 'paused-operator' | 'failed-check' | 'failed-agent' | 'failed-timeout' | 'failed-guard' | 'cancelled' | 'interrupted' | 'retry-exhausted'` is exported once from `packages/app/src/workflow/terminal-reason.ts`. The runs row gains a nullable `terminal_reason TEXT` column, added by engine `schema-sql.ts` and by Spur migration `drizzle/0049_spur_cli_runs_terminal_reason.sql`.
- [ ] R2. Every path that finalizes a run (engine `RunLifecycle` done/fail/pause, the cancel path in the lifecycle adapter, `interruptRun`, and `inline-run-setup --close`) persists exactly one reason. `--close --status failed` requires `--reason <enum>`, and an unknown value exits nonzero without writing.
- [ ] R3. A state-machine transition may declare `terminalReason: <enum>`. Workflow validation fails any transition into a `failureStates` member that lacks a declared reason. All ten canonical YAMLs pass after migration.
- [ ] R4. Engine built-in failures map deterministically:
  - `no-passing-transition` → `failed-guard`
  - `iteration-bound-exceeded` → `retry-exhausted`
  - a failed `agent.run` action → `failed-agent`, or `failed-timeout` when the error is a timeout
  - any other failed action → `failed-check`
  - interrupt → `interrupted`
  - pause → `paused-operator`
  - lifecycle cancel → `cancelled`
- [ ] R5. `BOOKKEEPING_WORKFLOWS = ['task-lifecycle', 'feature-lifecycle']` is exported once and used by the cost report (0938) to exclude those runs by default.
- [ ] R6. Legacy rows with a null reason read as `unclassified` in reports. There is no backfill and no guessing.

### Acceptance Criteria

- [ ] AC1 — Refactor work starts only after its prerequisite features finish
- [ ] AC2 — Every workflow run ends with a classified terminal reason

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:55.891Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:23:20.666Z

#### Refine decisions — 2026-09-23 (ready depth)

- **Reason persistence lives in the engine facade, not Spur.** The engine owns `finalizeRun`, and a Spur side table would be a second writer. Upstream ts-libs is writable locally, and AGENTS.md mandates facade fixes.
- **The engine reason is an opaque string. Spur owns the enum.** This keeps ts-libs vocabulary-free and makes classification Spur's job.
- **Bookkeeping is a report-side constant, not a column.** The workflow name already determines it, and a column would be a redundant writer.
- **Legacy nulls map to `unclassified`.** There is no backfill.
- **Estimate: 10h** (engine release plus migration plus classifier plus YAML sweep).

### Design

**Approach.** Persist the reason at the engine seam that already writes the run status. Spur adds only a classifier, the enum and the migration.

*Step 0 (upstream, `/Users/robin/xprojects/ts-libs/packages/dual-workflow-engine`):*
- `finalizeRun(runId, status, completedAt, reason?: string)`, with `terminal_reason` written in both persistence impls (`persistence.ts:103`, `:398`);
- `schema-sql.ts` adds the column and an ALTER;
- `RunLifecycle.complete/fail/pause` forward the reason;
- `schema.ts` state-machine transition gains optional `terminalReason: z.string()`, and when the engine enters a terminal state through a transition that declares it, the reason passed is that value, otherwise the existing built-in string;
- the engine stays enum-agnostic, since the opaque string keeps ts-libs free of Spur vocabulary;
- release the engine and bump the Spur root catalog pin.

*Spur side:*
- `terminal-reason.ts` holds `TERMINAL_REASONS`, `isTerminalReason()`, `classifyTerminalReason({status, engineReason, actionKind?, errorText?})` and `BOOKKEEPING_WORKFLOWS`;
- the `finalizeRun` decorators (`action-trace.ts:177`, `observability.ts:471`, `lifecycle-adapter.ts:219`) classify an engine reason that is not already an enum value, then pass it through;
- `WorkflowActionTraceWriter.closeRun(runId, status, completedAt?, reason?)`;
- `plugins/sp/scripts/inline-run-setup.ts --close` gets `--reason`, validated against a **copied** literal list (plugin standalone contract, so no value import). A parity test asserts that the copy equals `TERMINAL_REASONS`.

*Validation:* a Spur workflow lint rule (the existing workflow validate path) checks transitions into `failureStates` for a declared, valid `terminalReason`.

**Frozen names:**
- `TerminalReason`, `TERMINAL_REASONS`, `classifyTerminalReason`, `BOOKKEEPING_WORKFLOWS`;
- column `terminal_reason`;
- YAML key `terminalReason`;
- CLI flag `--reason`.

**Rejected alternatives:**
- Derive the reason at query time from action rows. It is non-deterministic and drifts with the action vocabulary.
- A Spur-only side table. It is a second writer racing the engine finalize.
- A `kind` column for bookkeeping. The workflow name already determines it.

**Anti-patterns:**
- Guessing reasons for legacy rows.
- A value import of app code into `plugins/sp`.
- Changing `WorkflowStatus`, which stays `running|done|failed|paused|interrupted`.

**Targets:** 100% of new finalize paths covered. All ten canonical YAMLs validate.

**Handoffs:**
- 0938 reads `terminal_reason` and `BOOKKEEPING_WORKFLOWS`.
- 0945 and 0946 author per-edge `terminalReason`.
- E7 (0925/0928) `<runId>.state.json` should project the reason once both land. This is a note, not a blocker.

### Plan

1. **ts-libs engine.** Add the `reason` param, the column and the transition `terminalReason`, with tests in `packages/dual-workflow-engine/tests/` covering finalize-with-reason, declared transition reasons and the built-in fallback. Then run the ts-libs gate, release, and bump the Spur catalog pin (0.5.2 → new). Run `bun install` and `bun run typecheck`.
2. **Spur migration.** Add `drizzle/0049_spur_cli_runs_terminal_reason.sql` (`ALTER TABLE runs ADD COLUMN terminal_reason TEXT`). Check the DAO read mapping, with an in-memory SQLite test.
3. **Classifier.** Write `packages/app/src/workflow/terminal-reason.ts` and `packages/app/tests/workflow/terminal-reason.test.ts` (a table test covering every R4 mapping).
4. **Decorators.** Wire the reason through the three `finalizeRun` decorators and `closeRun`. Extend the existing action-trace, observability and lifecycle-adapter tests.
5. **Inline closer.** Add `inline-run-setup --close --reason` and its validation. Test in `plugins/sp/tests/` for a missing or unknown reason exiting nonzero, plus the parity test against `TERMINAL_REASONS`.
6. **Validation rule.** Add the rule and a declared `terminalReason` on every failure edge in the ten canonical YAMLs. Run `bun run --filter @gobing-ai/spur build:bundle`.
7. **Gates.** Run `bun run spur-check`, then `bun run plugin-smoke`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History
