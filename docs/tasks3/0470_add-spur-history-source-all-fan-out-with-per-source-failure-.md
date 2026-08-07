---
template: feature-impl
schema_version: 1
name: "Add spur history --source all fan-out with per-source failure isolation and a spur history daily command"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0465", "0474"]
ac_numbering: task-local
created_at: "2026-08-07T05:02:01.341Z"
updated_at: "2026-08-07T20:52:48.073Z"
---

## 0470. Add spur history --source all fan-out with per-source failure isolation and a spur history daily command

### Background
Graduated from the consumption-surface investigation (feature E1). **Depends on tasks 0465 and 0474.**
(Earlier drafts of this Background cited 0468 — that was wrong; 0468 was the 0466 fix-up ticket and is
done. The `dependencies[]` edges have always been 0465 and 0474.)

Task 0464 ruled that **fan-out belongs in `spur history`, not in whatever schedules it** — placing
isolation in the CLI means it holds no matter what invokes the command: launchd, a workflow, or a
human. `--source` currently takes exactly one value defaulting to `pi`
(`apps/cli/src/commands/history.ts:12`), so six agents means six invocations with no shared failure
policy.

**Two behaviors measured during the investigation that this ticket must fix:**

- **An absent source is silently successful.** `spur history import --source opencode --json` returns
  `files=0 lines=0 imported=0` and **exit 0** — bit-identical to a healthy no-op. Under a nightly
  loop, an agent whose history path changed would report success forever while importing nothing.
  `empty` must therefore be its own coverage state, distinct from `ok`.
- **Exit codes cannot express partial success.** Import returns 1 for *any* parse or validation error
  (`apps/cli/src/commands/history.ts:27`). Under fan-out that makes one noisy source indistinguishable
  from six dead ones, so the loop's health signal is useless.

**"Yesterday's sessions" is not a date window.** Task 0457 verified that incremental mode resumes
correctly from checkpoints, so the nightly import takes **no date argument** — it imports whatever
arrived since the last checkpoint. That is both the correct semantics and self-healing: a missed
night is picked up the next night with no gap and no double-count. Only the analyze step takes a
window, and only to scope the report.

**Ordering constraint (task 0464 § R7):** the realpath-normalization fix in task 0465 must land first.
Its path-identity defect produces duplicate checkpoint rows per physical file, and under `--source
all` that hits every source on every run, since each agent directory under `$HOME` is a symlink.

Full spec: task 0464 `### Design` § R7.
### Requirements
- R1 — Accept `--source all` on `spur history import`, iterating the known sources, so six agents no longer require six invocations.
- R2 — Isolate per-source failure: a throwing source is caught, recorded with its error, and the loop continues; one source can never abort another. Each source commits its own transaction so a mid-import failure leaves that source's checkpoint intact for the next run without rolling back its siblings.
- R3 — Replace the binary exit contract with 0 for all sources ok, 2 for partial success where at least one source succeeded and at least one failed, and 1 only when every source failed.
- R4 — Report a source that discovered zero files as an `empty` coverage state distinct from `ok`, and treat a source that was non-empty on the previous run and is empty now as a warning rather than a success.
- R5 — Bound each source with its own timeout so one pathological corpus cannot hang the whole run past its window.
- R6 — Add a `spur history daily` command performing import-all, analyze, artifact write, and report-retention prune in one run-once invocation suitable for an external scheduler.
- R7 — Take no date argument on the nightly import path, relying on checkpoint resume, so a missed run self-heals on the next run without gaps or double-counting.
- R8 — Emit a per-source coverage summary into the analyze artifact so the report can show which sources contributed and which failed or were empty.
### Acceptance Criteria
```gherkin
Feature: 0470 multi-source fan-out isolates failure

  Scenario: R2 — one failing source does not abort the others
    Given six configured sources where one raises during import
    When import runs with --source all
    Then the remaining five sources complete and persist their records
    And the failing source is recorded with its error in the coverage summary

  Scenario: R3 — partial success is distinguishable from total failure
    Given a run where at least one source succeeded and at least one failed
    When the command exits
    Then the exit code is 2
    And a run where every source failed exits 1
    And a run where every source succeeded exits 0

  Scenario: R4 — an empty source is not silently successful
    Given a source whose history directory contains no files
    When import runs with --source all
    Then that source is reported with an empty status rather than ok
    And a source that was non-empty on the previous run and is now empty is reported as a warning

  Scenario: R7 — a missed night self-heals
    Given the nightly run did not execute for two days
    When the next nightly run executes
    Then every record appended during the gap is imported exactly once
    And no duplicate ledger rows are produced

Scenario: R1 — one invocation covers every source
    Given six configured sources
    When import runs with --source all
    Then every configured source is attempted in a single invocation

  Scenario: R5 — a pathological source cannot hang the run
    Given one source whose import exceeds its configured timeout
    When import runs with --source all
    Then that source is abandoned at its deadline and recorded as failed
    And the remaining sources still complete

  Scenario: R6 — the daily command is one run-once invocation
    Given an external scheduler invoking the daily command
    When it runs
    Then import-all, analyze, artifact write, and retention prune all occur in that single process
    And the process exits rather than staying resident

  Scenario: R8 — coverage travels into the artifact
    Given a fan-out run where sources succeeded, failed, and were empty
    When the analyze artifact is written
    Then it carries a per-source coverage entry for each of those outcomes
```
### Q&A
**Closed during implement-ready refinement (2026-08-07):**

