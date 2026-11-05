---
run_id: I14-grok-bot-notify-20261104
status: complete
testee: "spur workflow run docs/help/examples/grok-bot-notify.yaml --vars '{\"target\":\"<fixture>\"}' --json"
classification: cli
mode: observe-only
max_retry: 0
testee_agent: omitted
started_at: "2026-11-05T04:49:40Z"
finished_at: "2026-11-05T04:53:22Z"
live_path: .spur/run/dogfood/I14-grok-bot-notify-20261104.md
report_path: docs/dogfood/2026-11-04-I14-grok-bot-notify-dogfood.md
protocol: sp:dogfood-testing@1.2
workspace_fingerprint:
  head: 0242eade153c613ae4a033e5959cbe9fb93f5c65
  porcelain_hash: e149644f561870879dc6cd8a1771c1a643bd6761f64ecf66de054003f7940231
  taken_at: "2026-11-05T04:49:40Z"
---

# I14 Grok Bot webhook-notify recipe dogfood

### 1. Testee

**Repro:** `GROK_ROUTINE_URL=<url> GROK_ROUTINE_KEY=<key> spur workflow run docs/help/examples/grok-bot-notify.yaml --vars '{"target":"<abs path>/apps/cli/tests/fixtures/grok-bot/pass.yaml"}' --json`

Feature I14 (tasks 1291–1293): the Grok Bot routine-wrapper recipe, run as a user would. It uses the global
`spur`, which is linked to source `apps/cli`, from a fresh project dir per scenario. It posts to a local
webhook stub. The bearer key contains `%` and `\`. A real x.ai routine endpoint was not exercised (task 1293
keeps the payload contract `unverified`). The `dogfood-gate` printed the implement-heavy advisory, so the run
was observe-only (`--max-retry 0`). Driver: scratchpad `dogfood-i14.ts`.

### 2. Execution Summary

**Result:** PASS (0 fixed, 0 unresolved, 2 findings)
**Steps:** 6 derived, 6 executed

#### Cost

- **Ledger estimate:** ~n/a total | ~n/a cached (n/a% hit rate) [unavailable]
- **Method:** unavailable; deterministic shell scenarios with no model calls in the testee; confidence: LOW
- **Meter:** n/a

### 3. Monitor Ledger

| Step | Attempts | Outcome | Fix Applied | Finding | Fresh Tokens | Cached Tokens | Cache % | Basis | Wall-clock |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| validate recipe | 1 | PASS | — | — | n/a | n/a | n/a | workflow validate valid=true | 0.3s |
| passing target → done + one authorized POST | 1 | PASS | — | — | n/a | n/a | n/a | status=done posts=1 authExact=true body.status=done | 0.7s |
| failing target → failed + POST body failed | 1 | PASS | — | — | n/a | n/a | n/a | status=failed posts=1 body.status=failed | 0.7s |
| key unset → failed, named, zero POST | 2 | PASS | driver-only: assert on `stderr>` lines, not echoed command text | attempt 1 driver assertion bug (matched the URL message inside the echoed guard command); testee unchanged | n/a | n/a | n/a | rerun: stderr = `GROK_ROUTINE_KEY is not set` only; status=failed posts=0 | 0.6s |
| url unset → failed, named, zero POST | 1 | PASS | — | — | n/a | n/a | n/a | status=failed named=true posts=0 | 0.6s |
| no key leak + live repo .spur untouched | 1 | PASS | — | — | n/a | n/a | n/a | keyInStreamsOrRunLog=false liveRepoRunDelta=0 | 0.7s |

### 4. What We Did

Each scenario ran the recipe in its own fresh temp project. Passing and failing targets each produced exactly
one POST. The body was the target's `--json` run document (`status` done/failed). The Authorization header
carried the key verbatim. A missing key or URL failed the run with only that variable named, and nothing was
posted. The key never appeared in stdout, stderr or the persisted run log. The live repo `.spur/run` count was
unchanged. The single re-run step was a driver assertion bug, not a testee defect.

### 5. Issues

#### Fixed

(none)

#### Unresolved

(none)

### 6. Findings

- P4 — The run log echoes the full guard command (both error strings) on failure, so log greps for an error
  message must anchor on `stderr>` lines.
- P4 — The real routine endpoint and payload shape remain unverified until the operator fires the recipe at a
  live routine (carried from 1293 residual advisory).


```
── Dogfood Summary ──
Result: PASS   (0 fixed, 0 unresolved, 2 findings)
Tokens: ~n/a total  |  ~n/a cached (~n/a% hit rate)  [~estimate]

Fixed issues:
  • (none)

Unresolved issues:
  • (none)

Findings (P1+P2):
  • (none)

[Live: .spur/run/dogfood/I14-grok-bot-notify-20261104.md]
[Report: docs/dogfood/2026-11-04-I14-grok-bot-notify-dogfood.md]
```
