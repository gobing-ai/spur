---
schema_version: 1
name: Integrate desktop PR 6 and verify macOS packaging
status: done
template: issue
created_at: 2026-10-04T20:54:18.738Z
updated_at: "2026-10-09T21:30:34.545Z"

ac_numbering: task-local
ac_altitude: task-local
feature_id: A71
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1082-verdict.json
---

## 1082. Integrate desktop PR 6 and verify macOS packaging

### Background

Integrate PR #6 on GitHub and into local main while preserving existing work. Operator requested full review and macOS validation. Desktop scope is explicitly authorized by that request.

### Requirements

- [x] R1. Fix confirmed desktop startup, project selection, cancellation, crash handling, window controls, and renderer permission/IPC boundary defects.
- [x] R2. Build and verify the desktop package on this Apple Silicon macOS host.
- [x] R3. Synchronize desktop product and runtime contracts and obtain an independent review of the final revision before merge.

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
  When gates and the final independent review complete
  Then product authorities match the desktop scope and actionable findings are resolved
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-04T23:23:29.175Z

The operator authorized review, macOS fixes and merge of PR #6. Existing unpublished main commits stay local.

GitHub Codex reviewed earlier revisions and their actionable findings were fixed. The final cloud review request returned the account's review usage limit (PR comment 5985511123); a current-head cloud PASS cannot be claimed. The final review uses the project's sp-super-reviewer workflow with an independent local reviewer instead. That reviewer reproduced and identified a late runtime-plugin startup failure cleanup defect, which is being fixed and re-reviewed before merge. Requirement R3 describes the review outcome rather than requiring an unavailable cloud provider.

#### Q&A entry — 2026-10-04T23:57:40.327Z

The operator authorized review, macOS fixes and merge of PR #6. Existing unpublished main commits stay local.

GitHub Codex reviewed earlier revisions and their actionable findings were fixed. The final cloud review request returned the account's review usage limit (PR comment 5985511123); a current-head cloud PASS cannot be claimed. The final review uses the project's sp-super-reviewer workflow with an independent local reviewer instead. That reviewer reproduced and identified a late runtime-plugin startup failure cleanup defect, which was fixed and re-reviewed before merge. Requirement R3 describes the review outcome rather than requiring an unavailable cloud provider.

### Design

Electron remains a thin shell around the existing loopback server and Board. A packaged launch requires an explicit project or folder picker. The renderer has no Node or database access; a sandboxed, isolated main-frame preload exposes only three window actions. Trusted anchor clicks authorize validated HTTP(S) external navigation. Permissions and popup windows are denied.

The shared application service atomically claims the canonical project before any database/runtime boot. The server holds this claim until its runtime and lazy context database adapters close, and refuses older live registry owners. Parent-only inherited process IPC carries startup failures, graceful shutdown and disconnect cancellation; cancellation is latched before asynchronous boot and partial startup drains all acquired resources.

Compiled server and CLI builds reuse the existing database import facade under an exclusive build claim. Packaging stages executable-relative config, schemas, manifest and Board assets beside both binaries. History commands retain paths with spaces as argv entries. Windows controlled environment names are normalized without adding a public CLI surface.

Product scope, runtime topology and desktop/config/project-switcher design owners are synchronized. Native Apple Silicon validation includes a database-backed Board request and child cleanup; distribution signing requires a valid Developer ID identity.

### Plan

- [x] Fix validated review findings and add focused regressions.
- [x] Pass full macOS gate, feature gate, Cloudflare tests and CI.
- [x] Build/package/install native app and verify database-backed Board and shutdown.
- [x] Complete independent final-revision review and merge GitHub/local main while preserving unpublished work.

### Root Cause

The existing shell assumed Finder cwd was a project, left per-probe abort listeners installed, and did not notify main after child exit (`apps/desktop/src/layout.ts:96`, `apps/desktop/src/server-process.ts:102`). Compiled module paths could not discover the task matrix or resolve package schema references; staging shipped neither config nor schemas (`packages/config/src/bundled-config.ts:36`, `packages/config/src/loader.ts:132`, `apps/desktop/scripts/stage-resources.ts:89`). Native packaged testing reproduced both startup failures. Earlier review findings for the CLI companion and title-bar overlay were already fixed.

### Solution

