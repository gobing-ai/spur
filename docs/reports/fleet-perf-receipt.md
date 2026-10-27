# Fleet performance receipt (task 1273)

Generated: 2026-10-27T00:20:26.657Z
Revision: 3ebd9bcd9c222a673bb5cd9e839199bcc7345abe
Repeat: `bun run fleet-e2e --perf --trials 3 --agents pi`
Workload digest: sha256:a851ae35a1798abecb2241aecd1442fa70acaf5f077c22a8f1d75703cf5239ea
Executor settings: not applicable for deterministic stubs; real-agent defaults are unobserved. Token and resource usage: unavailable.

> Provisional: the deterministic lane drives the SAME stub everywhere; host binaries are
> provenance only. Deltas across agents mean nothing until the real-agent lane lands (1276–1278).

## Trials

| agent | mode | status | durationMs | phases observed | reason |
| ----- | ---- | ------ | ---------- | --------------- | ------ |
| pi | cold | validated | 2634 | enqueue→claim→process-ready→process-ready→first-output→terminal→turn-settled |  |
| pi | resume | validated | 1810 | enqueue→claim→process-ready→process-ready→first-output→terminal→turn-settled |  |
| pi | resume | validated | 2013 | enqueue→claim→process-ready→process-ready→first-output→terminal→turn-settled |  |
| pi | warm | validated | 2058 | enqueue→claim→process-ready→terminal→turn-settled |  |
| pi | warm | validated | 2436 | enqueue→claim→process-ready→terminal→turn-settled |  |
| pi | warm | validated | 2155 | enqueue→claim→process-ready→terminal→turn-settled |  |
| pi | attached-ready | validated | 1644 | attach→busy-wait→terminal |  |
| pi | attached-ready | validated | 1248 | attach→terminal |  |
| pi | attached-ready | validated | 1349 | attach→terminal |  |

## Measured (p50/p95 of enqueue→validated, UTC wall clock, one host)

| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour |
| ----- | ---- | ----- | ----- | -------------- | ---------------- |
| pi | cold | 2634 | 2634 | 1 | 1366.743 |
| pi | resume | 1810 | 2013 | 1 | 1883.338 |
| pi | warm | — | — | — | — (qualified: node_modules/.bin/pi 0.87.1, driver pi, verifiedAgainst 0.87.1) |
| pi | warmTurns | 2155 | 2436 | 1 | 1624.304 |
| pi | attached | 1349 | 1644 | 1 | 2546.569 |

## Pi executable provenance

| install | path | version |
| ------- | ---- | ------- |
| host | ~/node_modules/.bin/pi | 1.4.0 |
| repository | node_modules/.bin/pi | 0.87.1 |

The warm row qualifies the selected binary only; the other installation is provenance.

## Paired keyed task-turn measurements (deterministic fixtures)

Workload: sha256:87078e4ffaa722790c1fe1782ba1a2697b823c74e239a33b1c64ee1dbdd41f4d
Pinned settings: {"model":"fixture-v1","provider":"local-fixture","reasoning":"none"}
Every mode uses the same bounded response and artifact contract. Pair order alternates.
These measurements cover the real process/action-contract path with a local model fixture; they make no paid-model speed claim.

| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour | child processes |
| --- | --- | --- | --- | --- | --- | --- |
| pi | cold | 13.500333000003593 | 22.503290999993624 | 1 | 221798.177 | 3 |
| pi | resume | 13.09687500000291 | 13.52666699999827 | 1 | 274807.706 | 3 |
| pi | warm | 1.0343330000032438 | 22.213666000003286 | 1 | 448585.74 | 1 |

## Batch-2 probes (R3)

| agent | status | driver | binary | version | reason |
| ----- | ------ | ------ | ------ | ------- | ------ |
| grok-build | unsupported | none | ~/.grok/bin/grok | grok 1.0.60 (01a8e1c591c0) [stable] | no turn-session driver registered for agent 'grok-build' |
| antigravity-cli | unsupported | none | absent | — | no turn-session driver registered for agent 'antigravity-cli' |

These agents have no turn-session driver yet; their rows are excluded from every gain computation.

## Mode comparison — attached-ready vs supervised-warm (task 1283)

Materiality: attached p50 ≥ 15% lower AND p95 ≥ 10% lower (docs/plans/2026-10-21-fleet-performance-measurement.md (provisional targets));
anything under the thresholds is CONVENIENCE, not a measured speed win.

| agent | attached p50Ms | attached p95Ms | warm p50Ms | warm p95Ms | verdict |
| ----- | -------------- | -------------- | ---------- | ---------- | ------- |
| pi | 1349 | 1644 | 2155 | 2436 | material-gain |

Both columns run the shared fleet workload (one digest above): attached-ready through the bound
occupant, supervised-warm through the member loop holding one warm turn session. In the stub lane the
stub speaks the qualified claude stream-json protocol, so the delta is transport, not model speed.

Notes: durations use UTC wall clock across processes (one host clock domain);
per-phase `monotonicMs` stays in-process. `gates` has no observable in the stub lane
(the stub closes tasks without running quality gates) and is recorded absent.
Warm rows (tasks 1276-1278) record QUALIFICATION of the installed binary — driver verdict,
binary path and version; `warmTurns` rows measure supervised-warm trials on the shared workload, and a
trial counts only when its turn receipt says it ran warm. The separate paired comparison measures
cold/resume/warm task turns against one local fixture workload and feeds no Mode-comparison verdict.
Repository-local binary paths are relative to the repository root; external home paths are redacted to `~`.