- *Background said "depends on 0465 and 0468" — which is right?* **0465 and 0474.** The
  `dependencies[]` edges were always those; the prose was stale (0468 was the 0466 fix-up ticket, now
  done). Corrected, because the artifact contract this task fills comes from 0474.
- *Does a source with parse errors count as `failed`?* **No — only a throw or a timeout does.** Parse
  and validation errors become counts on the `CoverageEntry`. This deliberately gives up today's
  "any parse error ⇒ exit 1" behavior (`apps/cli/src/commands/history.ts:27`), which under fan-out
  cannot distinguish one noisy source from six dead ones. Compensating signals: the artifact's error
  counts and 0471's `history.*` events. **Reopen condition:** a caller found depending on the old
  signal ⇒ add `--strict-errors` then, not speculatively now.
- *Does single-source import keep the old exit contract?* **No — one contract.** Single-source is the
  n=1 case of the same rules. Two exit paths would mean the nightly loop and a manual run disagree
  about what "healthy" means.
- *How is "non-empty yesterday, empty today" detected without chaining artifacts?* Read
  `history_import_checkpoint`: rows exist for the source but zero files discovered now ⇒ warning.
  Checkpoints already persist and are indexed; deriving it from the previous artifact would make the
  warning depend on report retention, so a 91-day-old gap would silently stop warning.
- *Should the fan-out run sources in parallel?* **No.** Ten sequential imports against one SQLite
  file. Concurrency buys nothing here and costs write contention plus muddier failure attribution —
  and clean per-source attribution is the entire point of the ticket.
- *Why does `daily` exist instead of a workflow?* 0464 § R6: the action registry has no `foreach` or
  `parallel`, so fan-out in YAML would be six hand-enumerated `shell` steps with worse error
  isolation. One verb, one plist, nothing to drift.

**Deferred, with the condition that reopens each:**

- `--strict-errors` — see above.
- Per-source configuration (custom roots, per-source timeouts) — `SOURCES` plus one global timeout
  covers today. Reopen when a source is observed needing a materially different budget.

**Ordering.** **0465 must land first** (0464 § R7) — realpath normalization, or `--source all`
multiplies the duplicate-checkpoint defect across every source on every run. **0474 must land first**
for the artifact and its `CoverageEntry`. This task blocks 0471, which schedules `daily` and reports
on its exit code.
### Design
**WHAT.** Teach `spur history import` to fan out across every known source with per-source isolation,
replace the binary exit contract with 0/1/2, add `empty` as a first-class coverage state, and add one
run-once `spur history daily` that an external scheduler can invoke.

**WHY.** Isolation lives in the CLI so it holds no matter what invokes it — launchd, a workflow, or a
human (0464 § R7). The two defects it must fix were measured, not assumed: an absent source is
bit-identical to a healthy no-op (`files=0 lines=0 imported=0`, exit 0), and one noisy source is
indistinguishable from six dead ones under today's exit contract.

**WHERE — frozen file targets.**