- `apps/desktop/src/main.ts:63` requires an explicit project path or packaged folder picker; `apps/desktop/src/main.ts:42` waits for startup cancellation and child cleanup before quit.
- `apps/desktop/src/server-process.ts` disposes probe listeners, reports unexpected child exits and supports private inherited process IPC shutdown with bounded fallback.
- `apps/desktop/src/preload.ts:31` marks the document at DOMContentLoaded; trusted main-frame link clicks use private IPC. `apps/desktop/src/window.ts` preserves native controls, denies permission checks/requests, isolates the renderer and refuses popup windows.
- `apps/desktop/scripts/stage-resources.ts:91` ships schemas, CLI manifest, generated config and Board assets beside both compiled processes. Shared executable-relative resolvers find these assets.
- `packages/app/src/services/project-server-owner.ts:10` atomically claims canonical project ownership before database boot and holds it through close. `apps/server/src/serve.ts:652` latches parent cancellation before asynchronous boot and cleans partial startup.
- `apps/cli/src/index.ts:60` dispatches both serve forms before CLI database/runtime boot. `apps/server/src/context.ts:454` closes its lazy adapter, including a pending first touch. `packages/domain/src/db.ts:53` closes failed initialization adapters.
- `scripts/commands/build-cli.ts:98` shares the existing compiled database import facade with the standalone server and serializes dependency patching across builders.
- History invocation uses argv arrays for paths containing spaces; desktop environment overrides normalize Windows casing; failed smoke runs stop children in finally.
- Regression tests exercise lifecycle, permissions, IPC, concurrency, database close, compilation behavior and deterministic envelope output. Product/runtime owners document the approved desktop scope and ownership contract.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/desktop/src/main.ts:42; apps/server/src/serve.ts:1276; packages/app/src/services/project-server-owner.ts:10. Desktop 55 tests and integrated server/context 119 tests pass; compiled server and CLI ownership/early IPC/native shutdown pass. |
| R2 | MET | apps/desktop/scripts/stage-resources.ts:91; scripts/commands/build-cli.ts:98. Build/package exit 0; installed ~/Applications/Spur.app native smoke reports database summary HTTP 200, Board rendered, Node undefined, exit 0 and port released. |
| R3 | MET | docs/01_PRD.md:137; docs/design/desktop-shell.md:51. Independent final-head review e9d55ab8f4d851eb8e455091b2045ec437e7a881 passes functional, SECUA and architecture. Cloud quota limitation recorded; PR6 merged as 687f303f206a1df0af8a7fd25327a5ca5133976e and integrated locally. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Safe desktop lifecycle (req: R1) | MET | command | apps/desktop/src/main.ts:42; apps/server/src/serve.ts:1276; packages/app/src/services/project-server-owner.ts:10. Desktop 55 tests and integrated server/context 119 tests pass; compiled server and CLI ownership/early IPC/native shutdown pass. |
| Scenario: AC2 — macOS package loads Board (req: R2) | MET | command | apps/desktop/scripts/stage-resources.ts:91; scripts/commands/build-cli.ts:98. Build/package exit 0; installed ~/Applications/Spur.app native smoke reports database summary HTTP 200, Board rendered, Node undefined, exit 0 and port released. |
| Scenario: AC3 — Reviewed desktop contract (req: R3) | MET | command | docs/01_PRD.md:137; docs/design/desktop-shell.md:51. Independent final-head review e9d55ab8f4d851eb8e455091b2045ec437e7a881 passes functional, SECUA and architecture. Cloud quota limitation recorded; PR6 merged as 687f303f206a1df0af8a7fd25327a5ca5133976e and integrated locally. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1082

