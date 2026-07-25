---
name: Plugin runtime sandboxing for curated and untrusted tiers
description: Plugin runtime sandboxing for curated and untrusted tiers
status: blocked
created_at: 2026-06-03T17:06:55.474Z
updated_at: 2026-06-03T22:43:14.811Z
folder: docs/tasks
type: task
feature-id: F-5 plugin-system
priority: low
dependencies: ["Phase 5a (SDK)","Phase 5b (loader)","TRIGGER: a genuinely third-party (non-operator-authored) plugin is onboarded"]
tags: ["plugin-system","sandboxing","trust","out-of-scope","parked","phase-5e"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0016. Plugin runtime sandboxing for curated and untrusted tiers

### Background

Phase 5e of the plugin system (ADR-012). **Accepted out of scope** (operator decision
2026-06-03), consistent with PRD §5.4 and ADR-010 (single-machine, local-first). This is
NOT on the Phase-5 critical path. Every plugin the operator installs is operator-trusted;
OS-level isolation adds large complexity for a threat model that does not yet exist.
Until/unless Spur onboards genuinely third-party, non-operator-authored plugins, the
`bundled`/`curated`/`local` tiers run in-process and the `untrusted` tier is not loaded
(fail-closed). This task captures the future design only; it is not scheduled.


### Requirements

Worker-thread/process isolation enforcing the trust ladder at RUNTIME: untrusted = no fs/net/shell, readonly APIs; curated = fs-read + network allowlist + shell allowlist; TrustEngine.enforce throws on denied actions; integration tests that an untrusted plugin cannot write files / make network calls / register harness or provider. Design when a first real curated/untrusted plugin is onboarded.


### Q&A



### Design



### Solution



### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


