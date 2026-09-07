---
schema_version: 1
name: "Session findings register: spur-check SQLite lock vs running server, ADR status vocabulary drift, Codex scratch leftover"
status: todo
template: issue
created_at: 2026-09-07T18:49:22.806Z
updated_at: "2026-09-07T19:07:41.490Z"

---

## 0801. Session findings register: spur-check SQLite lock vs running server, ADR status vocabulary drift, Codex scratch leftover

### Background

Findings from the 2026-09-07 session that completed Codex's B5 planning leftovers and added the
ADR-000 admission rule. Refined to implementation-ready depth on 2026-09-07 after the operator
killed the wedged server process (PID 80019) and restarted `spur serve`.

#### F1 — SQLITE_BUSY surfaces without holder identity or remediation

During the session, `bun run spur-check` failed at `test-pre-check`
(`rule run --preset recommended-pre-check`) with "SQLite database is busy; another Spur process is
holding the lock" on 4 attempts; a `task.updated` system-event persist also failed with
`database is locked` in the same window. New evidence after the restart: with a **healthy**
`spur serve` (PID 26180) holding `.spur/spur.db`, the same rule step passes ("All 44 rules
passed"). The blocking party was therefore the wedged predecessor process — not server
coexistence — and the real defect is diagnostic: `errorMessage()` maps every `SQLITE_BUSY` to one
generic line that names no database path, no holder, and no remediation, leaving operators unable
to distinguish a stale wedge from a healthy peer.

#### F2 — ADR-109 / ADR-110 statuses are outside the §6.1 template vocabulary

ADR-109 uses `Implemented (F21 task 0788)`; ADR-110 uses `Proposed`. The 99 §6.1 template admits
only `Accepted | Accepted (design) | Superseded by ADR-MMM | Skipped`. Both entries stay in place
under ADR-000's grandfathering; only the status vocabulary aligns, via dated `**Amendment**`
blocks per §6.1 rule 3 — never a rewrite. Mapping: ADR-109 shipped (task 0788 verify PASS) →
`Accepted`; ADR-110 is decided-but-unbuilt → `Accepted (design)` (§6.1 rule 5).

#### F3 — RESOLVED at refinement: Codex scratch leftover removed

`packages/app/tmp-repro/` was removed externally during refinement; verified absent on
2026-09-07 (`ls` → No such file or directory). No AC remains for this finding.

Already resolved in-session (excluded): ADR-112→ADR-000 rename left zero stale references; the 00
preamble, §6.1 admission test, rule 4 carve-out, and AGENTS.md doc-map row were updated and
committed (429fa13c1); B5 planning corpus and doc sync committed by concern (4f55748f6…fb71dc6dc).

### Requirements

- [ ] R1. A `SQLITE_BUSY` failure from any CLI verb exits non-zero with a message that names the
      database path and the next diagnostic step (identify the holder, e.g. `lsof <db>`; stop a
      stale Spur process or `spur serve`), instead of today's bare retry line.
- [ ] R2. ADR-109 and ADR-110 carry §6.1 template statuses via dated amendment blocks, with entry
      numbers, dates, decision text, and every repo-wide cross-reference unchanged.

### Acceptance Criteria

- [ ] AC1. A forced `SQLITE_BUSY` through `errorMessage()` yields a message containing
      `.spur/spur.db` and a remediation step, the CLI exit code stays non-zero, and the new tests
      pass (`cd apps/cli && bun test`).
- [ ] AC2. ADR-109 and ADR-110 carry only §6.1 template statuses after dated amendments;
      `git grep -c 'ADR-109\|ADR-110'` counts are unchanged versus the task's filing commit.
- [ ] AC3. `bun run spur-check` passes end-to-end with `spur serve` running (evidence recorded in
      the task record).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-07T19:07:41.490Z

Refinement decisions (2026-09-07), so the implementer inherits no open choices:

- **D1 — No lock-class change.** A healthy `spur serve` holding `.spur/spur.db` does not block the
  rule step (proven after the server restart: "All 44 rules passed"). The fix is diagnostic only:
  enrich the single `SQLITE_BUSY` mapping at `apps/cli/src/errors.ts:23`. Rejected alternatives:
  narrowing the rule run's lock (unjustified by evidence) and live process inspection at the error
  seam (sandboxed CLIs may lack `lsof`/`ps`; static remediation text is always available).
- **D2 — Status mapping for F2.** ADR-109 → `Accepted` (shipped; task 0788 verify PASS), ADR-110 →
  `Accepted (design)` (decided, unbuilt; §6.1 rule 5). Applied as dated amendment blocks per §6.1
  rule 3; entry numbers, dates, decision text, and cross-references untouched.
- **D3 — F3 closed at refinement.** `packages/app/tmp-repro/` was removed externally; verified
  absent. No implementation step remains.
- **D4 — No feature link.** Cross-cutting findings register (harness gate + authority docs);
  no single feature owns it. The L4 missing-feature_id advisory is accepted deliberately.
- **Dependencies/premises.** No prerequisite tasks. Premises verified and recorded in Root Cause:
  single busy-mapping seam (`apps/cli/src/errors.ts:12-26`), healthy-server coexistence evidence,
  §6.1 status vocabulary, AC2 self-baselines against this task's filing commit.

### Design

F1: enrich the single `SQLITE_BUSY` branch in `errorMessage()` (`apps/cli/src/errors.ts:23`) to
append the Spur db path (`.spur/spur.db`) and a remediation hint ("identify the holder:
`lsof .spur/spur.db`; stop the stale Spur process or `spur serve`, then retry"). Keep it
static-text — no process inspection at the error seam (the CLI may lack lsof permissions under
sandboxes, as observed this session). Regression coverage: a unit test forcing a `SQLITE_BUSY`-coded
error through `errorMessage()` asserting path + remediation presence, plus a CLI-level check that
the exit stays non-zero. Do not narrow lock classes: healthy-server coexistence is proven.

F2: two dated `**Amendment (2026-09-07)**` blocks (one per entry) recording only the status
vocabulary correction — ADR-109 → `Accepted`, ADR-110 → `Accepted (design)` — per §6.1 rules 3
and 8; bump `docs/00_ADR.md` version. No other entry content changes.

### Plan

- [ ] R1. Amend `errorMessage()`'s busy branch in `apps/cli/src/errors.ts` with the db path and
      remediation hint; add the unit test and the exit-code check; run the cli workspace tests.
- [ ] R2. Add the two dated amendment blocks in `docs/00_ADR.md` (ADR-109 → Accepted, ADR-110 →
      Accepted (design)), bump the doc version, and verify repo-wide `ADR-109`/`ADR-110`
      cross-reference counts are unchanged.
- [ ] Final: `bun run spur-check` with `spur serve` running must be green (regression proof for
      the session's gate failure); commit per project convention.

### Root Cause

Verified: `apps/cli/src/errors.ts:12-18` (`isSqliteBusy`) matches `SQLITE_BUSY`, and
`apps/cli/src/errors.ts:23` (`errorMessage`) replaces it with a fixed string containing no db
path, holder, or remediation — this is the single mapping site for every CLI verb. Verified by
observation: a healthy restarted `spur serve` holding `.spur/spur.db` does not block
`rule run --preset recommended-pre-check` (passed 2026-09-07), so no lock-class change is
warranted. Not recoverable: the wedged predecessor's exact lock state (process killed before
inspection) — a healthy-server repro of the original blocking state is therefore unavailable and
not required for the diagnostic fix.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
