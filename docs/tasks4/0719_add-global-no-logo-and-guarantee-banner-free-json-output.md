---
schema_version: 1
name: "Add global --no-logo and guarantee banner-free JSON output"
status: done
template: feature-impl
created_at: 2026-08-30T02:11:08.791Z
updated_at: "2026-08-30T05:31:48.139Z"
feature_id: A31
priority: P2
---

## 0719. Add global --no-logo and guarantee banner-free JSON output

### Background

Implements all A31 scenarios as one composition-root delivery: global option registration, startup-banner selection, automatic JSON suppression, regressions, and public-surface documentation. The existing `runCli()` predicate already suppresses exact `--json`, `--quiet`, and `--silent` tokens; this task makes that behavior explicit and adds `--no-logo`.

Rubric: E1 D1 L1 C0 R0 = 3 → kept whole; one CLI composition-root seam, one review context, and one rollback boundary.

### Requirements

- [x] R1. Register one public root `--no-logo` Commander option, visible once in top-level help and accepted before or after nested noun/verb tokens.
- [x] R2. Suppress only the startup ASCII logo when exact `--no-logo` is present, preserving command output and exit status.
- [x] R3. Preserve and test automatic startup-logo suppression for every invocation carrying exact `--json`, including JSON emitted for early config failures.
- [x] R4. Preserve default human-mode logo rendering, existing `--quiet`/`--silent` suppression, and the banner-free programmatic `main()` contract.
- [x] R5. Keep banner policy at the CLI composition root, reject similar-token false matches, and update the CLI design plus ADR-051 consent record.

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

