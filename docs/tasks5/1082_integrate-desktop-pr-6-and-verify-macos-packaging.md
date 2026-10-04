---
schema_version: 1
name: Integrate desktop PR 6 and verify macOS packaging
status: wip
template: issue
created_at: 2026-10-04T20:54:18.738Z
updated_at: "2026-10-04T21:13:19.490Z"

ac_numbering: task-local
ac_altitude: task-local
feature_id: A71
---

## 1082. Integrate desktop PR 6 and verify macOS packaging

### Background

Integrate PR #6 on GitHub and into local main while preserving existing work. Operator requested full review and macOS validation. Desktop scope is explicitly authorized by that request.

### Requirements

- [ ] R1. Fix confirmed desktop startup, project selection, cancellation, and crash handling defects.
- [ ] R2. Build and verify the desktop package on this Apple Silicon macOS host.
- [ ] R3. Synchronize desktop product and runtime contracts and obtain a fresh GitHub Codex review before merge.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Safe desktop lifecycle (req: R1)
Given a packaged launch or slow server startup
When a project is omitted, startup is cancelled, or the child exits
Then an explicit project is required and the shell reports failure or cleans up the child

Scenario: AC2 — macOS package loads Board (req: R2)
Given built server and Board assets
When the native macOS desktop package starts with a temporary project
Then health and Board render successfully and quit releases the child process

Scenario: AC3 — Reviewed desktop contract (req: R3)
Given the corrected desktop PR
When gates and GitHub review complete
Then product authorities match the desktop scope and actionable findings are resolved
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Keep Electron as a thin shell around the existing server. In packaged mode prompt for a project directory when no explicit path is supplied. Await pending startup cleanup on quit, notify main on unexpected child exit, and remove per-probe abort listeners. Update `apps/desktop/`, `docs/01_PRD.md`, `docs/02_ROADMAP.md`, and `docs/design/desktop-shell.md`; verify native packaging and the Board.

Packaging fixes also cover `packages/config/src/bundled-config.ts`, its tests, `apps/desktop/scripts/stage-resources.ts`, and `docs/design/configuration-contracts.md`; compiled executables require adjacent external config assets.

### Plan

- [ ] Validate Codex findings and fix confirmed defects with regression tests.
- [ ] Run required gates and build/stage/package for macOS.
- [ ] Exercise Electron renderer and lifecycle against a temporary project.
- [ ] Collect fresh Codex review and integrate the verified commits.

### Root Cause

The existing shell assumed Finder cwd was a project, left per-probe abort listeners installed, and did not notify main after child exit (`apps/desktop/src/layout.ts:96`, `apps/desktop/src/server-process.ts:102`). Compiled module paths could not discover the task matrix or resolve package schema references; staging shipped neither config nor schemas (`packages/config/src/bundled-config.ts:36`, `packages/config/src/loader.ts:132`, `apps/desktop/scripts/stage-resources.ts:89`). Native packaged testing reproduced both startup failures. Earlier review findings for the CLI companion and title-bar overlay were already fixed.

### Solution

- `apps/desktop/src/main.ts:46` awaits pending startup cleanup and prompts packaged users for a directory before spawn; unexpected exits show an error and quit.
- `apps/desktop/src/server-process.ts:102` disposes probe listeners and reports post-health exits; `apps/desktop/src/launch.ts:161` resolves relative Bun overrides from launch cwd.
- `apps/desktop/src/preload.ts:27` tolerates a missing document root before DOMContentLoaded.
- `apps/desktop/scripts/stage-resources.ts:90` ships generated config, CLI manifest and schemas beside server and companion binaries.
- `packages/config/src/bundled-config.ts:36` discovers executable-relative config; `packages/config/src/loader.ts:140` resolves the shipped schema manifest when package resolution is unavailable.
- `apps/desktop/tests/main.test.ts:4`, `apps/desktop/tests/preload.test.ts:5`, `apps/desktop/tests/window.test.ts:7` add renderer isolation, navigation and IPC regression coverage.
- `docs/01_PRD.md:137`, `docs/02_ROADMAP.md:106`, `docs/design/desktop-shell.md:20` align approved desktop scope and its runtime contract.
- Runtime rules permit only the dedicated Electron Node adapters and exclude generated resource copies while continuing to reject ordinary desktop source violations.

### Testing

- `bun run desktop:smoke`: 40 pass, 0 fail.
- Config resolver and loader targeted tests: 93 pass, 0 fail.
- Combined desktop/config/workflow regression run: 225 pass, 0 fail.
- `bun run spur-check-feature`: PASS; 7 repo-wide tests pass.
- `bun run test-cf`: PASS; 1 Worker test pass.
- `bun run build`: PASS. Native arm64 app and DMG build: PASS, unsigned.
- Native Electron smoke: PASS; Board render, preload, minimize/maximize/close, renderer require undefined, child port released.
- Native packaged smoke: PASS; compiled server health ok, version 0.3.99, Board rendered, exit code 0, port released.
- Runtime boundary fixture smoke: ordinary desktop sources still reject direct process and filesystem imports; dedicated adapter allowed.
- `spur rule run --preset recommended-pre-check --fail-on warning --json`: PASS, no findings.
- Full task gate first test run: 9938 pass, 1 fail due to the newly added resolver regression calling a spied re-export. Test now targets the uncached owning resolver; focused regression is green. Final full gate pending.
- Coverage: desktop launch/layout/server modules remain covered by runtime tests; repository per-file coverage is measured by the final full gate.

### Review

#### Review Report — 1082

**Scope:** desktop PR #6 and integration fixes, including config resource discovery.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.
**Verdict:** PARTIAL — fresh GitHub Codex review and final repository gate pending.

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P2 (major) | correctness | RESOLVED: packaged cwd could select a system directory; explicit path or folder picker now required | `apps/desktop/src/main.ts:60` |
| 2 | P2 (major) | correctness | RESOLVED: compiled startup lacked task matrix and schema assets; stage now ships executable-relative assets | `apps/desktop/scripts/stage-resources.ts:90` |
| 3 | P2 (major) | correctness | RESOLVED: abort listeners accumulated and post-start child exits were ignored | `apps/desktop/src/server-process.ts:102` |
| 4 | P3 (minor) | correctness | RESOLVED: relative Bun override and early preload document access | `apps/desktop/src/launch.ts:161`, `apps/desktop/src/preload.ts:27` |
| 5 | P4 (advisory) | usability | ACCEPTED: package is unsigned; no valid Developer ID identity exists on this Mac. Signing and notarization are outside this local integration scope | `apps/desktop/electron-builder.yml:19` |

#### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | 40 desktop tests pass; native Electron check passes Board render, preload, minimize/maximize/close and port release |
| R2 | MET | Native packaged smoke reports health ok, Board rendered, exit code 0 and port released; Apple Silicon DMG built |
| R3 | PARTIAL | Product and runtime docs synchronized; latest pushed HEAD still needs fresh Codex review |

Architectural assessment: renderer remains a transport with no SQLite or server imports. Spawn and filesystem seams remain injected; only specific Electron Node adapter files are exempt from Bun-oriented boundaries. The config fallback is shared at the owning resolver, rather than seeding or copying project data in the shell.

### References

https://github.com/gobing-ai/spur/pull/6

### History

- 2026-10-04T20:54:52.453Z todo → wip (system)

