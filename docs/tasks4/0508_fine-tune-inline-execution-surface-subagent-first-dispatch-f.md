---
template: meta
schema_version: 1
name: "Fine-tune inline execution surface: subagent-first dispatch for non-interactive pipeline stages with host-session fallback"
description: ""
status: backlog
type: meta
profile: standard
feature_id: E
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0506"]
ac_numbering: task-local
created_at: "2026-08-11T06:19:26.407Z"
updated_at: "2026-08-11T06:37:05.502Z"
---

## 0508. Fine-tune inline execution surface: subagent-first dispatch for non-interactive pipeline stages with host-session fallback

### Background
ADR-047 and the current inline-driver contract define interactive omit/`--agent inline` task pipelines as host-session execution. That preserves operator contact and avoids a Spur subprocess, but it also makes the host execute every model-bearing `agent.run` stage. Task 0506 records the resulting host-context growth and separately fixes the wrap subprocess handoff.

The repository already defines native subagents as the default delegation surface when the host platform provides them and none of the objective subprocess triggers applies. The existing inline pipeline driver does not apply that rule to sequential task-pipeline stages. The previous 0508 draft was internally contradictory: it preserved a host-only definition of `inline`, prohibited a new selector, yet allowed subagent dispatch when an unspecified selector and a subjective handoff-cost test permitted it.

This task resolves the contract explicitly. For interactive full `/sp:dev-run` and sequential `/sp:dev-runall`, omit/`--agent inline` continues to mean no Spur subprocess, but no longer guarantees that every model stage runs in the host context. Eligible `agent.run` stages dispatch once to a native subagent and join before the driver continues; the host is the deterministic fallback and retains every operator-facing pause. Direct implement-only execution, explicit/headless subprocess execution, parallel batches, and wrap remain unchanged.

Task 0508 depends on task 0506 because both update execution-surface documentation and parity tests. It consumes 0506's clarified wrap contract but does not reopen wrap behavior.
### Requirements
- [ ] R1. Amend the interactive-inline contract so omitted/`--agent inline` full `/sp:dev-run` and sequential `/sp:dev-runall` keep the pipeline controller in the host session while eligible model-bearing `agent.run` stages prefer a native subagent. Preserve host fallback, keep all Spur subprocess paths unchanged, and record the decision in ADR-047 plus the architecture/design projections.
- [ ] R2. Make eligibility deterministic. Dispatch only when the current action is a pure-slash `agent.run`, the state is not interactive, the host platform exposes a native subagent, and that subagent has the shared-worktree read/write/shell capabilities required to execute the declared stage and write its artifacts. Remove the subjective handoff-cost heuristic. If any pre-dispatch condition fails, execute the stage once in the host session.
- [ ] R3. Preserve stage semantics across the native-subagent boundary. The host snapshots the pre-stage worktree, dispatches only the YAML's pure slash command plus a surface-resolved anti-recursion envelope, waits for completion, then enforces `answerFile`, `expectFile`, `requireDiff`, task scope, guards, and error policy against the shared filesystem. Successful subagent work logs `stage <id> executed via subagent <agent-id> (host session <session-id>)`; host fallback retains the existing inline provenance. A failure after dispatch must follow the stage error policy and must not replay the stage automatically in the host.
- [ ] R4. Keep operator interaction host-owned. Interactive confirmation actions, `pause: true`, approve/taste/ask decisions, and any blocker returned by a subagent are surfaced by the host; they are never delegated or answered by a subagent. Native subagents execute sequentially, one writer at a time, and cannot recursively dispatch the same stage.
- [ ] R5. Update every authority and parity surface that currently says interactive inline is host-only: ADR-047, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, the cross-cutting value table, flag glossary, execution workflow, inline driver, run/runall command and operation prose, and the native-dispatch cross-reference. Extend the existing inline/parity contract tests to pin the new semantics without adding a flag value.

