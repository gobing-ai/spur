---
schema_version: 1
name: Fix dependency-drift-check scoped-key path derivation
status: todo
template: issue
created_at: 2026-10-03T21:55:58.443Z
updated_at: "2026-10-03T21:56:10.212Z"
feature_id: E93

---

## 1068. Fix dependency-drift-check scoped-key path derivation

### Background

Captured from the creation title: "Fix dependency-drift-check scoped-key path derivation".

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

dependency-drift-check cannot resolve scoped bun.lock keys for nested @gobing-ai deps.

Discovered during E93 wrap (feature-verification gate, 2026-10-03). readLockedTsDependencies flattens scoped lock keys (e.g. `@gobing-ai/ts-llm-jsonl-importer/@gobing-ai/ts-db`) into `node_modules/<parent>/<child>/package.json`, omitting the `node_modules` segment bun actually uses for nested layouts, so any version divergence between workspace catalog and a published ts-* package's exact deps reports `installed missing` and the check fails regardless of `bun install` state. Currently masked only because the catalog is fully aligned to ^0.5.12 (commit f99bf3b3) so no scoped ts-* keys exist.

Fix: derive the installed path for scoped keys as `<parent>/node_modules/<child>` (or resolve via the lock's workspace-scoped resolutions), and add a test covering a deliberately divergent scoped key. Keep the check failing loud when the lock contains divergence the layout does not materialize.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
