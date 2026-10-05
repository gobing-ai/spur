---
schema_version: 1
name: Include desktop packaging in the root build
status: testing
template: standard
created_at: 2026-10-05T01:52:28.356Z
updated_at: "2026-10-05T02:21:22.968Z"

ac_altitude: task-local
ac_numbering: task-local
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

### Design

Append the existing `bun run --filter @gobing-ai/spur-desktop pack` to the root `package.json` build chain. Reuse its staging and Electron builder configuration. Packaging targets the current host platform; this does not introduce cross-platform builds, new scripts, dependencies or signing policy. Update only `apps/desktop/README.md` and `docs/design/desktop-shell.md`. Validate through a real root build on this Mac and the required task gate.

### Plan

- [x] Add the existing desktop pack command after the web build in `package.json`.
- [x] Synchronize `apps/desktop/README.md` and `docs/design/desktop-shell.md`.
- [x] Run the root build and verify CLI/server/web/app/DMG outputs.
- [x] Review the diff and record the actual validation evidence.
- [ ] Achieve a full quality-gate PASS: the unchanged task-record scratch-disposal test currently times out after 5000ms.

### Solution

| File | Change |
| --- | --- |
| `package.json:67` | Append the existing desktop pack script after the web build in the root build chain. |
| `apps/desktop/README.md:34` | Document native desktop output and remove redundant staging after the unified build. |
| `docs/design/desktop-shell.md:45` | Synchronize the owning packaging contract, preserving standalone repackaging. |

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | package.json:67 appends the existing desktop pack command after web; real root build exits 0. |
| R2 | MET | .spur/run/1086/build-final.log and build-output-final.json prove CLI/server/web, native app and DMG outputs; dmg-verify-final.log reports VALID checksum. |
| R3 | MET | apps/desktop/README.md:34 and docs/design/desktop-shell.md:45 document unified build output and standalone pack. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | build | .spur/run/1086/build-final.log, build-output-final.json and dmg-verify-final.log |
| AC2 | MET | inspection | README and owning packaging contract match package.json build and preserved standalone pack script. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Scope: `package.json:67`, `apps/desktop/README.md:34`, `docs/design/desktop-shell.md:45`.

Functional: R1 uses the existing pack script after web, with shell failure propagation preserved. R2 is verified by the successful real macOS root build and recorded outputs. R3 synchronizes the README and existing packaging owner under constitution T3.

SECUA: no new inputs, dependencies, runtime code or security boundary. Accessibility is unaffected. Native packaging uses the existing signing configuration. Architecture: the app remains a thin transport and reuses existing staging and packaging.

No blocking findings. Builds now include native Electron packaging for the current host platform, increasing build time and using the existing packaging tooling. The CI build also invokes this same command on its host. Windows and Linux native packages are not verified by this macOS run.

Validation limitation: the first full gate mixed code and tests while another session merged task 1085; its four workflow failures pass against the final revision. The second gate has 10,033 passes and one failure: the unchanged `packages/app/tests/services/task-record.test.ts:709` scratch-disposal test times out after 5000ms. The same case reproduces directly. This blocks full-gate certification; no timeout increase, suppression or out-of-scope test edit was applied. Lint, typechecks, all 50 pre-check rules and both post-check rules pass.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-05T01:53:53.240Z backlog → todo (system)
- 2026-10-05T01:53:54.649Z todo → wip (system)
- 2026-10-05T02:21:22.968Z wip → testing (system)

