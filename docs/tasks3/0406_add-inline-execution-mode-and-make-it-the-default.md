---
template: feature-impl
schema_version: 1
name: "Add inline execution mode and make it the default"
description: ""
status: done
type: task
profile: standard
feature_id: H9
parent_wbs: null
priority: P1
tags: ["sp-plugin", "cli", "executor"]
dependencies: ["0405"]
created_at: "2026-08-01T05:22:55.714Z"
updated_at: "2026-08-01T22:32:47.434Z"
---

## 0406. Add inline execution mode and make it the default

### Background

Every dispatch currently shells out to `spur agent run`, spawning a subprocess even when the operator is already inside a capable coding agent. Measured cost of that hop on this box is substantial: a bun process exec costs roughly 2.3 seconds against 0.02 for node, and the hop buys nothing when the current agent could run the prompt directly.

The risk is not the happy path but the boundary: `--inline` must not silently swallow steps that genuinely require an isolated or differently-modelled executor. The dispatch-surface rule from feature H6 (`plugins/sp/skills/parallel-execution/references/dispatch-surface.md`) already enumerates when escalation to `spur agent run` is required — a different model, headless or unattended operation, a durable auditable record, or workspace/credential isolation. Inline must honour those triggers rather than override them.

### Requirements
R1. Add an inline execution mode that runs the prompt or slash command directly in the current coding agent, with no `spur agent run` subprocess.
R2. Make inline the default execution mode.
R3. Preserve explicit subprocess dispatch: `agent.run` workflow steps and direct `spur agent run` invocations behave as before.
R4. Inline must not override the dispatch-surface escalation triggers from H6. When a named trigger applies — a different model or agent is required, the step must run headless or unattended, a durable auditable run record is required, or workspace/credential isolation is required — the subprocess path is used regardless of the default, and the applied trigger is named.
R5. Provide an explicit way to force subprocess dispatch when the operator wants it despite the default.
R6. State what inline does not provide relative to subprocess dispatch — at minimum the loss of an isolated workspace and of a separate run record — so the default is a documented trade rather than an invisible one.
R7. Use the naming settled in task 0405 throughout.
R8. Do not change tier selection or fallback behavior here — that is task 0406.
### Acceptance Criteria
Covers feature scenarios R1 and R2.

