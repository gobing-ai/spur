---
run_id: G74-fleet-perf-20261024
status: complete
testee: "bun run fleet-e2e --perf --trials 2 --inject-failure dispatch-to-done"
classification: cli
mode: observe-only
max_retry: 0
testee_agent: omitted
started_at: "2026-10-25T02:30:18.258Z"
finished_at: "2026-10-25T03:25:54.079Z"
live_path: .spur/run/dogfood/G74-fleet-perf-20261024.md
report_path: docs/dogfood/2026-10-24-G74-fleet-perf-dogfood.md
protocol: sp:dogfood-testing@1.2
---

# G74 fleet performance dogfood

### 1. Testee

**Repro:** bun run fleet-e2e --perf --trials 2 --inject-failure dispatch-to-done

Run the fleet-task baseline and paired keyed task turns for Claude, Codex and Pi. The deterministic
comparison uses real children and the production action/artifact contract with a local model fixture.
Native binary qualification is separate. Project and slash registries were isolated under
.spur/run/verifyall-G74-20261024/perf-registries/.

### 2. Execution Summary

**Result:** PASS (3 fixed, 0 unresolved, 1 finding)
**Steps:** 4 derived, 4 executed

#### Cost

- **Ledger estimate:** ~n/a total | ~n/a cached (n/a% hit rate) [unavailable]
- **Method:** unavailable; no token meter or defensible ledger estimate; confidence: LOW
- **Meter:** n/a
- Measured tokens: n/a; heuristic tokens: n/a.

### 3. Monitor Ledger

| Step | Attempts | Outcome | Fix Applied | Finding | Fresh Tokens | Cached Tokens | Cache % | Basis | Wall-clock |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial cold/resume matrix | 1 | PASS | — | warm rows initially qualified binaries only | n/a | n/a | n/a | verifyall-G74-20261024/perf-dogfood.log; 6/6 validated | n/a |
| repaired receipt provenance | 1 | PASS | separate verifyall pass repaired metadata and repeat command | initial warm gap resolved by final paired run | n/a | n/a | n/a | verifyall-G74-20261024/perf-final-current.log; 6 validated plus 1 synthetic timeout | n/a |
| paired keyed-turn comparison | 1 | PASS | separate completion pass added paired fixture execution | P3: fixture timings do not measure paid models | n/a | n/a | n/a | G74-completion/perf-e2e-final.log; 19 paired rows plus 7 baseline rows | n/a |
| receipt and failure-occupancy audit | 1 | PASS | separate completion pass includes failed occupancy in throughput | — | n/a | n/a | n/a | G74-completion/receipt-check.log; all nine agent/mode cells checked | n/a |

### 4. What We Did

The final canonical CLI invocation exited zero. Its baseline retained six successful trials and one
explicitly synthetic timeout. The separate paired comparison retained 18 successful trials and one
deliberately missing artifact. That fixture terminal success failed the action contract, demonstrating
that transport success cannot certify a missing artifact.

All nine paired agent/mode cells record p50/p95, completion rate and useful throughput using the same
bounded response and fixture-v1 / local-fixture / none settings. Pair order alternates. Per agent,
two cold and two resume samples launch separate children; warm samples share exactly one live child.
Resume samples restore persisted fixture state. The receipt carries Bun executable/version, revision,
workload digest, run/execution/request identity, attempt, owner epoch and occupant generation.
Native ids are retained only when observed. Unknown token/resource observations remain explicit.

The receipt audit independently recomputed completion rates and throughput, including failed work's
occupied time. The end-to-end regression has 197 assertions. The script suite passed 35/35 cases.
Production repairs were made by the separate authorized completion pass, not this observe-only driver.

JSON and Markdown: docs/reports/fleet-perf-receipt.json and docs/reports/fleet-perf-receipt.md.
Logs: .spur/run/G74-completion/perf-e2e-final.log, receipt-check.log, perf-tests-final.log.

### 5. Issues

#### Fixed

- Qualification-only warm rows lacked a paired measured comparison; turnComparison now supplies it.
- Missing revision/settings/usage availability and an inert repeat entrypoint were repaired.
- Useful throughput omitted failed work's occupied time; the failure-first regression now passes.

#### Unresolved

(none)

### 6. Findings

P3 — This is deterministic harness/process evidence. It makes no paid-model speed, provider-cache or
production tail-latency claim. Real-agent execution remains opt-in, and unqualified native versions
retain their explicit fallback. No paid model was invoked by this run.

── Dogfood Summary ──
Result: PASS   (3 fixed, 0 unresolved, 1 finding)
Tokens: ~n/a total  |  ~n/a cached (n/a% hit rate)  [unavailable]

Fixed issues:
  • Paired warm measurements, receipt provenance and failure-inclusive throughput.

Unresolved issues:
  • (none)

Findings (P1+P2):
  • (none)

[Live: .spur/run/dogfood/G74-fleet-perf-20261024.md]
[Report: docs/dogfood/2026-10-24-G74-fleet-perf-dogfood.md]
