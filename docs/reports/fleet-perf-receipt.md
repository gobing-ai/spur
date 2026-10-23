# Fleet performance receipt (task 1273)

Generated: 2026-10-23T04:01:37.546Z
Repeat: `bun run scripts/commands/fleet-e2e.ts --perf --trials 3`
Workload digest: sha256:a851ae35a1798abecb2241aecd1442fa70acaf5f077c22a8f1d75703cf5239ea

> Provisional: the deterministic lane drives the SAME stub everywhere; host binaries are
> provenance only. Deltas across agents mean nothing until the real-agent lane lands (1276–1278).

## Trials

| agent | mode | status | durationMs | phases observed | reason |
| ----- | ---- | ------ | ---------- | --------------- | ------ |
| claude | cold | validated | 5229 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| claude | resume | validated | 4088 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| claude | resume | validated | 3747 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | cold | validated | 3816 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | resume | validated | 3944 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| codex | resume | validated | 4474 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | cold | validated | 4257 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | resume | validated | 4289 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |
| pi | resume | validated | 3932 | enqueue→claim→process-ready→process-ready→first-output→terminal |  |

## Measured (p50/p95 of enqueue→validated, UTC wall clock, one host)

| agent | mode | p50Ms | p95Ms | completionRate | validatedPerHour |
| ----- | ---- | ----- | ----- | -------------- | ---------------- |
| claude | cold | 5229 | 5229 | 1 | 688.468 |
| claude | resume | 3747 | 4088 | 1 | 918.953 |
| claude | warm | — | — | — | — (qualified: /opt/homebrew/bin/claude 2.1.308, driver claude, verifiedAgainst 2.1.308) |
| codex | cold | 3816 | 3816 | 1 | 943.396 |
| codex | resume | 3944 | 4474 | 1 | 855.31 |
| codex | warm | — | — | — | — (no turn-session driver registered for agent 'codex') |
| pi | cold | 4257 | 4257 | 1 | 845.666 |
| pi | resume | 3932 | 4289 | 1 | 875.806 |
| pi | warm | — | — | — | — (no turn-session driver registered for agent 'pi') |

Notes: durations use UTC wall clock across processes (one host clock domain);
per-phase `monotonicMs` stays in-process. `gates` has no observable in the stub lane
(the stub closes tasks without running quality gates) and is recorded absent.
Warm rows (tasks 1276-1278) record QUALIFICATION of the installed binary — driver verdict,
binary path and version. They carry no latency: the lane runs cold/resume trials only.
Repository-local binary paths are relative to the repository root; external paths stay absolute.

