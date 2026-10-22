# Fleet performance receipt (task 1273)

Generated: 2026-10-22T19:56:45.872Z
Repeat: `bun run scripts/commands/fleet-e2e.ts --perf --trials 2`
Workload digest: sha256:a851ae35a1798abecb2241aecd1442fa70acaf5f077c22a8f1d75703cf5239ea

> Provisional: the deterministic lane drives the SAME stub everywhere; host binaries are
> provenance only. Deltas across agents mean nothing until the real-agent lane lands (1276–1278).

## Trials

| agent | mode | status | durationMs | phases observed | reason |
| ----- | ---- | ------ | ---------- | --------------- | ------ |
| claude | cold | validated | 3510 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| claude | resume | validated | 3783 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | cold | validated | 3693 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | resume | validated | 4029 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | cold | validated | 6547 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | resume | validated | 4336 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |

## Measured (p50/p95 of enqueue→validated, UTC wall clock, one host)

| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour |
| ----- | ---- | ----- | ----- | -------------- | ---------------- |
| claude | cold | 3510 | 3510 | 1 | 1025.641 |
| claude | resume | 3783 | 3783 | 1 | 951.626 |
| claude | warm | — | — | — | — (warm task-turn adapters land with tasks 1276–1278; recorded unsupported until then) |
| codex | cold | 3693 | 3693 | 1 | 974.817 |
| codex | resume | 4029 | 4029 | 1 | 893.522 |
| codex | warm | — | — | — | — (warm task-turn adapters land with tasks 1276–1278; recorded unsupported until then) |
| pi | cold | 6547 | 6547 | 1 | 549.87 |
| pi | resume | 4336 | 4336 | 1 | 830.258 |
| pi | warm | — | — | — | — (warm task-turn adapters land with tasks 1276–1278; recorded unsupported until then) |

Notes: durations use UTC wall clock across processes (one host clock domain);
per-phase `monotonicMs` stays in-process. `gates` has no observable in the stub lane
(the stub closes tasks without running quality gates) and is recorded absent.

