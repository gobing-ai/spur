---
schema_version: 1
name: Flatten the daemon lifecycle onto spur self verbs
status: done
template: feature-impl
created_at: 2026-11-17T18:15:22.636Z
updated_at: "2026-11-27T07:31:34.361Z"
feature_id: K45
priority: P1
tags:
  - cli
  - surface
  - gateway
  - daemon

done_forced: "true"
done_reason: Implemented inline 2026-11-17 with operator consent; verify verdict PASS; docs+parity fixtures updated in the same change.
---

## 1369. Flatten the daemon lifecycle onto spur self verbs

### Background

`spur self daemon <install|uninstall|status>` put a noun-shaped positional action inside a verb slot, so the daemon lifecycle was invisible in `spur self --help` and had to be re-documented in five help pages per tree. Covers feature scenarios R1-R4.

### Requirements

- [ ] R1. Add `--daemon` (and `--port <n>`) to `spur self install`, running the LaunchAgent install as an additive hop whose failure still exits 1.
- [ ] R2. Add `spur self uninstall [--daemon] [--port <n>]` that boots the agent out and removes the plist; absent is success.
- [ ] R3. Report the LaunchAgent from `spur self status` (text line + `daemon` block in `--json`) without corrupting the readiness aggregate's stdout.
- [ ] R4. Keep `spur self daemon <action>` as a hidden alias that prints the replacement verb and behaves identically.
- [ ] R5. Refresh every owning doc surface in the same change: README, `docs/help{,2}`, `spur-cli-matrix`, the `spur self` reference and ADR-151's shipped-surface line.

### Acceptance Criteria

- [ ] AC1 — The gateway LaunchAgent is installed through `spur self install --daemon`
- [ ] AC2 — The LaunchAgent is removed through `spur self uninstall`
- [ ] AC3 — `spur self status` reports the LaunchAgent beside readiness
- [ ] AC4 — The old `spur self daemon` spelling still works and names its replacement

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Split the existing daemon command module into a resolver (`resolveDaemonDeps`), a value-returning reader (`readDaemonStatus`) and a rendering action (`runDaemonAction`), then expose those through the flat verbs; the deprecated alias keeps the old positional action and delegates. `status` embeds the reader's value instead of capturing rendered output — a second JSON document on stdout would corrupt the aggregate. Rejected: repurposing `self install`/`self status` for the daemon only (both already mean something else); rejected: new `install-daemon` verbs (three more daemon-specific verbs on the root noun). Invariants: plist bytes, launchctl argv and exit codes unchanged; `spur self status` stays read-only and macOS-guarded.

### Plan

- [ ] Refactor `self/daemon.ts` into `resolveDaemonDeps` / `readDaemonStatus` / `runDaemonAction` + hidden deprecated alias.
- [ ] Add `--daemon` to `self install` with an injectable deps seam.
- [ ] Add `self/uninstall.ts` and register it.
- [ ] Embed the daemon block in `status.ts` (darwin only, no extra stdout).
- [ ] Update README, help trees, matrix, spur-cli reference and ADR-151 surface line.
- [ ] Tests: uninstall verb, `install --daemon` hop, daemon census count, help/parity suites.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T18:15:30.776Z todo → wip (system)
- 2026-11-17T18:15:31.341Z wip → testing (system)
- 2026-11-17T18:15:31.912Z testing → done (system)
- 2026-11-27T07:31:34.361Z feature_id R → K45 (system)

