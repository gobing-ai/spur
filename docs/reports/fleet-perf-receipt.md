# Fleet performance receipt (task 1273)

Generated: 2026-10-26T02:15:37.284Z
Revision: bbd541987a5ae08f79a6382175ff857713c766af
Repeat: `bun run fleet-e2e --perf --trials 1 --agents pi --modes supervised-cold,attached-ready`
Workload digest: sha256:a851ae35a1798abecb2241aecd1442fa70acaf5f077c22a8f1d75703cf5239ea
Executor settings: not applicable for deterministic stubs; real-agent defaults are unobserved. Token and resource usage: unavailable.

> Provisional: the deterministic lane drives the SAME stub everywhere; host binaries are
> provenance only. Deltas across agents mean nothing until the real-agent lane lands (1276–1278).

## Trials

| agent | mode | status | durationMs | phases observed | reason |
| ----- | ---- | ------ | ---------- | --------------- | ------ |
| pi | cold | validated | 4095 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | attached-ready | validated | 2466 | attach→busy-wait→terminal |  |

## Measured (p50/p95 of enqueue→validated, UTC wall clock, one host)

| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour |
| ----- | ---- | ----- | ----- | -------------- | ---------------- |
| pi | cold | 4095 | 4095 | 1 | 879.121 |
| pi | resume |  |  |  |  |
| pi | warm | — | — | — | — (qualified: node_modules/.bin/pi 0.87.1, driver pi, verifiedAgainst 0.87.1) |
| pi | attached | 2466 | 2466 | 1 | 1459.854 |

## Pi executable provenance

| install | path | version |
| ------- | ---- | ------- |
| host | /Users/robin/node_modules/.bin/pi | 1.4.0 |
| repository | node_modules/.bin/pi | 0.87.1 |

The warm row qualifies the selected binary only; the other installation is provenance.

## Paired keyed task-turn measurements (deterministic fixtures)

Workload: sha256:87078e4ffaa722790c1fe1782ba1a2697b823c74e239a33b1c64ee1dbdd41f4d
Pinned settings: {"model":"fixture-v1","provider":"local-fixture","reasoning":"none"}
Every mode uses the same bounded response and artifact contract. Pair order alternates.
These measurements cover the real process/action-contract path with a local model fixture; they make no paid-model speed claim.

| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour | child processes |
| --- | --- | --- | --- | --- | --- | --- |
| pi | cold | 246.77116699999897 | 246.77116699999897 | 1 | 14588.414 | 1 |
| pi | resume | 218.95808300000135 | 218.95808300000135 | 1 | 16441.503 | 1 |
| pi | warm | 227.10083300000042 | 227.10083300000042 | 1 | 15851.989 | 1 |

## Batch-2 probes (R3)

| agent | status | driver | binary | version | reason |
| ----- | ------ | ------ | ------ | ------- | ------ |
| grok-build | unsupported | none | /Users/robin/.grok/bin/grok | grok 1.0.60 (01a8e1c591c0) [stable] | no turn-session driver registered for agent 'grok-build' |
| antigravity-cli | unsupported | none | absent | — | no turn-session driver registered for agent 'antigravity-cli' |

These agents have no turn-session driver yet; their rows are excluded from every gain computation.

## Mode comparison — attached-ready vs supervised-warm (task 1283)

Materiality: attached p50 ≥ 15% lower AND p95 ≥ 10% lower (docs/plans/2026-10-21-fleet-performance-measurement.md (provisional targets));
anything under the thresholds is CONVENIENCE, not a measured speed win.

| agent | attached p50Ms | attached p95Ms | warm p50Ms | warm p95Ms | verdict |
| ----- | -------------- | -------------- | ---------- | ---------- | ------- |
| pi | 2466 | 2466 | 227.10083300000042 | 227.10083300000042 | no-gain |

Caveat: the attached column is the fleet-task lane and the warm column is the paired turn-fixture lane
(task turns against a local model fixture) — different layers, so a verdict compares ergonomics across layers.

Notes: durations use UTC wall clock across processes (one host clock domain);
per-phase `monotonicMs` stays in-process. `gates` has no observable in the stub lane
(the stub closes tasks without running quality gates) and is recorded absent.
Warm rows (tasks 1276-1278) record QUALIFICATION of the installed binary — driver verdict,
binary path and version. The separate paired comparison measures cold/resume/warm task turns
against one local fixture workload; the Measured table above keeps the two lanes apart, while the
Mode comparison reads its warm column — that pairing spans layers, as its own caveat says.
Repository-local binary paths are relative to the repository root; external paths stay absolute.

