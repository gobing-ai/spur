---
schema_version: 1
name: Remove the deprecated spur self daemon alias
status: done
template: feature-impl
created_at: 2026-11-18T05:29:30.251Z
updated_at: "2026-11-19T00:41:49.062Z"
feature_id: A36
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 1

done_forced: "false"
done_reason: unforced close
---

## 1387. Remove the deprecated spur self daemon alias

### Background

K4 flattened the daemon lifecycle into `spur self install --daemon` / `spur self uninstall` / `spur self status`. The old `spur self daemon <install|uninstall|status>` survives as a hidden alias in `registerDaemonCommand` (`apps/cli/src/commands/self/daemon.ts:131-150`), which is also documented at `apps/cli/src/commands/self/index.ts:20`.

**Refine corrections (2026-11-17)**
- "straight deletion" → `registerDaemonCommand` also carries the `GatewayDaemonDeps` test-override seam, and the flat verbs may import shared helpers from `daemon.ts` → delete only the alias registration and its tests, keep any helper the flat verbs import, and drop the `self/index.ts` call site and doc line.
- The original scope had no check for internal callers → `rg "self daemon"` over apps, packages, plugins, scripts and config must return only docs history (CHANGELOG, done tasks).

### Requirements

- [x] R1. Remove the `daemon` sub-command registration, its call site in `self/index.ts` and its tests. Keep helpers the flat verbs import.
- [x] R2. Update `plugins/sp/skills/spur-cli/references/self.md`, help fixtures and READMEs that mention `self daemon`. `rg -n "self daemon"` outside CHANGELOG/done-task history returns nothing.
- [x] R3. `spur self daemon status` exits non-zero with commander's unknown-command error. `plugins/sp/tests/cli-surface-parity.test.ts` and `help-docs-parity.test.ts` pass.

### Acceptance Criteria

- [x] AC1 — Deprecated daemon alias is gone (req: R1, R2, R3)

Test layer: the real commander program (`buildProgram`), no mocks.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:52:44.477Z

- **Keep a deprecation stub?** Closed: no. A commander unknown-command error is the documented outcome (feature AC R1).

### Design

**WHAT.** Delete `registerDaemonCommand` (or only its alias body, if the flat `install --daemon`/`uninstall`/`status` paths reuse its action function), its invocation, and the alias tests under `apps/cli/tests/commands/self/`.

**WHY.** One spelling per action. A breaking removal is approved pre-1.0 (feature Notes).

**WHERE.** `apps/cli/src/commands/self/daemon.ts`, `apps/cli/src/commands/self/index.ts`, `apps/cli/tests/commands/self/*daemon*`, `plugins/sp/skills/spur-cli/references/self.md`, and `apps/cli/README.md`.

**Anti-patterns.** Don't change the flat verbs' behavior. Don't leave a stub that prints a deprecation notice.

### Plan

- [x] Step 1 (test first, R3): replace the alias tests with one that asserts `spur self daemon status` is an unknown command.
- [x] Step 2 (R1): delete the registration and call site.
- [x] Step 3 (R2): update the docs and fixtures, then run the `rg` check.
- [x] Step 4: run `(cd apps/cli && bun test tests/commands/self)`, the plugin parity tests, then `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `README.md:0` |
| `README.md:177` |
| `apps/cli/src/commands/self/index.ts:19` |
| `apps/cli/src/commands/self/index.ts:21` |
| `apps/cli/src/commands/self/index.ts:7` |
| `apps/cli/src/commands/self/install.ts:6` |
| `apps/cli/src/commands/self/shared.ts:1` |
| `apps/cli/src/commands/self/uninstall.ts:6` |
| `apps/cli/src/commands/status.ts:0` |
| `apps/cli/src/commands/status.ts:9` |
| `apps/cli/tests/commands/self/shared.test.ts:1` |
| `apps/server/src/gateway.ts:28` |
| `docs/00_ADR.md:2943` |
| `docs/design/project-gateway.md:64` |
| `docs/design/project-switcher.md:33` |
| `docs/help/cmd_init.md:134` |
| `docs/help/cmd_maintain.md:44` |
| `docs/help/cmd_migrate.md:64` |
| `docs/help/cmd_serve.md:79` |
| `docs/help/cmd_status.md:127` |
| `plugins/sp/skills/spur-cli/references/self.md:55` |
| `plugins/sp/skills/spur-cli/references/serve.md:67` |
| `apps/cli/tests/commands/self/daemon-removed.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — remove the `daemon` registration, its call site in `apps/cli/src/commands/self/index.ts` and its tests; keep the helpers the flat verbs import | MET | `apps/cli/src/commands/self/index.ts` no longer imports or calls `registerDaemonCommand`; the registration body is gone from the module; the helpers survive as `apps/cli/src/commands/self/shared.ts` (`resolveDaemonDeps`, `readDaemonStatus`, `readDaemonStatusOrNull`, `runDaemonAction`) and are imported by `apps/cli/src/commands/self/install.ts`, `apps/cli/src/commands/self/uninstall.ts`, `apps/cli/src/commands/self/status.ts`. Covered by `apps/cli/tests/commands/self/shared.test.ts` (10 tests) |
| R2 — update `plugins/sp/skills/spur-cli/references/self.md`, help fixtures and READMEs; `rg -n "self daemon"` outside CHANGELOG/done-task history returns nothing | MET | `plugins/sp/skills/spur-cli/references/self.md`, `plugins/sp/skills/spur-cli/references/serve.md`, `README.md`, `docs/help/cmd_{status,maintain,serve,migrate}.md`, plus two design rows that still claimed the alias (`docs/design/project-gateway.md`, `docs/design/project-switcher.md`) and the ADR-151 paragraph in `docs/00_ADR.md` (dated 2026-11-18 amendment). The `rg` sweep now returns only sentences that state the removal |
| R3 — `spur self daemon status` exits non-zero with commander's unknown-command error; parity tests pass | MET | `apps/cli/tests/commands/self/daemon-removed.test.ts` drives the real `buildProgram`: the `self` noun has no `daemon` verb and `parseAsync([... 'self','daemon','status'])` rejects with `unknown command`. `plugins/sp` `cli-surface-parity` + `help-docs-parity` 25/25 |
| Anti-patterns — no deprecation stub, flat verbs unchanged | MET | nothing prints a deprecation notice; `runDaemonAction`'s install/uninstall/status branches are byte-identical (only imports moved) and their tests still pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Deprecated daemon alias is gone (R1, R2, R3) | MET | test | `apps/cli/tests/commands/self/daemon-removed.test.ts` (real commander program, 2 tests), `apps/cli/tests/commands/self/shared.test.ts` 10/10, `apps/cli` self suite 94/94, `cli-depth-guard` + `json-envelope-inventory` green, plugin parity 25/25, `recommended-pre-check` 51/51 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T17:27:05.743Z todo → wip (system)
- 2026-11-18T17:36:59.430Z wip → testing (system)
- 2026-11-18T17:37:01.108Z testing → done (system)

