---
schema_version: 1
name: Remove the deprecated spur self daemon alias
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:30.251Z
updated_at: "2026-11-18T05:52:44.477Z"
feature_id: A36
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 1

---

## 1387. Remove the deprecated spur self daemon alias

### Background

K4 flattened the daemon lifecycle into `spur self install --daemon` / `spur self uninstall` / `spur self status`. The old `spur self daemon <install|uninstall|status>` survives as a hidden alias in `registerDaemonCommand` (`apps/cli/src/commands/self/daemon.ts:131-150`), which is also documented at `apps/cli/src/commands/self/index.ts:20`.

**Refine corrections (2026-11-17)**
- "straight deletion" → `registerDaemonCommand` also carries the `GatewayDaemonDeps` test-override seam, and the flat verbs may import shared helpers from `daemon.ts` → delete only the alias registration and its tests, keep any helper the flat verbs import, and drop the `self/index.ts` call site and doc line.
- The original scope had no check for internal callers → `rg "self daemon"` over apps, packages, plugins, scripts and config must return only docs history (CHANGELOG, done tasks).

### Requirements

- [ ] R1. Remove the `daemon` sub-command registration, its call site in `self/index.ts` and its tests. Keep helpers the flat verbs import.
- [ ] R2. Update `plugins/sp/skills/spur-cli/references/self.md`, help fixtures and READMEs that mention `self daemon`. `rg -n "self daemon"` outside CHANGELOG/done-task history returns nothing.
- [ ] R3. `spur self daemon status` exits non-zero with commander's unknown-command error. `plugins/sp/tests/cli-surface-parity.test.ts` and `help-docs-parity.test.ts` pass.

### Acceptance Criteria

- [ ] AC1 — Deprecated daemon alias is gone (req: R1, R2, R3)

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

- [ ] Step 1 (test first, R3): replace the alias tests with one that asserts `spur self daemon status` is an unknown command.
- [ ] Step 2 (R1): delete the registration and call site.
- [ ] Step 3 (R2): update the docs and fixtures, then run the `rg` check.
- [ ] Step 4: run `(cd apps/cli && bun test tests/commands/self)`, the plugin parity tests, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
