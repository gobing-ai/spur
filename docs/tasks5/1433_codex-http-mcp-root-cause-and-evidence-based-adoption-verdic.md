---
schema_version: 1
name: Codex HTTP MCP root cause and evidence-based adoption verdicts
status: todo
template: feature-impl
created_at: 2026-11-22T02:21:35.008Z
updated_at: "2026-11-22T04:26:15.940Z"
feature_id: B93

tags: ["B93"]
dependencies: ["1432"]
priority: P1
estimate_hours: 4
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

- [ ] R1. Root cause from the 1432 receipt: the Codex HTTP row's proxy requests (method, revision, status, error code) plus `codex --version`. Record it in this task's Solution and in the adoption doc as either:
  - (a) server fault: the server mishandles a ≥ floor request → fix it with a regression test in `apps/server/tests/modules/mcp/`; or
  - (b) client limitation: e.g. a legacy revision is rejected by design (ADR-152) → name the client revision seen.
- [ ] R2. Working path: in case (a), Codex HTTP lists tools and calls `sp_task_list` on re-run; in case (b), the receipt's Codex stdio row is `pass`.
- [ ] R3. Rewrite `docs/design/mcp-agent-adoption.md`:
  - §1 matrix cells "Highest revision claimed" and "Stateless works" come from receipt `clientRevision`/`classification` per transport;
  - §2 verdicts are derived mechanically: `mcp-http` iff the HTTP row is `pass`; otherwise `mcp-stdio-bridge` iff the stdio row is `pass`; otherwise `cli-only`, and `not-installed` agents are listed separately as unobserved;
  - every row cites the receipt path and `generatedAt`; the words "UNVERIFIED"/"unproven"/"documented" no longer stand alone as a verdict basis.
- [ ] R4. If any verdict changes from `mcp-http`, check that consumers of §2 (1394's adoption guidance) still point that agent at a path that works. Fix the guidance text in the same change.

Out of scope: making legacy clients work over HTTP (ADR-152 rejects it), and installing missing agents.

### Acceptance Criteria

- [ ] AC1 — The Codex HTTP no-tools case is root-caused with a working path
- [ ] AC2 — Adoption verdicts are derived from the interop receipt

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:14.635Z backlog → todo (system)