Non-goals: a new `--agent` value or public CLI flag; changes to `spur agent run`, workflow-engine `agent.run`, task-pipeline YAML, model-tier routing, parallel execution, direct `--mode implement`, wrap/wrapall, platform-specific adapters, concurrent stage execution, automatic retry of a partially executed subagent stage, or ingestion of session/conversation data.
### Acceptance Criteria
Scenario: R1, R2 — Eligible inline pipeline stages dispatch once to a native subagent
  Given an interactive full `/sp:dev-run` or sequential `/sp:dev-runall` uses omitted/`--agent inline`
  And the current YAML action is a non-interactive pure-slash `agent.run`
  And the host platform exposes a native subagent with shared-worktree read/write/shell capability
  When the inline driver executes the action
  Then it dispatches the exact slash command once to that native subagent
  And waits for the subagent before evaluating the next action or guard
  And it does not invoke `spur agent run`

Scenario: R2 — Failed eligibility uses the host without changing subprocess paths
  Given an inline pipeline stage lacks native-subagent support or a required capability, or is not a pure-slash `agent.run`
  When the driver selects its execution surface
  Then it executes that stage once in the host session
  And logs `stage <id> executed inline in session <session-id>`
  And `--agent auto`, named, headless, and parallel paths remain subprocess-backed

Scenario: R3 — The host validates shared artifacts and records distinct provenance
  Given a native subagent completes an eligible stage
  When control returns to the host
  Then the host enforces the YAML's answerFile, expectFile, requireDiff, task-scope, guard, and error-policy contracts against the shared filesystem
  And successful execution logs `stage <id> executed via subagent <agent-id> (host session <session-id>)`
  And the log never labels that stage as executed inline

Scenario: R3 — A dispatched failure is not replayed in the host
  Given a native subagent has started and returns failure or incomplete required artifacts
  When the host evaluates the stage result
  Then the driver follows the YAML action's existing failure policy
  And it does not automatically execute the same slash command again in the host session

Scenario: R4 — Operator-facing states remain host-owned
  Given the current action requires operator confirmation, the state has `pause: true`, or a subagent returns an operator blocker
  When the driver reaches the decision
  Then the host surfaces the prompt or blocker to the operator
  And no subagent answers, approves, or continues that decision

Scenario: R5 — Authority and parity surfaces agree
  Given ADR-047 and the interactive-inline documentation are updated
  When `bun test plugins/sp/tests/inline-execution-contract.test.ts plugins/sp/tests/flag-contract-parity.test.ts` runs
  Then the tests prove omit/`inline` remains an in-session, non-subprocess surface with native-subagent-first eligible stages and host fallback
  And the `--agent <inline|auto|name>` value set is unchanged
### Q&A
**Q: Does this change `inline` semantics?**

A: Yes, narrowly and explicitly. Interactive `inline` still forbids a Spur subprocess and keeps the controller/operator loop in the host, but it no longer promises that every model stage uses the host context. ADR-047, the value table, and parity tests must state that change together.

**Q: Why not add `--agent subagent` or another flag?**

A: Native subagents are an in-platform execution surface, not configured Spur executors. The existing dispatch contract already prefers them for delegation. Applying that rule inside the inline driver is smaller and avoids a fourth selector meaning that every shared command would need to define.

**Q: How is dispatch eligibility decided?**

A: By observable facts only: action kind, pure-slash input, interactive-state exclusion, native-subagent availability, and required tool capabilities. The draft's subjective cost comparison is removed because it is not reproducible.

**Q: Can review use a read-only subagent?**

A: Not for the pipeline stage as currently defined. Review and verify write task/run artifacts through the shared CLI, so every dispatched stage requires shared-worktree read/write/shell capability. A future split between analysis and artifact recording would be separate work.

**Q: What exactly is sent to the subagent?**

A: The YAML's existing pure slash command, the stage ID, and a short note that the execution surface is already resolved and the same stage must not be redispatched. Do not paste the host transcript or hard-code a session-local `local://` path.

**Q: What happens when dispatch fails?**

A: Failure before launch falls back to one host execution. Failure after launch follows the stage's existing error policy and never triggers an automatic host replay, because the shared worktree may already contain partial writes.

**Q: How does this relate to task 0506?**

A: 0506 lands first and owns wrap selector propagation plus its subprocess notice. 0508 changes only the interactive task-pipeline driver and its documentation/tests; wrap stays workflow-backed.

No open design decisions remain.
### Design
**Authority and projection order**

