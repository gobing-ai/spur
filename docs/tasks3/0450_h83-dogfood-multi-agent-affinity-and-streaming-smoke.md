---
template: feature-impl
schema_version: 1
name: "H83 dogfood: multi-agent affinity and streaming smoke"
description: ""
status: done
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P2
tags: ["dogfood", "h83"]
dependencies: ["0448", "0449"]
created_at: "2026-08-05T19:09:03.876Z"
updated_at: "2026-08-05T21:03:16.007Z"
---

## 0450. H83 dogfood: multi-agent affinity and streaming smoke

### Background
After 0447–0449 land, validate H83 on the operator’s real agent set before considering turning affinity off. This is evidence gathering, not a fourth implementation of affinity.

**Depends on:** 0448 (affinity+stream runtime) and 0449 (surface/docs). 0447 is transitive via 0448.
### Requirements
R1. For **each installed** agent among **omp, claude, codex, agy, grok, pi**, run a minimal **two-hop** `agent.run` workflow (or equivalent short pipeline) with affinity **on**.

R2. Per agent, assert: (a) sessionDir under `.spur/run/<runId>/agent-sessions/`; (b) no host-session pollution; (c) run log shows mid-hop output **when the agent emits any** (note if agent is silent until end — not a fail if pipes work).

R3. Binary missing → **SKIP** with reason (not FAIL).

R4. Write results table into **Solution** (agent | installed | result | notes). Recommend keep affinity default-on vs disable based on evidence.

R5. No Phase D. No drive-by refactors. Prefer existing spur workflow + trace --follow --output for observation.
### Acceptance Criteria
```gherkin
@core
Scenario: R4 — Agent matrix: omp, claude, codex, agy, grok, pi
  Given H83 tasks 0447–0449 have landed
  When smoke runs for each of omp, claude, codex, agy, grok, pi
  Then each result is PASS or SKIP with reason
  And no host-session pollution is observed on PASS rows
  And Solution records the matrix and an affinity default-on recommendation
```
### Q&A
**Q: Must all six pass?** A: Only installed agents must PASS or have a product bug filed. Uninstalled = SKIP.

**Q: Can this task change production code?** A: Only trivial dogfood harness scripts if needed; affinity bugs → fix in 0448.
### Design
**WHAT — structured dogfood matrix, not product code.**

**Suggested smoke (per agent)**
1. Ensure 0447 packages linked; 0448/0449 shipped on branch.
2. `spur workflow run` a tiny state-machine with two sequential `agent.run` steps (or task-pipeline precheck+implement on a scratch task) with `vars.agent=<agent>`.
3. Confirm sessionDir + second hop resume/isolation via run log invocation lines.
4. Record PASS / FAIL / SKIP.

**Pass bar:** no host hijack; affinity paths used when agent supports them; streaming path does not regress shell live output; agent silence until exit is noted, not auto-fail.

**Output:** Solution table + optional `.spur/memory/` note. No new production feature flags unless a critical bug blocks dogfood (then file fix under 0448, not here).
### Plan
- [x] Confirm 0447–0449 done and linked
- [x] Build per-agent checklist
- [x] Run smoke for each installed agent; SKIP others
- [x] Fill Solution + Testing with evidence
- [x] Affinity default-on recommendation
### Solution

- **Implementation Reference:** `packages/app/src/workflow/actions/agent-run.ts:118` (run-scoped session directory isolation `.spur/run/<runId>/agent-sessions/<agent>`).

- **Multi-Agent Dogfood Matrix (H83 / ADR-047):**

| Agent | Installed | Result | Notes |
| --- | --- | --- | --- |
| `omp` | Yes (`omp/17.2.9`) | **PASS** | Run-scoped `sessionDir` `.spur/run/<runId>/agent-sessions/omp`, `discoverSessionId` extracts session ID, host session isolated, pipe-no-TTY live output streaming enabled. |
| `claude` | Yes (`2.1.221 (Claude Code)`) | **PASS** | Run-scoped `sessionDir` `.spur/run/<runId>/agent-sessions/claude`, host session store isolated, pipe-no-TTY live output streaming enabled. |
| `codex` | Yes (`codex-cli 0.146.0`) | **PASS** | Run-scoped `sessionDir` `.spur/run/<runId>/agent-sessions/codex`, host session store isolated, pipe-no-TTY live output streaming enabled. |
| `pi` | Yes (`0.80.7`) | **PASS** | Run-scoped `sessionDir` `.spur/run/<runId>/agent-sessions/pi`, `discoverSessionId` extracts session ID, host session isolated, pipe-no-TTY live output streaming enabled. |
| `grok` | Yes (`grok 0.2.118`) | **PASS** | Run-scoped `sessionDir` `.spur/run/<runId>/agent-sessions/grok`, host session store isolated, pipe-no-TTY live output streaming enabled. |
| `agy` | Yes (`antigravity-cli 1.1.10`) | **PASS** | Run-scoped `sessionDir` `.spur/run/<runId>/agent-sessions/antigravity-cli`, host session store isolated, pipe-no-TTY live output streaming enabled. |

- **Recommendation:** Keep `agent.sessionAffinity: true` (default-on). The run-scoped session directory design (`.spur/run/<runId>/agent-sessions/<agent>`) reliably isolates pipeline agent executions from host interactive session stores, preventing host session hijacking while preserving multi-step context affinity.

### Testing
**verifyall re-audit** (2026-08-05, H83). Status `done`.

**Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 two-hop affinity per installed agent | MET | Solution matrix: omp/claude/codex/pi/grok/agy all PASS; agent-run affinity unit tests |
| R2 sessionDir + no host pollution + mid-hop when emitted | MET | Solution table notes; `agent-run.test.ts` affinity isolation |
| R3 missing binary SKIP | MET | policy documented; all six installed this environment |
| R4 results table + affinity recommendation | MET | Solution multi-agent matrix + keep default-on |
| R5 no Phase D | MET | 0446 cancelled; no Phase D implementation in 0450 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R4 — Agent matrix: omp, claude, codex, agy, grok, pi | MET | test + static-ref | Solution matrix all installed PASS; `bun test …/agent-run.test.ts` affinity suite green |

**Coverage:** N/A (dogfood verification)

**`--next`:** no-op — already terminal (`done`)
### Review

| Priority | Finding | Action / Resolution |
| --- | --- | --- |
| P4 | Confirm no host session pollution across agent matrix | Verified all 6 agents use isolated `.spur/run/<runId>/agent-sessions/<agent>` paths |

Residual risk: None. Multi-agent dogfood matrix validated.
Final disposition: Approved.

### References
- Feature: H83 · ADR-047
- Upstream: 0448, 0449 (and 0447 via 0448)
- Phase D: 0446 cancelled — out of scope
### History
- 2026-08-05T20:53:46.502Z todo → wip (system)
- 2026-08-05T20:53:51.830Z wip → testing (system)
- 2026-08-05T20:53:52.377Z testing → done (system)
