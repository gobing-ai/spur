---
schema_version: 1
name: "Session findings register: spur-check SQLite lock vs running server, ADR status vocabulary drift, Codex scratch leftover"
status: done
template: issue
created_at: 2026-09-07T18:49:22.806Z
updated_at: "2026-09-08T01:50:02.961Z"

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

- [x] R1. A `SQLITE_BUSY` failure from any CLI verb exits non-zero with a message that names the
      database path and the next diagnostic step (identify the holder, e.g. `lsof <db>`; stop a
      stale Spur process or `spur serve`), instead of today's bare retry line.
- [x] R2. ADR-109 and ADR-110 carry §6.1 template statuses via dated amendment blocks, with entry
      numbers, dates, decision text, and every repo-wide cross-reference unchanged.

### Acceptance Criteria

- [x] AC1. With a second writer holding the project db, the rule-run path waits out the busy
      window instead of throwing instantly (integration evidence), and a forced `SQLITE_BUSY`
      through `errorMessage()` still yields a message containing `.spur/spur.db` and a
      remediation step with a non-zero exit; new tests pass (`cd apps/cli && bun test`).
- [x] AC2. ADR-109 and ADR-110 carry only §6.1 template statuses after dated amendments;
      `git grep -c 'ADR-109\|ADR-110'` counts are unchanged versus the task's filing commit.
- [x] AC3. With `spur serve` running, `bun run spur-check` passes three consecutive runs
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

- [x] R1a. Trace `RuleService`'s db connection from `apps/cli/src/commands/rule.ts:34`; make it
      honor `SQLITE_BUSY_TIMEOUT_MS` exactly as `packages/domain/src/db.ts` does; add the
      busy-wait integration check.
- [x] R1b. Amend the busy branch of `errorMessage()` in `apps/cli/src/errors.ts` with the db path
      and remediation hint; add the unit test and exit-code check; run cli workspace tests.
- [x] R2. Add the two dated amendment blocks in `docs/00_ADR.md` (ADR-109 → Accepted, ADR-110 →
      Accepted (design)), bump the doc version, and verify repo-wide `ADR-109`/`ADR-110`
      cross-reference counts are unchanged.
- [x] Final: with `spur serve` running, `bun run spur-check` green on three consecutive runs
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

#### F1 — SQLITE_BUSY contention (R1a, R1b)

Trace conclusion: the rule-run path's db connection already honors
`SQLITE_BUSY_TIMEOUT_MS` via the existing chain
`apps/cli/src/commands/rule.ts:34` → `new RuleService(context)`
→ `context.getDb()` → `createMigratedDbAdapter()`
→ `createMigratedDb({ url })` (which `exec`s
`PRAGMA busy_timeout = 30000` explicitly in
`packages/domain/src/db.ts:38`, mirroring the runtime factory at
`packages/domain/src/db.ts:62`). The observed `SQLITE_BUSY` failures
during refinement were caused by transient writer windows (e.g. a healthy
`spur serve` plus a second CLI process); the connection honors the 30s
timeout and waits. No code change to the connection wiring was needed —
the regression is captured by a new busy-wait integration check
(`apps/cli/tests/commands/rule.test.ts:361-450`) that proves the
rule-run path waits instead of throwing.

Diagnostics change: the single busy branch in `errorMessage()`
(`apps/cli/src/errors.ts:21-44`) is enriched with the db path
(`.spur/spur.db`) and a static remediation hint (`identify the holder:
lsof .spur/spur.db; stop the stale Spur process or spur serve, then
retry`). No process inspection at the error seam — sandboxed CLIs may
lack `lsof`/`ps`. The constants `SQLITE_BUSY_DB_PATH` and
`SQLITE_BUSY_REMEDIATION` (apps/cli/src/errors.ts:20-37) are exported
as a frozen `SQLITE_BUSY_MESSAGE_CONSTANTS` object for the test seam.

| File:line | Change |
| --- | --- |
| `apps/cli/src/errors.ts:20-49` | Enrich SQLITE_BUSY branch with db path + remediation; export `SQLITE_BUSY_MESSAGE_CONSTANTS`. |
| `apps/cli/tests/errors.test.ts` (whole file) | New tests: SQLITE_BUSY → path + remediation (`describe('errorMessage')`, `describe('SQLITE_BUSY_MESSAGE_CONSTANTS')`); CLI-dispatch exit-code check via stub db throwing SQLITE_BUSY (`describe('SQLITE_BUSY exit-code propagation through CLI dispatch')`). |
| `apps/cli/tests/commands/rule.test.ts:361-450` | New busy-wait integration check: child process holds a 4s BEGIN IMMEDIATE write lock on the project db; the parent's `rule run` must wait, succeed (exit 0), and complete in [2s, 30s). |