```gherkin
Feature: inline execution mode

  Scenario: Inline is the default execution mode
    Given an operator running a dev command from within a coding agent
    When no execution mode is specified
    Then the prompt runs directly in the current agent
    And no spur agent run subprocess is spawned

  Scenario: Explicit subprocess dispatch still works
    Given a step that requires a named external executor
    When it dispatches via agent.run or spur agent run
    Then the subprocess path behaves as it did before this feature

  Scenario: A dispatch-surface trigger overrides the inline default
    Given a step requiring a different model, headless operation, an auditable record, or isolation
    When it runs under the inline default
    Then the subprocess path is used instead
    And the applied trigger is named

  Scenario: The operator can force subprocess dispatch
    Given the inline default is active
    When the operator explicitly requests subprocess dispatch
    Then the subprocess path is used

  Scenario: The trade is documented
    Given inline is the default
    When its documentation is read
    Then it states what inline does not provide relative to subprocess dispatch
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Where inline diverges from the current path

Both operator-facing entries funnel through one place: `AgentService.executeRun`. `run`
(`agent-service.ts:318-330`) and `runTraced` (`:348-358`, the pipeline/workflow entry, non-interactive
by contract) each call it and then interpret the result. Everything below `executeRun` is subprocess
mechanics — executor resolution, `AiRunner`, `ProcessExecutor`.

Inline is therefore a **branch above `executeRun`, not a variant inside it**. Trying to express
"don't spawn" as an option threaded through the runner means every layer below grows a
does-this-actually-spawn conditional, and the subprocess path — which still has to work unchanged
(R3) — gets more complex in service of the path that bypasses it.

#### The hard part is the return contract, not the dispatch

`executeRun` yields a structured outcome: `exitCode`, `signal`, `stdout`, `stderr`, `durationMs`
(`:96-103`, `:167-178`). Callers depend on those fields — `runTraced`'s R2b comment at `:354-356`
explicitly notes that `agent.run` consumes `exitCode`/`signal` to write timeout handoff artifacts.

Inline execution has no subprocess and so has no honest value for most of them. Decide deliberately
what inline returns and **do not fabricate**: a synthesized `exitCode: 0` and `durationMs: 0` would
be indistinguishable from a real successful run and would silently corrupt the handoff artifacts and
any observability keyed on them. Prefer an explicitly-marked inline outcome that downstream code can
recognise, and audit the consumers of those fields as part of this task.

This is the main correctness risk in 0406 and deserves more attention than the dispatch switch.

#### Honouring the dispatch-surface triggers (R4)

`dispatch-surface.md` already enumerates them and already requires the caller to name which one
applied. The check belongs at the same branch point as the inline decision, and it must be
*positive*: the subprocess path is chosen when a trigger applies, rather than inline being skipped
when something looks unusual. A negative formulation degrades to inline-by-accident the moment a new
trigger is added and someone forgets to add its guard.

Note the `runTraced` contract — non-interactive by design — makes it the most likely place for a
headless trigger to apply. Pipeline steps that today rely on subprocess isolation must keep it.

#### What inline cannot provide (R6)

At minimum: no isolated workspace, no separate run record, no independent timeout or abort boundary,
and the executor is whatever the operator happens to be running rather than a tier-selected one.
That last item is the coupling to task 0407 — an inline step cannot escalate to a different tier,
because there is no second process to escalate into. State that interaction explicitly; it is the
non-obvious consequence of making inline the default.
### Plan
- [ ] Re-read `dispatch-surface.md` and enumerate the escalation triggers inline must honour.
- [ ] Implement the inline path; make it the default.
- [ ] Wire trigger detection so a named trigger forces the subprocess path and reports which one applied.
- [ ] Add the explicit force-subprocess control.
- [ ] Document the trade-off.
- [ ] Verify existing agent.run steps and spur agent run are unaffected.
### Solution
Implemented inline execution at the actual command-runtime seam: a direct model-bearing `/sp:dev-*`
invocation continues in the current coding-agent session by default, while named escalation triggers
or `--subprocess` dispatch exactly once through `spur agent run`. This intentionally does not add an
`AgentService`/`AiRunner` branch: those APIs are already subprocess boundaries, so routing "inline"
through them would still spawn a process and would violate R1.

- `plugins/sp/skills/spur-dev/references/cross-cutting.md:19` defines the inline default, positive
  trigger-first resolution, explicit override, single-hop recursion guard, unchanged direct/workflow
  subprocess surfaces, and the documented isolation/run-record/timeout/tier trade-off (R1-R6).
- `plugins/sp/skills/spur-dev/references/dev-operations.md:98` keeps task 0405's operator vocabulary
  (`--agent`, never `--executor`) and owns the shared `--inline`/`--subprocess` flag semantics (R5, R7).
- `plugins/sp/commands/dev-run.md:1` and the other model-bearing dev command wrappers expose both
  execution flags and route to the central contract; full mode keeps workflow `agent.run`, while
  implement mode runs its competency inline unless dispatch is forced (R1-R5).
- `plugins/sp/skills/spur-dev/references/execution-workflow.md:109` makes mode selection independent
  of `--next` and requires pipeline implement prompts to carry `--mode implement`, preventing the
  recursive full-pipeline launch tracked as bug-742.
- `plugins/sp/tests/inline-execution-contract.test.ts:38` locks the default, all four named triggers,
  command flag coverage, single-hop behavior, unchanged explicit subprocess paths, 0405 vocabulary,
  and the inline trade-off. `plugins/sp/tests/command-flag-parity.test.ts` now includes `--agent` in
  the shared-flag reference gate.
- `docs/04_DESIGN.md:989`, `docs/design/dev-agent-flag-and-dogfood-skill.md:7`,
  `docs/design/e2e-workflow-for-system-development.md:611`, `AGENTS.md:65`, and
  `config/templates/AGENTS.md:66` synchronize the user-facing and portable harness contracts (T3/T9).

Tier selection and fallback logic were not changed (R8). Existing direct `spur agent run`, workflow
`agent.run`, and task-pipeline YAML remain on their subprocess paths (R3).
### Testing
**Verification verdict: PASS**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Inline direct-Skill default and the no-untriggered-subprocess rule are defined at `plugins/sp/skills/spur-dev/references/cross-cutting.md:19`. |
| R2 | MET | Inline is the explicit default at `plugins/sp/skills/spur-dev/references/cross-cutting.md:21`; prior unconditional dispatch prose is now trigger-first. |
| R3 | MET | Direct `spur agent run` and workflow `agent.run` remain subprocess-backed at `plugins/sp/skills/spur-dev/references/cross-cutting.md:87`. |
| R4 | MET | Positive resolution and all four named triggers are defined at `plugins/sp/skills/spur-dev/references/cross-cutting.md:30`; parallel fan-out names isolation at `plugins/sp/skills/spur-dev/references/execution-batch.md:340`. |
| R5 | MET | Mode-aware wrappers expose `--inline` / `--subprocess`; `plugins/sp/tests/inline-execution-contract.test.ts:22` derives and validates the inventory. |
| R6 | MET | Missing isolation, run record, timeout/abort boundary, and tier selection are documented at `plugins/sp/skills/spur-dev/references/cross-cutting.md:96`. |
| R7 | MET | Operator vocabulary remains `--agent`; the contract test rejects `--executor` leakage. |
| R8 | MET | Inline selection is prompt-runtime behavior; tier selection remains on explicit subprocess/workflow boundaries. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — Inline is the default execution mode | MET | test | Contract test asserts the default direct-Skill path and forbids untriggered `spur agent run`. |
| R2 — Explicit subprocess dispatch still works | MET | test | Contract test asserts direct and workflow subprocess surfaces remain unchanged. |
| A dispatch-surface trigger overrides the inline default | MET | test | Contract test checks all four triggers and precedence over `--inline`. |
| The operator can force subprocess dispatch | MET | test | Contract test validates `--subprocess` and rejects contradictory mode flags. |
| The trade is documented | MET | test | Contract test asserts all four documented losses. |

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Solution documents the goal-equivalent move from the proposed service branch to the actual prompt-runtime seam. |
| prior-review-remediation | pass | Pipeline `--agent` carve-out is explicit; stale bare dispatch text is fixed; wrapper inventory is derived. |
| SECUA | pass | No blocker or unresolved major finding remains after the bounded fix pass. |
| repository | pass | `bun run spur-check`: 4318 pass, 0 fail; 99.32% functions / 99.28% lines. `bun run test-cf`: 1 passed. `bun run build`: exit 0. |

Fix-pass artifact: `.spur/run/0406-verdict.json:1-29` (fresh requirement/AC evidence and re-evaluation of the prior P2 findings).
### Review
**Three-dimensional review** (`sp-dev-review 0406 --auto`, 2026-08-01)

**Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:21-30` defines direct in-session execution and forbids untriggered `spur agent run`; the command wrappers route to the backing skill. |
| R2 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:21-25` makes inline the default. |
| R3 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:79-85` preserves direct `spur agent run` and workflow `agent.run` as subprocess surfaces. |
| R4 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:34-51,68-77` defines trigger-first precedence and names all four H6 triggers; parallel fan-out explicitly names trigger 4 at `plugins/sp/skills/spur-dev/references/execution-batch.md:336-341`. |
| R5 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:39-45` defines `--subprocess`; mode-aware command coverage is derived and checked at `plugins/sp/tests/inline-execution-contract.test.ts:19-27,81-99`. |
| R6 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:87-93` documents the missing isolated workspace, run record, timeout/abort boundary, and tier-selected executor. |
| R7 | MET | `plugins/sp/skills/spur-dev/references/dev-operations.md:98-106` retains `--agent` vocabulary and rejects `--executor` leakage in `plugins/sp/tests/inline-execution-contract.test.ts:96-97`. |
| R8 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:89-93` confines tier-selected execution to subprocess; no tier/fallback selection change is present in the 0406 surface. |

