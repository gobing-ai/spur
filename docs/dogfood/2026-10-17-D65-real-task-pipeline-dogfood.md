---
run_id: d65-real-pipeline-20261018
status: complete
testee: "spur workflow run task-pipeline.yaml"
classification: cli
mode: fix
max_retry: 2
testee_agent: omitted
started_at: 2026-10-18T01:01:12.235Z
finished_at: 2026-10-18T01:50:12.806983+00:00
live_path: .spur/run/dogfood/d65-real-pipeline-20261018.md
report_path: docs/dogfood/2026-10-17-D65-real-task-pipeline-dogfood.md
protocol: sp:dogfood-testing@1.2
---

## Dogfood Report — D65 real task pipeline

### 1. Testee

- **Command:** source-local workflow run task-pipeline.yaml, executor host, profile auto
- **Classification:** CLI invocation
- **Exact invocation / Repro:** `bun run apps/cli/src/index.ts workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"1232","executor":"host","profile":"auto","deferFeatureSync":"true"}' --json`; repeat for 1237 and 1238, complete returned host work items, and continue with matching receipts.
- **Testee agent:** omitted (current host performs returned work items)
- **Mode:** fix (--max-retry 2); no commits
- **Source evidence:** 670db1480d5068809026b02499c588c086d06d4e plus the uncommitted D65 repair diff; tested source parity is recorded in `.spur/run/d65-verifyall/final-source-manifest.json`.
- **Definition:** sha256:ca504c1978399cc2c3b11a0f7a1b5b7739b006ac7a156c874fe541fde5c822ea, version 9
- **Measurement scope:** raw engine trace action durations and full-gate receipts; no compatible host transcript counters
- **Sample coverage:** 3/3 real D65 tasks, certification-only re-audits. No model stub is used in these measured runs. Separate subprocess/fleet parity runs stub their agents and are excluded from timing comparison.

### 2. Execution Summary

- **Result:** PASS
- **Steps:** 3 derived, 3 executed, 0 N/A
- **Outcome:** all three actual task pipelines reached done with full quality gates and recorded PASS; completed and failed attempts are retained in `docs/reports/d65-real-task-pipeline-receipt.json`.
- **Retry accounting:** the driver initially chose one retry, then raised its own allowance to two after independent defects were identified; the operator specified --fix all and no retry cap. Task 1232 used three complete-run attempts. The testee's own bounded gate repair hops remain in the raw traces. Nothing was silently omitted.

#### Cost

- **Ledger estimate:** ~n/a total | ~n/a cached (n/a% hit rate) [~estimate]
- **Method:** unavailable token counters; confidence: LOW
- **Meter:** n/a

### 3. Monitor Ledger

| Step | Attempts | Outcome | Fix Applied | Finding | Fresh Tokens | Cached Tokens | Cache % | Basis | Wall-clock |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| certify real task 1232 | 3 | PASS | host pause/resume, fleet contract and worktree ownership repairs | earlier failures preserved; final gate PASS | ~unknown | ~unknown | n/a | engine timestamps; host tokens unavailable | 2098513 ms (all task attempts) |
| certify real task 1237 | 1 | PASS | none | certification-only; no implementation speedup claim | ~unknown | ~unknown | n/a | engine timestamps; host tokens unavailable | 210257 ms (all task attempts) |
| certify real task 1238 | 1 | PASS | none | certification-only; no implementation speedup claim | ~unknown | ~unknown | n/a | engine timestamps; host tokens unavailable | 208940 ms (all task attempts) |

### 4. What We Did

The current host inspected the existing implementations and callers, wrote failure checks before production fixes, ran focused behavior checks, then certified three real tasks through the unmodified seven-state pipeline. Every final run used the original full project gate, real corpus transitions and a reviewer requirement/AC table. Review sections were written through `spur task update`, with derived confidence and closed findings. No forced done, suppressed checks, reduced gate, baseline tuning or commits were used.

### 5. Issues

#### Fixed

- Shared engine action-level continuation: consumers now wait for the host receipt and completed actions do not replay. The engine's own full check and build pass; Spur installs the fix through a frozen-lockfile Bun patch.
- Host receipt versus a later approval in the same state: the persisted action cursor identifies the actual pause. A later operator gate keeps its own answer contract.
- Fleet workflow dispatch: keyed member execution produces a linked completion only after shared answer/diff/capability/session/budget checks finish. The model stub follows the actual prompt artifact, and fleet fixture tier/scaffolding is explicit.
- Engine worktree ownership: retained through host pauses, fenced from competing runs, released on terminal/cancel, and agent writes stop if lease renewal fails.
- Gate receipt identity and unavailable metrics: engine run IDs reach receipts; per-run and batch summaries retain n/a counters rather than zeros.
- Test and driver integration: fixture environment inheritance, required TSDoc and filesystem boundaries, corresponding integration test placement, task Review confidence, and the summary CLI's default JSON surface were corrected.

#### Unresolved

(none)

### 6. Findings

- Certification-only workloads are not comparable to the implementation-bearing baseline. No percentage speedup is asserted.
- Driver overhead and token/cost comparison remain n/a without a compatible host transcript; unassigned intervals are not fabricated model time.
- Repeated action kinds can make positional progress mappings ambiguous. Raw trace action IDs supply the stage totals, and diagnostic counts are disclosed in the measurement receipt.
- Both failed complete-run attempts and auxiliary gate failures remain in the evidence. The final passing samples do not erase their cost.
- The repair allowance was chosen and amended by the driver, not supplied as an operator retry flag; its final bound and actual attempts are explicit above.

── Dogfood Summary ──
Result: PASS (6 fixed, 0 unresolved, 5 findings)
Tokens: ~n/a total | ~n/a cached (n/a% hit rate) [~estimate]

Fixed issues:
  • host continuation and approval classification; fleet contracts; worktree ownership; metrics; fixture/driver integration

Unresolved issues:
  • (none)

Findings (P1+P2):
  • (none unresolved; measurement and protocol limitations documented above)

[Live: .spur/run/dogfood/d65-real-pipeline-20261018.md]
[Report: docs/dogfood/2026-10-17-D65-real-task-pipeline-dogfood.md]
