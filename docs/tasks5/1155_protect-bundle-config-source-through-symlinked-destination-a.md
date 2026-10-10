---
schema_version: 1
name: Protect bundle-config source through symlinked destination ancestors
status: todo
template: feature-impl
created_at: 2026-10-10T07:27:54.618Z
updated_at: "2026-10-10T07:28:44.925Z"
feature_id: A

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 3
---

## 1155. Protect bundle-config source through symlinked destination ancestors

### Background

Review a71c reproduced source deletion in a temporary repository: a symlinked parent aliases the repo, but the lexical target guard accepts alias/config and rm deletes the real config directory before cp fails. Evidence: `scripts/commands/bundle-config.ts:28` and `scripts/commands/bundle-config.ts:32`; reproduction receipt: `.spur/run/a71c-config-symlink-repro.json`. The separate gate-lock diagnostic was already corrected during triage. These are task-local packaging regression scenarios, not feature ship criteria.

### Requirements

- [ ] R1. Resolve destination aliases before destructive cleanup and reject destinations equal to or containing the physical source.
- [ ] R2. Preserve ordinary bundle output and schema injection; reject unsafe paths before any removal.
- [ ] R3. Cover symlinked ancestor aliases, direct source/ancestor destinations, and safe missing destination directories with isolated fixtures.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Aliased source cannot be deleted (req: R1, R2)
  Given an isolated repo whose parent alias is a symlink
  When bundleConfig targets alias/config
  Then it rejects before removal and source sentinel bytes remain unchanged

Scenario: AC2 — Safe output still bundles (req: R2, R3)
  Given a safe destination with missing final directories
  When bundleConfig runs
  Then assets are copied and workflow schema directives remain unique

Scenario: AC3 — Direct ancestors are protected (req: R1, R3)
  Given source and ancestor destination paths
  When bundleConfig runs for each
  Then every unsafe destination is rejected before writes
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Use the physical-path containment approach already implemented by `scripts/commands/bundle-web.ts:103`, resolving existing parents for missing destinations before rm. Keep scope to bundle-config and its tests; no new public command, dependency, schema, or general filesystem abstraction. Reject lexical-only normalization because it demonstrably loses source data. Do not test destructive aliases against this repository: copy the script into an isolated fixture layout so SOURCE points at fixture config.

### Plan

1. Add isolated source-preservation regression fixtures in scripts/commands/bundle-config.test.ts and observe failure with the current implementation.
2. Canonicalize source and destination before cleanup in scripts/commands/bundle-config.ts, retaining errors other than ENOENT.
3. Run focused tests from scripts and the project gate; verify source bytes and safe generated output.

Targets: scripts/commands/bundle-config.ts; scripts/commands/bundle-config.test.ts. Out of scope: plugin bundler redesign, publication behavior, new CLI flags.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `scripts/commands/bundle-config.ts:28` — lexical-only containment.
- `scripts/commands/bundle-config.ts:32` — destructive cleanup.
- `scripts/commands/bundle-web.ts:103` — existing physical path precedent.

### History

- 2026-10-10T07:28:44.925Z backlog → todo (system)

