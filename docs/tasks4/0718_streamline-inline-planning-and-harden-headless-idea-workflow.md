---
schema_version: 1
name: "Streamline inline planning and harden headless idea workflow recovery"
status: done
template: issue
created_at: 2026-08-29T23:26:22.251Z
updated_at: "2026-08-30T00:24:17.008Z"
priority: P1
feature_id: B
---

## 0718. Streamline inline planning and harden headless idea workflow recovery

### Background

The 2026-08-29 `/sp:dev-idea --auto` session for history-refresh isolation spent 11m37s before
productive inline discovery. Three headless attempts preceded the host-session path: run
`14facf0e-9864-4b3c-9bcb-d594640ee6e9` failed because the idea precheck treated `inline` as a
literal doctor target; run `4e32f2dd-4a3c-47bd-be4c-461b7cc16b71` spent 4m57s in Claude before
exiting 0 without either required artifact because writes were permission-denied; and run
`f8c8c663-6a51-434f-97e0-7c84639965c2` required manual process-tree termination after the operator
redirected execution to the current session.

The active project contract says direct model-bearing `/sp:dev-*` commands run inline by default,
but the shipped dev-idea/dev-plan command prose routes their model stages through a headless
workflow. The headless path also contradicts ADR-087 at its precheck, and task 0689's done/PASS
record claims a released Claude permission policy that the installed 0.4.46 package does not
contain. This task closes those linked causes as one session-workflow reliability repair.

### Requirements
- [x] R1. **Interactive idea and plan commands honor the host session.** Omitted `--agent` and explicit
`--agent inline` on `/sp:dev-idea` and `/sp:dev-plan` use the current coding-agent session and the
generic inline pipeline driver. They do not launch `spur workflow run`, `spur agent run`, or a
native subagent unless the operator explicitly selects another executor or requests delegation. A
deterministic regression records zero external attempts for both selectors.

- [x] R2. **Headless selector preflight matches dispatch.** On explicit headless execution, reserved
selectors are resolved through the declared stage role before readiness probing. No workflow sends
literal `inline` or `auto` to `spur agent doctor`, and the preflight-selected executor matches the
executor used by the following `agent.run` stage. The session fixture records stage duration and
attempt count so the three-attempt 2026-08-29 baseline cannot recur silently.

- [x] R3. **Published runners can satisfy artifact contracts.** Every configured executor eligible for
an `expectFile`/`answerFile` stage passes a real installed-package write probe. In particular, the
released Claude shim carries the verified noninteractive edit permission; source-link or
unreleased-local evidence cannot satisfy this gate. Reconcile task 0689's done/PASS record with
the published 0.4.46 counterexample from run `4e32f2dd-4a3c-47bd-be4c-461b7cc16b71`.

- [x] R4. **Cancellation stops the process it claims to cancel.** Dev-command subprocess workflows use
the independently cancellable async worker path, or the synchronous path gains equivalent
identity-pinned termination. `spur workflow cancel` output distinguishes record finalization from
process termination, and the normal command path requires `killed: true` before reporting the live
run stopped.

- [x] R5. **Artifact failures fail fast without blind replay.** Exit 0 plus missing required artifact is
classified as an executor capability/contract failure, preserves bounded stdout as a run-scoped
partial artifact, and does not retry a lower-tier executor as though the failure were quota
exhaustion. Explicit operator instructions about current-session execution override recovery
attempts.
### Acceptance Criteria

