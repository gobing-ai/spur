# Fleet performance receipt (task 1273)

Generated: 2026-10-25T03:22:34.797Z
Revision: 9cbf5c987323cf658727d6ede5179d97ad01db1a
Repeat: `bun run fleet-e2e --perf --trials 2 --inject-failure dispatch-to-done`
Workload digest: sha256:a851ae35a1798abecb2241aecd1442fa70acaf5f077c22a8f1d75703cf5239ea
Executor settings: not applicable for deterministic stubs; real-agent defaults are unobserved. Token and resource usage: unavailable.

> Provisional: the deterministic lane drives the SAME stub everywhere; host binaries are
> provenance only. Deltas across agents mean nothing until the real-agent lane lands (1276–1278).

## Trials

| agent | mode | status | durationMs | phases observed | reason |
| ----- | ---- | ------ | ---------- | --------------- | ------ |
| claude | cold | validated | 3743 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| claude | resume | validated | 3789 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| claude | resume | timed-out |  | enqueue | --inject-failure dispatch-to-done: synthetic timeout for a hang-tagged trial; stays in the denominator |
| codex | cold | validated | 5177 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | resume | validated | 4455 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | cold | validated | 3667 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | resume | validated | 3537 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |

## Measured (p50/p95 of enqueue→validated, UTC wall clock, one host)

| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour |
| ----- | ---- | ----- | ----- | -------------- | ---------------- |
| claude | cold | 3743 | 3743 | 1 | 961.795 |
| claude | resume | 3789 | 3789 | 0.5 |  |
| claude | warm | — | — | — | — (claude 2.1.309 is not the qualified stream-json version 2.1.308) |
| codex | cold | 5177 | 5177 | 1 | 695.383 |
| codex | resume | 4455 | 4455 | 1 | 808.081 |
| codex | warm | — | — | — | — (qualified: /opt/homebrew/bin/codex 0.164.0, driver codex, verifiedAgainst 0.164.0) |
| pi | cold | 3667 | 3667 | 1 | 981.729 |
| pi | resume | 3537 | 3537 | 1 | 1017.812 |
| pi | warm | — | — | — | — (qualified: node_modules/.bin/pi 0.87.1, driver pi, verifiedAgainst 0.87.1) |

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
| claude | cold | 218.12637499999255 | 225.63783399999375 | 1 | 16224.833 | 2 |
| claude | resume | 218.4262080000044 | 222.52958400000352 | 1 | 16328.167 | 2 |
| claude | warm | 0.8217920000024606 | 226.6289170000091 | 0.6666666666666666 | 30564.937 | 1 |
| codex | cold | 213.7452090000006 | 214.77308400000038 | 1 | 16802.083 | 2 |
| codex | resume | 220.004958000005 | 225.75670899999386 | 1 | 16152.129 | 2 |
| codex | warm | 0.7886250000010477 | 223.4361659999995 | 1 | 32110.633 | 1 |
| pi | cold | 217.36449999999604 | 220.0867089999956 | 1 | 16458.978 | 2 |
| pi | resume | 214.32512500000303 | 221.38662499999919 | 1 | 16524.686 | 2 |
| pi | warm | 0.8452089999918826 | 235.53954199999862 | 1 | 30458.818 | 1 |

Notes: durations use UTC wall clock across processes (one host clock domain);
per-phase `monotonicMs` stays in-process. `gates` has no observable in the stub lane
(the stub closes tasks without running quality gates) and is recorded absent.
Warm rows (tasks 1276-1278) record QUALIFICATION of the installed binary — driver verdict,
binary path and version. The separate paired comparison measures cold/resume/warm task turns
against one local fixture workload; its samples are not mixed with the fleet-task baseline.
Repository-local binary paths are relative to the repository root; external paths stay absolute.

