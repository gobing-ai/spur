---
run_id: 40F2674412FE
status: complete
testee: "spur agent run --agent inline <prompt> (headless rejection surface)"
classification: cli
mode: observe-only
max_retry: 0
testee_agent: omitted
started_at: 2026-08-15T00:00:00.000Z
finished_at: 2026-08-15T00:00:00.000Z
live_path: .spur/run/dogfood/40F2674412FE.md
report_path: docs/dogfood/2026-08-15-agent-inline-G5-dogfood.md
protocol: sp:dogfood-testing@1.2
---

## Dogfood Report — `spur agent run --agent inline` (G5 host-session semantics)

### 1. Testee

- **Command:** `spur agent run --agent inline` + surface sweep
- **Classification:** CLI invocation
- **Exact invocation:** `bun apps/cli/src/index.ts agent run --agent inline "ping"` (headless) + boundary/help/sweep checks
- **Repro:** `spur agent run --agent inline "ping"` in the repo root
- **Testee agent:** omitted (testee runs in current session)
- **Mode:** observe-only (--max-retry 0)
- **Task under test:** 0565, 0566 (feature G5 — inline host-session-only semantics)
- **Run id:** 40F2674412FE · **Live:** .spur/run/dogfood/40F2674412FE.md · **Report:** docs/dogfood/2026-08-15-agent-inline-G5-dogfood.md

### 2. Execution Summary

- **Result:** PASS  `(0 fixed, 0 unresolved, 1 finding)`
- **Wall-clock:** ~2 min  `[~estimate]`
- **Steps:** 6 derived, 6 executed, 0 N/A
- **Fix attempts:** 0 (observe-only)
- **Ledger write mode:** batch-finalize (fast-run exemption, total wall-clock < 3 min)
- **Detector advisory (Phase 1.2b):** implement-heavy advisory emitted (testee string contains the word `run`); observe-only chosen, no tree mutation.

#### Cost
- **Ledger estimate:** ~3300 total | ~1500 cached (~45% hit rate)  `[~estimate]`
- **Method:** chars/4 heuristic (monitor-ledger.md); confidence: LOW
- **Meter:** n/a

### 3. Monitor Ledger

| Step | Attempts | Outcome | Fix Applied | Finding | Fresh Tokens | Cached Tokens | Cache % | Basis | Wall-clock |
|------|----------|---------|-------------|---------|--------------|---------------|---------|-------|------------|
| 1 headless-reject | 1 | PASS | — | — | ~300 | ~200 | 40% | command output (exit 2 + frozen message) | ~3s |
| 2 flag-boundary | 1 | PASS | — | — | ~200 | ~200 | 50% | command output (Unknown agent, valid sets) | ~3s |
| 3 help-clause | 1 | PASS | — | — | ~200 | ~100 | 33% | --help output, inline clause | ~2s |
| 4 selector-contract | 1 | PASS | — | — | ~600 | ~300 | 33% | targeted test output (2 pass) | ~30s |
| 5 sweep-clean | 1 | PASS | — | — | ~200 | ~400 | 67% | frozen rg over plugins/sp (14 hits, all fixtures/corrected) | ~2s |
| 6 docs-consistent | 1 | PASS | — | — | ~300 | ~300 | 50% | grep + prior reads reused | ~3s |

**Cache calculation:** aggregate cache% = round(1500 / (1800 + 1500) * 100) = 45%.

### 4. What We Did

1. **Headless rejection drive** — `bun apps/cli/src/index.ts agent run --agent inline "ping"` exited 2 with the frozen `AGENT_INLINE_HEADLESS_MESSAGE` verbatim (`--agent inline requires a host session: this surface is headless and never dispatches inline runs (no fallback to agent.default). Use 'auto', a role, or an executor name.`) and no agent process spawned (no dispatch output, immediate return). AC R1 observed end-to-end.
2. **Flag-boundary regression (AC R5)** — `--agent not-a-name` exited 2 with `Unknown agent: 'not-a-name'. Accepted: role (scribe, coder, reviewer, planner), configured executor (…), or 'auto'.` — invalid names keep failing at the flag boundary before any spawn.
3. **Help surface** — `spur agent run --help` shows `--agent <name>  Role, executor, agent binary, auto, or inline (host-session-only; errors on headless surfaces)` — the G5 clause shipped.
4. **Selector contract tests** — `bun test apps/cli/tests/commands/agent.test.ts --test-name-pattern "inline"` → 2 pass / 0 fail (selector returns the frozen message for `inline`; omit/auto null; e2e exit-2 no-spawn with dispatch mock never called).
5. **R3 sweep** — frozen pattern `inline.{0,40}(omit|agent\.default)|synonym for omit|exactly .inline` over `plugins/sp`: 14 hits, every one a test fixture/assertion (`flag-contract-parity.test.ts` deliberate drift fixtures, `inline-execution-contract.test.ts` assertions) or corrected carve-out prose (`dev-runall.md:84` states the zero-dispatch carve-out). Zero live inline≡omit/agent.default rows.
6. **Docs consistency** — `cross-cutting.md` carries the frozen carve-out verbatim ("hard host-session guarantee" present); `next-router/SKILL.md` corrected (zero-dispatch carve-out present, no `default: inline` router row); zero `--agent` rows with a `default: inline` cell remain in `plugins/sp/commands/`.

### 5. Issues

#### Fixed

- (none)

#### Unresolved

- (none)

### 6. Findings

- **P3** — Low cache hit rate (45% aggregate; steps 3/4 at 33%) — the help-clause and selector-test steps re-fetched command/test output rather than reusing earlier captures. → **Action:** run the help and test steps from one captured block; not worth a dedicated task. (`docs/dogfood/2026-08-15-agent-inline-G5-dogfood.md`, ~0 effort)  `[feasible]`

```
── Dogfood Summary ──
Result: PASS   (0 fixed, 0 unresolved, 1 finding)
Tokens: ~3300 total  |  ~1500 cached (~45% hit rate)  [~estimate]

Fixed issues:
  • (none)

Unresolved issues:
  • (none)

Findings:
  • P3 — low cache% on help/test steps (45% aggregate) — reuse captures next run.

[Live: .spur/run/dogfood/40F2674412FE.md]
[Report: docs/dogfood/2026-08-15-agent-inline-G5-dogfood.md]
```
