---
schema_version: 1
name: Align RunDao.traceRowById return type with queryFirst SQL-NULL semantics
status: todo
template: issue
created_at: 2026-09-09T01:51:22.437Z
updated_at: "2026-09-09T05:27:09.862Z"

---

## 0815. Align RunDao.traceRowById return type with queryFirst SQL-NULL semantics

### Background

Deferred P4 from task 0809 (verify + re-review findings tables). `RunDao.traceRowById` declares `undefined` as its not-found fallthrough, but the underlying `queryFirst` surfaces a SQL-NULL row as `null`. 0809 R3 fixed the runtime symptom with a `?? undefined` normalization at `packages/app/src/workflow/actions/run-artifact.ts:327`; the type-accuracy retype was out of 0809 scope.

Scope: align the DAO contract (either type the return as including `null`, or normalize to `undefined` inside the DAO and drop the call-site guard). Check other `queryFirst`-backed DAO lookups for the same declared-vs-actual mismatch. Out of scope: changing refusal behavior — the `no authoritative row` refusal contract from 0809 R3 must stay exact.

### Requirements

<!-- R-numbered expectations for the fix. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Durable parking spot for session-review residuals (2026-09-08 A21 batch session). Items 1–3 are host-approved deferrals whose original records live in done task files (0812/0813); this list is the going-forward owner surface. Item 4–6 are process/environment findings.

1. **Deferred: importer timeout `Promise.race` fallback** — `packages/app/src/services/history-service.ts:432` wraps the import promise in a `Promise.race` timeout; A21 (0813) host-approved deferring the native-deadline replacement of this fallback. Direction: revisit once scheduler/history consumers fully run on shared native execution policies; verify no double-kill semantics.
2. **Deferred: ts-db README queue-delivery statement** — ts-libs repo README lacks an explicit at-least-once (no exactly-once) delivery statement for the queue-job lease path (P3b residual from A21 0812/0813). Direction: one-paragraph semantics note in the ts-db README next time that package ships.
3. **Deferred: P4 sweep-reason vocabulary** — user-facing sweep reason string retained deliberately at `apps/server/src/serve.ts:273` (asserted `apps/server/tests/serve.test.ts:1373`); only wrong code comments were fixed in 0813. Direction: rename alongside the next user-visible sweep-surface change, not standalone.
4. **Environment: TS server stale module cache after dependency bumps** — after `bun install` version changes, the LSP keeps serving pre-bump types (this session: 6 false positives on `bounded-child-run*`, all ledger-dispositioned). Direction: restart the TS server (or session) after dependency sync before trusting diagnostics.
5. **Process: cog rejects default merge-commit messages** — every merge needs the manual `chore: merge <branch> into main` rename (precedent `12c913716`, `f2265f4d7`). Direction: lefthook `prepare-commit-msg` rewrite or a documented convention in AGENTS.md.
6. **Process: importer-schema drift after dependency bumps** — `importer-schema-check` fails with recorded-vs-installed version drift in gitignored `.spur/spur.db`; remedy is a manual `spur migrate` per checkout. Direction: fold the migrate into the check's remedy path or a postinstall hook.

### History
