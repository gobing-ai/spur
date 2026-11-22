---
schema_version: 1
name: Codex HTTP MCP root cause and evidence-based adoption verdicts
status: done
template: feature-impl
created_at: 2026-11-22T02:21:35.008Z
updated_at: "2026-11-22T19:03:01.850Z"
feature_id: B93

tags: ["B93"]
dependencies: ["1432"]
priority: P1
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1433. Codex HTTP MCP root cause and evidence-based adoption verdicts

### Background

Implements: R2 — The Codex HTTP no-tools case is root-caused with a working path; R4 — Adoption verdicts are derived from the interop receipt.

`docs/design/mcp-agent-adoption.md` §2: Codex configures cleanly but reports no tools.

**Refine corrections (2026-11-21)**
- Background read "Implements: R2 R4 — ." and AC1 was blank → both now name the feature scenarios R2 and R4.
- Leading hypothesis (to confirm, not assume): Codex's HTTP client speaks the 2025 lifecycle. It sends `initialize` without `Mcp-Protocol-Version`, so the server's version gate answers `400 PROTOCOL_VERSION_UNSUPPORTED` (`apps/server/src/modules/mcp/protocol.ts:108-129`) before any tool event. Codex then shows the server as configured with zero tools. This is consistent with the evidence:
  - Codex CLI 0.171.0 *did* discover tools through the stdio bridge, which translates `initialize` (adoption doc §1a, task 1417; `apps/cli/src/commands/mcp.ts:83-121`);
  - the server emits nothing for rejected requests, which is why the earlier attempt left no trace.
- Current §2 lists **all ten** agents as `mcp-http`, on documentation only. If the hypothesis holds, every agent whose HTTP client predates `2026-07-28` is mis-labeled, and the honest verdict is `mcp-stdio-bridge`.

### Requirements

- [x] R1. Root cause from the 1432 receipt: the Codex HTTP row's proxy requests (method, revision, status, error code) plus `codex --version`. Record it in this task's Solution and in the adoption doc as either:
  - (a) server fault: the server mishandles a ≥ floor request → fix it with a regression test in `apps/server/tests/modules/mcp/`; or
  - (b) client limitation: e.g. a legacy revision is rejected by design (ADR-152) → name the client revision seen.
- [x] R2. Working path: in case (a), Codex HTTP lists tools and calls `sp_task_list` on re-run; in case (b), the receipt's Codex stdio row is `pass`.
- [x] R3. Rewrite `docs/design/mcp-agent-adoption.md`:
  - §1 matrix cells "Highest revision claimed" and "Stateless works" come from receipt `clientRevision`/`classification` per transport;
  - §2 verdicts are derived mechanically: `mcp-http` iff the HTTP row is `pass`; otherwise `mcp-stdio-bridge` iff the stdio row is `pass`; otherwise `cli-only`, and `not-installed` agents are listed separately as unobserved;
  - every row cites the receipt path and `generatedAt`; the words "UNVERIFIED"/"unproven"/"documented" no longer stand alone as a verdict basis.
