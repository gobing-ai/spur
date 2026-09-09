---
schema_version: 1
name: Make history importer cancellation settle writes and checkpoints
status: done
template: feature-impl
created_at: 2026-09-08T22:33:10.234Z
updated_at: "2026-09-09T00:48:29.862Z"
feature_id: A21
priority: P1
tags:
  - A21
  - execution-timeouts
  - upstream

---

## 0811. Make history importer cancellation settle writes and checkpoints

### Background

Robin selected reusable upstream timeout control and an explicit unlimited mode on 2026-09-08. Feature A21 and ADR-112 define the scope; docs/design/execution-deadlines.md is the accepted design.

- Implements: R4 — Import cancellation settles before reporting completion

- Owner: Upstream /Users/robin/xprojects/ts-libs: packages/llm-jsonl-importer/src/types.ts, importer.ts and directly called import loops/adapters; corresponding package tests/README and owning upstream docs. Spur tracking evidence only.
- Rubric: E4 D1 L1 C1 R2 = 9; independently verifiable deliverable, estimated 3–5 hours. Tests/docs stay in this task. Whole feature E23 D4 L5 C2 R2 = 36; split by reusable capability and release boundary, not by scenario.
- Evidence baseline: installed upstream 0.4.57 and read-only ts-libs checkout f01336f7b770219babaf62c2bde2f11ac9c1d86e; existing 65 focused Spur tests passed but do not prove the new contract.

### Requirements

- **R1** — Add cooperative AbortSignal support to the existing importer entry/options contract. Abort before further work, settle in-flight transactions/checkpoints before rejecting, and guarantee no invocation-owned writes after cancellation settlement while preserving incremental resume and behavior without a signal.

### Acceptance Criteria

