---
schema_version: 1
name: Bound test watchdog shutdown and preserve workflow cancellation errors
status: done
template: issue
created_at: 2026-10-21T18:42:36.356Z
updated_at: "2026-10-21T19:41:05.648Z"
priority: P2

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1272-verdict.json
---

## 1272. Bound test watchdog shutdown and preserve workflow cancellation errors

### Background

The comprehensive post-G11 source review reproduced an unbounded test watchdog: a child ignoring SIGTERM prevents child.exited from resolving, so the finally-only SIGKILL never runs. Two workflow progress regressions were also reproduced: a successful retry retains the first failure as current status, and ambiguous same-kind definitions discard inspectable row identities. Missing-run workflow cancellation in JSON is explicitly tested as idempotent success; preserve that existing contract and record the human/JSON inconsistency as an observation rather than silently changing the public behavior.

### Requirements

- [x] R1. Escalate expired test-suite shutdown from SIGTERM to SIGKILL independently of child exit and reap the owned process group within a bounded grace period.
- [x] R2. Project the latest retry attempt as the current workflow step status, while preserving prior attempt history.
- [x] R3. Keep ambiguous same-kind workflow progress rows inspectable with their durable row identities instead of dropping the rows from the projection.
- [x] R4. Redact requested URL credentials and secret header values from HTTP requester exception results.
- [x] R5. Preserve workflow worker argv bytes and detach pipe handles on Windows using the established safe launch pattern.
- [x] R6. Release progress-follow timeout and abort resources on completion/consumer return and honor its polling interval.

### Acceptance Criteria

- [x] AC1 — A SIGTERM-resistant test child cannot outlive the watchdog plus bounded shutdown grace and exits as timeout 124 without surviving owned workers (req: R1).
- [x] AC2 — A failed attempt followed by a successful attempt projects a successful current step and retains both attempts (req: R2).
- [x] AC3 — Ambiguous same-kind action definitions preserve every source row in diagnostics with an inspectable row ID (req: R3).
- [x] AC4 — An injected requester echoing a credential-bearing URL/header in an exception produces a useful redacted error (req: R4).
- [x] AC5 — Launch-spec regression tests preserve percent, exclamation, whitespace and JSON quote arguments without cmd interpolation; native Windows execution is explicitly unverified on this host (req: R5).
- [x] AC6 — Early completion/return clears progress-follow timers/listeners, and a custom polling interval reaches the follower (req: R6).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Scope: scripts/commands/run-tests.ts and test-suite-termination.ts with corresponding tests; packages/app/src/workflow/progress-projection.ts, progress-follow.ts and actions/http-request.ts; packages/app/src/services/system-event-follow.ts; apps/cli/src/commands/workflow/shared.ts, run.ts and continue.ts, plus matching tests. Synchronize the owning workflow/CLI design satellites and docs/reports/2026-10-21-source-audit.md. No workflow YAML edits, public noun/verb changes or cancellation behavior changes. Preserve timeout exit 124 and original attempt records. mutationPolicy: code.

### Plan

- [x] Reproduce watchdog/projection failures and verify the existing cancellation contract with bounded fixtures.
- [x] Apply minimum root-cause fixes and focused regressions for all six findings.
- [x] Review sibling callers, projection candidates and owning contracts without speculative redesign.
- [x] Run integrated project gate, requirement/AC verification and commit.

### Root Cause

The watchdog awaited child.exited before reaching its only force-kill branch, so a TERM-resistant child could hang indefinitely. Workflow projection reused the first retry's status and marked ambiguous rows consumed without surfacing their identities. HTTP exception sanitization removed structured headers but not a raw requested URL or echoed individual credential. Async worker callers split runtime paths or combined executable and entry tokens; Windows cmd interpolation then lost argv bytes. Progress following left deadline/listener resources and non-abortable sleeps beyond the consumer's lifetime.

### Solution

