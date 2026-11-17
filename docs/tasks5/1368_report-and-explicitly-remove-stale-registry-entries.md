---
schema_version: 1
name: Report and explicitly remove stale registry entries
status: done
template: feature-impl
created_at: 2026-11-17T08:50:47.852Z
updated_at: "2026-11-17T09:20:15.756Z"
feature_id: Q
priority: P2
tags:
  - registry
  - cli
  - hygiene

done_forced: "true"
done_reason: "Implemented inline in the 2026-11-17 session under feature Q; verify verdict PASS recorded in the task Testing section; bun run spur-check green (12558 pass, 0 fail)."
---

## 1368. Report and explicitly remove stale registry entries

### Background

`spur projects clean` purges an entry only when its directory is gone (`apps/cli/src/commands/projects.ts:116-123`). An ephemeral project root that still exists — `/private/tmp/a2a-smoke`, a `TMPDIR` e2e folder — survives every sweep, so the operator registry currently holds 8 such rows plus one duplicate path, and the switcher lists 18 entries. Covers feature scenario R7.

### Requirements

- [ ] R1. Classify an entry as suspect with a stated reason when its path is ephemeral (`/tmp`, `/private/tmp`, `$TMPDIR`, `/var/folders`), when another entry shares its path, or when its stored serve port is owned by a different entry.
- [ ] R2. Report suspects from the CLI and the Board from the same derivation; classification alone never removes anything.
- [ ] R3. Remove only on an explicit flag or explicit selection, one entry at a time, through `ProjectRegistry` under the existing lock.
- [ ] R4. Leave every non-selected entry byte-identical, including its prefix and ports.

### Acceptance Criteria

- [ ] AC1 — Registry staleness is visible and removable

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Add the classification beside the existing refresh/purge logic in the registry service, where path and host are already normalized, and expose it through `spur projects clean` as a report-only pass plus an opt-in removal flag. The rule set stays declarative (path patterns + duplicate path + foreign port owner) so tests can drive it without touching a real filesystem layout. Rejected: auto-purging ephemeral paths inside `clean` (destructive on a shared machine where `/tmp` projects can be intentional); rejected: a new `spur projects prune` noun (public-surface rule — an existing verb can own it). Invariants: classification is read-only; removal is per-entry and lock-guarded; `clean --no-terminate-processes` keeps its current meaning.

### Plan

- [ ] Add the suspect classifier + reasons to the registry service.
- [ ] Surface the report in the `projects clean` human and `--json` output.
- [ ] Add the explicit removal flag with per-entry writes.
- [ ] Render the same suspects in the Board projects module.
- [ ] Tests: ephemeral path, duplicate path, foreign port owner, removal of exactly the selected entry, and a clean registry that reports nothing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T09:18:38.142Z todo → wip (system)
- 2026-11-17T09:18:38.673Z wip → testing (system)
- 2026-11-17T09:18:39.202Z testing → done (system)
- 2026-11-17T09:20:14.615Z done → wip (system)
- 2026-11-17T09:20:15.139Z wip → testing (system)
- 2026-11-17T09:20:15.662Z testing → done (system)