#### F2 — ADR-109 / ADR-110 status vocabulary (R2)

Two dated `**Amendment (2026-09-07)**` blocks added — one per entry —
recording only the §6.1 status-vocabulary correction. Per §6.1 rule 3
only the status vocabulary aligns; entry number, date, decision text,
and every repo-wide cross-reference are unchanged. Doc version bumped
1.41.0 → 1.42.0.

| File:line | Change |
| --- | --- |
| `docs/00_ADR.md:2318` | ADR-109 status: `Implemented (F21 task 0788)` → `Accepted`. |
| `docs/00_ADR.md:2323` | New amendment block for ADR-109 (per §6.1 rule 5: shipped, task 0788 verify PASS). |
| `docs/00_ADR.md:2325,2327` | ADR-110 status: `Proposed` → `Accepted (design)`. |
| `docs/00_ADR.md:2325,2332` | New amendment block for ADR-110 (per §6.1 rule 5: decided, unbuilt). |
| `docs/00_ADR.md:5` | Doc version: `1.41.0` → `1.42.0`. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/errors.ts:37-45` `errorMessage()` busy branch names `SQLITE_BUSY_DB_PATH` `.spur/spur.db` (`apps/cli/src/errors.ts:25`) and `SQLITE_BUSY_REMEDIATION` (`apps/cli/src/errors.ts:33-34`); frozen `SQLITE_BUSY_MESSAGE_CONSTANTS` at `apps/cli/src/errors.ts:48-51`. Dispatched for any CLI verb via `apps/cli/src/index.ts:73` (config load) and `apps/cli/src/index.ts:198` (command catch, non-zero). Live this run: busy path waited 30.26s then printed the diagnostic and exited 1; quiet-window `rule run --json` exited 0 in 4.02s. Tests: `cd apps/cli && bun test tests/errors.test.ts` → 17 pass, 0 fail; busy-wait `apps/cli/tests/commands/rule.test.ts:378-453` 4059.49ms. |
| R2 | MET | ADR-109 status `Accepted` at `docs/00_ADR.md:2318`; ADR-110 status `Accepted (design)` at `docs/00_ADR.md:2327`. Dated `**Amendment (2026-09-07)**` blocks at `docs/00_ADR.md:2323` and `docs/00_ADR.md:2332`. Doc version `1.42.0` at `docs/00_ADR.md:5`. Implementation commit `de1ede766` touches only `docs/00_ADR.md`; `git grep -c 'ADR-109\|ADR-110'` on that file is 3 at parent and 3 at `de1ede766`. §6.1 vocabulary at `docs/99_PROJECT_CONSTITUTION.md:247`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1. | MET | test | Busy-wait `apps/cli/tests/commands/rule.test.ts:378-453` this run: 1 pass, 4059.49ms, exit 0, elapsed in [2s, 30s). Diagnostic + dispatch `apps/cli/tests/errors.test.ts:45-69,152-186` this run: message contains `.spur/spur.db` and remediation; `exitCode !== 0`. Full `cd apps/cli && bun test tests/errors.test.ts` → 17 pass, 0 fail. Domain openers `packages/domain/src/db.ts:19,38,62` `PRAGMA busy_timeout = 30000`. |
| AC2. | MET | command | `git show de1ede766 -- docs/00_ADR.md` is status vocabulary + two dated amendments + version bump only. `git grep -c 'ADR-109\|ADR-110' de1ede766 -- docs/00_ADR.md` = 3 = parent. vs filing `54000b296`, `docs/00_ADR.md` stays 3. Task-file count 5→23 is self-reference in Solution/Testing/Review. Later sibling tasks 0795/0802 are outside 0801's diff. |
| AC3. | MET | command | Serve PID 20104 up (`http://[::1]:3000/` → 200). Three consecutive `bun run spur-check` PASS with that serve holding `.spur/spur.db` (`.spur/run/0801-test-gate.log` quiet runs #1–#3; `.spur/run/0801-test-gate.status` = PASS). Run 1 lines 1315-1681: All 44 rules (1349), 7722 pass 0 fail in 139.92s (1669-1672), All 2 rules (1680). Run 2 lines 1682-2048: All 44 (1716), 7722 pass 0 fail in 138.89s (2036-2039), All 2 (2047). Run 3 lines 2049-2415: All 44 (2083), 7722 pass 0 fail in 139.80s (2403-2406), All 2 (2414). `all_three_quiet_pass` at line 2416. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Scope:** task WBS 0801 diff vs filing commit `bc05da17c` (5 files: 4 non-corpus + 1 corpus).
**Dimensions:** functional (R1, R2), SECUA (security, efficiency, correctness, usability, architecture), depth.
**Verdict:** **PASS** — implementation satisfies both requirements and all three acceptance criteria with fresh, file:line evidence below. No P1–P3 findings; two P4 (advisory) observations recorded for future-task consideration only.

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| **R1** (SQLITE_BUSY message names db path + remediation, non-zero exit) | **MET** | `apps/cli/src/errors.ts:21-44` — `errorMessage()` returns single-line message containing `SQLITE_BUSY_DB_PATH` (`.spur/spur.db`) and `SQLITE_BUSY_REMEDIATION` (`identify the holder: lsof .spur/spur.db; stop the stale Spur process or spur serve, then retry`). Constants exported as frozen `SQLITE_BUSY_MESSAGE_CONSTANTS` (`apps/cli/src/errors.ts:47-50`) for the test seam. Unit tests at `apps/cli/tests/errors.test.ts:33-76` cover both `Error` and string SQLITE_BUSY inputs. CLI-dispatch exit-code check at `apps/cli/tests/errors.test.ts:114-167` asserts `exitCode !== 0` and stderr contains both constants. All 17 errors.test.ts cases passed (`17 pass, 0 fail`). |
| **R2** (ADR-109/ADR-110 §6.1 statuses via dated amendments, xrefs unchanged) | **MET** | ADR-109 status `Accepted` at `docs/00_ADR.md:2318`; ADR-110 status `Accepted (design)` at `docs/00_ADR.md:2329`. Dated `**Amendment (2026-09-07)**` blocks at `docs/00_ADR.md:2323-2325` (ADR-109) and `docs/00_ADR.md:2334-2336` (ADR-110). Doc version bumped `1.41.0` → `1.42.0` at `docs/00_ADR.md:5`. `git grep -c 'ADR-109\\ | ADR-110'` per-file counts vs `bc05da17c`: every file unchanged except the task file itself (12 → 17, expected per §6.1 rule 3 — Solution section adds ADR cross-references). |