| File | Change |
| --- | --- |
| `packages/app/src/services/history-service.ts:29-40` | `SOURCES` is already the ten-source list; it becomes the fan-out iteration order. Add `importAll()` and `daily()`. |
| `packages/app/src/services/history-service.ts:56-70` | `import()` unchanged — `importAll` calls it per source inside the isolation wrapper. Do not fold the loop into it. |
| `apps/cli/src/commands/history.ts:10-29` | Accept `--source all`; add `--source-timeout <ms>`; replace the `:27` exit-code line with the 0/1/2 contract. |
| `apps/cli/src/commands/history.ts` | New `daily` subcommand. |
| `packages/domain/src/analytics/artifact.ts` | `CoverageEntry` (0474's type) gains nothing new — 0474 already ships `status: 'ok' \| 'failed' \| 'empty'`. Populate it here. |
| `docs/04_DESIGN.md` §`spur history` | Same-commit surface update (T3), including the exit-code table. |

**Frozen names.**

- `SourceStatus = 'ok' | 'failed' | 'empty'` — the coverage state (0474 already declares it on
  `CoverageEntry`; do not introduce a parallel enum).
- `importAll(opts): Promise<FanOutResult>` and `FanOutResult { entries: CoverageEntry[]; exitCode: 0 | 1 | 2 }`.
- `daily(opts): Promise<DailyResult>` — import-all → analyze → artifact → prune, in one process.
- CLI: `--source all`, `--source-timeout <ms>` (default **600000**, ten minutes),
  `spur history daily [--since <iso>] [--json]`.
- `REPORT_RETENTION_DAYS = 90` (0464 § R2).

**Exit-code contract — the definition that R3 turns on.** `0` all sources `ok`/`empty`; `2` at least
one `failed` **and** at least one not; `1` every source `failed`.

**A source is `failed` only if it threw or hit its timeout.** Parse and validation errors do **not**
make a source `failed` — they are recorded as counts on its `CoverageEntry`. This is a deliberate,
visible change to the existing single-source behavior at `apps/cli/src/commands/history.ts:27`, where
any parse error sets exit 1: **that signal is being given up on purpose**, because under fan-out it
cannot distinguish a noisy source from a dead one, which is exactly the failure 0464 § R7 names. The
compensating signals are `coverage[].parseErrors` / `validationErrors` in the artifact and 0471's
`history.*` events. **Reopen condition:** if a caller is found depending on "exit 1 means dirty
input", add an explicit `--strict-errors` flag then — not now, speculatively.

Single-source import is the degenerate n=1 case of the same contract: one source, same rules. Do not
implement two exit paths.

**Isolation contract (R2) — four properties, all testable.**

1. Each source runs in its own `try`; a throw is caught, recorded as `status: 'failed'` with its
   error text, and the loop continues.
2. Each source commits its own transaction. A mid-import failure leaves that source's checkpoint
   where it was and re-resumes next run; siblings are never rolled back.
3. A timeout abandons that source at its deadline and records it `failed`; the rest still complete.
4. One source can never abort another — the assertion is "five of six completed and persisted", not
   "no exception escaped".

**`empty` and the was-non-empty warning (R4) — resolved without artifact chaining.** A source that
discovers zero files is `empty`, never `ok`. For "non-empty yesterday, empty today", read
`history_import_checkpoint`: **checkpoint rows exist for that source but zero files were discovered
now** ⇒ emit a `warnings[]` entry. That is one indexed lookup against state that already persists —
do not chain to the previous artifact to derive it, which would make the warning depend on report
retention.

**Nightly import takes no date argument (R7).** `daily` runs `--mode incremental` with no window.
0457 verified append-only resume, checkpoint advance, and that dry-run does not advance it. Self-heals
by construction: a missed night is picked up the next night, no gap, no double-count. Only the
**analyze** step takes `--since`, and only to scope the report — never the import.

**`spur history daily` is run-once.** Import-all → analyze → write artifact → prune
`.spur/reports/history/` beyond `REPORT_RETENTION_DAYS`. It exits; it never stays resident. Anything
that needs a resident process belongs to the scheduler, which is 0471's launchd agent and explicitly
not Spur's embedded scheduler (0464 § R6 — it cannot express a daily schedule and silently degrades
to a 60-second interval).

**Anti-patterns:**

- Do **not** treat a zero-file source as success. That is the exact defect this ticket exists to fix.
- Do **not** let one source's failure roll back or abort another's transaction.
- Do **not** wire Spur's embedded scheduler. It cannot express `0 7 * * *` and falls back to a
  60-second loop with only a warn log — worse than no scheduler.
- Do **not** give `daily` a date window for the import step. The checkpoint is the window.
- Do **not** add a seventh source-selection axis or per-source config. `SOURCES` is the list.
- Do **not** parallelize the fan-out. Ten sequential imports against one SQLite file; concurrency buys
  nothing and costs write contention and unclear failure attribution.

**Handoff.**

