---
schema_version: 1
name: Track delegated requests as coordination receipts
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:34.908Z
updated_at: "2026-11-18T06:04:49.883Z"
feature_id: G91
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 3

dependencies: ["1395"]
---

## 1396. Track delegated requests as coordination receipts

### Background

Receipts for A2A delegation already exist. `coordination_runs.remote_task_id`/`remote_context_id` (migrations 0055/0056) are stored before any wait, a stored task id suppresses re-send, and the orphan reaper skips such rows (`docs/design/a2a-member-transport.md` §3.3).

**Refine corrections (2026-11-17)**
- "Record the remote task id in local coordination_runs" → already built. → Dropped as a requirement and kept as a regression assertion.
- "until terminal" → the transport's poll ends at `timeoutMs` (default 600 000 ms, `a2a-member-transport.ts:492`) with `outcome-unknown`. Only a restarted live loop re-attaches. An in-process dispatch that timed out is never read again, and cross-project work routinely runs longer than 10 minutes. → The real gap is a read-on-demand refresh for non-terminal rows carrying a remote task id.
- "Show delegated receipts in spur agent trace" → `trace` takes a run id and polls lineage with `--follow` (`apps/cli/src/commands/agent/trace.ts:17-20`), but it doesn't surface `remote_task_id`/`remoteBranch`. → Add the fields and the refresh there.

### Requirements

- [ ] R1. Add `A2aMemberTransport.refresh(runId)` for a `coordination_runs` row with `remote_task_id` and a non-terminal receipt (`running` or `outcome-unknown`). It performs exactly one `task get` and applies the §4.2 mapping to the receipt (completed, failed or still running). It never sends. A terminal row is returned unchanged with no network call.
- [ ] R2. `spur agent trace <runId>` calls `refresh` once per such row in the lineage before rendering. With `--follow`, it calls `refresh` on each poll. The human and `--json` output include `remoteTaskId`, `remoteContextId`, `remoteBranch`, the A2A state and the member.
- [ ] R3. A refresh failure (target down, auth unset) leaves the receipt unchanged and reports the cause on that row. Trace still renders, and with `--json` the row carries `refreshError`.
- [ ] R4. Regression check: a second dispatch of the same keyed request sends nothing, and the reaper skips the row.

### Acceptance Criteria

- [ ] AC1 — Delegated work is tracked as a receipt until terminal (req: R1, R2, R3, R4)

Test layer: transport unit tests on the golden fixtures, plus the two-project gateway e2e from 1395.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T06:04:43.992Z

- **Poller vs refresh-on-read?** Refresh-on-read. No new process, and `--follow` already provides a bounded watch.
- **Raise the default `timeoutMs` instead?** No. It would only move the cliff; a refresh makes any duration recoverable.

### Design

**WHAT.** One transport method plus a call from the trace service. No new table, column or poller.

**WHY.** Refresh-on-read honours "never auto-resend" and adds no daemon. Trace is where an operator already looks at a run.

**WHERE.**
- `packages/app/src/services/a2a-member-transport.ts` (`refresh`)
- the trace service behind `apps/cli/src/commands/agent/trace.ts`
- `docs/design/a2a-member-transport.md` (§3.3 refresh note, §4.2 unchanged)

**Anti-patterns.**
- No background poller.
- Never resend.
- No secrets in `refreshError` (reuse the existing redaction).

### Plan

- [ ] Step 1 (test first, R1/R3): unit tests on `refresh` with the golden `task get` fixtures already used by the transport parser. Cover completed, failed, still-working, terminal no-op and target down.
- [ ] Step 2 (test first, R2/R4): extend the 1395 two-project e2e. Dispatch with a short `timeoutMs` so the row ends `outcome-unknown`, let the target complete, then check that `spur agent trace <runId> --json` shows `completed` with `remoteTaskId`. Assert that no second send happened.
- [ ] Step 3: implement.
- [ ] Step 4: update the design note, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