#### Acceptance criteria mapping

| AC | Status | Evidence |
| --- | --- | --- |
| **AC1** (busy-wait integration + diagnostic message + exit code + tests green) | **MET** | Busy-wait integration check at `apps/cli/tests/commands/rule.test.ts:361-453`: child holds 4 s BEGIN IMMEDIATE write lock; parent's `rule run --json` must wait, succeed (exit 0), and complete in [2 s, 30 s). Locally re-run: `1 pass, 4052.00ms` — within bounds, exit 0, no instant SQLITE_BUSY throw. errors.test.ts CLI-dispatch check confirms non-zero exit + path/remediation in stderr (13.78 ms). |
| **AC2** (template statuses + amendments + unchanged xref counts) | **MET** | See R2 evidence above. Per-file `git grep -c 'ADR-109\\ | ADR-110'` vs `bc05da17c` identical for all 19 non-task files; only task file delta (12 → 17). |
| **AC3** (3 consecutive `bun run spur-check` green with `spur serve` running) | **MET** | `.spur/run/0801-test-gate.log` records 3 `--- AC3 evidence run #N ---` sections (lines 1, 366, 731). Each completes the full spur-check pipeline (link-check → transition-shim-check → … → test-pre-check → test → test-post-check) green: `All 44 rules passed` (pre-check) and `All 2 rules passed` (post-check); `7701 pass, 0 fail` per `bun test`. `.spur/run/0801-serve.pid` records PID 18536; `ps -p 18536` confirms `bun apps/cli/src/index.ts serve` running. `.spur/run/0801-test-gate.status` = `PASS`. |

#### SECUA

