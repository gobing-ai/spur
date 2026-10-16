---
schema_version: 1
name: Bind builder PR operations to the caller execution context
status: todo
template: issue
created_at: 2026-10-16T01:39:44.630Z
updated_at: "2026-10-16T01:41:22.631Z"
feature_id: A91

---

## 1215. Bind builder PR operations to the caller execution context

### Background

The path review reproduced an execution-context regression in the absorbed builder PR spine. Registering the command with a temporary non-git `context.cwd` returned preflight success and reported the checkout's real repository instead. Only a local git root lookup ran; gh and all mutations were stubbed. Evidence: `.spur/run/dev-review-2026-10-15/repro-pr-cwd.json` and its adjacent reproducible script. This belongs to A91 reusable CLI absorption and runtime ownership (R5/R7), not a new public surface. Tasks 1211/1212 are completed historical acceptance, and no active task owns the new regression. Malformed-URL redaction and serial-test comment fixes are already resolved by this review.

### Requirements

- [ ] R1. Every builder PR operation must execute git/gh in the explicitly supplied CLI cwd with the caller env. Preserve process cwd/env defaults for direct application callers that omit the optional context.
- [ ] R2. Resolve relative --status-file paths against the same invocation cwd, and preserve absolute paths. Do not change process.cwd(), process.env or other invocations' state to emulate context.
- [ ] R3. Preserve all existing subcommands, head pinning, status vocabulary, output sinks and exit codes. Keep credentials out of diagnostics and retain the existing no-force-push guarantee.
- [ ] R4. Add deterministic two-repository tests using fake gh; assert correct root, branch, environment and status placement, plus refusal for an explicitly selected non-git directory. No real network, PR comments, pushes, new verbs or new config keys.

### Acceptance Criteria

```gherkin
Feature: Builder PR operations honor their caller context
  Scenario: R5 — Workflow adapters use one approved runtime persistence path
    Given the process is running in repository A and the CLI context selects repository B
    When builder pr preflight and representative mutation-capable operations run with fake gh/git boundaries
    Then repository B and the caller environment own every external command
    And a relative status file is written beneath B while an absolute status path remains absolute
    And selecting a non-git directory refuses instead of inspecting repository A
    And process cwd and env remain unchanged after success and failure
    And consecutive invocations in A and B do not share execution context
    And the existing head-pin, output and exit-code regression suites remain green
```
Verification: run `bun test tests/services/pr-review/pr-review.test.ts` inside packages/app and `bun test tests/commands/builder/pr.test.ts` inside apps/cli, then the project gate. Both line and function coverage must remain at least 90% per measured changed file.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Thread a narrow optional application execution context (cwd/env and the existing command-runner seam) through the PR spine and pass `context.cwd/context.env` from the CLI adapter. Bind the default runner per invocation; keep argv-only test runners compatible where possible. Resolve status paths with the same context. Prefer invocation-local state/closures over changing global cwd or adding mutable global context. Target `apps/cli/src/commands/builder/pr.ts`, `packages/app/src/services/pr-review/index.ts`, their existing test files, and the builder facade documentation only if its context contract needs clarification. Reject process.chdir, temporary process.env rewriting, git-only -C patches (gh and status writes would still be wrong), and per-operation duplicated runners. Out of scope: review-request semantics, polling redesign, release publisher behavior, public flags and unrelated command migrations.

### Plan

1. Turn the captured cwd replay into a failing CLI regression and add application tests for explicit env/status paths and omitted-context compatibility.
2. Introduce the smallest invocation-bound execution context and pass it through the adapter, external runner and status-file helpers.
3. Test two independent contexts, error cleanup, non-git refusal and fake mutation operations without external side effects.
4. Run both focused suites, typechecks and the project gate; record per-file coverage and source anchors before verification. Keep this task independent of 1214.

### Root Cause

`registerBuilderPrCommand` forwards argv and output only. The application `spawnRunner` sets neither cwd nor the context env and obtains process-global env instead. Git/gh therefore resolve the process repository regardless of the CLI invocation context; relative status-file writes likewise use process cwd. Evidence: `apps/cli/src/commands/builder/pr.ts:24`, `packages/app/src/services/pr-review/index.ts:112`, and `packages/app/src/services/pr-review/index.ts:216`. The wrong-root replay is observed; no hypothesis is required for this seam.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Feature A91 R5/R7; `apps/cli/src/commands/builder/pr.ts:24`; `packages/app/src/services/pr-review/index.ts:112`; `packages/app/src/services/pr-review/index.ts:216`; `apps/cli/tests/commands/builder/pr.test.ts`; `packages/app/tests/services/pr-review/pr-review.test.ts`. External evidence: review scratch `.spur/run/dev-review-2026-10-15/repro-pr-cwd.json` and `repro-pr-cwd.ts`; rerun with `bun .spur/run/dev-review-2026-10-15/repro-pr-cwd.ts`. Only the git-root lookup is real; all gh commands/mutations are stubbed.

### History