1. Amend `docs/00_ADR.md` ADR-047: interactive omit/`inline` keeps the controller in the host process/session, but eligible sequential `agent.run` stages may use a native subagent; explicit/headless/parallel subprocess paths are unchanged.
2. Project the amendment into `docs/03_ARCHITECTURE.md` §6.3 and the matching `docs/04_DESIGN.md` execution-surface sections in the same commit.
3. Update the operational SSOTs: `plugins/sp/skills/spur-dev/references/cross-cutting.md`, `inline-pipeline-driver.md`, `execution-workflow.md`, `dev-operations.md`, and `flag-glossary.md`; update `plugins/sp/commands/dev-run.md` and `dev-runall.md` so operator-facing prose no longer promises host-only model stages.
4. Add only a cross-reference in `plugins/sp/skills/parallel-execution/references/dispatch-surface.md`; it remains the authority for native-subagent versus `spur agent run` selection.

**Frozen surface matrix**

| Invocation | Controller | Model stage | Fallback |
| --- | --- | --- | --- |
| Interactive full `dev-run`, omit/`inline` | Host | Eligible `agent.run`: native subagent | Host stage execution |
| Interactive sequential `dev-runall`, omit/`inline` | Host | Eligible `agent.run`: native subagent, one at a time | Host stage execution |
| Direct `dev-run --mode implement` | Host | Host, unchanged | N/A |
| `--agent auto` or named, headless, parallel | Existing workflow/subprocess path | Existing subprocess executor | Existing contract |

No flag, config key, workflow variable, YAML action, or engine API is added.

**Eligibility algorithm**

Evaluate before each action, in this order:

1. The invocation is one of the two interactive inline full-pipeline surfaces in the matrix.
2. The YAML action kind is `agent.run` and its input is a pure slash command. Shell, note, file, guard, and operator-interaction actions remain host-executed.
3. The current state/action has no operator-confirmation action, `pause: true`, approve/taste/ask decision, or other operator prompt.
4. The platform exposes a native subagent that shares the working tree and has read, write, shell, and Spur task/run-artifact access.

All four pass → dispatch. Any pre-dispatch failure → execute once in the host. Do not add a token estimate, stage-size threshold, model heuristic, or configuration switch.

**Dispatch and join contract**

- Before dispatch, the host captures the same pre-action git snapshot used by current `requireDiff` enforcement.
- Send only: stage ID, the YAML's exact pure slash command, and `execution surface already resolved: native subagent; do not dispatch this stage again`. The WBS/path already carried by the slash command is the handoff; do not paste task/session transcripts or embed machine-specific session paths.
- Dispatch exactly one native subagent and wait for it. The inline FSM must not advance actions or guards concurrently; this preserves the repository's one-writer rule.
- After join, the host validates `answerFile`, `expectFile`, `requireDiff`, task scope, and the action's error policy from the shared filesystem. A subagent success message is not evidence.
- On success, append exactly `stage <id> executed via subagent <agent-id> (host session <session-id>)`. Host execution retains exactly `stage <id> executed inline in session <session-id>`.
- If launch fails before the subagent starts, log the reason and use host fallback. If a started subagent fails or leaves invalid artifacts, do not replay; follow the YAML error policy so partial mutations are not duplicated.

**Interactive ownership**

The host alone executes operator-confirmation actions, owns `pause: true`, and surfaces approve/taste/ask decisions. A subagent that discovers missing authority or an operator decision returns a blocker; the host pauses at the current state and presents it. The subagent cannot approve, infer consent, or recursively invoke the full pipeline.

**Tests**

- Extend `plugins/sp/tests/inline-execution-contract.test.ts` with structural assertions for the eligibility algorithm, exact two provenance formats, pre-launch fallback, no post-launch replay, sequential join, and host-owned operator decisions.
- Keep `plugins/sp/tests/flag-contract-parity.test.ts` and `plugins/sp/scripts/validate-flag-contracts.ts` on the same three values. Update only fixtures/claims that encode host-only inline semantics; C3a/C3b must remain green.
- No platform-mocking framework or new runtime test harness. The contract is prompt-runtime documentation, so the existing structural gate is the executable regression seam.

**Cross-task contract:** task 0506 is the sole hard dependency. Assume its wrap selector/parity changes are present, preserve them while editing shared tests, and do not modify wrap commands, wrap workflow behavior, history import, or schema-first guidance. No downstream task is currently declared.

