---
schema_version: 1
name: Include desktop packaging in the root build
status: done
template: standard
created_at: 2026-10-05T01:52:28.356Z
updated_at: "2026-10-05T23:15:05.320Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/1086/verdict.json
---

## 1086. Include desktop packaging in the root build

### Background

The operator requests one root build command for CLI, server, web and native desktop packaging. The existing desktop pack script already stages the compiled binaries and web assets and publishes to dist/desktop.

### Requirements

- [x] R1. `bun run build` must package the desktop after building CLI, server and web, using the existing desktop pack script.
- [x] R2. On this macOS host the root build must produce the existing CLI/server/web outputs and the native desktop app and DMG under `dist/desktop`.
- [x] R3. The desktop README and owning packaging contract must describe the unified build and retain the standalone desktop pack command.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Unified root build includes native desktop packaging (req: R1, R2)
Given the repository dependencies are installed on macOS
When the operator runs `bun run build`
Then CLI, server and web build before desktop packaging
And `dist/desktop` contains a native app and DMG.

Scenario: AC2 — Packaging instructions match the build command (req: R3)
Given the desktop packaging README and design contract
When the operator follows their build instructions
Then `bun run build` is documented as producing desktop output
And the standalone desktop pack command remains documented.
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-05T04:05:17.766Z

The operator explicitly requested resolving task 1086 before implementing server reuse. The unchanged scratch-disposal test now passes in both the live main checkout and the isolated `feat/desktop-server-reuse` worktree (approximately 0.5 seconds). Its Git fingerprint capture measures approximately 50 ms in both trees. Earlier five-second failures are retained as historical failed attempts; current evidence does not justify a speculative code fix or longer timeout. The remaining completion condition is a clean full gate on a fixed revision, followed by recorded PASS provenance. The isolated worktree protects the verification from other sessions committing or editing main.

### Design

Append the existing `bun run --filter @gobing-ai/spur-desktop pack` to the root `package.json` build chain. Reuse its staging and Electron builder configuration. Packaging targets the current host platform; this does not introduce cross-platform builds, new scripts, dependencies or signing policy. Update only `apps/desktop/README.md` and `docs/design/desktop-shell.md`. Validate through a real root build on this Mac and the required task gate.

### Plan

- [x] Add the existing desktop pack command after the web build in `package.json`.
- [x] Synchronize `apps/desktop/README.md` and `docs/design/desktop-shell.md`.
- [x] Run the root build and verify CLI/server/web/app/DMG outputs.
- [x] Review the diff and record actual validation evidence.
- [x] Complete the full quality gate on a stable revision: 10036 tests passed, no failures, coverage and all lint/type/rule checks passed.

### Solution

| File | Change |
| --- | --- |
| `package.json:67` | Append the existing desktop pack script after the web build in the root build chain. |
| `apps/desktop/README.md:34` | Document native desktop output and remove redundant staging after the unified build. |
| `docs/design/desktop-shell.md:45` | Synchronize the owning packaging contract, preserving standalone repackaging. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `package.json:67` — root build chain appends the existing desktop pack after the web build; re-read at the cited line this run |
| R2 | MET | `ls dist/desktop` (exit 0 this run) shows the native app and DMG; build receipt @spur-run `.spur/run/1086/build-final.log` line 100 — desktop pack exited 0; @spur-run `.spur/run/1086/build-output-final.json` line 1 — all five CLI/server/web/app/DMG outputs; DMG checksum @spur-run `.spur/run/1086/dmg-verify-final.log` line 18 — VALID |
| R3 | MET | `apps/desktop/README.md:34` and `docs/design/desktop-shell.md:45` document the unified root build producing desktop output and retain the standalone pack command; both re-read at the cited lines this run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Unified root build includes native desktop packaging (req: R1, R2) | MET | command | `ls dist/desktop` (exit 0, this run): Spur.app and DMG present; root build ordering and pack exit 0 @spur-run `.spur/run/1086/build-final.log` line 100 |
| Scenario: AC2 — Packaging instructions match the build command (req: R3) | MET | command | `grep -n 'bun run build' apps/desktop/README.md docs/design/desktop-shell.md` (exit 0, this run) matched `apps/desktop/README.md:34` and `docs/design/desktop-shell.md:45` — unified build documented, standalone pack retained |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Scope: `package.json:67`, `apps/desktop/README.md:34`, `docs/design/desktop-shell.md:45`.

Functional: R1 composes the existing native pack script after web with shell failure propagation. R2 is proven by the real root build and app/DMG output receipts. R3 synchronizes the README and owning contract under constitution T3. SECUA and architecture: no new inputs, dependencies or runtime/security boundaries; packaging reuses the existing staging, builder and signing policy.

The earlier validation limitations are resolved by the stable-revision rerun: 10036 tests across 584 files passed, coverage passed, lint/typechecks and all 50 pre/2 post rules passed. The unchanged scratch-disposal case passed in 777.43 ms and D61 feature-check case in 130.13 ms. An earlier isolated run was interrupted by SIGTERM; it is retained as interrupted evidence, not a PASS. Its completed lint/pre-rule phases were followed by a fresh full test phase and post-rules on the same unchanged source revision. No timeout increase, suppression or speculative code fix was applied. No blocking findings remain. Native artifacts were verified on macOS; no Windows/Linux package verification is claimed.

| Priority | Finding | File:Line | Disposition |
| --- | --- | --- | --- |
| P4 | Native packaging evidence covers macOS; Windows/Linux packaging remains outside this task's verification. | `apps/desktop/README.md:34` | Advisory; no blocking findings for the requested macOS root build. |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-05T01:53:53.240Z backlog → todo (system)
- 2026-10-05T01:53:54.649Z todo → wip (system)
- 2026-10-05T02:21:22.968Z wip → testing (system)
- 2026-10-05T04:19:20.971Z testing → done (system)