```gherkin
Feature: Make history importer cancellation settle writes and checkpoints

  @core
  Scenario: R1 — Import cancellation settles before reporting completion
    Given an importer is processing records under an abort signal
    When cancellation arrives during the import
    Then the importer stops scheduling further writes and settles transaction and checkpoint work before rejecting
    And no writes from that cancelled invocation occur after rejection
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend existing ImportOptions with an optional signal and propagate it through real work owners instead of wrapping an uncancellable import in Promise.race. Check before file/batch processing, before starting additional writes and between bounded batches. Track and await in-flight work so the public promise cannot reject ahead of its writes. Active transaction work must commit consistently or roll back; never claim a synchronous SQLite operation can be interrupted by a JavaScript timer. The containing process from the runtime task remains the hard fallback. Preserve all source adapters, dry-run and full reconciliation semantics without new import pipelines.

#### Decisions

- Follow ADR-112 and docs/design/execution-deadlines.md; null means unlimited, omitted inherits. Native mechanisms own lifecycle; no parallel Spur framework.
- Rejected: constant-only deduplication, -1 sentinels passed to timers, unbounded visibility leases and promise-race-only cancellation.
- Preserve concurrent changes; work in a clean isolated checkout for implementation and use only task-owned temporary processes/databases.

#### Dependencies and premises

ImportOptions in 0.4.57 has no signal. Cancellation is cooperative; lock acquisition or another synchronous blocked call needs the existing external process watchdog, not a stronger promise claim.

#### Execution budget and evidence

- Budget: 3–5 hours; checkpoint at the upper bound with changed-file/commit/test evidence, then resume against the same requirements.
- Ownership: Upstream /Users/robin/xprojects/ts-libs: packages/llm-jsonl-importer/src/types.ts, importer.ts and directly called import loops/adapters; corresponding package tests/README and owning upstream docs. Spur tracking evidence only.
- Upstream work follows upstream AGENTS.md and harness; this Spur record tracks acceptance and cross-repository ordering. Record the exact upstream commit and verification commands in this task through spur task, never fabricate local product changes to satisfy requireDiff.
- requireDiff: source changes must be verified in the owning repository; documentation/evidence here is allowed tracking, not proof of upstream implementation. If the task pipeline cannot verify external source scope, use its explicit external-evidence path and report that limit before completion.
- No production mutations, releases, workflow edits, new toolchains or publication are included.

### Plan

1. Trace every caller and source adapter of ImportOptions/importer execution; document where writes and checkpoints begin/end and add a failing cancellation-after-start regression.
2. Thread the optional signal through the existing loops, await invocation-owned work, and preserve transaction/checkpoint invariants.
3. Test already-aborted input, abort during file/batch/transaction work, no post-rejection writes, dry-run behavior and resume from the last committed checkpoint; avoid timer-only tests that merely prove Promise.race returned.
4. Run focused importer tests, then upstream bun run spur-check and bun run build. Update importer README and upstream docs, and attach upstream commit/test evidence to this task without publishing.

### Solution

Owner-repo implementation (upstream ts-libs isolated worktree /Users/robin/xprojects/ts-libs-a21-0811, branch sp/a21-0811 from 0.4.57 baseline f01336f; Spur carries tracking evidence only, per task Owner + design "no dummy Spur source edits for a diff gate"). Cooperative AbortSignal for the history importer:

- `/Users/robin/xprojects/ts-libs-a21-0811/packages/llm-jsonl-importer/src/types.ts:106` + `src/opencode-importer.ts:54` — optional `signal` on `ImportOptions` / `OpenCodeImportOptions` (additive; omitted = unchanged behavior, 323 pre-existing tests pass).
- `/Users/robin/xprojects/ts-libs-a21-0811/packages/llm-jsonl-importer/src/importer.ts:133,143,176,193,517` — cancellation boundaries: entry/pre-schema, post-discovery/pre-resetCheckpoints, per-file, per-line, pre-reconcile; `src/opencode-importer.ts:61,100,182` — entry, per-page, pre-settlement (queued-but-unissued ops discarded on cancel).
- `/Users/robin/xprojects/ts-libs-a21-0811/packages/llm-jsonl-importer/src/cancellation.ts` + `src/errors.ts:18` — `throwIfImportAborted` helper + `ImportCancelledError extends HistoryImportError` (carries `signal.reason`; upstream catch-sites keep working, `instanceof` distinguishes).
- In-flight batches settle atomically before reject (per-line batch records+ledger+checkpoint, `src/importer.ts:477-483`); no invocation-owned write after settlement; cancelled mid-file runs keep line-only checkpoints and never arm the 0675 file-identity short-circuit (identity-stamp relocated from per-line to once-per-completed-file, `src/importer.ts:486-514` — also fixes a baseline crash window where mid-file abort left full-file identity with a partial checkpoint = silent tail loss).
- `/Users/robin/xprojects/ts-libs-a21-0811/packages/llm-jsonl-importer/tests/cancellation.test.ts` — 5 regression tests (already-aborted zero-write; mid-file settle c1–c4 + checkpoint line:4 + no post-abort writes; signal-less resume completes; dry-run cancel persists nothing; opencode both boundaries). Plus README Cancellation section, CHANGELOG Unreleased entry, docs/03_ARCHITECTURE.md importer paragraph.
- Evidence: new tests 5/5; package suite 323 pass / 1 pre-existing baseline fail (schema-version vs package.json, untouched files, excluded); `bun run lint` exit 0; diff 10 files +126/−25. Review pass (1277717e) with P2 residuals report-only: post-discovery/pre-reconcile boundaries untested; final-line-window stamp arm resume-safe; trailing-rejected-line checkpoint advance alters one-time error reporting. Verify PASS (720a8e1c, `.spur/run/0811-verify-answer.txt`); Spur gate PASS attempt 1, proof `1e4f7c6d…` held.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Contract: `@gobing-ai/ts-llm-jsonl-importer` `src/types.ts` line 106 — `readonly signal?: AbortSignal` on `ImportOptions` with full settle/resume/fallback docstring; `src/opencode-importer.ts` line 54 — `OpenCodeImportOptions.signal`; `src/errors.ts` line 18 — `ImportCancelledError extends HistoryImportError` (carries `signal.reason`), exported at `src/index.ts` line 7. Abort before further work: boundaries at `src/importer.ts` lines 133 (entry, before schema write), 143 (after discovery, before full-mode checkpoint reset), 176 (per file), 193 (between per-line batches), 517 (before full-mode reconciliation deletes) and `src/opencode-importer.ts` lines 61 (entry, before schema write), 100 (between source pages), 182 (before the single settlement batch), all via `throwIfImportAborted` (`src/cancellation.ts` line 10). Settle before rejecting: checkpoint upsert joins the same atomic `db.batch(ops)` as the line's records/ledger — `src/importer.ts` lines 477-483; OpenCode queued-but-unissued ops discarded before the settlement batch — `src/opencode-importer.ts` lines 178-183. No post-rejection writes: quiescence re-check after 20 ms still finds exactly 4 rows — `tests/cancellation.test.ts` lines 150-154; already-aborted runs leave zero `history_*` tables — `tests/cancellation.test.ts` lines 89-110 and 237-254. Resume preserved: line-only checkpoint `{last_imported_line: 4, source_size: null}` (identity short-circuit NOT armed) — `tests/cancellation.test.ts` line 148; resume completes c5-c6 with `skippedUnchangedFiles` 0 — `tests/cancellation.test.ts` lines 156-171. Behavior without a signal: full package suite green (323 pass; signal optional, `throwIfImportAborted(undefined)` no-ops). Commands: `NODE_ENV=test bun test tests/cancellation.test.ts` → 5 pass / 0 fail; `NODE_ENV=test bun test` → 323 pass / 1 pre-existing excluded fail (see Verification Commands); `bun run lint` → exit 0; `task check 0811` → PASS. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Import cancellation settles before reporting completion | MET | test | `@gobing-ai/ts-llm-jsonl-importer` `tests/cancellation.test.ts` lines 113-172 — Given/When: custom source's split aborts the controller mid-processing of line c4 (lines 80-87); Then: the in-flight c4 batch (record + ledger + checkpoint, one atomic `db.batch`, `src/importer.ts` lines 477-483) settles before the promise rejects with `ImportCancelledError`, exactly c1-c4 persisted (line 143), checkpoint at line 4 with `source_size: null` (line 148); And: no writes after rejection — quiescence wait then count still 4 (lines 150-154). Complementary: OpenCode mid-run cancel discards queued writes, 0 messages / 0 ledger / 0 checkpoints — `tests/cancellation.test.ts` lines 256-289. Focused command: `NODE_ENV=test bun test tests/cancellation.test.ts` → 5 pass / 0 fail (run this turn). |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | 6/6 non-trivial `### Design` claims DONE: (1) optional `signal` on the existing options, propagated through real work owners — no `Promise.race` anywhere in `src/` (grep, run this turn); (2) checks before file/batch processing, before additional writes, between bounded batches — `src/importer.ts` lines 133/143/176/193/517, `src/opencode-importer.ts` lines 61/100/182; (3) public promise cannot reject ahead of its writes — all write paths awaited inline before the next boundary; nothing detached; (4) transaction work commits atomically or not at all (checkpoint joins the record batch), docs never claim timer-interruptible synchronous SQLite — `src/types.ts` lines 96-105, `src/cancellation.ts` lines 3-8; (5) containing process named as hard fallback in all four doc surfaces (types docstring, README Cancellation section, `docs/03_ARCHITECTURE.md` llm-jsonl-importer section, CHANGELOG Unreleased entry); (6) all source adapters, dry-run and full reconciliation preserved with no new pipelines — dry-run test `tests/cancellation.test.ts` lines 175-196, reconciliation boundary at `src/importer.ts` line 517, full suite green. Bonus defect fix within scope: 0675 file-identity stamp relocated after each file's completed line loop (`src/importer.ts` lines 486-513; baseline stamped per-line at `ts-libs` `src/importer.ts` lines 472-491 with intermediate line numbers = silent-tail-loss crash window), verified against untouched baseline checkout. No scope-creep hunks: every diff hunk maps to R1 / Design / Plan step 4 (README + upstream docs). |
| P4 | Priority | — | Location |
| P4 | P2 | — | `@gobing-ai/ts-llm-jsonl-importer` `src/importer.ts` line 143, line 517 |
| P4 | P2 | — | `@gobing-ai/ts-llm-jsonl-importer` `src/importer.ts` lines 486-513 |
| P4 | P2 | — | `@gobing-ai/ts-llm-jsonl-importer` `src/importer.ts` lines 477-483 |
| P4 | P4 | — | — |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:1e4f7c6d851e1e82fa2c76326233387b0c81b61379481bea67048ce6a2d89fca |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-09T00:22:07.194Z todo → wip (system)
- 2026-09-09T00:48:28.600Z wip → testing (system)
- 2026-09-09T00:48:29.862Z testing → done (system)
