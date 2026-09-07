---
schema_version: 1
name: "Session findings register: spur-check SQLite lock vs running server, ADR status vocabulary drift, Codex scratch leftover"
status: todo
template: issue
created_at: 2026-09-07T18:49:22.806Z
updated_at: "2026-09-07T19:13:42.893Z"

---

## 0801. Session findings register: spur-check SQLite lock vs running server, ADR status vocabulary drift, Codex scratch leftover

### Background

Findings from the 2026-09-07 session that completed Codex's B5 planning leftovers and added the
ADR-000 admission rule. Refined to implementation-ready depth on 2026-09-07; F1 rescoped once more
after fresh contention evidence falsified the first refinement's premise.

#### F1 — `SQLITE_BUSY` contention is real and intermittent, and the error is undiagnosable

Observed this session: 4 gate failures (`rule run --preset recommended-pre-check` → "SQLite
database is busy") while the wedged PID 80019 held the db; after the operator restarted
`spur serve` (healthy PID 26180), the same command passed once ("All 44 rules passed") and then
failed again minutes later with the same busy error — so transient writer windows exist even with
a healthy server plus a second active CLI process (PIDs 26180 + 29203 held `.spur/spur.db` at last
check). A `task.updated` event persist also failed `database is locked` in the same window. Two
defects compound: (a) the failing connection in the rule-run path throws immediately instead of
honoring the 30 s busy timeout the domain openers set, and (b) `errorMessage()`
(`apps/cli/src/errors.ts:23`) maps every `SQLITE_BUSY` to one generic line naming no db path, no
holder, and no remediation.

#### F2 — ADR-109 / ADR-110 statuses are outside the §6.1 template vocabulary

ADR-109 uses `Implemented (F21 task 0788)`; ADR-110 uses `Proposed`. The 99 §6.1 template admits
only `Accepted | Accepted (design) | Superseded by ADR-MMM | Skipped`. Both entries stay in place
under ADR-000's grandfathering; only the status vocabulary aligns, via dated `**Amendment**`
blocks per §6.1 rule 3 — never a rewrite. Mapping: ADR-109 shipped (task 0788 verify PASS) →
`Accepted`; ADR-110 is decided-but-unbuilt → `Accepted (design)` (§6.1 rule 5).

#### F3 — RESOLVED at refinement: Codex scratch leftover removed

`packages/app/tmp-repro/` was removed externally during refinement; verified absent on 2026-09-07.
No AC remains for this finding.

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

- [ ] AC1. With a second writer holding the project db, the rule-run path waits out the busy
      window instead of throwing instantly (integration evidence), and a forced `SQLITE_BUSY`
      through `errorMessage()` still yields a message containing `.spur/spur.db` and a
      remediation step with a non-zero exit; new tests pass (`cd apps/cli && bun test`).
- [ ] AC2. ADR-109 and ADR-110 carry only §6.1 template statuses after dated amendments;
      `git grep -c 'ADR-109\|ADR-110'` counts are unchanged versus the task's filing commit.
- [ ] AC3. With `spur serve` running, `bun run spur-check` passes three consecutive runs
      (evidence recorded in the task record).

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

#### Q&A entry — 2026-09-07T19:13:12.698Z

Refinement decisions (2026-09-07), so the implementer inherits no open choices:

- **D1 — Fix the un-pragma'd connection, not lock classes (revised).** First refinement assumed
  "healthy server never blocks" from one passing probe; a same-day failure against the healthy
  restarted server falsified it. Domain openers set `PRAGMA busy_timeout = 30000`
  (`packages/domain/src/db.ts:19,38,62`); the rule-run path bypasses them. Rejected: changing
  lock classes or serializing the gate against the server (heavier than the defect).
- **D2 — Status mapping for F2.** ADR-109 → `Accepted` (shipped; task 0788 verify PASS), ADR-110 →
  `Accepted (design)` (decided, unbuilt; §6.1 rule 5). Dated amendment blocks per §6.1 rule 3;
  entry numbers, dates, decision text, and cross-references untouched.
- **D3 — F3 closed at refinement.** `packages/app/tmp-repro/` removed externally; verified absent.
- **D4 — No feature link.** Cross-cutting findings register (harness gate + authority docs); the
  L4 missing-feature_id advisory is accepted deliberately.
- **Dependencies/premises.** No prerequisite tasks. Premises verified and recorded in Root Cause:
  busy-timeout pragma exists but is bypassed in the rule path, single static message seam
  (`apps/cli/src/errors.ts:12-26`), prior SQLITE_BUSY art at `migrations.ts:1240`, AC2
  self-baselines against this task's filing commit.

### Design

F1, two prongs:
(a) Contention — trace the rule-run db path (`apps/cli/src/commands/rule.ts:34`, `RuleService`)
    to the connection that throws SQLITE_BUSY without waiting, and route it through the
    busy_timeout-honoring openers in `packages/domain/src/db.ts` (or set the pragma on that
    connection the same way). 30 s covers server writer windows; no lock-class changes.
(b) Diagnostics — enrich the single busy branch in `errorMessage()` (`apps/cli/src/errors.ts:23`)
    with the db path (`.spur/spur.db`) and a remediation hint ("identify the holder:
    `lsof .spur/spur.db`; stop the stale Spur process or `spur serve`, then retry"). Static text
    only — no process inspection at the error seam (sandboxed CLIs may lack lsof/ps).
Regression: a unit test forcing a SQLITE_BUSY-coded error through `errorMessage()` asserting
path + remediation; a busy-db integration check proving the rule path waits instead of failing
instantly (temporary second writer on an in-memory/temp db).

F2: two dated `**Amendment (2026-09-07)**` blocks (one per entry) recording only the status
vocabulary correction — ADR-109 → `Accepted`, ADR-110 → `Accepted (design)` — per §6.1 rules 3
and 8; bump `docs/00_ADR.md` version. No other entry content changes.

### Plan

- [ ] R1a. Trace `RuleService`'s db connection from `apps/cli/src/commands/rule.ts:34`; make it
      honor `SQLITE_BUSY_TIMEOUT_MS` exactly as `packages/domain/src/db.ts` does; add the
      busy-wait integration check.
- [ ] R1b. Amend the busy branch of `errorMessage()` in `apps/cli/src/errors.ts` with the db path
      and remediation hint; add the unit test and exit-code check; run cli workspace tests.
- [ ] R2. Add the two dated amendment blocks in `docs/00_ADR.md` (ADR-109 → Accepted, ADR-110 →
      Accepted (design)), bump the doc version, and verify repo-wide `ADR-109`/`ADR-110`
      cross-reference counts are unchanged.
- [ ] Final: with `spur serve` running, `bun run spur-check` green on three consecutive runs
      (contention regression proof); commit per project convention.

### Root Cause

Verified by code and observation:

- The domain db openers DO set `PRAGMA busy_timeout = 30000`
  (`packages/domain/src/db.ts:19,38,62`), explicitly because the upstream BunSqliteAdapter
  defaults omit it — yet `rule run` still throws SQLITE_BUSY immediately, so the failing
  connection bypasses those openers or opens its own adapter. First implementation step is
  tracing `RuleService`'s db path (`apps/cli/src/commands/rule.ts:34` → `RuleService(context)`)
  to the un-pragma'd connection.
- Prior art for this failure class exists: `packages/domain/src/migrations.ts:1240` comments on
  read-only commands failing SQLITE_BUSY against journal state.
- The message mapping seam is single and static: `apps/cli/src/errors.ts:12-26`.
- Not recoverable: the wedged predecessor's exact lock state (killed before inspection). Not
  needed: contention reproduces with the live server + a second CLI process.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