- **Assumes from dep 0465 (todo — must land first):** `source_file` is realpath-normalized, so one
  physical file has one checkpoint row. Without it, `--source all` multiplies the duplicate-checkpoint
  defect across every source on every run, since each agent dir under `$HOME` is a symlink. **Do not
  start this task before 0465 lands** (0464 § R7).
- **Assumes from dep 0474:** the artifact writer, `CoverageEntry` with its `status` field, and
  `warnings[]`. This task fills them; it does not reshape the artifact. A shape change here is a
  `schemaVersion` bump and must go back to 0474's contract.
- **Leaves for 0471:** the `daily` command is what launchd invokes, and its failure path is what
  `history.daily.failed` reports. Keep `daily`'s exit code faithful to the 0/1/2 contract so the
  event and the exit agree.
- **Leaves for 0469:** all three `coverage[].status` values are rendered there; this task guarantees
  each is actually produced.

**ADR: no.** 0464 § R6/R7 already settled the scheduling surface and the fan-out location.
`docs/04_DESIGN.md` §`spur history` carries the command surface and the exit-code table, same commit
(T3).
### Plan
- [ ] **0. Confirm 0465 and 0474 landed.** 0465 first — without realpath normalization, `--source all`
      multiplies the duplicate-checkpoint defect across every source, every run. If 0465 is not done,
      stop. Baseline `bun run lint` + `bun run test` green.
- [ ] **1. `importAll` with isolation (R1, R2).** Loop `SOURCES`
      (`packages/app/src/services/history-service.ts:29-40`), each in its own `try`, calling the
      existing `import()` unchanged. Test with a six-source fixture where one throws: assert the other
      five completed and persisted, and the failing one carries `status: 'failed'` with its error.
- [ ] **2. Per-source transaction boundary (R2).** Test that a source failing mid-import leaves its
      own checkpoint where it was and does not roll back a sibling's committed rows.
- [ ] **3. Timeout (R5).** Add `--source-timeout <ms>` (default 600000). Test that a source exceeding
      it is abandoned, recorded `failed`, and the remaining sources still complete.
- [ ] **4. Exit-code contract (R3).** Replace `apps/cli/src/commands/history.ts:27`. Test all three:
      all ok ⇒ 0, mixed ⇒ 2, all failed ⇒ 1. Add the case that motivates the whole change — a source
      with parse errors but successful imports is `ok`, not `failed`, and does not by itself produce a
      non-zero exit.
- [ ] **5. `empty` state (R4).** Zero files discovered ⇒ `status: 'empty'`, never `ok`. Test that an
      absent source directory yields `empty` and that this is distinguishable from a source that
      imported zero *new* records but has files.
- [ ] **6. Was-non-empty warning (R4).** Look up `history_import_checkpoint` for the source: rows
      exist but zero files discovered now ⇒ a `warnings[]` entry. Test both directions — a
      never-imported source is `empty` with **no** warning; a previously-imported one is `empty`
      **with** the warning.
- [ ] **7. Coverage into the artifact (R8).** Populate 0474's `CoverageEntry` per source. Test a run
      mixing `ok`, `failed`, and `empty` produces one entry each, with error counts bounded per 0474
      R6 (counts + 20 samples, remainder to the sidecar).
- [ ] **8. `spur history daily` (R6).** One run-once invocation: import-all → analyze → artifact →
      prune beyond `REPORT_RETENTION_DAYS`. Test that all four occur in the single process and that it
      exits rather than staying resident.
- [ ] **9. No date window on import (R7).** Assert `daily`'s import path passes no date argument and
      runs `--mode incremental`. Test the self-heal: simulate a two-day gap, run once, assert every
      appended record imported exactly once and no duplicate ledger rows.
- [ ] **10. Retention prune.** Test that artifacts older than 90 days are removed and newer ones are
      kept, with an injected clock.
- [ ] **11. Docs (T3).** Update `docs/04_DESIGN.md` §`spur history` — `--source all`,
      `--source-timeout`, the `daily` verb, and the 0/1/2 exit-code table, including the deliberate
      loss of "parse errors ⇒ exit 1".
- [ ] **12. Gates.** `bun run autofix && bun run spur-check`; `bun run lint`, `bun run test`,
      `bun run build` green. Targeted `bun test <file> --test-name-pattern <test>` while iterating.
- [ ] **13. Record.** `### Solution` gets the `path:line` change map and the exit-contract change
      called out explicitly; `### Testing` gets the commands, the isolation evidence, and the coverage
      claim.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