| Dimension | Assessment | Evidence |
| --- | --- | --- |
| **Security** | Clean. The remediation hint is static text only — no `lsof`/`ps` shell-out at the error seam (sandboxed CLIs may lack them, per Q&A D1). `SQLITE_BUSY_MESSAGE_CONSTANTS` is `Object.freeze`d (`apps/cli/src/errors.ts:47-50`). No new attack surface. |
| **Efficiency** | Clean. The busy-wait path uses the existing `PRAGMA busy_timeout = 30000` (`packages/domain/src/db.ts:19,38,62`); no new locks, no new contention. The diagnostic enrichment is a string concat at error time — no measurable cost on the happy path. Test uses a real 4 s timer (fake timers cannot drive platform-level busy waits — comment at `apps/cli/tests/commands/rule.test.ts:361-368`). |
| **Correctness** | Clean. Both `Error.code === 'SQLITE_BUSY'` and `/\bSQLITE_BUSY\b/i.test(message)` are recognized (`apps/cli/src/errors.ts:11-15`). The single-line format assertion (`apps/cli/tests/errors.test.ts:46`) prevents multi-line regressions. CLI-dispatch test (`apps/cli/tests/errors.test.ts:114-167`) verifies the diagnostic reaches stderr — not just the in-memory return value — closing the real-user-path loop. |
| **Usability** | Strong. The message reads as one sentence with the db path, the holder-identification command, and both recovery paths (stale process or `spur serve`). Constants are exported so downstream test fixtures stay aligned with the production string. Coverage: `apps/cli/src/errors.ts` at 100% functions / 100% lines per the spur-check coverage report. |
| **Architecture** | Sound. The fix is surgical: a single `if (isSqliteBusy(error))` branch in `errorMessage()` plus an exported-constants test seam. No new modules, no new dependency direction. The amendment blocks follow the §6.1 pattern (dated, minimal, decision-delta only — no mechanism leakage). |

#### Architecture Depth

The change turns a shallow, opaque error mapping (`SQLITE_BUSY: database is locked`) into a
testable, contract-bound diagnostic. Three depth signals:

1. **Test seam via exported constants.** `SQLITE_BUSY_MESSAGE_CONSTANTS` (`apps/cli/src/errors.ts:47-50`)
   turns the message into a public contract: tests assert on the constants, not on string equality,
   so a future rewrite of the user-facing wording does not silently break the test contract.
2. **Real concurrency, not fake timers.** The busy-wait integration check (`apps/cli/tests/commands/rule.test.ts:361-453`)
   spawns a child process holding a real BEGIN IMMEDIATE write lock for 4 s and times the parent.
   This catches regressions a unit test with `vi.useFakeTimers()` would miss — the platform-level
   busy wait is driven by the SQLite engine, not by JS timers.
3. **Constitutional conformance of amendments.** Both amendment blocks conform to `99 §6.1` rules
   3 (append-only), 5 (`Accepted (design)` semantics), and 8 (decision delta + one-line reason, no
   mechanism leakage). The amendment for ADR-109 is slightly longer because it names the previous
   vocabulary value (`Implemented (F21 task 0788)`) to make the delta unambiguous; the ADR-110
   amendment is the minimal form.

#### Findings (ranked)

| # | Severity | Dimension | Finding | Location |
| --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | usability | The remediation string duplicates the db path literal (`.spur/spur.db` appears twice: once as `SQLITE_BUSY_DB_PATH` and once inside `SQLITE_BUSY_REMEDIATION`). If the canonical path ever changes, the inner literal must be edited in two places. Cosmetic only — consider interpolating `SQLITE_BUSY_DB_PATH` into `SQLITE_BUSY_REMEDIATION` in a future cleanup. | `apps/cli/src/errors.ts:20-37` |
| 2 | P4 (advisory) | architecture | The busy-wait integration check has a duplicated leading comment block (two paragraphs describing the same BEGIN IMMEDIATE + setTimeout + COMMIT holding pattern at the test's top). Reader-friendly now but invites drift on the next edit. Future cleanup could fold both paragraphs into one. | `apps/cli/tests/commands/rule.test.ts:361-388` |

No P1 (blocker), P2 (major), or P3 (minor) findings. The two P4 items are non-actionable for this
task; they would be appropriate as a one-line follow-up if the user wants to deepen the module
later.

#### Residual Risk

Low. The diagnostic enrichment is additive (a richer SQLITE_BUSY message is strictly better than
today's bare line, with no regression risk for the happy path). The amendment blocks are
non-destructive (entry number, date, decision text, and cross-references all preserved per §6.1
rule 3). The busy-wait test exercises a real concurrency primitive, so the green CI signal is
trustworthy. Re-run of the AC1 busy-wait test on this working tree: `1 pass, 4052.00ms` (in
[2 s, 30 s]) — exit 0, no instant throw.

**Next:** proceed to `spur task done 0801 --phase commit` (or the equivalent gate in the
pipeline's phase-7 → phase-8 transition); no follow-up work required.

### References

- Filing commit: `bc05da17c docs(tasks): update task status after implementation`
- Test gate evidence: `.spur/run/0801-test-gate.log` (3 AC3 evidence runs; `PASS`)
- Server PID during AC3: `.spur/run/0801-serve.pid` (18536)
- §6.1 vocabulary source: `docs/99_PROJECT_CONSTITUTION.md:240-282`

### History

- 2026-09-07T23:25:34.808Z todo → wip (system)
- 2026-09-07T23:58:19.397Z wip → testing (system)
- 2026-09-08T00:00:10.481Z testing → done (system)
