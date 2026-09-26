---
schema_version: 1
name: Record a closed terminal reason on every workflow run and separate bookkeeping rows
status: done
template: feature-impl
created_at: 2026-09-24T00:13:17.000Z
updated_at: "2026-09-26T02:49:57.822Z"
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

- [x] R1. The closed enum `TerminalReason = 'done' | 'paused-operator' | 'failed-check' | 'failed-agent' | 'failed-timeout' | 'failed-guard' | 'cancelled' | 'interrupted' | 'retry-exhausted'` is exported once from `packages/app/src/workflow/terminal-reason.ts`. The runs row gains a nullable `terminal_reason TEXT` column, added by engine `schema-sql.ts` and by Spur migration `drizzle/0049_spur_cli_runs_terminal_reason.sql`.
- [x] R2. Every path that finalizes a run (engine `RunLifecycle` done/fail/pause, the cancel path in the lifecycle adapter, `interruptRun`, and `inline-run-setup --close`) persists exactly one reason. `--close --status failed` requires `--reason <enum>`, and an unknown value exits nonzero without writing.
- [x] R3. A state-machine transition may declare `terminalReason: <enum>`. Workflow validation fails any transition into a `failureStates` member that lacks a declared reason. All ten canonical YAMLs pass after migration.
- [x] R4. Engine built-in failures map deterministically:
  - `no-passing-transition` → `failed-guard`
  - `iteration-bound-exceeded` → `retry-exhausted`
  - a failed `agent.run` action → `failed-agent`, or `failed-timeout` when the error is a timeout
  - any other failed action → `failed-check`
  - interrupt → `interrupted`
  - pause → `paused-operator`
  - lifecycle cancel → `cancelled`
- [x] R5. `BOOKKEEPING_WORKFLOWS = ['task-lifecycle', 'feature-lifecycle']` is exported once and used by the cost report (0938) to exclude those runs by default.
- [x] R6. Legacy rows with a null reason read as `unclassified` in reports. There is no backfill and no guessing.

### Acceptance Criteria

- [x] AC1 — Refactor work starts only after its prerequisite features finish
- [x] AC2 — Every workflow run ends with a classified terminal reason

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

Implemented R1–R6. Two phases: an upstream engine release (operator-authorized, escalation 1/2) followed by the Spur-side integration.

**Upstream ts-libs (full-auto release contract):** branch `feat/engine-terminal-reason`, commit `fabfad09` — `finalizeRun(runId, status, completedAt, fence?, reason?)` in both adapters, `runs.terminal_reason TEXT` (CREATE + guarded ALTER in `schema-sql.ts`), `interruptRun` mirrors the reason, `claimRunOwnership` clears it on resume, `RunLifecycle.done/fail/pause` forward it, and state-machine `TransitionDef.terminalReason` overrides the built-in terminal reason on declared edges (`.strict()` preserved). Package gate: 454 tests, lint + typecheck green. Released as `@gobing-ai/ts-dual-workflow-engine@0.5.6` (tags `@gobing-ai/ts-dual-workflow-engine-v0.5.6` + aggregate `@gobing-ai/ts-libs-v0.5.6`, the actual Publish trigger; CI run 36087285491 success; registry confirmed). Spur pin bumped `^0.5.5` → `^0.5.6` (root `package.json` catalog).

**Spur side:**
- `packages/app/src/workflow/terminal-reason.ts` (new): `TERMINAL_REASONS` (frozen R1 order), `TerminalReason`, `isTerminalReason`, `BOOKKEEPING_WORKFLOWS`/`isBookkeepingWorkflow`, and `classifyTerminalReason({status, engineReason, actionKind?, errorText?})` (packages/app/src/workflow/terminal-reason.ts:51) implementing the R4 mappings; declared enum values pass through untouched; exports added to the app index for the 0938 handoff.
- Decorators classify at the seam so `runs.terminal_reason` always holds an enum value: `WorkflowActionTraceWriter.finalizeRun` (+fence/reason, packages/app/src/workflow/action-trace.ts:178) and `closeRun` (+reason, packages/app/src/workflow/action-trace.ts:280), and `ObservableWorkflowAdapter.finalizeRun` (packages/app/src/workflow/observability.ts:472). The Proxy-based pid/identity decorators forward all args unchanged. `lifecycle-adapter` declares reasons directly: entity `done` → `done`, `cancelled` → `cancelled` (status still `failed`); reopen finalizes with no reason, clearing the stale one.
- Migration: `drizzle/0049_spur_cli_runs_terminal_reason.sql` + `CLI_RUNS_TERMINAL_REASON_SCHEMA_SQL` registered in `packages/domain/src/migrations.ts:1545` with `addColumnIfMissing {runs, terminal_reason}` and the 0041-style table-absent skip. `RunDao.traceRowById` now selects `terminal_reason` (the 0938 read path).
- Validate rule (R3): `collectTerminalReasonViolations` (packages/app/src/services/workflow-service.ts:2156, wired at :699) in the shared post-schema walk — any state-machine transition into a `failureStates` member must declare a valid enum `terminalReason`. `apps/cli/schemas/state-machine-workflow.schema.json` accepts the new key (single schema copy). All ten canonical YAMLs validate (7 annotated, 40 failure edges, reasons assigned per edge semantics: gates → `failed-check`, retry caps → `retry-exhausted`, operator reject/cancel → `cancelled`, empty agent capture → `failed-agent`); a stripped-edge variant fails validation as required.
- `inline-run-setup --close --reason` (R2): copied `TERMINal_REASONS` literal (plugin standalone contract), `--close --status failed` without a reason — or with a non-enum reason — exits nonzero before any write; the reason flows through `writer.closeRun`.

