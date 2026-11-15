---
schema_version: 1
name: Prove a two-install fleet dispatch over A2A
status: todo
template: feature-impl
created_at: 2026-11-15T04:06:32.872Z
updated_at: "2026-11-15T08:09:19.549Z"
feature_id: G9
priority: P3
tags:
  - a2a
  - fleet
  - e2e
estimate_hours: 8

dependencies: ["1336", "1334"]
---

## 1337. Prove a two-install fleet dispatch over A2A

### Background

Implements: R6 — Two Spur installs complete a dispatch over A2A; R7 — A member that declares its own write fencing accepts mutating work.

Joins the sending side (G8, task 1334) to the receiving side (the serve endpoint task) and lifts the read-only limit for remote members that fence their own tree. Contract: `docs/design/a2a-member-transport.md` sections 3.5 and 4.3.

### Requirements

- [ ] R1 — An E2E lane starts two isolated Spur homes on one machine, A declaring a member with B's card, and completes a read-only dispatch by name.
- [ ] R2 — Both installs hold a durable record: A the request and receipt, B the inbox request and run.
- [ ] R3 — B's cards carry a write-fencing extension; A accepts worktree-mutating work for a member whose card has it and still refuses it otherwise.
- [ ] R4 — For mutating work A's receipt names the remote branch; A does not fetch or merge it.

### Acceptance Criteria

- [ ] AC1 — Two Spur installs complete a dispatch over A2A
- [ ] AC2 — A member that declares its own write fencing accepts mutating work

Task-local check: the lane is repeatable from one command and leaves both installs' receipts.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**2026-11-15 — not attempted (batch 1331,1334,1337).** Blocked in-batch: dependency 1334 cancelled before implementation (preflight A2). Two-install lane follows 1334.

### Design

Approach: no new mechanism — the lane composes the two existing halves. The fencing signal is one card extension URI that the sender's read-only admission check consults.

Rejected: transferring diffs over A2A artifacts (large, and merging is a human decision); trusting any card for mutating work.

Invariant: without the extension, behavior is exactly G8's.

### Plan

- [ ] Failure list first: B down, B restarted mid-run, card without the extension, token mismatch.
- [ ] Two-home E2E lane and its receipt artifact.
- [ ] Card extension on the server side; admission check on the sender side.
- [ ] Update `docs/design/a2a-member-transport.md` invariant 3.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