**Scope:** PR #6 and task 1082 integration fixes across the Electron shell, server lifecycle, application ownership, database cleanup, compiled packaging and their tests.
**Dimensions:** functional traceability, security, efficiency, correctness, usability and architecture.
**Verdict:** PASS — independent functional, SECUA and architecture reviews cover exact HEAD `e9d55ab8f4d851eb8e455091b2045ec437e7a881`; no unresolved actionable findings. Full repository verification and merge are tracked separately.

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 | correctness | Packaged launch required explicit project selection and startup cancellation cleanup | `apps/desktop/src/main.ts` | FIXED |
| 2 | P2 | correctness | Compiled assets and the variable database import were absent from the executable package | `apps/desktop/scripts/stage-resources.ts`, `scripts/commands/build-cli.ts` | FIXED |
| 3 | P2 | correctness | Child exits and health-probe listeners needed explicit lifecycle cleanup | `apps/desktop/src/server-process.ts` | FIXED |
| 4 | P2 | security | Main-frame IPC, denied permissions, native controls and trusted external-link authorization needed hardening | `apps/desktop/src/preload.ts`, `apps/desktop/src/window.ts` | FIXED |
| 5 | P2 | correctness | Concurrent startup could open the same database before registry checks; ownership must span database close | `packages/app/src/services/project-server-owner.ts`, `apps/server/src/serve.ts` | FIXED |
| 6 | P2 | correctness | Early parent cancellation and CLI serve dispatch needed to precede database/runtime boot | `apps/server/src/serve.ts`, `apps/cli/src/index.ts` | FIXED |
| 7 | P2 | correctness | Lazy context database and failed migration paths needed explicit adapter close | `apps/server/src/context.ts`, `packages/domain/src/db.ts` | FIXED |
| 8 | P2 | correctness | Paths containing spaces, Windows inherited environment casing and smoke failure cleanup needed regressions | `packages/app/src/services/history-refresh-service.ts`, `apps/desktop/src/launch.ts`, `apps/desktop/scripts/smoke-serve.ts` | FIXED |
| 9 | P3 | correctness | Host agent discovery made envelope assertions depend on installed agents and concurrent load | `apps/cli/tests/output-envelope.test.ts`, `apps/cli/tests/config-layering.test.ts` | FIXED |

| 10 | P2 | correctness | A late runtime-plugin startup failure skipped callback-created service cleanup before claim release | `apps/server/src/serve.ts:1276`, `apps/server/tests/serve.test.ts:1281` | FIXED |
| 11 | P3 | correctness | Asynchronous proof-adapter injection contaminated production module discovery in other tests | `apps/web/tests/test-helpers/board-build.ts:46` | FIXED |
| 12 | P3 | correctness | Queue-stats test depended on four host child-process launches under load | `apps/server/tests/modules/jobs/index.test.ts:62` | FIXED |

| 13 | P3 | correctness | Two independent CLI boots shared one pipe-test timeout; separate real-CLI cases preserve all five assertions and default budgets | `apps/cli/tests/cli-pipe.test.ts:47` | FIXED |

#### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Desktop 55 tests; server context/index 53 tests; compiled server and CLI concurrent ownership, early shutdown/disconnect and clean release all pass |
| R2 | MET | Current local-main build/package succeeds; actual native app renders Board with isolated preload and database summary HTTP 200; close exits 0 and releases port |
| R3 | MET | Product/runtime documents synchronized; independent final-head review passed all three dimensions. GitHub cloud review is unavailable due to account quota and is not reported as a PASS |

The renderer remains a thin transport with Node disabled and sandbox/context isolation enabled. Private inherited process IPC owns shutdown; no HTTP shutdown endpoint or public command was added. The shared application claim prevents a second runtime from opening the project database, and remains held until runtime and lazy context adapters close. The compiled import fix extends the existing owning build facade; database dependencies remain behind the domain boundary. Generated resources are excluded from source rules while ordinary desktop source remains checked.

The local macOS package is unsigned and unnotarized because this host has no valid Developer ID identity. Native Windows/Linux packaging and physical window-drag interactions have not been exercised here.

Fresh independent evidence: desktop suite 55 pass; closeDb four targeted cases pass; later-runtime-plugin regression passes and preserves the original error. Independent reproduction asserts runtime-stop → registry-clear → supervisor-stop → listener-stop → context-close → owner-release. Final integrated server/context suite: 119 pass; installed native app database summary HTTP 200, Board rendered, renderer Node unavailable, successful quit and port release.

GitHub Codex reviewed earlier revisions; their confirmed findings are fixed. The final cloud request hit the account review limit (comment 5985511123). R3/AC3 were transparently amended to independent final-revision review; this report does not claim a fresh cloud PASS.

### References

https://github.com/gobing-ai/spur/pull/6

### History

- 2026-10-04T20:54:52.453Z todo → wip (system)
- 2026-10-04T21:25:11.302Z wip → testing (system)
- 2026-10-04T23:57:42.722Z testing → done (system)