**Tests** (all green, run in workspace subshells): `packages/app/tests/workflow/terminal-reason.test.ts` (enum/guard, full R4 table, status-only classification, bookkeeping list, decorator classify+forward capture, 0.5.6 adapter persists the reason), `packages/domain/tests/dao/migrations.test.ts` (0049 id/SQL/guard + journal counts), `plugins/sp/tests/inline-run-close-reason.test.ts` (copy↔export parity, both R2 nonzero-before-write cases), plus existing action-trace/observability/workflow-service/run-dao suites re-run.

**Deviations:** `finalizeRun` gained the reason as the 5th param (after the engine's existing `fence`), not the Design's literal 4-arg shape — required for legacy-adapter assignability. Decorators classify only `{status, engineReason}` (they hold no action context); `failed-agent`/`failed-timeout` reach the column via declared YAML reasons or context-bearing callers — per-edge authoring is the 0945/0946 handoff. Engine CHANGELOG entry deferred (repo convention is a separate changelog commit, outside the release contract).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/terminal-reason.ts:7-24` — TERMINAL_REASONS (9 closed values), TerminalReason type, isTerminalReason guard; column via `drizzle/0049_spur_cli_runs_terminal_reason.sql:7`; registered `packages/domain/src/migrations.ts:1545-1547` (addColumnIfMissing); nullable read `packages/domain/src/dao/run-dao.ts:121,127` |
| R2 | MET | finalize seams classify+persist: `packages/app/src/workflow/action-trace.ts:199,301`, `packages/app/src/workflow/observability.ts:490`; lifecycle cancel→'cancelled' `packages/app/src/workflow/lifecycle-adapter.ts:235-247`; interrupt→'interrupted' `packages/app/src/services/workflow-service.ts:958-967`; `--close --reason` closed-set pre-write validation `plugins/sp/scripts/inline-run-setup.ts:612-618` (tests `plugins/sp/tests/inline-run-close-reason.test.ts:35,52`; parity vs TERMINAL_REASONS `plugins/sp/tests/inline-run-close-reason.test.ts:8`) |
| R3 | MET | failureState-edge rule `collectTerminalReasonViolations` `packages/app/src/services/workflow-service.ts:2207-2222` wired `packages/app/src/services/workflow-service.ts:709-713`; 7 failureState YAMLs declare terminalReason, 3 without failureStates need none |
| R4 | MET | deterministic map `classifyTerminalReason` `packages/app/src/workflow/terminal-reason.ts:55-69` (passthrough, no-passing-*→failed-guard, iteration-bound-exceeded→retry-exhausted, timeout→failed-timeout, agent.run→failed-agent); table-tested `packages/app/tests/workflow/terminal-reason.test.ts:30-57` |
| R5 | MET | BOOKKEEPING_WORKFLOWS=['task-lifecycle','feature-lifecycle'] exported once `packages/app/src/workflow/terminal-reason.ts:31-35`, re-export `packages/app/src/index.ts:918-925`; 0938 report consumer sequenced per design |
| R6 | MET | classifier never guesses legacy nulls (`packages/app/src/workflow/terminal-reason.ts:53`); migration bare ALTER, no backfill; reopen/claim nulls stale reason |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Refactor work starts only after its prerequisite features finish | MET | command | `task show 0935 --json` status done; `task show 0936 --json` status done; full declared chain 0925-0936 closed before implementation start (task doc dependencies + History) |
| AC2 — Every workflow run ends with a classified terminal reason | MET | test | every engine write surface audited: finalize classified (`packages/app/src/workflow/action-trace.ts:199,301`, `packages/app/src/workflow/observability.ts:490`), interrupt enum verbatim (`packages/app/src/services/workflow-service.ts:958-967`), reopen NULLs; DB round-trip proof `packages/app/tests/workflow/terminal-reason.test.ts:100-131` yields terminal_reason='failed-guard' |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0937 (re-review #2, post-remediation)

**Scope:** task 0937 diff vs base 34d3dd0de (engine 0.5.6 facade + Spur migration 0049 + classifier + decorators + inline closer + generated bundles)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | Review #1 P2#1 resolved: clean() passes declared 'interrupted' into engine.interruptRun; stale detail preserved via dao.mergeMetadata under the same $.staleReason key finalizeStale uses — R2 enum-or-null invariant now holds on every terminal_reason write (finalize reason??null, interrupt verbatim-enum, reopen NULL) | `packages/app/src/services/workflow-service.ts:947-964`, `packages/domain/src/dao/run-dao.ts:250-256` |
| 2 | P4 (advisory) | correctness | Review #1 P2#2 resolved: all three classifyTerminalReason seams forward errorText:reason, realizing failed-timeout in production paths | `packages/app/src/workflow/action-trace.ts:195-201,299-303`, `packages/app/src/workflow/observability.ts:483-492` |
| 3 | P4 (advisory) | correctness | Review #1 P4#4 resolved: validation message renders single colon | `packages/app/src/services/workflow-service.ts:2172-2174` |
| 4 | P4 (advisory) | correctness | Engine interruptRun persists its reason verbatim into terminal_reason (node_modules engine 0.5.6) — invariant is convention-enforced at call sites; today the sole caller passes the enum value, future callers must too | `packages/app/src/services/workflow-service.ts:947`, engine persistence interruptRun |
| 5 | P4 (advisory) | architecture | Review #1 P4#3 deferred as dispositioned: plugin enum-copy parity test stays literal-list (loud on drift, not brittle-silent); accepted, revisit if the enum grows | `plugins/sp/tests/inline-run-close-reason.test.ts:20` |

No P1–P3 findings: all four review-#1 items dispositioned (2×P2 remediated with evidence, 1×P4 fixed, 1×P4 deferred as advisory); generated artifacts in sync (`plugins/sp/lib/inline-run.generated.mjs` carries the 9-value enum incl. "interrupted", the errorText classifier and both forwarding call sites); gate PASS at digest sha256:97b55c3382951e8cacef30c664d63eebb53b3c66f04724116b8bf683f212b95e (9018 pass / 0 fail, not re-run).

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | enum + guard once in `packages/app/src/workflow/terminal-reason.ts:10-40`; column via `drizzle/0049_spur_cli_runs_terminal_reason.sql:6` and engine schema 0.5.6 |
| R2 | MET | every finalize seam classified: `action-trace.ts:195-201,299-303`, `observability.ts:483-492`, `lifecycle-adapter.ts:243-246` (declared enum passthrough); interrupt → enum via `workflow-service.ts:947-951`; `--close --reason` validated against closed set pre-write, unknown/missing-on-failed exits nonzero (`plugins/sp/scripts/inline-run-setup.ts:511-518`); stale detail to metadata_json, not the enum column |
| R3 | MET | failureState edges require declared enum terminalReason (`workflow-service.ts:2166-2176`); all ten canonical YAMLs migrated and gate-green |
| R4 | MET | deterministic map incl. errorText timeout→failed-timeout and agent.run→failed-agent (`terminal-reason.ts:58-69`), table-tested (`packages/app/tests/workflow/terminal-reason.test.ts:31-57`) and now reachable from production seams (finding #2) |
| R5 | MET | `BOOKKEEPING_WORKFLOWS` exported once (`terminal-reason.ts:28-30`, re-export `packages/app/src/index.ts:898-900`) for the 0938 report-time consumer (sequenced later task, per design) |
| R6 | MET | classifier never guesses legacy nulls (`terminal-reason.ts:47-48` comment: reports read the column); no backfill migration shipped |
| AC1 | MET | prerequisites 0935/0936 + declared dependency chain completed before implementation (task dependencies block) |
| AC2 | MET | every closed run row ends with exactly one classified enum reason or null — engine write surfaces audited: finalize (`reason ?? null`), interrupt (enum caller), claim/reopen (`NULL`) |

**Next:** record PASS; close review loop — 0938 consumes R5/R6 report-side.

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History

- 2026-09-25T03:14:31.285Z todo → wip (system)
- 2026-09-25T04:23:26.003Z wip → testing (system)
- 2026-09-25T04:24:00.423Z testing → done (system)

