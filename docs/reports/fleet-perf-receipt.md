# Fleet performance receipt (task 1273)

Generated: 2026-10-23T23:40:39.911Z
Repeat: `bun run scripts/commands/fleet-e2e.ts --perf --trials 3`
Workload digest: sha256:a851ae35a1798abecb2241aecd1442fa70acaf5f077c22a8f1d75703cf5239ea

> Provisional: the deterministic lane drives the SAME stub everywhere; host binaries are
> provenance only. Deltas across agents mean nothing until the real-agent lane lands (1276–1278).

## Trials

| agent | mode | status | durationMs | phases observed | reason |
| ----- | ---- | ------ | ---------- | --------------- | ------ |
| claude | cold | validated | 2017 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| claude | resume | validated | 1643 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| claude | resume | validated | 1655 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | cold | validated | 1767 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | resume | validated | 2077 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | resume | validated | 1898 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | cold | validated | 1881 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | resume | validated | 1644 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | resume | validated | 1719 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |

## Measured (p50/p95 of enqueue→validated, UTC wall clock, one host)

| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour |
| ----- | ---- | ----- | ----- | -------------- | ---------------- |
| claude | cold | 2017 | 2017 | 1 | 1784.829 |
| claude | resume | 1643 | 1655 | 1 | 2183.141 |
| claude | warm | — | — | — | — (claude 2.1.309 is not the qualified stream-json version 2.1.308) |
| codex | cold | 1767 | 1767 | 1 | 2037.351 |
| codex | resume | 1898 | 2077 | 1 | 1811.321 |
| codex | warm | — | — | — | — (no turn-session driver registered for agent 'codex') |
| pi | cold | 1881 | 1881 | 1 | 1913.876 |
| pi | resume | 1644 | 1719 | 1 | 2140.946 |
| pi | warm | — | — | — | — (qualified: node_modules/.bin/pi 0.87.1, driver pi, verifiedAgainst 0.87.1) |

## Pi executable provenance

| install | path | version |
| ------- | ---- | ------- |
| host | /Users/robin/node_modules/.bin/pi | 1.4.0 |
| repository | node_modules/.bin/pi | 0.87.1 |

The warm row qualifies the selected binary only; the other installation is provenance.

Notes: durations use UTC wall clock across processes (one host clock domain);
per-phase `monotonicMs` stays in-process. `gates` has no observable in the stub lane
(the stub closes tasks without running quality gates) and is recorded absent.
Warm rows (tasks 1276-1278) record QUALIFICATION of the installed binary — driver verdict,
binary path and version. They carry no latency: the lane runs cold/resume trials only.
Repository-local binary paths are relative to the repository root; external paths stay absolute.

