---
template: feature-impl
schema_version: 1
name: "Author /sp:dev-refresh command (feature-id | wbs | --all | --auto)"
description: ""
status: todo
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0327"]
created_at: "2026-07-25T00:27:51.163Z"
updated_at: "2026-07-25T00:29:16.590Z"
---

## 0329. Author /sp:dev-refresh command (feature-id | wbs | --all | --auto)

### Background
Implements the map's command-surface decision (see `docs/tasks2/0324_decide-refresh-command-surface-single-dev-refresh-with-modes.md` — Solution section). Depends on the derivation engine + `spur feature sync` verb (sibling task). Thin wrapper: orchestrates the CLI verb + `feature-link-helper`; zero duplicated derivation logic.

Conventions: existing dev-* command shape at `plugins/sp/commands/dev-wrap.md`; link helper at `plugins/sp/skills/spur-dev/references/feature-link-helper.md`.
### Requirements
- New `plugins/sp/commands/dev-refresh.md` following dev-* conventions (frontmatter `description` / `argument-hint` / `allowed-tools`).
- Modes: feature id ⇒ derivation preview + confirm + apply; task WBS ⇒ resolve linked feature (link-helper propose/confirm/skip when missing; persisted skip honored) then the same; `--all` ⇒ combined pass: orphan link sweep (batch mode, per-orphan confirm/skip/override) + stale-status refresh of linked features, per-item confirm with derivation reason, summary report (applied / skipped / queued); `--auto` ⇒ unattended policy (forward-only auto-apply; link proposals queued to report).
- Idempotent: no-op with a clear "already in sync" message when derivation yields no proposal; sensible exit codes.
- Register in `plugins/sp/README.md` command index; `docs/04_DESIGN.md` in the same commit (T3).
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