scripts/commands/run-tests.ts:140 arms independent bounded escalation and clears timers; test-suite-termination.ts supplies a validated Windows owned-tree launch spec. packages/app/src/workflow/progress-projection.ts:528 surfaces durable ambiguity IDs and selects the latest retry for current status while retaining all attempts. packages/app/src/workflow/actions/http-request.ts:261 redacts URL and individual header values longest-first. apps/cli/src/commands/workflow/shared.ts:38 uses data-only Windows Start-Process argv; run/continue reuse resolveSpurArgv instead of splitting paths. packages/app/src/workflow/progress-follow.ts:63 and services/system-event-follow.ts preserve polling cadence with abortable waits and finally cleanup. Owning design satellites and the source audit report document restored contracts and verification limits; cancellation behavior is unchanged.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Independent bounded watchdog escalation and TERM-resistant process proof: scripts/commands/coverage-certification.test.ts:553; Windows owned termination-spec tests. |
| R2 | MET | Latest retry current-status regression retains both attempts and covers final failure too: packages/app/tests/workflow/progress-projection.test.ts:540. |
| R3 | MET | Ambiguous same-kind fixture checks every durable row ID in diagnostics: packages/app/tests/workflow/progress-projection.test.ts:310. |
| R4 | MET | Raw URL/header exception and overlapping credential regressions: packages/app/tests/workflow/actions/http-request.test.ts:334. |
| R5 | MET | Pure Windows launcher escaping tests plus CLI run/continue transport regression suites; both callers use resolveSpurArgv with separate runtime/entry tokens. |
| R6 | MET | Progress-follow and system-event-follow regression suites verify finally cleanup, custom cadence and prompt external/deadline abort even during a 60-second poll. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Scripts coverage-certification watchdog tests run a TERM-resistant subprocess, observe TERM handler, bound shutdown, assert timeout exit124 and no surviving worker; Windows termination-spec validates owned PID and taskkill arguments. |
| AC2 | MET | test | App progress-projection latest retry test verifies failed then passed maps to passed and retains both history rows; a final failed retry maps to failed. |
| AC3 | MET | test | App progress-projection ambiguous-action fixture asserts a1, a2 and a3 all appear in diagnostics without inventing a mapping. |
| AC4 | MET | test | App HTTP-request tests echo raw credential URL and headers, including overlapping/repeated values; returned errors retain ECONNRESET but no query/header secret. |
| AC5 | MET | test | CLI shared/run/continue tests preserve percent/exclamation/space/JSON/empty/trailing-backslash argv and separate source runtime/entry paths; Windows native execution explicitly remains unverified on this Mac as required by AC5. |
| AC6 | MET | test | App progress-follow/system-event-follow tests observe cleared timeout/listener after completion/return, custom37ms cadence and prompt long-poll cancellation/deadline. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS**
Confidence: MEDIUM

| # | Finding | Dim | Location | Priority | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | Watchdog could wait forever for a TERM-resistant child; independent escalation and reaping now bounded, including owned Windows tree termination. | Correctness | scripts/commands/run-tests.ts:140 | P1 | FIXED |
| 2 | Retry current status and ambiguous action row visibility were wrong; projection now reflects the latest attempt and surfaces every ambiguous row ID. | Correctness | packages/app/src/workflow/progress-projection.ts:528 | P2 | FIXED |
| 3 | Requester exception could persist a query/header credential; URL and longest-first header-value redaction now preserve useful failure context. | Security | packages/app/src/workflow/actions/http-request.ts:261 | P1 | FIXED |
| 4 | Async workflow argv and follow resource lifecycle gaps fixed through shared owners and both command callers, with regressions. | Reliability | apps/cli/src/commands/workflow/shared.ts:38 | P2 | FIXED |
| 5 | Native Windows launch/tree termination cannot be executed on this Mac; pure launch-spec and argument fidelity tests pass. Platform runtime coverage remains explicit. | Portability | scripts/commands/test-suite-termination.ts:1 | P4 | ACCEPTED |

Independent review traced both workflow worker callers and found overlapping secret redaction, long-poll abort and source-path argument gaps; all were repaired and regression tested. POSIX watchdog used actual TERM-resistant subprocesses. Existing cancellation JSON idempotence is tested and preserved. No new public noun/verb, workflow YAML edit or speculative workflow redesign.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-21T19:40:38.214Z todo → testing (system)

- Takeover after Codex session ended at token limit. Integrated gate in worktree: lint + all workspace typechecks green; 11,547 pass / 2 fail of 11,549 across 743 files. Both failures are Chromium-CDP browser tests (board-frames-browser, composed-board-browser: "Chromium did not report a DevTools port"); the identical failure reproduces on untouched main in the same macOS sandbox, so it is environmental and unrelated to 1272 (no web code touched). Verdict PASS via `task verdict`; residual review-gate blocking=0.
- 2026-10-21T19:41:05.618Z testing → done (system)

