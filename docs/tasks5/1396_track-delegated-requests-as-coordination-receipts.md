---
schema_version: 1
name: Track delegated requests as coordination receipts
status: done
template: feature-impl
created_at: 2026-11-18T05:29:34.908Z
updated_at: "2026-11-18T09:07:46.684Z"
feature_id: G91
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 3

dependencies: ["1395"]
done_forced: "false"
done_reason: unforced close
---

## 1396. Track delegated requests as coordination receipts

### Background

Receipts for A2A delegation already exist. `coordination_runs.remote_task_id`/`remote_context_id` (migrations 0055/0056) are stored before any wait, a stored task id suppresses re-send, and the orphan reaper skips such rows (`docs/design/a2a-member-transport.md` §3.3).

**Refine corrections (2026-11-17)**
- "Record the remote task id in local coordination_runs" → already built. → Dropped as a requirement and kept as a regression assertion.
- "until terminal" → the transport's poll ends at `timeoutMs` (default 600 000 ms, `a2a-member-transport.ts:492`) with `outcome-unknown`. Only a restarted live loop re-attaches. An in-process dispatch that timed out is never read again, and cross-project work routinely runs longer than 10 minutes. → The real gap is a read-on-demand refresh for non-terminal rows carrying a remote task id.
- "Show delegated receipts in spur agent trace" → `trace` takes a run id and polls lineage with `--follow` (`apps/cli/src/commands/agent/trace.ts:17-20`), but it doesn't surface `remote_task_id`/`remoteBranch`. → Add the fields and the refresh there.

### Requirements

- [x] R1. Add `A2aMemberTransport.refresh(runId)` for a `coordination_runs` row with `remote_task_id` and a non-terminal receipt (`running` or `outcome-unknown`). It performs exactly one `task get` and applies the §4.2 mapping to the receipt (completed, failed or still running). It never sends. A terminal row is returned unchanged with no network call.
- [x] R2. `spur agent trace <runId>` calls `refresh` once per such row in the lineage before rendering. With `--follow`, it calls `refresh` on each poll. The human and `--json` output include `remoteTaskId`, `remoteContextId`, `remoteBranch`, the A2A state and the member.
- [x] R3. A refresh failure (target down, auth unset) leaves the receipt unchanged and reports the cause on that row. Trace still renders, and with `--json` the row carries `refreshError`.
- [x] R4. Regression check: a second dispatch of the same keyed request sends nothing, and the reaper skips the row.

### Acceptance Criteria

- [x] AC1 — Delegated work is tracked as a receipt until terminal (req: R1, R2, R3, R4)

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

**Change map.**

- `packages/app/src/services/a2a-member-transport.ts` — `refresh(runId)` returning
  `A2aRefreshResult`: it reads the `coordination_runs` row, returns it unchanged when the row is
  terminal or has no `remote_task_id` (no network call), then performs exactly ONE `task get` and
  applies the existing `a2aTaskToReceipt` mapping — `exited` + artifact refs (with `remoteBranch`) on
  completion, `errored` on failure, unchanged on still-working. It never sends. A missing member
  declaration, an unset credential and a throwing remote all return `refreshError` with the row's last
  known status, reusing the existing `errorText` redaction. New dep seam `members()` resolves the row's
  `spec_id` to its declaration; new module-local `remoteBranchOf`/`messageIdsOf` keep the `updateExit`
  column contract.
- `packages/app/src/services/agent-trace-service.ts` — `TraceNode` gains `member`, `remoteTaskId`,
  `remoteContextId`, `remoteBranch`, `remoteState`, `refreshError`; a new `delegated()` step attaches
  them and calls the injected `refresh` once for a delegated, non-terminal row (so `--follow`, which
  re-renders through `trace()`, refreshes on each poll). A throwing refresh becomes that row's
  `refreshError`, never a failed trace.
- `apps/cli/src/commands/agent/trace.ts` — wires the refresh seam to a transport built from the CLI
  context (registry resolver + fleet members) and renders `remote=<member>/<task> <state>
  branch=<branch>` plus `refresh-error=…` in text mode; `--json` carries the fields through the tree.
  `projectCardRefs` is now exported from `agent/shared.ts` so dispatch, doctor and trace share it.
- `docs/design/a2a-member-transport.md` §3.3 — the refresh-on-read note.

**Rationale.** Refresh-on-read adds no daemon and no table, and it honours "never auto-resend" because
the only remote call it makes is a read. The timeout stays at 600 s: raising it would only move the
cliff, while a refresh makes any duration recoverable. Trace is where an operator already looks, so
that is where the receipt is completed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `A2aMemberTransport.refresh(runId)` (`packages/app/src/services/a2a-member-transport.ts:381`) reads the row, returns it unchanged when terminal or without a remote task id (no CLI call), and otherwise performs exactly one `get` applying `a2aTaskToReceipt`: completed → `updateExit('exited')` with artifact refs carrying `remoteBranch`, failed → `errored`, still working → unchanged. It never sends. Tests: `packages/app/tests/services/a2a-refresh.test.ts` (8) — one-get-zero-send, completed, failed, terminal no-op, no-remote-task-id, unknown run, target down, unset credential. |
| R2 | MET | `AgentTraceService.trace` attaches `delegated()` (`agent-trace-service.ts:152`) which calls the injected `refresh` once for a delegated non-terminal row; `--follow` goes through `trace()` per poll, so it refreshes each tick. `TraceNode` carries `member`/`remoteTaskId`/`remoteContextId`/`remoteBranch`/`remoteState`/`refreshError` (`:22-31`), rendered in text as `remote=<member>/<task> <state> branch=<branch>` and in `--json` through the tree (`apps/cli/src/commands/agent/trace.ts:53`). Tests: `agent-trace-service.test.ts` (+5), `apps/cli/tests/commands/agent/trace.test.ts` (+2). |
| R3 | MET | A refresh failure (or a member/credential that cannot resolve, or a throwing refresh) returns the row unchanged with `refreshError`, and `delegated()` catches a throw into the same field, so the trace still renders. Tests: `a2a-refresh.test.ts` target-down and unset-credential; `agent-trace-service.test.ts` error + throwing; CLI test asserts the human line carries `refresh-error=` and `--json` carries `refreshError`. |
| R4 | MET | Regression, not new work: a stored remote task id suppresses re-send (`a2a-member-transport.ts:487-495`), pinned by "a transport error after a task id exists is outcome-unknown, never a re-send", and `CoordinationRunDao.reapOrphanedRunning` filters `remote_task_id IS NULL` (`packages/domain/src/dao/coordination-run-dao.ts:251`), so a delegated row is never reaped. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Delegated work tracked to terminal: transport-level receipt transitions (`a2a-refresh.test.ts`, 8 tests) plus the trace-level render/refresh contract (5+2 tests), all on real DAO rows in a migrated in-memory DB. |
| AC1 | MET | command | `(cd packages/app && bun test tests/services/{a2a-refresh,agent-trace-service,a2a-member-transport}.test.ts)` → 41 pass / 0 fail; `(cd apps/cli && bun test tests/commands/agent/)` → 186 pass / 0 fail; `bun run a2a-two-install-e2e` → 9/9; pipeline light gate PASS (`.spur/run/1396-gate.log`). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T08:59:43.509Z todo → wip (system)
- 2026-11-18T09:07:44.960Z wip → testing (system)
- 2026-11-18T09:07:46.679Z testing → done (system)