**Traceability:** feature E is a grouping feature without feature-level scenarios; task-local R1–R5 acceptance criteria are authoritative.

**Anti-patterns:** no new selector value; no host transcript in dispatch prompts; no machine-specific session path; no read-only agent for artifact-writing stages; no parallel stage writers; no subagent self-dispatch; no host replay after a started subagent; no workflow-engine/native-subagent abstraction; no copied FSM.
### Plan
- [ ] P1 (R1, R5) After task 0506 is done, amend ADR-047 and update `docs/03_ARCHITECTURE.md` plus `docs/04_DESIGN.md` to define interactive inline as host-controlled, native-subagent-first for eligible stages, and non-subprocess.
- [ ] P2 (R1, R2, R4) Update the cross-cutting value table, flag glossary, execution workflow, dev-operations, run/runall command prose, and dispatch-surface cross-reference with the frozen surface matrix and eligibility algorithm; keep `--agent <inline|auto|name>` unchanged.
- [ ] P3 (R3, R4) Update the inline pipeline driver with the minimal dispatch envelope, sequential join, shared-filesystem artifact validation, exact provenance, pre-launch host fallback, no post-launch replay, and host-owned operator-decision/blocker handling.
- [ ] P4 (R5) Extend `inline-execution-contract.test.ts` and adjust only the host-only claims in flag-parity fixtures/validation; run the two focused test files to green.
- [ ] P5 (R1–R5) Run the repository completion gates required by `AGENTS.md`, task verification, and intentional `git status`; do not run a real task pipeline or inspect session/conversation logs as implementation evidence.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Dependency: task 0506 (`docs/tasks4/0506_fix-0505-run-inefficiencies-inline-wrap-hop-dry-run-probe-gu.md`)
- Decision authority: `docs/00_ADR.md` ADR-041 and ADR-047 plus the 2026-08-10 amendment
- Architecture projection: `docs/03_ARCHITECTURE.md` §6.3
- Design projection: `docs/04_DESIGN.md` execution-surface and inline-driver sections
- Execution-surface SSOT: `plugins/sp/skills/spur-dev/references/cross-cutting.md` § Inline-default execution surface
- Inline driver: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`
- Execution mechanics: `plugins/sp/skills/spur-dev/references/execution-workflow.md`, `dev-operations.md`, `flag-glossary.md`
- Operator surfaces: `plugins/sp/commands/dev-run.md`, `plugins/sp/commands/dev-runall.md`
- Native dispatch authority: `plugins/sp/skills/parallel-execution/references/dispatch-surface.md`
- Pipeline SSOT: `.spur/workflows/task-pipeline.yaml`
- Contract gates: `plugins/sp/tests/inline-execution-contract.test.ts`, `plugins/sp/tests/flag-contract-parity.test.ts`, `plugins/sp/scripts/validate-flag-contracts.ts`
### History
### Notes
**Verified premises**

- ADR-047's 2026-08-10 amendment, `cross-cutting.md`, `inline-pipeline-driver.md`, `dev-run.md`, `dev-runall.md`, and the architecture/design projections currently promise host-session execution for interactive omit/`inline` stages.
- `dispatch-surface.md` already prefers native subagents when the platform provides one and no objective subprocess trigger applies.
- The inline driver is a prompt-runtime interpreter over the existing YAML, not an engine implementation; its executable regression seam is `inline-execution-contract.test.ts` plus flag parity.
- Pipeline review and verify stages write task/run artifacts, so a read-only subagent cannot execute the current pure-slash stage contract.
- Task 0506 edits shared execution-surface/parity files and must land first to avoid concurrent ownership.

**Refinement dispositions**

- Acknowledge and document the narrow `inline` semantic change instead of claiming host-only semantics are unchanged.
- Reuse the existing three-value selector; add no `subagent` flag/value.
- Replace subjective handoff-cost judgment with four observable eligibility checks.
- Use the WBS-bearing pure slash command as the handoff; remove hard-coded session-local references.
- Separate pre-launch fallback from post-launch failure so partial writes are never replayed.
- Keep controller, HITL, artifact validation, and every transition guard in the host.

No open design decisions remain.
