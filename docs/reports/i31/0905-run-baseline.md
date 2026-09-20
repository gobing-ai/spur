# 0905 — Complete-run reliability and cost baseline (report artifact)

**Task:** 0905 (feature I31) · **Source commit:** `99562391f14d2118b80a189826fca0b8e2f25e4b` · **Captured:** 2026-09-20T06:51:00Z
**Provenance:** remediation artifact under verify `--fix all` re-verification, transcribing the task `### Solution`'s measured investigation (all evidence read from `.spur/run/` artifacts, `.spur/logs/spur.log`, corpus History rows, and trace DBs via source-local CLI, exit 0). Machine-readable form: `0905-run-baseline.json` (same directory). Prerequisite verified this run: **0903 done**, `0903-contract-adoption.json` present, `bun run docs/reports/i31/0903-check.ts` exit 0; scenario IDs SC1–SC5 frozen.

## Cohort selection (R2)

Window: 14 UTC days ending 2026-09-20T06:51:00Z · newest-first, run-ID tie-break · ≤10 terminal non-dry runs per mode · dedup by persisted run identity.
**Sample: pipeline 2/10, inline 0/10, fleet 0/10.** Exclusions recorded: `R-0905-inline` (in flight at investigation), 3 lifecycle side-runs (stuck `status: running` post-done; not task-pipeline executions).

## Per-run metrics (R3 — process exit ≠ workflow terminal ≠ verified success)

| Run | Mode | Duration | Exit | Terminal | Verified | Recovery | Operator |
| --- | --- | --- | --- | --- | --- | --- | --- |
| runall-i31-20260919-180944-0903 | pipeline | 104 m 23 s (6263 s) | 0 | done | ✔ (verdict artifact) | 3 bounded events (test-fix, review remediation, verify re-round) | 0 |
| runall-i31-20260919-180944-0904 | pipeline | 58 m 00 s (3480 s) | 0 | done | ✔ (verdict artifact) | 0 | 0 |

Fixed gate cost measured: full-suite test phase 282.91 s / 326.82 s (8594 tests × 487 files) on docs-only diffs. 8 fast-fail `ai-runner` invokes (deltas 5/6/6/16/6/7/7/11 ms; labeled hypothesis: periodic availability probes) — none changed an outcome; identities unlogged.

## Cost coverage (R4 — nulls, never zeros; scopes never confused)

- **Tokens / USD (cohort): null, denominator 0** — history DB holds 0 imported records in this tree; no usage snapshot exists (0903 F6).
- **Aggregate all-history scope: 0 records, totals zero** — reported separately, never as 14-day results.
- Economy conclusions are **wall-clock only**: 0903's bounded recovery chain cost ≈1.8× task time (104.4 vs 58.0 min) and ≈10.8× test-stage time vs single-pass.

## Scenario coverage (R5 — no fresh paid runs)

| Scenario | Mode | Disposition | Basis |
| --- | --- | --- | --- |
| S1 success-with-recovery | pipeline | observed | 0903 run |
| S2 single-pass success | pipeline | observed | 0904 run |
| S3 inline implement | inline | observed (excluded from numerators) | this task's own in-flight stage |
| S4 usage-absent + latency/timeout | inline | observed | 0904 measured evidence consumed (capture ~113 s, no timeout armed) |
| S5 serve-occupant receipts | fleet | **unobserved** | not exercisable read-only; deferred to final I31 plan |
| S6 registered-vs-shared run effect | fleet | **unobserved** | static divergence re-measured = 0; run effect unobservable without forbidden config mutation; deferred |
| S7 executor availability probe | inline | observed | doctor re-capture: 16 agents, 10 usable tier-1, 6 not-installed, `usage: null` |

## Ranked failure clusters → owner-scoped next batch (R5/R6)

1. **P** — pipeline executions persist no run records in the trace DB (0/2; side-runs stuck running): finalize run status at completion; persist one record per execution.
2. **E6** — cost/session joins null at batch time: write resolved executor + session id into stage artifacts at dispatch; run `history import` post-batch.
3. **P** — failing-gate log not retained (0903's recovery cause unknown): retain failing-gate logs beside fix-attempt markers.
4. **P** — ai-runner invoke failures unlogged: one structured line (agent, selector, exit code) on the ERR path.
5. **D62** — gate floor is the full-suite test phase on docs-only diffs: re-measure on a code-change cohort before any scoped-gate change.
6. **I31 close-out** — `--auto` ships precision debt to record (P3s + unfilled boxes): keep box flips in the delivering write; pre-record precision policy stays a review-gate question.

## Sparse-baseline delimitation (R7)

This baseline is **sparse**: pipeline n=2 (docs-only tasks), inline = in-flight observation only, **fleet = 0 runs — no fleet conclusions drawn**. Cost conclusions are wall-clock only. Missing evidence for follow-up: one bounded serve session on a quiet tree (S5), a staged registered/shared divergence run (S6), history import + usage snapshot before any token/USD claim, session identifiers in stage artifacts before run↔session binding.

**Fleet deferral (carried from the task's §H amendment):** S5/S6 are named 0903 inputs; the skip is a recorded deferral with 0 measured runs each — nothing was invented around, and the acceptance basis is this explicit wording, not measured fleet coverage.

## Repeatable local check (R7/AC7)

```
$ bun run docs/reports/i31/0905-check.ts
CHECK-PASS: 2 runs (inline:0 pipeline:2 fleet:0), 2 exclusions, 7 scenarios, 6 clusters; denominators, nulls, identity, 0903 refs, sparse delimitation validated
exit=0
```

The checker detects: duplicate run IDs, denominator mismatches vs actual runs, negative/missing durations, zero-instead-of-null cost values, aggregate/cohort scope confusion, verified-success claims without an existing verdict artifact, unobserved scenarios listing runs, and unresolvable 0903 scenario references.
