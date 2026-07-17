---
run_id: fixture-missing-footer-0002
status: complete
testee: "/sp:dev-example 0002 --auto"
classification: slash-command
mode: observe-only
max_retry: 0
testee_agent: omitted
started_at: "2026-07-17T00:00:00.000Z"
finished_at: "2026-07-17T00:05:00.000Z"
live_path: .spur/run/dogfood/fixture-missing-footer-0002.md
report_path: docs/dogfood/2026-07-17-sp-dev-example-2-dogfood.md
protocol: sp:dogfood-testing@1.2
---

## Dogfood Report — `/sp:dev-example 0002 --auto`

### 1. Testee

- **Command:** `/sp:dev-example 0002 --auto`
- **Classification:** `slash command`
- **Exact invocation:** `Skill(skill="sp:example", args="0002 --auto")`
- **Repro:** `/sp:dev-example 0002 --auto`
- **Testee agent:** `omitted (testee runs in current session)`
- **Mode:** `observe-only (--max-retry 0)`
- **Task under test:** 0002 — fixture task
- **Run id:** `fixture-missing-footer-0002` · **Live:** `.spur/run/dogfood/fixture-missing-footer-0002.md` · **Report:** `docs/dogfood/2026-07-17-sp-dev-example-2-dogfood.md`

### 2. Execution Summary

- **Result:** PASS `(0 fixed, 0 unresolved, 0 findings)`
- **Wall-clock:** ~5 min `[~estimate]`
- **Steps:** 2 derived, 2 executed, 0 N/A
- **Fix attempts:** 0

#### Cost

- **Ledger estimate:** ~1400 total | ~700 cached (~33% hit rate) `[~estimate]`
- **Method:** chars/4 heuristic (monitor-ledger.md); confidence: LOW
- **Meter:** n/a

### 3. Monitor Ledger

| Step | Attempts | Outcome | Fix Applied | Finding | Fresh Tokens | Cached Tokens | Cache % | Basis | Wall-clock |
|------|----------|---------|-------------|---------|--------------|---------------|---------|-------|------------|
| 1 resolve | 1 | PASS | — | — | ~600 | ~400 | 40% | task JSON output + prior command docs reused | ~3s |
| 2 execute | 1 | PASS | — | — | ~800 | ~300 | 27% | command output + prior plan reused | ~5s |

**Cache calculation:** aggregate cache% = round((sum(Cached Tokens) / sum(Fresh Tokens + Cached Tokens)) * 100).

### 4. What We Did

1. **Resolve** — loaded the fixture task; plan derived 2 steps.
2. **Execute** — ran both steps as a user would; both passed first-try.

### 5. Issues

#### Fixed

(none)

#### Unresolved

- (none)

### 6. Findings

(none)
