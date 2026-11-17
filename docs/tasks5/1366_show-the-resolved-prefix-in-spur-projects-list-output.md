---
schema_version: 1
name: Show the resolved prefix in spur projects list output
status: done
template: feature-impl
created_at: 2026-11-17T08:50:47.851Z
updated_at: "2026-11-17T09:20:13.058Z"
feature_id: Q
priority: P2
tags:
  - cli
  - projects
  - output

done_forced: "true"
done_reason: "Implemented inline in the 2026-11-17 session under feature Q; verify verdict PASS recorded in the task Testing section; bun run spur-check green (12558 pass, 0 fail)."
---

## 1366. Show the resolved prefix in spur projects list output

### Background

`spur projects list` prints `url: http://localhost:0/board` for every stopped entry (`apps/cli/src/commands/projects.ts:206-214,330-332`) and shows the gateway URL only when `isGatewayAnswering` happens to succeed. The prefix an operator needs in order to reach a project is never a field of its own. Covers feature scenario R5.

### Requirements

- [ ] R1. Print the resolved prefix as its own field for every local entry, and state explicitly when an entry is remote (no prefix).
- [ ] R2. Never print a URL containing port 0; a stopped local entry reports its prefix route (or the note that the gateway is down) instead of an unroutable URL.
- [ ] R3. Keep the existing machine-readable fields in `--json` output and add the prefix there without renaming current keys.

### Acceptance Criteria

- [ ] AC1 — projects list reports the route instead of an unroutable URL

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The command already computes `prefix` per entry before formatting; the change is confined to the human formatter plus the same value in the JSON projection, so the CLI stays a projection of one resolver (`resolveProjectPrefix`). Rejected: dropping the URL line entirely (operators still need the reachable address when a project runs); rejected: printing the gateway URL unconditionally (a stopped gateway would produce a URL that 404s). Invariants: `--json` stays backward compatible; no probe added to the stopped path; remote entries keep host:port rendering.

### Plan

- [ ] Add the prefix column to the human formatter with a remote marker.
- [ ] Replace the port-0 URL with the prefix route plus a gateway-down note.
- [ ] Keep the JSON projection additive.
- [ ] Tests: stopped local entry (no `:0`), running local entry with gateway up and down, remote entry.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T09:18:35.389Z todo → wip (system)
- 2026-11-17T09:18:35.919Z wip → testing (system)
- 2026-11-17T09:18:36.458Z testing → done (system)
- 2026-11-17T09:20:11.924Z done → wip (system)
- 2026-11-17T09:20:12.439Z wip → testing (system)
- 2026-11-17T09:20:12.963Z testing → done (system)

