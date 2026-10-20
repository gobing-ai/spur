---
schema_version: 1
name: spur message CLI on InboxService with show and read verbs
status: todo
template: feature-impl
created_at: 2026-10-20T06:59:42.647Z
updated_at: "2026-10-20T07:00:33.825Z"
feature_id: G11
priority: P1
tags:
  - inbox
  - cli

dependencies: ["1266"]
---

## 1268. spur message CLI on InboxService with show and read verbs

### Background

Plan: docs/plans/2026-10-19-inbox-module-refactor.md §3.3; ADR-143. Public-surface consent: the operator approved `spur message show` and `spur message read` on 2026-10-19 (A4).

Sizing: about 3h; one CLI noun.

Implements: R10 — CLI send defaults to the orchestrator as operator; R11 — CLI shows a thread and marks a message read; R12 — CLI inbox listing writes nothing.

Depends on: Inbox domain schema and InboxService as the single writer. Can run in parallel with the web task.

### Requirements

- [ ] R1. `spur message send` with no `--to`/`--role` targets the resolved orchestrator, from `operator`; `--wait` watches the sent message own status, not inbox-wide pending.
- [ ] R2. `spur message inbox` is read-only (no reconcile on read).
- [ ] R3. Add `spur message show <id>` (thread, both directions) and `spur message read <id>`.
- [ ] R4. Update `docs/help/cmd_message.md`, `docs/help2/message.md` and `plugins/sp/skills/spur-cli/references/message.md`.

### Acceptance Criteria

- [ ] AC1 — CLI send defaults to the orchestrator as operator
- [ ] AC2 — CLI shows a thread and marks a message read
- [ ] AC3 — CLI inbox listing writes nothing

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: the commands in `apps/cli/src/commands/message.ts` become thin calls into InboxService; split into `commands/message/{index,<verb>,shared}.ts` only if the file grows past the noun-size convention.
Rejected: a new `spur inbox` noun (message already owns the action).
Invariants: `--json` output parses; failed operations exit nonzero.

### Plan

1. CLI E2E: send → inbox → show → reply → read through the linked binary against a temp project.
2. Rewire the verbs; add show/read.
3. Help docs.
4. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