- `apps/cli/src/index.ts:147` — root `--no-logo` option registered in `runCommandDispatch()` after `-v, --cli-verbose`: one declaration gives top-level help visibility and parse acceptance before or after nested noun/verb tokens (R1). `apps/cli/src/index.ts:199` — extracted the exact-token decision into exported `shouldRenderBanner(argv: readonly string[])` and made `runCli()` (`apps/cli/src/index.ts:206`) delegate to it — same four tokens as before plus `--no-logo`; `main()` still never renders the logo (R4). No noun module changed; policy stays at the composition root (R5).
- `apps/cli/tests/commands/dispatch-inspect.test.ts:170` — new "startup banner policy (A31/0719)" suite: `shouldRenderBanner` exact-token matrix including near-misses (`--no-logos`, `--no_logo`, `--no-logo=1`, `--NO-LOGO`, `--jsonx`, `--JSON`, `--quietly`, `--silent=1`) at `:176`; root help lists `--no-logo` exactly once with before/after placement and banner-free `main()` output at `:201`; subprocess banner-once human default and `--no-logo` suppression with unchanged output/exit status at `:216`; JSON-first stdout for `--json` including the early config-failure envelope at `:235` (R3).
- `docs/04_DESIGN.md:87` — §1 "Startup banner policy" paragraph (version 1.61.0): composition-root ownership, exact-token contract, banner-free programmatic `main()`, JSON-first guarantee.
- `docs/design/harness-surface-governance.md:101` — §4 consent-record row (2026-08-29, task 0719, feature A31) for the public `--no-logo` root option per ADR-051.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/index.ts:137-147` registers one root `--no-logo` option; `apps/cli/tests/commands/dispatch-inspect.test.ts:201-214` verifies one help occurrence and placement before/after the command path; fresh focused test passed. |
| R2 | MET | `apps/cli/src/index.ts:199-209` gates only the startup banner on exact suppression tokens; `apps/cli/tests/commands/dispatch-inspect.test.ts:216-233` verifies unchanged command output/exit status with the logo absent; fresh `status --no-logo` exited 0 with normal status output. |
| R3 | MET | `apps/cli/src/index.ts:199-207` suppresses the banner for exact `--json`; `apps/cli/tests/commands/dispatch-inspect.test.ts:235-260` verifies JSON-first stdout for healthy and early-config-failure paths; fresh `status --json` exited 0 with `{` as the first byte. |
| R4 | MET | `apps/cli/src/index.ts:189-214` keeps banner emission exclusively in `runCli()` while `main()` remains decoration-free; `apps/cli/tests/commands/dispatch-inspect.test.ts:176-233` verifies default-on, exact `--quiet`/`--silent` suppression, one banner, and banner-free programmatic dispatch. |
| R5 | MET | `apps/cli/src/index.ts:143-147,194-209` owns registration and exact-token policy at the composition root; `apps/cli/tests/commands/dispatch-inspect.test.ts:176-214` covers near misses and placement; `docs/04_DESIGN.md:87-95` and `docs/design/harness-surface-governance.md:95-101` document the public surface and consent. Re-audit artifacts: `.spur/run/0719-verify-answer.txt:1-38` and `.spur/run/0719-verdict.json:1-113`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The CLI exposes one global no-logo option | MET | test | `apps/cli/tests/commands/dispatch-inspect.test.ts:201-214`; fresh focused suite passed and source-local `--help` listed `--no-logo` once. |
| R2 — Explicit no-logo suppresses startup decoration | MET | test | `apps/cli/tests/commands/dispatch-inspect.test.ts:216-233`; fresh source-local `status --no-logo` exited 0 with command output intact and no banner. |
| R3 — JSON mode suppresses the startup logo automatically | MET | test | `apps/cli/tests/commands/dispatch-inspect.test.ts:235-260`; fresh source-local `status --json` exited 0 and emitted JSON-first stdout. |
| R4 — Human mode retains the startup logo by default | MET | test | `apps/cli/tests/commands/dispatch-inspect.test.ts:216-233` verifies exactly one default banner and unchanged exit status. |
| R5 — Banner policy has one composition-root owner | MET | test | `apps/cli/tests/commands/dispatch-inspect.test.ts:176-214` plus `apps/cli/src/index.ts:137-147,194-209`; no noun module owns logo policy. |
| R6 — Programmatic dispatch remains free of startup decoration | MET | test | `apps/cli/tests/commands/dispatch-inspect.test.ts:201-214` invokes `main()` with `--no-logo` before and after the command path and observes no startup banner. |
| R7 — Similar option names do not suppress the logo accidentally | MET | test | `apps/cli/tests/commands/dispatch-inspect.test.ts:176-198` covers eight exact near misses, all retaining banner eligibility. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; review verdict PASS — all five requirements MET, SECUA/architecture clean, fresh test evidence this run |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/index.ts:147` — root `program.option('--no-logo', ...)`; `apps/cli/tests/commands/dispatch-inspect.test.ts:201` — help lists `--no-logo` exactly once, accepted both as `['--no-logo','help']` and `['help','--no-logo']` |
| R2 | MET | `apps/cli/src/index.ts:199-201,206-207` — exact `--no-logo` in `shouldRenderBanner()` gates only the banner write; `apps/cli/tests/commands/dispatch-inspect.test.ts:216` — subprocess `status --no-logo` exits 0, command output intact, banner absent |
| R3 | MET | `apps/cli/src/index.ts:200` — `--json` auto-suppression preserved; `apps/cli/tests/commands/dispatch-inspect.test.ts:235` — `status --json` stdout JSON-first, incl. early config-failure envelope (`error.code === 'config'`) |
| R4 | MET | `apps/cli/src/index.ts:207` — banner written only in `runCli()`; `main()` has no banner write (grep over `apps/cli/src`); `apps/cli/tests/commands/dispatch-inspect.test.ts:216` — human default renders logo exactly once; `:176` — `--quiet`/`--silent` still suppress |
| R5 | MET | Policy sole-owned at the composition root (`apps/cli/src/index.ts:199-201`; zero noun-module changes); near-miss matrix `apps/cli/tests/commands/dispatch-inspect.test.ts:176-198` (`--no-logos`, `--no_logo`, `--no-logo=1`, `--NO-LOGO`, `--jsonx`, `--quietly`, …); `docs/04_DESIGN.md:87` §1 paragraph + version 1.61.0; ADR-051 consent row `docs/design/harness-surface-governance.md:101` |

Advisory (non-blocking) notes:

- Advisory | architecture | `apps/cli/src/index.ts:143-146` — the suppression-token list exists in two places (Commander registration for help/parse acceptance, raw-argv scan in `shouldRenderBanner`); the coupling is documented in the registration comment and the surface is four tokens, acceptable as designed. Extract a shared token const only if a fifth suppression token ever lands.
- Note | correctness | Commander implicitly registers a positive `--logo` flag for the negation option, but banner policy reads raw argv exactly, so `--logo` neither suppresses nor errors — consistent with the exact-token near-miss contract tested at `apps/cli/tests/commands/dispatch-inspect.test.ts:176`.

Fresh verification evidence (this run): `bun test apps/cli/tests/commands/dispatch-inspect.test.ts` → 14 pass / 0 fail, 129 expect() calls, 2.43s. Residual risk: none blocking; only the documented token-list duplication above.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-30T02:47:01.654Z todo → wip (system)
- 2026-08-30T03:02:26.600Z wip → testing (system)
- 2026-08-30T03:04:27.179Z testing → done (system)
