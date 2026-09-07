---
schema_version: 1
name: "Session findings register: spur-check SQLite lock vs running server, ADR status vocabulary drift, Codex scratch leftover"
status: todo
template: issue
created_at: 2026-09-07T18:49:22.806Z
updated_at: "2026-09-07T18:52:27.788Z"

---

## 0801. Session findings register: spur-check SQLite lock vs running server, ADR status vocabulary drift, Codex scratch leftover

### Background

Findings from the 2026-09-07 session that completed Codex's B5 planning leftovers and added the
ADR-000 admission rule. Reviewed under /sp:dev-review-session --triage; no finding qualified as a
direct inline fix (each needs either design judgment or another agent's artifact), so all three
land here.

#### F1 — `spur-check` rule step fails while a long-running Spur process holds the database

`bun run spur-check` fails at `test-pre-check` (`rule run --preset recommended-pre-check`) with
"SQLite database is busy; another Spur process is holding the lock" whenever a persistent Spur
process is up. Observed 4 failures this session; one transient success while the same processes
were alive. `lsof .spur/spur.db` shows a `spur serve` listener (PID 80019, localhost:hbci) holding
the db; short-lived CLI writes (`spur feature refresh`) succeed against the same file, so the rule
step appears to need an exclusive/create-class lock the server blocks (hypothesis — confirm the
lock class in code). A documented gate that cannot run next to a running server is friction every
B5-era session will hit.

Fix direction: reproduce with `spur serve` up; either narrow the rule run's lock requirement or
have the gate script detect the held lock and print the remediation (stop serve / which PID). If
the lock is intentional, document the precondition in AGENTS.md "Build & verification".

#### F2 — ADR-109 / ADR-110 statuses are outside the §6.1 template vocabulary

ADR-109 uses `Implemented (F21 task 0788)`; ADR-110 uses `Proposed`. The 99 §6.1 template admits
only `Accepted | Accepted (design) | Superseded by ADR-MMM | Skipped`. Under ADR-000 both entries
stay (feature-scoped but grandfathered); only the status vocabulary needs aligning, via dated
`**Amendment (2026-…)**` blocks per §6.1 rule 3 — never a rewrite.

#### F3 — Codex scratch leftover: `packages/app/tmp-repro/repro.ts`

Untracked temp repro directory left by the out-of-token Codex session; not part of any committed
work. Delete after a one-line content check confirms it is scratch.

Already resolved in-session (excluded): ADR-112→ADR-000 rename left zero stale references; the 00
preamble, §6.1 admission test, rule 4 carve-out, and AGENTS.md doc-map row were updated and
committed (429fa13c1); B5 planning corpus and doc sync committed by concern (4f55748f6…fb71dc6dc).

### Requirements

<!-- R-numbered expectations for the fix. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

- [ ] AC1. With `spur serve` running, `bun run spur-check` either passes the rule step or exits
      with a remediation message naming the lock holder; regression check exists.
- [ ] AC2. ADR-109 and ADR-110 carry only §6.1 template statuses after dated amendments;
      `grep -c 'ADR-109\|ADR-110'` cross-references repo-wide are unchanged.
- [ ] AC3. `packages/app/tmp-repro/` is gone or justified in the task record.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [ ] F1. Reproduce the lock with `spur serve` running; identify the exact lock class the
      recommended-pre-check rule run takes; implement the narrowest fix (narrowed lock, or gate
      script detects the holder and prints remediation); add a regression check.
- [ ] F1. If the lock is confirmed intentional, document the stop-serve precondition in AGENTS.md
      "Build & verification" instead of code.
- [ ] F2. Align ADR-109 and ADR-110 statuses to the §6.1 vocabulary via dated amendment blocks;
      keep entry numbers, dates, and cross-references untouched.
- [ ] F3. Read `packages/app/tmp-repro/repro.ts`; delete the directory if it is scratch.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
