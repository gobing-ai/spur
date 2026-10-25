# Fleet performance receipt (task 1273)

Generated: 2026-10-25T01:14:18.324Z
Repeat: `bun run scripts/commands/fleet-e2e.ts --perf --trials 3`
Workload digest: sha256:a851ae35a1798abecb2241aecd1442fa70acaf5f077c22a8f1d75703cf5239ea

> Provisional: the deterministic lane drives the SAME stub everywhere; host binaries are
> provenance only. Deltas across agents mean nothing until the real-agent lane lands (1276–1278).

## Trials

| agent | mode | status | durationMs | phases observed | reason |
| ----- | ---- | ------ | ---------- | --------------- | ------ |
| claude | cold | validated | 4710 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| claude | resume | validated | 3505 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| claude | resume | validated | 3881 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | cold | validated | 3815 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | resume | validated | 3630 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | resume | validated | 3695 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | cold | validated | 3893 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | resume | validated | 3654 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | resume | validated | 3685 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |

## Measured (p50/p95 of enqueue→validated, UTC wall clock, one host)

| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour |
| ----- | ---- | ----- | ----- | -------------- | ---------------- |
| claude | cold | 4710 | 4710 | 1 | 764.331 |
| claude | resume | 3505 | 3881 | 1 | 974.817 |
| claude | warm | — | — | — | — (claude 2.1.309 is not the qualified stream-json version 2.1.308) |
| codex | cold | 3815 | 3815 | 1 | 943.644 |
| codex | resume | 3630 | 3695 | 1 | 982.935 |
| codex | warm | — | — | — | — (qualified: /opt/homebrew/bin/codex 0.164.0, driver codex, verifiedAgainst 0.164.0) |
| pi | cold | 3893 | 3893 | 1 | 924.737 |
| pi | resume | 3654 | 3685 | 1 | 981.06 |
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