```gherkin
Feature: Fast and truthful idea-planning execution

  Scenario: R1 — default and explicit-inline planning remain in the host session
    Given a live coding-agent session invokes sp-dev-idea or sp-dev-plan
    When the agent selector is omitted or is inline
    Then zero external workflow or coding-agent processes are launched
    And the existing workflow definition is driven in the current session

  Scenario: R2 — headless preflight resolves reserved selectors before doctor
    Given an explicitly headless idea workflow whose selector is inline or auto
    When its preflight and first planner stage run
    Then doctor receives the same concrete executor selected for the planner stage
    And neither reserved selector is probed as a literal executable

  Scenario: R3 — installed executors satisfy required artifact writes
    Given each configured executor eligible for an artifact-producing workflow stage
    When a real dispatch writes and reads back a run-scoped artifact
    Then the dispatch succeeds using the installed released dependency
    And the Claude invocation carries its verified noninteractive edit permission

  Scenario: R4 — cancelling a dev-command workflow stops its process group
    Given an explicitly headless dev-idea or dev-plan workflow is running
    When workflow cancel is invoked for its run id
    Then the result reports killed true
    And neither the worker nor its agent child remains alive

  Scenario: R5 — missing artifacts preserve evidence and do not trigger blind fallback
    Given an executor exits zero without a required artifact
    When the workflow classifies the stage failure
    Then bounded stdout is preserved as a run-scoped partial artifact
    And no lower-tier executor is retried unless the failure is classified as resource exhaustion
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-08-29T23:28:03.877Z

**Q: Why is this cross-surface task linked to feature B instead of plugin feature I?** The first
shipped false-success is task 0689's unreleased agent-runner policy, and process identity/cancel plus
selector resolution are runtime owners under B. The plugin command changes are required consumer
reconciliation in the same repair. Session-review triage permits exactly one follow-up task, so
splitting the I consumer update would violate the review's consolidation contract.

### Design

Fix the routing contract first: interactive `/sp:dev-idea` and `/sp:dev-plan` reuse the existing
generic inline pipeline driver and its workflow todo projection. Keep `idea-pipeline.yaml` as the
SSOT; do not create a second planning state machine.

For explicit headless runs, resolve reserved selectors once at the workflow boundary using the
state's declared role, then pass the concrete executor to both doctor and `agent.run`. Launch the
workflow through the existing async worker path so the already-shipped PID/process-group cancel
mechanism applies.

Finish the previously unreleased Claude/Grok headless-write policy in `@gobing-ai/ts-ai-runner`,
publish it, update Spur's lockstep pins, and verify from the installed package. Preserve stdout on
missing-artifact failures through the existing partial-artifact convention; do not add a new retry
framework.

### Plan

1. Reproduce the three recorded failures from their traces and pin them as regression fixtures.
2. Route omitted/inline dev-idea and dev-plan through the existing generic inline pipeline driver.
3. Resolve reserved selectors once for explicit headless preflight and dispatch; remove literal
   doctor calls that bypass resolution.
4. Finish, publish, and consume the configured-executor artifact-write policies left unreleased by
   task 0689; verify from installed packages without development links.
5. Use the existing async worker/process-group cancellation path for headless dev workflows and
   preserve stdout through the existing partial-artifact convention on missing-artifact failure.
6. Run targeted plugin/workflow/agent tests, then `bun run spur-check`, `bun run test-cf`, and build.

### Root Cause

1. `plugins/sp/commands/dev-idea.md` and `dev-plan.md` classify their workflow stages as always
   headless despite the project-level inline-default contract and the existing generic inline
   driver.
2. `config/workflows/idea-pipeline.yaml` invokes `agent doctor $agent` before `agent.run` can apply
   ADR-087 selector substitution, so `inline` is treated as a missing binary.
3. Installed `@gobing-ai/ts-ai-runner@0.4.46` emits Claude as `claude -p ... --output-format text`
   without `--permission-mode acceptEdits`; task 0689 recorded the cross-executor change as done
   while also stating it was uncommitted and unreleased.
4. Synchronous workflow runs do not record a PID by design. `workflow cancel` therefore finalized
   the database record with `killed: false`, leaving the foreground runner and agent child alive.
5. Recovery retried a different executor after an artifact-contract failure and discarded useful
   stdout, duplicating discovery instead of failing fast or preserving partial evidence.

### Solution
The interactive planning wrappers now reuse the existing YAML-backed host driver. The explicit
headless path remains available, but it launches the async worker and resolves `inline`/`auto`
through the planner role once before doctor and dispatch.

The complete Claude/Grok write policy shipped in `@gobing-ai/ts-ai-runner@0.4.47`; Spur consumes the
lockstep 0.4.47 family from its registry install, not a development link. Direct configured-name
probes also exposed and fixed the CLI context seam that hid merged global executors from flag
validation. Ten currently eligible configured executors wrote and read back distinct run-scoped
artifacts. `pi-zai-nvidia` returned provider HTTP 410 before model execution and is therefore
recorded as currently ineligible rather than silently retried.

Missing expected artifacts now reuse the existing partial-work handoff path, preserve bounded
stdout/stderr and the invocation, redact configured secrets, and return a contract-specific error.

| Change | Anchor |
| --- | --- |
| Inline-by-default idea command and async explicit path | `plugins/sp/commands/dev-idea.md:23` |
| Inline-by-default plan command and async explicit path | `plugins/sp/commands/dev-plan.md:19` |
| Planner selector election and reuse | `config/workflows/idea-pipeline.yaml:82` |
| Reserved-selector doctor resolution | `packages/app/src/workflow/actions/doctor-probe.ts:70` |
| Missing-artifact preservation and classification | `packages/app/src/workflow/actions/agent-run.ts:328` |
| Partial-artifact secret redaction | `packages/app/src/workflow/actions/agent-run.ts:672` |
| Published lockstep runner dependency | `package.json:97` |
| Three-attempt duration fixture | `plugins/sp/tests/fixtures/0718-planning-attempts.json:3` |

Companion workflow baselines, command/skill documentation, product design documentation, and
targeted regression tests were updated with the same contracts. The CLI composition root now
exposes its already-derived merged agent configuration to command validation, and task 0689's Q&A
now identifies 0.4.47 as the first complete four-family release.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `cd plugins/sp && bun test tests/inline-execution-contract.test.ts --test-name-pattern '0718 R1/R4'` exited 0 and covers both idea/plan selectors. |
| R2 | MET | `cd packages/app && bun test tests/workflow/actions/doctor-probe.test.ts tests/workflow/idea-pipeline-definition.test.ts` exited 0; both `inline` and `auto` resolve once to planner and all dispatch stages reuse the result. The session fixture records three attempts, 506696 ms workflow time, and 504122 ms planner-stage time. |
| R3 | MET | `@gobing-ai/ts-ai-runner` resolved from the registry install at version 0.4.47; ten currently eligible configured executors passed distinct real write/readback probes under `.spur/run/`. `pi-zai-nvidia` returned provider HTTP 410 before execution and was classified ineligible without fallback. Task 0689 now records 0.4.47 as the first complete four-family release. |
| R4 | MET | `cd apps/cli && bun test tests/commands/workflow.test.ts --test-name-pattern 'async run self-records its worker pid; cancel SIGTERMs the whole process group'` exited 0 with the `killed: true` and worker/child liveness assertions. |
| R5 | MET | `cd packages/app && bun test tests/workflow/actions/agent-run.test.ts` exited 0; the missing-`expectFile` regression asserts contract failure, bounded output, partial artifact creation, and configured-secret redaction. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — default and explicit-inline planning remain in the host session | MET | test | Plugin contract test `0718 R1/R4 — idea and plan stay inline by default and use cancellable async workers when explicit` passed. |
| Scenario: R2 — headless preflight resolves reserved selectors before doctor | MET | test | Doctor-probe reserved-selector test and idea-pipeline executor-reuse definition test passed. |
| Scenario: R3 — installed executors satisfy required artifact writes | MET | command | Registry package version/readlink checks passed; ten eligible configured executor dispatches wrote and read back exact unique tokens, including Claude with the installed 0.4.47 shim. |
| Scenario: R4 — cancelling a dev-command workflow stops its process group | MET | test | The async-worker process-group cancellation regression passed with `killed: true` and no surviving worker/child. |
| Scenario: R5 — missing artifacts preserve evidence and do not trigger blind fallback | MET | test | AgentRunActionRunner missing-artifact test passed; the post-dispatch branch returns immediately after one redacted partial-artifact write and contains no fallback call. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | Security | `packages/app/src/workflow/actions/agent-run.ts:672` | Review found raw stdout/stderr and argv in the reused partial-artifact helper; fixed by applying the existing configured-secret redactor before persistence, with regression coverage. |
| P3 | Correctness / environment | `plugins/sp/tests/fixtures/0718-planning-attempts.json:3` | Ten configured executors passed installed-package write/readback probes. `pi-zai-nvidia` failed twice with provider HTTP 410 before model execution despite version-only doctor reporting usable; it is not currently eligible and no fallback was attempted. Operator-global model maintenance remains outside this repository change. |
| P4 | Reliability / environment | `apps/cli/src/context.ts:176` | One successful live probe reported a transient `system_events` SQLite lock while the board server was active. The artifact contract passed; the comprehensive gate did not reproduce the lock. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/commands/dev-idea.md:23` and `plugins/sp/commands/dev-plan.md:19` define omitted/inline as current-session execution; the contract test at `plugins/sp/tests/inline-execution-contract.test.ts:129` covers both surfaces. |
| R2 | MET | `packages/app/src/workflow/actions/doctor-probe.ts:70` resolves both reserved selectors through the declared role; `config/workflows/idea-pipeline.yaml:82` persists and reuses `planningAgent`; the real attempt fixture records 3 runs and 504122 ms of planner-stage time. |
| R3 | MET | `package.json:97` pins installed 0.4.47; registry realpath resolves beneath `node_modules/.bun`; 10 eligible configured executors passed distinct live write/readback probes; `docs/tasks4/0689_antigravity-cli-shim-cannot-satisfy-expectfile-stages-print-.md:130` corrects the former 0.4.46 claim. |
| R4 | MET | `plugins/sp/commands/dev-idea.md:46` requires async execution and `killed: true`; the existing process-group regression passed in `apps/cli/tests/commands/workflow.test.ts`. |
| R5 | MET | `packages/app/src/workflow/actions/agent-run.ts:328` fails the same action on a missing artifact and writes one redacted bounded partial artifact; no lower-tier invocation exists in that post-dispatch branch. |

No unresolved P1/P2 findings. No blocker/major architecture candidate: the changes deepen existing
`doctor.probe`, `AgentRunActionRunner`, and `CliContext` seams rather than adding a parallel
orchestrator or dependency.

Functional Verdict: PASS
### References

- Codex session: `/Users/robin/.codex/sessions/2026/08/29/rollout-2026-08-29T15-36-06-01a04faa-7682-7b32-afef-5e1aae6b8c2a.jsonl`
- Inline-selector failure: workflow run `14facf0e-9864-4b3c-9bcb-d594640ee6e9`
- Claude artifact failure: workflow run `4e32f2dd-4a3c-47bd-be4c-461b7cc16b71`
- Cancelled Grok run: workflow run `f8c8c663-6a51-434f-97e0-7c84639965c2`
- Related completed task: 0689
- Contracts: ADR-087; `plugins/sp/skills/spur-dev/references/cross-cutting.md`

### History

- 2026-08-29T23:27:16.916Z backlog → todo (system)
- 2026-08-30T00:10:04.948Z todo → wip (system)
- 2026-08-30T00:23:59.068Z wip → testing (system)
- 2026-08-30T00:24:17.008Z testing → done (system)