- [x] R4. If any verdict changes from `mcp-http`, check that consumers of §2 (1394's adoption guidance) still point that agent at a path that works. Fix the guidance text in the same change.

Out of scope: making legacy clients work over HTTP (ADR-152 rejects it), and installing missing agents.

### Acceptance Criteria

- [x] AC1 — The Codex HTTP no-tools case is root-caused with a working path
- [x] AC2 — Adoption verdicts are derived from the interop receipt

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:26:14.536Z

- **Closed: a client-side cause is acceptable.** Yes, if the receipt names it and stdio passes (feature R2's "Or" branch).
- **Closed: not-installed agents.** List them as unobserved. They get no verdict from documentation.

### Design

- **Evidence only from the receipt:** no verdict from docs, memory or an agent's prose. A not-installed agent stays `not-installed (unobserved)` and is not promoted from documentation.
- **Case (b) is a legitimate outcome:** the deliverable is a named cause plus a working path, not necessarily HTTP. Do not weaken the version gate to make Codex HTTP pass.
- **Doc edit scope:** §1, §2 and §3 of `mcp-agent-adoption.md`, plus the "Checked:" date. §1a (install route) changes only if the receipt contradicts it. Find the 1394 guidance consumer with `rg -n "mcp-agent-adoption|mcp-http" plugins docs` before editing.
- **Anti-patterns:** no hand-typed matrix values that disagree with the receipt; no rerun-until-pass (a flaky agent is recorded as such with its excerpt).

### Plan

Premises (verified 2026-11-21): version gate `protocol.ts:108-129`; bridge translation `apps/cli/src/commands/mcp.ts:83-121`; Codex stdio verified in task 1417 (adoption doc §1a); §2 verdict table in `docs/design/mcp-agent-adoption.md`.

- [ ] 1. Failure modes: a hypothesis is asserted without the proxy log; a server fault is mis-filed as a client limit; a verdict disagrees with the receipt; the guidance still sends a bridge-only agent to HTTP.
- [ ] 2. Read the Codex HTTP and stdio rows and their proxy requests from the 1432 receipt. Decide (a) or (b).
- [ ] 3. In case (a), write the failing server test from the captured request, fix it, and rerun `bun run scripts/commands/mcp-agent-interop.ts --agents codex`. In case (b), confirm the stdio row is `pass`.
- [ ] 4. Regenerate §1/§2/§3 from the receipt and update the 1394 guidance if any verdict moved.
- [ ] 5. Run `bun run spur-check`.

### Solution

Forced verification completion — 2026-11-22

#### R1 — Recorded Codex HTTP cause

Codex CLI 0.171.0 supports an isolated HTTP override: a unique `mcp_servers.spur_interop` TOML table. The old statement that HTTP requires global configuration was a harness defect caused by merging HTTP into an existing stdio entry. The recording proxy now observes the actual HTTP `initialize`, no protocol-version header, and requested body revision `2025-06-18`; the real server answers `400 PROTOCOL_VERSION_UNSUPPORTED`. This is the task's client-limitation branch: direct HTTP uses the legacy lifecycle rejected by ADR-152, with an actionable bridge fallback. The server version gate remains unchanged.

#### R2 — Proven working path

The installed Codex native app-server API initializes an ephemeral read-only thread, obtains the bridge catalog, sees ten tools and invokes `sp_task_list`. The proxy records `server/discover`, `tools/list`, and the named successful `tools/call` at upstream revision `2026-07-28`. The receipt's Codex stdio classification is `pass`, not a configuration-only claim. The upstream bridge revision is explicitly distinguished from the original client's HTTP initialize revision.

The repaired proxy also removes stale compression headers after decoding the upstream body. A failure-first regression reproduced the corruption that otherwise made a real client close during initialization. These are fixture repairs, not a server-policy downgrade.

#### R3 — Receipt-derived adoption guide

`docs/design/mcp-agent-adoption.md` is regenerated from the finished receipt. Every agent has HTTP and stdio observations, revision/outcome and actual catalog counts; every verdict row cites the receipt and generatedAt. The verdict rule is HTTP pass → mcp-http; otherwise stdio pass → mcp-stdio-bridge; otherwise cli-only. Absent binaries remain unobserved. Per-row observedAt avoids falsely fresh claims after subset reruns. The standalone comparison under `.spur/run/B93-guide-check.json` checks all ten verdicts against the receipt.

#### R4 — Consumer guidance

The consumers at `docs/04_DESIGN.md:92`, `plugins/sp/skills/spur-cli/references/mcp-tools.md:9` and `plugins/sp/skills/spur-dev/references/cross-cutting.md:25` link to the guide; they do not hard-code per-agent transports. The guide now states the supported paths from the receipt, provides `spur task list --json` as the CLI fallback, and distinguishes an unobserved path from an inherent lack of MCP capability. No consumer now infers direct HTTP support from installation alone.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/design/mcp-agent-adoption.md:66` and the Codex HTTP receipt row establish case (b): codex-cli 0.171.0 sends initialize with requested revision 2025-06-18 and no protocol header; the proxy records 400 PROTOCOL_VERSION_UNSUPPORTED under ADR-152. The old config-isolation conclusion was a harness defect and has been replaced. |
| R2 | MET | `scripts/commands/mcp-agent-interop.ts:444` uses the installed Codex client native API in an ephemeral read-only thread. Its stdio receipt row is pass, with ten tools, a successful tools/list and the named successful sp_task_list call at bridge upstream revision 2026-07-28; configuration acceptance alone is not used as proof. |
| R3 | MET | `docs/design/mcp-agent-adoption.md:10` derives the matrix from receipt revisions and transport classifications, and line 45 derives all ten verdicts by the required priority rule. Every verdict cites the receipt and generatedAt. @batch `.spur/run/B93-guide-check.json` lines 1-53 records the independent ten-agent comparison; missing agents remain unobserved. |
| R4 | MET | Full code gate PASS: @batch `.spur/run/run_a806b2e2-63b3-42ed-b03b-28663631fa05-feature-verification.log` lines 1-786; 13,149 normal tests, 64 repository contract tests, 85 heavy tests passed, one inapplicable no-browser skip. Fix-pass artifacts: @batch `.spur/run/1433-verify-answer.txt` lines 1-34 and `.spur/run/1433-verdict.json` lines 1-63; raw proof under `.spur/run/B93-`. `docs/design/mcp-agent-adoption.md:62` now states the observed transport choices and a working CLI fallback. `docs/04_DESIGN.md:92`, `plugins/sp/skills/spur-cli/references/mcp-tools.md:9` and `plugins/sp/skills/spur-dev/references/cross-cutting.md:25` are generic guide links, with no contradictory per-agent transport literal to patch. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R2 — The Codex HTTP no-tools case is root-caused with a working path | MET | command | `docs/reports/mcp-agent-interop-receipt.json:1`; live operator run and independent @batch `.spur/run/B93-guide-check.json` comparison. Not-installed clients and actual per-agent failures remain explicitly classified. |
| R4 — Adoption verdicts are derived from the interop receipt | MET | command | `docs/reports/mcp-agent-interop-receipt.json:1`; live operator run and independent @batch `.spur/run/B93-guide-check.json` comparison. Not-installed clients and actual per-agent failures remain explicitly classified. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:14.635Z backlog → todo (system)
- 2026-11-22T17:42:22.275Z todo → wip (system)
- 2026-11-22T18:49:49.945Z wip → testing (system)
- 2026-11-22T18:50:49.319Z testing → done (system)

