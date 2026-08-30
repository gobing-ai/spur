---
schema_version: 1
name: "Add global --no-logo and guarantee banner-free JSON output"
status: todo
template: feature-impl
created_at: 2026-08-30T02:11:08.791Z
updated_at: "2026-08-30T02:11:56.842Z"
feature_id: A31
priority: P2
---

## 0719. Add global --no-logo and guarantee banner-free JSON output

### Background

Implements all A31 scenarios as one composition-root delivery: global option registration, startup-banner selection, automatic JSON suppression, regressions, and public-surface documentation. The existing `runCli()` predicate already suppresses exact `--json`, `--quiet`, and `--silent` tokens; this task makes that behavior explicit and adds `--no-logo`.

Rubric: E1 D1 L1 C0 R0 = 3 → kept whole; one CLI composition-root seam, one review context, and one rollback boundary.

### Requirements

- [ ] R1. Register one public root `--no-logo` Commander option, visible once in top-level help and accepted before or after nested noun/verb tokens.
- [ ] R2. Suppress only the startup ASCII logo when exact `--no-logo` is present, preserving command output and exit status.
- [ ] R3. Preserve and test automatic startup-logo suppression for every invocation carrying exact `--json`, including JSON emitted for early config failures.
- [ ] R4. Preserve default human-mode logo rendering, existing `--quiet`/`--silent` suppression, and the banner-free programmatic `main()` contract.
- [ ] R5. Keep banner policy at the CLI composition root, reject similar-token false matches, and update the CLI design plus ADR-051 consent record.

### Acceptance Criteria
```gherkin
Feature: Global CLI logo suppression implementation

  Scenario: R1 — The CLI exposes one global no-logo option
    Given the Spur CLI root command
    When help is rendered or a nested command is invoked
    Then `--no-logo` is listed once and accepted before or after the command path

  Scenario: R2 — Explicit no-logo suppresses startup decoration
    Given a command that normally renders the Spur startup logo
    When the executable is invoked with exact `--no-logo`
    Then the logo is absent and command output and exit code are unchanged

  Scenario: R3 — JSON mode suppresses the startup logo automatically
    Given a command that declares `--json`
    When the executable is invoked with exact `--json`
    Then stdout begins with the command's JSON document and contains no startup logo

  Scenario: R4 — Human mode retains the startup logo by default
    Given no exact suppression token is present
    When the executable entry point runs
    Then it writes the startup logo exactly once while `main()` remains banner-free

  Scenario: R5 — Banner policy has one composition-root owner
    Given the CLI's noun modules and startup entry point
    When banner behavior and documentation are inspected
    Then the root owns the policy, similar tokens do not match, and the consented public surface is documented

  Scenario: Programmatic dispatch remains free of startup decoration
    Given a caller invokes `main()` directly
    When dispatch runs with or without the global option
    Then no startup logo is written by `main()`

  Scenario: Similar option names do not suppress the logo accidentally
    Given an argv token resembles but does not exactly equal a suppression option
    When banner policy is evaluated
    Then the logo remains enabled unless another exact suppression token exists
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen approach: register `--no-logo` on the root Commander program and keep banner emission in `runCli()`. Extract the exact-token decision into a pure `shouldRenderBanner(argv: readonly string[]): boolean` seam so behavior is independently testable.

Rejected alternatives:
- Per-command registration: duplicates a global concern across noun modules and drifts.
- Commander pre-parse before rendering: adds a second startup phase for a four-token policy.
- Config/environment switch: unrequested mutable state.

Invariants:
- `main()` never renders the startup logo.
- Exact `--no-logo`, `--json`, `--quiet`, or `--silent` suppresses; similar tokens do not.
- Command-owned report/staleness banners are unaffected.
- JSON payloads, envelopes, and exit codes do not change.

### Plan
1. Add the root Commander option and the exact-token banner policy in `apps/cli/src/index.ts`.
2. Extend dispatch tests for help visibility, option placement, default rendering, explicit suppression, JSON-first output, and similar-token behavior.
3. Update `docs/04_DESIGN.md` with the global option and machine-output startup contract.
4. Append the operator-consented public-surface change to `docs/design/harness-surface-governance.md`.
5. Run targeted CLI tests and the comprehensive Spur check.

Decomposition quiz: auto-skipped by `--auto`; one cohesive task retained.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