Functional Verdict: PASS

**SECUA review**

| Priority | Dimension | Location | Finding | Remediation |
| --- | --- | --- | --- | --- |
| P4 | Correctness / maintainability | `plugins/sp/tests/inline-execution-contract.test.ts:29-41` | `EXCLUDED_COMMANDS` is a manually curated partition. A future CLI-mechanical or workflow-backed command could be omitted from both the mode-aware inventory and exclusions without failing this specific coverage assertion. Current commands and requirements are covered; this is a forward-coverage risk, not a current defect. | Prefer an explicit command metadata marker or add a partition assertion that every `dev-*.md` command is either mode-aware or explicitly excluded with a reason. |

No P1/P2/P3 security, efficiency, correctness, usability, or architecture finding remains. The former stale unconditional-dispatch, wrapper-coverage, and `--agent` propagation findings are resolved by the central contract and current derived-inventory tests.

**Architecture review**

The policy is centralized at `plugins/sp/skills/spur-dev/references/cross-cutting.md:19-93`; wrappers link to that contract, and the contract test derives mode-aware coverage from the link at `plugins/sp/tests/inline-execution-contract.test.ts:19-27`. This is adequate for the current scope. The only suggested deepening is the P4 inventory-hardening item above; no architectural change is required to ship 0406.

**Fresh evidence**

- `bun run test` → 4318 pass, 0 fail; 243 files; 99.32% functions / 99.28% lines.
- `spur task check 0406 --strict-core --json` → `pass: true`; warnings are limited to six unchecked task boxes and three L4 feature-traceability scenarios, with no errors.
- `.spur/run/0406-verdict.json` → PASS; requirements and acceptance criteria all MET; prior-review-remediation PASS.

**Aggregate Verdict: PASS** — the Review section is current. The P4 inventory item is advisory and does not block completion.
### References

H9

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-01T17:49:44.044Z todo → wip (system)
- 2026-08-01T17:50:37.863Z wip → testing (system)
- 2026-08-01T19:28:58.429Z testing → done (system)
